import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import {
  buildOwnerActivity,
  ownerActivityCsv,
  ownerActivityEmail,
  ownerActivityFileName,
  ownerActivityText,
  summarizeOwnerActivity,
  type OwnerActivityKind,
  type OwnerActivityResult,
} from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { AuditService } from "../../core/audit.service";
import { CryptoService } from "../../core/crypto.service";
import { EmailService } from "../../core/email.service";
import { PrismaService } from "../../core/prisma.service";
import { WhatsAppSendService } from "../messaging/whatsapp-send.service";

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
 *
 * **נשלפת שורה אחת מעבר לתקרה, והיא זו שמכריעה.** ‎`length === MAX_ROWS`
 * אינו יודע להבחין בין „בדיוק 500” לבין „יותר מ-500”, ולכן דוח שלם
 * בן 500 פעולות היה מסומן כחלקי — ומאז שהסימון נוסע אל הקובץ ואל
 * ההודעה, זו טענה שגויה שמגיעה ללקוח (ביקורת Codex). השורה הנוספת
 * נזרקת ואינה מוצגת; כל תפקידה הוא לענות על השאלה הזו.
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
  /**
   * ‎**במה אפשר לשלוח לבעל הנכס בפועל.**
   *
   * ‏המסך אינו יכול לגזור את זה בעצמו: פרטי בעל הנכס מוצפנים,
   * והכרטיס אינו מחזיר אותם. בלי השדה הזה שני הכפתורים היו מוצגים
   * תמיד, ומי שלחץ „שלח באימייל” לבעל נכס בלי אימייל היה מקבל
   * שגיאה במקום כפתור מושבת עם הסבר.
   */
  owner: OwnerChannelsDto;
}

export interface OwnerChannelsDto {
  /** שם בעל הנכס — לפנייה במייל ולטקסט שעל הכפתור. */
  name?: string;
  /** ‏יש טלפון בכרטיס בעל הנכס. */
  whatsapp: boolean;
  /** ‏יש אימייל בכרטיס בעל הנכס. */
  email: boolean;
}

/** ‏באיזה ערוץ נשלח הדוח — המתווך בוחר (בקשת המשתמש). */
export type OwnerReportChannel = "whatsapp" | "email";

