import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import * as argon2 from "argon2";
import { ulid } from "ulid";
import { TenantContext } from "../../common/tenant-context";
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
 * מה נשאר, ולמה — שני חריגים מתועדים:
 * - `payments`: רשומות הסליקה של הפלטפורמה מול המשרד. אלה מסמכים
 *   כספיים בחובת שמירה חוקית, והם אינם מכילים פרט אישי — סכומים,
 *   מזהי עסקה ומספרי מסמך בלבד.
 * - `audit_log`: מוגן ברמת בסיס הנתונים — ‎REVOKE UPDATE, DELETE‎
 *   מתפקיד האפליקציה, כדי שגם תוקף עם הרשאות האפליקציה לא יוכל
 *   לטשטש עקבות. נשארות בו שורות פעולה עם מזהים בלבד (בלי שמות,
 *   טלפונים או תוכן). רשומת המחיקה עצמה נכתבת אליו במכוון — זו
 *   הראיה היחידה שהמשרד היה קיים ונמחק.
 *
 * גיבויים: קבצי הגיבוי היומיים מתגלגלים החוצה לפי מדיניות השמירה
 * שלהם — הנתונים נעלמים גם משם בתוך חלון השמירה.
 */
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async deleteAccount(input: { confirmName: string; currentPassword?: string }): Promise<{
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
        throw new BadRequestException("למחיקת החשבון יש להזין את הסיסמה הנוכחית");
      }
      const ok = await argon2.verify(user.passwordHash, input.currentPassword).catch(() => false);
      if (!ok) throw new UnauthorizedException("הסיסמה שגויה");
    }

    /*
     * מפתחות ה-S3 נאספים לפני שהשורות שמכירות אותם נמחקות — אחרי
     * המחיקה אין שום רשומה שיודעת אילו קבצים היו של המשרד.
     */
    const [media, calls] = await Promise.all([
      this.prisma.withTenant((tx) =>
        tx.propertyMedia.findMany({ where: { tenantId }, select: { s3Key: true } }),
      ),
      this.prisma.withTenant((tx) =>
        tx.call.findMany({
          where: { tenantId, recordingKey: { not: null } },
          select: { recordingKey: true },
        }),
      ),
    ]);
    const s3Keys = [
      ...media.map((m) => m.s3Key),
      ...calls.map((c) => c.recordingKey).filter((k): k is string => k !== null),
    ];

    // הראיה האחרונה — נכתבת לפני המחיקה, כי audit_log נשאר במכוון
    await this.prisma.withTenant((tx) =>
      tx.auditLog.create({
        data: {
          id: ulid(),
          tenantId,
          userId,
          action: "tenant.delete_account",
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
        await tx.contactLink.deleteMany({ where: { tenantId } });
        await tx.contactPhone.deleteMany({ where: { tenantId } });
        await tx.interaction.deleteMany({ where: { tenantId } });
        await tx.voiceIntake.deleteMany({ where: { tenantId } });
        await tx.match.deleteMany({ where: { tenantId } });
        await tx.offer.deleteMany({ where: { tenantId } });
        await tx.message.deleteMany({ where: { tenantId } });
        await tx.call.deleteMany({ where: { tenantId } });
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
         * לידים שנמכרו ברשת נמחקים גם הם: פרטי הקשר שבהם הם PII של
         * לקוחות המשרד הנמחק, וזכות המחיקה גוברת. משרד שקנה ליד כבר
         * קיבל את הפרטים לכרטיס משלו בעת הרכישה.
         */
        await tx.sharedLead.deleteMany({ where: { tenantId } });
        // הצעות שת"פ — משני הצדדים; פוליסת coop_delete מתירה בדיוק את זה
        await tx.coopOffer.deleteMany({
          where: { OR: [{ fromTenantId: tenantId }, { toTenantId: tenantId }] },
        });
        await tx.creditLedger.deleteMany({ where: { tenantId } });
        await tx.duplicateDismissal.deleteMany({ where: { tenantId } });
        await tx.googleCalendarLink.deleteMany({ where: { tenantId } });
        await tx.userCapability.deleteMany({ where: { tenantId } });
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

    this.logger.warn(`חשבון נמחק לצמיתות: tenant ${tenantId} (${s3Keys.length} קבצים בניקוי)`);
    return { ok: true };
  }
}
