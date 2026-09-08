import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { IdSchema, PAGE_LIMIT_MAX } from "@metavchim/shared";
import { Public, RequireCapability } from "../../common/auth.decorators";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import {
  PropertyPitchService,
  type PitchBuyerRow,
  type PitchResult,
} from "./property-pitch.service";

const BuyersQuerySchema = z
  .object({
    q: z.string().trim().max(80).optional(),
    /*
     * ‎**אותה תקרה כמו `/properties`, ולא תקרה משלה.**
     *
     * ‏החלון אחד ושתי הרשימות נטענות באותו קוד; שתי תקרות שונות
     * ‏פירושן שהמסך צריך לזכור לאיזו רשימה מותר לבקש כמה — וזו
     * ‏בדיוק השכחה שהפילה את צד הנכסים.
     */
    limit: z.coerce.number().int().min(1).max(PAGE_LIMIT_MAX).default(PAGE_LIMIT_MAX),
  })
  .strict();

/**
 * ‎**שני הצדדים, קריאה אחת.** מכרטיס הנכס נשלח נכס אחד והרבה
 * ‏קונים; מכרטיס הקונה — קונה אחד והרבה נכסים. שתי רשימות, ולכן
 * ‏אין כאן שני נתיבים שצריך לזכור לתקן פעמיים.
 */
const SendSchema = z
  .object({
    propertyIds: z.array(IdSchema).min(1).max(20),
    buyerIds: z.array(IdSchema).min(1).max(500),
  })
  .strict();

const TokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);

@Controller()
export class PropertyPitchController {
  constructor(private readonly pitch: PropertyPitchService) {}

  /**
   * ‏רשימת הקונים לחלון הבחירה.
   *
   * ‏השער הוא `offers.send` — היכולת לשלוח. „מי מותר לי לראות”
   * ‏נבדק בשירות עצמו, כי זו שאלה על הקונים ולא על הנתיב.
   */
  @Get("property-pitch/buyers")
  @RequireCapability("offers.send")
  async buyers(
    @Query(new ZodValidationPipe(BuyersQuerySchema)) query: z.infer<typeof BuyersQuerySchema>,
  ): Promise<PitchBuyerRow[]> {
    return this.pitch.buyers(query);
  }

  @Post("property-pitch/send")
  @RequireCapability("offers.send")
  @HttpCode(200)
  async send(
    @Body(new ZodValidationPipe(SendSchema)) body: z.infer<typeof SendSchema>,
  ): Promise<PitchResult> {
    return this.pitch.send(body);
  }

  /**
   * ‎**הסרה מדיוור — לפי הכרטיס, לא לפי ההצעה** (§30א).
   *
   * ‏מסלול ההסרה הקיים נשען על טוקן של `Offer`, ולשליחה ידנית אין
   * ‎`Offer`. הטוקן כאן שייך לכרטיס עצמו, ולכן קישור שנשלח אתמול
   * ‏ממשיך לעבוד גם אחרי עשר שליחות נוספות.
   */
  @Public()
  @Post("public/contacts/:token/email-optout")
  @HttpCode(200)
  async optOut(
    @Param("token", new ZodValidationPipe(TokenSchema)) token: string,
  ): Promise<{ ok: true }> {
    await this.pitch.publicEmailOptOut(token);
    return { ok: true };
  }
}
