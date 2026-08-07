import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import { z } from "zod";
import {
  CONTACT_ROLES,
  IdSchema,
  PHONE_LABELS,
  PhoneSchema,
  normalizePhone,
  type ContactPerson,
  type DuplicateGroup,
} from "@metavchim/shared";
import { assertContactAccess, ownershipFilter } from "../../common/ownership";
import { TenantContext } from "../../common/tenant-context";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { PrismaService } from "../../core/prisma.service";
import { AnyAuthenticated, RequireCapability } from "../../common/auth.decorators";
import { ContactsService } from "./contacts.service";
import { DuplicatesService } from "./duplicates.service";

/** אותו נרמול של קליטת הלידים — שני כתיבים של מספר חייבים להתלכד. */
const PhoneField = z.string().trim().max(25).transform(normalizePhone).pipe(PhoneSchema);

const MergeSchema = z
  .object({ survivorId: IdSchema, duplicateId: IdSchema })
  .strict();

const AddPhoneSchema = z
  .object({ phone: PhoneField, label: z.enum(PHONE_LABELS).default("mobile") })
  .strict();

const AddPersonSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    phone: PhoneField,
    role: z.enum(CONTACT_ROLES).default("spouse"),
  })
  .strict();

/**
 * תיק לקוח מאוחד (docs/03 §contacts): אדם אחד = contact אחד, וקונה,
 * מוכר וליד מפנים אליו. ה-endpoint מציג את כל הישויות של אותו אדם —
 * ליד חוזר לא נראה כמו זר, וסוכן שפותח קונה רואה שהוא גם בעל נכס.
 *
 * כל תת-רשימה מסוננת בפילטר הבעלות של המודול שלה: סוכן view_own רואה
 * רק את הישויות שבבעלותו — הקישור לא עוקף הרשאות.
 */

export interface RelatedEntitiesDto {
  buyer: { id: string; maturity: string } | null;
  leads: { id: string; status: string; intent: string; createdAt: Date }[];
  ownedProperties: { id: string; title: string; status: string }[];
}

