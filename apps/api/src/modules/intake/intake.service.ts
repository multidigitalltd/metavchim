import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { ulid } from "ulid";
import type { Prisma } from "@prisma/client";
import type { Capability } from "@metavchim/shared";
import {
  applyIntakeAnswers,
  BuyerRequirementsSchema,
  describeIntakeChanges,
  intakeExpiryFrom,
  intakeInactiveReason,
  intakeInviteMessage,
  intakeOpenRejectionReason,
  intakeSellerRejectionReason,
  isIntakeSide,
  sellerPropertyFields,
  sellerSummaryLines,
  normalizePhone,
  pickIntakeFeatures,
  PropertyTypeSchema,
  PropertyFieldsSchema,
  type IntakeAnswers,
  type IntakeSellerAnswers,
  type IntakeSide,
  type IntakeStatus,
  type IntakeSubject,
} from "@metavchim/shared";
import { loadEnv } from "../../config/env";
import { lockIntakeRequest } from "../../common/locks";
import { ownershipFilter } from "../../common/ownership";
import { TenantContext } from "../../common/tenant-context";
import { AuditService } from "../../core/audit.service";
import { PrismaService, type TenantTx } from "../../core/prisma.service";
import { BuyersService } from "../buyers/buyers.service";
import { ContactsService } from "../contacts/contacts.service";
import { PropertiesService } from "../properties/properties.service";

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
  /**
   * הטופס שואל גם „מי אתם” — קישור פתוח שעוד אין לו כרטיס.
   *
   * מרגע שהכרטיס נוצר הדגל כבה, והשליחה הבאה מאותו קישור מעדכנת
   * אותו כרטיס. זו גם הסיבה שהזהות שנמסרה **אינה** חוזרת לעמוד:
   * מי שמצא את הקישור אחרי המילוי היה לומד ממנו שם ומספר של אדם
   * אמיתי, וזה בדיוק מה שהעמוד הזה אינו אמור להסגיר.
   */
  needsIdentity: boolean;
  /**
   * הצד שנבחר בשליחה הקודמת — או `null` כשעוד לא נבחר.
   *
   * ‎`null` הוא מה שגורם לעמוד לשאול „מחפשים או שיש לכם נכס”. ערך
   * מלא מחזיר את הלקוח למסלול שבו כבר היה: מי שמילא פרטי דירה
   * ופתח את הקישור שוב כדי לתקן מספר קומה לא אמור להיתקל בשאלה
   * שכבר ענה עליה, ובוודאי לא לגלות שהתשובות שלו „נעלמו”.
   */
  side: IntakeSide | null;
  /** מה שהמוכר שלח קודם — ריק בצד הקונה. */
  sellerPrefill: IntakeSellerAnswers;
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
  /**
   * הכרטיס שנוצר מהקישור הפתוח, או `null` כשעוד לא נשלח.
   *
   * ברשימת הקישורים הפתוחים זו העמודה היחידה שמעניינת אחרי
   * השליחה: „מי מילא” הוא שאלה על כרטיס, ובלי הקישור אליו הרשימה
   * מודיעה שמשהו קרה ואינה אומרת איפה.
   */
  buyerId: string | null;
}

/**
 * המיזוג נדחה בסכימה — ולכן הטרנזקציה של הכרטיס מתבטלת.
 *
 * מחלקה ולא דגל, כי הסימון צריך לצאת מתוך פונקציה שרצה בתוך
 * `BuyersService.update`: זריקה מבטלת שם את הכתיבה כולה, וזה בדיוק
 * מה שנדרש — כרטיס מעודכן חצי גרוע מכרטיס שלא עודכן.
 */
class MergeRejected extends Error {}

/**
 * שליחה חדשה יותר של אותו קישור כבר תפסה את השורה.
 *
 * גם היא זורקת, ומאותה סיבה: הכתיבה לכרטיס חייבת להתבטל. ההבדל הוא
 * מה אומרים אחריה — כאן אין מה לומר, כי הגרסה החדשה כבר עדכנה,
 * התריעה ונרשמה ביומן.
 */
class Superseded extends Error {}

/**
 * מה נשמר על הבקשה. מצומצם — הצד הציבורי אינו זקוק ליותר.
 *
 * `subjectId` ו-`contactId` ריקים בקישור פתוח **עד השליחה**: הכרטיס
 * ואיש הקשר נוצרים ממה שהלקוח ימלא, ולכן אין מה למלא בהם קודם.
 */
interface TokenRow {
  id: string;
  tenantId: string;
  subject: string;
  subjectId: string | null;
  contactId: string | null;
  status: string;
  expiresAt: Date;
  /** buyer | seller — לאיזה צד הטופס נענה בשליחה האחרונה. */
  side: string;
}

/** בקשה שכבר יש לה כרטיס — כל מה שאחרי `materializeOpen` עובד עליה. */
type LinkedRow = TokenRow & { subjectId: string; contactId: string };

/**
 * שליחה שכבר **נתפסה** בתוך טרנזקציית ההתממשות.
 *
 * קיים כי בקישור פתוח התפיסה חייבת להיות באותה טרנזקציה שיוצרת את
 * הכרטיס — ראו `materializeOpen`. מה שנקרא שם לפני התפיסה נמסר
 * הלאה, כי אחריה `submittedAt` ו-`answers` כבר נושאים את השליחה
 * הנוכחית ו„מה היה קודם” אבד.
 */
interface PreClaim {
  rev: string;
  resubmit: boolean;
  previousAnswers: Record<string, unknown>;
}

@Injectable()
export class IntakeService {
  private readonly logger = new Logger(IntakeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly contacts: ContactsService,
    private readonly buyers: BuyersService,
    private readonly properties: PropertiesService,
  ) {}

  /* ================= הצד הפנימי — המתווך ================= */

  /**
   * קישור לכרטיס. מחזירה קישור פעיל קיים במקום ליצור חדש.
   *
   * שני קישורים פעילים לאותו כרטיס הם שני טפסים שהלקוח יכול למלא,
   * ואז „מי מהם קובע” הופך לשאלה שאין לה תשובה טובה. מי שרוצה
   * להתחיל מחדש מבטל את הקיים.
   */
  async ensure(
    subject: IntakeSubject,
    subjectId: string,
  ): Promise<IntakeRequestDto> {
    const ctx = TenantContext.current();
    const now = new Date();
    return this.prisma.withTenant(async (tx) => {
      const contactId = await this.contactOf(tx, subject, subjectId);

      /*
       * נעילת איש הקשר לפני הבדיקה — אותו דפוס של `convertFromLead`.
       *
       * בלעדיה שתי לחיצות מקבילות (שתי לשוניות, לחיצה כפולה שעקפה
       * את ה-disabled) קוראות שתיהן „אין קישור פעיל” ויוצרות שניים.
       * שני טפסים פעילים לאותו כרטיס הם השאלה „מי מהם קובע”, ואין
       * לה תשובה טובה — לכן היא נמנעת כאן ולא מטופלת אחר כך.
       */
      await tx.$queryRaw`SELECT id FROM contacts WHERE id = ${contactId} AND tenant_id = ${ctx.tenantId} FOR UPDATE`;

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
      if (existing !== null) {
        return toDto(
          existing,
          await this.dtoContext(tx, ctx.tenantId, contactId),
        );
      }

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
      return toDto(row, await this.dtoContext(tx, ctx.tenantId, contactId));
    });
  }

