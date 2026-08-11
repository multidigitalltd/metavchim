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
 * סנכרון יומן Google — דו-כיווני.
 *
 * המחיר של יומן שאינו מסונכרן הוא פגישה כפולה: המתווך קובע סיור
 * במערכת, וביומן הפרטי שלו כבר יושבת פגישה אחרת באותה שעה. אף אחד
 * מהצדדים לא יודע על השני עד שהלקוח מחכה בכניסה לבניין.
 *
 * **שלושה עוגנים בעיצוב:**
 *
 * 1. **החיבור הוא של המשתמש, לא של המשרד.** ליומן יש בעלים אחד.
 *    חיבור ברמת המשרד היה מחייב חשבון Google משותף — מה שאף משרד
 *    לא עושה.
 *
 * 2. **מקור האירוע נשמר** (`syncSource`). בלעדיו הדחיפה החוצה הייתה
 *    מחזירה ל-Google אירוע שזה עתה נמשך ממנו, וזו לולאה שבה כל צד
 *    "מעדכן" את השני לנצח.
 *
 * 3. **המשיכה מצטברת** (`syncToken`). Google מחזיר טוקן בסוף כל
 *    רשימה, והבקשה הבאה מקבלת רק מה שהשתנה מאז. משיכה מלאה בכל סבב
 *    הייתה נחסמת אצלם תוך יום.
 *
 * הרשאות: `calendar.events` בלבד — קריאה וכתיבה של אירועים ביומן
 * שהמשתמש אישר. **לא** `calendar` המלא, שנותן גם למחוק יומנים
 * שלמים ולשנות שיתופים.
 */

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";
const SCOPE = "https://www.googleapis.com/auth/calendar.events openid email";

/** אירוע כפי ש-Google מחזיר אותו — רק מה שמעניין אותנו. */
export interface GoogleEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

export interface CalendarLink {
  id: string;
  tenantId: string;
  userId: string;
  googleEmail: string;
  calendarId: string;
  refreshTokenEncrypted: string;
  syncToken: string | null;
  lastSyncAt: Date | null;
  lastError: string | null;
}

