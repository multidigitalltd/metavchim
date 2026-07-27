import { z } from "zod";

/**
 * ולידציית סביבה בעליית התהליך — קונפיגורציה שגויה מפילה את השרת מיד,
 * לא מתגלה באמצע בקשה של לקוח.
 */
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
  /** Secure cookies — חובה true בפרודקשן. */
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
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
