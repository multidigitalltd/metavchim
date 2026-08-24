import { Injectable, NotFoundException } from "@nestjs/common";
import {
  buildOwnerActivity,
  ownerActivityCsv,
  summarizeOwnerActivity,
  type OwnerActivityKind,
  type OwnerActivityResult,
} from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { AuditService } from "../../core/audit.service";
import { PrismaService } from "../../core/prisma.service";

/**
 * דוח הפעילות בנכס שהמתווך מוסר לבעל הנכס.
 *
 * מה נספר כפעילות בנכס:
 *   • פגישות וביקורים שנקבעו **על הנכס** (`appointments.property_id`)
 *   • שיחות טלפון שנשמר עליהן **צילום** של הנכס (`calls.property_id`)
 *   • שיחות טלפון שנקשרו לאותן פגישות (`calls.appointment_id`)
 *
 * **הצילום, ולא שליפה חיה דרך הליד.** גרסה קודמת חיברה שיחה לנכס
 * דרך `leads.property_id`, מתוך הנחה שהשיוך נכתב על הליד ברגע
 * השיחה. ההנחה שגויה: ליד כללי שנפתח בלי נכס מקבל אותו מאוחר יותר,
 * כשאותו אדם ממלא טופס של נכס מסוים — ומאותו רגע כל השיחות הישנות
 * שלו היו מופיעות בדוח של הנכס החדש (ביקורת Codex, P1). בדוח שנמסר
 * לבעל נכס זו אינה אי-דיוק אלא חשיפה של פעילות שאינה שלו.
 *
 * ‎`calls.property_id` נכתב פעם אחת ביצירת השיחה ואינו משתנה איתה.
 * שיחות שנוצרו לפני העמודה נושאות NULL ואינן מופיעות — הדוח מעדיף
 * לחסר פריט על פני לטעון טענה שאינו יכול לבסס.
 *
 * **בלי סינון בעלות, במכוון.** הדוח מתאר את הנכס ולא את הסוכן:
 * ביקור שערך עמית וטלפון שענה עמית אחר הם חלק ממה שנעשה עבור בעל
 * הנכס, ודוח שמראה רק את חלקו של הקורא הוא דוח שגוי בידי הלקוח.
 * הנכס עצמו אינו משויך לסוכן, וכל מי שרואה אותו רשאי לראות מה
 * נעשה בו. שום שורה כאן אינה נושאת זהות של אדם — לא של המתעניין
 * ולא של הסוכן.
 */

/**
 * תקרת שורות לכל מקור. הדוח מדווח על קיטום ואינו בולע אותו —
 * "‏37 ביקורים" שהוא בעצם 500 הוא בדיוק סוג השקר שמסמך ללקוח
 * אינו יכול להכיל.
 */
const MAX_ROWS = 500;

export interface OwnerActivityEntryDto {
  at: string;
  kind: OwnerActivityKind;
  result: OwnerActivityResult;
  durationMinutes?: number;
}

export interface OwnerActivityReportDto {
  entries: OwnerActivityEntryDto[];
  summary: {
    total: number;
    held: number;
    upcoming: number;
    inquiries: number;
    lastAt?: string;
  };
  /** נחתכו שורות מעבר לתקרה — המסך אומר זאת במפורש. */
  truncated: boolean;
}

export interface OwnerActivityRange {
  from?: Date;
  to?: Date;
}

