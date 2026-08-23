import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ulid } from "ulid";
import {
  AUTO_MARKETING_SOURCES,
  MARKETING_ACTION_KINDS,
  describeExclusivity,
  exclusivityRejectionReason,
  exclusivityState,
  type AutoMarketingSource,
  type ExclusivityPhase,
  type ExclusivitySubject,
  type MarketingActionKind,
} from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { AuditService } from "../../core/audit.service";
import { PrismaService, type TenantTx } from "../../core/prisma.service";

/**
 * תיק הבלעדיות.
 *
 * שני דברים שהמערכת לא ידעה קודם: **מתי הבלעדיות נגמרת**, ו**האם
 * היא כבר נגמרה בלי שאיש שם לב** — כלל השליש שבסעיף 9(ב2). ההיגיון
 * עצמו יושב ב-packages/shared (exclusivity.ts), כולל התקרות שבחוק;
 * כאן רק הקריאה מהמסד והכתיבה אליו.
 *
 * ## הזיהוי האוטומטי הוא העיקר
 *
 * פעולת שיווק שדורשת מהסוכן לזכור לתעד אותה — לא תתועד, וכלל השליש
 * יפיל בלעדיות שבפועל שווקה כראוי. לכן שלוש פעולות נרשמות מעצמן
 * מתוך הזרימות הקיימות (`recordAuto`), ורק מה שהמערכת אינה יכולה
 * לדעת — שילוט, עיתון — נרשם ידנית.
 */

export interface MarketingActionDto {
  id: string;
  kind: MarketingActionKind;
  source: "auto" | "manual";
  detail?: string;
  evidenceUrl?: string;
  brokerCount?: number;
  performedAt: string;
}

export interface ExclusivityDto {
  id: string;
  propertyId: string;
  subject: ExclusivitySubject;
  startsAt: string;
  endsAt: string;
  agreedCustomAction: boolean;
  agreementId?: string;
  endedAt?: string;
  endReason?: string;
  /** המצב המחושב — הלב של המסך. */
  phase: ExclusivityPhase;
  thirdAt: string;
  effectiveEndsAt: string;
  daysLeft: number;
  daysToThird: number | null;
  counted: MarketingActionKind[];
  missing: number;
  summary: string;
  actions: MarketingActionDto[];
}

/** שורה ברשימה המרוכזת — בלי הפעולות עצמן. */
export interface ExclusivityListItem {
  id: string;
  propertyId: string;
  propertyTitle: string;
  phase: ExclusivityPhase;
  effectiveEndsAt: string;
  daysLeft: number;
  missing: number;
  summary: string;
}

type ExclusivityRow = {
  id: string;
  propertyId: string;
  subject: string;
  startsAt: Date;
  endsAt: Date;
  agreedCustomAction: boolean;
  agreementId: string | null;
  endedAt: Date | null;
  endReason: string | null;
};

type ActionRow = {
  id: string;
  kind: string;
  source: string;
  detail: string | null;
  evidenceUrl: string | null;
  brokerCount: number | null;
  performedAt: Date;
};

