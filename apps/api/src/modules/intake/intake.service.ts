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
  pickIntakeFeatures,
  type IntakeAnswers,
  type IntakeStatus,
  type IntakeSubject,
} from "@metavchim/shared";
import { loadEnv } from "../../config/env";
import { ownershipFilter } from "../../common/ownership";
import { TenantContext } from "../../common/tenant-context";
import { AuditService } from "../../core/audit.service";
import { PrismaService, type TenantTx } from "../../core/prisma.service";
import { BuyersService } from "../buyers/buyers.service";
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
    private readonly buyers: BuyersService,
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
        select: { subject: true, subjectId: true },
      });
      if (row === null) throw new NotFoundException("הבקשה לא נמצאה");
      await this.contactOf(tx, row.subject as IntakeSubject, row.subjectId);

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

      const buyerId = await this.targetBuyerId(tx, row);
      const current = await this.currentRequirements(tx, row, buyerId);
      const full = await tx.intakeRequest.findUnique({
        where: { id: row.id },
        select: { status: true, submittedAt: true, answers: true },
      });
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

    const claim = await this.asOffice(row.tenantId, async (tx) => {
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

      /*
       * `resubmit` נקרא **לפני** העדכון: אחריו `submittedAt` תמיד
       * מלא, וההבחנה בין „הלקוח ענה” לבין „הלקוח שלח שוב” הייתה
       * נעלמת.
       */
      const previous = await tx.intakeRequest.findUnique({
        where: { id: row.id },
        select: { submittedAt: true },
      });
      const resubmit =
        previous?.submittedAt !== null && previous?.submittedAt !== undefined;

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
          answers: answers as unknown as Prisma.InputJsonValue,
        },
      });
      if (claimed.count === 0) return null;

      /*
       * היומן נרשם **בכל** שליחה, גם כשאין התראה: הוא הראיה למי
       * נגע בכרטיס ומתי, ודילוג עליו היה יוצר שינוי בלי מקור.
       */
      await this.audit.record(tx, {
        action: "intake.submit",
        entityType: row.subject,
        entityId: row.subjectId,
        // רק שמות שדות — לא מה שנכתב בהם
        metadata: { changed },
      });
      return { targetBuyerId, after, changed, resubmit };
    });

    if (claim === null) {
      throw new BadRequestException("הקישור אינו פעיל עוד");
    }

    const applied =
      claim.targetBuyerId === null
        ? false
        : await this.applyToBuyer(row.tenantId, claim.targetBuyerId, claim.after);

    await this.asOffice(row.tenantId, (tx) =>
      this.notify(tx, row, { ...claim, applied }),
    );
    return { ok: true };
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
   * הסכימה נאכפת לפני הכתיבה. מבנה שאינו עובר אותה אינו נכתב חצי —
   * התשובות כבר שמורות על הבקשה, וההתראה תאמר שהכרטיס לא עודכן.
   */
  private async applyToBuyer(
    tenantId: string,
    buyerId: string,
    requirements: Record<string, unknown>,
  ): Promise<boolean> {
    const parsed = BuyerRequirementsSchema.safeParse(requirements);
    if (!parsed.success) {
      // בלי תוכן הדרישות ביומן — רק העובדה ושמות השדות שנפלו
      this.logger.warn(
        `intake submit: requirements rejected for buyer ${buyerId} — ${parsed.error.issues
          .map((i) => i.path.join("."))
          .join(", ")}`,
      );
      return false;
    }
    await TenantContext.run(officeContext(tenantId), () =>
      this.buyers.update(buyerId, { requirements: parsed.data }),
    );
    return true;
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
        entityType: row.subject,
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

  /** מה שמשותף לכל שורות הכרטיס — נקרא פעם אחת. */
  private async dtoContext(
    tx: TenantTx,
    tenantId: string,
    contactId: string,
  ): Promise<DtoContext> {
    const [officeName, contact] = await Promise.all([
      this.officeName(tx, tenantId),
      this.contacts.getById(tx, contactId),
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
function officeContext(tenantId: string): {
  tenantId: string;
  userId: string;
  capabilities: ReadonlySet<Capability>;
  billingOnly: boolean;
} {
  return {
    tenantId,
    userId: "",
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
