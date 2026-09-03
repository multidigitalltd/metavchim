import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import {
  BuyerMaturitySchema,
  BuyerRequirementsSchema,
  FinancingStatusSchema,
  IdSchema,
  LeadSourceSchema,
  LeadIntentSchema,
  LeadStatusSchema,
  PhoneInputSchema,
  leadDeletionKeepsContact,
  type LeadDeletionScope,
  type Page,
} from "@metavchim/shared";
import { RequireCapability } from "../../common/auth.decorators";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { BuyersService, type BuyerDto } from "../buyers/buyers.service";
import { LeadsService, type InteractionDto, type LeadDto } from "./leads.service";

const CreateLeadSchema = z
  .object({
    contactName: z.string().min(2).max(120),
    contactPhone: PhoneInputSchema,
    /* אותו פער בדיוק כמו בקונה: השירות ידע לשמור, הסכימה לא קיבלה */
    contactEmail: z.string().trim().email().max(254).optional(),
    source: LeadSourceSchema,
    /* ‏רוחב העמודה (`VarChar(60)`), לא מספר שנבחר כאן */
    sourceNote: z.string().trim().max(60).optional(),
    intent: LeadIntentSchema,
    summary: z.string().max(2000).optional(),
    requiresHuman: z.boolean().optional(),
    requiresHumanReason: z.string().max(500).optional(),
  })
  .strict();

const StatusSchema = z.object({ status: LeadStatusSchema }).strict();

/**
 * ‎**מקור הליד — מחרוזת חופשית, ולא הרשימה המוכרת.**
 *
 * ‏מפתה לכתוב כאן `LeadSourceSchema`, וזה היה **פוסל ערכים שהמערכת
 * עצמה כותבת**: צינור הטלפוניה שומר `outbound_call`, `phone`, או
 * את תווית הקמפיין שהמשרד הקליד במספר הווירטואלי (`leadSourceFor`,
 * טקסט חופשי עד 20 תווים). אלה ייחוסי קמפיין אמיתיים, לא זבל —
 * וסכימה סגורה הייתה הופכת „תיקון מקור” לפעולה שמוחקת אותם.
 *
 * ‎`max(20)` הוא בדיוק רוחב העמודה (`VarChar(20)`), ולא מספר שנבחר
 * כאן: ערך ארוך יותר נחתך במסד או מפיל את הכתיבה.
 */
const SourceSchema = z
  .object({
    source: z.string().trim().min(1).max(20),
    /* ‏הטקסט של „אחר”. השירות מנקה אותו כשהמקור אינו „אחר”. */
    sourceNote: z.string().trim().max(60).optional(),
  })
  .strict();

/*
 * `default({})` ולא רק שדה אופציונלי: בקשת DELETE בלי גוף כלל מגיעה
 * ל-Pipe כ-`undefined` (מפרק הגוף אינו רץ בלי `Content-Type`), וסכמת
 * אובייקט דוחה `undefined` — כלומר לקוח API ישן היה מקבל 400 במקום
 * ההתנהגות ההיסטורית שהובטחה לו כאן (ביקורת Codex).
 */
const DeleteLeadSchema = z
  .object({
    scope: z.enum(["lead", "lead_and_contact"] satisfies [LeadDeletionScope, LeadDeletionScope]).optional(),
  })
  .strict()
  .default({});
const NoteSchema = z.object({ content: z.string().min(1).max(2000) }).strict();

const ConvertSchema = z
  .object({
    requirements: BuyerRequirementsSchema,
    financing: FinancingStatusSchema.optional(),
    maturity: BuyerMaturitySchema.optional(),
  })
  .strict();

const ListQuerySchema = z
  .object({
    status: LeadStatusSchema.optional(),
    /**
     * ‎**„לטיפול” מול „טופל” — במסד, לפני העימוד** (ביקורת Codex).
     *
     * המסך חילק את מה ש-`/leads?limit=100` החזיר, ולכן במשרד עם יותר
     * מ-100 לידים ליד פתוח שנדחק מחוץ לעמוד פשוט לא הופיע בתור
     * העבודה — בלי שום סימן לכך שהוא קיים.
     */
    open: z
      .enum(["true", "false"])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === "true")),
    requiresHuman: z
      .enum(["true", "false"])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === "true")),
    cursor: z.string().max(30).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

@Controller("leads")
export class LeadsController {
  constructor(
    private readonly leads: LeadsService,
    private readonly buyers: BuyersService,
  ) {}

  @Post()
  @RequireCapability("leads.edit")
  async create(
    @Body(new ZodValidationPipe(CreateLeadSchema)) body: z.infer<typeof CreateLeadSchema>,
  ): Promise<{ id: string; merged: boolean; visible: boolean }> {
    return this.leads.create(body);
  }

