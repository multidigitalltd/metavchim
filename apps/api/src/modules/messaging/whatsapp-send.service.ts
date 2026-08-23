import { Injectable, Logger } from "@nestjs/common";
import {
  fitsInteractive,
  listPayload,
  replyButtonsPayload,
  splitForWhatsApp,
  type WhatsAppButton,
  type WhatsAppListRow,
} from "@metavchim/shared";
import { loadEnv } from "../../config/env";
import { PlatformSettingsService } from "../../core/platform-settings.service";
import { toWhatsAppAudio } from "./audio-transcode";

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
/** הקלטה קולית סבירה שוקלת מאות KB; מעל זה משהו אחר קורה. */
const MAX_MEDIA_BYTES = 16 * 1024 * 1024;

export interface WhatsAppCredentials {
  token: string;
  phoneNumberId: string;
}

export interface SendTextOptions {
  /**
   * ההודעה שהתשובה עונה עליה — מצוטטת מעליה בצ'אט.
   *
   * לא קישוט: המתווך שולח שלוש בקשות ברצף ומקבל שלוש תשובות, ובלי
   * הציטוט אי אפשר לדעת איזו תשובה שייכת לאיזו בקשה. גם הודעה
   * שמגיעה דקה אחרי שהוא כבר המשיך הלאה מוצאת את ההקשר שלה.
   */
  replyTo?: string;
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