@Injectable()
export class PropertyActivityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** הדוח כפי שהמסך מציג אותו. */
  async report(propertyId: string, range: OwnerActivityRange): Promise<OwnerActivityReportDto> {
    const { appointments, calls, truncated } = await this.collect(propertyId, range);
    const entries = buildOwnerActivity({ appointments, calls });
    const summary = summarizeOwnerActivity(entries, new Date());

    return {
      entries: entries.map((entry) => ({
        at: entry.at.toISOString(),
        kind: entry.kind,
        result: entry.result,
        ...(entry.durationMinutes === undefined
          ? {}
          : { durationMinutes: entry.durationMinutes }),
      })),
      summary: {
        total: summary.total,
        held: summary.held,
        upcoming: summary.upcoming,
        inquiries: summary.inquiries,
        ...(summary.lastAt ? { lastAt: summary.lastAt.toISOString() } : {}),
      },
      truncated,
    };
  }

  /**
   * אותן שורות בדיוק כקובץ.
   *
   * ההורדה נרשמת ב-Audit והצפייה לא: המסך הוא חלק מכרטיס הנכס,
   * ואילו הקובץ עוזב את המערכת אל אדם שאינו משתמש בה — וזו הנקודה
   * שבה יש מה לתעד.
   */
  async csv(propertyId: string, range: OwnerActivityRange): Promise<string> {
    const { appointments, calls, truncated } = await this.collect(propertyId, range);
    const entries = buildOwnerActivity({ appointments, calls });

    await this.prisma.withTenant((tx) =>
      this.audit.record(tx, {
        action: "property.activity_export",
        entityType: "property",
        entityId: propertyId,
        metadata: { count: entries.length, truncated },
      }),
    );

    /*
     * הקיטום נוסע **עם הקובץ**. האזהרה שבמסך נשארת במערכת, והקובץ
     * הוא מה שמגיע לבעל הנכס — קובץ שנראה שלם ואינו שלם הוא בדיוק
     * השקר שהדוח נועד לא לספר (ביקורת Codex).
     */
    return ownerActivityCsv(entries, { truncated });
  }

  /**
   * השליפה עצמה — `select` מפורש ומצומצם בכל טבלה.
   *
   * זו שכבת ההגנה השנייה מעל הטיפוסים שב-shared: השאילתה אינה
   * מביאה כותרת פגישה, הערה, סיכום שיחה או מזהה איש קשר, ולכן אין
   * מה לסנן בהמשך הדרך.
   */
  private async collect(
    propertyId: string,
    range: OwnerActivityRange,
  ): Promise<{
    appointments: { kind: string; startsAt: Date; status: string; outcome: string | null }[];
    calls: {
      direction: string;
      occurredAt: Date;
      outcome: string;
      durationMinutes: number | null;
    }[];
    truncated: boolean;
  }> {
    const tenantId = TenantContext.current().tenantId;
    const window = {
      ...(range.from ? { gte: range.from } : {}),
      ...(range.to ? { lte: range.to } : {}),
    };
    const hasWindow = Object.keys(window).length > 0;

    return this.prisma.withTenant(async (tx) => {
      const property = await tx.property.findFirst({
        where: { id: propertyId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!property) throw new NotFoundException("נכס לא נמצא");

      const appointmentRows = await tx.appointment.findMany({
        where: { tenantId, propertyId, ...(hasWindow ? { startsAt: window } : {}) },
        select: { id: true, kind: true, startsAt: true, status: true, outcome: true },
        orderBy: { startsAt: "desc" },
        take: MAX_ROWS,
      });

      const appointmentIds = appointmentRows.map((row) => row.id);
      const callRows = await tx.call.findMany({
        where: {
          tenantId,
          ...(hasWindow ? { occurredAt: window } : {}),
          /*
           * הקלטת פגישה **אינה שיחת טלפון.**
           *
           * ‎`CalendarService.attachRecording` יוצרת שורת שיחה עם
           * ‎`source: "meeting"` ו-`direction: "inbound"` כדי לנצל את
           * צינור התמלול הקיים. בלי הסייג הזה ביקור מוקלט היה מופיע
           * בדוח פעמיים — פעם כביקור ופעם כ„פניית מתעניין” שמעולם לא
           * הייתה, כלומר מספר מתעניינים מנופח בדוח ללקוח (ביקורת
           * Codex, P1). הפגישה עצמה כבר מייצגת אותה.
           */
          source: { not: "meeting" },
          OR: [
            { propertyId },
            ...(appointmentIds.length > 0 ? [{ appointmentId: { in: appointmentIds } }] : []),
          ],
        },
        select: {
          direction: true,
          occurredAt: true,
          outcome: true,
          durationMinutes: true,
        },
        orderBy: { occurredAt: "desc" },
        take: MAX_ROWS,
      });

      return {
        appointments: appointmentRows.map((row) => ({
          kind: row.kind,
          startsAt: row.startsAt,
          status: row.status,
          outcome: row.outcome,
        })),
        calls: callRows,
        truncated: appointmentRows.length === MAX_ROWS || callRows.length === MAX_ROWS,
      };
    });
  }
}
