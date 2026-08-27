import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

/**
 * ולידציית סביבה בעליית התהליך — קונפיגורציה שגויה מפילה את השרת מיד,
 * לא מתגלה באמצע בקשה של לקוח.
 *
 * טעינת ‎.env: קובץ השורש של ה-Monorepo (התהליך של README) ואז מקומי;
 * ערכים שכבר קיימים ב-process.env לא נדרסים (פרודקשן מזריקה ישירות).
 */
for (const candidate of [resolve(process.cwd(), "../../.env"), resolve(process.cwd(), ".env")]) {
  if (existsSync(candidate)) {
    try {
      process.loadEnvFile(candidate);
    } catch {
      // קובץ פגום — הוולידציה למטה תדווח על מה שחסר
    }
  }
}
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  WEB_ORIGIN: z.string().url(),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  /** מפתח AES-256-GCM להצפנת PII — 32 בייט ב-base64 (docs/04 §4). */
  DATA_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "חייב להיות 32 בייט ב-base64"),
  /** מפתח HMAC ל-phone_hash — נפרד ממפתח ההצפנה בכוונה. */
  PHONE_HASH_KEY: z.string().min(32),
  /** סודות WhatsApp Cloud API — ה-Webhook סגור עד שהם מוגדרים. */
  WHATSAPP_APP_SECRET: z.string().min(16).optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().min(16).optional(),
  /** הסוכן האישי בוואטסאפ — שליחת תשובות דרך Graph API. חסר = קליטה בלבד. */
  WHATSAPP_ACCESS_TOKEN: z.string().min(20).optional(),
  /** מזהה המספר העסקי אצל Meta (Phone Number ID) — גם מזהה את קו הסוכן בקליטה. */
  WHATSAPP_PHONE_NUMBER_ID: z.string().regex(/^\d{5,30}$/u).optional(),
  /** סוד ה-Webhook של Kanko — קליטת ביקושים סגורה עד שהוא מוגדר. */
  KANKO_WEBHOOK_SECRET: z.string().min(16).optional(),
  /** שעות מהפתיחה הראשונה של הצעה ועד משימת פולו-אפ אם הקונה לא הגיב. */
  OFFER_FOLLOWUP_HOURS: z.coerce.number().positive().default(48),
  /** SLA לליד (docs/01 — "כל ליד מקבל מענה"): שעות עד אסקלציה על ליד ללא טיפול. */
  LEAD_SLA_HOURS: z.coerce.number().positive().default(2),
  /** Secure cookies — חובה true בפרודקשן. */
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  /**
   * כמה שכבות Proxy אמינות לפני האפליקציה (LB/CDN). 0 = אין (פיתוח,
   * X-Forwarded-For לא נספר — מונע זיוף IP); בפרודקשן מאחורי LB אחד: 1.
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  /** גרסת הבנייה (SHA) — נאפית לתמונת ה-Docker; "dev" מחוץ לה. */
  APP_VERSION: z.string().max(64).default("dev"),
  /** כתובת סוכן העדכון בפרודקשן — כפתור העדכון סגור עד שהיא מוגדרת. */
  UPDATER_URL: z.string().url().optional(),
  /** סוד משותף מול סוכן העדכון — חובה יחד עם UPDATER_URL. */
  UPDATE_SECRET: z.string().min(24).optional(),
  /**
   * תיקיית הגיבויים כפי שהיא ממופה לתוך קונטיינר ה-API, ולצידה
   * תיקיית המצב שקונטיינר ה-offsite כותב אליה. בפיתוח הן פשוט לא
   * קיימות — ומסך הגיבויים מדווח "לא זמין" במקום להיכשל.
   */
  BACKUP_PATH: z.string().default("/backups"),
  OFFSITE_STATE_PATH: z.string().default("/state"),
  /**
   * שירות התמלול המקומי (faster-whisper בקונטיינר לצד המערכת).
   * לא מוגדר ⇒ הפיצ'ר כבוי והדפדפן מתמלל מקומית כמו קודם.
   */
  STT_URL: z.string().url().optional(),
  /** סוד משותף מול שירות התמלול — חובה יחד עם STT_URL. */
  STT_SECRET: z.string().min(16).optional(),
  /** תקרת זמן לתמלול — מודל על CPU איטי מ-API בענן. */
  STT_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(600_000).default(180_000),
  /**
   * התראות פוש בדפדפן (Web Push / VAPID). שלושתם יחד או אף אחד —
   * בלעדיהם הפיצ'ר כבוי, המסך מציג "לא מוגדר", ואף אחד לא מנסה
   * להירשם למנוי שאי אפשר לשלוח אליו.
   *
   * המפתחות נוצרים פעם אחת: `npx web-push generate-vapid-keys`.
   * החלפתם מבטלת את כל המנויים הקיימים — ראו docs/08.
   */
  VAPID_PUBLIC_KEY: z.string().min(80).optional(),
  VAPID_PRIVATE_KEY: z.string().min(40).optional(),
  /** כתובת ליצירת קשר עבור ספק הפוש — mailto: או https:. */
  VAPID_SUBJECT: z.string().regex(/^(mailto:|https:\/\/)/u).optional(),
  /** Postmark — שליחת אימייל (אימות כניסה, איפוס סיסמה, התראות). */
  POSTMARK_SERVER_TOKEN: z.string().min(16).optional(),
  /**
   * טוקן ה-Account של Postmark — ניהול דומיינים שמשרדים מחברים
   * (יצירה, אימות, מחיקה). נפרד מטוקן השרת; בלעדיו חיבור דומיין
   * של משרד אינו זמין והשליחה הרגילה אינה מושפעת.
   */
  POSTMARK_ACCOUNT_TOKEN: z.string().min(16).optional(),
  /** כתובת השולח — חייבת להיות Sender Signature מאומתת ב-Postmark. */
  EMAIL_FROM: z.string().email().optional(),
  /**
   * תיבת הדואר הפנימית — כתובת ה-Inbound של שרת Postmark
   * (abc123@inbound.postmarkapp.com). מיילים ללקוחות נושאים
   * Reply-To בצורת local+<token>@domain, והתשובות חוזרות כ-Webhook.
   * בלעדיה מיילים יוצאים בלי Reply-To והכל ממשיך לעבוד כרגיל.
   */
  EMAIL_INBOUND_ADDRESS: z.string().email().optional(),
  /** הסוד שבנתיב ה-Webhook הנכנס — בלעדיו הנתיב סגור. */
  EMAIL_INBOUND_SECRET: z.string().min(16).optional(),
  /**
   * אימות דו-שלבי בקוד אימייל בכל התחברות. כבוי כברירת מחדל —
   * מדליקים רק אחרי חיבור ספק אימייל אמיתי, אחרת המשתמשים ננעלים בחוץ.
   */
  LOGIN_OTP_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  /**
   * התחברות עם Google (OAuth 2.0 / OIDC). לא מוגדר ⇒ הכפתור לא מוצג
   * והמסלול חסום. אפשר להגדיר גם מ-/platform (מוצפן ב-DB).
   */
  GOOGLE_CLIENT_ID: z.string().min(10).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(10).optional(),
  /** Gemini Flash לפקודות קוליות — אופציונלי; בלעדיו עובדים החוקים */
  GEMINI_API_KEY: z.string().min(10).optional(),
  GEMINI_MODEL: z.string().min(3).optional(),
  /**
   * קארדקום — סליקת המנויים. שלושתם יחד או אף אחד: בלעדיהם הסליקה
   * כבויה, המסך מציג "טרם הופעלה" ואין כפתור תשלום שנופל. אפשר
   * להגדיר גם מ-/platform (מוצפן ב-DB), וזה הדפוס המומלץ.
   */
  CARDCOM_TERMINAL_NUMBER: z.string().min(1).optional(),
  CARDCOM_API_NAME: z.string().min(3).optional(),
  CARDCOM_API_PASSWORD: z.string().min(6).optional(),
  /**
   * אימיילים (מופרדים בפסיק) של מנהלי הפלטפורמה — מי שמקים משרדים
   * חדשים מהממשק (/platform). ריק = המסך כבוי, הקמה רק ב-bootstrap.
   */
  PLATFORM_ADMIN_EMAILS: z
    .string()
    .default("")
    .transform((v) =>
      v
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}
