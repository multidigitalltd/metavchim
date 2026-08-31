import { Body, Controller, HttpCode, Param, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { z } from "zod";
import { IdSchema, LeadIntentSchema, PhoneInputSchema } from "@metavchim/shared";
import { Public } from "../../common/auth.decorators";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { WebLeadService } from "./web-lead.service";

/**
 * קליטת ליד מטופס באתר של המשרד — ציבורי, מזוהה במפתח ייעודי בלבד.
 * שדה honeypot (website): בוטים ממלאים אותו — הבקשה "מצליחה" בלי לקלוט.
 */
/**
 * גוף הפנייה הציבורית.
 *
 * ‎`.strict()`‎ בכוונה: שדה שלא הכרנו נדחה ולא נבלע. מי שמחבר דרך
 * Make או n8n מגלה את הטעות בבנייה, לא שבועיים אחר כך כשמישהו שם
 * לב שהאימייל לא נשמר.
 *
 * מה שנוסף כאן — אימייל, עניין ונכס — הוא מה שמפריד בין ליד מלא
 * לליד חלקי. מודעת פייסבוק של נכס מסוימת יודעת את שלושתם, וקודם
 * כולם נשמטו בדרך.
 */
const WebLeadSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    phone: PhoneInputSchema,
    message: z.string().trim().max(2000).optional(),
    pageUrl: z.string().trim().max(300).optional(),
    /** נשמר על הכרטיס ומאפשר זיהוי של פניות עתידיות מאותה כתובת. */
    email: z.string().trim().email().max(200).optional(),
    /** מה הלקוח רוצה. חסר ⇒ "לא ידוע", כמו קודם. */
    intent: LeadIntentSchema.optional(),
    /** הנכס שהמודעה פרסמה. מאומת מול המשרד לפני שנשמר. */
    propertyId: IdSchema.optional(),
    website: z.string().max(200).optional(), // honeypot — אמור להישאר ריק
  })
  .strict();

const KeySchema = z.string().regex(/^[A-Za-z0-9_-]{20,64}$/u);

@Controller("public/leads")
export class WebLeadController {
  constructor(private readonly webLeads: WebLeadService) {}

  /*
   * מגבלה הדוקה משלה: הנתיב ציבורי ו*כותב* שורות (איש קשר + ליד).
   * המגבלה הגלובלית (300/דקה) נועדה לקריאות, ומאפשרת הצפת המאגר
   * בלידים מזויפים מכתובת אחת. טופס אמיתי נשלח פעם-פעמיים.
   */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post(":key")
  @HttpCode(200)
  async ingest(
    @Param("key", new ZodValidationPipe(KeySchema)) key: string,
    @Body(new ZodValidationPipe(WebLeadSchema)) body: z.infer<typeof WebLeadSchema>,
  ): Promise<{ ok: true }> {
    if (body.website?.trim()) return { ok: true }; // בוט — נבלע בשקט
    await this.webLeads.ingest(key, {
      name: body.name,
      phone: body.phone,
      message: body.message,
      pageUrl: body.pageUrl,
      email: body.email,
      intent: body.intent,
      propertyId: body.propertyId,
    });
    return { ok: true };
  }
}
