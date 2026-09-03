import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { Public } from "../../common/auth.decorators";
import { loadEnv } from "../../config/env";
import { PlatformSettingsService } from "../../core/platform-settings.service";
import { WhatsAppInboundService } from "./whatsapp-inbound.service";

/**
 * Webhook נכנס מ-WhatsApp Cloud API (docs/05 §1):
 * - GET: אימות המנוי (hub.challenge) מול VERIFY_TOKEN.
 * - POST: אימות חתימת HMAC-SHA256 על גוף הבקשה הגולמי (X-Hub-Signature-256),
 *   ואז ניתוב ההודעות ל-Inbound Service. כשל אימות ⇒ 401, בלי פירוט.
 *
 * ## שני נתיבים, כי יש שתי אפליקציות
 *
 * קו הסוכן האישי וחיבור המשרדים יושבים באפליקציות Meta נפרדות
 * (docs/12): חסימה של אחת אינה מפילה את השנייה. שתיהן שולחות לכאן,
 * ולכן לכל אחת **נתיב משלה, טוקן אימות משלה וסוד חתימה משלה**:
 *
 * | | קו הסוכן | אפליקציית החיבור |
 * |---|---|---|
 * | נתיב | `/webhooks/whatsapp` | `/webhooks/whatsapp/connect` |
 * | טוקן | `whatsappVerifyToken` | `whatsappConnectVerifyToken` |
 * | חתימה | `whatsappAppSecret` | `whatsappConnectAppSecret` |
 *
 * ‎**קודם שני הנתיבים היו אחד, ושתי החתימות התקבלו על שניהם.** זה
 * עבד — הניתוב לתוכן נעשה לפי `phone_number_id` וממילא לא התערבב —
 * אבל גבול האמון היה משותף: בקשה חתומה בסוד של אפליקציית החיבור
 * התקבלה גם בשם קו הסוכן. בנוסף אי אפשר היה לכבות אפליקציה אחת,
 * להגביל אותה, או לקרוא את היומן שלה בנפרד (הכרעת בעל המוצר).
 *
 * ‎**התקנה עם אפליקציה אחת אינה נוגעת בכלום:** כשהערכים הייעודיים
 * ריקים, נתיב החיבור נופל לאלה של קו הסוכן — ולכן גם מי שהצביע על
 * הנתיב הישן ממשיך לעבוד.
 *
 * ## למה כל דחייה נרשמת ביומן
 *
 * "לא הגיע" ו"הגיע ונדחה" נראים זהים מבחוץ: בשני המקרים המתווך כותב
 * ולא קורה כלום. בהקמה אמיתית זה עלה שעה של ניחושים — App Secret
 * שגוי מייצר בדיוק את אותה שתיקה כמו Webhook שלא הוגדר.
 *
 * לכן כל בקשה נכנסת מותירה שורה: התקבלה, נדחתה, ומאיזו סיבה. **הסיבה
 * בלבד** — לא החתימה, לא הסוד, ולא גוף ההודעה: יומן שמכיל את מה
 * שהוא אמור להגן עליו אינו יומן אבחון אלא דליפה.
 */
@Controller("webhooks/whatsapp")
export class WhatsAppWebhookController {
  private readonly logger = new Logger(WhatsAppWebhookController.name);

  constructor(
    private readonly inbound: WhatsAppInboundService,
    private readonly platformSettings: PlatformSettingsService,
  ) {}

  @Public()
  @Get()
  async verify(
    @Query("hub.mode") mode?: string,
    @Query("hub.verify_token") token?: string,
    @Query("hub.challenge") challenge?: string,
  ): Promise<string> {
    return this.challenge(await this.agentToken(), mode, token, challenge);
  }

  /**
   * אימות המנוי של **אפליקציית החיבור** — טוקן משלה.
   *
   * הנפילה לטוקן של קו הסוכן היא בשביל התקנה עם אפליקציה אחת, שבה
   * שני הנתיבים מובילים לאותו מקום ואין מה להפריד.
   */
  @Public()
  @Get("connect")
  async verifyConnect(
    @Query("hub.mode") mode?: string,
    @Query("hub.verify_token") token?: string,
    @Query("hub.challenge") challenge?: string,
  ): Promise<string> {
    const expected =
      (await this.platformSettings.get("whatsappConnectVerifyToken")) ?? (await this.agentToken());
    return this.challenge(expected, mode, token, challenge);
  }

  /** הטוקן של קו הסוכן. הגדרות הפלטפורמה קודמות; הסביבה כ-Fallback. */
  private async agentToken(): Promise<string | undefined> {
    return (
      (await this.platformSettings.get("whatsappVerifyToken")) ?? loadEnv().WHATSAPP_VERIFY_TOKEN
    );
  }

