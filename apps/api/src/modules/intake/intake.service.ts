import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { ulid } from "ulid";
import type { Prisma } from "@prisma/client";
import {
  applyIntakeAnswers,
  describeIntakeChanges,
  intakeExpiryFrom,
  intakeInactiveReason,
  intakeInviteMessage,
  type IntakeAnswers,
  type IntakeStatus,
  type IntakeSubject,
} from "@metavchim/shared";
import { loadEnv } from "../../config/env";
import { TenantContext } from "../../common/tenant-context";
import { AuditService } from "../../core/audit.service";
import { PrismaService, type TenantTx } from "../../core/prisma.service";
import { ContactsService } from "../contacts/contacts.service";

/**
 * טופס הדרישות שהלקוח ממלא בעצמו.
 *
 * ## שני מסלולים, מנגנון אחד
 *
 * המתווך לוחץ „בקשו מהלקוח למלא”, או ששיחה נכנסת לא נענתה והמערכת
 * שולחת מעצמה. שניהם יוצרים אותה בקשה ואותו קישור; ההבדל היחיד
 * הוא `channel`, ומה שהוא משנה הוא **נוסח הפתיחה** של ההודעה —
 * „ניסינו להשיג אתכם” אינו קישוט, בלעדיו הודעה שמגיעה דקה אחרי
 * שיחה שלא נענתה נקראת כספאם.
 *
 * ## הגבול הציבורי
 *
 * הטוקן פותח **שורה אחת בטבלה אחת** (`withPublicIntake`). ממנה
 * נגזר הדייר, וכל השאר — שם המשרד, שם הלקוח, הדרישות והכתיבה —
 * רץ תחת `withExplicitTenant`, כלומר תחת RLS מלא. פוליסת כתיבה
 * ציבורית על `buyers` הייתה מקצרת את הדרך ומרחיבה את מה שטעות
 * אחת בפוליסה יכולה לחשוף.
 *
 * ## מה חוזר לעמוד הציבורי
 *
 * שם המשרד, השם הפרטי של הלקוח, והדרישות **שלו**. שום דבר אחר:
 * לא הטלפון שלו, לא מזהי הכרטיסים, ולא פרט של אף לקוח אחר. מי
 * שמצא קישור ברחוב רואה טופס, לא מאגר.
 */

/** מבט הלקוח. `inactive` = הקישור לא פעיל, ואז אין `prefill`. */
export interface IntakePublicView {
  officeName: string;
  /** השם הפרטי בלבד — „שלום דנה”, בלי שם משפחה ובלי טלפון. */
  greetingName: string;
  status: IntakeStatus;
  inactive: "revoked" | "expired" | null;
  /** הדרישות הידועות, כדי שהלקוח יתקן ולא יתחיל מאפס. */
  prefill: IntakeAnswers;
  submittedAt: string | null;
}

/** שורת בקשה כפי שהיא מוצגת בכרטיס. */
export interface IntakeRequestDto {
  id: string;
  url: string;
  status: IntakeStatus;
  channel: string;
  expiresAt: Date;
  openedAt: Date | null;
  submittedAt: Date | null;
  createdAt: Date;
  /** קישור wa.me מוכן לשליחה — הנוסח כבר בפנים. */
  waUrl: string | null;
}

/** מה נשמר על הבקשה. מצומצם — הצד הציבורי אינו זקוק ליותר. */
interface TokenRow {
  id: string;
  tenantId: string;
  subject: string;
  subjectId: string;
  contactId: string;
  status: string;
  expiresAt: Date;
}

@Injectable()
export class IntakeService {
  private readonly logger = new Logger(IntakeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly contacts: ContactsService,
  ) {}

  /* ================= הצד הפנימי — המתווך ================= */

