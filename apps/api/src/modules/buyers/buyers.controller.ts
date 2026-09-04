import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { z } from "zod";
import {
  BuyerMaturitySchema,
  BuyerRequirementsSchema,
  FinancingStatusSchema,
  IdSchema,
  PhoneInputSchema,
  type Page,
} from "@metavchim/shared";
import { RequireCapability } from "../../common/auth.decorators";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { MatchingService, type MatchDto } from "../matching/matching.service";
import { FeatureCatalogueService } from "../properties/feature-catalogue.service";
import { BuyersService, type BuyerDto } from "./buyers.service";

const CreateBuyerSchema = z
  .object({
    contactName: z.string().min(2).max(120),
    contactPhone: PhoneInputSchema,
    /*
     * ‎`.strict()` למטה הוא מה שהופך את זה לחובה ולא לנוחות: בלי
     * המפתח כאן, טופס ששולח כתובת מקבל 400 ולא „נשמר בלי המייל”.
     */
    contactEmail: z.string().trim().email().max(254).optional(),
    /*
     * ‎`.strict()` גם על האובייקט הפנימי: `.strict()` של החיצוני
     * אינו יורד לתוכו, ומפתח שגוי (`minRooms` במקום `roomsMin`)
     * נבלע בשקט — הבקשה החזירה 201 בלי השדה. לטופס זה לא קרה;
     * לצרכן API או לייבוא — כן. הקריאה מהמסד (`parse` בשירות)
     * נשארת סלחנית, כי שם אין מי שיתקן.
     */
    requirements: BuyerRequirementsSchema.strict(),
    financing: FinancingStatusSchema.optional(),
    maturity: BuyerMaturitySchema.optional(),
    /*
     * ‎**מזהה בלבד, והתקפות שלו נבדקת בשירות מול רשימת המשרד.**
     * ‎`z.string()` כאן מגביל רק את הצורה: הרשימה חיה בהגדרות ולא
     * בסכימה, ולכן `enum` היה מתיישן ברגע שמשרד יוסיף סטטוס.
     */
    officeStatus: z.string().max(24).optional(),
    source: z.string().min(1).max(60),
    agentNotes: z.string().max(4000).optional(),
  })
  .strict();

const UpdateBuyerSchema = z
  .object({
    requirements: BuyerRequirementsSchema.strict().optional(),
    financing: FinancingStatusSchema.optional(),
    maturity: BuyerMaturitySchema.optional(),
    /** `""` או `null` = הסרת הסטטוס; מזהה = בחירה בו. */
    officeStatus: z.union([z.string().max(24), z.null()]).optional(),
    agentNotes: z.string().max(4000).optional(),
    /*
     * ‎**העברת הכרטיס לסוכן אחר.** מזהה בלבד — בלי מחרוזת ריקה:
     * קונה בלי בעלים אינו „של כולם” אלא בלתי נראה לכל סוכן שאין לו
     * ‎`buyers.view_all`. ראו ההסבר ב-`BuyersService.update`.
     */
    ownerUserId: IdSchema.optional(),
  })
  .strict();

