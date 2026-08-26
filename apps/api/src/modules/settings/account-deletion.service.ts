import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import * as argon2 from "argon2";
import { lockTenantProperties } from "../../common/locks";
import { ulid } from "ulid";
import { TenantContext } from "../../common/tenant-context";
import { deleteCoopDeals } from "../../common/coop-deal-cleanup";
import { PrismaService } from "../../core/prisma.service";

/**
 * מחיקת חשבון מלאה — המשרד כולו, לצמיתות.
 *
 * מי ואיך: בעל המשרד בלבד, עם הקלדת שם המשרד לאישור והסיסמה הנוכחית
 * (לחשבון Google אין סיסמה — שם המשרד הוא האישור). אין "רכה" ואין
 * שחזור: המשתמש ביקש שאחרי המחיקה לא יישמר שום פרט מהחשבון.
 *
 * מה נמחק: כל טבלאות הדייר (לקוחות, נכסים, קונים, לידים, שיחות,
 * תמלולים, הסכמים כולל חתימות ות"ז, הודעות, פגישות, משימות...),
 * המשתמשים והחיבורים שלהם (sessions נמחקים ב-CASCADE), שורת המנוי
 * (כולל טוקן האשראי ות"ז מוצפנת), וקבצי ה-S3 בשני הפרפיקסים —
 * ‎tenants/{id}/…‎ (תמונות נכסים) ו-‎calls/{id}/…‎ (הקלטות) — דרך
 * אירועי ‎storage.cleanup_object‎ שה-worker מריץ עד הצלחה.
 *
 * מה נשאר, ולמה — שלושה חריגים מתועדים, כולם בלי פרט אישי:
 * - `payments`: רשומות הסליקה של הפלטפורמה מול המשרד. אלה מסמכים
 *   כספיים בחובת שמירה חוקית, והם אינם מכילים פרט אישי — סכומים,
 *   מזהי עסקה ומספרי מסמך בלבד.
 * - `audit_log`: מוגן ברמת בסיס הנתונים — ‎REVOKE UPDATE, DELETE‎
 *   מתפקיד האפליקציה, כדי שגם תוקף עם הרשאות האפליקציה לא יוכל
 *   לטשטש עקבות. נשארות בו שורות פעולה עם מזהים בלבד (בלי שמות,
 *   טלפונים או תוכן). רשומת המחיקה עצמה נכתבת אליו במכוון — זו
 *   הראיה היחידה שהמשרד היה קיים ונמחק.
 * - `credit_ledger`: מאזן הקרדיטים של שוק השת"פ — Append-Only עם
 *   אותו REVOKE, כי תנועת קרדיטים שנמחקת היא כסף שנעלם מהמאזן.
 *   מזהים, סוג תנועה וסכום בלבד.
 * - `payout_ledger`: אותו דבר בשקלים — הספר של הכסף שהפלטפורמה
 *   שילמה למשרד. מוגן באותו REVOKE ומאותו טעם, ואין בו פרט מזהה.
 *   **`payout_requests` כן נמחקת** — שם יושבים פרטי חשבון הבנק,
 *   וזכות המחיקה גוברת על נוחות התיעוד. הראיה שהכסף יצא נשארת
 *   בספר.
 *
 * גיבויים: קבצי הגיבוי היומיים מתגלגלים החוצה לפי מדיניות השמירה
 * שלהם — הנתונים נעלמים גם משם בתוך חלון השמירה.
 */
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async deleteAccount(input: {
    confirmName: string;
    currentPassword?: string;
  }): Promise<{
    ok: true;
  }> {
    const { tenantId, userId } = TenantContext.current();

    const [user, tenant] = await Promise.all([
      this.prisma.user.findFirst({ where: { id: userId, tenantId } }),
      this.prisma.tenant.findUnique({ where: { id: tenantId } }),
    ]);
    if (!tenant) throw new NotFoundException("המשרד לא נמצא");
    if (!user || user.role !== "owner") {
      throw new ForbiddenException("רק בעל המשרד יכול למחוק את החשבון");
    }
    if (input.confirmName.trim() !== tenant.name.trim()) {
      throw new BadRequestException("שם המשרד שהוקלד אינו תואם — המחיקה בוטלה");
    }
    if (user.passwordHash !== null) {
      if (!input.currentPassword) {
        throw new BadRequestException(
          "למחיקת החשבון יש להזין את הסיסמה הנוכחית",
        );
      }
      const ok = await argon2
        .verify(user.passwordHash, input.currentPassword)
        .catch(() => false);
      if (!ok) throw new UnauthorizedException("הסיסמה שגויה");
    }

    return this.purgeTenant(tenantId, userId, "tenant.delete_account");
  }

  /**
   * מחיקת משרד ביוזמת בעל הפלטפורמה.
   *
   * אותה מחיקה בדיוק — אין "מחיקה חלקית" למי שמוחק מבחוץ. מה ששונה
   * הוא **מי מאשר**: אין כאן סיסמה של בעל המשרד (הפלטפורמה אינה
   * מחזיקה אותה ואינה אמורה), ולכן האישור היחיד הוא הקלדת שם המשרד
   * במדויק. זו אותה הגנה מפני לחיצה על השורה הלא נכונה ברשימה.
   *
   * ביומן הביקורת נרשמת פעולה **אחרת** מזו של מחיקה עצמית, ובלי
   * מזהה משתמש: המוחק אינו משתמש של המשרד הזה, ורישום שלו כאילו היה
   * אחד מהם הופך את היומן — הראיה היחידה שנשארת — לשקר.
   */
  async deleteTenantFromPlatform(
    tenantId: string,
    confirmName: string,
  ): Promise<{ ok: true }> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) throw new NotFoundException("המשרד לא נמצא");
    if (confirmName.trim() !== tenant.name.trim()) {
      throw new BadRequestException("שם המשרד שהוקלד אינו תואם — המחיקה בוטלה");
    }
    return this.purgeTenant(tenantId, null, "tenant.delete_by_platform");
  }

  /**
   * המחיקה עצמה. **בלי בדיקות הרשאה** — הן באחריות הקוראים, וכל אחד
   * מהם מאשר אחרת (בעלים עם סיסמה, פלטפורמה עם שם המשרד).
   *
   * `actorUserId` הוא null כשהמוחק אינו משתמש של המשרד.
   */
  private async purgeTenant(
    tenantId: string,
    actorUserId: string | null,
    action: string,
  ): Promise<{ ok: true }> {
    /*
     * מפתחות ה-S3 נאספים לפני שהשורות שמכירות אותם נמחקות — אחרי
     * המחיקה אין שום רשומה שיודעת אילו קבצים היו של המשרד.
     *
     * withExplicitTenant ולא withTenant: המחיקה מהפלטפורמה רצה
     * בהקשר של דייר אחר לגמרי, והטבלאות תחת FORCE RLS היו מחזירות
     * אפס מפתחות בשקט — כלומר הקבצים היו נשארים ב-S3 לנצח.
     */
    const [media, calls, tickets, tenantRow] = await Promise.all([
      this.prisma.withExplicitTenant(tenantId, (tx) =>
        tx.propertyMedia.findMany({
          where: { tenantId },
          select: { s3Key: true },
        }),
      ),
      this.prisma.withExplicitTenant(tenantId, (tx) =>
        tx.call.findMany({
          where: { tenantId, recordingKey: { not: null } },
          select: { recordingKey: true },
        }),
      ),
      /*
       * צילומי המסך של פניות התמיכה.
       *
       * צילום מסך של המערכת הוא בדיוק מה שהוא נשמע: כרטיס לקוח
       * פתוח, רשימת נכסים, לפעמים מספר טלפון. הוא נאסף כאן מאותה
       * סיבה שתמונות הנכסים וההקלטות נאספות — אחרי מחיקת השורות אין
       * דבר שיודע אילו קבצים היו של המשרד.
       */
      this.prisma.withExplicitTenant(tenantId, (tx) =>
        tx.supportTicket.findMany({
          where: { tenantId, screenshotKey: { not: null } },
          select: { screenshotKey: true },
        }),
      ),
      /*
       * הלוגו — מפתח שיושב ב-`settings` ולא בטבלה משלו, ולכן הוא
       * אינו נאסף בשתי השאילתות שמעל. בלי השורה הזו הוא היה נשאר
       * ב-S3 אחרי מחיקת המשרד: קובץ של לקוח שביקש להימחק.
       */
      this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { settings: true },
      }),
    ]);
    const logoKey = (tenantRow?.settings as Record<string, unknown> | null)?.["logoKey"];
    const s3Keys = [
      ...media.map((m) => m.s3Key),
      ...tickets
        .map((t) => t.screenshotKey)
        .filter((k): k is string => k !== null),
      ...calls
        .map((c) => c.recordingKey)
        .filter((k): k is string => k !== null),
      ...(typeof logoKey === "string" ? [logoKey] : []),
    ];

    // הראיה האחרונה — נכתבת לפני המחיקה, כי audit_log נשאר במכוון
    await this.prisma.withExplicitTenant(tenantId, (tx) =>
      tx.auditLog.create({
        data: {
          id: ulid(),
          tenantId,
          userId: actorUserId,
          action,
          entityType: "tenant",
          entityId: tenantId,
          metadata: { s3Objects: s3Keys.length },
        },
      }),
    );

    /*
     * טבלאות ה-RLS — טרנזקציה אחת עם תקרת זמן מוגדלת: מחיקת משרד
     * גדול היא אלפי שורות, וברירת המחדל של Prisma (5 שניות) קצרה
     * מדי. הסדר מוכתב רק בשני מקומות: property_media לפני properties
     * (FK RESTRICT), וניקוי ה-outbox הישן לפני יצירת אירועי ניקוי
     * ה-S3 — האירועים החדשים חייבים לשרוד את המחיקה כדי שה-worker
     * ימחק את הקבצים.
     */
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
        /*
         * ‎**נעילת נכסי המשרד — הדבר הראשון בטרנזקציה.**
         *
         * מחיקת המשרד נוגעת בכל מה שתלוי בנכס: המדיה שלו, הפרסום
         * שלו ברשת, ההצעות עליו. כל אחד מהם הוא שורה שנתיב אחר
         * נועל **אחרי** שהוא כבר מחזיק את שורת הנכס — מחיקת תמונה
         * נועלת נכס ואז מעדכנת את הפרסום דרך `syncPhotoKeys`.
         *
         * נעילה שנלקחת באמצע הרשימה סוגרת מעגל מול כל מה שקדם לה:
         * המחיקה מחזיקה פרסום וממתינה לנכס, בעוד מחיקת התמונה
         * מחזיקה נכס וממתינה לפרסום. זו בדיוק הטעות שתיקנתי כאן
         * פעם אחת ונשארה, כי הזזתי את הנעילה במקום להקדים אותה
         * (ביקורת Codex).
         *
         * לכן היא ראשונה, ולא „לפני המדיה”: כשהיא ראשונה אין מה
         * שיקדם לה, ואין צורך לדעת מראש איזו טבלה מתנגשת עם מי.
         */
        await lockTenantProperties(tx, tenantId);
        await tx.contactLink.deleteMany({ where: { tenantId } });
        await tx.contactPhone.deleteMany({ where: { tenantId } });
        await tx.interaction.deleteMany({ where: { tenantId } });
        await tx.voiceIntake.deleteMany({ where: { tenantId } });
        await tx.match.deleteMany({ where: { tenantId } });
        await tx.offer.deleteMany({ where: { tenantId } });
        await tx.message.deleteMany({ where: { tenantId } });
        // שיחות הסוכן בוואטסאפ — ההצעות וההיסטוריה מכילות פרטי לקוחות
        await tx.whatsAppChat.deleteMany({ where: { tenantId } });
        await tx.agentEvent.deleteMany({ where: { tenantId } });
        await tx.call.deleteMany({ where: { tenantId } });
        // צילומי הניתוב של שיחות שעדיין באוויר ברגע המחיקה
        await tx.callRouting.deleteMany({ where: { tenantId } });
        await tx.appointment.deleteMany({ where: { tenantId } });
        await tx.task.deleteMany({ where: { tenantId } });
        await tx.taskRecurrence.deleteMany({ where: { tenantId } });
        await tx.notification.deleteMany({ where: { tenantId } });
        await tx.pushSubscription.deleteMany({ where: { tenantId } });
        await tx.agreement.deleteMany({ where: { tenantId } });
        await tx.agreementTemplate.deleteMany({ where: { tenantId } });
        await tx.integration.deleteMany({ where: { tenantId } });
        await tx.sharedDemand.deleteMany({ where: { tenantId } });
        /*
         * דירוגי הפניות — משני התפקידים. נמחקים **לפני** ההפניות
         * עצמן, ואינם נשארים כשורות יתומות שמצביעות על הפניה שאיננה.
         * ההערה החופשית שבהם היא טקסט שהמשרד הנמחק כתב או שנכתב
         * עליו, ולכן היא הולכת איתו.
         */
        await tx.leadReferralRating.deleteMany({
          where: {
            OR: [{ sellerTenantId: tenantId }, { buyerTenantId: tenantId }],
          },
        });
        /*
         * המונים של משרדים אחרים אינם מתוקנים כאן, **במכוון**: דירוג
         * שניתן בזמנו על הפניה אמיתית נשאר חלק מהמוניטין גם אחרי
         * שהמדרג סגר חשבון. אין בהם פרט מזהה — סכום ומונה בלבד.
         */
        await tx.referralReputation.deleteMany({ where: { tenantId } });
        // אותו מוניטין, מפורק לממדים — אותה שורה של המשרד הנמחק
        // ומאותו נימוק. שכחה שלה הייתה משאירה את הפירוט תלוי באוויר
        // אחרי שהציון המצרפי כבר נעלם.
        await tx.referralReputationDimension.deleteMany({ where: { tenantId } });
        /*
         * הפניות שפורסמו נמחקות גם הן: פרטי הקשר שבהן הם PII של
         * לקוחות המשרד הנמחק, וזכות המחיקה גוברת. משרד שקלט הפניה
         * כבר קיבל את הפרטים לכרטיס משלו בעת הקליטה.
         */
        await tx.sharedLead.deleteMany({ where: { tenantId } });
        /*
         * חדרי העסקה — השרשור לפני החדר, כי הוא מצביע עליו.
         *
         * החדר נמחק **משני הצדדים** ולא רק אצל הנמחק: אותו נימוק
         * בדיוק כמו בהצעות ובפרסומים. שרשור שנשאר חי אצל המשרד
         * השני הוא התכתבות עם משרד שכבר אינו קיים, ובתוכה שמות
         * הסוכנים שנמחקו.
         *
         * `coop_deal_messages` נמחקת דרך פוליסת ה-DELETE שנגזרת
         * מהחדר, ולכן היא חייבת להיות לפניו — אחרי שהחדר נמחק אין
         * שורה שממנה הפוליסה תאשר.
         */
        await deleteCoopDeals(tx, {
          OR: [{ listingTenantId: tenantId }, { buyerTenantId: tenantId }],
        });
        // הצעות שת"פ — משני הצדדים; פוליסת coop_delete מתירה בדיוק את זה
        await tx.coopOffer.deleteMany({
          where: { OR: [{ fromTenantId: tenantId }, { toTenantId: tenantId }] },
        });
        /*
         * הכיוון השני של הרשת — פרסומי נכסים והפניות עליהם.
         *
         * לטבלאות האלה אין מפתח זר ל-`tenants` ואין מחיקה מדורגת,
         * ולכן משרד יכול היה למחוק את חשבונו בהצלחה בעוד הנכס שפרסם
         * ממשיך להופיע בפיד של כל משרד אחר — לצמיתות (ביקורת Codex).
         * מחיקה שאינה שלמה אינה מחיקה.
         *
         * הפרסומים לפני הפניות: פנייה מצביעה על פרסום, ומחיקה
         * בסדר ההפוך הייתה משאירה רגע שבו היא מצביעה על מה שאיננו.
         */
        await tx.coopInterest.deleteMany({
          where: { OR: [{ fromTenantId: tenantId }, { toTenantId: tenantId }] },
        });
        await tx.sharedListing.deleteMany({ where: { tenantId } });
        /*
         * credit_ledger **לא** נמחק — חריג שלישי, מאותו טעם כמו
         * audit_log: הטבלה Append-Only עם REVOKE UPDATE, DELETE
         * מתפקיד האפליקציה (מיגרציית collaboration), כי היא מאזן
         * הקרדיטים של שוק השת"פ ותנועה שנעלמת היא כסף שנעלם.
         * ניסיון deleteMany כאן היה נופל על permission denied ומפיל
         * את כל המחיקה (ביקורת Codex). אין בשורות שום פרט אישי —
         * מזהים, סוג תנועה וסכום בלבד.
         */
        /*
         * בקשות המשיכה נמחקות בגלל פרטי הבנק שבהן; `payout_ledger`
         * לא — הוא Append-Only עם REVOKE, בדיוק כמו credit_ledger,
         * וניסיון מחיקה שלו היה נופל על permission denied ומפיל את
         * כל המחיקה.
         */
        await tx.payoutRequest.deleteMany({ where: { tenantId } });
        /*
         * פניות התמיכה — **נשכחו כאן עד היום.**
         *
         * הן נראות כמו נתוני שירות, ובפועל הן הטבלה עם הטקסט החופשי
         * ביותר במערכת: שם המשתמש, כתובת האימייל שלו, מה שהוא כתב
         * בלשונו, ותשובת התמיכה. צילום המסך שמצורף אליהן הוא בדיוק
         * מה שהוא נשמע — כרטיס לקוח פתוח על המסך. כל זה שרד את
         * „מחיקת חשבון מלאה” בשקט.
         *
         * הפוליסה `support_desk` אינה מפריעה: היא **מוסיפה** גישה
         * לתמיכה, וה-`tenant_isolation` הרגילה מספיקה למחיקה כאן.
         */
        await tx.supportTicket.deleteMany({ where: { tenantId } });
        await tx.duplicateDismissal.deleteMany({ where: { tenantId } });
        await tx.googleCalendarLink.deleteMany({ where: { tenantId } });
        await tx.gmailLink.deleteMany({ where: { tenantId } });
        await tx.userCapability.deleteMany({ where: { tenantId } });
        /*
         * רישומי „עדכנו אותי כשזה עולה” וקישורי הנכסים התאומים.
         *
         * לשתי הטבלאות אין מפתח זר לשורת המשרד, ולכן הן **אינן**
         * נופלות איתה: בלי המחיקה כאן היו נשארות שורות עם `tenant_id`
         * של משרד שנמחק — בדיוק ההפך מ„שום פרט לא נשמר אחריה”.
         */
        await tx.featureSignup.deleteMany({ where: { tenantId } });
        await tx.propertyTwin.deleteMany({ where: { tenantId } });
        /*
         * בקשות טופס הלקוח — כולל `answers`, שהוא מה שהלקוח כתב על
         * עצמו. אותו נימוק: אין מפתח זר לשורת המשרד, ולכן בלי
         * המחיקה כאן הן היו שורדות אותה.
         */
        await tx.intakeRequest.deleteMany({ where: { tenantId } });
        // תיק הבלעדיות — פעולות לפני תקופות, ושתיהן לפני הנכסים
        await tx.marketingAction.deleteMany({ where: { tenantId } });
        await tx.propertyExclusivity.deleteMany({ where: { tenantId } });
        await tx.propertyMedia.deleteMany({ where: { tenantId } });
        await tx.property.deleteMany({ where: { tenantId } });
        await tx.buyer.deleteMany({ where: { tenantId } });
        await tx.lead.deleteMany({ where: { tenantId } });
        await tx.contact.deleteMany({ where: { tenantId } });

        await tx.outboxEvent.deleteMany({ where: { tenantId } });
        if (s3Keys.length > 0) {
          await tx.outboxEvent.createMany({
            data: s3Keys.map((s3Key) => ({
              id: ulid(),
              tenantId,
              name: "storage.cleanup_object",
              payload: { tenantId, s3Key },
            })),
          });
        }
      },
      { timeout: 120_000, maxWait: 10_000 },
    );

    /*
     * מחוץ ל-RLS: משתמשים (sessions נופלים איתם ב-CASCADE), המנוי —
     * שמכיל טוקן אשראי ות"ז מוצפנת ולכן נמחק ולא מבוטל, מפתחות
     * קליטת הלידים, ולבסוף שורת המשרד עצמה (אחרי המשתמשים — יש
     * עליה FK RESTRICT).
     */
    await this.prisma.$transaction([
      this.prisma.leadWebhook.deleteMany({ where: { tenantId } }),
      this.prisma.subscription.deleteMany({ where: { tenantId } }),
      this.prisma.user.deleteMany({ where: { tenantId } }),
      this.prisma.tenant.delete({ where: { id: tenantId } }),
    ]);

    this.logger.warn(
      `משרד נמחק לצמיתות (${action}): tenant ${tenantId} (${s3Keys.length} קבצים בניקוי)`,
    );
    return { ok: true };
  }
}