@Injectable()
export class ExclusivityService {
  private readonly logger = new Logger(ExclusivityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** הבלעדיות הפתוחה של הנכס, או `null` כשאין. */
  async current(propertyId: string): Promise<ExclusivityDto | null> {
    return this.prisma.withTenant(async (tx) => {
      const row = await tx.propertyExclusivity.findFirst({
        where: { propertyId, endedAt: null },
      });
      if (!row) return null;
      return this.toDto(tx, row);
    });
  }

  /**
   * פתיחת תקופת בלעדיות.
   *
   * תקופה קודמת שעדיין פתוחה נסגרת כאן במפורש (`replaced`), ולא
   * נמחקת: היא ההיסטוריה שמסבירה מה שווק ומתי. האינדקס הייחודי
   * החלקי מבטיח שגם אם שתי בקשות ירוצו יחד, רק אחת תיפתח.
   */
  async start(
    propertyId: string,
    input: {
      subject: ExclusivitySubject;
      startsAt: Date;
      endsAt: Date;
      agreedCustomAction: boolean;
      agreementId?: string;
    },
  ): Promise<ExclusivityDto> {
    const ctx = TenantContext.current();
    const problem = exclusivityRejectionReason(input);
    if (problem) throw new BadRequestException(problem);

    return this.prisma.withTenant(async (tx) => {
      const property = await tx.property.findFirst({
        where: { id: propertyId, tenantId: ctx.tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!property) throw new NotFoundException("הנכס לא נמצא");

      await tx.propertyExclusivity.updateMany({
        where: { propertyId, endedAt: null },
        data: { endedAt: new Date(), endReason: "replaced" },
      });

      const id = ulid();
      const row = await tx.propertyExclusivity.create({
        data: {
          id,
          tenantId: ctx.tenantId,
          propertyId,
          subject: input.subject,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          agreedCustomAction: input.agreedCustomAction,
          agreementId: input.agreementId ?? null,
          createdBy: ctx.userId,
        },
      });
      await this.syncPropertyCache(tx, propertyId, input.endsAt);
      await this.audit.record(tx, {
        action: "exclusivity.start",
        entityType: "property",
        entityId: propertyId,
        metadata: { exclusivityId: id, subject: input.subject, endsAt: input.endsAt.toISOString() },
      });
      return this.toDto(tx, row);
    });
  }

  /** סגירה מוקדמת — הנכס נמכר, הלקוח ביטל, או שהתקופה פשוט תמה. */
  async end(exclusivityId: string, reason: "cancelled" | "sold" | "expired"): Promise<void> {
    await this.prisma.withTenant(async (tx) => {
      const row = await tx.propertyExclusivity.findFirst({
        where: { id: exclusivityId, endedAt: null },
        select: { id: true, propertyId: true },
      });
      if (!row) throw new NotFoundException("הבלעדיות לא נמצאה או שכבר הסתיימה");
      await tx.propertyExclusivity.updateMany({
        where: { id: exclusivityId, endedAt: null },
        data: { endedAt: new Date(), endReason: reason },
      });
      await this.syncPropertyCache(tx, row.propertyId, null);
      await this.audit.record(tx, {
        action: "exclusivity.end",
        entityType: "property",
        entityId: row.propertyId,
        metadata: { exclusivityId, reason },
      });
    });
  }

  /** רישום ידני של פעולת שיווק — שילוט, מודעה בעיתון, אסמכתה. */
  async logAction(
    propertyId: string,
    input: {
      kind: MarketingActionKind;
      performedAt: Date;
      detail?: string;
      evidenceUrl?: string;
      brokerCount?: number;
    },
  ): Promise<ExclusivityDto> {
    const ctx = TenantContext.current();
    if (!MARKETING_ACTION_KINDS.includes(input.kind)) {
      throw new BadRequestException("סוג פעולת שיווק לא מוכר");
    }
    return this.prisma.withTenant(async (tx) => {
      const row = await tx.propertyExclusivity.findFirst({
        where: { propertyId, endedAt: null },
      });
      if (!row) throw new NotFoundException("אין בלעדיות פעילה על הנכס");
      if (input.performedAt.getTime() < row.startsAt.getTime()) {
        throw new BadRequestException("פעולה שקדמה לתחילת הבלעדיות אינה נספרת בתקופה הזו");
      }
      await tx.marketingAction.create({
        data: {
          id: ulid(),
          tenantId: ctx.tenantId,
          exclusivityId: row.id,
          propertyId,
          kind: input.kind,
          source: "manual",
          detail: input.detail ?? null,
          evidenceUrl: input.evidenceUrl ?? null,
          brokerCount: input.brokerCount ?? null,
          performedAt: input.performedAt,
          createdBy: ctx.userId,
        },
      });
      await this.audit.record(tx, {
        action: "exclusivity.action_logged",
        entityType: "property",
        entityId: propertyId,
        metadata: { exclusivityId: row.id, kind: input.kind },
      });
      return this.toDto(tx, row);
    });
  }

  async removeAction(actionId: string): Promise<void> {
    await this.prisma.withTenant(async (tx) => {
      const row = await tx.marketingAction.findFirst({
        where: { id: actionId },
        select: { id: true, propertyId: true, source: true },
      });
      if (!row) throw new NotFoundException("הפעולה לא נמצאה");
      /*
       * פעולה שהמערכת רשמה מעצמה אינה נמחקת ידנית: היא משקפת משהו
       * שקרה באמת (הצעה נשלחה, סיור נקבע), ומחיקתה הופכת את התיק
       * לפחות מדויק בדיוק במקום שבו הוא אמור לשמש ראיה.
       */
      if (row.source === "auto") {
        throw new BadRequestException("פעולה שנרשמה אוטומטית משקפת אירוע במערכת ואינה נמחקת");
      }
      await tx.marketingAction.deleteMany({ where: { id: actionId } });
      await this.audit.record(tx, {
        action: "exclusivity.action_removed",
        entityType: "property",
        entityId: row.propertyId,
        metadata: { actionId },
      });
    });
  }

  /**
   * רישום אוטומטי מתוך זרימה קיימת.
   *
   * נקרא **בתוך** הטרנזקציה של הפעולה המקורית, ולכן אינו זורק: נכס
   * בלי בלעדיות הוא המצב הרגיל, ושליחת הצעה לא תיכשל מפני שאין מה
   * לתעד. גם התנגשות באינדקס הייחודי נבלעת — היא בדיוק מה שהוא נועד
   * למנוע, ואירוע שמעובד פעמיים אינו שגיאה של המשתמש.
   */
  async recordAuto(
    tx: TenantTx,
    propertyId: string,
    source: AutoMarketingSource,
    input: { sourceKey: string; performedAt: Date; detail?: string; brokerCount?: number },
  ): Promise<void> {
    try {
      const row = await tx.propertyExclusivity.findFirst({
        where: { propertyId, endedAt: null },
        select: { id: true, tenantId: true, startsAt: true },
      });
      if (!row) return;
      if (input.performedAt.getTime() < row.startsAt.getTime()) return;
      await tx.marketingAction.createMany({
        data: [
          {
            id: ulid(),
            tenantId: row.tenantId,
            exclusivityId: row.id,
            propertyId,
            kind: AUTO_MARKETING_SOURCES[source],
            source: "auto",
            sourceKey: input.sourceKey,
            detail: input.detail ?? null,
            brokerCount: input.brokerCount ?? null,
            performedAt: input.performedAt,
          },
        ],
        skipDuplicates: true,
      });
    } catch (error: unknown) {
      this.logger.warn(`רישום פעולת שיווק אוטומטית נכשל (${propertyId}): ${String(error)}`);
    }
  }

  /**
   * הבלעדיויות הפתוחות של המשרד, הדחוף קודם.
   *
   * המיון הוא לפי `daysLeft` המחושב ולא לפי `ends_at` שבמסד: בלעדיות
   * שכלל השליש כבר סיים אותה דחופה יותר מזו שנגמרת בעוד שבוע, וגם
   * אם התאריך בחוזה שלה רחוק יותר.
   */
  async list(): Promise<ExclusivityListItem[]> {
    const tenantId = TenantContext.current().tenantId;
    return this.prisma.withTenant(async (tx) => {
      /*
       * הדחיפות מחושבת **לפני** החיתוך ולא אחריו.
       *
       * מיון לפי `ends_at` וחיתוך ל-200 היה משאיר בחוץ בלעדיות ארוכה
       * שמועד השליש שלה כבר מחר, לטובת בלעדיויות קצרות ורגועות ממנה
       * — והיא לא הייתה מופיעה במסך כלל (ביקורת Codex). לכן המיון
       * ב-SQL הוא לפי הסיום האפקטיבי: המוקדם מבין הסיום שבהסכם ומועד
       * השליש.
       *
       * החישוב כאן הוא לצורך **הסדר** בלבד; הערך המדויק נגזר אחר כך
       * מ-`exclusivityState`, שהוא המקום היחיד שבו הכלל חי.
       */
      const ordered = await tx.$queryRaw<{ id: string }[]>`
        SELECT id
          FROM property_exclusivities
         WHERE tenant_id = ${tenantId}
           AND ended_at IS NULL
         ORDER BY LEAST(ends_at, starts_at + ((ends_at - starts_at) / 3)) ASC
         LIMIT 200
      `;
      if (ordered.length === 0) return [];
      const rows = await tx.propertyExclusivity.findMany({
        where: { id: { in: ordered.map((r) => r.id) } },
      });
      if (rows.length === 0) return [];

      const properties = await tx.property.findMany({
        where: { id: { in: rows.map((r) => r.propertyId) } },
        select: { id: true, marketingTitle: true, city: true, street: true },
      });
      const titles = new Map(
        properties.map((p) => [
          p.id,
          p.marketingTitle ?? [p.street, p.city].filter(Boolean).join(", ") ?? "נכס",
        ]),
      );

      const actions = await tx.marketingAction.findMany({
        where: { exclusivityId: { in: rows.map((r) => r.id) } },
        select: { exclusivityId: true, kind: true, performedAt: true, brokerCount: true },
      });
      const byExclusivity = new Map<string, typeof actions>();
      for (const action of actions) {
        const list = byExclusivity.get(action.exclusivityId) ?? [];
        list.push(action);
        byExclusivity.set(action.exclusivityId, list);
      }

      const now = new Date();
      const items = rows.map((row) => {
        const state = exclusivityState(
          this.toPeriod(row),
          (byExclusivity.get(row.id) ?? []).map((a) => ({
            kind: a.kind as MarketingActionKind,
            performedAt: a.performedAt,
            ...(a.brokerCount === null ? {} : { brokerCount: a.brokerCount }),
          })),
          now,
        );
        return {
          id: row.id,
          propertyId: row.propertyId,
          propertyTitle: titles.get(row.propertyId) ?? "נכס",
          phase: state.phase,
          effectiveEndsAt: state.effectiveEndsAt.toISOString(),
          daysLeft: state.daysLeft,
          missing: state.missing,
          summary: describeExclusivity(state),
        };
      });
      items.sort((a, b) => a.daysLeft - b.daysLeft);
      return items;
    });
  }

  /* ============================================================
     פנימי
     ============================================================ */

  private toPeriod(row: ExclusivityRow) {
    return {
      subject: row.subject as ExclusivitySubject,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      agreedCustomAction: row.agreedCustomAction,
    };
  }

  private async toDto(tx: TenantTx, row: ExclusivityRow): Promise<ExclusivityDto> {
    const actions: ActionRow[] = await tx.marketingAction.findMany({
      where: { exclusivityId: row.id },
      orderBy: { performedAt: "desc" },
      select: {
        id: true,
        kind: true,
        source: true,
        detail: true,
        evidenceUrl: true,
        brokerCount: true,
        performedAt: true,
      },
    });

    const state = exclusivityState(
      this.toPeriod(row),
      actions.map((a) => ({
        kind: a.kind as MarketingActionKind,
        performedAt: a.performedAt,
        ...(a.brokerCount === null ? {} : { brokerCount: a.brokerCount }),
      })),
      new Date(),
    );

    return {
      id: row.id,
      propertyId: row.propertyId,
      subject: row.subject as ExclusivitySubject,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      agreedCustomAction: row.agreedCustomAction,
      ...(row.agreementId === null ? {} : { agreementId: row.agreementId }),
      ...(row.endedAt === null ? {} : { endedAt: row.endedAt.toISOString() }),
      ...(row.endReason === null ? {} : { endReason: row.endReason }),
      phase: state.phase,
      thirdAt: state.thirdAt.toISOString(),
      effectiveEndsAt: state.effectiveEndsAt.toISOString(),
      daysLeft: state.daysLeft,
      daysToThird: state.daysToThird,
      counted: state.counted,
      missing: state.missing,
      summary: describeExclusivity(state),
      actions: actions.map((a) => ({
        id: a.id,
        kind: a.kind as MarketingActionKind,
        source: a.source as "auto" | "manual",
        ...(a.detail === null ? {} : { detail: a.detail }),
        ...(a.evidenceUrl === null ? {} : { evidenceUrl: a.evidenceUrl }),
        ...(a.brokerCount === null ? {} : { brokerCount: a.brokerCount }),
        performedAt: a.performedAt.toISOString(),
      })),
    };
  }

  /**
   * `properties.exclusive/exclusive_until` נשארים כמטמון.
   *
   * הם קיימים בסכמה מהיום הראשון, נכתבים בעריכת נכס, ומשמשים
   * לרשימות ולייצוא. האמת עברה לטבלת התקופות — אבל השארתם מסונכרנים
   * זולה, ומונעת שני מספרים שונים לאותה שאלה.
   */
  private async syncPropertyCache(
    tx: TenantTx,
    propertyId: string,
    endsAt: Date | null,
  ): Promise<void> {
    await tx.property.updateMany({
      where: { id: propertyId },
      data: { exclusive: endsAt !== null, exclusiveUntil: endsAt },
    });
  }
}