@Controller("contacts")
export class ContactsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contacts: ContactsService,
    private readonly duplicates: DuplicatesService,
  ) {}

  /* ---------- כרטיסים כפולים ---------- */

  /**
   * כפילויות אפשריות. דורש ראות רוחבית על הלקוחות — סוכן עם view_own
   * רואה חצי מהתמונה, והצעת מיזוג על סמך חצי תמונה היא הצעה למחוק
   * כרטיס שהוא לא רואה.
   */
  @RequireCapability("buyers.view_all")
  @Get("duplicates")
  async duplicateGroups(): Promise<DuplicateGroup[]> {
    return this.duplicates.findDuplicates();
  }

  /** מיזוג. פעולה הרסנית — נרשמת ביומן הביקורת עם המזהה שנעלם. */
  @RequireCapability("buyers.view_all")
  @Post("duplicates/merge")
  @HttpCode(200)
  async merge(
    @Body(new ZodValidationPipe(MergeSchema)) body: z.infer<typeof MergeSchema>,
  ): Promise<{ moved: number }> {
    return this.duplicates.merge(body.survivorId, body.duplicateId);
  }

  // אין כאן יכולת אחת נדרשת: כל תת-רשימה נשלטת ע"י כלל המודול שלה
  // (הקונה והלידים בפילטר הבעלות, הנכסים כלל-משרדיים) — לכן ההצהרה
  // היא "מחובר", וההרשאה בפועל נאכפת בתוך השאילתה עצמה.
  @AnyAuthenticated()
  @Get(":id/related")
  async related(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<RelatedEntitiesDto> {
    const tenantId = TenantContext.current().tenantId;
    return this.prisma.withTenant(async (tx) => {
      const contact = await tx.contact.findFirst({
        where: { id, tenantId },
        select: { id: true },
      });
      if (!contact) throw new NotFoundException("איש קשר לא נמצא");

      const [buyer, leads, properties] = await Promise.all([
        tx.buyer.findFirst({
          where: {
            tenantId,
            contactId: id,
            deletedAt: null,
            ...ownershipFilter("buyers.view_all", "ownerUserId"),
          },
          select: { id: true, maturity: true },
        }),
        tx.lead.findMany({
          where: {
            tenantId,
            contactId: id,
            ...ownershipFilter("leads.view_all", "assignedToUserId"),
          },
          orderBy: { createdAt: "desc" },
          take: 10,
          select: { id: true, status: true, intent: true, createdAt: true },
        }),
        // נכסים גלויים לכל המשרד — אין פילטר בעלות במודול הנכסים
        tx.property.findMany({
          where: { tenantId, ownerContactId: id, deletedAt: null },
          orderBy: { createdAt: "desc" },
          take: 10,
          select: { id: true, marketingTitle: true, city: true, status: true },
        }),
      ]);

      return {
        buyer,
        leads,
        ownedProperties: properties.map((p) => ({
          id: p.id,
          title: p.marketingTitle ?? [p.city, "נכס"].filter(Boolean).join(" — "),
          status: p.status,
        })),
      };
    });
  }

  /* ---------- האנשים והטלפונים של הכרטיס ---------- */

  /**
   * מי עומד מאחורי הכרטיס. הראשי תמיד ראשון — המתווך מתקשר לראשון
   * ברשימה, וסדר משתנה בין טעינות היה שולח אותו לאדם אחר.
   */
  @AnyAuthenticated()
  @Get(":id/people")
  async people(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<{
    people: ContactPerson[];
    phones: { id: string | null; phone: string; label: string; primary: boolean }[];
  }> {
    const tenantId = TenantContext.current().tenantId;
    return this.prisma.withTenant(async (tx) => {
      await assertContactAccess(tx, tenantId, id);
      const [people, phones] = await Promise.all([
        this.contacts.peopleFor(tx, id),
        this.contacts.phonesFor(tx, id),
      ]);
      return { people, phones };
    });
  }

  /** הוספת אדם לכרטיס — עריכת לקוח, ולכן יכולת עריכה ולא צפייה. */
  @RequireCapability("buyers.edit")
  @Post(":id/people")
  @HttpCode(200)
  async addPerson(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(AddPersonSchema)) body: z.infer<typeof AddPersonSchema>,
  ): Promise<{ ok: true }> {
    const tenantId = TenantContext.current().tenantId;
    await this.prisma.withTenant(async (tx) => {
      await assertContactAccess(tx, tenantId, id);
      const result = await this.contacts.linkPerson(tx, id, body);
      if (!result.ok) throw new BadRequestException("זה אותו אדם — אי אפשר לקשר כרטיס לעצמו");
    });
    return { ok: true };
  }

  @RequireCapability("buyers.edit")
  @Delete(":id/people/:relatedId")
  @HttpCode(200)
  async removePerson(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Param("relatedId", new ZodValidationPipe(IdSchema)) relatedId: string,
  ): Promise<{ ok: true }> {
    const tenantId = TenantContext.current().tenantId;
    await this.prisma.withTenant(async (tx) => {
      await assertContactAccess(tx, tenantId, id);
      await this.contacts.unlinkPerson(tx, id, relatedId);
    });
    return { ok: true };
  }

  /**
   * הוספת טלפון. מספר ששייך לאדם אחר נדחה בהודעה מפורשת — הודעה
   * נכנסת ממנו לא הייתה יכולה להכריע לאיזה כרטיס היא שייכת.
   */
  @RequireCapability("buyers.edit")
  @Post(":id/phones")
  @HttpCode(200)
  async addPhone(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(AddPhoneSchema)) body: z.infer<typeof AddPhoneSchema>,
  ): Promise<{ ok: true }> {
    const tenantId = TenantContext.current().tenantId;
    await this.prisma.withTenant(async (tx) => {
      await assertContactAccess(tx, tenantId, id);
      const result = await this.contacts.addPhone(tx, id, body);
      if (result.reason === "taken") {
        throw new BadRequestException("המספר כבר רשום אצל איש קשר אחר במשרד");
      }
    });
    return { ok: true };
  }

  @RequireCapability("buyers.edit")
  @Delete(":id/phones/:phoneId")
  @HttpCode(200)
  async removePhone(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Param("phoneId", new ZodValidationPipe(IdSchema)) phoneId: string,
  ): Promise<{ ok: true }> {
    const tenantId = TenantContext.current().tenantId;
    await this.prisma.withTenant(async (tx) => {
      await assertContactAccess(tx, tenantId, id);
      await this.contacts.removePhone(tx, id, phoneId);
    });
    return { ok: true };
  }
}
