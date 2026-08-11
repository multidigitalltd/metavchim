import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { ulid } from "ulid";
import { loadEnv } from "../../config/env";
import { CryptoService } from "../../core/crypto.service";
import { PlatformSettingsService } from "../../core/platform-settings.service";
import { PrismaService } from "../../core/prisma.service";

/**
 * חיבור Gmail — OAuth והקריאות ל-API. אותה תבנית בדיוק כמו חיבור
 * יומן Google (ראו google-calendar.service): אותם פרטי לקוח, אותו
 * מנגנון refresh token מוצפן, ואותה שקיפות שגיאות. ההרשאה היא
 * ‎gmail.readonly‎ — קוראים הודעות נכנסות, לא שולחים ולא מוחקים.
 */

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
/*
 * קריאה **ושליחה**.
 *
 * ‎gmail.send‎ מתיר לשלוח בשם המשתמש ותו לא — הוא אינו נותן גישה
 * לקריאה, למחיקה או לשינוי תוויות, ולכן הוא הצמצום הנכון לתיבה של
 * מתווך. הוספת ההרשאה מחייבת **חיבור מחדש** של תיבות קיימות: אסימון
 * שהונפק לפני השינוי אינו נושא אותה, ושליחה דרכו תיכשל.
 */
const SCOPE =
  "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send openid email";

export interface GmailLinkRow {
  id: string;
  tenantId: string;
  userId: string;
  googleEmail: string;
  refreshTokenEncrypted: string;
  lastInternalMs: bigint;
  lastSyncAt: Date | null;
  lastError: string | null;
  skippedCount: number;
}

/** הודעה נכנסת — רק מה שהקליטה צריכה. */
export interface InboundEmail {
  id: string;
  internalMs: number;
  fromName: string;
  fromEmail: string;
  subject: string;
  snippet: string;
}

@Injectable()
export class GmailService {
  private readonly logger = new Logger(GmailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
    private readonly crypto: CryptoService,
  ) {}

  private async credentials(): Promise<{ clientId: string; clientSecret: string } | null> {
    const env = loadEnv();
    const clientId = (await this.settings.get("googleClientId")) ?? env.GOOGLE_CLIENT_ID ?? "";
    const clientSecret =
      (await this.settings.get("googleClientSecret")) ?? env.GOOGLE_CLIENT_SECRET ?? "";
    if (!clientId || !clientSecret) return null;
    return { clientId, clientSecret };
  }

  async isConfigured(): Promise<boolean> {
    return (await this.credentials()) !== null;
  }

  /** חייבת להיות רשומה ככתובת חזרה מאושרת ב-Google Cloud Console. */
  redirectUri(): string {
    return `${loadEnv().WEB_ORIGIN}/api/v1/gmail/callback`;
  }

  static newState(): string {
    return randomBytes(24).toString("base64url");
  }

  /** ‎access_type=offline + prompt=consent‎ — ראו ההסבר בחיבור היומן. */
  async authorizationUrl(state: string): Promise<string> {
    const creds = await this.credentials();
    if (!creds) throw new BadRequestException("חיבור Gmail אינו מוגדר במערכת");
    const params = new URLSearchParams({
      client_id: creds.clientId,
      redirect_uri: this.redirectUri(),
      response_type: "code",
      scope: SCOPE,
      state,
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
    });
    return `${AUTH_ENDPOINT}?${params.toString()}`;
  }

  async connect(code: string, tenantId: string, userId: string): Promise<{ email: string }> {
    const creds = await this.credentials();
    if (!creds) throw new BadRequestException("חיבור Gmail אינו מוגדר במערכת");

    const body = new URLSearchParams({
      code,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      redirect_uri: this.redirectUri(),
      grant_type: "authorization_code",
    });
    const res = await this.fetchJson<{ refresh_token?: string; id_token?: string }>(
      TOKEN_ENDPOINT,
      { method: "POST", body },
    );
    if (!res.refresh_token) {
      throw new BadRequestException(
        "Google לא החזיר הרשאה קבועה. נתקו את מתווכים בהגדרות חשבון Google ונסו שוב.",
      );
    }

    const email = this.emailFromIdToken(res.id_token) ?? "";
    const encrypted = this.crypto.encrypt(res.refresh_token);

    await this.prisma.withExplicitTenant(tenantId, async (tx) => {
      const existing = await tx.gmailLink.findUnique({ where: { userId } });
      if (existing) {
        await tx.gmailLink.update({
          where: { userId },
          data: {
            googleEmail: email,
            refreshTokenEncrypted: encrypted,
            /*
             * חיבור מחדש מתחיל מ"עכשיו" ולא מאפס: אחרת כל חיבור מחדש
             * היה קולט שוב יומיים של דואר ישן ומציף לידים כפולים.
             */
            lastInternalMs: BigInt(Date.now()),
            lastError: null,
          },
        });
        return;
      }
      await tx.gmailLink.create({
        data: {
          id: ulid(),
          tenantId,
          userId,
          googleEmail: email,
          refreshTokenEncrypted: encrypted,
          // חיבור חדש קולט מהרגע הזה והלאה — לא היסטוריה שלמה
          lastInternalMs: BigInt(Date.now()),
        },
      });
    });

    return { email };
  }

