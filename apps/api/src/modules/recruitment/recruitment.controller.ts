import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import {
  IdSchema,
  PhoneInputSchema,
  PropertyFieldsSchema,
  RECRUITMENT_SOURCES,
  RECRUITMENT_STATUSES,
} from "@metavchim/shared";
import { RequireCapability } from "../../common/auth.decorators";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { RecruitmentService, type RecruitmentTargetDto } from "./recruitment.service";

/**
 * ‏שדות הנכס שנשמרים על שורת גיוס.
 *
 * ‎**תת-קבוצה של `PropertyFieldsSchema` ולא עותק** — הכתובת, הסוג,
 * החדרים והמחיר נגזרים ממנו, ולכן שינוי טיפוס שם נופל כאן בקומפילציה
 * במקום להישאר עותק שסטה. מה שאינו נכלל (מאפיינים, מיקום, בלעדיות,
 * מועד כניסה) אינו ידוע ממודעה — הוא נשאל אחרי הגיוס, בכרטיס הנכס.
 */
const RecruitmentFieldsSchema = PropertyFieldsSchema.pick({
  city: true,
  neighborhood: true,
  street: true,
  houseNumber: true,
  propertyType: true,
  dealType: true,
  rooms: true,
  areaSqm: true,
  floor: true,
  totalFloors: true,
  priceAgorot: true,
});

/**
 * ‎**`null` פירושו „נקה את השדה”, ו-`undefined` פירושו „אל תיגע”.**
 *
 * ‏בלי ההבחנה הזאת אי אפשר היה למחוק ערך שהוזן: הטופס השמיט שדה
 * ריק, השרת ראה „לא נשלח” והשאיר את הישן, ומי שמחק עיר גילה שהיא
 * חזרה (ביקורת Codex). `PropertyFieldsSchema` דורש `min(1)` על
 * מחרוזות, ולכן הריקון עובר כ-`null` מפורש ולא כמחרוזת ריקה.
 */
const clearable = <T extends z.ZodTypeAny>(schema: T) => schema.nullable().optional();

export const RecruitmentBodySchema = RecruitmentFieldsSchema.partial().extend({
  city: clearable(RecruitmentFieldsSchema.shape.city.unwrap()),
  neighborhood: clearable(RecruitmentFieldsSchema.shape.neighborhood.unwrap()),
  street: clearable(RecruitmentFieldsSchema.shape.street.unwrap()),
  houseNumber: clearable(RecruitmentFieldsSchema.shape.houseNumber.unwrap()),
  propertyType: clearable(RecruitmentFieldsSchema.shape.propertyType.unwrap()),
  dealType: clearable(RecruitmentFieldsSchema.shape.dealType.unwrap()),
  rooms: clearable(RecruitmentFieldsSchema.shape.rooms.unwrap()),
  areaSqm: clearable(RecruitmentFieldsSchema.shape.areaSqm.unwrap()),
  floor: clearable(RecruitmentFieldsSchema.shape.floor.unwrap()),
  totalFloors: clearable(RecruitmentFieldsSchema.shape.totalFloors.unwrap()),
  priceAgorot: clearable(RecruitmentFieldsSchema.shape.priceAgorot.unwrap()),
}).extend({
  status: z.enum(RECRUITMENT_STATUSES).optional(),
  source: z.enum(RECRUITMENT_SOURCES).optional(),
  /*
   * ‏הכתובת נבדקת גם כאן וגם בשירות. לא כפילות: הסכימה חוסמת קלט
   * שאינו כתובת בכלל, והשירות אוכף את הסכמות המותרות — והוא זה
   * שירוץ גם כשייכתב מסלול כתיבה נוסף שיעקוף את הסכימה הזאת.
   */
  /*
   * ‏גם `null` — כמו כל שדה שניתן לניקוי. הטופס שולח את מצבו המלא,
   * ולכן קישור ריק מגיע כ-`null`; סכימה שקיבלה רק מחרוזת או `""`
   * דחתה **יצירת נכס לגיוס בלי קישור**, שהוא המקרה השכיח
   * (ביקורת Codex, P1 — רגרסיה שנוצרה בתיקון של ניקוי השדות).
   */
  sourceUrl: z.union([z.string().url().max(2000), z.literal("")]).nullable().optional(),
  ownerName: clearable(z.string().min(2).max(120)),
  ownerPhone: clearable(PhoneInputSchema),
  notes: clearable(z.string().max(4000)),
  agentUserId: z.union([IdSchema, z.literal("")]).optional(),
}).strict();

const ListQuerySchema = z
  .object({ status: z.enum(RECRUITMENT_STATUSES).optional() })
  .strict();

/**
 * ‎**נכסים לגיוס.**
 *
 * ## ‏למה היכולות של „נכסים” ולא יכולת חדשה
 *
 * ‏יכולת חדשה נולדת **כבויה** לכל התפקידים הקיימים: התכונה הייתה
 * נסתרת מכל משרד עד שמישהו נכנס למסך ההרשאות והדליק אותה, ורוב
 * המשרדים לא היו מגלים שהיא קיימת.
 *
 * ‏והמיפוי גם נכון לגופו: נכס לגיוס הוא נכס-בהמתנה, ומי שרשאי
 * ליצור נכסים רשאי לרדוף אחריהם. ההמרה דורשת `properties.create`
 * מאותה סיבה שההמרה מליד דורשת אותה — היא **יוצרת נכס**.
 */
@Controller("recruitment")
export class RecruitmentController {
  constructor(private readonly recruitment: RecruitmentService) {}

  @Get()
  @RequireCapability("properties.view")
  async list(
    @Query(new ZodValidationPipe(ListQuerySchema)) query: z.infer<typeof ListQuerySchema>,
  ): Promise<RecruitmentTargetDto[]> {
    return this.recruitment.list(query.status);
  }

  @Get(":id")
  @RequireCapability("properties.view")
  async getOne(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<RecruitmentTargetDto> {
    return this.recruitment.getById(id);
  }

  @Post()
  @RequireCapability("properties.create")
  async create(
    @Body(new ZodValidationPipe(RecruitmentBodySchema))
    body: z.infer<typeof RecruitmentBodySchema>,
  ): Promise<RecruitmentTargetDto> {
    return this.recruitment.create(body);
  }

  @Patch(":id")
  @RequireCapability("properties.edit")
  async update(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(RecruitmentBodySchema.partial()))
    body: z.infer<typeof RecruitmentBodySchema>,
  ): Promise<RecruitmentTargetDto> {
    return this.recruitment.update(id, body);
  }

  @Delete(":id")
  @RequireCapability("properties.delete")
  @HttpCode(204)
  async remove(@Param("id", new ZodValidationPipe(IdSchema)) id: string): Promise<void> {
    await this.recruitment.remove(id);
  }

  /**
   * „המר לנכס שלי” — הרגע שבו הנכס נעשה של המשרד.
   *
   * ‎`properties.create` ולא `edit`: הנתיב **יוצר נכס**, ומי שמורשה
   * לערוך אך לא ליצור אינו אמור לעקוף את זה דרך המרה. אותו נימוק
   * בדיוק של ההמרה מליד.
   */
  @Post(":id/convert")
  @RequireCapability("properties.create")
  @HttpCode(200)
  async convert(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<{ propertyId: string }> {
    return this.recruitment.convert(id);
  }
}
