import { Body, Controller, Delete, Get, HttpCode, Param, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { z } from "zod";
import { IdSchema, INTAKE_FEATURES, INTAKE_NOTES_MAX } from "@metavchim/shared";
import { Public, RequireCapability } from "../../common/auth.decorators";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import {
  IntakeService,
  type IntakePublicView,
  type IntakeRequestDto,
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
    dealType: z.enum(["sale", "rent"]).optional(),
    cities: z.array(z.string().trim().max(80)).max(10).optional(),
    propertyTypes: z.array(z.string().max(30)).max(12).optional(),
    roomsMin: z.number().min(0).max(30).nullish(),
    roomsMax: z.number().min(0).max(30).nullish(),
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

@Controller()
export class IntakeController {
  constructor(private readonly intake: IntakeService) {}

  /* ---------- הצד הפנימי ---------- */

  @Get("leads/:id/intake")
  @RequireCapability("leads.view_own")
  listForLead(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<IntakeRequestDto[]> {
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

  @Get("buyers/:id/intake")
  @RequireCapability("buyers.view_own")
  listForBuyer(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<IntakeRequestDto[]> {
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
}

/**
 * `null` מהרשת → `NaN` פנימי.
 *
 * המיזוג מבדיל בין „לא נשלח” (השדה נשאר) לבין „אין לי מגבלה”
 * (השדה נמחק), ו-`null` הוא הביטוי של השני ברשת. הוא מתורגם כאן
 * ולא בסכימה כדי ש-`applyIntakeAnswers` יישאר עם טיפוס אחד לכל
 * מספר.
 */
function normalizeAnswers(
  answers: Omit<z.infer<typeof AnswersSchema>, "website">,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...answers };
  for (const key of [
    "roomsMin",
    "roomsMax",
    "budgetMinAgorot",
    "budgetMaxAgorot",
    "areaSqmMin",
  ]) {
    if (out[key] === null) out[key] = Number.NaN;
  }
  return out;
}