@Injectable()
export class GoogleCalendarService {
  private readonly logger = new Logger(GoogleCalendarService.name);

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
    return `${loadEnv().WEB_ORIGIN}/api/v1/calendar/google/callback`;
  }

  static newState(): string {
    return randomBytes(24).toString("base64url");
  }

  /**
   * כתובת ההרשאה.
   *
   * `access_type=offline` + `prompt=consent` הם מה שמייצר refresh
   * token. בלי `prompt=consent` המשתמש שכבר אישר פעם מקבל רק
   * access token קצר-מועד, והחיבור מת אחרי שעה — תקלה שנראית כמו
   * "עבד ואז הפסיק".
   */
  async authorizationUrl(state: string): Promise<string> {
    const creds = await this.credentials();
    if (!creds) throw new BadRequestException("חיבור ליומן Google אינו מוגדר במערכת");
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

  /** המרת ה-code ל-refresh token ולזהות, ושמירת החיבור. */
  async connect(code: string, tenantId: string, userId: string): Promise<{ email: string }> {
    const creds = await this.credentials();
    if (!creds) throw new BadRequestException("חיבור ליומן Google אינו מוגדר במערכת");

    const body = new URLSearchParams({
      code,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      redirect_uri: this.redirectUri(),
      grant_type: "authorization_code",
    });
    const res = await this.fetchJson<{
      refresh_token?: string;
      access_token?: string;
      id_token?: string;
    }>(TOKEN_ENDPOINT, { method: "POST", body });

    if (!res.refresh_token) {
      /*
       * חשבון שכבר אישר בעבר ולא נותק כראוי מחזיר בלי refresh token.
       * הודעה מפורשת ולא "החיבור נכשל": הפתרון הוא לנתק את האפליקציה
       * בהגדרות החשבון ולנסות שוב, ואי אפשר לנחש אותו.
       */
      throw new BadRequestException(
        "Google לא החזיר הרשאה קבועה. נתקו את מתווכים בהגדרות חשבון Google ונסו שוב.",
      );
    }

    const email = this.emailFromIdToken(res.id_token) ?? "";
    const encrypted = this.crypto.encrypt(res.refresh_token);

    await this.prisma.withExplicitTenant(tenantId, async (tx) => {
      const existing = await tx.googleCalendarLink.findUnique({ where: { userId } });
      if (existing) {
        await tx.googleCalendarLink.update({
          where: { userId },
          data: {
            googleEmail: email,
            refreshTokenEncrypted: encrypted,
            // חיבור מחדש מתחיל סנכרון נקי — הטוקן הישן שייך לחשבון
            // שאולי כבר אינו אותו חשבון
            syncToken: null,
            lastError: null,
          },
        });
        return;
      }
      await tx.googleCalendarLink.create({
        data: { id: ulid(), tenantId, userId, googleEmail: email, refreshTokenEncrypted: encrypted },
      });
    });

    return { email };
  }

  async disconnect(tenantId: string, userId: string): Promise<void> {
    await this.prisma.withExplicitTenant(tenantId, async (tx) => {
      await tx.googleCalendarLink.deleteMany({ where: { userId } });
    });
  }

  async linkFor(tenantId: string, userId: string): Promise<CalendarLink | null> {
    return this.prisma.withExplicitTenant(tenantId, async (tx) =>
      tx.googleCalendarLink.findUnique({ where: { userId } }),
    );
  }

  /** ---------- קריאות ליומן עצמו ---------- */

  /**
   * access token טרי מתוך ה-refresh token.
   *
   * אינו נשמר: תוקפו שעה, והשמירה שלו הייתה מוסיפה סוד נוסף לבסיס
   * הנתונים בתמורה לחיסכון של בקשה אחת בסבב שרץ פעם ברבע שעה.
   */
  private async accessToken(link: CalendarLink): Promise<string> {
    const creds = await this.credentials();
    if (!creds) throw new ServiceUnavailableException("חיבור ליומן Google אינו מוגדר");
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

  /** יצירה או עדכון של אירוע. מחזיר את מזהה האירוע ב-Google. */
  async upsertEvent(
    link: CalendarLink,
    event: {
      googleEventId: string | null;
      summary: string;
      description?: string;
      startsAt: Date;
      endsAt: Date;
      cancelled: boolean;
    },
  ): Promise<string | null> {
    const token = await this.accessToken(link);
    const calendar = encodeURIComponent(link.calendarId);

    if (event.cancelled && event.googleEventId) {
      await this.fetchRaw(`${CALENDAR_BASE}/calendars/${calendar}/events/${event.googleEventId}`, {
        method: "DELETE",
        token,
      });
      return null;
    }
    if (event.cancelled) return null;

    const payload = {
      summary: event.summary,
      description: event.description ?? "",
      start: { dateTime: event.startsAt.toISOString() },
      end: { dateTime: event.endsAt.toISOString() },
    };

    if (event.googleEventId) {
      /*
       * עדכון קודם ליצירה, ונפילה ליצירה רק כשהאירוע **באמת** נעלם.
       *
       * אירוע שנמחק ביומן מחזיר 404 (או 410 כשהוא רק בוטל). בלי
       * הטיפול הזה נותרו שתי אפשרויות גרועות: לוותר על הפגישה
       * לנצח, או למחוק את המזהה מראש — וזה היה משכפל **כל** פגישה
       * תקינה בכל דחיפה מחדש (ביקורת Codex).
       */
      const patched = await this.fetchRaw(
        `${CALENDAR_BASE}/calendars/${calendar}/events/${event.googleEventId}`,
        { method: "PATCH", json: payload, token },
      );
      if (patched.ok) {
        const updated = (await patched.json()) as { id?: string };
        return updated.id ?? event.googleEventId;
      }
      if (patched.status !== 404 && patched.status !== 410) {
        this.logger.error(`Google החזיר ${patched.status} בעדכון אירוע`);
        throw new ServiceUnavailableException("Google החזיר שגיאה");
      }
      // נמחק ביומן — נוצר מחדש בהמשך הפונקציה
    }
    const created = await this.fetchJson<{ id?: string }>(
      `${CALENDAR_BASE}/calendars/${calendar}/events`,
      { method: "POST", json: payload, token },
    );
    return created.id ?? null;
  }

  /**
   * מה השתנה ביומן מאז הסבב הקודם.
   *
   * `syncToken` פג מדי פעם אצל Google (410). זו אינה שגיאה אלא
   * הוראה: מתחילים מחדש בלי טוקן, ומקבלים את החלון הקרוב במלואו.
   */
  async changesSince(
    link: CalendarLink,
    windowStart: Date,
  ): Promise<{ events: GoogleEvent[]; nextSyncToken: string | null }> {
    const token = await this.accessToken(link);
    const calendar = encodeURIComponent(link.calendarId);

    const request = async (syncToken: string | null): Promise<Response> => {
      const params = new URLSearchParams({ maxResults: "250", singleEvents: "true" });
      if (syncToken) params.set("syncToken", syncToken);
      // timeMin ו-syncToken אינם יכולים לחיות יחד אצל Google
      else params.set("timeMin", windowStart.toISOString());
      return this.fetchRaw(`${CALENDAR_BASE}/calendars/${calendar}/events?${params.toString()}`, {
        token,
      });
    };

    let res = await request(link.syncToken);
    if (res.status === 410) {
      this.logger.log(`טוקן הסנכרון של ${link.googleEmail} פג — משיכה מלאה`);
      res = await request(null);
    }
    if (!res.ok) {
      throw new ServiceUnavailableException(`Google החזיר ${res.status} על רשימת האירועים`);
    }
    const body = (await res.json()) as { items?: GoogleEvent[]; nextSyncToken?: string };
    return { events: body.items ?? [], nextSyncToken: body.nextSyncToken ?? null };
  }

  /** ---------- עזר ---------- */

  private async fetchRaw(
    url: string,
    init: { method?: string; body?: URLSearchParams; json?: unknown; token?: string },
  ): Promise<Response> {
    const headers: Record<string, string> = {};
    if (init.token) headers.authorization = `Bearer ${init.token}`;
    if (init.json !== undefined) headers["content-type"] = "application/json";
    try {
      return await fetch(url, {
        method: init.method ?? "GET",
        headers,
        body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      this.logger.error(`Google Calendar אינו נגיש: ${String(error)}`);
      throw new ServiceUnavailableException("יומן Google אינו זמין כרגע");
    }
  }

  private async fetchJson<T>(
    url: string,
    init: { method?: string; body?: URLSearchParams; json?: unknown; token?: string },
  ): Promise<T> {
    const res = await this.fetchRaw(url, init);
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      this.logger.error(`Google החזיר ${res.status}: ${detail.slice(0, 200)}`);
      throw new ServiceUnavailableException("יומן Google החזיר שגיאה");
    }
    return (await res.json()) as T;
  }

  /**
   * האימייל מתוך ה-id_token, בלי אימות חתימה.
   *
   * התעודה נמשכה **ישירות** מנקודת הקצה של Google מעל TLS ולא עברה
   * דרך הדפדפן — אותו נימוק בדיוק כמו ב-GoogleAuthService. היא גם
   * משמשת כאן לתצוגה בלבד ("מחובר ל-x@gmail.com"), ולא כהרשאה.
   */
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
