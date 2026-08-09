import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { z } from "zod";
import { TELEPHONY_PROVIDERS } from "@metavchim/shared";
import { Public, RequireCapability } from "../../common/auth.decorators";
import { RequireFeature } from "../../common/feature.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { TelephonyService } from "./telephony.service";

const ConnectSchema = z
  .object({
    provider: z.string().min(1).max(30),
    /** הגדרות גלויות — שלוחה, מזהה חשבון */
    config: z.record(z.string().max(40), z.string().max(200)).default({}),
    /** סודות; חסר = השאר את מה שכבר שמור */
    secrets: z.record(z.string().max(40), z.string().max(500)).default({}),
  })
  .strict();

const KeySchema = z.string().regex(/^[A-Za-z0-9_-]{20,64}$/u);

/*
 * שער ברמת המחלקה. ה-Webhook הציבורי שבתוכה מסומן @Public ולכן
 * מדולג כאן — הזכאות שלו נבדקת ב-TelephonyService, אחרי שהמפתח זיהה
 * את המשרד (ביקורת Codex).
 */
@RequireFeature("telephony")
@Controller("settings/telephony")
export class TelephonyController {
  constructor(private readonly telephony: TelephonyService) {}

  /** רשימת הספקים והשדות שכל אחד דורש — המסך נבנה ממנה. */
  @Get("providers")
  @RequireCapability("settings.manage")
  providers(): typeof TELEPHONY_PROVIDERS {
    return TELEPHONY_PROVIDERS;
  }

  @Get()
  @RequireCapability("settings.manage")
  async status(): ReturnType<TelephonyService["status"]> {
    return this.telephony.status();
  }

  @Post()
  @RequireCapability("settings.manage")
  @HttpCode(200)
  async connect(
    @Body(new ZodValidationPipe(ConnectSchema)) body: z.infer<typeof ConnectSchema>,
  ): Promise<{ ok: true }> {
    return this.telephony.connect(body);
  }

  @Delete()
  @RequireCapability("settings.manage")
  async disconnect(): Promise<{ ok: true }> {
    return this.telephony.disconnect();
  }
}

/**
 * הנתיב שהמרכזייה קוראת לו.
 *
 * ציבורי בהכרח — מרכזייה לא מתחברת עם עוגייה — ולכן המשרד נגזר
 * מהמפתח שבכתובת בלבד. הגוף מתקבל כאובייקט חופשי כי כל ספק שולח
 * שמות שדות אחרים; הנרמול והוולידציה יושבים ב-parseTelephonyEvent,
 * ומה שלא מזוהה נבלע בשקט במקום להפיל את המרכזייה.
 */
@Controller("public/telephony")
export class TelephonyWebhookController {
  constructor(private readonly telephony: TelephonyService) {}

  /*
   * מגבלת קצב משלה: הנתיב כותב שורות (שיחה, ולפעמים ליד). מרכזייה
   * אמיתית של משרד תיווך שולחת עשרות אירועים בשעה, לא מאות בדקה.
   */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Post(":key")
  @HttpCode(200)
  async ingest(
    @Param("key", new ZodValidationPipe(KeySchema)) key: string,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    await this.telephony.ingest(key, asRecord(body));
    return { ok: true };
  }

  /**
   * מרכזיות רבות בישראל יודעות רק "לקרוא ל-URL" — בלי POST ובלי גוף,
   * כשכל הפרמטרים ב-query string. אותה קליטה בדיוק, ובלי הנתיב הזה
   * חלק גדול מהמשרדים לא היו יכולים להתחבר כלל.
   */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get(":key")
  async ingestViaQuery(
    @Param("key", new ZodValidationPipe(KeySchema)) key: string,
    @Query() query: Record<string, unknown>,
  ): Promise<{ ok: true }> {
    await this.telephony.ingest(key, query);
    return { ok: true };
  }
}

/** גוף בקשה לא צפוי (מערך, מחרוזת, null) לא מפיל את הקליטה. */
function asRecord(body: unknown): Record<string, unknown> {
  return typeof body === "object" && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}