  /**
   * קישור לכרטיס. מחזירה קישור פעיל קיים במקום ליצור חדש.
   *
   * שני קישורים פעילים לאותו כרטיס הם שני טפסים שהלקוח יכול למלא,
   * ואז „מי מהם קובע” הופך לשאלה שאין לה תשובה טובה. מי שרוצה
   * להתחיל מחדש מבטל את הקיים.
   */
  async ensure(subject: IntakeSubject, subjectId: string): Promise<IntakeRequestDto> {
    const ctx = TenantContext.current();
    const now = new Date();
    return this.prisma.withTenant(async (tx) => {
      const contactId = await this.contactOf(tx, subject, subjectId);

      const existing = await tx.intakeRequest.findFirst({
        where: {
          tenantId: ctx.tenantId,
          subject,
          subjectId,
          status: { not: "revoked" },
          expiresAt: { gt: now },
        },
        orderBy: { createdAt: "desc" },
      });
      if (existing !== null) return this.toDto(tx, existing);

      const row = await tx.intakeRequest.create({
        data: {
          id: ulid(),
          tenantId: ctx.tenantId,
          token: freshToken(),
          subject,
          subjectId,
          contactId,
          channel: "manual",
          createdBy: ctx.userId,
          expiresAt: intakeExpiryFrom(now),
        },
      });
      await this.audit.record(tx, {
        action: "intake.create",
        entityType: subject,
        entityId: subjectId,
        metadata: { channel: "manual" },
      });
      return this.toDto(tx, row);
    });
  }

  /** כל הבקשות של הכרטיס — החדשה ראשונה. */
  async listFor(subject: IntakeSubject, subjectId: string): Promise<IntakeRequestDto[]> {
    const ctx = TenantContext.current();
    return this.prisma.withTenant(async (tx) => {
      const rows = await tx.intakeRequest.findMany({
        where: { tenantId: ctx.tenantId, subject, subjectId },
        orderBy: { createdAt: "desc" },
        take: 20,
      });
      const out: IntakeRequestDto[] = [];
      for (const row of rows) out.push(await this.toDto(tx, row));
      return out;
    });
  }

  /** ביטול — הקישור מפסיק לעבוד מיידית. */
  async revoke(id: string): Promise<void> {
    const ctx = TenantContext.current();
    await this.prisma.withTenant(async (tx) => {
      const updated = await tx.intakeRequest.updateMany({
        where: { id, tenantId: ctx.tenantId, status: { not: "revoked" } },
        data: { status: "revoked" },
      });
      if (updated.count === 0) throw new NotFoundException("הבקשה לא נמצאה");
      await this.audit.record(tx, {
        action: "intake.revoke",
        entityType: "intake",
        entityId: id,
      });
    });
  }

  /* ================= הצד הציבורי — הלקוח ================= */

  async publicView(token: string): Promise<IntakePublicView> {
    const row = await this.resolveToken(token);
    return this.prisma.withExplicitTenant(row.tenantId, async (tx) => {
      const officeName = await this.officeName(tx, row.tenantId);
      const contact = await this.contacts.getById(tx, row.contactId);
      const inactive = intakeInactiveReason(
        row.status as IntakeStatus,
        row.expiresAt,
        new Date(),
      );

      /*
       * קישור שאינו פעיל אינו מחזיר את הדרישות. מי שמחזיק קישור
       * שפג או בוטל אינו אמור להמשיך לראות מה נאסף על הלקוח —
       * ותוקף שפג שממשיך לחשוף מידע אינו תוקף.
       */
      if (inactive !== null) {
        return {
          officeName,
          greetingName: firstName(contact?.name),
          status: row.status as IntakeStatus,
          inactive,
          prefill: {},
          submittedAt: null,
        };
      }

      // הפתיחה נרשמת, אבל רק פעם אחת — „נפתח” לא הופך ל„נפתח שוב”
      if (row.status === "sent") {
        await tx.intakeRequest.updateMany({
          where: { id: row.id, status: "sent" },
          data: { status: "opened", openedAt: new Date() },
        });
      }

      const current = await this.currentRequirements(
        tx,
        row,
        await this.targetBuyerId(tx, row),
      );
      const full = await tx.intakeRequest.findUnique({
        where: { id: row.id },
        select: { status: true, submittedAt: true },
      });
      return {
        officeName,
        greetingName: firstName(contact?.name),
        status: (full?.status ?? row.status) as IntakeStatus,
        inactive: null,
        prefill: toAnswers(current),
        submittedAt: full?.submittedAt?.toISOString() ?? null,
      };
    });
  }

