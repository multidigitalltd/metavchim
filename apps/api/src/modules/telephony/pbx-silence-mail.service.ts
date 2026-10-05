import {
  Injectable,
  Logger,
} from "@nestjs/common";
import {
  effectiveCapabilities,
  firstNameOf,
  pbxSilenceEmail,
  pbxSilenceEmailDue,
  shouldNotifyByWhatsApp,
  whatsappNotifyRecipient,
} from "@metavchim/shared";
import { loadEnv } from "../../config/env";
import { EmailService } from "../../core/email.service";
import { PlanCatalogService } from "../../core/plan-catalog.service";
import { PrismaService } from "../../core/prisma.service";
import { Sweep } from "../../core/sweeps";

/**
 * ‎**„המרכזייה השתתקה” במייל — למי שהוואטסאפ לא ישיג.**
 *
 * ‏בקשת המשתמש: „רק מי שמנוי על הסוכן בוואטסאפ יקבל הודעה שהוובהוק
 * ‏במרכזייה כנראה לא פעיל; מי שלא מנוי יקבל רק את ההודעה במייל.”
 * ‏החצי של הוואטסאפ הוא סבב ההתראות בעובדים, והחצי הזה משלים אותו:
 * ‏אותה שורת `notifications`, בערוץ השלישי.
 *
 * ‏כאן ולא בעובדים — מאותה סיבה כמו `ForumMailService`: המייל דורש
 * ‏את `EmailService` (סודות מוצפנים דרך הגדרות הפלטפורמה).
 *
 * ## מי מקבל
 *
 * ‏מנהל פעיל **שרשאי לתקן** (`settings.manage` — אותה יכולת שהקישור
 * ‏בהתראה דורש), ושההתראה **לא הגיעה אליו בוואטסאפ**: אם הוואטסאפ לא
 * ‏ישלח לו אותה — מיד; אם ישלח — רק אם הסבב סגר אותה בלעדיו. „ישלח”
 * ‏נבדק באותו כלל שהסבב מפעיל (`whatsappNotifyRecipient`), כך שמחזיק
 * ‏מקום שכיבה את הוואטסאפ, או שאין לו טלפון תקין, מקבל מייל. ההחלטה נשענת
 * ‏על מה שקרה בוואטסאפ ולא רק על המנוי, כדי ששינוי מנוי בין שני
 * ‏הסבבים לא ישאיר מנהל בלי שום ערוץ או עם שניים — ראו
 * ‏`pbxSilenceEmailDue`. סוכן שאינו יכול לגשת להגדרות המרכזייה אינו
 * ‏מקבל מייל שאין לו מה לעשות איתו; הפעמון נשאר אצלו כמו היום.
 *
 * ## למה אין כאן חותמת „נשלח עד”
 *
 * ‏ההתראה נכתבת פעם ביום לכל היותר (`pbxSilenceDedupeKey`), ולכן
 * ‏המפתח של `EmailService` — התראה ונמען — הוא כל הזיכרון הנדרש:
 * ‏סבב שחוזר על אותה התראה מקבל „כבר יצא” ואינו שולח שוב.
 */

const TICK_MS = 10 * 60 * 1000;
const FIRST_TICK_DELAY_MS = 3 * 60 * 1000;
/**
 * ‏כמה אחורה מסתכלים. המייל אמור להגיע בתוך דקות מההתראה; מעבר לזה
 * ‏(API שהיה למטה חצי יום) הוא כבר אינו חדשות, והפעמון מציג אותה.
 */
const LOOKBACK_MS = 6 * 60 * 60 * 1000;

@Injectable()
export class PbxSilenceMailService {
  private readonly logger = new Logger(PbxSilenceMailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly plans: PlanCatalogService,
  ) {}

  /** סבב אחד. ציבורי כדי שבדיקה תוכל להריץ אותו בלי לחכות. */
  @Sweep({ name: "pbx-silence-mail", everyMs: TICK_MS, firstDelayMs: FIRST_TICK_DELAY_MS })
  async tick(now: Date = new Date()): Promise<void> {
    try {
      if (!(await this.email.isConfigured())) return;
      await this.sendPending(now);
    } catch (error: unknown) {
      this.logger.error(`סבב המייל על שתיקת המרכזייה נכשל: ${String(error)}`);
    }
  }

