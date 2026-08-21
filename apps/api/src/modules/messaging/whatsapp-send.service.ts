import { Injectable, Logger } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { PlatformSettingsService } from "../../core/platform-settings.service";

/**
 * שליחה דרך WhatsApp Cloud API (docs/05 §1) — הצד היוצא של הסוכן
 * האישי.
 *
 * האסימון ומזהה המספר יושבים בהגדרות הפלטפורמה (מסך /platform),
 * עם משתני הסביבה כ-Fallback — אותו דפוס כמו סודות ה-Webhook.
 * לא מוגדרים ⇒ המערכת קולטת בלבד ואינה עונה; אין מצב "פתוח בטעות".
 *
 * כשל שליחה אינו זורק: הוובהוק חייב להחזיר 200 ל-Meta גם כשהתשובה
 * שלנו לא יצאה, אחרת ההודעה הנכנסת תישלח שוב ושוב.
 */

const GRAPH_BASE = "https://graph.facebook.com/v23.0";
const SEND_TIMEOUT_MS = 15_000;
/** תקרת Cloud API להודעת טקסט היא 4096 תווים — נחתך עם שוליים. */
const MAX_TEXT_LENGTH = 4000;
/** הקלטה קולית סבירה שוקלת מאות KB; מעל זה משהו אחר קורה. */
const MAX_MEDIA_BYTES = 16 * 1024 * 1024;

export interface WhatsAppCredentials {
  token: string;
  phoneNumberId: string;
}

@Injectable()
export class WhatsAppSendService {
  private readonly logger = new Logger(WhatsAppSendService.name);

  constructor(private readonly platformSettings: PlatformSettingsService) {}

  /** null = הצד היוצא לא הוגדר; הקליטה ממשיכה לעבוד בלעדיו. */
  async credentials(): Promise<WhatsAppCredentials | null> {
    const env = loadEnv();
    const token =
      (await this.platformSettings.get("whatsappAccessToken")) ?? env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId =
      (await this.platformSettings.get("whatsappPhoneNumberId")) ?? env.WHATSAPP_PHONE_NUMBER_ID;
    if (!token || !phoneNumberId) return null;
    return { token, phoneNumberId };
  }

  /** שליחת טקסט. false = לא נשלח (לא מוגדר / Meta דחה) — נרשם ללוג. */
  async sendText(to: string, body: string): Promise<boolean> {
    const creds = await this.credentials();
    if (!creds) {
      this.logger.warn("תשובת וואטסאפ לא נשלחה — הצד היוצא אינו מוגדר");
      return false;
    }
    try {
      const res = await fetch(`${GRAPH_BASE}/${creds.phoneNumberId}/messages`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${creds.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body: body.slice(0, MAX_TEXT_LENGTH), preview_url: false },
        }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      if (!res.ok) {
        // גוף השגיאה של Meta מוגבל בלוג — בלי להדפיס טוקנים בטעות
        const detail = (await res.text()).slice(0, 300);
        this.logger.error(`שליחת וואטסאפ נכשלה: HTTP ${res.status} — ${detail}`);
        return false;
      }
      return true;
    } catch (error) {
      this.logger.error(`שליחת וואטסאפ נכשלה: ${String(error)}`);
      return false;
    }
  }

  /**
   * הורדת מדיה (הקלטה קולית) בשני צעדים, כפי ש-Meta מגדירה:
   * המזהה ⟵ כתובת חתומה קצרת-חיים ⟵ התוכן עצמו, שתיהן עם האסימון.
   */
  async downloadMedia(mediaId: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
    const creds = await this.credentials();
    if (!creds) return null;
    try {
      const metaRes = await fetch(`${GRAPH_BASE}/${encodeURIComponent(mediaId)}`, {
        headers: { authorization: `Bearer ${creds.token}` },
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      if (!metaRes.ok) {
        this.logger.warn(`שליפת פרטי מדיה נכשלה: HTTP ${metaRes.status}`);
        return null;
      }
      const meta = (await metaRes.json()) as {
        url?: string;
        mime_type?: string;
        file_size?: number;
      };
      if (!meta.url) return null;
      if (typeof meta.file_size === "number" && meta.file_size > MAX_MEDIA_BYTES) {
        this.logger.warn(`מדיה גדולה מדי (${meta.file_size} בייט) — נדחתה`);
        return null;
      }
      const fileRes = await fetch(meta.url, {
        headers: { authorization: `Bearer ${creds.token}` },
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS * 2),
      });
      if (!fileRes.ok) {
        this.logger.warn(`הורדת מדיה נכשלה: HTTP ${fileRes.status}`);
        return null;
      }
      const bytes = Buffer.from(await fileRes.arrayBuffer());
      if (bytes.length > MAX_MEDIA_BYTES) return null;
      return { buffer: bytes, mimeType: meta.mime_type ?? "audio/ogg" };
    } catch (error) {
      this.logger.warn(`הורדת מדיה נכשלה: ${String(error)}`);
      return null;
    }
  }

  /**
   * בדיקת חיבור למסך הפלטפורמה — שואל את Graph על המספר עצמו.
   * מחזיר את השם המאומת והמספר כדי שיהיה ברור *מה* חובר, לא רק שחובר.
   */
  async probe(): Promise<{ ok: boolean; message: string }> {
    const creds = await this.credentials();
    if (!creds) {
      return { ok: false, message: "חסרים Access Token או Phone Number ID" };
    }
    try {
      const res = await fetch(
        `${GRAPH_BASE}/${creds.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`,
        {
          headers: { authorization: `Bearer ${creds.token}` },
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string; code?: number };
        } | null;
        const detail = body?.error?.message ?? `HTTP ${res.status}`;
        return {
          ok: false,
          message:
            res.status === 401 || body?.error?.code === 190
              ? `האסימון נדחה על ידי Meta (${detail}) — ודאו שזה טוקן קבוע של System User ולא הטוקן הזמני ממסך הפיתוח`
              : `Meta החזיר שגיאה: ${detail}`,
        };
      }
      const data = (await res.json()) as {
        display_phone_number?: string;
        verified_name?: string;
      };
      return {
        ok: true,
        message: `מחובר: ${data.verified_name ?? "ללא שם מאומת"} · ${data.display_phone_number ?? creds.phoneNumberId}`,
      };
    } catch (error) {
      return { ok: false, message: `החיבור ל-Meta נכשל: ${String(error)}` };
    }
  }
}