  /**
   * הלקוח שלח.
   *
   * המיזוג ב-`applyIntakeAnswers` ולא כאן: הכלל „מה שהטופס אינו
   * שואל — נשאר” הוא לוגיקה טהורה, והוא נבדק ביחידה. כאן רק
   * ההרכבה — מה נטען, מה נכתב, ומי מקבל התראה.
   */
  async submit(token: string, answers: IntakeAnswers): Promise<{ ok: true }> {
    const row = await this.resolveToken(token);
    const inactive = intakeInactiveReason(
      row.status as IntakeStatus,
      row.expiresAt,
      new Date(),
    );
    if (inactive !== null) {
      throw new BadRequestException(
        inactive === "expired" ? "הקישור פג תוקף" : "הקישור בוטל",
      );
    }

    await this.prisma.withExplicitTenant(row.tenantId, async (tx) => {
      /*
       * **אותו כרטיס שממנו נשאב הטופס הוא הכרטיס שנכתב.**
       *
       * הבדל בין השניים הוא התקלה שקל ליפול בה כאן: טופס שנפתח עם
       * הדרישות של הקונה, והלקוח מתקן אותן, ואז השמירה הולכת למקום
       * אחר — כלומר הלקוח רואה את התיקון שלו נעלם. לכן היעד נקבע
       * פעם אחת ומשמש את שני הצדדים.
       */
      const targetBuyerId = await this.targetBuyerId(tx, row);
      const before = await this.currentRequirements(tx, row, targetBuyerId);
      const after = applyIntakeAnswers(before, answers);
      const changed = describeIntakeChanges(before, after);

      if (targetBuyerId !== null) {
        await tx.buyer.updateMany({
          where: { id: targetBuyerId, tenantId: row.tenantId, deletedAt: null },
          data: { requirements: after as Prisma.InputJsonValue },
        });
      }

      await tx.intakeRequest.update({
        where: { id: row.id },
        data: {
          status: "submitted",
          submittedAt: new Date(),
          answers: answers as unknown as Prisma.InputJsonValue,
        },
      });

      /*
       * ליד אינו נושא דרישות — הן שדה של קונה. התשובות נשמרות על
       * הבקשה, וההתראה מזמינה להמיר בלחיצה; ההמרה עצמה נשארת
       * החלטה של המתווך. המרה אוטומטית הייתה פותחת כרטיס קונה לכל
       * מי שמילא טופס, כולל מי שהתקשר בטעות — ו-`convertFromLead`
       * גם נופלת כשלאיש הקשר כבר יש קונה פעיל.
       */
      await tx.notification.create({
        data: {
          id: ulid(),
          tenantId: row.tenantId,
          userId: null,
          type: "intake_submitted",
          title: "הלקוח מילא את טופס הדרישות",
          /*
           * הגוף מתאר את מה שבאמת קרה, ולא את מה שהיה נחמד לומר:
           * ליד בלי כרטיס קונה **לא** עודכן, ואמירה „עודכן” עליו
           * הייתה שולחת את המתווך לחפש שינוי שאינו קיים.
           */
          body:
            targetBuyerId === null
              ? "הדרישות נשמרו בבקשה — המירו את הליד לקונה כדי שייכנסו לכרטיס"
              : changed.length > 0
                ? `עודכן: ${changed.join(", ")}`
                : "לא היו שינויים לעומת מה שהיה בכרטיס",
          entityType: row.subject,
          entityId: row.subjectId,
        },
      });

      await this.audit.record(tx, {
        action: "intake.submit",
        entityType: row.subject,
        entityId: row.subjectId,
        // רק שמות שדות — לא מה שנכתב בהם
        metadata: { changed },
      });
    });

    return { ok: true };
  }

  /* ================= האוטומציה — שיחה שלא נענתה ================= */

