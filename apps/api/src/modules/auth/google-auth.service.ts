import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { loadEnv } from "../../config/env";
import { PlatformSettingsService } from "../../core/platform-settings.service";

/**
 * התחברות עם Google (OpenID Connect, Authorization Code).
 *
 * עקרון מנחה: **אין הרשמה עצמית.** Google מוכיח בעלות על כתובת
 * אימייל — הוא לא מקנה גישה. המשתמש חייב להיות כבר קיים במשרד
 * (הוזמן בידי מנהל), אחרת הכניסה נדחית. בלי זה כל בעל חשבון Google
 * בעולם היה יכול ליצור לעצמו גישה למערכת רב-דיירית.
 *
 * ההגדרה נשלטת מ-/platform (מוצפנת ב-DB) עם Fallback למשתני סביבה,
 * כמו שאר חיבורי הספקים.
 */

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const VALID_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);
const TOKEN_TIMEOUT_MS = 10_000;

export interface GoogleIdentity {
  email: string;
  emailVerified: boolean;
  name?: string;
}

@Injectable()
export class GoogleAuthService {
  private readonly logger = new Logger(GoogleAuthService.name);

  constructor(private readonly platformSettings: PlatformSettingsService) {}

  private async credentials(): Promise<{ clientId: string; clientSecret: string } | null> {
    const env = loadEnv();
    const clientId =
      (await this.platformSettings.get("googleClientId")) ?? env.GOOGLE_CLIENT_ID ?? "";
    const clientSecret =
      (await this.platformSettings.get("googleClientSecret")) ?? env.GOOGLE_CLIENT_SECRET ?? "";
    if (!clientId || !clientSecret) return null;
    return { clientId, clientSecret };
  }

  async isConfigured(): Promise<boolean> {
    return (await this.credentials()) !== null;
  }

  /** חייבת להיות רשומה ככתובת חזרה מאושרת ב-Google Cloud Console. */
  redirectUri(): string {
    return `${loadEnv().WEB_ORIGIN}/api/v1/auth/google/callback`;
  }

  /** ערכים חד-פעמיים להגנה מ-CSRF (state) ומ-Replay (nonce). */
  static newHandshake(): { state: string; nonce: string } {
    return { state: randomBytes(24).toString("base64url"), nonce: randomBytes(24).toString("base64url") };
  }

  async authorizationUrl(state: string, nonce: string): Promise<string> {
    const creds = await this.credentials();
    if (!creds) throw new UnauthorizedException("התחברות עם Google אינה מוגדרת");

    const params = new URLSearchParams({
      client_id: creds.clientId,
      redirect_uri: this.redirectUri(),
      response_type: "code",
      scope: "openid email profile",
      state,
      nonce,
      // בקשת בחירת חשבון בכל כניסה — מונע כניסה "דביקה" בחשבון הלא נכון
      prompt: "select_account",
    });
    return `${AUTH_ENDPOINT}?${params.toString()}`;
  }

  /**
   * המרת ה-code לזהות מאומתת.
   *
   * הערה על אימות חתימה: ה-id_token נמשך *ישירות* מנקודת הקצה של
   * Google מעל TLS, ולכן לפי OIDC Core §3.1.3.7(6) אין חובה לאמת את
   * החתימה — התעודה לא עברה דרך הדפדפן. כן נבדקים aud, iss, exp
   * ו-nonce, שהם ההגנות שמונעות שימוש בטוקן של אפליקציה אחרת או
   * שידור חוזר.
   */
  async exchangeCode(code: string, expectedNonce: string): Promise<GoogleIdentity> {
    const creds = await this.credentials();
    if (!creds) throw new UnauthorizedException("התחברות עם Google אינה מוגדרת");

    let payload: Record<string, unknown>;
    try {
      const res = await fetch(TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: creds.clientId,
          client_secret: creds.clientSecret,
          redirect_uri: this.redirectUri(),
          grant_type: "authorization_code",
        }),
        signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(`החלפת קוד מול Google נכשלה: ${res.status}`);
        throw new UnauthorizedException("ההתחברות עם Google נכשלה");
      }
      const body = (await res.json()) as { id_token?: string };
      if (!body.id_token) throw new UnauthorizedException("ההתחברות עם Google נכשלה");
      payload = decodeJwtPayload(body.id_token);
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      this.logger.error(`שגיאת תקשורת מול Google: ${String(error)}`);
      throw new UnauthorizedException("ההתחברות עם Google נכשלה");
    }

    const aud = typeof payload["aud"] === "string" ? payload["aud"] : "";
    const iss = typeof payload["iss"] === "string" ? payload["iss"] : "";
    const exp = typeof payload["exp"] === "number" ? payload["exp"] : 0;
    const nonce = typeof payload["nonce"] === "string" ? payload["nonce"] : "";
    const email = typeof payload["email"] === "string" ? payload["email"] : "";

    if (aud !== creds.clientId || !VALID_ISSUERS.has(iss)) {
      throw new UnauthorizedException("ההתחברות עם Google נכשלה");
    }
    if (exp * 1000 <= Date.now()) {
      throw new UnauthorizedException("ההתחברות עם Google פגה — נסו שוב");
    }
    if (nonce !== expectedNonce) {
      // שידור חוזר של תעודה מבקשה אחרת
      throw new UnauthorizedException("ההתחברות עם Google נכשלה");
    }
    if (!email) throw new UnauthorizedException("ההתחברות עם Google נכשלה");

    return {
      email: email.toLowerCase(),
      // Google מחזיר את השדה גם כבוליאני וגם כמחרוזת, תלוי בזרימה
      emailVerified: payload["email_verified"] === true || payload["email_verified"] === "true",
      name: typeof payload["name"] === "string" ? payload["name"] : undefined,
    };
  }
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) {
    throw new UnauthorizedException("ההתחברות עם Google נכשלה");
  }
  const json = Buffer.from(parts[1], "base64url").toString("utf8");
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== "object" || parsed === null) {
    throw new UnauthorizedException("ההתחברות עם Google נכשלה");
  }
  return parsed as Record<string, unknown>;
}
