import * as nodeCrypto from "node:crypto";
import { openAesGcm, WHATSAPP_TEMPLATE_LANG_DEFAULT } from "@metavchim/shared";
import { prisma } from "../runtime.js";

/* ==================== דחיפת התראות לוואטסאפ ==================== */

/**
 * הסוכן בוואטסאפ נבנה כדי שמתווך יוכל לעבוד **בלי להיכנס למערכת**.
 * כל עוד הוא רק עונה, מי שאינו פותח את הדשבורד אינו יודע ששיחה לא
 * נענתה, שנכנס ליד או שתמלול הסתיים — כלומר הוא חייב להיכנס.
 * הסורק הזה סוגר את המעגל: אותן שורות `notifications` שכבר מזינות
 * את הפעמון ואת פוש הדפדפן, יוצאות גם לוואטסאפ.
 *
 * מדוע עמודה נפרדת (`whatsapp_at`) ולא שימוש ב-`pushed_at`: הערוצים
 * עצמאיים. פוש מושבת בלי מפתחות VAPID, וואטסאפ מושבת בלי טוקן של
 * Meta — סימון משותף היה גורם לערוץ אחד לבלוע התראות שהשני לא ראה.
 *
 * ההחלטות עצמן (מה נשלח, למי, מתי שקט, ואיך זה נראה) יושבות
 * ב-`packages/shared/logic/whatsapp-notify` ומכוסות בבדיקות.
 */
const WA_GRAPH_BASE = "https://graph.facebook.com/v23.0";
const WA_SEND_TIMEOUT_MS = 15_000;
export const WA_NOTIFY_BATCH = 200;
/**
 * מעבר לזה לא דוחפים — הגבול שמונע מהתראות שנדחו (שעות שקט, חלון
 * סגור) להצטבר לנצח: הן פשוט יוצאות מהחלון שהשאילתה סורקת.
 *
 * יממה ולא חצי יום: טווח השקט המרבי שההעדפות מתירות הוא 18 שעות,
 * והחלון חייב לכסות אותו — אחרת התראה שנוצרה בתחילת השקט הייתה
 * מתיישנת לפני שהוא נגמר, כלומר לא נשלחת לעולם למרות שהמסך מבטיח
 * שהיא תגיע בבוקר (ביקורת Codex).
 */
export const WA_NOTIFY_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const WA_CONFIG_TTL_MS = 60_000;

interface WhatsAppConfig {
  token: string;
  phoneNumberId: string;
  /** שם תבנית מאושרת לשליחה מחוץ לחלון 24 השעות; ריק = אין */
  template: string | null;
  templateLang: string;
  /**
   * האם התבנית נרשמה עם כפתור „פתח במערכת” בכתובת דינמית.
   *
   * ‏Meta דוחה משני הכיוונים — כפתור לתבנית שאין בה, וגם תבנית עם
   * כפתור שלא קיבלה את ערכו — ולכן זו הגדרה מפורשת ולא ניחוש.
   */
  buttonUrl: boolean;
  /**
   * ‎**האם התבנית נרשמה עם שורה לכל עדכון** (`line_1`…`line_4`),
   * ולא עם `update_details` אחד.
   *
   * ‏ערך של תבנית אינו יכול להכיל ירידת שורה, ולכן הפירוט משוטח
   * ‏ל-`·` והתקציר מגיע כשרשרת אחת ארוכה. שורות אמיתיות אפשריות
   * ‏רק בגוף התבנית, כלומר בתבנית אחרת — ולקוד אין דרך לדעת מה
   * ‏נרשם. ברירת המחדל היא **הישנה**: שליחת חמישה שמות לתבנית
   * ‏שיש בה שניים נדחית, וההתראה נעלמת בלי סימן.
   */
  templateLines: boolean;
}

let waConfigCache: { config: WhatsAppConfig | null; until: number } | null = null;

/**
 * פענוח הגדרת פלטפורמה.
 *
 * ‏אותו פענוח של `CryptoService.decrypt` שב-API — `openAesGcm` מהחבילה
 * ‏המשותפת, ולא עותק שלו. התהליכים נפרדים, ולפתוח ערוץ HTTP פנימי בין
 * ‏העובדים ל-API רק כדי לקרוא שני מפתחות היה מוסיף שטח תקיפה.
 */
export function decryptSetting(stored: string): string | null {
  const key = process.env["DATA_ENCRYPTION_KEY"];
  if (!key) return null;
  try {
    return openAesGcm(Buffer.from(stored, "base64"), Buffer.from(key, "base64"), nodeCrypto);
  } catch {
    return null;
  }
}

/** ההגדרות ממסך הפלטפורמה, עם משתני הסביבה כ-Fallback — כמו ב-API. */
export async function whatsappConfig(): Promise<WhatsAppConfig | null> {
  const now = Date.now();
  if (waConfigCache && now < waConfigCache.until) return waConfigCache.config;

  const rows = await prisma.platformSetting.findMany({
    where: {
      key: {
        in: [
          "whatsappAccessToken",
          "whatsappPhoneNumberId",
          "whatsappNotifyTemplate",
          "whatsappNotifyTemplateLang",
          "whatsappNotifyTemplateButton",
          "whatsappNotifyTemplateLines",
        ],
      },
    },
    select: { key: true, valueEncrypted: true },
  });
  const stored = new Map(
    rows.map((row) => [row.key, decryptSetting(row.valueEncrypted)] as const),
  );

  const token = stored.get("whatsappAccessToken") ?? process.env["WHATSAPP_ACCESS_TOKEN"] ?? null;
  const phoneNumberId =
    stored.get("whatsappPhoneNumberId") ?? process.env["WHATSAPP_PHONE_NUMBER_ID"] ?? null;
  const template = stored.get("whatsappNotifyTemplate") ?? null;
  const config: WhatsAppConfig | null =
    token && phoneNumberId
      ? {
          token,
          phoneNumberId,
          template: template !== null && template.trim() !== "" ? template.trim() : null,
          templateLang: stored.get("whatsappNotifyTemplateLang")?.trim() || WHATSAPP_TEMPLATE_LANG_DEFAULT,
          buttonUrl: stored.get("whatsappNotifyTemplateButton")?.trim() === "true",
          templateLines: stored.get("whatsappNotifyTemplateLines")?.trim() === "true",
        }
      : null;
  waConfigCache = { config, until: now + WA_CONFIG_TTL_MS };
  return config;
}

/** שליחה אחת ל-Graph. false = לא יצא; הסורק ינסה שוב בסבב הבא. */
export async function sendWhatsApp(
  config: WhatsAppConfig,
  payload: Record<string, unknown>,
): Promise<boolean> {
  try {
    const res = await fetch(`${WA_GRAPH_BASE}/${config.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(WA_SEND_TIMEOUT_MS),
    });
    if (!res.ok) {
      // גוף השגיאה מוגבל — בלי להדפיס טוקנים או תוכן הודעה ליומן
      console.error(
        `[whatsapp-notify] Meta דחתה: HTTP ${res.status} — ${(await res.text()).slice(0, 200)}`,
      );
      return false;
    }
    return true;
  } catch (error) {
    console.error(`[whatsapp-notify] שליחה נכשלה: ${String(error)}`);
    return false;
  }
}

/** השעה בישראל — לשעות השקט. נכשל ⇒ שעת UTC, ולא קריסה. */
export function jerusalemHour(date: Date): number {
  try {
    return Number.parseInt(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Jerusalem",
        hour: "numeric",
        hour12: false,
      }).format(date),
      10,
    );
  } catch {
    return date.getUTCHours();
  }
}
