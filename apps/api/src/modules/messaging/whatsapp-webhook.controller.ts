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
    // הגדרות הפלטפורמה (מסך /platform) קודמות; משתנה הסביבה כ-Fallback
    const expected =
      (await this.platformSettings.get("whatsappVerifyToken")) ?? loadEnv().WHATSAPP_VERIFY_TOKEN;
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
    /*
     * ‎**שני סודות אפשריים, כי שתי אפליקציות יכולות לחתום על אותו קו.**
     *
     * ‏קו הסוכן האישי וחיבור המשרדים יכולים לשבת באפליקציות נפרדות
     * ב-Meta — הפרדה לגיטימית ואף רצויה, כי חסימה של אחת אינה מפילה
     * את השנייה. שתיהן מצביעות על אותה כתובת Webhook, וכל אחת חותמת
     * ב-App Secret משלה. בדיקה מול סוד יחיד הייתה דוחה ב-401 את כל
     * מה שמגיע מהאפליקציה השנייה — כלומר „החיבור הצליח ואין הודעות”,
     * הכשל השקט שהכי קשה לאבחן כאן.
     *
     * ‏Set מסלק כפילות כשהוגדר אותו ערך פעמיים או כשיש רק אפליקציה אחת.
     */
    const env = loadEnv();
    const secrets = [
      ...new Set(
        [
          (await this.platformSettings.get("whatsappAppSecret")) ?? env.WHATSAPP_APP_SECRET,
          (await this.platformSettings.get("whatsappConnectAppSecret")) ??
            env.WHATSAPP_CONNECT_APP_SECRET,
        ].filter((value): value is string => typeof value === "string" && value !== ""),
      ),
    ];
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
        `הודעת וואטסאפ נדחתה — חתימת HMAC אינה תואמת לאף אחד מ-${secrets.length} הסודות המוגדרים. כמעט תמיד: ה-App Secret במסך הפלטפורמה אינו של האפליקציה ששלחה. אפליקציית חיבור נפרדת דורשת את הסוד שלה בשדה הייעודי.`,
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
