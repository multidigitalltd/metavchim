import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { z } from "zod";
import { IdSchema, TELEPHONY_PROVIDERS } from "@metavchim/shared";
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

/**
 * חיוג — **מזהה איש קשר, לא מספר**.
 *
 * `phone` מותר רק כדי לבחור בין המספרים של אותו איש קשר (בעל/אישה),
 * והשרת מאמת אותו מולם. מספר חופשי בבקשה היה הופך את הנתיב לחייגן
 * פתוח על חשבון המשרד.
 */
const DialSchema = z
  .object({ contactId: IdSchema, phone: z.string().max(30).optional() })
  .strict();

/** קו ה-SIP האישי. סיסמה חסרה = השאר את מה שכבר שמור. */
const MyLineSchema = z
  .object({
    username: z.string().max(80).optional(),
    password: z.string().max(200).optional(),
  })
  .strict();

const ResolveSchema = z.object({ phone: z.string().min(3).max(30) }).strict();

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

  /**
   * חיוג בלחיצה. **מקבל מזהה איש קשר ולא מספר** — ראו TelephonyService.dial:
   * נתיב שמקבל מספר חופשי הוא חייגן פתוח על חשבון המשרד.
   *
   * `leads.edit` — חיוג ללקוח הוא פעולה של סוכן עובד, לא של צופה.
   */
  @Post("dial")
  @RequireCapability("leads.edit")
  @RequireFeature("telephony")
  @HttpCode(200)
  async dial(
    @Body(new ZodValidationPipe(DialSchema)) body: z.infer<typeof DialSchema>,
  ): Promise<{ ok: boolean; callId?: string; message: string }> {
    return this.telephony.dial(body);
  }

  /*
   * הסופטפון — שלושת הנתיבים הבאים.
   *
   * ‎`leads.edit` ולא `settings.manage`: לדבר עם לקוח זו עבודת הסוכן,
   * ואם רק מנהל המשרד יכול היה להירשם לסופטפון, הפיצ'ר היה חסר
   * משמעות. מה שכן שמור למנהל הוא **הגדרת** המרכזייה (‎POST /‎).
   */

  /** קו ה-SIP האישי — של המשתמש המחובר, ואין דרך לנקוב באחר. */
  @Get("my-line")
  @RequireCapability("leads.edit")
  async myLine(): Promise<{ username: string; hasPassword: boolean }> {
    return this.telephony.myLine();
  }

  @Post("my-line")
  @RequireCapability("leads.edit")
  @HttpCode(200)
  async saveMyLine(
    @Body(new ZodValidationPipe(MyLineSchema)) body: z.infer<typeof MyLineSchema>,
  ): Promise<{ ok: true }> {
    return this.telephony.saveMyLine(body);
  }

  /**
   * האם להציג את כפתור "חבר סופטפון". נשאל בטעינת כל עמוד — ולכן
   * מחזיר ביט אחד ואף סוד, ראו TelephonyService.softphoneAvailability.
   */
  @Get("softphone/availability")
  @RequireCapability("leads.edit")
  async softphoneAvailability(): Promise<{ available: boolean }> {
    return this.telephony.softphoneAvailability();
  }

  /**
   * פרטי הרישום לדפדפן. מחזיר סיסמת SIP — של המשתמש המחובר בלבד,
   * ולעולם לא של אחר. ראו TelephonyService.softphone.
   */
  @Get("softphone")
  @RequireCapability("leads.edit")
  async softphone(): ReturnType<TelephonyService["softphone"]> {
    return this.telephony.softphone();
  }

  /**
   * מי מתקשר. מוגבל בקצב: הוא מקבל מספר ומחזיר האם הוא מוכר, וללא
   * הגבלה אפשר היה לסרוק דרכו מספרים ולגלות מי לקוח של המשרד.
   */
  @Post("resolve-caller")
  @RequireCapability("leads.edit")
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @HttpCode(200)
  async resolveCaller(
    @Body(new ZodValidationPipe(ResolveSchema)) body: z.infer<typeof ResolveSchema>,
  ): Promise<{ name?: string; contactId?: string }> {
    return this.telephony.resolveCaller(body.phone);
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