  /**
   * שליחת טקסט. false = לא נשלח (לא מוגדר / Meta דחה) — נרשם ללוג.
   *
   * תשובה ארוכה נשלחת בכמה הודעות ולא נחתכת: ראו `whatsapp-text`.
   * הציטוט מוצמד להודעה הראשונה בלבד — ציטוט על כל חלק היה מציף
   * את הצ'אט בשכפולים של אותה בקשה.
   */
  async sendText(to: string, body: string, options: SendTextOptions = {}): Promise<boolean> {
    const creds = await this.credentials();
    if (!creds) {
      this.logger.warn("תשובת וואטסאפ לא נשלחה — הצד היוצא אינו מוגדר");
      return false;
    }
    const chunks = splitForWhatsApp(body);
    if (chunks.length === 0) return true;
    for (const [index, chunk] of chunks.entries()) {
      const sent = await this.post(creds, {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: chunk, preview_url: false },
        ...(index === 0 && options.replyTo !== undefined
          ? { context: { message_id: options.replyTo } }
          : {}),
      });
      // חלק שנכשל עוצר את השאר: המשך בלי ההתחלה מבלבל יותר מכלום
      if (!sent) return false;
    }
    return true;
  }

  /**
   * הודעה עם כפתורי תשובה מהירה (עד שלושה).
   *
   * false גם כשהגוף ארוך מ-1024 התווים שהודעה אינטראקטיבית מתירה:
   * הקורא נופל בחזרה לטקסט רגיל במקום שהודעה שלמה תידחה אצל Meta.
   * כפתורים אפשריים רק בתוך חלון 24 השעות — כאן זה תמיד המצב, כי
   * הם נשלחים בתגובה להודעה של המתווך.
   */
  async sendButtons(
    to: string,
    body: string,
    buttons: readonly WhatsAppButton[],
  ): Promise<boolean> {
    if (!fitsInteractive(body) || buttons.length === 0) return false;
    const creds = await this.credentials();
    if (!creds) return false;
    return this.post(creds, replyButtonsPayload(to, body, buttons));
  }

  /** רשימת בחירה — ליותר משלושה מועמדים. אותה נפילה חזרה לטקסט. */
  async sendList(
    to: string,
    body: string,
    openLabel: string,
    rows: readonly WhatsAppListRow[],
  ): Promise<boolean> {
    if (!fitsInteractive(body) || rows.length === 0) return false;
    const creds = await this.credentials();
    if (!creds) return false;
    return this.post(creds, listPayload(to, body, openLabel, rows));
  }

  /**
   * „נקרא” + „מקליד…” על ההודעה שהגיעה — הסימן היחיד שהמתווך מקבל
   * בזמן שהסוכן עובד.
   *
   * סבב מלא (תמלול, הבנה, שליפה) אורך עשרות שניות, ועד היום הצ'אט
   * היה דומם לגמרי כל אותו זמן — כלומר נראה בדיוק כמו מערכת שלא
   * קיבלה את ההודעה. Meta מאפשרת לשלוח את שניהם בבקשה אחת, וסימון
   * ההקלדה נמשך עד 25 שניות או עד שהתשובה יוצאת.
   *
   * best-effort: כישלון כאן לעולם אינו מונע את התשובה עצמה.
   */
  async markRead(messageId: string, typing = false): Promise<void> {
    const creds = await this.credentials();
    if (!creds) return;
    await this.post(creds, {
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
      ...(typing ? { typing_indicator: { type: "text" } } : {}),
    });
  }

  /**
   * תגובת אימוג'י על הודעה — קבלה שקטה, בלי להוסיף הודעה לצ'אט.
   * משמשת לאישור קבלת הקלטה קולית לפני שהתמלול בכלל התחיל.
   */
  async react(to: string, messageId: string, emoji: string): Promise<void> {
    const creds = await this.credentials();
    if (!creds) return;
    await this.post(creds, {
      messaging_product: "whatsapp",
      to,
      type: "reaction",
      reaction: { message_id: messageId, emoji },
    });
  }

  /** קריאת POST אחת ל-Graph. שגיאות נרשמות ואינן נזרקות. */
  private async post(
    creds: WhatsAppCredentials,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    try {
      const res = await fetch(`${GRAPH_BASE}/${creds.phoneNumberId}/messages`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${creds.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
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
   * שליחת הקלטה כהודעת שמע — הכיוון ההפוך של `downloadMedia`.
   *
   * Meta אינה מקבלת בייטים בהודעה עצמה: קודם מעלים ל-`/media`
   * ומקבלים מזהה, ואז שולחים הודעה שמצביעה עליו. שני הצעדים כאן
   * ולא בקורא, כדי שהערוץ ידע רק „שלח את ההקלטה הזו”.
   *
   * ההקלטה מומרת לפני ההעלאה. ההנחה הקודמת — „נשלח את מה שיש,
   * וזה יגיע כקובץ מצורף” — פשוט אינה נכונה: `wav` ו-`webm`, שני
   * הפורמטים שאנחנו שומרים בהם, נדחים בנתיב ה-`audio` של Meta,
   * וההצהרה על `type` בהעלאה מתארת בייטים ואינה ממירה אותם. בלי
   * ההמרה הפעולה הייתה נכשלת דווקא במקרה הנפוץ (ביקורת Codex).
   */
  async sendAudio(
    to: string,
    body: Buffer,
    mimeType: string,
    options: { caption?: string; replyTo?: string } = {},
  ): Promise<boolean> {
    const creds = await this.credentials();
    if (!creds) {
      this.logger.warn("שליחת הקלטה נדחתה — הצד היוצא של וואטסאפ אינו מוגדר");
      return false;
    }
    const audio = await toWhatsAppAudio(body, mimeType);
    if (audio === null) {
      this.logger.warn("שליחת הקלטה נדחתה — לא ניתן להמיר לפורמט שוואטסאפ מקבלת");
      return false;
    }
    const mediaId = await this.uploadMedia(creds, audio.body, audio.mimeType);
    if (mediaId === null) return false;
    /*
     * `audio` אינו נושא כיתוב אצל Meta, ולכן הכיתוב נשלח כהודעת
     * טקסט לפניו — אחרת המתווך היה מקבל קובץ שמע בלי לדעת של מי
     * ומאיזו שיחה.
     */
    if (options.caption !== undefined && options.caption !== "") {
      await this.sendText(to, options.caption, options);
    }
    return this.post(creds, {
      messaging_product: "whatsapp",
      to,
      type: "audio",
      audio: { id: mediaId },
    });
  }

  /** העלאת קובץ ל-Meta ⟵ מזהה מדיה. `null` = ההעלאה נכשלה. */
  private async uploadMedia(
    creds: WhatsAppCredentials,
    body: Buffer,
    mimeType: string,
  ): Promise<string | null> {
    try {
      const form = new FormData();
      form.append("messaging_product", "whatsapp");
      form.append("type", mimeType);
      form.append("file", new Blob([new Uint8Array(body)], { type: mimeType }), "recording");
      const res = await fetch(`${GRAPH_BASE}/${creds.phoneNumberId}/media`, {
        method: "POST",
        headers: { authorization: `Bearer ${creds.token}` },
        body: form,
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 300);
        this.logger.error(`העלאת הקלטה נכשלה: HTTP ${res.status} — ${detail}`);
        return null;
      }
      const json = (await res.json()) as { id?: unknown };
      return typeof json.id === "string" ? json.id : null;
    } catch (error) {
      this.logger.error(`העלאת הקלטה נכשלה: ${String(error)}`);
      return null;
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
