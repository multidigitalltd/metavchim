import { Body, Controller, Post } from "@nestjs/common";
import { z } from "zod";
import {
  BuyerMaturitySchema,
  FinancingStatusSchema,
  MoneyAgorotSchema,
  PhoneSchema,
  PropertyFieldsSchema,
} from "@metavchim/shared";
import { RequireCapability } from "../../common/auth.decorators";
import { RequireFeature } from "../../common/feature.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { BuyersService } from "../buyers/buyers.service";
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
  /** שימור סטטוס בייבוא-חזרה של קובץ מיוצא (Round-trip). */
  status: z.enum(["draft", "active", "on_hold", "sold", "rented", "archived"]).optional(),
}).strict();

const ImportEnvelopeSchema = z
  .object({
    rows: z.array(z.record(z.string(), z.unknown())).min(1).max(500),
  })
  .strict();

/**
 * שורת קונה מיובאת — שטוחה (כמו שמגיע מ-CSV); כאן היא מתורגמת למבנה
 * BuyerRequirements המקונן. שם, טלפון, עיר אחת לפחות ותקציב — חובה.
 */
/*
 * **חובה: שם וטלפון. כל השאר — אם יש, יש.**
 *
 * הסכימה דרשה קודם גם עיר וגם תקציב, וגיליון אמיתי של משרד — "שם,
 * טלפון, תקציב, סוג עסקה, סטטוס, הערות, מקור" — נדחה כולו: אפס שורות
 * נכנסו, בלי שום רמז שהבעיה היא עמודת עיר שאינה קיימת בכלל בקובץ.
 * ייבוא הוא קליטת מה שיש, לא טופס קבלה; מה שחסר מושלם בכרטיס.
 *
 * שם וטלפון כן נדרשים: כרטיס קונה בלי דרך ליצור קשר אינו כרטיס.
 */
const ImportBuyerRowSchema = z
  .object({
    name: z.string().min(2).max(120),
    phone: PhoneSchema,
    cities: z.array(z.string().min(1).max(80)).max(10).default([]),
    dealType: z.enum(["sale", "rent"], {
      errorMap: () => ({ message: "סוג עסקה לא מזוהה — יש לציין מכירה או השכרה" }),
    }),
    budgetMinAgorot: MoneyAgorotSchema.optional(),
    // תקציב הוא חובה שלישית מלבד שם וטלפון — עוגן מנוע ההתאמות
    // ועמודה שאינה ריקה בבסיס הנתונים. הודעת החוסר מתורגמת למטה.
    budgetMaxAgorot: MoneyAgorotSchema.refine((n) => n > 0, "תקציב חייב להיות חיובי"),
    roomsMin: z.number().multipleOf(0.5).min(1).max(20).optional(),
    roomsMax: z.number().multipleOf(0.5).min(1).max(20).optional(),
    financing: FinancingStatusSchema.optional(),
    maturity: BuyerMaturitySchema.optional(),
    source: z.string().max(60).optional(),
    agentNotes: z.string().max(4000).optional(),
  })
  .strict();

/**
 * שגיאת שורה בעברית שאומרת **מה** חסר.
 *
 * "Required" של zod על שדה חסר היה מוצג כמו שהוא, והמתווך שכל
 * הקובץ שלו נדחה קיבל עמודת שגיאות באנגלית בלי שם שדה. שם השדה
 * ומילת החוסר הם כל ההבדל בין "לתקן את הקובץ" ל"לוותר על הייבוא".
 */
const FIELD_LABELS: Record<string, string> = {
  name: "שם",
  phone: "טלפון",
  budgetMaxAgorot: "תקציב",
  budgetMinAgorot: "תקציב מינימלי",
  dealType: "סוג עסקה",
  cities: "עיר",
  roomsMin: "חדרים",
  roomsMax: "חדרים",
};

function describeRowIssues(error: z.ZodError): string {
  const parts = error.issues.map((issue) => {
    const field = FIELD_LABELS[String(issue.path[0] ?? "")] ?? String(issue.path[0] ?? "");
    if (issue.code === "invalid_type" && issue.received === "undefined") {
      return field ? `חסר ${field}` : "שדה חסר";
    }
    return field ? `${field}: ${issue.message}` : issue.message;
  });
  return [...new Set(parts)].join("; ") || "שורה לא תקינה";
}

export interface ImportResult {
  created: number;
  failed: { row: number; error: string }[];
}

@RequireFeature("data_io")
@Controller("import")
export class ImportController {
  constructor(
    private readonly properties: PropertiesService,
    private readonly buyers: BuyersService,
  ) {}

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
        const { marketingTitle, status, ...fields } = parsed.data;
        await this.properties.createForImport({ fields, marketingTitle, status });
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

  @Post("buyers")
  @RequireCapability("buyers.edit")
  async importBuyers(
    @Body(new ZodValidationPipe(ImportEnvelopeSchema)) body: z.infer<typeof ImportEnvelopeSchema>,
  ): Promise<ImportResult> {
    const failed: ImportResult["failed"] = [];
    let created = 0;

    for (const [index, rawRow] of body.rows.entries()) {
      const parsed = ImportBuyerRowSchema.safeParse(rawRow);
      if (!parsed.success) {
        failed.push({ row: index + 1, error: describeRowIssues(parsed.error) });
        continue;
      }
      try {
        const row = parsed.data;
        await this.buyers.createForImport({
          contactName: row.name,
          contactPhone: row.phone,
          requirements: {
            cities: row.cities,
            neighborhoods: [],
            dealType: row.dealType,
            propertyTypes: [],
            budgetMinAgorot: row.budgetMinAgorot,
            budgetMaxAgorot: row.budgetMaxAgorot,
            roomsMin: row.roomsMin,
            roomsMax: row.roomsMax,
            features: {},
          },
          financing: row.financing,
          maturity: row.maturity,
          // "מקור הגעה" מהקובץ עצמו; "ייבוא קובץ" רק כשאין עמודה כזו
          source: row.source?.trim() || "ייבוא קובץ",
          agentNotes: row.agentNotes,
        });
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