  private challenge(
    expected: string | undefined,
    mode: string | undefined,
    token: string | undefined,
    challenge: string | undefined,
  ): string {
    if (!expected || mode !== "subscribe" || token !== expected || !challenge) {
      this.logger.warn(
        `אימות Webhook נדחה — ${
          !expected
            ? "לא מוגדר Verify Token במערכת"
            : mode !== "subscribe"
              ? `hub.mode לא צפוי (${mode ?? "חסר"})`
              : token !== expected
                ? "ה-Verify Token אינו תואם למוגדר במערכת"
                : "חסר hub.challenge"
        }`,
      );
      throw new UnauthorizedException();
    }
    this.logger.log("אימות Webhook של וואטסאפ עבר בהצלחה");
    return challenge;
  }

  @Public()
  @Post()
  @HttpCode(200)
  async receive(@Req() req: Request): Promise<{ ok: true }> {
    return this.accept(req, await this.agentSecret());
  }

  /**
   * הודעות מ**אפליקציית החיבור** — חתומות בסוד שלה בלבד.
   *
   * ‎`??` ולא רשימה: כשהסוד הייעודי ריק זו התקנה עם אפליקציה אחת,
   * והנפילה לסוד של קו הסוכן היא מה שמשאיר אותה עובדת. כשהוא מוגדר,
   * הוא **היחיד** שמתקבל כאן — וזו כל הנקודה של ההפרדה.
   */
  @Public()
  @Post("connect")
  @HttpCode(200)
  async receiveConnect(@Req() req: Request): Promise<{ ok: true }> {
    const env = loadEnv();
    const connect =
      (await this.platformSettings.get("whatsappConnectAppSecret")) ??
      env.WHATSAPP_CONNECT_APP_SECRET;
    return this.accept(
      req,
      typeof connect === "string" && connect !== "" ? connect : await this.agentSecret(),
    );
  }

  /** הסוד של קו הסוכן. הגדרות הפלטפורמה קודמות; הסביבה כ-Fallback. */
  private async agentSecret(): Promise<string | undefined> {
    return (
      (await this.platformSettings.get("whatsappAppSecret")) ?? loadEnv().WHATSAPP_APP_SECRET
    );
  }

  /**
   * ‎**סוד אחד לכל נתיב, ולא רשימה שמתקבלת על כולם.**
   *
   * קודם שני הסודות התקבלו על נתיב אחד; ההפרדה לנתיבים היא מה
   * שמחזיר לכל אפליקציה גבול משלה (ראו התיעוד של המחלקה).
   */
  private async accept(req: Request, secret: string | undefined): Promise<{ ok: true }> {
    const secrets = typeof secret === "string" && secret !== "" ? [secret] : [];
    if (secrets.length === 0) {
      // אינטגרציה לא מוגדרת — לא מקבלים כלום (אין מצב "פתוח בטעות").
      this.logger.warn(
        "הודעת וואטסאפ נדחתה — לא מוגדר App Secret במערכת. הגדירו אותו במסך הפלטפורמה.",
      );
      throw new UnauthorizedException();
    }

    const raw = (req as Request & { rawBody?: Buffer }).rawBody;
    const signature = req.headers["x-hub-signature-256"];
    if (!raw || typeof signature !== "string") {
      this.logger.warn(
        `הודעת וואטסאפ נדחתה — ${raw ? "חסרה כותרת X-Hub-Signature-256" : "גוף הבקשה הגולמי לא נשמר"}`,
      );
      throw new UnauthorizedException();
    }
    const received = Buffer.from(signature);
    const matches = secrets.some((secret) => {
      const expected = Buffer.from(
        `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`,
      );
      return expected.length === received.length && timingSafeEqual(expected, received);
    });
    if (!matches) {
      /*
       * הסיבה הנפוצה ביותר בהקמה, והיא בלתי נראית בלי השורה הזו:
       * ה-App Secret שנשמר אינו זה של האפליקציה ששולחת. אין כאן זליגה
       * — נאמר **מה** נכשל, לא מה הערך שהתקבל או הצפוי.
       */
      this.logger.warn(
        `הודעת וואטסאפ נדחתה — חתימת HMAC אינה תואמת לסוד של הנתיב הזה (${req.path}). כמעט תמיד: האפליקציה ששלחה אינה זו שהסוד שייך לה. לכל נתיב סוד משלו — /webhooks/whatsapp לקו הסוכן, /webhooks/whatsapp/connect לאפליקציית החיבור.`,
      );
      throw new UnauthorizedException();
    }

    const body: unknown = req.body;
    if (typeof body !== "object" || body === null) {
      this.logger.warn("הודעת וואטסאפ נדחתה — גוף הבקשה אינו אובייקט");
      throw new BadRequestException();
    }
    this.logger.log("התקבלה הודעת וואטסאפ מאומתת — מנותבת לעיבוד");
    await this.inbound.handle(body as Record<string, unknown>);
    return { ok: true };
  }
}