const ListQuerySchema = z
  .object({
    maturity: BuyerMaturitySchema.optional(),
    /** מצטלב עם `maturity` ואינו מתחרה בו — ראו `BuyersService.list`. */
    officeStatus: z.string().max(24).optional(),
    /** חיפוש חופשי — ערים מבוקשות, הערות הסוכן, סיכומי AI ומקור */
    q: z.string().max(120).optional(),
    /** בשקלים; נבדק בחפיפה מול טווח התקציב של הקונה */
    minPrice: z.coerce.number().min(0).optional(),
    maxPrice: z.coerce.number().min(0).optional(),
    minRooms: z.coerce.number().min(0).max(30).optional(),
    maxRooms: z.coerce.number().min(0).max(30).optional(),
    cursor: z.string().max(30).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

const AddInteractionSchema = z
  .object({
    kind: z.enum(["note", "call"]),
    direction: z.enum(["in", "out"]).optional(),
    content: z.string().min(1).max(4000),
  })
  .strict();

const InteractionsQuerySchema = z
  .object({
    cursor: z.string().max(30).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

/**
 * מחיקה מרוכזת.
 *
 * `permanent: false` (ברירת המחדל) = ארכיון, בדיוק כמו מחיקה
 * בודדת: "הלקוח כבר לא מחפש" אינו "הלקוח מעולם לא היה".
 * `permanent: true` נשמר למקרה שבשבילו הפעולה נבנתה — ייבוא שגוי
 * שצריך להיעלם — והמסך מבקש עליו אישור נפרד שמציין את המספר.
 *
 * תקרה של 500 בבקשה: הלולאה עוברת כרטיס-כרטיס דרך אותם שערים,
 * ובקשה בלי גבול הייתה יכולה לרוץ דקות ולהיתקל בפסק זמן — כלומר
 * מחיקה שנראית כאילו נכשלה אחרי שכבר מחקה חצי.
 */
const BulkDeleteSchema = z
  .object({
    ids: z.array(IdSchema).min(1).max(500),
    permanent: z.boolean().default(false),
  })
  .strict();

/** אותה תקרה כמו המחיקה עצמה — התצוגה המקדימה עונה על אותה בקשה. */
const BulkPreviewSchema = z
  .object({ ids: z.array(IdSchema).min(1).max(500) })
  .strict();

@Controller("buyers")
export class BuyersController {
  constructor(
    private readonly buyers: BuyersService,
    private readonly matching: MatchingService,
    private readonly catalogue: FeatureCatalogueService,
  ) {}

  @Post()
  @RequireCapability("buyers.edit")
  async create(
    @Body(new ZodValidationPipe(CreateBuyerSchema))
    body: z.infer<typeof CreateBuyerSchema>,
  ): Promise<BuyerDto> {
    return this.buyers.create(body);
  }

  @Get()
  @RequireCapability("buyers.view_own")
  async list(
    @Query(new ZodValidationPipe(ListQuerySchema))
    query: z.infer<typeof ListQuerySchema>,
  ): Promise<Page<BuyerDto>> {
    return this.buyers.list(query);
  }

  /**
   * ספירת קונים לפי בשלות — **בבסיס הנתונים**.
   *
   * הדשבורד חישב את הפילוח מתוך 100 הקונים שהרשימה במקרה טענה, ולכן
   * במשרד עם יותר מ-100 קונים הוא הציג התפלגות של מדגם שרירותי
   * כאילו היא של המאגר כולו (ביקורת Codex). groupBy סופר את הכול
   * בשאילתה אחת, ובלי לפענח שום PII.
   *
   * הנתיב חייב לכבד את אותו פילטר בעלות כמו הרשימה — אחרת סוכן
   * view_own היה רואה במונה קונים שאינו רשאי לראות ברשימה.
   */
  @Get("breakdown")
  @RequireCapability("buyers.view_own")
  async breakdown(): Promise<{
    total: number;
    byMaturity: Record<string, number>;
  }> {
    return this.buyers.breakdown();
  }

  /**
   * קטלוג המאפיינים של המשרד — **לטופס הקונה, תחת הרשאת הקונה.**
   *
   * אותו קטלוג יושב גם תחת `/properties`, ושם הוא מגודר ב-
   * `properties.view`. אבל היכולות ניתנות לשליטה נפרדת לכל משתמש
   * (ניהול המשרד יכול לחסום מודול), ולכן קיים סוכן שיש לו
   * `buyers.edit` בלי `properties.view`: טופס הקונה נפתח לפניו,
   * הקריאה נדחית ב-403, והרשימה מתרוקנת בשקט. התוצאה היא מסך
   * שמבטיח יכולת שאינה קיימת — הוא פשוט לא יכול לדרוש שום מאפיין
   * של המשרד, בעוד ה-API היה מקבל את הדרישה (ביקורת Codex).
   *
   * שני נתיבים ולא היתר כפול על אחד: השער כאן הוא התאמה מדויקת ליכולת
   * אחת, וזו ההבחנה ש-`auth-coverage.test.ts` אוכפת.
   *
   * הקטלוג הוא אוצר מילים ולא נתונים: תוויות שהמשרד כבר משתמש בהן,
   * בלי שום פרט על נכס מסוים.
   *
   * **מוכרח לשבת לפני `:id`** — נתיב סטטי אחרי פרמטרי נבלע ונקרא
   * כמזהה קונה.
   */
  @Get("feature-catalogue")
  @RequireCapability("buyers.edit")
  async featureCatalogue(): Promise<
    { key: string; label: string; count: number }[]
  > {
    return this.catalogue.list();
  }

  @Get(":id")
  @RequireCapability("buyers.view_own")
  async get(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<BuyerDto> {
    return this.buyers.getById(id);
  }

  @Patch(":id")
  @RequireCapability("buyers.edit")
  async update(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(UpdateBuyerSchema))
    body: z.infer<typeof UpdateBuyerSchema>,
  ): Promise<BuyerDto> {
    return this.buyers.update(id, body);
  }

  /** מה תגרור המחיקה — לפני האישור, לא אחריו. */
  @Get(":id/deletion-preview")
  @RequireCapability("buyers.delete")
  async deletionPreview(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<Awaited<ReturnType<BuyersService["deletionPreview"]>>> {
    return this.buyers.deletionPreview(id);
  }

  /**
   * מחיקה מרוכזת של כרטיסים שנבחרו ברשימה.
   *
   * `POST` ולא `DELETE`: רשימת מזהים היא גוף בקשה, ו-`DELETE` עם
   * גוף אינו נתמך באופן אחיד בשרתי ביניים ובלקוחות.
   *
   * `permanent` מפורש ולא ברירת מחדל — ראו `BulkDeleteSchema`.
   */
  /**
   * ‎**מה תגרור המחיקה המרוכזת — לפני האישור.**
   *
   * אותו גילוי כמו במחיקה הבודדת, בצורתו הקבוצתית: כמה כרטיסי
   * לקוח יתומים יימחקו עם הבחירה, ומה נספר בהם. המסך חוסם מחיקה
   * לצמיתות כשהבדיקה נכשלת — „לא ידוע” אינו „לא יימחק”.
   */
  @Post("bulk-deletion-preview")
  @RequireCapability("buyers.delete")
  @HttpCode(200)
  async bulkDeletionPreview(
    @Body(new ZodValidationPipe(BulkPreviewSchema))
    body: z.infer<typeof BulkPreviewSchema>,
  ): Promise<{
    contacts: number;
    erasure: { calls: number; messages: number; emails: number };
  }> {
    return this.buyers.bulkDeletionPreview(body.ids);
  }

  @Post("bulk-delete")
  @RequireCapability("buyers.delete")
  @HttpCode(200)
  async bulkDelete(
    @Body(new ZodValidationPipe(BulkDeleteSchema))
    body: z.infer<typeof BulkDeleteSchema>,
  ): Promise<{ removed: number; skipped: number }> {
    return this.buyers.removeMany(body.ids, body.permanent);
  }

  /**
   * ארכיון — הכרטיס יורד מהרשימות וההיסטוריה נשמרת.
   *
   * זו פעולת ברירת המחדל: "הלקוח כבר לא מחפש" אינו "הלקוח מעולם לא
   * היה". מחיקה לצמיתות היא נתיב נפרד, ורק מכרטיס שכבר בארכיון.
   */
  @Delete(":id")
  @RequireCapability("buyers.delete")
  @HttpCode(204)
  async archive(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<void> {
    await this.buyers.archive(id);
  }

  @Delete(":id/permanent")
  @RequireCapability("buyers.delete")
  @HttpCode(204)
  async purge(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<void> {
    await this.buyers.purge(id);
  }

  /** "נכסים מתאימים לקונה" — הצד השני של מסך ההתאמות הדו-צדי (אפיון §15). */
  @Get(":id/matches")
  @RequireCapability("matches.view")
  async matchesFor(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<MatchDto[]> {
    return this.matching.listForBuyer(id);
  }

  /** ציר ההיסטוריה של הקונה — הערות ותיעודי שיחה, מעומד (docs/01 §5). */
  @Get(":id/interactions")
  @RequireCapability("buyers.view_own")
  async interactions(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Query(new ZodValidationPipe(InteractionsQuerySchema))
    query: z.infer<typeof InteractionsQuerySchema>,
  ) {
    return this.buyers.listInteractions(id, query);
  }

  @Post(":id/interactions")
  @RequireCapability("buyers.edit")
  async addInteraction(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(AddInteractionSchema))
    body: z.infer<typeof AddInteractionSchema>,
  ): Promise<{ ok: true }> {
    await this.buyers.addInteraction(id, body);
    return { ok: true };
  }
}
