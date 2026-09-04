import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  StreamableFile,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { z } from "zod";
import {
  IdSchema,
  INTAKE_FEATURES,
  INTAKE_NAME_MAX,
  INTAKE_NOTES_MAX,
  INTAKE_SELLER_FEATURES,
  INTAKE_SELLER_NAME_MAX,
  INTAKE_SELLER_NOTES_MAX,
  PropertyTypeSchema,
  type IntakeAnswers,
  type IntakeSellerAnswers,
} from "@metavchim/shared";
import { Public, RequireCapability } from "../../common/auth.decorators";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import {
  IntakeService,
  type IntakeListDto,
  type IntakePublicView,
  type IntakeRequestDto,
  type IntakeSentDto,
} from "./intake.service";

/**
 * טופס הדרישות של הלקוח — הצד הפנימי והצד הציבורי.
 *
 * ## היכולות
 *
 * הקריאה והכתיבה תחת יכולות הכרטיס עצמו: מי שרשאי לערוך ליד רשאי
 * לבקש מהלקוח למלא אותו, ומי שרשאי לערוך קונה — לקונה. יכולת
 * שלישית הייתה מתג שאיש לא ידע מתי להדליק, ובפועל הייתה חוסמת את
 * הסוכן שהתכונה נכתבה בשבילו.
 *
 * ## הנתיב הציבורי
 *
 * `@Public()` **וגם** הגבלת קצב. הטוקן הוא 256 ביט אקראיים ולכן
 * ניחוש אינו מעשי, אבל נתיב ציבורי בלי תקרה הוא נתיב שאפשר להעמיס
 * עליו — וההגבלה כאן זהה בנימוקה לזו של דף הנחיתה ודף ההצעה.
 */

const TokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);

/**
 * ‏באיזה ערוץ לשלוח.
 *
 * ‎`enum` בעל ערך אחד ולא נתיב בלי גוף: וואטסאפ נשלח היום מהדפדפן
 * (‏`waUrl`, פתיחת השיחה עם הנוסח מוכן) ולא מהשרת, ושליחה מהשרת
 * דורשת תבנית מאושרת ב-Meta. כשהיא תתווסף היא ערך נוסף כאן ולא
 * נתיב חדש — והשדה מחייב את המסך לומר מה הוא מבקש.
 */
const SendSchema = z.object({ channel: z.enum(["email"]) }).strict();

/**
 * מה שהלקוח שולח.
 *
 * `.strict()` — שדה שאיננו מכירים אינו נבלע בשקט. לקוח לא שולח
 * שדות עודפים; מי שכן שולח אותם עושה זאת בכוונה, וסכימה סלחנית
 * הייתה מזמינה אותו לנסות שוב עם משהו אחר.
 *
 * `nullable` על המספרים הוא חלק מהמשמעות: `null` = „אין לי
 * מגבלה”, בעוד היעדר השדה = „לא נשאלתי”. השניים מובילים לתוצאה
 * שונה במיזוג, ולכן הם שני ערכים ולא אחד.
 */
const AnswersSchema = z
  .object({
    /*
     * הזהות — **קישור פתוח בלבד.**
     *
     * הסכימה מקבלת אותם תמיד, והשירות הוא שמחליט אם הם נדרשים ואם
     * הם משמשים: בקישור לכרטיס קיים הם נשלחים לכל היותר בטעות
     * ואינם נוגעים בשום דבר. הכרעה כאן הייתה דורשת מהסכימה לדעת
     * איזה סוג קישור זה — כלומר לשלוף את השורה — ובדיקת קלט אינה
     * המקום שבו פונים למסד.
     *
     * האורך נאכף כאן; **התוכן** נבדק ב-`intakeOpenRejectionReason`,
     * שהוא גם מה שמנסח את השגיאה שהלקוח רואה.
     */
    fullName: z.string().trim().max(INTAKE_NAME_MAX).optional(),
    phone: z.string().trim().max(30).optional(),
    dealType: z.enum(["sale", "rent"]).optional(),
    cities: z.array(z.string().trim().max(80)).max(10).optional(),
    /*
     * `PropertyTypeSchema` ולא מחרוזת חופשית: ערך שאינו ברשימה נכתב
     * לדרישות הקונה ואז אינו תואם לשום נכס — כלומר הלקוח מסמן „בית
     * פרטי” ומקבל אפס התאמות, בלי שדבר נראה שבור. הרשימה נסגרת כאן
     * ולא בכרטיס, כי מכאן הערך נכנס.
     */
    propertyTypes: z.array(PropertyTypeSchema).max(12).optional(),
    /*
     * חצאי חדרים בלבד — אותה מגבלה שדרישות הקונה נושאות. בלעדיה
     * „3.7 חדרים” היה נשמר על הבקשה ואז נדחה בשער הכרטיס, כלומר
     * שליחה שנראית מוצלחת ואינה נכנסת לשום מקום.
     */
    roomsMin: z.number().min(0).max(30).multipleOf(0.5).nullish(),
    roomsMax: z.number().min(0).max(30).multipleOf(0.5).nullish(),
    budgetMinAgorot: z.number().int().min(0).max(1e13).nullish(),
    budgetMaxAgorot: z.number().int().min(0).max(1e13).nullish(),
    areaSqmMin: z.number().int().min(0).max(10_000).nullish(),
    features: z.record(z.enum(INTAKE_FEATURES), z.enum(["must", "nice"])).optional(),
    entryType: z.enum(["immediate", "by_date", "flexible"]).optional(),
    entryBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional(),
    notes: z.string().max(INTAKE_NOTES_MAX).optional(),
    /** honeypot — אמור להישאר ריק, כמו בטופס דף הנחיתה */
    website: z.string().max(200).optional(),
  })
  .strict();