  private async sendPending(now: Date): Promise<void> {
    const origin = loadEnv().WEB_ORIGIN;
    const since = new Date(now.getTime() - LOOKBACK_MS);
    const tenants = await this.prisma.tenant.findMany({
      where: { status: { in: ["active", "trial"] } },
      select: { id: true, blockedModules: true },
    });

    for (const tenant of tenants) {
      const alerts = await this.prisma.withExplicitTenant(tenant.id, (tx) =>
        tx.notification.findMany({
          where: { tenantId: tenant.id, type: "pbx_silent", createdAt: { gte: since } },
          select: { id: true, title: true, body: true, createdAt: true, whatsappAt: true },
        }),
      );
      if (alerts.length === 0) continue;

      const managers = await this.managers(tenant.id, tenant.blockedModules, now);
      if (managers.length === 0) continue;
      // ‏אותו שער כמו סבב הוואטסאפ: בלי הסוכן בחבילה הוא אינו שולח לאיש
      const agentInPlan = await this.plans.tenantHasFeature(tenant.id, "voice_intake");
      /*
       * ‏עד היכן סבב הוואטסאפ כבר מסר לכל אחד — אותה חותמת שהסבב עצמו
       * ‏נשען עליה כדי לא לשלוח פעמיים.
       */
      const chats = await this.prisma.withExplicitTenant(tenant.id, (tx) =>
        tx.whatsAppChat.findMany({
          where: { tenantId: tenant.id, userId: { in: managers.map((user) => user.id) } },
          select: { userId: true, notifiedThrough: true },
        }),
      );
      const deliveredThrough = new Map(chats.map((chat) => [chat.userId, chat.notifiedThrough]));

      const onWhatsApp = new Set(
        managers
          .filter((user) => {
            const target = agentInPlan ? whatsappNotifyRecipient(user) : null;
            return target !== null && shouldNotifyByWhatsApp("pbx_silent", target.prefs);
          })
          .map((user) => user.id),
      );

      for (const alert of alerts) {
        for (const user of managers) {
          const through = deliveredThrough.get(user.id) ?? null;
          const due = pbxSilenceEmailDue({
            onWhatsApp: onWhatsApp.has(user.id),
            receivedOnWhatsApp: through !== null && through >= alert.createdAt,
            whatsappClosed: alert.whatsappAt !== null,
          });
          if (!due) continue;
          const mail = pbxSilenceEmail({
            firstName: firstNameOf(user.name),
            title: alert.title,
            body: alert.body,
            webOrigin: origin,
          });
          try {
            await this.email.send(user.email, mail.subject, mail.content, {
              idempotency: { key: `pbxsilent:${alert.id}:${user.id}`, purpose: "pbx_silent" },
              autoGenerated: true,
            });
          } catch (error: unknown) {
            // ‏המפתח לא נסגר — הסבב הבא ינסה שוב
            this.logger.warn(`מייל שתיקת המרכזייה לא יצא: ${String(error)}`);
          }
        }
      }
    }
  }

  /**
   * ‏מי במשרד רשאי לתקן את חיבור המרכזייה — ראו „מי מקבל” למעלה.
   *
   * ‏החריגים נקראים בתוך הקשר הדייר: `user_capabilities` תחת RLS,
   * ‏ושאילתה בלעדיו מחזירה אפס שורות בשקט — מנהל שהיכולת שלו הוענקה
   * ‏בחריג לא היה מקבל את המייל.
   */
  private async managers(
    tenantId: string,
    blockedModules: readonly string[],
    now: Date,
  ): Promise<
    {
      id: string;
      name: string;
      email: string;
      whatsappAccess: boolean;
      phone: string | null;
      preferences: unknown;
    }[]
  > {
    const staff = await this.prisma.user.findMany({
      where: { tenantId, isActive: true },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        whatsappAccess: true,
        phone: true,
        preferences: true,
      },
    });
    if (staff.length === 0) return [];
    const overrides = await this.prisma.withExplicitTenant(tenantId, (tx) =>
      tx.userCapability.findMany({
        where: { tenantId, userId: { in: staff.map((user) => user.id) } },
        select: { userId: true, capability: true, effect: true, expiresAt: true },
      }),
    );
    return staff.filter((user) =>
      effectiveCapabilities(
        {
          role: user.role,
          overrides: overrides.filter((row) => row.userId === user.id),
          blockedModules,
        },
        now,
      ).has("settings.manage"),
    );
  }
}