  /**
   * בקשה שנוצרת מעצמה אחרי שיחה נכנסת שלא נענתה.
   *
   * רצה תחת הקשר דייר מפורש (הקוראת היא קליטת הוובהוק, שאין בה
   * משתמש מחובר), ומחזירה את הקישור ואת נוסח ההודעה — או `null`
   * כשכבר יש בקשה פעילה. לקוח שהתקשר שלוש פעמים ולא נענה אינו
   * אמור לקבל שלוש הודעות זהות.
   */
  async ensureForMissedCall(
    tx: TenantTx,
    tenantId: string,
    subject: IntakeSubject,
    subjectId: string,
    contactId: string,
  ): Promise<{ url: string; message: string } | null> {
    const now = new Date();
    const existing = await tx.intakeRequest.findFirst({
      where: {
        tenantId,
        subject,
        subjectId,
        status: { not: "revoked" },
        expiresAt: { gt: now },
      },
      select: { id: true },
    });
    if (existing !== null) return null;

    const token = freshToken();
    await tx.intakeRequest.create({
      data: {
        id: ulid(),
        tenantId,
        token,
        subject,
        subjectId,
        contactId,
        channel: "missed_call",
        createdBy: null,
        expiresAt: intakeExpiryFrom(now),
      },
    });

    const officeName = await this.officeName(tx, tenantId);
    const url = publicUrl(token);
    return {
      url,
      message: intakeInviteMessage({ officeName, url, missedCall: true }),
    };
  }

  /* ================= פנימי ================= */

  /**
   * הטוקן → השורה. `withPublicIntake` בלבד, ובלי הקשר דייר.
   *
   * טוקן שאינו קיים וטוקן של משרד אחר מחזירים את אותה שגיאה: מבקר
   * מזדמן לא אמור ללמוד מהתשובה אם הקישור היה קיים אי פעם.
   */
  private async resolveToken(token: string): Promise<TokenRow> {
    const row = await this.prisma.withPublicIntake(token, (tx) =>
      tx.intakeRequest.findFirst({
        where: { token },
        select: {
          id: true,
          tenantId: true,
          subject: true,
          subjectId: true,
          contactId: true,
          status: true,
          expiresAt: true,
        },
      }),
    );
    if (row === null) throw new NotFoundException("הטופס לא נמצא");
    return row;
  }

  /** איש הקשר של הכרטיס, ואימות שהכרטיס בכלל קיים ושייך למשרד. */
  private async contactOf(
    tx: TenantTx,
    subject: IntakeSubject,
    subjectId: string,
  ): Promise<string> {
    const tenantId = TenantContext.current().tenantId;
    if (subject === "buyer") {
      const buyer = await tx.buyer.findFirst({
        where: { id: subjectId, tenantId, deletedAt: null },
        select: { contactId: true },
      });
      if (buyer === null) throw new NotFoundException("קונה לא נמצא");
      return buyer.contactId;
    }
    const lead = await tx.lead.findFirst({
      where: { id: subjectId, tenantId },
      select: { contactId: true },
    });
    if (lead === null) throw new NotFoundException("ליד לא נמצא");
    return lead.contactId;
  }

  /**
   * הכרטיס שהטופס קורא ממנו וכותב אליו, או `null` כשאין כזה.
   *
   * לליד אין דרישות משלו — הן שדה של קונה. לכן ליד שאיש הקשר שלו
   * כבר לקוח פעיל של המשרד מצביע על הקונה ההוא: מי שכבר לקוח לא
   * אמור למלא מאפס טופס שנשלח אליו מליד חדש, ומה שימלא צריך
   * להיכנס לכרטיס שכבר קיים. אין קונה ⇒ `null`, והתשובות נשמרות
   * על הבקשה עד שהמתווך ימיר.
   */
  private async targetBuyerId(tx: TenantTx, row: TokenRow): Promise<string | null> {
    const buyer = await tx.buyer.findFirst({
      where: {
        tenantId: row.tenantId,
        deletedAt: null,
        ...(row.subject === "buyer"
          ? { id: row.subjectId }
          : { contactId: row.contactId }),
      },
      select: { id: true },
    });
    return buyer?.id ?? null;
  }

