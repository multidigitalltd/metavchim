import { Body, Controller, Post } from "@nestjs/common";
import { z } from "zod";
import {
  BuyerMaturitySchema,
  FinancingStatusSchema,
  MoneyAgorotSchema,
  PhoneSchema,
  PropertyFieldsSchema,
  PropertyTypeSchema,
} from "@metavchim/shared";
import { RequireCapability } from "../../common/auth.decorators";
import { RequireFeature } from "../../common/feature.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { BuyersService } from "../buyers/buyers.service";
import { LeadsService } from "../leads/leads.service";
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
  marketingDescription: z.string().max(4000).optional(),
  internalNotes: z.string().max(4000).optional(),
  ownerName: z.string().max(120).optional(),
  ownerPhone: z.string().max(30).optional(),
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
    email: z.string().trim().email().max(200).optional(),
    cities: z.array(z.string().min(1).max(80)).max(10).default([]),
    neighborhoods: z.array(z.string().min(1).max(80)).max(10).optional(),
    propertyTypes: z.array(PropertyTypeSchema).max(5).optional(),
    areaSqmMin: z.number().int().min(10).max(2000).optional(),
    dealType: z.enum(["sale", "rent"], {
      errorMap: () => ({ message: "סוג עסקה לא מזוהה — יש לציין מכירה או השכרה" }),
    }),
    budgetMinAgorot: MoneyAgorotSchema.optional(),
    // תקציב הוא חובה שלישית מלבד שם וטלפון — עוגן מנוע ההתאמות
    // ועמודה שאינה ריקה בבסיס הנתונים. הודעת החוסר מתורגמת למטה.
    /*
     * **רשות.** לקוח בלי תקציב הוא מצב נורמלי — שיחה נכנסת שנרשמו
     * בה שם וטלפון היא לקוח לכל דבר. דחיית השורה כולה בגלל עמודה
     * ריקה הפכה קובץ שלם ללא ניתן לייבוא בגלל נתון שממילא מתברר
     * מאוחר יותר. במקומה — אזהרה, וראו `rowWarnings`.
     */
    budgetMaxAgorot: MoneyAgorotSchema.refine(
      (n) => n > 0,
      "תקציב חייב להיות חיובי",
    ).optional(),
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
  /**
   * שורות שנקלטו — ויש עליהן מה לומר.
   *
   * שונה מ-`failed` בכל מה שחשוב: השורה **נכנסה**. אזהרה שמוצגת
   * כשגיאה גורמת למתווך לחשוב שהייבוא נכשל ולנסות שוב, ושגיאה
   * שמוצגת כאזהרה גורמת לו להתעלם ממנה. לכן שני שדות ולא דגל.
   */
  warnings: { row: number; warning: string }[];
}

/**
 * מה שראוי לומר על שורה שנקלטה בכל זאת.
 *
 * כרגע רק התקציב. השדה אינו חובה — לקוח בלי תקציב הוא מצב נורמלי —
 * אבל בלעדיו קריטריון התקציב אינו נספר בהתאמה, וזה בדיוק מה
 * שהמתווך צריך לדעת כדי להחליט אם להשלים.
 */
function rowWarnings(row: { budgetMaxAgorot?: number }): string[] {
  if (row.budgetMaxAgorot !== undefined) return [];
  return [
    "אין תקציב — הכרטיס נקלט, אך ההתאמות האוטומטיות יהיו פחות מדויקות עד שיתווסף",
  ];
}

/**
 * שורת ליד מיובאת — פנייה שהגיעה בקובץ במקום בטופס.
 *
 * שם וטלפון בלבד חובה, כמו אצל הקונים: פנייה בלי דרך לחזור אל
 * הפונה אינה ליד. כל השאר משלים את הכרטיס אם הוא בקובץ.
 */
const ImportLeadRowSchema = z
  .object({
    name: z.string().min(2).max(120),
    phone: PhoneSchema,
    email: z.string().trim().email().max(200).optional(),
    intent: z.enum(["buy", "sell", "rent_in", "rent_out", "info"]).optional(),
    summary: z.string().max(4000).optional(),
    source: z.string().max(60).optional(),
  })
  .strict();

@RequireFeature("data_io")
@Controller("import")
export class ImportController {
  constructor(
    private readonly properties: PropertiesService,
    private readonly buyers: BuyersService,
    private readonly leads: LeadsService,
  ) {}