export interface OwnerReportSentDto {
  channel: OwnerReportChannel;
  /** ‏היעד כפי שהוא מוצג חזרה למתווך — „לוואטסאפ של יוסי לוי”. */
  to: string;
  count: number;
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
    private readonly crypto: CryptoService,
    private readonly email: EmailService,
    private readonly whatsapp: WhatsAppSendService,
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
      owner: await this.ownerChannels(propertyId),
    };
  }

  /**
   * ‎**מה יש בכרטיס בעל הנכס — בלי להחזיר את הפרטים עצמם.**
   *
   * ‏שני בוליאנים ושם, ולא טלפון ואימייל: המסך צריך לדעת אילו
   * כפתורים חיים, ואין לו שום שימוש בערכים. פרט מוצפן שיוצא מהשרת
   * כדי להחליט על מצב כפתור הוא פרט שדלף בשביל כלום.
   */
  private async ownerChannels(propertyId: string): Promise<OwnerChannelsDto> {
    const tenantId = TenantContext.current().tenantId;
    const owner = await this.prisma.withTenant(async (tx) => {
      const property = await tx.property.findFirst({
        where: { id: propertyId, tenantId, deletedAt: null },
        select: { ownerContactId: true },
      });
      if (!property?.ownerContactId) return null;
      return tx.contact.findFirst({
        where: { id: property.ownerContactId, tenantId },
        select: { nameEncrypted: true, phoneEncrypted: true, emailEncrypted: true },
      });
    });
    if (owner === null) return { whatsapp: false, email: false };
    const name = this.safeDecrypt(owner.nameEncrypted);
    return {
      ...(name === undefined ? {} : { name }),
      whatsapp: this.safeDecrypt(owner.phoneEncrypted) !== undefined,
      email: this.safeDecrypt(owner.emailEncrypted) !== undefined,
    };
  }

  /**
   * ‏פענוח שאינו מפיל את המסך.
   *
   * שדה שנכתב במפתח קודם אינו ניתן לפענוח, וזה לא אמור להפוך את
   * „הצג דוח פעילות” ל-500. כאן זה נקרא כ„אין ערוץ”, וזו התשובה
   * הנכונה: אי אפשר לשלוח למספר שאי אפשר לקרוא.
   */
  private safeDecrypt(value: string | null | undefined): string | undefined {
    if (!value) return undefined;
    try {
      const plain = this.crypto.decrypt(value).trim();
      return plain === "" ? undefined : plain;
    } catch {
      return undefined;
    }
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
   * ‎**שליחת הדוח לבעל הנכס — הפעולה שלא הייתה.**
   *
   * ## מה היה
   *
   * ‏המסך ידע לבנות את הדוח, להוריד אותו כקובץ, ולהעתיק את ההודעה
   * ללוח. שליחה בפועל לא הייתה קיימת בשום מקום — `ownerActivityText`
   * נקראה בדיוק פעם אחת, בכפתור ההעתקה. כלומר בעל הנכס לא קיבל את
   * הדוח לא בגלל תקלה בשליחה, אלא כי איש לא שלח: המתווך היה אמור
   * להדביק את הטקסט בעצמו, ומי שלא עשה זאת השאיר את הלקוח בלי דבר
   * (דיווח המשתמש).
   *
   * ## ‏למה זה זורק ולא מחזיר „נכשל”
   *
   * ‏זו פעולה של אדם שלחץ כפתור ומחכה לתשובה, ולא עבודת רקע.
   * שליחה שנכשלה חייבת להגיע אליו כשגיאה שאומרת **מה** נכשל, כדי
   * שיוכל להעתיק ולשלוח בעצמו — ההפך הגמור מ„✓ נשלח” על הודעה
   * שמעולם לא יצאה.
   *
   * ## ‏חלון 24 השעות של Meta
   *
   * ‏טקסט חופשי בוואטסאפ מותר רק בתוך 24 שעות מהודעה של הנמען.
   * בעל נכס שלא כתב למשרד לאחרונה **לא יקבל** — ‏`sendTextAs` מחזיר
   * ‎`false`, וזה נאמר למתווך במפורש ולא נבלע. הפתרון המלא הוא
   * תבנית מאושרת ב-Meta, וזו הרשמה שהמשרד עושה מולם ולא קוד.
   */
  async sendToOwner(
    propertyId: string,
    range: OwnerActivityRange,
    input: { channel: OwnerReportChannel; periodLabel: string },
  ): Promise<OwnerReportSentDto> {
    const tenantId = TenantContext.current().tenantId;
    const { appointments, calls, truncated } = await this.collect(propertyId, range);
    const entries = buildOwnerActivity({ appointments, calls });

    const context = await this.prisma.withTenant(async (tx) => {
      const property = await tx.property.findFirst({
        where: { id: propertyId, tenantId, deletedAt: null },
        select: {
          marketingTitle: true,
          street: true,
          houseNumber: true,
          city: true,
          ownerContactId: true,
        },
      });
      if (!property) throw new NotFoundException("נכס לא נמצא");
      const tenant = await tx.tenant.findFirst({
        where: { id: tenantId },
        select: { name: true },
      });
      const owner = property.ownerContactId
        ? await tx.contact.findFirst({
            where: { id: property.ownerContactId, tenantId },
            select: { nameEncrypted: true, phoneEncrypted: true, emailEncrypted: true },
          })
        : null;
      return { property, officeName: tenant?.name ?? "המשרד", owner };
    });

    if (context.owner === null) {
      throw new BadRequestException("לכרטיס הנכס לא משויך בעל נכס — אין למי לשלוח");
    }
    const ownerName = this.safeDecrypt(context.owner.nameEncrypted);
    /*
     * ‏אותה תווית שהמסך מציג: כותרת שיווקית אם יש, אחרת הכתובת.
     * שתי נוסחאות שונות היו נותנות דוח שכותרתו אינה הנכס שהמתווך
     * ראה על המסך כשלחץ.
     */
    const propertyLabel =
      context.property.marketingTitle ??
      [
        [context.property.street, context.property.houseNumber].filter(Boolean).join(" "),
        context.property.city,
      ]
        .filter((part) => part !== undefined && part !== "")
        .join(", ") ??
      "הנכס";

    const sent =
      input.channel === "whatsapp"
        ? await this.sendWhatsApp({
            tenantId,
            phone: this.safeDecrypt(context.owner.phoneEncrypted),
            body: ownerActivityText({
              propertyLabel,
              officeName: context.officeName,
              periodLabel: input.periodLabel,
              entries,
              ...(truncated ? { truncated: true } : {}),
              now: new Date(),
            }),
          })
        : await this.sendEmail({
            tenantId,
            to: this.safeDecrypt(context.owner.emailEncrypted),
            propertyLabel,
            officeName: context.officeName,
            periodLabel: input.periodLabel,
            ...(ownerName === undefined ? {} : { ownerName }),
            entries,
            truncated,
          });

    await this.prisma.withTenant((tx) =>
      this.audit.record(tx, {
        action: "property.activity_sent",
        entityType: "property",
        entityId: propertyId,
        metadata: { channel: input.channel, count: entries.length, truncated },
      }),
    );

    return {
      channel: input.channel,
      to: ownerName ?? sent,
      count: entries.length,
      truncated,
    };
  }

  /** ‏`false` מ-Meta הוא כישלון שנאמר, לא ✓ שקרי. */
  private async sendWhatsApp(input: {
    tenantId: string;
    phone?: string;
    body: string;
  }): Promise<string> {
    if (input.phone === undefined) {
      throw new BadRequestException("אין טלפון בכרטיס בעל הנכס — אי אפשר לשלוח בוואטסאפ");
    }
    const result = await this.whatsapp.sendAsTenant(input.tenantId, input.phone, input.body);
    if (result === "no_connection") {
      throw new BadRequestException(
        "הוואטסאפ של המשרד אינו מחובר — אפשר להעתיק את ההודעה ולשלוח ידנית",
      );
    }
    if (result === "rejected") {
      throw new BadRequestException(
        "וואטסאפ לא קיבל את ההודעה. הודעה חופשית מותרת רק בתוך 24 שעות מפנייה של בעל הנכס — אפשר להעתיק ולשלוח ידנית",
      );
    }
    return input.phone;
  }

  /**
   * ‏`required: true` — כישלון נזרק ואינו נרשם ביומן בלבד.
   *
   * הקובץ מצורף **וגם** הרשימה בגוף: בעל נכס פותח מייל בטלפון ואינו
   * מוריד CSV, ומייל שכל תוכנו „ראו קובץ מצורף” הוא מייל שלא נקרא.
   */
  private async sendEmail(input: {
    tenantId: string;
    to?: string;
    propertyLabel: string;
    officeName: string;
    periodLabel: string;
    ownerName?: string;
    entries: ReturnType<typeof buildOwnerActivity>;
    truncated: boolean;
  }): Promise<string> {
    if (input.to === undefined) {
      throw new BadRequestException("אין אימייל בכרטיס בעל הנכס — אפשר להוסיף אותו ולשלוח שוב");
    }
    const mail = ownerActivityEmail({
      propertyLabel: input.propertyLabel,
      officeName: input.officeName,
      periodLabel: input.periodLabel,
      ...(input.ownerName === undefined ? {} : { ownerName: input.ownerName }),
      entries: input.entries,
      ...(input.truncated ? { truncated: true } : {}),
      now: new Date(),
    });
    await this.email.send(
      input.to,
      mail.subject,
      {
        heading: mail.heading,
        ...(mail.greeting === undefined ? {} : { greeting: mail.greeting }),
        paragraphs: mail.paragraphs,
        footnote: mail.footnote,
      },
      {
        required: true,
        tenantId: input.tenantId,
        attachments: [
          {
            name: ownerActivityFileName(input.propertyLabel),
            contentType: "text/csv; charset=utf-8",
            content: Buffer.from(
              ownerActivityCsv(input.entries, { truncated: input.truncated }),
              "utf8",
            ),
          },
        ],
      },
    );
    return input.to;
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
        take: MAX_ROWS + 1,
      });
      const appointmentsTruncated = appointmentRows.length > MAX_ROWS;
      const appointments = appointmentRows.slice(0, MAX_ROWS);

      /*
       * העוגנים נלקחים מהשורות **שיוצגו** ולא מהשלף המורחב: שיחה
       * שנקשרה לפגישה שנחתכה מהדוח אינה אמורה להופיע בו לבדה.
       */
      const appointmentIds = appointments.map((row) => row.id);
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
        take: MAX_ROWS + 1,
      });

      return {
        appointments: appointments.map((row) => ({
          kind: row.kind,
          startsAt: row.startsAt,
          status: row.status,
          outcome: row.outcome,
        })),
        calls: callRows.slice(0, MAX_ROWS),
        truncated: appointmentsTruncated || callRows.length > MAX_ROWS,
      };
    });
  }
}