  /** הדרישות הידועות כרגע, מהכרטיס שנקבע ב-`targetBuyerId`. */
  private async currentRequirements(
    tx: TenantTx,
    row: TokenRow,
    buyerId: string | null,
  ): Promise<Record<string, unknown>> {
    if (buyerId === null) return {};
    const buyer = await tx.buyer.findFirst({
      where: { id: buyerId, tenantId: row.tenantId, deletedAt: null },
      select: { requirements: true },
    });
    const raw = buyer?.requirements;
    return typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  }

  private async officeName(tx: TenantTx, tenantId: string): Promise<string> {
    const tenant = await tx.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true },
    });
    return tenant?.name ?? "המשרד";
  }

  private async toDto(
    tx: TenantTx,
    row: {
      id: string;
      token: string;
      status: string;
      channel: string;
      contactId: string;
      expiresAt: Date;
      openedAt: Date | null;
      submittedAt: Date | null;
      createdAt: Date;
      tenantId: string;
    },
  ): Promise<IntakeRequestDto> {
    const url = publicUrl(row.token);
    const contact = await this.contacts.getById(tx, row.contactId);
    const officeName = await this.officeName(tx, row.tenantId);
    const message = intakeInviteMessage({ officeName, url });
    return {
      id: row.id,
      url,
      status: row.status as IntakeStatus,
      channel: row.channel,
      expiresAt: row.expiresAt,
      openedAt: row.openedAt,
      submittedAt: row.submittedAt,
      createdAt: row.createdAt,
      waUrl:
        contact?.phone !== undefined
          ? `https://wa.me/${contact.phone.replace(/\D/gu, "")}?text=${encodeURIComponent(message)}`
          : null,
    };
  }
}

/** 43 תווי base64url = 256 ביט. אותו אורך כמו טוקן דף הנחיתה. */
function freshToken(): string {
  return randomBytes(32).toString("base64url");
}

function publicUrl(token: string): string {
  return `${loadEnv().WEB_ORIGIN}/f/${token}`;
}

/** „דנה כהן” → „דנה”. ברכה ציבורית אינה נושאת שם משפחה. */
function firstName(name: string | undefined): string {
  const first = (name ?? "").trim().split(/\s+/u)[0];
  return first !== undefined && first !== "" ? first : "לקוח יקר";
}

/**
 * מהדרישות השמורות לצורת הטופס.
 *
 * רק מה שהטופס שואל עליו — ראו ההסבר ב-`applyIntakeAnswers`. שדה
 * שאינו מוכר פשוט אינו מוצג, ואינו נשלח בחזרה, ולכן אינו נדרס.
 */
function toAnswers(req: Record<string, unknown>): IntakeAnswers {
  const out: IntakeAnswers = {};
  if (req["dealType"] === "sale" || req["dealType"] === "rent") {
    out.dealType = req["dealType"];
  }
  if (Array.isArray(req["cities"])) {
    out.cities = req["cities"].filter((c): c is string => typeof c === "string");
  }
  if (Array.isArray(req["propertyTypes"])) {
    out.propertyTypes = req["propertyTypes"].filter(
      (t): t is string => typeof t === "string",
    );
  }
  for (const key of [
    "roomsMin",
    "roomsMax",
    "budgetMinAgorot",
    "budgetMaxAgorot",
    "areaSqmMin",
  ] as const) {
    const value = req[key];
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
  }
  const features = req["features"];
  if (typeof features === "object" && features !== null && !Array.isArray(features)) {
    const picked: Record<string, "must" | "nice"> = {};
    for (const [key, value] of Object.entries(features)) {
      if (value === "must" || value === "nice") picked[key] = value;
    }
    out.features = picked as IntakeAnswers["features"];
  }
  const entryType = req["entryType"];
  if (entryType === "immediate" || entryType === "by_date" || entryType === "flexible") {
    out.entryType = entryType;
  }
  const entryBy = req["entryBy"];
  if (typeof entryBy === "string") out.entryBy = entryBy.slice(0, 10);
  else if (entryBy instanceof Date) out.entryBy = entryBy.toISOString().slice(0, 10);
  const notes = req["flexibilityNotes"];
  if (typeof notes === "string") out.notes = notes;
  return out;
}
