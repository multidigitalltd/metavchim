import { Body, Controller, Post } from "@nestjs/common";
import { z } from "zod";
import { PropertyFieldsSchema } from "@metavchim/shared";
import { RequireCapability } from "../../common/auth.decorators";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { PropertiesService } from "../properties/properties.service";

/**
 * ייבוא נכסים בכמות (docs/08 §6 — Onboarding): הפרונט מפרק CSV/אקסל
 * ל-JSON וממפה עמודות; כאן כל שורה עוברת ולידציה ונוצרת. שורה שנכשלת
 * לא מפילה את השאר — מוחזר דיווח שגיאה פר-שורה.
 */
const ImportRowSchema = PropertyFieldsSchema.extend({
  marketingTitle: z.string().max(160).optional(),
}).strict();

const ImportSchema = z
  .object({
    rows: z.array(ImportRowSchema).min(1).max(500),
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
    @Body(new ZodValidationPipe(ImportSchema)) body: z.infer<typeof ImportSchema>,
  ): Promise<ImportResult> {
    const failed: ImportResult["failed"] = [];
    let created = 0;

    for (const [index, row] of body.rows.entries()) {
      try {
        const { marketingTitle, ...fields } = row;
        await this.properties.create({ fields, marketingTitle });
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
