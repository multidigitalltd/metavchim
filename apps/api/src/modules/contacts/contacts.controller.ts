import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
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
import { AuditService } from "../../core/audit.service";
import { PrismaService } from "../../core/prisma.service";
import { AnyAuthenticated, RequireCapability } from "../../common/auth.decorators";
import { ContactsService } from "./contacts.service";
import { ContactErasureService } from "./contact-erasure.service";
import { DuplicatesService } from "./duplicates.service";

/** אותו נרמול של קליטת הלידים — שני כתיבים של מספר חייבים להתלכד. */
const PhoneField = z.string().trim().max(25).transform(normalizePhone).pipe(PhoneSchema);

const MergeSchema = z
  .object({ survivorId: IdSchema, duplicateId: IdSchema })
  .strict();

/** מפתח קבוצת הכפילות — חתימת השם (hex של HMAC, 64 תווים). */
const DismissSchema = z
  .object({ key: z.string().regex(/^[0-9a-f]{64}$/iu) })
  .strict();

/** אימייל תקין או מחרוזת ריקה למחיקה — אין מצב "לא נשלח" דו-משמעי. */
const UpdateEmailSchema = z
  .object({ email: z.union([z.string().trim().email().max(254), z.literal("")]) })
  .strict();

/**
 * שם הכרטיס — אותה מידה בדיוק כמו שם של אדם שמתווסף לכרטיס
 * (`AddPersonSchema`), כי זה אותו סוג של נתון. אין „ריק”: כרטיס
 * בלי שם אינו מצב שהמערכת יודעת להציג.
 */
const UpdateNameSchema = z.object({ name: z.string().trim().min(2).max(120) }).strict();

const AddPhoneSchema = z
  .object({ phone: PhoneField, label: z.enum(PHONE_LABELS).default("mobile") })
  .strict();

/**
 * ‎**הסכמה לדיוור — `true` להצטרפות מחדש, `false` להסרה.**
 *
 * בוליאני מפורש ולא שני נתיבים: זו עובדה אחת על הלקוח, ולנתיב
 * „הצטרפות” בלי „הסרה” היה חסר בדיוק מה שהמשרד צריך כשלקוח מתקשר.
 */
const MarketingConsentSchema = z.object({ consent: z.boolean() }).strict();

/** אישור מחיקת לקוח: שמו המדויק — הפעולה אינה הפיכה. */
const EraseContactSchema = z.object({ confirmName: z.string().min(1).max(120) }).strict();

/**
 * מה תמחק המחיקה. מונים בלבד — המסך מציג "3 שיחות, 1 הסכם חתום",
 * ולא רשימה של מה שעומד להימחק.
 */
export interface ErasurePreviewDto {
  buyers: number;
  leads: number;
  calls: number;
  recordings: number;
  messages: number;
  agreements: number;
  /** מתוך ההסכמים — כמה כבר נחתמו. זה המספר שמנהל צריך לראות. */
  signedAgreements: number;
  appointments: number;
  /** נכסים שהוא בעליהם — נשארים, בלי הקישור אליו. */
  properties: number;
  sharedListings: number;
  linkedPeople: number;
}

const AddPersonSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    phone: PhoneField,
    role: z.enum(CONTACT_ROLES).default("spouse"),
    // אופציונלי: המתווך לא תמיד יודע את האימייל בזמן ההוספה
    email: z.union([z.string().trim().email().max(254), z.literal("")]).optional(),
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
  /**
   * רשימה ולא ערך יחיד: לאותו אדם יכולים להיות שני כרטיסי קונה —
   * מלכתחילה (שום דבר לא מנע זאת), ובמיוחד אחרי מיזוג כפילויות
   * שמאחד שני כרטיסים לאיש קשר אחד. `findFirst` היה מסתיר את השני
   * ומשאיר אותו בלי דרך להגיע אליו.
   */
  buyers: { id: string; maturity: string }[];
  leads: { id: string; status: string; intent: string; createdAt: Date }[];
  ownedProperties: { id: string; title: string; status: string }[];
}

