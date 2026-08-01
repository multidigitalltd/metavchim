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
