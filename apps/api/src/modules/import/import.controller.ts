import { Body, Controller, Post } from "@nestjs/common";
import { z } from "zod";
import { PropertyFieldsSchema } from "@metavchim/shared";
import { RequireCapability } from "../../common/auth.decorators";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { PropertiesService } from "../properties/properties.service";

/**
 * ייבוא נכסים בכמות (docs/08 §6 — Onboarding): הפרונט מפרק CSV/אקסל
 * ל-JSON וממפה עמודות; כאן כל שורה עוברת ולידציה בנפרד בתוך הלולאה, כך
 * ששורה פגומה אחת לא מפילה את כל האצווה — מוחזר דיווח שגיאה פר-שורה.
 * ה-Pipe מאמת רק את מעטפת האצווה (מערך בגודל סביר); תוכן השורות נבדק
 * פר-שורה מול ImportRowSchema.
 */
const ImportRowSchema = PropertyFieldsSchema.extend({
  marketingTitle: z.string().max(160).optional(),
}).strict();

const ImportEnvelopeSchema = z
  .object({
    rows: z.array(z.record(z.string(), z.unknown())).min(1).max(500),
  })
  .strict();

export interface ImportResult {
  created: number;
  failed: { row: number; error: string }[];
}

@Controller("import")
export class ImportController {
  constructor(private readonly properties: PropertiesService) {}

  @Post("properties")
  @RequireCapability("properties.create")
  async importProperties(
    @Body(new ZodValidationPipe(ImportEnvelopeSchema)) body: z.infer<typeof ImportEnvelopeSchema>,
  ): Promise<ImportResult> {
    const failed: ImportResult["failed"] = [];
    let created = 0;

    for (const [index, rawRow] of body.rows.entries()) {
      const parsed = ImportRowSchema.safeParse(rawRow);
      if (!parsed.success) {
        failed.push({
          row: index + 1,
          error: parsed.error.issues.map((i) => i.message).join("; ") || "שורה לא תקינה",
        });
        continue;
      }
      try {
        const { marketingTitle, ...fields } = parsed.data;
        await this.properties.createForImport({ fields, marketingTitle });
        created += 1;
      } catch (error) {
        failed.push({
          row: index + 1,
          error: error instanceof Error ? error.message : "שגיאה לא צפויה",
        });
      }
    }

    return { created, failed };
  }
}