  /**
   * קישור **בלי כרטיס** — ללקוח שעדיין אינו במאגר.
   *
   * ## למה זה לא „ליד ואז קישור”
   *
   * הדרך הקיימת דורשת מהמתווך לפתוח כרטיס ידני קודם, כלומר להקליד
   * שם וטלפון בזמן שהלקוח על הקו — בדיוק ההקלדה שהתכונה הזו נועדה
   * להעביר ללקוח. ומי שפוגש לקוח ברחוב ורוצה לשלוח לו טופס לפני
   * שהוא יודע עליו דבר אינו יכול, כי אין למה לקשור את הקישור.
   *
   * ## למה כל לחיצה יוצרת קישור חדש
   *
   * `ensure` לכרטיס מחזירה קישור פעיל קיים, כי שני טפסים לאותו
   * כרטיס הם השאלה „מי מהם קובע”. כאן אין כרטיס לקשור אליו, ושני
   * לקוחות שונים שנפגשו באותו יום צריכים **שני** קישורים שונים.
   * החזרת אותו קישור לשניהם הייתה מכניסה את השני לכרטיס של הראשון.
   */
  async ensureOpen(): Promise<IntakeRequestDto> {
    const ctx = TenantContext.current();
    const now = new Date();
    return this.prisma.withTenant(async (tx) => {
      const row = await tx.intakeRequest.create({
        data: {
          id: ulid(),
          tenantId: ctx.tenantId,
          token: freshToken(),
          subject: "open",
          subjectId: null,
          contactId: null,
          channel: "manual",
          createdBy: ctx.userId,
          expiresAt: intakeExpiryFrom(now),
        },
      });
      await this.audit.record(tx, {
        action: "intake.create_open",
        entityType: "intake",
        entityId: row.id,
      });
      return toDto(row, {
        officeName: await this.officeName(tx, ctx.tenantId),
        phone: null,
      });
    });
  }

