import { Body, Controller, HttpCode, Param, Post } from "@nestjs/common";
import { z } from "zod";
import { PhoneSchema } from "@metavchim/shared";
import { Public } from "../../common/auth.decorators";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { WebLeadService } from "./web-lead.service";

/** גולש מקליד "050-1234567" — מנרמלים ל-E.164 לפני הוולידציה. */
function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/gu, "");
  if (digits.startsWith("+972")) return digits;
  if (digits.startsWith("972")) return `+${digits}`;
  if (digits.startsWith("0")) return `+972${digits.slice(1)}`;
  return digits;
}

/**
 * קליטת ליד מטופס באתר של המשרד — ציבורי, מזוהה במפתח ייעודי בלבד.
 * שדה honeypot (website): בוטים ממלאים אותו — הבקשה "מצליחה" בלי לקלוט.
 */
const WebLeadSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    phone: z.string().trim().max(25).transform(normalizePhone).pipe(PhoneSchema),
    message: z.string().trim().max(2000).optional(),
    pageUrl: z.string().trim().max(300).optional(),
    website: z.string().max(200).optional(), // honeypot — אמור להישאר ריק
  })
  .strict();

const KeySchema = z.string().regex(/^[A-Za-z0-9_-]{20,64}$/u);

@Controller("public/leads")
export class WebLeadController {
  constructor(private readonly webLeads: WebLeadService) {}

  @Public()
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
    });
    return { ok: true };
  }
}
