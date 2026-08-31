import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { z } from "zod";
import {
  IdSchema,
  MAX_NOTICE_PERIOD_DAYS,
  OCCUPANCY_STATES,
  PAGE_LIMIT_MAX,
  PhoneInputSchema,
  PropertyFieldsSchema,
  PropertyStatusSchema,
  type Page,
} from "@metavchim/shared";
import { RequireCapability } from "../../common/auth.decorators";
import { RequireFeature } from "../../common/feature.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { MatchingService, type MatchDto } from "../matching/matching.service";
import { FeatureCatalogueService } from "./feature-catalogue.service";
import {
  PropertyActivityService,
  type OwnerActivityReportDto,
} from "./property-activity.service";
import { PropertiesService } from "./properties.service";
import type { PropertyDto } from "./property.mapper";

const CreatePropertySchema = PropertyFieldsSchema.extend({
  marketingTitle: z.string().max(160).optional(),
  marketingDescription: z.string().max(4000).optional(),
  internalNotes: z.string().max(4000).optional(),
  // בעל הנכס (המוכר) — contact לפי טלפון; מזין את התיק המאוחד (docs/03)
  ownerName: z.string().min(2).max(120).optional(),
  ownerPhone: PhoneInputSchema.optional(),
  /*
   * מי גר בנכס כשזה אינו הבעלים — דירה שמושכרת בזמן שהיא מוצעת.
   * הבעלים מחליט על המכירה, אבל הדלת נפתחת על ידי מי שגר שם.
   */
  occupantName: z.string().min(2).max(120).optional(),
  occupantPhone: PhoneInputSchema.optional(),
}).strict();

const UpdatePropertySchema = CreatePropertySchema.partial()
  .extend({
    status: PropertyStatusSchema.optional(),
    /*
     * „הדירה התפנתה” — מחיקה מפורשת ולא שדה ריק.
     *
     * ‎`occupantName: ""` היה נופל על ה-`min(2)` של הסכימה, ושדה
     * שלא נשלח פירושו „בלי שינוי” בכל שאר המסך. בלי הדגל הזה אין
     * דרך להסיר דייר אחרי שהוא עזב — והמספר שלו היה נשאר בכרטיס.
     */
    occupantCleared: z.literal(true).optional(),
    /*
     * ‎**מי גר בנכס — בעדכון בלבד, ובמכוון.**
     *
     * הוספתי אותם קודם ל-`CreatePropertySchema`, ומסלול היצירה
     * **זרק אותם בשקט**: `create()` אינו מקבל אותם, ו-TypeScript
     * אינו מסמן מפתח עודף שנכנס דרך spread מותנה. כלומר ה-API היה
     * מקבל 200 ומאבד את הערך. שדה שנשלח ונעלם גרוע משדה שנדחה,
     * ולכן `.strict()` של היצירה דוחה אותם עכשיו במפורש.
     *
     * ‎`null` מפורש מותר: „טרם נשאל” הוא ערך, ומי שסימן בטעות צריך
     * דרך לחזור אליו. שדה שלא נשלח פירושו „בלי שינוי”.
     */
    occupancy: z.enum(OCCUPANCY_STATES).nullable().optional(),
    /** תום חוזה השכירות — תאריך בלבד, `YYYY-MM-DD`. */
    leaseEndsAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u)
      .nullable()
      .optional(),
    noticePeriodDays: z
      .number()
      .int()
      .min(0)
      .max(MAX_NOTICE_PERIOD_DAYS)
      .nullable()
      .optional(),
  })
  .strict();

const ListQuerySchema = z
  .object({
    status: PropertyStatusSchema.optional(),
    city: z.string().max(80).optional(),
    /** חיפוש חופשי — כתובת, תיאור שיווקי, סוג נכס והערות פנימיות */
    q: z.string().max(120).optional(),
    /** בשקלים; ההמרה לאגורות בשרת */
    minPrice: z.coerce.number().min(0).optional(),
    maxPrice: z.coerce.number().min(0).optional(),
    minRooms: z.coerce.number().min(0).max(30).optional(),
    maxRooms: z.coerce.number().min(0).max(30).optional(),
    cursor: z.string().max(30).optional(),
    /* התקרה מהקבוע המשותף — כדי שמסך לא יבקש יותר ממה שהשער מקבל */
    limit: z.coerce.number().int().min(1).max(PAGE_LIMIT_MAX).default(50),
  })
  .strict();

/**
 * טווח הדוח לבעל הנכס. שני הקצוות רשות — בלעדיהם הדוח הוא כל
 * ההיסטוריה של הנכס, וזו ברירת המחדל הנכונה למי שמבקש "מה עשיתם
 * עד היום".
 */
const ActivityQuerySchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .strict();

