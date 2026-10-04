import { BadRequestException, Injectable, PipeTransform } from "@nestjs/common";
import { IdSchema } from "@metavchim/shared";
import { z, type ZodSchema } from "zod";

/**
 * כל Body/Query עובר סכמת Zod מפורשת — שדות לא מוצהרים נדחים (strict),
 * כך ש-Mass Assignment חסום בשכבת הקלט (docs/04 §5).
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: "קלט לא תקין",
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }
    return result.data;
  }
}

/** ‏מזהה ישות בנתיב (`:id`) — ULID. הצינור חסר מצב, ולכן מופע אחד לכולם. */
export const IdParam = new ZodValidationPipe(IdSchema);

/**
 * ‎**טוקן ציבורי** — קישור שנשלח ללקוח (הצעה, דף נחיתה, טופס קליטה, בית
 * ‏פתוח, השוואה, מודעה, אימות). כולם 32 בתים אקראיים ב-base64url, כלומר
 * ‏43 תווים בדיוק: מה שאינו בצורה הזו אינו טוקן שלנו, ואין טעם לחפש אותו.
 */
export const PublicTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
export const PublicTokenParam = new ZodValidationPipe(PublicTokenSchema);