  /**
   * הקישורים הפתוחים של המשרד — החדש ראשון.
   *
   * הבעלות היא **מי שיצר**, ולא בעל הכרטיס: לפני השליחה אין כרטיס,
   * ואחריה הכרטיס נושא את הבעלות בעצמו. סוכן בלי `buyers.view_all`
   * רואה את הקישורים ששלח הוא — הרשימה מחזירה כתובות פעילות, וקישור
   * פעיל של עמית הוא טופס שאפשר למלא בשמו.
   */
  async listOpen(): Promise<IntakeRequestDto[]> {
    const ctx = TenantContext.current();
    return this.prisma.withTenant(async (tx) => {
      const rows = await tx.intakeRequest.findMany({
        where: {
          tenantId: ctx.tenantId,
          subject: "open",
          ...ownershipFilter("buyers.view_all", "createdBy"),
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      });
      if (rows.length === 0) return [];
      const officeName = await this.officeName(tx, ctx.tenantId);
      return rows.map((row) => toDto(row, { officeName, phone: null }));
    });
  }

  /**
   * כל הבקשות של הכרטיס — החדשה ראשונה.
   *
   * שם המשרד ואיש הקשר נקראים **פעם אחת**, לא פעם לכל שורה: כל
   * הבקשות של כרטיס אחד מצביעות על אותו איש קשר ועל אותו משרד,
   * ולולאה שקוראת אותם בכל סיבוב הפכה עשרים שורות לארבעים
   * שאילתות מיותרות.
   *
   * הבעלות נבדקת **לפני** השליפה, ולא רק ביצירה: הרשימה מחזירה את
   * הקישורים הפעילים ואת `waUrl` שבו מספר הטלפון, כלומר בדיוק מה
   * שיצירה מחזירה. שער על הכתיבה בלבד הוא חצי שער.
   */
  async listFor(
    subject: IntakeSubject,
    subjectId: string,
  ): Promise<IntakeRequestDto[]> {
    const ctx = TenantContext.current();
    return this.prisma.withTenant(async (tx) => {
      await this.contactOf(tx, subject, subjectId);
      const rows = await tx.intakeRequest.findMany({
        where: { tenantId: ctx.tenantId, subject, subjectId },
        orderBy: { createdAt: "desc" },
        take: 20,
      });
      if (rows.length === 0) return [];
      const ctxDto = await this.dtoContext(
        tx,
        ctx.tenantId,
        rows[0]!.contactId,
      );
      return rows.map((row) => toDto(row, ctxDto));
    });
  }

  /**
   * ביטול — הקישור מפסיק לעבוד מיידית.
   *
   * מזהה הבקשה לבדו אינו אומר של מי הכרטיס, ולכן הכרטיס נשלף
   * תחילה והבעלות נבדקת עליו. בלי זה סוכן היה יכול לבטל את הקישור
   * שעמית שלו שלח ללקוח — פעולה הרסנית שקשה לשחזר, כי הלקוח כבר
   * מחזיק קישור שהפסיק לעבוד.
   */
  async revoke(id: string): Promise<void> {
    const ctx = TenantContext.current();
    await this.prisma.withTenant(async (tx) => {
      const row = await tx.intakeRequest.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: { subject: true, subjectId: true, createdBy: true },
      });
      if (row === null) throw new NotFoundException("הבקשה לא נמצאה");
      if (row.subjectId === null) {
        /*
         * קישור פתוח שטרם נשלח — אין כרטיס שהבעלות עליו נבדקת,
         * ולכן היא נבדקת על מי ששלח אותו. אותו כלל של `listOpen`:
         * קישור פעיל של עמית הוא טופס שאפשר למלא בשמו, ולכן גם
         * הביטול שלו אינו נתון לכל סוכן במשרד.
         */
        const mine = ownershipFilter("buyers.view_all", "createdBy");
        if (
          mine["createdBy"] !== undefined &&
          mine["createdBy"] !== row.createdBy
        ) {
          throw new NotFoundException("הבקשה לא נמצאה");
        }
      } else {
        await this.contactOf(tx, row.subject as IntakeSubject, row.subjectId);
      }

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
    return this.asOffice(row.tenantId, async (tx) => {
      const officeName = await this.officeName(tx, row.tenantId);
      // קישור פתוח שטרם נשלח — אין עדיין איש קשר להביא ממנו שם
      const contact =
        row.contactId === null
          ? null
          : await this.contacts.getById(tx, row.contactId);
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
          needsIdentity: false,
          side: null,
          sellerPrefill: {},
        };
      }

      // הפתיחה נרשמת, אבל רק פעם אחת — „נפתח” לא הופך ל„נפתח שוב”
      if (row.status === "sent") {
        await tx.intakeRequest.updateMany({
          where: { id: row.id, status: "sent" },
          data: { status: "opened", openedAt: new Date() },
        });
      }

      const full = await tx.intakeRequest.findUnique({
        where: { id: row.id },
        select: {
          status: true,
          submittedAt: true,
          answers: true,
          side: true,
          submissionRev: true,
        },
      });
      /*
       * ‎**הצד נקרא מהשורה, וממנו נגזר מה בכלל צריך להיטען.**
       *
       * מוכר אינו מצביע על כרטיס קונה, ו-`targetBuyerId` עליו הייתה
       * מוצאת את הקונה הראשון של אותו איש קשר — ומחזירה ללקוח
       * שמילא פרטי דירה את **הדרישות של עצמו כקונה** כערכי פתיחה.
       */
      const chosen = sideOf(full?.side ?? row.side, full?.submittedAt ?? null);
      if (chosen === "seller") {
        return {
          officeName,
          greetingName: firstName(contact?.name),
          status: (full?.status ?? row.status) as IntakeStatus,
          inactive: null,
          prefill: {},
          submittedAt: full?.submittedAt?.toISOString() ?? null,
          needsIdentity: row.contactId === null,
          side: "seller" as const,
          sellerPrefill: asRecord(full?.answers) as IntakeSellerAnswers,
        };
      }

      const buyerId = await this.targetBuyerId(tx, row);
      const current = await this.currentRequirements(tx, row, buyerId);
      return {
        officeName,
        greetingName: firstName(contact?.name),
        status: (full?.status ?? row.status) as IntakeStatus,
        inactive: null,
        /*
         * ליד שאין לו עדיין כרטיס קונה מוצג ממה שהלקוח **עצמו** שלח
         * קודם. בלי זה לקוח שפתח את הקישור בשנית — או שלחץ „שלחתי
         * בטעות” — היה מקבל טופס ריק ומתחיל מאפס, אחרי שכבר מילא
         * אותו: התשובות שמורות על הבקשה, והן פשוט לא הוצגו לו.
         */
        prefill:
          buyerId !== null
            ? toAnswers(current)
            : toAnswers(asRecord(full?.answers)),
        submittedAt: full?.submittedAt?.toISOString() ?? null,
        needsIdentity: row.subject === "open" && row.subjectId === null,
        side: chosen,
        sellerPrefill: {},
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

    /*
     * קישור פתוח שעדיין אין לו כרטיס — הזהות היא מה שהופך תשובות
     * לכרטיס, והיא נבדקת **לפני** התפיסה. שליחה שנתפסת ואז נדחית
     * הייתה משאירה בקשה מסומנת „נשלחה” בלי שום דבר מאחוריה.
     */
    const materialized =
      row.subject === "open" && row.subjectId === null
        ? await this.materializeOpen(row, answers)
        : null;
    const resolved = materialized ?? row;
    /*
     * בקישור פתוח התפיסה כבר נעשתה — באותה טרנזקציה שיצרה את
     * הכרטיס, וזו כל הנקודה. תפיסה שנייה כאן הייתה מיותרת במקרה
     * הטוב, ובמקרה הרע הייתה נכשלת על ביטול שהגיע אחרי שהשליחה
     * כבר התקבלה — ומחזירה שגיאה על כרטיס שכבר קיים.
     */
    const preClaim = materialized?.preClaim ?? null;
    /*
     * מכאן והלאה יש כרטיס ויש איש קשר. בקישור לכרטיס קיים זה אילוץ
     * המסד; בקישור פתוח זה מה ש-`materializeOpen` בדיוק עשתה. הבדיקה
     * מנסחת את האינוריאנטה למהדר — הוא אינו יכול לגזור אותה משום
     * שהיא מפוצלת בין הסכימה לבין המסלול שמעליה.
     */
    if (resolved.subjectId === null || resolved.contactId === null) {
      throw new BadRequestException("הקישור אינו פעיל עוד");
    }
    const live: LinkedRow = {
      ...resolved,
      subjectId: resolved.subjectId,
      contactId: resolved.contactId,
    };

    const claim = await this.asOffice(live.tenantId, async (tx) => {
      /*
       * **אותו כרטיס שממנו נשאב הטופס הוא הכרטיס שנכתב.**
       *
       * הבדל בין השניים הוא התקלה שקל ליפול בה כאן: טופס שנפתח עם
       * הדרישות של הקונה, והלקוח מתקן אותן, ואז השמירה הולכת למקום
       * אחר — כלומר הלקוח רואה את התיקון שלו נעלם. לכן היעד נקבע
       * פעם אחת ומשמש את שני הצדדים.
       */
      /*
       * נעילת איש הקשר — הגבול המשותף עם המרת הליד.
       *
       * `convertFromLead` נועלת את אותה שורה לפני שהיא קוראת את
       * הטופס שנשלח. בלי הנעילה כאן שתי הפעולות רואות זו את מצבה
       * הישן של זו: ההמרה קוראת „אין טופס שנשלח”, השליחה מוצאת
       * „אין כרטיס קונה” ושומרת את התשובות על הבקשה בלבד, ושתיהן
       * מצליחות — כשהתשובות של הלקוח נשארות תלויות באוויר ואף אחד
       * לא ידע. הנעילה מסדרת אותן בתור, ומי שמגיע שני רואה את מה
       * שהראשון עשה.
       */
      await tx.$queryRaw`SELECT id FROM contacts WHERE id = ${live.contactId} AND tenant_id = ${live.tenantId} FOR UPDATE`;

      const targetBuyerId = await this.targetBuyerId(tx, live);

      /*
       * **המיזוג אינו נעשה כאן.**
       *
       * מפתה לחשב אותו יחד עם התפיסה, אבל הכתיבה לכרטיס קורית
       * בטרנזקציה אחרת — ואז „הדרישות שהיו” הן צילום שכבר יכול היה
       * להשתנות: הסוכן ערך את הכרטיס בלשונית אחרת, או שהלקוח שלח
       * פעמיים והשתיים נחתו לא לפי הסדר. התוצאה היא מחיקה שקטה של
       * מה שקרה בין לבין. לכן המיזוג יורד ל-`applyToBuyer`, שרץ
       * מתחת לנעילת שורת הקונה.
       */

      /*
       * `resubmit` נקרא **לפני** העדכון: אחריו `submittedAt` תמיד
       * מלא, וההבחנה בין „הלקוח ענה” לבין „הלקוח שלח שוב” הייתה
       * נעלמת.
       */
      const previous =
        preClaim === null
          ? await tx.intakeRequest.findUnique({
              where: { id: live.id },
              select: { submittedAt: true, answers: true },
            })
          : null;
      const resubmit =
        preClaim?.resubmit ??
        (previous?.submittedAt !== null && previous?.submittedAt !== undefined);
      /*
       * מה שנשלח קודם — להשוואה במסלול הליד.
       *
       * לליד בלי כרטיס קונה אין „דרישות שהיו” להשוות אליהן, ולכן
       * `changed` שם היה תמיד ריק — ו-`notify` משתיקה שליחה חוזרת
       * בלי שינויים. התוצאה: לקוח שתיקן או הרחיב את תשובותיו לפני
       * ההמרה קיבל „נשמר”, והסוכן לא שמע דבר. ההשוואה כאן היא בין
       * מה שהלקוח שלח קודם למה שהוא שולח עכשיו, וזו בדיוק השאלה
       * שהסוכן צריך תשובה עליה.
       */
      const previousAnswers = preClaim?.previousAnswers ?? asRecord(previous?.answers);

      /*
       * התפיסה מותנית, ולא כתיבה עיוורת.
       *
       * בין קריאת הטוקן לבין הכתיבה יכול לעבור זמן — והמתווך יכול
       * לבטל את הקישור בדיוק בו, או שהתוקף פג. `update` בלתי מותנה
       * היה **מחזיר** בקשה שבוטלה למצב „נשלחה”, ומחיל את התשובות
       * על הכרטיס אחרי שהמשרד כבר אמר שהקישור אינו תקף. התנאי
       * נבדק כאן בתוך `UPDATE` אחד, ולכן הוא נכון גם מול ביטול
       * מקביל: מי שהגיע שני רואה אפס שורות.
       */
      /*
       * `rev` הוא **מספר הגרסה** של השליחה הזו.
       *
       * התפיסה והכתיבה לכרטיס הן שתי טרנזקציות, ולכן סדר ההגעה
       * לנעילת הקונה אינו בהכרח סדר השליחות: שליחה ותיקה שנעצרה
       * אחרי התפיסה יכולה להגיע לנעילה **אחרי** שליחה חדשה שכבר
       * כתבה — ולדרוס אותה בתשובות ישנות, בעוד שורת הבקשה נושאת
       * את החדשות. הגרסה נבדקת מחדש מתחת לנעילה, ומי שכבר הוקדם
       * מוותר.
       *
       * ULID ולא `submittedAt`: חותמת מדויקת למילישנייה, ושתי
       * שליחות שנופלות באותה מילישנייה מקבלות ערך זהה — כלומר
       * הבדיקה מפסיקה להבחין ביניהן בדיוק במקרה שבשבילו היא
       * נכתבה.
       */
      if (preClaim !== null) {
        return { targetBuyerId, resubmit, rev: preClaim.rev, previousAnswers };
      }

      const rev = ulid();
      const claimed = await tx.intakeRequest.updateMany({
        where: {
          id: live.id,
          tenantId: live.tenantId,
          status: { not: "revoked" },
          expiresAt: { gt: new Date() },
        },
        data: {
          status: "submitted",
          submittedAt: new Date(),
          submissionRev: rev,
          answers: answers as unknown as Prisma.InputJsonValue,
        },
      });
      if (claimed.count === 0) return null;

      return { targetBuyerId, resubmit, rev, previousAnswers };
    });

    if (claim === null) {
      throw new BadRequestException("הקישור אינו פעיל עוד");
    }

    const outcome =
      claim.targetBuyerId === null
        ? {
            applied: false,
            superseded: false,
            /* ראו `previousAnswers`: שליחה מול שליחה, ולא מול כרטיס */
            changed: describeIntakeChanges(
              applyIntakeAnswers({}, claim.previousAnswers as IntakeAnswers),
              applyIntakeAnswers({}, answers),
            ),
          }
        : await this.applyToBuyer(
            live.tenantId,
            claim.targetBuyerId,
            live.id,
            claim.rev,
            answers,
          );

    /*
     * שליחה שהוקדמה שותקת לגמרי. הכרטיס נושא את התשובות החדשות,
     * ההתראה עליהן כבר נשלחה, והיומן כבר רשם אותן — הודעה שנייה על
     * גרסה ישנה יותר רק מבלבלת את מי שקורא אותה.
     */
    if (outcome.superseded) return { ok: true };

    await this.asOffice(live.tenantId, async (tx) => {
      /*
       * היומן נרשם **בכל** שליחה, גם כשאין התראה: הוא הראיה למי
       * נגע בכרטיס ומתי, ודילוג עליו היה יוצר שינוי בלי מקור. הוא
       * נרשם כאן ולא בתפיסה כדי שיישא את השינויים שבאמת נכתבו —
       * אלה מחושבים תחת נעילת הכרטיס, אחריה.
       */
      await this.audit.record(tx, {
        action: "intake.submit",
        entityType: live.subject,
        entityId: live.subjectId,
        // רק שמות שדות — לא מה שנכתב בהם
        metadata: { changed: outcome.changed },
      });
      await this.notify(tx, live, {
        targetBuyerId: claim.targetBuyerId,
        resubmit: claim.resubmit,
        ...outcome,
      });
    });
    return { ok: true };
  }

  /**
   * הלקוח שלח — **והוא מוכר.**
   *
   * ## למה מסלול נפרד ולא ענף בתוך `submit`
   *
   * התוצר שונה. קונה מייצר דרישות שממוזגות לכרטיס קיים, ולכן כל
   * המנגנון שמעל — `targetBuyerId`, `applyToBuyer`, השוואת הגרסאות
   * מתחת לנעילת הקונה — קיים כדי לענות על שאלה אחת: **לאיזה כרטיס
   * למזג.** למוכר אין יעד מיזוג; הוא מייצר **נכס**. ‎`if` בתוך כל
   * אחת מהפונקציות ההן היה הופך את הקוד הרגיש ביותר בקובץ לקוד
   * שמשרת שני מקרים שאין להם דבר במשותף.
   *
   * ## מה כן משותף
   *
   * התפיסה. אותה `UPDATE ... WHERE status <> 'revoked' AND expires_at > now`
   * אטומית, מתחת לאותה נעילת בקשה — כי אותם מרוצים קיימים כאן
   * בדיוק: לחיצה כפולה על „שליחה” בנייד, וביטול שמגיע בדיוק בין
   * הבדיקה לכתיבה.
   *
   * ## למה הנכס נוצר **אחרי** התפיסה ולא בתוכה
   *
   * ‎`PropertiesService.persist` פותחת טרנזקציה משלה (מכסה, פענוח
   * כתובת, יומן, outbox), ואי אפשר לקנן אותה בתוך זו. הסדר הזה גם
   * הנכון: תפיסה שהצליחה ויצירה שנכשלה משאירה **שליחה שנרשמה בלי
   * טיוטה** — והמשימה שנפתחת אומרת בדיוק את זה. הסדר ההפוך היה
   * משאיר נכס יתום שאיש אינו מצביע עליו.
   */
  async submitSeller(
    token: string,
    answers: IntakeSellerAnswers,
  ): Promise<{ ok: true }> {
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

    /*
     * הזהות נדרשת כשאין איש קשר, ולא כש„הקישור פתוח”: קישור פתוח
     * שכבר נשלח פעם אחת **יש** לו איש קשר, ובקשה שלו לשם ולמספר
     * מחדש מזמינה גרסה שנייה של אותו אדם.
     */
    const needsIdentity = row.contactId === null;
    const rejection = intakeSellerRejectionReason(answers, { needsIdentity });
    if (rejection !== null) throw new BadRequestException(rejection);

    const meta = await this.prisma.withExplicitTenant(row.tenantId, (tx) =>
      tx.intakeRequest.findUnique({
        where: { id: row.id },
        select: { createdBy: true },
      }),
    );
    // הבעלים הוא מי ששלח את הקישור; באוטומציה אין אדם כזה
    const agentUserId = meta?.createdBy ?? "";

    return TenantContext.run(officeContext(row.tenantId, agentUserId), async () => {
      const claim = await this.prisma.withExplicitTenant(row.tenantId, async (tx) => {
        await lockIntakeRequest(tx, row.tenantId, row.id);
        const again = await tx.intakeRequest.findUnique({
          where: { id: row.id },
          select: {
            status: true,
            expiresAt: true,
            contactId: true,
            propertyId: true,
            submittedAt: true,
          },
        });
        if (again === null) throw new BadRequestException("הקישור אינו פעיל עוד");
        /*
         * הפעילוּת נבדקת **שוב, מתחת לנעילה** — אותו נימוק בדיוק
         * כמו ב-`materializeOpen`: בין הבדיקה שבכניסה לבין הכתיבה
         * אפשר שהקישור בוטל, ונכס שנולד מקישור מבוטל הוא בדיוק מה
         * שאסור שיקרה.
         */
        const stillInactive = intakeInactiveReason(
          again.status as IntakeStatus,
          again.expiresAt,
          new Date(),
        );
        if (stillInactive !== null) {
          throw new BadRequestException(
            stillInactive === "expired" ? "הקישור פג תוקף" : "הקישור בוטל",
          );
        }

        const contactId =
          again.contactId ??
          (
            await this.contacts.findOrCreateByPhone(tx, {
              name: (answers.fullName ?? "").trim(),
              phone: normalizePhone(answers.phone ?? ""),
            })
          ).id;

        const rev = ulid();
        const claimed = await tx.intakeRequest.updateMany({
          where: {
            id: row.id,
            tenantId: row.tenantId,
            status: { not: "revoked" },
            expiresAt: { gt: new Date() },
          },
          data: {
            status: "submitted",
            submittedAt: new Date(),
            submissionRev: rev,
            side: "seller",
            contactId,
            answers: answers as unknown as Prisma.InputJsonValue,
          },
        });
        if (claimed.count === 0) {
          throw new BadRequestException("הקישור אינו פעיל עוד");
        }

        const contact = await this.contacts.getById(tx, contactId);
        return {
          contactId,
          propertyId: again.propertyId,
          resubmit: again.submittedAt !== null,
          ownerName: contact?.name ?? (answers.fullName ?? "").trim(),
          ownerPhone: contact?.phone ?? normalizePhone(answers.phone ?? ""),
        };
      });

      const draft = await this.draftFor(row, claim, answers);
      await this.afterSellerSubmit(row, claim, answers, draft, agentUserId);
      return { ok: true };
    });
  }

  /**
   * הטיוטה — נוצרת פעם אחת, ומתעדכנת כל עוד היא **עדיין טיוטה**.
   *
   * ## למה שליחה חוזרת מעדכנת ולא יוצרת
   *
   * „שכחתי לציין שיש מעלית” הוא המקרה הנפוץ, ובלי הקישור שנשמר על
   * הבקשה הוא היה פותח נכס שני לאותה דירה. כפילות כזו מתגלה רק
   * כשמישהו שואל למה יש שתי מודעות.
   *
   * ## ולמה היא מפסיקה לעדכן ברגע שהסוכן נגע
   *
   * מרגע שהנכס אינו טיוטה, סוכן כבר בדק אותו, אולי תיקן מחיר שהוקלד
   * באלפים, ואולי פרסם. שליחה חוזרת שדורסת את זה מוחקת עבודה של אדם
   * בשם טופס — ולכן היא הופכת ל**דיווח** במשימה, והסוכן מחליט.
   */
  private async draftFor(
    row: TokenRow,
    claim: { propertyId: string | null; ownerName: string; ownerPhone: string },
    answers: IntakeSellerAnswers,
  ): Promise<{ propertyId: string | null; created: boolean; note: string | null }> {
    const fields = PropertyFieldsSchema.partial().parse(sellerPropertyFields(answers));

    if (claim.propertyId !== null) {
      const status = await this.prisma.withExplicitTenant(row.tenantId, (tx) =>
        tx.property.findFirst({
          where: { id: claim.propertyId ?? "", tenantId: row.tenantId },
          select: { status: true, deletedAt: true },
        }),
      );
      // נמחק — אין מה לעדכן, ואין מה ליצור במקומו בלי החלטה של אדם
      if (status === null || status.deletedAt !== null) {
        return {
          propertyId: null,
          created: false,
          note: "הטיוטה הקודמת נמחקה — הפרטים כאן, בלי כרטיס.",
        };
      }
      if (status.status !== "draft") {
        return {
          propertyId: claim.propertyId,
          created: false,
          note: "הכרטיס כבר אינו טיוטה, ולכן לא עודכן אוטומטית — השוו לפרטים כאן.",
        };
      }
      await this.properties.update(claim.propertyId, fields);
      return { propertyId: claim.propertyId, created: false, note: null };
    }

    try {
      const propertyId = await this.properties.createFromIntake({
        fields,
        owner: { name: claim.ownerName, phone: claim.ownerPhone },
        internalNotes: sellerSummaryLines(answers).join("\n"),
      });
      await this.prisma.withExplicitTenant(row.tenantId, (tx) =>
        tx.intakeRequest.updateMany({
          where: { id: row.id, tenantId: row.tenantId, propertyId: null },
          data: { propertyId },
        }),
      );
      return { propertyId, created: true, note: null };
    } catch (error: unknown) {
      /*
       * ‎**כישלון היצירה אינו כישלון השליחה.**
       *
       * המקרה הצפוי הוא מכסת הנכסים של המסלול, והוא אינו באשמת
       * הלקוח: הוא מילא טופס שביקשו ממנו למלא. השליחה כבר נתפסה,
       * התשובות שמורות על הבקשה, והמשימה שנפתחת אומרת מה קרה —
       * זה עדיף על שגיאה אצל הלקוח ועל אובדן הפרטים גם יחד.
       */
      this.logger.warn(
        `יצירת טיוטה מטופס מוכר נכשלה (${row.tenantId}): ${
          error instanceof Error ? error.message : "שגיאה לא ידועה"
        }`,
      );
      return {
        propertyId: null,
        created: false,
        note: `לא נוצר כרטיס נכס אוטומטית (${
          error instanceof Error ? error.message : "שגיאה לא ידועה"
        }). הפרטים כאן.`,
      };
    }
  }

  /**
   * מה שהמשרד רואה: משימה לסוכן, והתראה בתור.
   *
   * ‎**שתיהן ולא אחת מהן.** המשימה שייכת לאדם ויש לה „בוצע”, וזה
   * הדבר הנכון כשמישהו צריך להתקשר ולאמת; ההתראה היא מה שמופיע
   * בתור של המשרד גם כשאין למשימה בעלים — באוטומציה של שיחה שלא
   * נענתה אין אדם שלחץ, ומשימה שהוצמדה למישהו שרירותי נוחתת אצל מי
   * שלא יודע עליה (אותו נימוק בדיוק כמו ב-`offerIntakeAfterMissedCall`).
   */
  private async afterSellerSubmit(
    row: TokenRow,
    claim: { resubmit: boolean },
    answers: IntakeSellerAnswers,
    draft: { propertyId: string | null; created: boolean; note: string | null },
    agentUserId: string,
  ): Promise<void> {
    const lines = sellerSummaryLines(answers);
    const body = [
      ...(draft.note === null ? [] : [draft.note]),
      ...lines,
    ].join("\n");
    const title = claim.resubmit
      ? "הלקוח עדכן את פרטי הנכס שלו"
      : "הלקוח מילא את הטופס — יש לו נכס";

    await this.asOffice(row.tenantId, async (tx) => {
      await this.audit.record(tx, {
        action: "intake.submit_seller",
        entityType: draft.propertyId === null ? row.subject : "property",
        entityId: draft.propertyId ?? row.subjectId ?? undefined,
        // רק מה נוצר — לא מה נכתב בשדות
        metadata: { created: draft.created, hadDraft: draft.propertyId !== null },
      });

      await tx.notification.create({
        data: {
          id: ulid(),
          tenantId: row.tenantId,
          userId: null,
          type: "intake_submitted",
          title,
          body,
          /*
           * ההתראה מפנה ל**נכס** כשיש כזה: זה מה שהסוכן צריך לפתוח.
           * בלי טיוטה היא מפנה לכרטיס שממנו נשלח הקישור, ובקישור
           * פתוח — לשום מקום, וזה עדיף על קישור שנוחת בדף הבית.
           */
          entityType: draft.propertyId !== null ? "property" : null,
          entityId: draft.propertyId,
        },
      });

      if (agentUserId === "") return;
      /*
       * אידמפוטנטי לפי הבקשה: שליחה חוזרת מעדכנת את הטיוטה, ואינה
       * אמורה לייצר ערימת משימות זהות אצל אותו סוכן.
       */
      const sourceKey = `intake-seller:${row.id}`;
      const existing = await tx.task.findFirst({
        where: { tenantId: row.tenantId, sourceKey },
        select: { id: true },
      });
      if (existing !== null) return;
      await tx.task.create({
        data: {
          id: ulid(),
          tenantId: row.tenantId,
          assignedToUserId: agentUserId,
          title: "נכס מטופס של לקוח — לאמת ולפרסם",
          notes: body,
          entityType: draft.propertyId !== null ? "property" : null,
          entityId: draft.propertyId,
          sourceKey,
        },
      });
    });
  }

  /**
   * הקישור הפתוח הופך לכרטיס — פעם אחת, ולא פעם לכל שליחה.
   *
   * ## מה נוצר כאן
   *
   * איש קשר וכרטיס קונה, מתוך מה שהלקוח **עצמו** מילא. משם ואילך
   * הבקשה מצביעה על הכרטיס, וכל המנגנון הקיים ממשיך כרגיל: השליחה
   * הזו ממזגת לתוכו, וכל שליחה נוספת מאותו קישור מעדכנת אותו.
   *
   * ## מיזוג לפי טלפון
   *
   * לקוח שכבר קונה במשרד — קיבל קישור פתוח בטעות, או חזר אחרי חצי
   * שנה — **אינו** מקבל כרטיס שני. `findOrCreateByPhone` מחזירה את
   * איש הקשר הקיים, והקונה הראשון שלו הוא היעד. כרטיס כפול הוא
   * התקלה שהתכונה הזו הכי קלה לייצר, והיא מתגלה רק כשמישהו מנסה
   * להבין למה יש שתי שורות לאותו אדם.
   *
   * ## למה הכול בטרנזקציה אחת
   *
   * הנעילה על שורת הבקשה, הקריאה החוזרת, יצירת הכרטיס והסימון של
   * הבקשה עליו — כולם יחד. שתי שליחות מקבילות של אותו קישור הן לא
   * תרחיש נדיר (לחיצה כפולה על „שליחה” בנייד היא בדיוק זה), ופיצול
   * לשתי טרנזקציות היה מייצר קונה שאיש אינו מצביע עליו: כרטיס יתום
   * שהמתווך רואה בלי לדעת מאיפה הגיע, ולידו עוד אחד.
   *
   * הפעולות שאחרי הכתיבה רצות מחוץ לטרנזקציה — ראו `afterCreate`.
   */
  private async materializeOpen(
    row: TokenRow,
    answers: IntakeAnswers,
  ): Promise<TokenRow & { preClaim: PreClaim | null }> {
    const rejection = intakeOpenRejectionReason(answers);
    if (rejection !== null) throw new BadRequestException(rejection);
    const fullName = (answers.fullName ?? "").trim();
    // הצורה המנורמלת היא מה שנשמר ומה שמזהה כפילות — ראו `normalizePhone`
    const phone = normalizePhone(answers.phone ?? "");

    /*
     * הבעלים הוא מי ששלח את הקישור, ולא „אף אחד”: את השליחה עשה
     * הלקוח, ובלי בעלים מפורש הכרטיס נעלם מכל סוכן שרואה „רק שלי”
     * — כלומר מהסוכן שביקש אותו.
     */
    const link = await this.prisma.withExplicitTenant(row.tenantId, (tx) =>
      tx.intakeRequest.findUnique({
        where: { id: row.id },
        select: { createdBy: true },
      }),
    );
    const owner = link?.createdBy ?? "";

    const fresh: string[] = [];
    return TenantContext.run(officeContext(row.tenantId, owner), async () => {
      const linked = await this.prisma.withExplicitTenant(
        row.tenantId,
        async (tx) => {
          await lockIntakeRequest(tx, row.tenantId, row.id);
          const again = await tx.intakeRequest.findUnique({
            where: { id: row.id },
            select: {
              subjectId: true,
              contactId: true,
              status: true,
              expiresAt: true,
            },
          });
          if (again === null) throw new BadRequestException("הקישור אינו פעיל עוד");
          /*
           * הפעילוּת נבדקת **שוב, בתוך הנעילה** — ולא רק בכניסה
           * ל-`submit`.
           *
           * בין שתי הנקודות אפשר שהקישור בוטל או פג, והתפיסה
           * המותנית שמאוחר יותר בזרימה אכן תופסת זאת ומחזירה
           * „הקישור אינו פעיל”. אבל עד שהיא רצה הכרטיס **כבר
           * נוצר**, ו-`afterCreate` אולי כבר פרסם אותו לרשת: הלקוח
           * מקבל הודעת שגיאה, והמשרד מקבל קונה שנולד מקישור מבוטל
           * (ביקורת Codex).
           *
           * הנעילה כאן היא אותה נעילה שמסדרת את השליחות המקבילות,
           * ולכן הבדיקה בתוכה רואה את מצב הביטול האמיתי.
           */
          const stillInactive = intakeInactiveReason(
            again.status as IntakeStatus,
            again.expiresAt,
            new Date(),
          );
          if (stillInactive !== null) {
            throw new BadRequestException(
              stillInactive === "expired" ? "הקישור פג תוקף" : "הקישור בוטל",
            );
          }
          // שליחה מקבילה הקדימה — הכרטיס שלה הוא הכרטיס
          if (again.subjectId !== null && again.contactId !== null) {
            /*
             * בלי תפיסה: היא כבר נעשתה על ידי מי שהקדים, והמסלול
             * הרגיל שאחרי כאן יתפוס את השליחה הזו כשליחה חוזרת.
             */
            return {
              subjectId: again.subjectId,
              contactId: again.contactId,
              preClaim: null,
            };
          }

          /*
           * **התפיסה כאן, ולפני שנוצר משהו.**
           *
           * הבדיקה שמעל אינה מספיקה: `revoke` אינו נוטל את הנעילה
           * הזו, ובין הבדיקה לבין הכתיבה — ואחר כך גם בין סיום
           * הטרנזקציה הזו לבין התפיסה שהייתה בטרנזקציה נפרדת —
           * הקישור יכול היה להתבטל. התוצאה הייתה הגרועה משני
           * העולמות: הלקוח מקבל „הקישור אינו פעיל”, והמשרד מקבל
           * קונה שנולד מקישור מבוטל (ביקורת Codex, P1).
           *
           * `UPDATE ... WHERE status <> 'revoked' AND expires_at > now`
           * הוא הכרעה אטומית, והיא נעשית מעתה **באותה טרנזקציה**
           * שיוצרת את הכרטיס. או ששניהם קרו, או ששום דבר לא קרה.
           * ביטול שמגיע אחריה מאחר — השליחה כבר התקבלה.
           */
          const before = await tx.intakeRequest.findUnique({
            where: { id: row.id },
            select: { submittedAt: true, answers: true },
          });
          const rev = ulid();
          const claimed = await tx.intakeRequest.updateMany({
            where: {
              id: row.id,
              tenantId: row.tenantId,
              status: { not: "revoked" },
              expiresAt: { gt: new Date() },
            },
            data: {
              status: "submitted",
              submittedAt: new Date(),
              submissionRev: rev,
              answers: answers as unknown as Prisma.InputJsonValue,
            },
          });
          if (claimed.count === 0) {
            throw new BadRequestException("הקישור אינו פעיל עוד");
          }
          const preClaim: PreClaim = {
            rev,
            resubmit: before?.submittedAt !== null && before?.submittedAt !== undefined,
            previousAnswers: asRecord(before?.answers),
          };

          const contact = await this.contacts.findOrCreateByPhone(tx, {
            name: fullName,
            phone,
          });
          /*
           * נעילת **שורת** איש הקשר לפני בדיקת „יש כבר קונה”.
           *
           * ‎`findOrCreateByPhone` נוטלת נעילה מייעצת על המספר, וזה
           * מסדר אותה מול יוצרי כרטיסים אחרים — אבל לא מול
           * `BuyersService.convertFromLead`, שנועלת את שורת איש הקשר
           * ב-`SELECT … FOR UPDATE`. שני מנגנוני נעילה שונים אינם
           * נפגשים: שתי הטרנזקציות רואות „אין קונה פעיל”, שתיהן
           * יוצרות, ולאותו אדם נפתחים שני כרטיסי קונה פעילים
           * (ביקורת Codex, P1).
           *
           * זו אותה נעילה שהמסלול שאחרי `materializeOpen` כבר נוטל
           * ב-`submit`; היא פשוט הייתה חסרה כאן, לפני ההכרעה שיוצרת.
           */
          await tx.$queryRaw`SELECT id FROM contacts WHERE id = ${contact.id} AND tenant_id = ${row.tenantId} FOR UPDATE`;
          const existing = await tx.buyer.findFirst({
            where: {
              tenantId: row.tenantId,
              contactId: contact.id,
              deletedAt: null,
            },
            orderBy: { createdAt: "asc" },
            select: { id: true },
          });
          if (existing !== null) {
            await this.link(tx, row, existing.id, contact.id);
            return { subjectId: existing.id, contactId: contact.id, preClaim };
          }

          /*
           * הכרטיס נולד עם הדרישות שכבר נשלחו, ולא ריק ואז מעודכן:
           * קונה ריק שנכתב ומיד נערך מייצר שתי רשומות ביומן ושתי
           * הרצות התאמה, והראשונה מהן על כרטיס שאין בו דבר.
           */
          const buyerId = await this.buyers.createWithin(tx, {
            contactName: fullName,
            contactPhone: phone,
            requirements: BuyerRequirementsSchema.parse(
              applyIntakeAnswers({}, answers),
            ),
            source: "intake_link",
            ownerUserId: owner === "" ? undefined : owner,
          });
          fresh.push(buyerId);
          await this.link(tx, row, buyerId, contact.id);
          return { subjectId: buyerId, contactId: contact.id, preClaim };
        },
      );

      for (const id of fresh) await this.buyers.afterCreate(id);
      return { ...row, ...linked };
    });
  }

  /**
   * שורת הבקשה מצביעה על הכרטיס — **רק אם עוד לא הצביעה.**
   *
   * `updateMany` עם `subjectId: null` בתנאי ולא `update`: הנעילה
   * מסדרת את השליחות זו אחר זו, והתנאי הוא מה שמוודא שהשנייה אינה
   * מסיטה את הבקשה לכרטיס אחר אם משהו בכל זאת חמק.
   */
  private async link(
    tx: TenantTx,
    row: TokenRow,
    buyerId: string,
    contactId: string,
  ): Promise<void> {
    await tx.intakeRequest.updateMany({
      where: { id: row.id, tenantId: row.tenantId, subjectId: null },
      data: { subjectId: buyerId, contactId },
    });
  }

  /**
   * הדרישות החדשות → כרטיס הקונה, **דרך `BuyersService.update`.**
   *
   * כתיבה ישירה של ה-JSON לבדו היא חצי עדכון: לקונה יש גם עמודות
   * „חמות” — ערים, סוג עסקה, תקציב, חדרים, ודגל אזורי המפה — והסינון
   * הגס של מנוע ההתאמות קורא **אותן**, לא את ה-JSON. לקוח שהחליף עיר
   * או העלה תקציב היה מקבל „נשמר”, ובפועל ממשיך להיבחן לפי הערכים
   * הישנים: התאמות קיימות נשארות תקועות וחדשות אינן נפתחות. אותה
   * כתיבה גם דילגה על ה-outbox ועל רענון הביקוש ברשת, כלומר על כל
   * מה שהופך עריכה לעריכה.
   *
   * **המיזוג עצמו קורה בתוך הקריאה**, כפונקציה ש-`update` מפעילה
   * אחרי שהיא נעלה את שורת הקונה. זה מה שמונע מחיקה שקטה: „הדרישות
   * שהיו” נקראות אחרי הנעילה, ולכן עריכה של הסוכן או שליחה מקבילה
   * של הלקוח נכנסות למיזוג במקום להידרס על ידו.
   *
   * הסכימה נאכפת לפני הכתיבה. מבנה שאינו עובר אותה אינו נכתב חצי —
   * התשובות כבר שמורות על הבקשה, וההתראה תאמר שהכרטיס לא עודכן.
   */
  private async applyToBuyer(
    tenantId: string,
    buyerId: string,
    requestId: string,
    rev: string,
    answers: IntakeAnswers,
  ): Promise<{ applied: boolean; changed: string[]; superseded: boolean }> {
    /*
     * מה שהמיזוג גילה, מתוך הטרנזקציה החוצה. ההתראה חייבת לתאר את
     * מה שנכתב בפועל, וזה ידוע רק שם — מתחת לנעילה.
     */
    let changed: string[] = [];
    let rejected: string | null = null;

    try {
      await TenantContext.run(officeContext(tenantId), () =>
        this.buyers.update(buyerId, {
          requirements: async (before, tx) => {
            /*
             * הבדיקה הראשונה מתחת לנעילה: האם השליחה הזו עדיין
             * האחרונה. ראו ההסבר ליד `rev` ב-`submit`.
             */
            const current = await tx.intakeRequest.findUnique({
              where: { id: requestId },
              select: { submissionRev: true },
            });
            if (current?.submissionRev !== rev) throw new Superseded();

            const after = applyIntakeAnswers(before, answers);
            /*
             * האימות על **התוצאה** ולא על המקור. כרטיס שיושב בו ערך
             * ישן שאינו בסכימה עוד הוא בדיוק מי שהמיזוג אמור לתקן,
             * ואימות מוקדם היה מפיל אותו לפני שהתיקון נכתב.
             */
            const parsed = BuyerRequirementsSchema.safeParse(after);
            if (!parsed.success) {
              // בלי תוכן הדרישות ביומן — רק שמות השדות שנפלו
              rejected = parsed.error.issues
                .map((issue) => issue.path.join("."))
                .join(", ");
              throw new MergeRejected();
            }
            changed = describeIntakeChanges(before, after);
            return parsed.data;
          },
        }),
      );
    } catch (error: unknown) {
      if (error instanceof Superseded) {
        return { applied: false, changed: [], superseded: true };
      }
      if (!(error instanceof MergeRejected)) throw error;
      this.logger.warn(
        `intake submit: requirements rejected for buyer ${buyerId} — ${rejected ?? "unknown"}`,
      );
      return { applied: false, changed: [], superseded: false };
    }
    return { applied: true, changed, superseded: false };
  }

  /**
   * ההתראה לסוכן — מתארת את מה שבאמת קרה.
   *
   * שליחה חוזרת שלא שינתה דבר אינה מתריעה: הקישור פעיל שבועיים, מי
   * שמחזיק בו יכול לשלוח שוב ושוב, והתראה על כל שליחה הייתה מציפה
   * את הרשימה עד שהמשרד יפסיק להסתכל עליה — גם על ההתראות שהוא כן
   * צריך. שליחה **ראשונה** תמיד מתריעה: הסוכן צריך לדעת שהלקוח ענה,
   * גם כשהתשובות זהות למה שכבר ידע.
   */
  private async notify(
    tx: TenantTx,
    row: TokenRow,
    result: {
      targetBuyerId: string | null;
      changed: string[];
      resubmit: boolean;
      applied: boolean;
    },
  ): Promise<void> {
    if (result.resubmit && result.changed.length === 0) return;
    await tx.notification.create({
      data: {
        id: ulid(),
        tenantId: row.tenantId,
        userId: null,
        type: "intake_submitted",
        title: "הלקוח מילא את טופס הדרישות",
        body: notificationBody(result),
        /*
         * ‎`open` הוא סוג של **קישור**, לא סוג של כרטיס.
         *
         * ‎`row.subject` נשאר "open" גם אחרי ההתממשות במכוון — הוא
         * מתאר מאין הבקשה באה — אבל `subjectId` מצביע מאותו רגע על
         * כרטיס קונה. התראה שנשמרה עם `entityType: "open"` לא
         * נפתחת בשום מקום: מנתב הקישורים במסך ובפוש מכיר `buyer`
         * ולא `open`, ולכן הלחיצה נחתה בדף הבית — דווקא ההתראה
         * שאומרת „הלקוח מילא את הטופס” (ביקורת Codex).
         */
        entityType: row.subject === "open" ? "buyer" : row.subject,
        entityId: row.subjectId,
      },
    });
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
   * העבודה שאחרי הטוקן — תחת הקשר דייר **מלא**, ולא רק תחת RLS.
   *
   * `withExplicitTenant` מזריק את `app.tenant_id` לטרנזקציה, וזה מה
   * שאוכף את הבידוד. אבל חצי מהשירותים שהצד הציבורי משתמש בהם
   * קוראים גם את `TenantContext` — פענוח איש הקשר, יומן הביקורת,
   * עדכון הכרטיס — וברקע של בקשה בלי עוגייה ההקשר הזה **ריק**,
   * ולכן הם זורקים. שתי השכבות חייבות להיות מוגדרות יחד, ולכן הן
   * נכרכות כאן ולא בכל קורא בנפרד.
   *
   * המשתמש ריק כי אין כזה: את הטופס מילא הלקוח, לא סוכן. היומן
   * רושם את הפעולה בלי לייחס אותה למי שלא עשה אותה.
   */
  private async asOffice<T>(
    tenantId: string,
    fn: (tx: TenantTx) => Promise<T>,
  ): Promise<T> {
    return TenantContext.run(officeContext(tenantId), () =>
      this.prisma.withExplicitTenant(tenantId, fn),
    );
  }

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
          side: true,
        },
      }),
    );
    if (row === null) throw new NotFoundException("הטופס לא נמצא");
    return row;
  }

  /**
   * איש הקשר של הכרטיס — **ואימות שהכרטיס שייך למי שמבקש.**
   *
   * הדייר לבדו אינו מספיק כאן. סוכן עם `buyers.edit` אך בלי
   * `buyers.view_all` אינו רואה את הקונים של חבריו למשרד, ובלי
   * פילטר הבעלות הוא כן היה יכול להנפיק להם קישור ציבורי — ולקבל
   * בתשובה גם `waUrl` ובו מספר הטלפון של לקוח שאינו שלו. אותו
   * פילטר שסוגר את מסך הקונים סוגר גם את הדלת הזו.
   *
   * `404` ולא `403`: לכרטיס של סוכן אחר אין למבקש הרשאה לדעת אפילו
   * שהוא קיים.
   */
  private async contactOf(
    tx: TenantTx,
    subject: IntakeSubject,
    subjectId: string,
  ): Promise<string> {
    const tenantId = TenantContext.current().tenantId;
    if (subject === "open") {
      /*
       * קישור פתוח שכבר נשלח מצביע על קונה, ומאותו רגע הבעלות היא
       * של הכרטיס — בדיוק כמו בכל קישור אחר לקונה. לפני השליחה אין
       * כרטיס, והמסלול הזה אינו מגיע לכאן: `revoke` בודקת קודם.
       */
      const buyer = await tx.buyer.findFirst({
        where: {
          id: subjectId,
          tenantId,
          deletedAt: null,
          ...ownershipFilter("buyers.view_all", "ownerUserId"),
        },
        select: { contactId: true },
      });
      if (buyer === null) throw new NotFoundException("קונה לא נמצא");
      return buyer.contactId;
    }
    if (subject === "buyer") {
      const buyer = await tx.buyer.findFirst({
        where: {
          id: subjectId,
          tenantId,
          deletedAt: null,
          ...ownershipFilter("buyers.view_all", "ownerUserId"),
        },
        select: { contactId: true },
      });
      if (buyer === null) throw new NotFoundException("קונה לא נמצא");
      return buyer.contactId;
    }
    const lead = await tx.lead.findFirst({
      where: {
        id: subjectId,
        tenantId,
        ...ownershipFilter("leads.view_all", "assignedToUserId"),
      },
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
  private async targetBuyerId(
    tx: TenantTx,
    row: TokenRow,
  ): Promise<string | null> {
    /*
     * קישור פתוח שטרם נשלח מצביע על כלום — לא על כרטיס ולא על איש
     * קשר — ולכן אין מה לחפש. חיפוש לפי `contactId` ריק היה מוצא
     * את הקונה הראשון של המשרד ומעדכן **אותו**.
     */
    if (row.subject === "open" && row.subjectId === null) return null;
    const buyer = await tx.buyer.findFirst({
      where: {
        tenantId: row.tenantId,
        deletedAt: null,
        ...(row.subject === "lead"
          ? { contactId: row.contactId ?? "" }
          : { id: row.subjectId ?? "" }),
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

  /** מה שמשותף לכל שורות הכרטיס — נקרא פעם אחת. */
  private async dtoContext(
    tx: TenantTx,
    tenantId: string,
    contactId: string | null,
  ): Promise<DtoContext> {
    const [officeName, contact] = await Promise.all([
      this.officeName(tx, tenantId),
      // קישור פתוח שטרם נשלח — אין איש קשר, ולכן גם אין קישור wa.me
      contactId === null
        ? Promise.resolve(null)
        : this.contacts.getById(tx, contactId),
    ]);
    return { officeName, phone: contact?.phone ?? null };
  }
}

/** ההקשר שנקרא פעם אחת לכל הכרטיס. ראו `dtoContext`. */
interface DtoContext {
  officeName: string;
  phone: string | null;
}

/**
 * ההקשר שהצד הציבורי פועל בו — **של המשרד, לא של סוכן.**
 *
 * `buyers.view_all` ולא `view_own`: „שלי” חסר משמעות כאן, כי אין
 * משתמש. הכרטיס שנכתב נגזר משורת הבקשה עצמה, בתוך הדייר של אותה
 * שורה, ולכן הרוחב הזה אינו פותח דבר שהטוקן לא פתח ממילא. היכולות
 * מצומצמות לזו האחת בכוונה: ההקשר אינו עובר לשום ניתוב, והרחבה
 * שלו הייתה הרחבה של מה שקישור ברחוב שווה.
 */
/**
 * הצד שנבחר — או `null` כשעוד לא נבחר.
 *
 * ‎**עמודת `side` נושאת `buyer` בכל שורה חדשה**, כי זו ברירת המחדל
 * שלה וזה הצד היחיד שהיה קיים עד כה. קריאה שלה כפשוטה הייתה אומרת
 * לעמוד „הלקוח בחר קונה” על טופס שאיש עוד לא נגע בו — והשאלה
 * הפותחת לא הייתה מוצגת לעולם. `submittedAt` הוא מה שמבדיל בין
 * ברירת מחדל לבין בחירה.
 */
function sideOf(side: string, submittedAt: Date | null): IntakeSide | null {
  if (submittedAt === null) return null;
  return isIntakeSide(side) ? side : "buyer";
}

function officeContext(
  tenantId: string,
  userId = "",
): {
  tenantId: string;
  userId: string;
  capabilities: ReadonlySet<Capability>;
  billingOnly: boolean;
} {
  return {
    tenantId,
    userId,
    capabilities: new Set<Capability>(["buyers.view_all"]),
    billingOnly: false,
  };
}

/**
 * גוף ההתראה — מתאר את מה שקרה, ולא את מה שהיה נחמד לומר.
 *
 * ליד בלי כרטיס קונה **לא** עודכן; „עודכן” עליו היה שולח את
 * המתווך לחפש שינוי שאינו קיים. וכרטיס שהעדכון עליו נדחה חייב
 * לומר זאת במפורש, אחרת השינוי אבד בשקט — וזו התקלה הגרועה
 * מבין השלוש.
 */
function notificationBody(result: {
  targetBuyerId: string | null;
  changed: string[];
  applied: boolean;
}): string {
  if (result.targetBuyerId === null) {
    return "הדרישות נשמרו בבקשה — המירו את הליד לקונה כדי שייכנסו לכרטיס";
  }
  if (!result.applied) {
    return "הדרישות נשמרו בבקשה, אך לא נכנסו לכרטיס — בדקו אותן ידנית";
  }
  return result.changed.length > 0
    ? `עודכן: ${result.changed.join(", ")}`
    : "לא היו שינויים לעומת מה שהיה בכרטיס";
}

/** JSON מהמסד → אובייקט, או ריק. מערך ו-`null` אינם דרישות. */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toDto(
  row: {
    id: string;
    token: string;
    subject: string;
    subjectId: string | null;
    status: string;
    channel: string;
    expiresAt: Date;
    openedAt: Date | null;
    submittedAt: Date | null;
    createdAt: Date;
  },
  ctx: DtoContext,
): IntakeRequestDto {
  const url = publicUrl(row.token);
  const message = intakeInviteMessage({ officeName: ctx.officeName, url });
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
      ctx.phone !== null
        ? `https://wa.me/${ctx.phone.replace(/\D/gu, "")}?text=${encodeURIComponent(message)}`
        : null,
    // רק בקישור הפתוח `subjectId` הוא קונה; בשאר הוא הכרטיס שהקישור נשלח ממנו
    buyerId: row.subject === "open" ? row.subjectId : null,
  };
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
    out.cities = req["cities"].filter(
      (c): c is string => typeof c === "string",
    );
  }
  /*
   * רק סוגי נכס שהסכימה מכירה.
   *
   * לפני התיקון העמוד הציבורי הציע `house` ו-`lot`, שאינם קיימים
   * ב-`PropertyTypeSchema`. הם נשמרו בדרישות של מי שסימן אותם,
   * וכשהנתיב הציבורי נסגר על ה-enum האמיתי הם הפכו את הטופס של אותו
   * לקוח לבלתי-שליח: הערך חוזר בפריפיל, נשלח בחזרה, ונדחה — והוא
   * אינו מוצג לו בכלל, ולכן אינו יכול להסיר אותו. מה שלא יוצא מכאן
   * אינו חוזר לכאן, והשליחה הראשונה מנקה את השארית.
   */
  if (Array.isArray(req["propertyTypes"])) {
    out.propertyTypes = req["propertyTypes"].filter(
      (t): t is string =>
        typeof t === "string" && PropertyTypeSchema.safeParse(t).success,
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
  /*
   * חמשת המאפיינים הקבועים בלבד. מאפיין מותאם של המשרד
   * (`custom:נוף לים`) שהיה יוצא לעמוד הציבורי היה חוזר משם בשליחה,
   * והסכימה של הנתיב הציבורי דוחה אותו — כלומר קונה אחד כזה הפך
   * את הטופס שלו לבלתי-שליח, על שדה שהעמוד אינו מציג בכלל.
   */
  if (req["features"] !== undefined) {
    out.features = pickIntakeFeatures(req["features"]);
  }
  const entryType = req["entryType"];
  if (
    entryType === "immediate" ||
    entryType === "by_date" ||
    entryType === "flexible"
  ) {
    out.entryType = entryType;
  }
  const entryBy = req["entryBy"];
  if (typeof entryBy === "string") out.entryBy = entryBy.slice(0, 10);
  else if (entryBy instanceof Date)
    out.entryBy = entryBy.toISOString().slice(0, 10);
  const notes = req["flexibilityNotes"];
  if (typeof notes === "string") out.notes = notes;
  return out;
}
