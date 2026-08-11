import { Controller, Delete, Get, HttpCode, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { RequireCapability } from "../../common/auth.decorators";
import { TenantContext } from "../../common/tenant-context";
import { loadEnv } from "../../config/env";
import { CalendarSyncService, type SyncResult } from "./calendar-sync.service";
import { GoogleCalendarService } from "./google-calendar.service";

/**
 * חיבור יומן Google וניתוקו.
 *
 * הנתיבים **מאומתים** ולא ציבוריים, כולל החזרה מ-Google: החיבור נשמר
 * על המשתמש, ולכן צריך לדעת מיהו. זה עובד כי החזרה מ-Google היא
 * ניווט עליון של הדפדפן ועוגיית ה-Session היא `SameSite=Lax` —
 * כלומר היא נשלחת. אילו הייתה `Strict`, המשתמש היה חוזר כאנונימי
 * וההרשאה שזה עתה נתן הייתה נזרקת.
 */

/** ה-state נשמר בעוגייה קצרת-חיים, בדיוק כמו בהתחברות עם Google. */
const STATE_COOKIE = "mv_gcal_state";
const STATE_TTL_MS = 10 * 60 * 1000;

@Controller("calendar/google")
export class GoogleCalendarController {
  constructor(
    private readonly google: GoogleCalendarService,
    private readonly sync: CalendarSyncService,
  ) {}

  @Get("status")
  @RequireCapability("calendar.manage")
  async status(): Promise<{
    available: boolean;
    connected: boolean;
    email?: string;
    lastSyncAt?: Date;
    lastError?: string;
  }> {
    const { tenantId, userId } = TenantContext.current();
    const available = await this.google.isConfigured();
    if (!available) return { available: false, connected: false };
    const link = await this.google.linkFor(tenantId, userId);
    if (!link) return { available: true, connected: false };
    return {
      available: true,
      connected: true,
      email: link.googleEmail,
      /*
       * `lastError` מוחזר ללקוח בכוונה.
       *
       * חיבור שנשבר בשקט הוא הגרוע מכולם: המשתמש ממשיך לסמוך עליו,
       * ופגישות מפסיקות להופיע ביומן בלי שאיש יידע. הטקסט הוא הודעת
       * שגיאה שלנו ולא של Google, ואינו נושא סודות.
       */
      ...(link.lastSyncAt ? { lastSyncAt: link.lastSyncAt } : {}),
      ...(link.lastError ? { lastError: link.lastError } : {}),
    };
  }

  @Get("start")
  @RequireCapability("calendar.manage")
  async start(@Res() res: Response): Promise<void> {
    const state = GoogleCalendarService.newState();
    res.cookie(STATE_COOKIE, state, {
      httpOnly: true,
      secure: loadEnv().COOKIE_SECURE,
      // lax ולא strict — העוגייה חייבת לחזור מהניווט של Google
      sameSite: "lax",
      maxAge: STATE_TTL_MS,
      path: "/",
    });
    res.redirect(await this.google.authorizationUrl(state));
  }

  @Get("callback")
  @RequireCapability("calendar.manage")
  async callback(@Req() req: Request, @Res() res: Response): Promise<void> {
    const webOrigin = loadEnv().WEB_ORIGIN;
    const done = `${webOrigin}/settings/integrations`;
    const query = req.query as Record<string, string | undefined>;
    const expected = (req.cookies as Record<string, string> | undefined)?.[STATE_COOKIE];
    res.clearCookie(STATE_COOKIE, { path: "/" }); // חד-פעמי בכל מקרה

    const code = query["code"];
    // השוואת state לפני כל פנייה החוצה — תשובה שלא נולדה מבקשה שלנו
    if (query["error"] !== undefined || !code || !expected || query["state"] !== expected) {
      res.redirect(`${done}?calendar=failed`);
      return;
    }

    const { tenantId, userId } = TenantContext.current();
    try {
      await this.google.connect(code, tenantId, userId);
      res.redirect(`${done}?calendar=connected`);
    } catch {
      res.redirect(`${done}?calendar=failed`);
    }
  }

  @Delete("connection")
  @RequireCapability("calendar.manage")
  @HttpCode(200)
  async disconnect(): Promise<{ ok: true }> {
    const { tenantId, userId } = TenantContext.current();
    await this.google.disconnect(tenantId, userId);
    return { ok: true };
  }

  /**
   * סנכרון עכשיו.
   *
   * הסורק רץ כל רבע שעה, וזה נכון לרוב הזמן ולא נכון בדיוק ברגע
   * שבו מישהו חיבר יומן ורוצה לראות שזה עובד. הכפתור הזה הוא ההבדל
   * בין "חובר" לבין "חובר ואני רואה שזה אמיתי".
   */
  @Post("sync")
  @RequireCapability("calendar.manage")
  @HttpCode(200)
  async syncNow(): Promise<SyncResult> {
    const { tenantId, userId } = TenantContext.current();
    return this.sync.syncOne(tenantId, userId);
  }

  /**
   * "דחוף הכול מחדש" — מאפס את סימוני הסנכרון ומריץ סבב.
   *
   * פגישה שנמחקה בטעות ביומן Google לא הייתה חוזרת לעולם: היא כבר
   * מסומנת כמסונכרנת ולכן אינה נחשבת ממתינה. זה המסלול לתקן את זה
   * בלי לגעת בבסיס הנתונים.
   */
  @Post("resync")
  @RequireCapability("calendar.manage")
  @HttpCode(200)
  async resync(): Promise<SyncResult & { reset: number }> {
    const { tenantId, userId } = TenantContext.current();
    const reset = await this.sync.resetSyncMarks(tenantId, userId);
    const result = await this.sync.syncOne(tenantId, userId);
    return { ...result, reset };
  }
}