  @Get()
  @RequireCapability("leads.view_own")
  async list(
    @Query(new ZodValidationPipe(ListQuerySchema)) query: z.output<typeof ListQuerySchema>,
  ): Promise<Page<LeadDto>> {
    return this.leads.list(query);
  }

  /**
   * ספירת לידים לפי סטטוס — בבסיס הנתונים ולא מתוך 100 השורות
   * שהמסך במקרה טען (ביקורת Codex). אותו פילטר בעלות כמו הרשימה.
   */
  @Get("breakdown")
  @RequireCapability("leads.view_own")
  async breakdown(): Promise<{ total: number; byStatus: Record<string, number> }> {
    return this.leads.breakdown();
  }

  @Get(":id")
  @RequireCapability("leads.view_own")
  async get(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<{ lead: LeadDto; timeline: InteractionDto[] }> {
    return this.leads.getById(id);
  }

  @Patch(":id/status")
  @RequireCapability("leads.edit")
  @HttpCode(200)
  async updateStatus(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(StatusSchema)) body: z.infer<typeof StatusSchema>,
  ): Promise<{ ok: true }> {
    await this.leads.updateStatus(id, body.status);
    return { ok: true };
  }

  /**
   * ‎**תיקון מקור הליד.**
   *
   * ‏המקור נקבע אוטומטית בקליטה, והוא לא תמיד נכון: שיחה שנכנסה
   * למספר הכללי נרשמת `phone` גם כשהלקוח הגיע מהמלצה, וקמפיין
   * שהוגדר בטעות מייחס לידים לתווית שגויה. עד כה לא הייתה שום דרך
   * לתקן — לא בממשק ולא בשרת.
   *
   * ‎`leads.edit` והיקף הליד (`assertLeadAccess` בשירות) — אותה
   * הרשאה בדיוק שנדרשת לשינוי הסטטוס.
   */
  @Patch(":id/source")
  @RequireCapability("leads.edit")
  @HttpCode(200)
  async updateSource(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(SourceSchema)) body: z.infer<typeof SourceSchema>,
  ): Promise<{ ok: true }> {
    await this.leads.updateSource(id, body.source, body.sourceNote);
    return { ok: true };
  }

  /**
   * המרת ליד לקונה: יוצר קונה על אותו contact, מסמן converted, ורושם
   * בשני הצירים. יוצר ישות קונים — לכן דורש buyers.edit ולא רק leads.edit.
   */
  @Post(":id/convert")
  @RequireCapability("buyers.edit")
  async convert(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(ConvertSchema)) body: z.infer<typeof ConvertSchema>,
  ): Promise<BuyerDto> {
    return this.buyers.convertFromLead(id, body);
  }

  /**
   * מחיקת ליד לא רלוונטי. יכולת נפרדת מ-`leads.edit`, כמו במחיקת נכס.
   *
   * `scope` הוא הבחירה של המוחק: `lead` מוחק את הפנייה ומשאיר את
   * כרטיס הלקוח (ליד כפול, פנייה שנסגרה), ו-`lead_and_contact` מרשה
   * גם לכרטיס לרדת אם לא נשאר לו קשר אחר במשרד (ספאם, טעות במספר).
   * **בהיעדר הגוף — ההתנהגות ההיסטורית**, כדי שלקוח API ישן לא ישנה
   * משמעות בשקט; המסך שולח בחירה מפורשת תמיד.
   *
   * מחזיר גוף ולא 204 כדי שהמסך יוכל לומר אם גם כרטיס איש הקשר ירד —
   * זה מה שהמשתמש הכי רוצה לדעת מיד אחרי שלחץ.
   */
  /**
   * מה תגרור בחירת „גם את כרטיס הלקוח” — לקריאה לפני האישור.
   * אותה יכולת כמו המחיקה: זה מידע על מה שהמחיקה תעשה.
   */
  @Get(":id/deletion-preview")
  @RequireCapability("leads.delete")
  async deletionPreview(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<Awaited<ReturnType<LeadsService["deletionPreview"]>>> {
    return this.leads.deletionPreview(id);
  }

  @Delete(":id")
  @RequireCapability("leads.delete")
  @HttpCode(200)
  async remove(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(DeleteLeadSchema)) body: z.infer<typeof DeleteLeadSchema>,
  ): Promise<{ contactDeleted: boolean }> {
    return this.leads.remove(id, leadDeletionKeepsContact(body.scope ?? "lead_and_contact"));
  }

  @Post(":id/notes")
  @RequireCapability("leads.edit")
  async addNote(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(NoteSchema)) body: z.infer<typeof NoteSchema>,
  ): Promise<InteractionDto> {
    return this.leads.addNote(id, body.content);
  }
}