  async disconnect(tenantId: string, userId: string): Promise<void> {
    await this.prisma.withExplicitTenant(tenantId, async (tx) => {
      await tx.gmailLink.deleteMany({ where: { userId } });
    });
  }

  async linkFor(tenantId: string, userId: string): Promise<GmailLinkRow | null> {
    return this.prisma.withExplicitTenant(tenantId, async (tx) =>
      tx.gmailLink.findUnique({ where: { userId } }),
    );
  }

  /** access token טרי — אינו נשמר, ראו הנימוק בחיבור היומן. */
  private async accessToken(link: GmailLinkRow): Promise<string> {
    const creds = await this.credentials();
    if (!creds) throw new ServiceUnavailableException("חיבור Gmail אינו מוגדר");
    const body = new URLSearchParams({
      refresh_token: this.crypto.decrypt(link.refreshTokenEncrypted),
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      grant_type: "refresh_token",
    });
    const res = await this.fetchJson<{ access_token?: string }>(TOKEN_ENDPOINT, {
      method: "POST",
      body,
    });
    if (!res.access_token) throw new ServiceUnavailableException("Google לא החזיר אסימון גישה");
    return res.access_token;
  }

  /**
   * ההודעות הנכנסות החדשות מאז הסמן — ממוינות מהישנה לחדשה, כדי
   * שהסמן יתקדם בבטחה גם אם סבב נקטע באמצע.
   *
   * ‎metadata + snippet‎ ולא הגוף המלא: תקציר של 200 התווים הראשונים
   * מספיק לזיהוי טלפון ולתיעוד, בלי לפרסר MIME ובלי להחזיק תוכן
   * מלא של תכתובת פרטית.
   */
  async newInboundMessages(link: GmailLinkRow, pageSize = 25): Promise<InboundEmail[]> {
    const token = await this.accessToken(link);
    // newer_than גס בכוונה — הסינון המדויק נעשה מול הסמן אצלנו
    const query = encodeURIComponent("in:inbox newer_than:2d");

    /*
     * עימוד מלא ולא עמוד ראשון בלבד: Gmail מחזיר מהחדשה לישנה, ובלי
     * המשך ל-nextPageToken עומס של יותר מעמוד אחד בין סבבים היה
     * מקדם את הסמן אל ההודעה החדשה ביותר ומפיל את הישנות לתמיד
     * (ביקורת Codex). newer_than:2d חוסם את העומק, והתקרה הכוללת
     * היא רשת ביטחון בלבד.
     */
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const page: { messages?: { id: string }[]; nextPageToken?: string } = await this.fetchJson(
        `${GMAIL_BASE}/messages?q=${query}&maxResults=${pageSize}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`,
        { token },
      );
      ids.push(...(page.messages ?? []).map((m) => m.id));
      pageToken = page.nextPageToken;
    } while (pageToken !== undefined && ids.length < 200);
    if (ids.length === 0) return [];