type ActivityQuery = z.infer<typeof ActivityQuerySchema>;

/**
 * תקרה של 500 — מכסה בחירה של „כל מה שמוצג” בכל מסך סביר, ומונעת
 * בקשה שמנסה למחוק מאגר שלם בקריאה אחת.
 */
const BulkDeleteSchema = z
  .object({
    ids: z.array(IdSchema).min(1).max(500),
    /**
     * ‎**מפורש ולא ברירת מחדל שקטה.** ארכיון ומחיקה לצמיתות הן שתי
     * פעולות שונות לחלוטין, ואחת מהן אינה הפיכה.
     */
    permanent: z.boolean().default(false),
  })
  .strict();

/** אותה תקרה כמו המחיקה עצמה — התצוגה המקדימה עונה על אותה בקשה. */
const BulkPreviewSchema = z
  .object({ ids: z.array(IdSchema).min(1).max(500) })
  .strict();

@Controller("properties")
export class PropertiesController {
  constructor(
    private readonly properties: PropertiesService,
    private readonly matching: MatchingService,
    private readonly catalogue: FeatureCatalogueService,
    private readonly activityReport: PropertyActivityService,
  ) {}

  /**
   * המרת ליד לנכס: "יש לי דירה למכור" הוא בעל נכס, לא קונה. הנתיב
   * יושב כאן ולא במודול הלידים — LeadsModule כבר מיובא ע"י
   * PropertiesModule, והכיוון ההפוך היה מעגל מודולים שמפיל את השרת
   * בעלייה (ביקורת Codex, P0).
   *
   * properties.create ולא properties.edit: הנתיב יוצר נכס, ועוזר
   * שמורשה לערוך אך לא ליצור אינו אמור לעקוף את זה דרך המרה
   * (ביקורת Codex).
   */
  @Post("from-lead/:leadId")
  @RequireCapability("properties.create")
  async convertFromLead(
    @Param("leadId", new ZodValidationPipe(IdSchema)) leadId: string,
    @Body(new ZodValidationPipe(PropertyFieldsSchema))
    body: z.infer<typeof PropertyFieldsSchema>,
  ): Promise<{ id: string }> {
    const property = await this.properties.convertFromLead(leadId, body);
    return { id: property.id };
  }

  @Post()
  @RequireCapability("properties.create")
  async create(
    @Body(new ZodValidationPipe(CreatePropertySchema))
    body: z.infer<typeof CreatePropertySchema>,
  ): Promise<PropertyDto> {
    const {
      marketingTitle,
      marketingDescription,
      internalNotes,
      ownerName,
      ownerPhone,
      occupantName,
      occupantPhone,
      ...fields
    } = body;
    return this.properties.create({
      fields,
      marketingTitle,
      marketingDescription,
      internalNotes,
      ...(ownerName !== undefined && ownerPhone !== undefined
        ? { owner: { name: ownerName, phone: ownerPhone } }
        : {}),
      ...(occupantName !== undefined && occupantPhone !== undefined
        ? { occupant: { name: occupantName, phone: occupantPhone } }
        : {}),
    });
  }

  @Get()
  @RequireCapability("properties.view")
  async list(
    @Query(new ZodValidationPipe(ListQuerySchema))
    query: z.infer<typeof ListQuerySchema>,
  ): Promise<Page<PropertyDto>> {
    return this.properties.list(query);
  }

  /**
   * קטלוג המאפיינים המותאמים של המשרד.
   *
   * **מוכרח לשבת לפני `:id`** — נתיב סטטי אחרי פרמטרי הוא נתיב
   * שנבלע: `feature-catalogue` היה נקרא כמזהה נכס ונדחה בוולידציה.
   *
   * הוא מה שהופך את "כל סוכן מוסיף בעצמו" לשמיש: הטופס מציע קודם
   * את מה שכבר בשימוש במשרד, ולכן השני שנתקל במיזוג בוחר את התווית
   * של הראשון במקום להמציא אותה. בלי זה, החופש להוסיף היה מייצר
   * בדיוק את פיצול המפתחות שהנרמול נלחם בו.
   */
  @Get("feature-catalogue")
  @RequireCapability("properties.view")
  async featureCatalogue(): Promise<
    { key: string; label: string; count: number }[]
  > {
    return this.catalogue.list();
  }

  @Get(":id")
  @RequireCapability("properties.view")
  async get(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<PropertyDto> {
    return this.properties.getById(id);
  }

  @Patch(":id")
  @RequireCapability("properties.edit")
  async update(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(UpdatePropertySchema))
    body: z.infer<typeof UpdatePropertySchema>,
  ): Promise<PropertyDto> {
    const { ownerName, ownerPhone, occupantName, occupantPhone, ...rest } = body;
    return this.properties.update(id, {
      ...rest,
      ...(ownerName !== undefined && ownerPhone !== undefined
        ? { owner: { name: ownerName, phone: ownerPhone } }
        : {}),
      ...(occupantName !== undefined && occupantPhone !== undefined
        ? { occupant: { name: occupantName, phone: occupantPhone } }
        : {}),
    });
  }