/**
 * מה ש**המוכר** שולח.
 *
 * סכימה נפרדת ולא הרחבה של `AnswersSchema`: אין ביניהן שדה משותף
 * מלבד הזהות, ואיחוד היה מקבל תקציב מקונה ומחיר מבוקש מאותו גוף —
 * כלומר מפסיק לתאר מה מותר לשלוח.
 *
 * ‏`.strict()` מאותו נימוק: שדה שאיננו מכירים אינו נבלע בשקט.
 *
 * ‏**אין כאן `nullable`.** אצל הקונה `null` פירושו „אין לי מגבלה”,
 * וזו הבחנה שיש לה משמעות בדרישות. לנכס אין מגבלות — יש לו עובדות,
 * ועובדה שאינה ידועה פשוט אינה נשלחת.
 */
const SellerAnswersSchema = z
  .object({
    fullName: z.string().trim().max(INTAKE_SELLER_NAME_MAX).optional(),
    phone: z.string().trim().max(30).optional(),
    dealType: z.enum(["sale", "rent"]).optional(),
    city: z.string().trim().max(80).optional(),
    neighborhood: z.string().trim().max(80).optional(),
    street: z.string().trim().max(120).optional(),
    houseNumber: z.string().trim().max(10).optional(),
    /*
     * אותה רשימה סגורה של הצד השני, ומאותו נימוק: „בית פרטי” שנשלח
     * כמחרוזת חופשית נכתב על הנכס ואז אינו תואם לאף קונה — הכרטיס
     * נראה תקין, וההתאמות ריקות.
     */
    propertyType: PropertyTypeSchema.optional(),
    rooms: z.number().min(1).max(20).multipleOf(0.5).optional(),
    areaSqm: z.number().int().min(10).max(2000).optional(),
    floor: z.number().int().min(-2).max(60).optional(),
    totalFloors: z.number().int().min(1).max(60).optional(),
    priceAgorot: z.number().int().min(0).max(1e13).optional(),
    priceFlexible: z.boolean().optional(),
    features: z.record(z.enum(INTAKE_SELLER_FEATURES), z.boolean()).optional(),
    entryType: z.enum(["immediate", "from_date", "flexible"]).optional(),
    entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional(),
    notes: z.string().max(INTAKE_SELLER_NOTES_MAX).optional(),
    /** honeypot — אמור להישאר ריק, כמו בצד הקונה */
    website: z.string().max(200).optional(),
  })
  .strict();

@Controller()
export class IntakeController {
  constructor(private readonly intake: IntakeService) {}

  /* ---------- הצד הפנימי ---------- */