  @Post("properties")
  @RequireCapability("properties.create")
  async importProperties(
    @Body(new ZodValidationPipe(ImportEnvelopeSchema)) body: z.infer<typeof ImportEnvelopeSchema>,
  ): Promise<ImportResult> {
    const failed: ImportResult["failed"] = [];
    const warnings: ImportResult["warnings"] = [];
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
        const {
          marketingTitle,
          marketingDescription,
          internalNotes,
          ownerName,
          ownerPhone,
          status,
          ...fields
        } = parsed.data;
        /*
         * בעל הנכס נקשר רק כששני הפרטים בקובץ **והטלפון תקין**:
         * `findOrCreateByPhone` מזהה אדם לפי גיבוב הטלפון, וערך לא
         * מנורמל היה יוצר איש קשר כפול לבעלים קיים (ביקורת Codex).
         * טלפון פסול אינו מפיל את הנכס — הוא נקלט בלי הקישור,
         * והאזהרה אומרת למתווך בדיוק מה להשלים.
         */
        const ownerPhoneValid =
          ownerPhone !== undefined && PhoneSchema.safeParse(ownerPhone).success;
        if (ownerName !== undefined && ownerPhone !== undefined && !ownerPhoneValid) {
          warnings.push({
            row: index + 1,
            warning: "טלפון בעל הנכס אינו מספר ישראלי תקין — הנכס נקלט בלי קישור לבעלים",
          });
        }
        await this.properties.createForImport({
          fields,
          marketingTitle,
          marketingDescription,
          internalNotes,
          status,
          ...(ownerName !== undefined && ownerPhoneValid
            ? { owner: { name: ownerName, phone: ownerPhone } }
            : {}),
        });
        created += 1;
      } catch (error) {
        failed.push({
          row: index + 1,
          error: error instanceof Error ? error.message : "שגיאה לא צפויה",
        });
      }
    }

    return { created, failed, warnings };
  }

  @Post("buyers")
  @RequireCapability("buyers.edit")
  async importBuyers(
    @Body(new ZodValidationPipe(ImportEnvelopeSchema)) body: z.infer<typeof ImportEnvelopeSchema>,
  ): Promise<ImportResult> {
    const failed: ImportResult["failed"] = [];
    const warnings: ImportResult["warnings"] = [];
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
          contactEmail: row.email,
          requirements: {
            cities: row.cities,
            neighborhoods: row.neighborhoods ?? [],
            searchAreas: [],
            dealType: row.dealType,
            propertyTypes: row.propertyTypes ?? [],
            budgetMinAgorot: row.budgetMinAgorot,
            budgetMaxAgorot: row.budgetMaxAgorot,
            roomsMin: row.roomsMin,
            roomsMax: row.roomsMax,
            areaSqmMin: row.areaSqmMin,
            features: {},
          },
          financing: row.financing,
          maturity: row.maturity,
          // "מקור הגעה" מהקובץ עצמו; "ייבוא קובץ" רק כשאין עמודה כזו
          source: row.source?.trim() || "ייבוא קובץ",
          agentNotes: row.agentNotes,
        });
        created += 1;
        for (const warning of rowWarnings(row)) {
          warnings.push({ row: index + 1, warning });
        }
      } catch (error) {
        failed.push({
          row: index + 1,
          error: error instanceof Error ? error.message : "שגיאה לא צפויה",
        });
      }
    }

    return { created, failed, warnings };
  }

  /**
   * ייבוא לידים — הסוג השלישי, שעד עכשיו פשוט לא היה קיים.
   *
   * כל שורה עוברת את **אותו מסלול של פנייה חיה** (`LeadsService.create`):
   * איחוד לפי טלפון לליד פתוח קיים, נעילה נגד כפילויות, יומן ביקורת.
   * שורה שאוחדה אינה כישלון — היא מדווחת כאזהרה כדי שהמתווך יידע
   * שהלקוח כבר היה במערכת, והפנייה נוספה לציר הזמן שלו.
   */
  @Post("leads")
  @RequireCapability("leads.edit")
  async importLeads(
    @Body(new ZodValidationPipe(ImportEnvelopeSchema)) body: z.infer<typeof ImportEnvelopeSchema>,
  ): Promise<ImportResult> {
    const failed: ImportResult["failed"] = [];
    const warnings: ImportResult["warnings"] = [];
    let created = 0;

    for (const [index, rawRow] of body.rows.entries()) {
      const parsed = ImportLeadRowSchema.safeParse(rawRow);
      if (!parsed.success) {
        failed.push({ row: index + 1, error: describeRowIssues(parsed.error) });
        continue;
      }
      try {
        const row = parsed.data;
        const result = await this.leads.create({
          contactName: row.name,
          contactPhone: row.phone,
          ...(row.email !== undefined ? { contactEmail: row.email } : {}),
          source: row.source?.trim() || "ייבוא קובץ",
          intent: row.intent ?? "info",
          ...(row.summary !== undefined ? { summary: row.summary } : {}),
        });
        created += 1;
        if (result.merged) {
          warnings.push({
            row: index + 1,
            warning: "הלקוח כבר קיים — הפנייה צורפה לליד הפתוח שלו במקום לפתוח כרטיס חדש",
          });
        }
      } catch (error) {
        failed.push({
          row: index + 1,
          error: error instanceof Error ? error.message : "שגיאה לא צפויה",
        });
      }
    }

    return { created, failed, warnings };
  }
}
