import { Body, Controller, Post } from "@nestjs/common";
import { z } from "zod";
import { IMPORT_ROW_LIMIT, PhoneSchema, PropertyFieldsSchema } from "@metavchim/shared";
import { RequireCapability } from "../../common/auth.decorators";
import { RequireFeature } from "../../common/feature.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { PropertiesService } from "../properties/properties.service";
import { ImportWriteService, type ImportResult } from "./import-write.service";

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

/*
 * ‎**התקרה נקראת מהקטלוג המשותף, ולא נכתבת כאן.**
 *
 * ‏מסלול הוואטסאפ חותך באותו מספר, ושני מספרים שכתובים בשני
 * ‏קבצים מסכימים ביום שנכתבו — בשינוי הבא אחד מהם נשאר מאחור
 * ‏בשקט, וההפרש מתגלה כשמחפשים לקוח שלא נכנס.
 */
const ImportEnvelopeSchema = z
  .object({
    rows: z.array(z.record(z.string(), z.unknown())).min(1).max(IMPORT_ROW_LIMIT),
  })
  .strict();

@RequireFeature("data_io")
@Controller("import")
export class ImportController {
  constructor(
    private readonly properties: PropertiesService,
    private readonly write: ImportWriteService,
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

  /**
   * ‎**ייבוא נכסים לגיוס — ולא נכסים.**
   *
   * ## ‏ההבחנה שכל התכונה נשענת עליה
   *
   * ‏שורה שנקלטת כאן היא מודעה שהמשרד **רודף אחריה** ואינו מייצג.
   * ‏היא נכתבת ל-`recruitment_targets` ולעולם לא ל-`properties`, ולכן
   * ‏היא אינה מגיעה להתאמות, לרשת שיתופי הפעולה, להצעות או לדפי
   * ‏הנחיתה. הצעת נכס שהמשרד אינו מייצג היא הבטחה בלי כיסוי מול
   * ‏הקונה, וחשיפה מול בעלים שלא חתם.
   *
   * ‏הלולאה עצמה יושבת ב-`ImportWriteService`: מאז שאפשר לשלוח
   * ‏קובץ בוואטסאפ יש לה קורא שני, והסוכן אינו עובר בבקרים. שער
   * ‏מבני (`recruitment-separation.test.ts`) אוכף שם שהמסלול קורא
   * ‏ל-`recruitment` ואינו נוגע ב-`properties` בכלל.
   */
  @Post("recruitment")
  @RequireCapability("properties.create")
  importRecruitment(
    @Body(new ZodValidationPipe(ImportEnvelopeSchema)) body: z.infer<typeof ImportEnvelopeSchema>,
  ): Promise<ImportResult> {
    return this.write.recruitmentRows(body.rows);
  }

  @Post("buyers")
  @RequireCapability("buyers.edit")
  importBuyers(
    @Body(new ZodValidationPipe(ImportEnvelopeSchema)) body: z.infer<typeof ImportEnvelopeSchema>,
  ): Promise<ImportResult> {
    return this.write.buyerRows(body.rows);
  }

  /**
   * ייבוא לידים — הסוג השלישי, שעד עכשיו פשוט לא היה קיים.
   *
   * כל שורה עוברת את **אותו מסלול של פנייה חיה** (`LeadsService.create`):
   * איחוד לפי טלפון לליד פתוח קיים, נעילה נגד כפילויות, יומן ביקורת.
   */
  @Post("leads")
  @RequireCapability("leads.edit")
  importLeads(
    @Body(new ZodValidationPipe(ImportEnvelopeSchema)) body: z.infer<typeof ImportEnvelopeSchema>,
  ): Promise<ImportResult> {
    return this.write.leadRows(body.rows);
  }
}
