import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { z } from "zod";
import { IdSchema, TELEPHONY_PROVIDERS } from "@metavchim/shared";
import { Public, RequireCapability } from "../../common/auth.decorators";
import { RequireFeature } from "../../common/feature.guard";
import { TenantContext } from "../../common/tenant-context";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { RecordingFetchService } from "./recording-fetch.service";
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

/*
 * המפתח מגיע לשירות **בלי ולידציה מוקדמת**, בכוונה.
 *
 * `ZodValidationPipe` היה דוחה מפתח קטוע או משובש ב-400 עוד לפני
 * שהשירות רץ — כלומר בדיוק המקרה של ספק שהוגדרה אצלו כתובת שגויה
 * לא היה מותיר שום עקבה, וזה המקרה שהיומן נבנה בשבילו. הבדיקה
 * עברה ל-`TelephonyService.ingest`, שרושם ואז דוחה.
 *
 * האורך מוגבל כאן כדי שלא ייכנס לשירות ערך ענק; זה גבול טכני,
 * לא ולידציה של תוכן.
 */
const RawKeySchema = z.string().max(200);

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

/**
 * כמה ימים אחורה לייבא.
 *
 * תקרה של 90 יום ולא „הכול”: מדיניות השמירה אצל הספק ממילא
 * מוגבלת, וטווח פתוח הוא בקשה שעלולה להימשך דקות ולהיתקל בפסק
 * הזמן — כלומר ייבוא שנראה כאילו נכשל אחרי שכבר סימן חצי.
 */
const ImportSchema = z
  .object({ days: z.coerce.number().int().min(1).max(90).default(30) })
  .strict();

/*
 * שער ברמת המחלקה. ה-Webhook הציבורי שבתוכה מסומן @Public ולכן
 * מדולג כאן — הזכאות שלו נבדקת ב-TelephonyService, אחרי שהמפתח זיהה
 * את המשרד (ביקורת Codex).
 */
@RequireFeature("telephony")
@Controller("settings/telephony")
export class TelephonyController {
  constructor(
    private readonly telephony: TelephonyService,
    private readonly recordings: RecordingFetchService,
  ) {}

  /**
   * ייבוא הקלטות שהמרכזייה מחזיקה ואנחנו לא.
   *
   * `settings.manage` ולא `leads.edit`: זו פעולה על החיבור של
   * המשרד, לא על לקוח בודד — ולכן היא שייכת למי שמחזיק אותו.
   *
   * מוגבל בקצב: זו קריאה יקרה אצל הספק על טווח תאריכים שלם,
   * ולחיצה חוזרת אינה מוסיפה דבר (ההקלטות שכבר סומנו נספרות
   * כ-`alreadyHad`).
   */
  @Post("recordings/import")
  @RequireCapability("settings.manage")
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(200)
  async importRecordings(
    @Body(new ZodValidationPipe(ImportSchema)) body: z.infer<typeof ImportSchema>,
  ): Promise<{ found: number; linked: number; alreadyHad: number; withoutCall: number }> {
    const to = new Date();
    const from = new Date(to.getTime() - body.days * 24 * 60 * 60 * 1000);
    return this.recordings.importRange(TenantContext.current().tenantId, from, to);
  }

  /** רשימת הספקים והשדות שכל אחד דורש — המסך נבנה ממנה. */
  @Get("providers")
  @RequireCapability("settings.manage")
  providers(): typeof TELEPHONY_PROVIDERS {
    return TELEPHONY_PROVIDERS;
  }

  /**
   * לבאנר במסך השיחות — האם מחוברת מרכזיה, ותו לא.
   *
   * `leads.view_own` ולא `settings.manage`: כל סוכן רואה את מסך
   * השיחות, והבאנר צריך לדעת אם להופיע. שום פרט תצורה אינו נחשף —
   * רק קיום החיבור.
   */
  @Get("presence")
  @RequireCapability("leads.view_own")
  async presence(): Promise<{ connected: boolean }> {
    return { connected: await this.telephony.isConnected() };
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
   * הסופטפון. *ההתחברות* פתוחה לסוכן (‎leads.edit‎) — לדבר עם לקוח
   * זו עבודת הסוכן. *ההקצאה* של הקווים שמורה למנהל המשרד
   * (‎settings.manage‎): הוא מי שמקבל את הקווים ממנהל המרכזייה,
   * והסוכן לא אמור להזין סיסמאות SIP בעצמו.
   */

  /** קווי ה-SIP של כל הצוות — למסך ההגדרות של המנהל. */
  @Get("lines")
  @RequireCapability("settings.manage")
  async lines(): ReturnType<TelephonyService["lines"]> {
    return this.telephony.lines();
  }

  /** הקצאת קו לסוכן. סיסמה חסרה = השאר את השמורה. */
  @Post("lines/:userId")
  @RequireCapability("settings.manage")
  @HttpCode(200)
  async saveLine(
    @Param("userId", new ZodValidationPipe(IdSchema)) userId: string,
    @Body(new ZodValidationPipe(MyLineSchema)) body: z.infer<typeof MyLineSchema>,
  ): Promise<{ ok: true }> {
    return this.telephony.saveLineFor(userId, body);
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
    @Param("key", new ZodValidationPipe(RawKeySchema)) key: string,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    await this.telephony.ingest(key, asRecord(body), "POST");
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
    @Param("key", new ZodValidationPipe(RawKeySchema)) key: string,
    @Query() query: Record<string, unknown>,
  ): Promise<{ ok: true }> {
    await this.telephony.ingest(key, query, "GET");
    return { ok: true };
  }
}

/** גוף בקשה לא צפוי (מערך, מחרוזת, null) לא מפיל את הקליטה. */
function asRecord(body: unknown): Record<string, unknown> {
  return typeof body === "object" && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}