  @Get("leads/:id/intake")
  @RequireCapability("leads.view_own")
  listForLead(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<IntakeListDto> {
    return this.intake.listFor("lead", id);
  }

  @Post("leads/:id/intake")
  @RequireCapability("leads.edit")
  @HttpCode(200)
  createForLead(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<IntakeRequestDto> {
    return this.intake.ensure("lead", id);
  }

  /**
   * ‏שליחת הקישור ללקוח.
   *
   * ‎`leads.edit` ולא `leads.view_own`: זו הודעה שיוצאת מהמערכת אל
   * לקוח בשם המשרד, וזו אותה יכולת שהיצירה דורשת. מי שרשאי רק
   * להסתכל בכרטיס אינו רשאי לכתוב ללקוח שבו.
   */
  @Post("leads/:id/intake/send")
  @RequireCapability("leads.edit")
  @HttpCode(200)
  sendForLead(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(SendSchema)) body: z.infer<typeof SendSchema>,
  ): Promise<IntakeSentDto> {
    return this.intake.sendInvite("lead", id, body.channel);
  }

  @Get("buyers/:id/intake")
  @RequireCapability("buyers.view_own")
  listForBuyer(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<IntakeListDto> {
    return this.intake.listFor("buyer", id);
  }

  @Post("buyers/:id/intake")
  @RequireCapability("buyers.edit")
  @HttpCode(200)
  createForBuyer(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<IntakeRequestDto> {
    return this.intake.ensure("buyer", id);
  }

  @Post("buyers/:id/intake/send")
  @RequireCapability("buyers.edit")
  @HttpCode(200)
  sendForBuyer(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(SendSchema)) body: z.infer<typeof SendSchema>,
  ): Promise<IntakeSentDto> {
    return this.intake.sendInvite("buyer", id, body.channel);
  }

  /**
   * הקישורים הפתוחים של המשרד, ויצירת אחד חדש.
   *
   * `buyers.*` ולא יכולת חדשה: הקישור הפתוח מייצר **כרטיס קונה**,
   * ולכן מי שרשאי ליצור קונה רשאי לשלוח קישור שייצר אחד. יכולת
   * נפרדת הייתה מתג שאיש לא יודע מתי להדליק.
   */
  @Get("intake/open")
  @RequireCapability("buyers.view_own")
  listOpen(): Promise<IntakeRequestDto[]> {
    return this.intake.listOpen();
  }

  @Post("intake/open")
  @RequireCapability("buyers.edit")
  @HttpCode(200)
  createOpen(): Promise<IntakeRequestDto> {
    return this.intake.ensureOpen();
  }

  /**
   * ביטול קישור.
   *
   * `buyers.edit` **או** `leads.edit`: הבקשה יכולה להיות של כל אחד
   * מהשניים, והמזהה לבדו אינו אומר של מי. שתי היכולות ב-OR הן
   * הביטוי הנכון ל„מי שרשאי לערוך אחד מהכרטיסים האלה”.
   */
  @Delete("intake/:id")
  @RequireCapability("buyers.edit", "leads.edit")
  @HttpCode(204)
  async revoke(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<void> {
    await this.intake.revoke(id);
  }

  /* ---------- הצד הציבורי ---------- */

  @Get("f/:token")
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  view(
    @Param("token", new ZodValidationPipe(TokenSchema)) token: string,
  ): Promise<IntakePublicView> {
    return this.intake.publicView(token);
  }

  /** הלוגו של המשרד — הטופס הציבורי טוען אותו כתמונה רגילה. */
  @Get("f/:token/logo")
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Header("Cache-Control", "private, max-age=3600")
  async logo(
    @Param("token", new ZodValidationPipe(TokenSchema)) token: string,
  ): Promise<StreamableFile> {
    const obj = await this.intake.publicLogo(token);
    return new StreamableFile(obj.body as never, {
      type: obj.contentType,
      ...(obj.contentLength !== undefined ? { length: obj.contentLength } : {}),
    });
  }

  @Post("f/:token")
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  async submit(
    @Param("token", new ZodValidationPipe(TokenSchema)) token: string,
    @Body(new ZodValidationPipe(AnswersSchema))
    body: z.infer<typeof AnswersSchema>,
  ): Promise<{ ok: true }> {
    const { website, ...answers } = body;
    /*
     * מלכודת דבש: בוט ממלא כל שדה שהוא מוצא, אדם אינו רואה אותה.
     * התשובה היא `200` ולא שגיאה — בוט שמקבל שגיאה מנסה שוב עם
     * שינוי, ובוט שמקבל „הצלחה” ממשיך הלאה.
     */
    if (website !== undefined && website !== "") return { ok: true };
    return this.intake.submit(token, normalizeAnswers(answers));
  }

  /**
   * אותו טוקן, צד אחר.
   *
   * נתיב נפרד ולא דגל בגוף: הסכימות אינן חופפות, ואיחוד מבחין
   * (`discriminatedUnion`) היה מחזיר ללקוח שגיאת ולידציה שמדברת על
   * השדות של הצד השני — כלומר על שדות שהעמוד לא הציג לו בכלל.
   *
   * אותה תקרת קצב ואותה מלכודת דבש: הנתיב ציבורי באותה מידה.
   */
  @Post("f/:token/seller")
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  async submitSeller(
    @Param("token", new ZodValidationPipe(TokenSchema)) token: string,
    @Body(new ZodValidationPipe(SellerAnswersSchema))
    body: z.infer<typeof SellerAnswersSchema>,
  ): Promise<{ ok: true }> {
    const { website, ...answers } = body;
    if (website !== undefined && website !== "") return { ok: true };
    return this.intake.submitSeller(token, normalizeSellerAnswers(answers));
  }
}

/**
 * אותו נימוק כמו ב-`normalizeAnswers`: הטיפוס המוחזר הוא
 * `IntakeSellerAnswers` ולא `Record<string, unknown>`, כדי ששם שדה
 * שהוקלד לא נכון ייתפס במהדר ולא יעבור בשקט אל מיפוי שדות הנכס.
 */
function normalizeSellerAnswers(
  answers: Omit<z.infer<typeof SellerAnswersSchema>, "website">,
): IntakeSellerAnswers {
  return {
    ...(answers.fullName !== undefined ? { fullName: answers.fullName } : {}),
    ...(answers.phone !== undefined ? { phone: answers.phone } : {}),
    ...(answers.dealType !== undefined ? { dealType: answers.dealType } : {}),
    ...(answers.city !== undefined ? { city: answers.city } : {}),
    ...(answers.neighborhood !== undefined
      ? { neighborhood: answers.neighborhood }
      : {}),
    ...(answers.street !== undefined ? { street: answers.street } : {}),
    ...(answers.houseNumber !== undefined
      ? { houseNumber: answers.houseNumber }
      : {}),
    ...(answers.propertyType !== undefined
      ? { propertyType: answers.propertyType }
      : {}),
    ...(answers.rooms !== undefined ? { rooms: answers.rooms } : {}),
    ...(answers.areaSqm !== undefined ? { areaSqm: answers.areaSqm } : {}),
    ...(answers.floor !== undefined ? { floor: answers.floor } : {}),
    ...(answers.totalFloors !== undefined
      ? { totalFloors: answers.totalFloors }
      : {}),
    ...(answers.priceAgorot !== undefined
      ? { priceAgorot: answers.priceAgorot }
      : {}),
    ...(answers.priceFlexible !== undefined
      ? { priceFlexible: answers.priceFlexible }
      : {}),
    ...(answers.features !== undefined ? { features: answers.features } : {}),
    ...(answers.entryType !== undefined ? { entryType: answers.entryType } : {}),
    ...(answers.entryDate !== undefined ? { entryDate: answers.entryDate } : {}),
    ...(answers.notes !== undefined ? { notes: answers.notes } : {}),
  };
}

/**
 * `null` מהרשת → `NaN` פנימי.
 *
 * המיזוג מבדיל בין „לא נשלח” (השדה נשאר) לבין „אין לי מגבלה”
 * (השדה נמחק), ו-`null` הוא הביטוי של השני ברשת. הוא מתורגם כאן
 * ולא בסכימה כדי ש-`applyIntakeAnswers` יישאר עם טיפוס אחד לכל
 * מספר.
 *
 * **הטיפוס המוחזר הוא `IntakeAnswers` ולא `Record<string, unknown>`,
 * וזה לא ניסוח.** TypeScript מקבל `Record<string, unknown>` כארגומנט
 * לממשק שכל שדותיו רשות — חתימת האינדקס „מספקת” כל שדה — ולכן
 * הגרסה הקודמת עברה קומפילציה בלי לבדוק דבר: שם שדה שהוקלד לא
 * נכון היה עובר בשקט, והמיזוג היה מתעלם ממנו. כאן כל שדה נכתב
 * מפורשות, והמהדר בודק אותו.
 */
function normalizeAnswers(
  answers: Omit<z.infer<typeof AnswersSchema>, "website">,
): IntakeAnswers {
  return {
    ...(answers.fullName !== undefined ? { fullName: answers.fullName } : {}),
    ...(answers.phone !== undefined ? { phone: answers.phone } : {}),
    ...(answers.dealType !== undefined ? { dealType: answers.dealType } : {}),
    ...(answers.cities !== undefined ? { cities: answers.cities } : {}),
    ...(answers.propertyTypes !== undefined
      ? { propertyTypes: answers.propertyTypes }
      : {}),
    ...limit("roomsMin", answers.roomsMin),
    ...limit("roomsMax", answers.roomsMax),
    ...limit("budgetMinAgorot", answers.budgetMinAgorot),
    ...limit("budgetMaxAgorot", answers.budgetMaxAgorot),
    ...limit("areaSqmMin", answers.areaSqmMin),
    ...(answers.features !== undefined ? { features: answers.features } : {}),
    ...(answers.entryType !== undefined ? { entryType: answers.entryType } : {}),
    ...(answers.entryBy !== undefined ? { entryBy: answers.entryBy } : {}),
    ...(answers.notes !== undefined ? { notes: answers.notes } : {}),
  };
}

/** שדה מספרי אחד: חסר ⇒ לא נשלח · `null` ⇒ „אין לי מגבלה” (NaN). */
function limit<K extends string>(
  key: K,
  value: number | null | undefined,
): Record<K, number> | Record<string, never> {
  if (value === undefined) return {};
  return { [key]: value === null ? Number.NaN : value } as Record<K, number>;
}