  /** עדכון שיווק לבעל הנכס — נוסח מוכן + קישור wa.me; מתועד ב-Hub. */
  @Post(":id/owner-update")
  @RequireCapability("properties.edit")
  @RequireFeature("whatsapp")
  @HttpCode(200)
  async ownerUpdate(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<{ waUrl: string; message: string }> {
    return this.properties.prepareOwnerUpdate(id);
  }

  /**
   * ‎**מה תגרור המחיקה המרוכזת — לפני האישור.**
   *
   * אותו גילוי כמו במחיקה הבודדת, בצורתו הקבוצתית: כמה כרטיסי אדם
   * יירדו עם הנכסים שנבחרו. המסך חוסם מחיקה לצמיתות כשהבדיקה
   * נכשלת — „לא ידוע” אינו „לא יימחק”.
   */
  @Post("bulk-deletion-preview")
  @RequireCapability("properties.delete")
  @HttpCode(200)
  async bulkDeletionPreview(
    @Body(new ZodValidationPipe(BulkPreviewSchema))
    body: z.infer<typeof BulkPreviewSchema>,
  ): Promise<{ contacts: number }> {
    return this.properties.bulkDeletionPreview(body.ids);
  }

  @Post("bulk-delete")
  @RequireCapability("properties.delete")
  @HttpCode(200)
  async bulkDelete(
    @Body(new ZodValidationPipe(BulkDeleteSchema))
    body: z.infer<typeof BulkDeleteSchema>,
  ): Promise<{ removed: number; skipped: number }> {
    return this.properties.removeMany(body.ids, body.permanent);
  }

  @Delete(":id")
  @RequireCapability("properties.delete")
  @HttpCode(204)
  async remove(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<void> {
    await this.properties.softDelete(id);
  }

  /**
   * מחיקה לצמיתות — רק מנכס שכבר בארכיון.
   *
   * הארכיון הוא ברירת המחדל כי נכס שנמכר הוא היסטוריה עסקית; זה
   * הנתיב לנכס שנקלט בטעות או לכפילות, ואי אפשר לחזור ממנו.
   */
  /**
   * מה תמחק המחיקה לצמיתות — לקריאה לפני האישור.
   *
   * אותה יכולת כמו המחיקה עצמה: „כמה כרטיסים יירדו עם הנכס” הוא מידע
   * על אנשים, ואינו נתון תפעולי שכל מי שרואה נכס זכאי לו.
   */
  @Get(":id/permanent/preview")
  @RequireCapability("properties.delete")
  async purgePreview(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<{ contacts: number }> {
    return this.properties.purgePreview(id);
  }

  @Delete(":id/permanent")
  @RequireCapability("properties.delete")
  @HttpCode(204)
  async purge(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<void> {
    await this.properties.purge(id);
  }

  /** "מצא לי קונים" (אפיון §7) — ההתאמות כבר מחושבות; כאן רק קוראים אותן. */
  @Get(":id/matches")
  @RequireCapability("matches.view")
  async matchesFor(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<MatchDto[]> {
    return this.matching.listForProperty(id);
  }

  /**
   * דוח הפעילות שהמתווך מוסר לבעל הנכס.
   *
   * ‎`properties.view` ולא `data.export`: הדוח אינו נתוני המשרד
   * אלא מה שנעשה בנכס אחד, והוא נטול פרטי אדם. מי שרואה את הנכס
   * רואה גם מה נעשה בו.
   */
  @Get(":id/activity")
  @RequireCapability("properties.view")
  async activity(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Query(new ZodValidationPipe(ActivityQuerySchema)) query: ActivityQuery,
  ): Promise<OwnerActivityReportDto> {
    return this.activityReport.report(id, query);
  }

  /**
   * אותו דוח כקובץ.
   *
   * ‎`Content-Disposition` קבוע ואינו נבנה מכתובת הנכס: כותרת
   * תגובה שמורכבת מקלט חופשי היא הזרקת כותרת, והשם הידידותי נקבע
   * ממילא בצד הלקוח בזמן השמירה.
   */
  @Get(":id/activity.csv")
  @RequireCapability("properties.view")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="property-activity.csv"')
  async activityCsv(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Query(new ZodValidationPipe(ActivityQuerySchema)) query: ActivityQuery,
  ): Promise<string> {
    return this.activityReport.csv(id, query);
  }
}