    const out: InboundEmail[] = [];
    for (const id of ids) {
      const msg = await this.fetchJson<{
        id: string;
        internalDate?: string;
        snippet?: string;
        payload?: { headers?: { name: string; value: string }[] };
      }>(
        `${GMAIL_BASE}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
        { token },
      );
      const internalMs = Number(msg.internalDate ?? 0);
      if (internalMs <= Number(link.lastInternalMs)) continue;

      const headers = msg.payload?.headers ?? [];
      const from = headers.find((h) => h.name.toLowerCase() === "from")?.value ?? "";
      const subject = headers.find((h) => h.name.toLowerCase() === "subject")?.value ?? "";
      const parsed = parseFromHeader(from);
      out.push({
        id: msg.id,
        internalMs,
        fromName: parsed.name,
        fromEmail: parsed.email,
        subject,
        snippet: msg.snippet ?? "",
      });
    }
    out.sort((a, b) => a.internalMs - b.internalMs);
    return out;
  }

  /**
   * שליחת אימייל מהתיבה המחוברת.
   *
   * ההודעה נבנית כ-RFC 2822 ונשלחת ב-base64url — זה מה ש-Gmail API
   * מצפה לו. הכותרות מקודדות ב-MIME encoded-word (RFC 2047), אחרת
   * נושא בעברית מגיע כג'יבריש; הגוף מוצהר כ-UTF-8.
   *
   * `threadId` משמר שרשור: תשובה שנשלחת בלי הוא נראית ללקוח כהודעה
   * חדשה ומנותקת, והשיחה מתפצלת לשניים בתיבה שלו.
   */
  async sendMail(
    link: GmailLinkRow,
    input: { to: string; subject: string; body: string; threadId?: string },
  ): Promise<{ id: string; threadId: string }> {
    const token = await this.accessToken(link);

    const mime = [
      `To: ${input.to}`,
      `From: ${link.googleEmail}`,
      `Subject: ${encodeHeader(input.subject)}`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(input.body, "utf8").toString("base64"),
    ].join("\r\n");

    const res = await this.fetchJson<{ id?: string; threadId?: string }>(
      `${GMAIL_BASE}/messages/send`,
      {
        token,
        method: "POST",
        json: {
          raw: Buffer.from(mime, "utf8").toString("base64url"),
          ...(input.threadId !== undefined ? { threadId: input.threadId } : {}),
        },
      },
    );
    if (!res.id) throw new ServiceUnavailableException("Google לא אישר את השליחה");
    return { id: res.id, threadId: res.threadId ?? "" };
  }

  async markSynced(
    link: GmailLinkRow,
    patch: { lastInternalMs?: number; error?: string | null; skippedDelta?: number },
  ): Promise<void> {
    await this.prisma.withExplicitTenant(link.tenantId, async (tx) => {
      await tx.gmailLink.update({
        where: { id: link.id },
        data: {
          lastSyncAt: new Date(),
          lastError: patch.error ?? null,
          ...(patch.lastInternalMs !== undefined
            ? { lastInternalMs: BigInt(patch.lastInternalMs) }
            : {}),
          ...(patch.skippedDelta ? { skippedCount: { increment: patch.skippedDelta } } : {}),
        },
      });
    });
  }

  private async fetchJson<T>(
    url: string,
    init: { method?: string; body?: URLSearchParams; token?: string; json?: unknown },
  ): Promise<T> {
    const res = await fetch(url, {
      method: init.method ?? "GET",
      headers: {
        ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
        ...(init.body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
        ...(init.json !== undefined ? { "content-type": "application/json" } : {}),
      },
      // גוף JSON לשליחת הודעות; form-urlencoded נשאר לחילופי אסימונים
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      this.logger.error(`Gmail החזיר ${res.status}: ${detail.slice(0, 200)}`);
      throw new ServiceUnavailableException("Gmail החזיר שגיאה");
    }
    return (await res.json()) as T;
  }

  /** האימייל מה-id_token — לתצוגה בלבד, אותו נימוק כמו בחיבור היומן. */
  private emailFromIdToken(idToken: string | undefined): string | null {
    if (!idToken) return null;
    const part = idToken.split(".")[1];
    if (!part) return null;
    try {
      const payload = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as {
        email?: unknown;
      };
      return typeof payload.email === "string" ? payload.email : null;
    } catch {
      return null;
    }
  }
}

/** ‎"דנה לוי <dana@x.co.il>"‎ → שם + כתובת (מנורמלת לאותיות קטנות). */
/**
 * קידוד כותרת ל-MIME encoded-word (RFC 2047).
 *
 * כותרות אימייל הן ASCII בלבד. נושא בעברית שנשלח כמות שהוא מגיע
 * ללקוח כג'יבריש, ולכן הוא נעטף ב-‎=?UTF-8?B?…?=‎. כותרת שכולה ASCII
 * נשלחת כפי שהיא — אין טעם לקודד "Re: meeting".
 */
export function encodeHeader(value: string): string {
  // ASCII מודפס בלבד — הטווח שכותרת אימייל רשאית לשאת ללא קידוד
  if (/^[\x20-\x7e]*$/u.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

export function parseFromHeader(value: string): { name: string; email: string } {
  const match = /^(.*?)<([^>]+)>\s*$/u.exec(value);
  if (match) {
    return {
      name: (match[1] ?? "").trim().replace(/^"|"$/gu, "").trim(),
      email: (match[2] ?? "").trim().toLowerCase(),
    };
  }
  return { name: "", email: value.trim().toLowerCase() };
}