@Controller("contacts")
export class ContactsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contacts: ContactsService,
    private readonly duplicates: DuplicatesService,
    private readonly erasure: ContactErasureService,
    private readonly audit: AuditService,
  ) {}

  /* ---------- זכות המחיקה של הלקוח ---------- */

  /**
   * מה יימחק אם הלקוח יימחק — לפני האישור, לא אחריו.
   *
   * מנהל שמוחק לקוח לפי בקשתו זכאי לדעת שהוא מוחק גם הסכם חתום —
   * המסמך שמזכה את המשרד בדמי התיווך. אותה גישה בדיוק כמו באזהרת
   * הורדת המסלול: מציגים לפני שמאשרים.
   */
  @RequireCapability("contacts.delete")
  @Get(":id/erasure-preview")
  async erasurePreview(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<ErasurePreviewDto> {
    return this.erasure.preview(id);
  }

  /**
   * מחיקת לקוח מהמערכת — כל מה שקשור לאדם, לצמיתות.
   *
   * זו זכות המחיקה של הלקוח: אדם שמבקש שהמשרד לא יחזיק עליו מידע
   * זכאי לכך, ולמשרד חייבת להיות דרך לבצע זאת בעצמו. ההקלדה של השם
   * היא האישור — הפעולה אינה הפיכה, והשורה שנלחצת היא אחת מרבות
   * ברשימה שנראות דומה.
   */
  @RequireCapability("contacts.delete")
  @Delete(":id")
  @HttpCode(200)
  async erase(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(EraseContactSchema)) body: z.infer<typeof EraseContactSchema>,
  ): Promise<{ ok: true }> {
    return this.erasure.erase(id, body.confirmName);
  }

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

  /** "אלה לא אותו אדם" — ההצעה לא תחזור כל עוד הקבוצה לא גדלה. */
  @RequireCapability("buyers.view_all")
  @Post("duplicates/dismiss")
  @HttpCode(200)
  async dismissDuplicates(
    @Body(new ZodValidationPipe(DismissSchema)) body: z.infer<typeof DismissSchema>,
  ): Promise<{ ok: true }> {
    return this.duplicates.dismiss(body.key);
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

      const [buyers, leads, properties] = await Promise.all([
        tx.buyer.findMany({
          where: {
            tenantId,
            contactId: id,
            deletedAt: null,
            ...ownershipFilter("buyers.view_all", "ownerUserId"),
          },
          orderBy: { createdAt: "asc" },
          take: 5,
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
        buyers,
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
    email?: string;
  }> {
    const tenantId = TenantContext.current().tenantId;
    return this.prisma.withTenant(async (tx) => {
      await assertContactAccess(tx, tenantId, id);
      const [people, phones, email] = await Promise.all([
        this.contacts.peopleFor(tx, id),
        this.contacts.phonesFor(tx, id),
        this.contacts.emailFor(tx, id),
      ]);
      return { people, phones, ...(email !== undefined ? { email } : {}) };
    });
  }

  /**
   * ‎**תיקון שם הכרטיס.**
   *
   * ‏שיחה נכנסת שבה לא זוהה שם יוצרת כרטיס ששמו הוא מספר הטלפון,
   * ועד כה זה היה סופי — לא היה נתיב לשנות אותו, והמתווך ראה מספר
   * במקום שם בכרטיס הקונה ובכל מסך שמציג אותו.
   *
   * ‎**היקף הגישה הוא היקף הלקוח** (`assertContactAccess`), והיכולת
   * היא `buyers.edit` — אותה יכולת שנדרשת כדי לשנות את האימייל שלו
   * או להוסיף לו אדם, שהם בדיוק אותו סוג של נתון.
   *
   * ‎**ביומן הביקורת נרשם שהשם שונה — ולא מה הוא היה.** השם הוא PII
   * מוצפן במנוחה, ורישום שלו בטקסט גלוי במטא-דאטה של הביקורת היה
   * מבטל בדיוק את ההצפנה הזו. אותה מוסכמה כמו `duplicate_dismiss`,
   * ששומר חתימה ולא שם.
   */
  @RequireCapability("buyers.edit")
  @Patch(":id/name")
  @HttpCode(200)
  async setName(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(UpdateNameSchema)) body: z.infer<typeof UpdateNameSchema>,
  ): Promise<{ ok: true; changed: boolean }> {
    const tenantId = TenantContext.current().tenantId;
    const changed = await this.prisma.withTenant(async (tx) => {
      await assertContactAccess(tx, tenantId, id);
      const did = await this.contacts.setName(tx, id, body.name);
      // רק שינוי אמיתי הוא אירוע; שמירה חוזרת של אותו שם אינה שינוי
      if (did) {
        await this.audit.record(tx, {
          action: "contact.renamed",
          entityType: "contact",
          entityId: id,
        });
      }
      return did;
    });
    return { ok: true, changed };
  }

  /** אימייל הכרטיס — עריכת לקוח; מחרוזת ריקה מוחקת. */
  @RequireCapability("buyers.edit")
  @Patch(":id/email")
  @HttpCode(200)
  async setEmail(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(UpdateEmailSchema)) body: z.infer<typeof UpdateEmailSchema>,
  ): Promise<{ ok: true }> {
    const tenantId = TenantContext.current().tenantId;
    await this.prisma.withTenant(async (tx) => {
      await assertContactAccess(tx, tenantId, id);
      await this.contacts.setEmail(tx, id, body.email.trim());
    });
    return { ok: true };
  }

  /**
   * ‎**החזרת לקוח לרשימת התפוצה — או הסרתו לבקשתו בטלפון.**
   *
   * דף ההסרה הציבורי מבטיח ללקוח ש„אפשר לחזור בכל עת בפנייה למשרד
   * התיווך”, ועד כה לא היה מי שיקיים: `optedOutAt` נכתב שם ולא נוקה
   * בשום מקום, והדרך היחידה הייתה עריכה ידנית במסד (ביקורת Codex).
   *
   * ‎**היקף הגישה הוא היקף הלקוח** (`assertContactAccess`), והיכולת
   * היא `buyers.edit` — אותה יכולת שנדרשת כדי לשנות את האימייל שלו,
   * שהוא בדיוק אותו סוג של נתון.
   *
   * ‎**נרשם ביומן הביקורת תמיד כשהמצב השתנה.** רשומת הסכמה שאי אפשר
   * לדעת מי יצר ומתי אינה רשומת הסכמה; זה גם מה שהופך את השחזור של
   * „הלקוח ביקש” לאפשרי בדיעבד.
   */
  @RequireCapability("buyers.edit")
  @Patch(":id/marketing-consent")
  @HttpCode(200)
  async setMarketingConsent(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(MarketingConsentSchema))
    body: z.infer<typeof MarketingConsentSchema>,
  ): Promise<{ ok: true; changed: boolean }> {
    const tenantId = TenantContext.current().tenantId;
    const changed = await this.prisma.withTenant(async (tx) => {
      await assertContactAccess(tx, tenantId, id);
      const did = await this.contacts.setMarketingConsent(tx, id, body.consent);
      // רק שינוי אמיתי הוא אירוע; קריאה חוזרת אינה הסכמה נוספת
      if (did) {
        await this.audit.record(tx, {
          action: body.consent ? "contact.marketing_resumed" : "contact.marketing_stopped",
          entityType: "contact",
          entityId: id,
        });
      }
      return did;
    });
    return { ok: true, changed };
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

  /**
   * אימייל של אדם מקושר — לבן/בת זוג תיבה משלהם, ולעיתים דווקא היא
   * זו שקוראת את ההצעות. הקישור עצמו נבדק בשירות: מזהה של איש קשר
   * שאינו מקושר לכרטיס הזה נדחה ולא נכתב.
   */
  @RequireCapability("buyers.edit")
  @Patch(":id/people/:relatedId/email")
  @HttpCode(200)
  async setPersonEmail(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Param("relatedId", new ZodValidationPipe(IdSchema)) relatedId: string,
    @Body(new ZodValidationPipe(UpdateEmailSchema)) body: z.infer<typeof UpdateEmailSchema>,
  ): Promise<{ ok: true }> {
    const tenantId = TenantContext.current().tenantId;
    await this.prisma.withTenant(async (tx) => {
      await assertContactAccess(tx, tenantId, id);
      const result = await this.contacts.setPersonEmail(tx, id, relatedId, body.email.trim());
      if (!result.ok) throw new NotFoundException("איש הקשר אינו מקושר לכרטיס הזה");
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
