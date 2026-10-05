import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { z } from "zod";
import { PhoneSchema, PropertyTypeSchema, type MarketPublicEstimateDto } from "@metavchim/shared";
import { Public } from "../../common/auth.decorators";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { MarketPublicService } from "./market-public.service";

/** אותה צורה של מפתח הקליטה — `web-lead.controller`. */
const KeySchema = z.string().regex(/^[A-Za-z0-9_-]{20,64}$/u);

/** גולש מקליד "050-1234567" — מנרמלים ל-E.164 לפני הוולידציה (כמו בטופס הלידים). */
function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/gu, "");
  if (digits.startsWith("+972")) return digits;
  if (digits.startsWith("972")) return `+${digits}`;
  if (digits.startsWith("0")) return `+972${digits.slice(1)}`;
  return digits;
}

/**
 * ‎`.strict()` — שדה שלא הכרנו נדחה ולא נבלע (כמו בטופס הלידים).
 *
 * ‎**הסכמה היא תנאי לשמירת פרטים.** מי שהשאיר טלפון כדי לקבל דו"ח
 * מסכים שהמשרד יחזור אליו — וזה צריך להיות סימון שלו, לא הנחה שלנו.
 * פרטים בלי `consent: true` נדחים, והטווח עדיין מוחזר בלעדיהם.
 */
const EstimateSchema = z
  .object({
    city: z.string().trim().min(2).max(80),
    street: z.string().trim().max(120).optional(),
    houseNumber: z.string().trim().max(10).optional(),
    propertyType: PropertyTypeSchema.optional(),
    rooms: z.number().multipleOf(0.5).min(1).max(20),
    areaSqm: z.number().int().min(10).max(2000).optional(),
    name: z.string().trim().min(2).max(120).optional(),
    phone: z.string().trim().max(25).transform(normalizePhone).pipe(PhoneSchema).optional(),
    email: z.string().trim().email().max(200).optional(),
    consent: z.boolean().optional(),
    website: z.string().max(200).optional(), // honeypot — אמור להישאר ריק
  })
  .strict()
  .refine((body) => (body.name === undefined) === (body.phone === undefined), {
    message: "שם וטלפון נמסרים יחד",
    path: ["phone"],
  })
  .refine((body) => body.phone === undefined || body.consent === true, {
    message: "כדי שנחזור אליכם צריך לאשר את יצירת הקשר",
    path: ["consent"],
  });

/**
 * ‎**הטופס הציבורי „כמה שווה הדירה שלי”** (docs/14 §3, יכולת 4).
 *
 * ציבורי ומזוהה במפתח הקליטה של המשרד בלבד. מגבלה הדוקה: הנתיב
 * מחשב השוואה (קריאה) **וכותב ליד** כשיש פרטים — אותו נימוק של
 * ‎`public/leads`.
 */
@Controller("public/market")
export class MarketPublicController {
  constructor(private readonly publicMarket: MarketPublicService) {}

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Get(":key")
  async office(@Param("key", new ZodValidationPipe(KeySchema)) key: string): Promise<{ officeName: string }> {
    return this.publicMarket.office(key);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post(":key/estimate")
  @HttpCode(200)
  async estimate(
    @Param("key", new ZodValidationPipe(KeySchema)) key: string,
    @Body(new ZodValidationPipe(EstimateSchema)) body: z.infer<typeof EstimateSchema>,
  ): Promise<MarketPublicEstimateDto> {
    // בוט שמילא את השדה הנסתר — מקבל חישוב, אבל לא נוצר ליד
    const isBot = body.website !== undefined && body.website.trim() !== "";
    return this.publicMarket.estimate(
      key,
      {
        city: body.city,
        ...(body.street === undefined ? {} : { street: body.street }),
        ...(body.houseNumber === undefined ? {} : { houseNumber: body.houseNumber }),
        ...(body.propertyType === undefined ? {} : { propertyType: body.propertyType }),
        rooms: body.rooms,
        ...(body.areaSqm === undefined ? {} : { areaSqm: body.areaSqm }),
        ...(body.name !== undefined && body.phone !== undefined && !isBot
          ? { contact: { name: body.name, phone: body.phone, ...(body.email === undefined ? {} : { email: body.email }) } }
          : {}),
      },
      new Date(),
    );
  }
}
