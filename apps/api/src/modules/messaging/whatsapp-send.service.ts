import { Injectable, Logger } from "@nestjs/common";
import {
  displayWhatsappNumber,
  fitsInteractive,
  listPayload,
  normalizePhoneForWhatsapp,
  replyButtonsPayload,
  splitForWhatsApp,
  whatsappTemplateButton,
  type WhatsAppButton,
  type WhatsAppListRow,
  type WhatsAppTemplateParam,
  type WhatsAppTemplateQuickReply,
} from "@metavchim/shared";
import { loadEnv } from "../../config/env";
import { CryptoService } from "../../core/crypto.service";
import { PlatformSettingsService } from "../../core/platform-settings.service";
import { PrismaService } from "../../core/prisma.service";
import { WA_AUDIO_MAX_BYTES } from "./assistant-buttons";
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

  constructor(
    private readonly platformSettings: PlatformSettingsService,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * ‎**שליחה בשם המשרד — לא מקו מסוים ולא מהמספר של הפלטפורמה.**
   *
   * ‏`sendText` יוצא מהקו של המערכת, ו-`sendTextAs` דורש שהקורא
   * יביא כבר את פרטי החיבור. יש מקרה שלישי שלא היה לו בית: הודעה
   * שהמשרד שולח ללקוח שלו — דוח פעילות לבעל נכס — שבה השולח הוא
   * **המשרד** ואין בה קו שממנו לצאת.
   *
   * ‎`WhatsAppConnectionService` היה המקום המתבקש, והוא יושב
   * ב-`WhatsAppModule` שתלוי ב-`AgentModule` שתלוי ב-
   * ‎`PropertiesModule` — כלומר ייבוא שלו מנכסים הוא מעגל, בדיוק
   * כפי שההערה ב-`messaging.module.ts` מזהירה. השאילתה כאן היא
   * קריאה אחת ופענוח אחד, בלי אף אחת מהתלויות האלה, והיא יושבת
   * לצד שאר השליחה.
   *
   * ‏החיבור הראשון שחובר ולא האחרון: משרד עם שני קווים שולח מזה
   * שהלקוחות כבר מכירים.
   *
   * ‏`"no_connection"` ו-`"rejected"` הן שתי תשובות שונות ולא
   * ‎`false` אחד: הראשונה אומרת „חברו וואטסאפ” והשנייה „חלון 24
   * השעות סגור” — עצות הפוכות למי שלחץ.
   */
  /**
   * ‏האם למשרד יש חיבור וואטסאפ פעיל.
   *
   * ‏קיים כדי שמסך יוכל לומר מראש **איך** הוא ישלח, במקום לגלות את
   * זה אחרי הלחיצה: „ייפתח וואטסאפ” ו„יישלח מהמשרד” הן שתי הבטחות
   * שונות, ומסך שמבטיח את הלא-נכונה מבלבל דווקא את מי שכן קרא.
   *
   * ‏אותה שאילתה בדיוק של `sendAsTenant` — אותו תנאי, אותו סדר —
   * כדי ששתיהן לא יוכלו לסטות: בדיקה שאומרת „מחובר” על מה ששליחה
   * דוחה גרועה מהיעדר בדיקה.
   */
  async hasTenantConnection(tenantId: string): Promise<boolean> {
    const row = await this.prisma.whatsAppBusinessConnection.findFirst({
      where: { tenantId, disconnectedAt: null },
      orderBy: { connectedAt: "asc" },
      select: { accessTokenEncrypted: true },
    });
    if (!row?.accessTokenEncrypted) return false;
    /* ‏טוקן שנכתב במפתח קודם — מבחינת השולח אין חיבור, וגם כאן */
    try {
      this.crypto.decrypt(row.accessTokenEncrypted);
      return true;
    } catch {
      return false;
    }
  }

  async sendAsTenant(
    tenantId: string,
    to: string,
    body: string,
  ): Promise<"sent" | "no_connection" | "rejected"> {
    const row = await this.prisma.whatsAppBusinessConnection.findFirst({
      where: { tenantId, disconnectedAt: null },
      orderBy: { connectedAt: "asc" },
      select: { accessTokenEncrypted: true, phoneNumberId: true },
    });
    if (!row?.accessTokenEncrypted) return "no_connection";
    let token: string;
    try {
      token = this.crypto.decrypt(row.accessTokenEncrypted);
    } catch {
      /* ‏טוקן שנכתב במפתח קודם — מבחינת השולח אין חיבור */
      return "no_connection";
    }
    const sent = await this.sendTextAs({ token, phoneNumberId: row.phoneNumberId }, to, body);
    return sent ? "sent" : "rejected";
  }

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
   * ‎**המספר העסקי שהלקוחות שולחים אליו — כפי ש-Meta מכירה אותו.**
   *
   * ‎`phoneNumberId` הוא מזהה אטום ואי אפשר לחייג אליו; המספר לחיוג
   * יושב אצל Meta ומגיע רק מהגרף. הוא נדרש כדי לבנות קישור
   * ‎`wa.me` — כלומר כדי שאפשר יהיה **לסרוק ברקוד** או ללחוץ על
   * קישור במקום להקליד קוד בן שש אותיות ביד.
   *
   * הוא אינו נשמר כהגדרה בכוונה: הגדרה כזאת אפשר להקליד שגוי, והיא
   * מתיישנת בשקט אם המספר מוחלף. המקור הוא Meta, והמטמון כאן קצר
   * דיו כדי שהחלפה תתפוס תוך שעה.
   *
   * ‎`null` = הצד היוצא לא הוגדר, או ש-Meta לא ענתה. הקוד עצמו עדיין
   * מוצג, והמשתמש עדיין יכול לשלוח אותו ידנית — הקיצור נעלם, לא
   * היכולת.
   */
  private displayNumber: { value: string | null; at: number } | null = null;

  async businessNumber(): Promise<string | null> {
    const fromMeta = await this.metaDisplayNumber();
    if (fromMeta !== null) return fromMeta;
    /*
     * ‎**הגיבוי אינו במטמון של Meta, בכוונה.**
     *
     * המטמון שומר גם כישלון, ולשעה — אחרת כל פתיחת מסך הייתה ממתינה
     * לפסק זמן. אבל ההגדרה הידנית היא בדיוק מה שממלאים **בגלל**
     * הכישלון הזה, ושעה שבה היא אינה נכנסת לתוקף נראית כמו שדה
     * שבור. ‎`PlatformSettingsService` ממילא ממטמן ל-30 שניות.
     */
    /*
     * ‎`normalizePhoneForWhatsapp` ולא הסרת תווים בלבד: המנהל מקליד
     * ‎`0553142235`, וזו הצורה שהתיעוד מציג. מספר מקומי שיוצא מכאן
     * כמות שהוא הופך ל-`+0553142235` בתצוגה ובקישור החיוג — מספר
     * שאינו קיים. הנרמול כאן, כי זה הגבול שממנו כל השאר צורך.
     */
    const manual = normalizePhoneForWhatsapp(
      (await this.platformSettings.get("whatsappBotNumber")) ?? "",
    );
    return manual === "" ? null : manual;
  }

  private async metaDisplayNumber(): Promise<string | null> {
    const TTL_MS = 60 * 60 * 1000;
    if (this.displayNumber !== null && Date.now() - this.displayNumber.at < TTL_MS) {
      return this.displayNumber.value;
    }
    const creds = await this.credentials();
    if (!creds) return null;
    let value: string | null = null;
    try {
      const res = await fetch(`${GRAPH_BASE}/${creds.phoneNumberId}?fields=display_phone_number`, {
        headers: { authorization: `Bearer ${creds.token}` },
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      if (res.ok) {
        const data = (await res.json()) as { display_phone_number?: string };
        const digits = (data.display_phone_number ?? "").replace(/\D/gu, "");
        value = digits === "" ? null : digits;
      } else {
        this.logger.warn(`Meta לא החזירה את המספר העסקי: HTTP ${res.status}`);
      }
    } catch (error) {
      this.logger.warn(`שליפת המספר העסקי מ-Meta נכשלה: ${String(error)}`);
    }
    /*
     * גם כישלון נשמר במטמון, ולזמן מלא: בלי זה כל פתיחת מסך שמציג
     * את הקוד הייתה פונה שוב ל-Meta ומחכה לפסק הזמן.
     */
    this.displayNumber = { value, at: Date.now() };
    return value;
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
   * שליחה **על קו של סוכן** ולא על קו הפלטפורמה.
   *
   * ‎`sendText` שולף את אישורי הפלטפורמה, וזה נכון לסוכן האישי אבל
   * הפוך לבוט: הלקוח כתב למספר של המתווך, ותשובה שתצא ממספר אחר
   * נראית לו כמו הודעה מזרה — ובמקרה הטוב מתעלמים ממנה. האישורים
   * מגיעים מכאן מהחיבור עצמו (`credentialsFor`).
   */
  async sendTextAs(
    creds: WhatsAppCredentials,
    to: string,
    body: string,
    options: SendTextOptions = {},
  ): Promise<boolean> {
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
      if (!sent) return false;
    }
    return true;
  }

  /**
   * הודעת **תבנית מאושרת** — הדרך היחידה לפנות למי שלא כתב לנו.
   *
   * ## למה זה קיים
   *
   * `sendText` עובד רק בתוך חלון 24 השעות של Meta, כלומר רק כתשובה
   * להודעה של הנמען. לקוח שהתקשר ולא נענה **מעולם לא כתב לנו**,
   * ולכן טקסט חופשי אליו נדחה. תבנית שאושרה מראש היא מה שמתיר את
   * הפנייה הזו.
   *
   * ## למה `false` ולא חריגה
   *
   * אותו כלל של שאר השירות: השולח הוא קליטת וובהוק או עבודת רקע,
   * ושליחה שנכשלה אינה סיבה להפיל אותן. הקורא מקבל `false` ומחליט
   * — בפועל: פותח משימה עם ההודעה מוכנה, כדי שהמתווך ישלח בלחיצה
   * במקום שהלקוח לא יקבל דבר.
   *
   * ## למה הערכים נושאים שמות
   *
   * Meta עברה למשתנים בעלי שם (`{{form_link}}` ולא `{{1}}`), ותבנית
   * כזו דורשת ש**כל ערך יישא את `parameter_name` שלו**. משלוח מיקומי
   * אליה נדחה. הערכים נבנים ב-`whatsappTemplateParams` שבחבילה
   * המשותפת, ששם המשתנים בו הוא אותו שם שנרשם ב-WhatsApp Manager.
   *
   * ## הכפתור
   *
   * ‎`urlSuffix` נמסר רק כשהתבנית הוגדרה עם **כתובת דינמית**. אין
   * דרך שהקוד יידע זאת לבדו: תבנית בלי כפתור שנשלח אליה רכיב כפתור
   * נדחית, וכך גם ההפך. לכן הקורא — שיודע איזו תבנית זו — מחליט,
   * ותבנית בלי כפתור פשוט אינה מעבירה את הארגומנט.
   */
  async sendTemplate(
    to: string,
    name: string,
    languageCode: string,
    params: readonly WhatsAppTemplateParam[],
    urlSuffix?: string,
    /**
     * ‎**כפתורי „תשובה מהירה”, כשהתבנית נרשמה איתם.**
     *
     * ‏נמסרים כרכיבים ולא כדגל: המטען של כל כפתור נקבע לכל הודעה
     * בנפרד, וזה מה שמאפשר לדעת על איזה סיור נלחץ. תבנית שנרשמה
     * בלי כפתורים ומקבלת רכיבים כאלה נדחית — ולכן הקורא מצרף אותם
     * רק לפי ההגדרה שאומרת מה נרשם בפועל.
     */
    quickReplies?: readonly WhatsAppTemplateQuickReply[],
  ): Promise<boolean> {
    const creds = await this.credentials();
    if (!creds) {
      this.logger.warn("תבנית לא נשלחה — הצד היוצא אינו מוגדר");
      return false;
    }
    const button = urlSuffix === undefined ? null : whatsappTemplateButton(urlSuffix);
    const components = [
      ...(params.length > 0 ? [{ type: "body", parameters: params }] : []),
      ...(button === null ? [] : [button]),
      ...(quickReplies ?? []),
    ];
    return this.post(creds, {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name,
        language: { code: languageCode },
        ...(components.length > 0 ? { components } : {}),
      },
    });
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
    /*
     * התקרה נאכפת על התוצר ולא על המקור: ההמרה מכווצת wav בסדר
     * גודל, ופסילה לפי גודל המקור פסלה שיחות שנכנסות בקלות לתקרה
     * אחרי הקידוד (ביקורת Codex).
     */
    if (audio.body.length > WA_AUDIO_MAX_BYTES) {
      this.logger.warn("שליחת הקלטה נדחתה — גדולה מתקרת המדיה של Meta גם אחרי המרה");
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
      const connected = normalizePhoneForWhatsapp(data.display_phone_number ?? "");
      const name = data.verified_name ?? "ללא שם מאומת";

      /*
       * ‎**החיבור עלה — אבל לאיזה קו?**
       *
       * ‎`Phone Number ID` הוא מזהה אטום, ולחשבון עסקי אחד ב-Meta
       * יכולים להיות כמה מספרים. הדבקה של המזהה של המספר השני
       * באותו חשבון אינה נכשלת בשום מקום: האסימון תקף, Meta עונה,
       * ההודעות יוצאות — פשוט מהמספר הלא נכון. עד כאן הבדיקה הייתה
       * מחזירה „מחובר” ירוק בדיוק על התקלה הזאת.
       *
       * ‎`whatsappBotNumber` הוא ההצהרה של המנהל על מה *אמור* להיות
       * מחובר, ולכן הוא אמת המידה. ריק = לא הוצהר דבר, ואין מה
       * להשוות — הבדיקה נשארת כשהייתה ואינה ממציאה כשל.
       */
      const expected = normalizePhoneForWhatsapp(
        (await this.platformSettings.get("whatsappBotNumber")) ?? "",
      );
      if (expected !== "" && connected !== "" && expected !== connected) {
        return {
          ok: false,
          message:
            `מחובר למספר הלא נכון: ${displayWhatsappNumber(connected)} (${name}), ` +
            `בעוד שמספר הבוט המוגדר הוא ${displayWhatsappNumber(expected)}. ` +
            "‏החליפו את Phone Number ID לזה של המספר הנכון — או תקנו את שדה מספר הבוט אם הוא זה שגוי.",
        };
      }

      return {
        ok: true,
        message: `מחובר: ${name} · ${connected === "" ? creds.phoneNumberId : displayWhatsappNumber(connected)}`,
      };
    } catch (error) {
      return { ok: false, message: `החיבור ל-Meta נכשל: ${String(error)}` };
    }
  }
}
