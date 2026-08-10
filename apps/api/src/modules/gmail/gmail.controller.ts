import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import { IdSchema } from "@metavchim/shared";
import { RequireCapability } from "../../common/auth.decorators";
import { TenantContext } from "../../common/tenant-context";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { loadEnv } from "../../config/env";
import { GmailOutboundService } from "./gmail-outbound.service";
import { GmailSyncService } from "./gmail-sync.service";
import { GmailService } from "./gmail.service";

/**
 * היעד אינו מתקבל מהמסך אלא נגזר מהכרטיס — ראו הנימוק ב-
 * GmailOutboundService. המסך מוסר מזהה לקוח, לא כתובת.
 */
const SendSchema = z
  .object({
    contactId: IdSchema,
    leadId: IdSchema.optional(),
    subject: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(5000),
  })
  .strict();

/**
 * חיבור Gmail וניתוקו — אותה תבנית כמו חיבור יומן Google, כולל
 * הנימוק לנתיבי callback מאומתים (SameSite=Lax).
 *
 * ‎settings.manage‎ ולא ‎leads.edit‎: זה חיבור של תיבת המשרד — מי
 * שמחבר אותה מזרים לידים לכל המשרד, וזו החלטת מנהל.
 */

const STATE_COOKIE = "mv_gmail_state";
const STATE_TTL_MS = 10 * 60 * 1000;

@Controller("gmail")
export class GmailController {
  constructor(
    private readonly gmail: GmailService,
    private readonly sync: GmailSyncService,
    private readonly outbound: GmailOutboundService,
  ) {}

  @Get("status")
  @RequireCapability("settings.manage")
  async status(): Promise<{
    available: boolean;
    connected: boolean;
    email?: string;
    lastSyncAt?: Date;
    lastError?: string;
    skippedCount?: number;
  }> {
    const { tenantId, userId } = TenantContext.current();
    const available = await this.gmail.isConfigured();
    if (!available) return { available: false, connected: false };
    const link = await this.gmail.linkFor(tenantId, userId);
    if (!link) return { available: true, connected: false };
    return {
      available: true,
      connected: true,
      email: link.googleEmail,
      skippedCount: link.skippedCount,
      ...(link.lastSyncAt ? { lastSyncAt: link.lastSyncAt } : {}),
      // חיבור שנשבר בשקט הוא הגרוע מכולם — ראו חיבור היומן
      ...(link.lastError ? { lastError: link.lastError } : {}),
    };
  }

  @Get("start")
  @RequireCapability("settings.manage")
  async start(@Res() res: Response): Promise<void> {
    const state = GmailService.newState();
    res.cookie(STATE_COOKIE, state, {
      httpOnly: true,
      secure: loadEnv().COOKIE_SECURE,
      // lax ולא strict — העוגייה חייבת לחזור מהניווט של Google
      sameSite: "lax",
      maxAge: STATE_TTL_MS,
      path: "/",
    });
    res.redirect(await this.gmail.authorizationUrl(state));
  }

  @Get("callback")
  @RequireCapability("settings.manage")
  async callback(@Req() req: Request, @Res() res: Response): Promise<void> {
    const webOrigin = loadEnv().WEB_ORIGIN;
    // חוזרים אל מסך ההגדרות, ישירות לקטע ה-Gmail — שם התוצאה נקראת
    // ומוצגת; ההפניה למסך האינטגרציות הייתה נוחתת על דף שלא מציג כלום
    const done = (result: string): string => `${webOrigin}/settings?gmail=${result}#gmail`;
    const query = req.query as Record<string, string | undefined>;
    const expected = (req.cookies as Record<string, string> | undefined)?.[STATE_COOKIE];
    res.clearCookie(STATE_COOKIE, { path: "/" }); // חד-פעמי בכל מקרה

    const code = query["code"];
    // השוואת state לפני כל פנייה החוצה — תשובה שלא נולדה מבקשה שלנו
    if (query["error"] !== undefined || !code || !expected || query["state"] !== expected) {
      res.redirect(done("failed"));
      return;
    }

    const { tenantId, userId } = TenantContext.current();
    try {
      await this.gmail.connect(code, tenantId, userId);
      res.redirect(done("connected"));
    } catch {
      res.redirect(done("failed"));
    }
  }

  @Delete("connection")
  @RequireCapability("settings.manage")
  @HttpCode(200)
  async disconnect(): Promise<{ ok: true }> {
    const { tenantId, userId } = TenantContext.current();
    await this.gmail.disconnect(tenantId, userId);
    return { ok: true };
  }

  /** משיכה עכשיו — ההבדל בין "חובר" ל"חובר ואני רואה שזה אמיתי". */
  @Post("sync")
  @RequireCapability("settings.manage")
  @HttpCode(200)
  async syncNow(): Promise<{ imported: number; skipped: number }> {
    const { tenantId, userId } = TenantContext.current();
    return this.sync.syncOne(tenantId, userId);
  }

  /**
   * האם המשתמש הזה יכול לשלוח — כלומר יש לו תיבה מחוברת.
   *
   * החיבור הוא **אישי** ולא משרדי: כל סוכן שולח מהתיבה שלו, והתשובה
   * חוזרת אליו. לכן זו שאלה על המשתמש הנוכחי ולא על המשרד.
   */
  @Get("can-send")
  @RequireCapability("leads.edit")
  async canSend(): Promise<{ canSend: boolean; from?: string }> {
    const { tenantId, userId } = TenantContext.current();
    const link = await this.gmail.linkFor(tenantId, userId);
    return link ? { canSend: true, from: link.googleEmail } : { canSend: false };
  }

  /**
   * שליחת מייל ללקוח מהתיבה המחוברת.
   *
   * ‎leads.edit‎ ולא ‎settings.manage‎: שליחת מייל ללקוח היא עבודה
   * יומיומית של סוכן, בעוד שחיבור התיבה עצמה הוא החלטת מנהל.
   */
  @Post("send")
  @RequireCapability("leads.edit")
  @HttpCode(200)
  async send(
    @Body(new ZodValidationPipe(SendSchema)) body: z.infer<typeof SendSchema>,
  ): Promise<{ ok: true }> {
    const { tenantId, userId } = TenantContext.current();
    const link = await this.gmail.linkFor(tenantId, userId);
    if (!link) {
      throw new BadRequestException("לא מחוברת תיבת Gmail — חברו אותה בהגדרות");
    }
    await this.outbound.sendToContact(link, body);
    return { ok: true };
  }
}
