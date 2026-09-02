import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ulid } from "ulid";
import {
  DEFAULT_COMMISSION_SPLIT,
  occupancyConflict,
  uniformTerms,
  type OccupancyState,
  computeReadiness,
  limitState,
  type Page,
  type PropertyFields,
} from "@metavchim/shared";
import {
  PROPERTY_TYPE_LABELS_HE,
  freeTextTerms,
  normalizeRange,
  priceRangeAgorot,
  whatsappLink,
} from "@metavchim/shared";

/** סוגי נכס שהתווית העברית שלהם מכילה את המונח שהוקלד. */
function propertyTypesFor(term: string): string[] {
  const needle = term.toLowerCase();
  return Object.entries(PROPERTY_TYPE_LABELS_HE)
    .filter(([, label]) => label.toLowerCase().includes(needle))
    .map(([value]) => value);
}
import {
  agentHandover,
  agentNameOf,
  agentNames,
  assertAgentInOffice,
  assertCanAssignAgents,
} from "../../common/agent-names";
import { lockContact, lockProperty, type ContactLock } from "../../common/locks";
import { isOrphanContact, leadOwnershipFilter } from "../../common/ownership";
import { TenantContext } from "../../common/tenant-context";
import { deleteCoopDeals } from "../../common/coop-deal-cleanup";
import { AuditService } from "../../core/audit.service";
import { CryptoService } from "../../core/crypto.service";
import { GeocodingService } from "../../core/geocoding.service";
import { OutboxService } from "../../core/outbox.service";
import { PlanCatalogService } from "../../core/plan-catalog.service";
import { PrismaService, type TenantTx } from "../../core/prisma.service";
import { ContactErasureService } from "../contacts/contact-erasure.service";
import { ContactsService } from "../contacts/contacts.service";
import { ListingsService } from "../collaboration/listings.service";
import {
  MatchingService,
  type MatchTrigger,
} from "../matching/matching.service";
import { MessagingService } from "../messaging/messaging.service";
import { mediaRawPath } from "./media.service";
import { PropertyTwinsService } from "./property-twins.service";
import {
  fieldsToColumns,
  PROPERTY_READY_SCORE,
  rowToFields,
  type PropertyDto,
} from "./property.mapper";

/**
 * מי יצר את הנכס — או `null` כשאין אדם.
 *
 * הקשרי מערכת (קליטת מוכר, סורקים) רצים עם `userId: ""`. מחרוזת
 * ריקה בעמודת שיוך היא „משויך למי ששמו ריק”, וזה מצב שאף שאילתה
 * אינה מחפשת. `null` הוא „לא משויך”, וזה מה שקרה באמת.
 */
function creatorUserId(): string | null {
  const { userId } = TenantContext.current();
  return userId === "" ? null : userId;
}

@Injectable()
export class PropertiesService {
  private readonly logger = new Logger(PropertiesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly matching: MatchingService,
    private readonly contacts: ContactsService,
    private readonly messaging: MessagingService,
    private readonly plans: PlanCatalogService,
    private readonly crypto: CryptoService,
    private readonly geocoding: GeocodingService,
    private readonly listings: ListingsService,
    private readonly twins: PropertyTwinsService,
    private readonly erasure: ContactErasureService,
  ) {}

  /**
   * מכסת הנכסים של המסלול.
   *
   * נבדקת על **הנכס הבא** ולא על המצב הקיים, ולכן משרד שחרג אחרי
   * שינוי תמחור ממשיך לראות ולערוך את מה שיש לו — רק ההוספה נחסמת.
   * נכסים בארכיון נספרים כמו כל השאר: הם עדיין במסד ועדיין ניתנים
   * לשחזור, ולכן לא היו מכסת חינם.
   */
  /**
   * מכסת הנכסים של המסלול — **בתוך הטרנזקציה שכותבת**.
   *
   * הבדיקה קיבלה `tx` ולא פותחת אחת משלה, ולפניה ננעל מנעול ייעוץ
   * ברמת הדייר. שתי בקשות מקבילות שספרו את אותו מצב לפני שאחת מהן
   * כתבה היו שתיהן עוברות, והמכסה הייתה נחצית בשקט — במיוחד בייבוא,
   * ששולח הרבה יצירות ברצף (ביקורת Codex).
   *
   * המנעול הוא `pg_advisory_xact_lock` ולא נעילת שורה: אין שורה
   * שמייצגת "המכסה של הדייר", והוא משתחרר מעצמו בסוף הטרנזקציה —
   * גם כשהיא נכשלת.
   *
   * הספירה חייבת לרוץ בהקשר דייר: `properties` תחת FORCE RLS, ובלי
   * `app.tenant_id` היא מחזירה אפס שורות **בלי שגיאה** — כלומר מכסה
   * שלעולם אינה נחצית, ובדיקה שנראית עובדת.
   */
  /**
   * האם לנכס יש ולו תמונה אחת — **קיום, לא ספירה.**
   *
   * המוכנות שואלת „יש תמונות?” ולא „כמה”, ולכן `findFirst` עם שדה
   * אחד: `count` על נכס עם מאה תמונות סורק את כולן כדי להחזיר מספר
   * שאיש אינו קורא.
   *
   * ‎`propertyMedia` תחת FORCE RLS כמו כל טבלה, ולכן התנאי כולל
   * `tenantId` במפורש — שאילתה בלי הקשר דייר מחזירה ריק בלי שגיאה,
   * כלומר „אין תמונות” על כל נכס במערכת.
   */
  private async hasMedia(tx: TenantTx, propertyId: string): Promise<boolean> {
    const one = await tx.propertyMedia.findFirst({
      where: { tenantId: TenantContext.current().tenantId, propertyId },
      select: { id: true },
    });
    return one !== null;
  }

  private async assertCanAddProperty(
    tx: TenantTx,
    tenantId: string,
  ): Promise<void> {
    const plan = await this.plans.forTenant(tenantId, tx);
    /*
     * מסלול שאי אפשר לפתור — חוסם, לא פותח.
     *
     * `tenants.plan` הוא varchar בלי מפתח זר, ולכן קוד ישן או שגוי
     * אפשרי. `undefined` שהומר ל-null היה נקרא כ"ללא הגבלה", כלומר
     * דווקא המשרד עם המצב השבור היה מקבל מכסה אינסופית. אותו כיוון
     * בטוח כמו `planAllows(undefined) === false` (ביקורת Codex).
     */
    if (plan === undefined) {
      throw new BadRequestException("המסלול של המשרד אינו מוגדר — פנו לתמיכה");
    }
    const limit = plan.maxProperties;
    if (limit === null) return;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`property-quota:${tenantId}`}))`;
    /*
     * נכסים בארכיון אינם נספרים.
     *
     * `softDelete` רק מסמן `deletedAt`, וכל קריאה רגילה מסננת אותם.
     * ספירה שכוללת אותם הייתה חוסמת משרד **לצמיתות**: הוא מוחק נכס
     * כדי לפנות מקום, המונה לא יורד, ובסוף אין לו אף נכס גלוי והוא
     * עדיין חסום (ביקורת Codex).
     */
    const used = await tx.property.count({
      where: { tenantId, deletedAt: null },
    });
    if (limitState(used, limit).blocked) {
      throw new BadRequestException(
        `מסלול "${plan.name}" כולל ${limit} נכסים. לתוספת נכסים יש לשדרג מסלול.`,
      );
    }
  }

  async create(input: {
    fields: PropertyFields;
    marketingTitle?: string;
    marketingDescription?: string;
    internalNotes?: string;
    /** הסוכן המטפל. חסר = מי שיוצר. */
    agentUserId?: string;
    /** בעל הנכס (המוכר) — נקשר כ-contact לפי טלפון (docs/03: אדם אחד) */
    owner?: { name: string; phone: string };
    /** מי גר בנכס כשזה אינו הבעלים — לתיאום ביקור. */
    occupant?: { name: string; phone: string };
  }): Promise<PropertyDto> {
    const id = await this.persist(input);
    /*
     * ההתאמות מחושבות **ברקע** — היצירה חוזרת מיד.
     *
     * החישוב סורק את כל הקונים במשרד, ובמאגר גדול זה שניות ארוכות
     * שהסוכן חיכה בהן מול טופס קפוא. הנכס עצמו כבר נשמר; ההתאמות
     * מופיעות בכרטיס שניות אחר כך. רשת הביטחון לכשל היא הרענון
     * התקופתי (MatchRefreshService), שסורק את כל המאגר ממילא —
     * אותה עסקת best-effort שכבר נהוגה בייבוא ובהמרת ליד.
     */
    void this.matching.recomputeForProperty(id).catch((error: unknown) => {
      this.logger.warn(`background match recompute failed for property ${id}: ${String(error)}`);
    });
    await this.autoPublishToNetwork(id);
    return this.getById(id);
  }

  /**
   * פרסום אוטומטי לרשת השיתופים — כשהמשרד בחר בכך בהגדרות.
   *
   * המדיניות היא של המשרד ולא של הסוכן: מי שמחזיק `settings.manage`
   * הפעיל את `autoShareProperties`, והסוכן שקולט נכס מבצע אותה — לכן
   * אין כאן בדיקת יכולת על המבצע. מה שמתפרסם הוא אותו צילום מוגבל
   * של `ListingsService.snapshot` — בלי רחוב, מספר בית או פרטי בעלים.
   *
   * best-effort במוצהר: מכסת רשת שהתמלאה, מסלול בלי רשת או נכס
   * שכבר מפורסם אינם "יצירת הנכס נכשלה". הנכס נשמר; הפרסום אפשרי
   * ידנית מכרטיס הנכס בכל רגע. חלוקת העמלה היא ברירת המחדל של
   * הרשת — הבעלים משנה אותה בכרטיס אם רצה אחרת.
   *
   * לא נקרא מ-`createForImport`: ייבוא קובץ שלם שמציף את הרשת במאות
   * מודעות במחי קליק הוא הפתעה, לא מדיניות — מייבאים, בודקים,
   * ומפרסמים בכוונה.
   */
  private async autoPublishToNetwork(propertyId: string): Promise<void> {
    const tenantId = TenantContext.current().tenantId;
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    const settings = (tenant?.settings ?? {}) as Record<string, unknown>;
    if (settings["autoShareProperties"] !== true) return;
    try {
      await this.listings.publish(propertyId, uniformTerms(DEFAULT_COMMISSION_SPLIT));
    } catch {
      // הנכס נשמר; פרסום ידני זמין מכרטיס הנכס
    }
  }

  /**
   * ייבוא בכמות (docs/08 §6): ההצלחה נקבעת בגבול הטרנזקציה — ברגע שהנכס
   * נשמר הוא "נוצר", גם אם חישוב ההתאמות שאחריו נכשל זמנית (best-effort;
   * יחושב מחדש בעריכה הבאה). כך אין דיווח-כזב של נכס שכבר קיים ואין כפילויות
   * בניסיון חוזר. גם חוסך N חישובי-התאמה סינכרוניים בבקשה אחת (docs/07 §5).
   */

  /**
   * המרת ליד לנכס — התאום של ‎BuyersService.convertFromLead‎.
   *
   * ליד אינו תמיד קונה: מי שהתקשר "יש לי דירה למכור" הוא בעל נכס.
   * איש הקשר של הליד הופך לבעל הנכס — אותו אדם, בלי כרטיס כפול.
   *
   * הסדר: תפיסת הליד (CAS על הסטטוס) ⟵ שמירת הנכס ⟵ התאמות.
   * שני הכללים שמחזיקים את זה ישרים (ביקורת Codex):
   *
   * - **ההתאמות הן best-effort**, כמו בהמרה לקונה ובייבוא: הנכס כבר
   *   נשמר, וכשל בחישוב אינו "ההמרה נכשלה" — הוא יחושב בעריכה הבאה.
   *   בלי זה, כשל התאמות היה מחזיר שגיאה על נכס שקיים, והניסיון
   *   החוזר היה יוצר נכס שני לאותו ליד.
   * - **הרולבק מחזיר את כל מה שהתפיסה שינתה** — סטטוס מקורי,
   *   requiresHuman, firstResponseAt, ומשימות ה-SLA שנסגרו — לא רק
   *   סטטוס גנרי. כישלון המרה (למשל מכסת נכסים) אינו אמור לשנות
   *   לצמיתות את מצב הטיפול בליד.
   */
  async convertFromLead(
    leadId: string,
    fields: PropertyFields,
  ): Promise<PropertyDto> {
    const ctx = TenantContext.current();

    const claim = await this.prisma.withTenant(async (tx) => {
      const lead = await tx.lead.findFirst({
        where: {
          id: leadId,
          tenantId: ctx.tenantId,
          ...leadOwnershipFilter(),
        },
      });
      if (!lead) throw new NotFoundException("ליד לא נמצא");

      const claimed = await tx.lead.updateMany({
        where: {
          id: leadId,
          tenantId: ctx.tenantId,
          status: { not: "converted" },
        },
        data: {
          status: "converted",
          requiresHuman: false,
          ...(lead.firstResponseAt === null
            ? { firstResponseAt: new Date() }
            : {}),
        },
      });
      if (claimed.count === 0) throw new ConflictException("הליד כבר הומר");

      // מזהי משימות ה-SLA שנסגרות — כדי שהרולבק יפתח בדיוק אותן
      const slaTasks = await tx.task.findMany({
        where: {
          tenantId: ctx.tenantId,
          sourceKey: `lead-sla:${leadId}`,
          status: "open",
        },
        select: { id: true },
      });
      await tx.task.updateMany({
        where: {
          id: { in: slaTasks.map((t) => t.id) },
          tenantId: ctx.tenantId,
        },
        /* `completedAt` נרשם בכל מסלול שסוגר משימה — ראו TasksService */
        data: { status: "done", completedAt: new Date() },
      });

      const contact = await tx.contact.findFirst({
        where: { id: lead.contactId, tenantId: ctx.tenantId },
        select: { nameEncrypted: true, phoneEncrypted: true },
      });
      if (!contact) throw new NotFoundException("איש הקשר של הליד לא נמצא");
      return {
        owner: {
          name: this.crypto.decrypt(contact.nameEncrypted),
          phone: this.crypto.decrypt(contact.phoneEncrypted),
        },
        prior: {
          status: lead.status,
          requiresHuman: lead.requiresHuman,
          firstResponseAt: lead.firstResponseAt,
        },
        slaTaskIds: slaTasks.map((t) => t.id),
      };
    });

    let propertyId: string;
    try {
      // persist בלבד — לא create: ההתאמות מופרדות ל-best-effort למטה
      propertyId = await this.persist({ fields, owner: claim.owner });
    } catch (error) {
      // השמירה נכשלה — הליד חוzר בדיוק למצבו, לא למצב גנרי
      await this.prisma
        .withTenant(async (tx) => {
          await tx.lead.updateMany({
            where: { id: leadId, tenantId: ctx.tenantId, status: "converted" },
            data: {
              status: claim.prior.status,
              requiresHuman: claim.prior.requiresHuman,
              firstResponseAt: claim.prior.firstResponseAt,
            },
          });
          await tx.task.updateMany({
            where: { id: { in: claim.slaTaskIds }, tenantId: ctx.tenantId },
            data: { status: "open" },
          });
        })
        .catch(() => undefined);
      throw error;
    }

    // ברקע — כמו ביצירה; הליד כבר הומר והנכס נשמר
    void this.matching.recomputeForProperty(propertyId).catch((error: unknown) => {
      this.logger.warn(`background match recompute failed for property ${propertyId}: ${String(error)}`);
    });
    // ליד שהומר הוא נכס חדש לכל דבר — אותה מדיניות רשת כמו בקליטה
    await this.autoPublishToNetwork(propertyId);
    return this.getById(propertyId);
  }

  /**
   * נכס שהגיע מ**טופס שהלקוח מילא בעצמו** — טיוטה, ולא מודעה.
   *
   * ‏`create` הרגילה מפרסמת לרשת השיתופים כשהמשרד הפעיל
   * `autoShareProperties`, וזה נכון כשסוכן קלט את הנכס: הוא ראה
   * אותו, הוא אחראי לו. כאן **איש במשרד לא ראה עדיין דבר** — טעות
   * הקלדה של לקוח, מחיר שנכתב באלפים במקום בשקלים, או סתם מישהו
   * שמילא טופס בטעות — והפרסום האוטומטי היה הופך כל אחד מאלה
   * למודעה חיה מול משרדים אחרים. הטיוטה נשארת בפנים עד שסוכן
   * מאשר אותה.
   *
   * ההתאמות כן מחושבות: הן פנימיות, והן מה שנותן לסוכן את התשובה
   * „יש לי כבר שלושה קונים לזה” כשהוא פותח את המשימה.
   *
   * הסטטוס אינו נמסר — ברירת המחדל של הטבלה היא `draft`, וזה מה
   * שנכון כאן. מסירה מפורשת הייתה מזמינה קריאה עתידית שמעבירה
   * „active” ומדלגת על כל ההיגיון שלמעלה.
   */
  async createFromIntake(input: {
    fields: PropertyFields;
    internalNotes?: string;
    owner: { name: string; phone: string };
    /**
     * המזהה **נקבע מראש על ידי הקורא**, ולא נוצר כאן.
     *
     * הטופס שומר אותו על שורת הבקשה **בתוך הטרנזקציה שתופסת את
     * השליחה**, כלומר לפני שהנכס נוצר בכלל. בלי זה שתי שליחות
     * מקבילות ראשונות שתיהן רואות „אין עדיין טיוטה”, שתיהן יוצרות,
     * ורק אחת נקשרת — השנייה נשארת נכס יתום במאגר של המשרד
     * (ביקורת Codex, P1).
     */
    id: string;
  }): Promise<string> {
    const id = await this.persist(input);
    try {
      await this.matching.recomputeForProperty(id);
    } catch {
      // הנכס כבר נשמר; חישוב ההתאמות אינו חלק מהצלחת היצירה.
    }
    return id;
  }

  async createForImport(input: {
    fields: PropertyFields;
    marketingTitle?: string;
    marketingDescription?: string;
    internalNotes?: string;
    /** בעל הנכס נקשר רק כששני הפרטים בקובץ — שם בלי טלפון יוצר כפילויות */
    owner?: { name: string; phone: string };
    /** מי גר בנכס כשזה אינו הבעלים — לתיאום ביקור. */
    occupant?: { name: string; phone: string };
    /** שימור סטטוס בייבוא-חזרה של קובץ מיוצא (Round-trip); ברירת מחדל: טיוטה. */
    status?: string;
  }): Promise<string> {
    // גם בייבוא: קובץ של אלף נכסים לא אמור לעקוף מכסה שהוספה ידנית
    // נחסמת בה. הבדיקה עצמה בתוך persist, באותה טרנזקציה של הכתיבה.
    const id = await this.persist(input);
    try {
      await this.matching.recomputeForProperty(id);
    } catch {
      // הנכס כבר נשמר; חישוב ההתאמות אינו חלק מהצלחת היצירה.
    }
    return id;
  }

  /** יוצר את רשומת הנכס בטרנזקציה יחידה ומחזיר את המזהה — גבול ההצלחה. */
  /**
   * השלמת קואורדינטה מהכתובת, כשהיא חסרה.
   *
   * **רק כשהיא חסרה**: סיכה שאדם גרר במתכוון (`locationSource: "pin"`)
   * לא תידרס בידי פענוח אוטומטי, וזו בדיוק ההבחנה שהעמודה
   * `location_source` נועדה לה.
   */
  private async withGeocodedLocation(
    fields: PropertyFields,
  ): Promise<PropertyFields> {
    if (fields.latitude !== undefined && fields.longitude !== undefined)
      return fields;
    const address = [fields.street, fields.neighborhood, fields.city]
      .filter(
        (part): part is string => part !== undefined && part.trim() !== "",
      )
      .join(", ");
    // עיר לבדה מפוענחת למרכז העיר, וזה עדיין שימושי יותר מכלום
    if (address === "") return fields;
    const [hit] = await this.geocoding.search(address);
    if (!hit) return fields;
    return {
      ...fields,
      latitude: hit.lat,
      longitude: hit.lon,
      locationSource: "geocode",
    };
  }

  private async persist(input: {
    fields: PropertyFields;
    marketingTitle?: string;
    marketingDescription?: string;
    internalNotes?: string;
    status?: string;
    /** הסוכן המטפל. חסר = מי שיוצר. */
    agentUserId?: string;
    owner?: { name: string; phone: string };
    /** מי גר בנכס כשזה אינו הבעלים — לתיאום ביקור. */
    occupant?: { name: string; phone: string };
    /** מזהה שנקבע מראש — ראו `createFromIntake`. ריק ⇒ נוצר כאן. */
    id?: string;
  }): Promise<string> {
    const tenantId = TenantContext.current().tenantId;
    const id = input.id ?? ulid();
    /*
     * מיקום הנכס נגזר מהכתובת כאן, בשרת, ולא נשאר ריק עד שסוכן
     * ייכנס לכרטיס ויגרור סיכה.
     *
     * זה היה החור הגדול בהתאמה הגיאוגרפית: העמודות `latitude`
     * ו-`longitude` קיימות במסד, קיים בורר מיקום על המפה בכרטיס —
     * ואף אחד לא קרא לפענוח בעת היצירה. בפועל רוב הנכסים נשארו בלי
     * קואורדינטה, וכל התאמה לפי מרחק הייתה נופלת חזרה לשם העיר.
     *
     * `await` **לפני** הטרנזקציה: קריאת רשת לספק חיצוני לא נכנסת
     * לתוך טרנזקציית מסד. וכשל שלה אינו מפיל קליטת נכס — הסוכן
     * יסמן ידנית, בדיוק כמו קודם.
     */
    const fields = await this.withGeocodedLocation(input.fields);
    const readiness = computeReadiness(fields, {
      /*
       * נכס חדש אין לו עדיין מדיה — התמונות נטענות אחרי היצירה,
       * במסך שלו. שאילתה כאן הייתה מחזירה ריק תמיד.
       */
      hasImages: false,
      hasDescription: Boolean(input.marketingDescription),
      hasOwner: input.owner !== undefined,
    });

    await this.prisma.withTenant(async (tx) => {
      // המכסה נבדקת כאן ולא לפני הקריאה: אותה טרנזקציה שכותבת היא
      // זו שסופרת, ולכן שתי בקשות מקבילות לא יכולות לעבור יחד
      await this.assertCanAddProperty(tx, tenantId);
      /*
       * ‎**באותה טרנזקציה שכותבת.** בדיקה לפניה הייתה חלון שבו הסוכן
       * הוסר מהמשרד בין הבדיקה לכתיבה — נדיר, אבל זה בדיוק סוג
       * החלון שהקוד הזה סוגר בכל מקום אחר.
       */
      if (input.agentUserId !== undefined && input.agentUserId !== "") {
        await assertAgentInOffice(tx, tenantId, input.agentUserId);
      }
      const ownerContact = input.owner
        ? await this.contacts.findOrCreateByPhone(tx, input.owner)
        : null;
      const occupantContact = input.occupant
        ? await this.contacts.findOrCreateByPhone(tx, input.occupant)
        : null;
      await tx.property.create({
        data: {
          id,
          tenantId,
          ownerContactId: ownerContact?.id ?? null,
          occupantContactId: occupantContact?.id ?? null,
          status: input.status ?? "draft",
          marketingTitle: input.marketingTitle ?? null,
          marketingDescription: input.marketingDescription ?? null,
          internalNotes: input.internalNotes ?? null,
          /*
           * ‎**נכס חדש שייך למי שיצר אותו** — אותו כלל בדיוק שכבר
           * נהוג בקונה (`ownerUserId ?? current`). ברירת מחדל היא
           * מה שהופך את השדה למשויך בפועל: שדה שצריך למלא ביד
           * נשאר ריק, ואז השאלה „של מי זה?” חוזרת בדיוק כמו קודם.
           *
           * ‎**וכשאין יוצר — `null`, ולא מחרוזת ריקה.** נכס שנוצר
           * מטופס קליטה של מוכר רץ בהקשר משרד עם `userId: ""`, ואז
           * ברירת המחדל הזו הייתה כותבת `''` לעמודה: `agentNames`
           * מסננת אותה והמסך מציג „לא משויך”, אבל שאילתה על
           * ‎`agent_user_id IS NULL` **אינה מוצאת** את השורה. שני
           * מקורות אמת על אותה שאלה, ואחד מהם שקט (ביקורת Codex).
           */
          agentUserId: input.agentUserId ?? creatorUserId(),
          readinessScore: readiness.score,
          ...(fieldsToColumns(fields) as object),
        },
      });
      await this.audit.record(tx, {
        action: "property.create",
        entityType: "property",
        entityId: id,
      });
      await this.outbox.emit(tx, "property.updated", {
        propertyId: id,
        tenantId,
        changedFields: Object.keys(fields),
      });
      if (readiness.score >= PROPERTY_READY_SCORE) {
        await this.outbox.emit(tx, "property.ready", {
          propertyId: id,
          tenantId,
          readinessScore: readiness.score,
        });
      }
    });

    return id;
  }

  async update(
    id: string,
    patch: Partial<PropertyFields> & {
      status?: string;
      marketingTitle?: string;
      marketingDescription?: string;
      internalNotes?: string;
      owner?: { name: string; phone: string };
      /** מי גר בנכס כשזה אינו הבעלים — לתיאום ביקור. */
      occupant?: { name: string; phone: string };
      /** הדירה התפנתה — מסירים את הדייר במקום להחליף אותו. */
      occupantCleared?: boolean;
      /** ‎`null` = „טרם נשאל”, וזה ערך ולא היעדר. */
      occupancy?: OccupancyState | null;
      leaseEndsAt?: string | null;
      noticePeriodDays?: number | null;
      /**
       * „עדכן רק אם הנכס עדיין בסטטוס הזה” — השוואה-והחלפה.
       *
       * בדיקת סטטוס שנעשית **לפני** הקריאה הזו אינה שווה דבר: היא
       * משחררת את מה שקראה, והנעילה על שורת הנכס נלקחת רק כאן. סוכן
       * שקידם את הנכס מטיוטה בין השתיים היה מקבל את העדכון על כרטיס
       * שכבר בדק (ביקורת Codex, P1). כאן הבדיקה **מתחת לאותה נעילה**
       * של הכתיבה, ולכן היא אמיתית.
       *
       * ריק = בלי תנאי, כמו כל שאר הקוראים.
       */
      expectStatus?: string;
      /**
       * שדות שיירוקנו ל-`NULL`.
       *
       * „לא נבחר” אינו „לא השתנה” כשמדובר בטופס שמתאר את הנכס
       * במלואו: מוכר שהוריד בשליחה חוזרת את הסימון „יש מעלית”
       * התכוון שאין, ושדה שנשאר על ערכו הקודם הוא נתון שאיש כבר
       * אינו טוען אותו (ביקורת Codex).
       *
       * רשימת שמות ולא `null` בתוך ה-Patch, כי `PropertyFieldsSchema`
       * אינו מקבל `null` — ותוספת `nullable` לכל שדה הייתה מרשה
       * ריקון בכל נתיב אחר, בלי שאיש ביקש זאת.
       */
      clearFields?: readonly (keyof PropertyFields)[];
      /**
       * שינוי הסוכן המטפל. מחרוזת ריקה = ניתוק השיוך.
       *
       * ‎`undefined` הוא „בלי שינוי” ולא „נתק”: רוב העריכות בכרטיס
       * אינן נוגעות בשיוך כלל, ושדה חסר שהיה מנתק היה מוחק את
       * הסוכן בכל שמירה של מחיר או תיאור.
       */
      agentUserId?: string;
    },
  ): Promise<PropertyDto> {
    const tenantId = TenantContext.current().tenantId;
    const {
      status,
      marketingTitle,
      marketingDescription,
      internalNotes,
      owner,
      occupant,
      occupantCleared,
      occupancy,
      leaseEndsAt,
      noticePeriodDays,
      expectStatus,
      clearFields,
      agentUserId,
      ...fieldPatch
    } = patch;

    /*
     * ירידת מחיר — הזדמנות, לא עוד עריכה.
     *
     * נלכדת כאן ונוסעת עד ההתראה, כדי שהיא תגיד "הורדת המחיר פתחה 3
     * קונים" ולא "נמצאו 3 קונים חדשים". הסוכן שהוריד מחיר לפני
     * שנייה הוא היחיד שיפעל לפי ההודעה הזו — למחרת היא כבר עדכון.
     */
    let trigger: MatchTrigger | undefined;

    await this.prisma.withTenant(async (tx) => {
      /*
       * ‎**כרטיסי איש הקשר נפתרים ראשונים — לפני נעילת שורת הנכס.**
       *
       * ‎`findOrCreateByPhone` נועלת את הכרטיס (`lockContact`), ומחיקת
       * לקוח נועלת בסדר ההפוך: קודם הכרטיס, אחר כך שורות הנכסים
       * שהיא מנתקת מהם. עריכה שהייתה נועלת קודם את הנכס ואז ממתינה
       * לכרטיס הייתה סוגרת מעגל — Postgres מפיל אחת מהשתיים
       * כ-deadlock, כלומר או שהעריכה נכשלת או שבקשת מחיקה של אדם
       * נכשלת (ביקורת Codex).
       *
       * הסדר הוא הכלל, לא המקרה: **כרטיס לפני נכס, בכל מי שנוגע
       * בשניהם.** נכס שאינו קיים מפיל את הטרנזקציה מיד אחרי כן,
       * וכרטיס שנוצר כאן מתגלגל אחורה איתה.
       */
      const ownerContact = owner
        ? await this.contacts.findOrCreateByPhone(tx, owner)
        : null;
      const occupantContact = occupant
        ? await this.contacts.findOrCreateByPhone(tx, occupant)
        : null;

      /*
       * **אותה נעילה שההעלאה והמחיקה לוקחות** — נקודת סנכרון אחת
       * לכל מי שכותב מוכנות.
       *
       * העריכה קוראת את מצב המדיה (`hasMedia`) וכותבת ציון. בלי
       * הנעילה, טרנזקציית מדיה שרצה במקביל יכולה לסגור ביניהן: העריכה
       * קראה „אין תמונות”, המדיה כתבה את הציון הנכון, והעריכה דרסה
       * אותו בערך שחישבה קודם (ביקורת Codex).
       *
       * הקריאה של השורה ושל המדיה חייבת להיות **אחרי** הנעילה: מצב
       * שנקרא לפניה עלול כבר להיות ישן ברגע החישוב.
       */
      await lockProperty(tx, tenantId, id);
      const existing = await tx.property.findFirst({
        where: {
          id,
          tenantId: TenantContext.current().tenantId,
          deletedAt: null,
        },
      });
      if (!existing) throw new NotFoundException("נכס לא נמצא");

      /*
       * ‎**מתחת לנעילה, ולא לפניה.** ראו `expectStatus` בחתימה: זו
       * כל הנקודה — סטטוס שנקרא לפני הנעילה יכול היה להשתנות בדיוק
       * בין הקריאה לכתיבה.
       */
      if (expectStatus !== undefined && existing.status !== expectStatus) {
        throw new ConflictException(
          `הנכס אינו בסטטוס ${expectStatus} עוד — העדכון לא בוצע`,
        );
      }

      /*
       * ‎**סתירה נדחית, ואינה נשמרת בשקט.**
       *
       * „הבעלים גר בנכס” בזמן ששוכר רשום משאיר טלפון של אדם בכרטיס
       * שמצהיר שאין שם אדם — מספר שאיש כבר לא יודע למה הוא שם, ושלא
       * ימצא בבקשת מחיקה. הבדיקה כאן ולא בלקוח בלבד, כי נתיב API
       * אינו נגזר מהמסך.
       *
       * ‎**המצב אחרי העדכון ולא לפניו**, וזה ההבדל: מי שסימן „מושכר”
       * והוסיף שוכר באותה בקשה עושה דבר תקין לגמרי, ובדיקה על השורה
       * הישנה הייתה חוסמת אותו.
       */
      if (occupancy !== undefined && occupancy !== null) {
        const tenantAfter =
          occupantCleared === true
            ? false
            : occupantContact !== null || existing.occupantContactId !== null;
        const conflict = occupancyConflict(occupancy, tenantAfter);
        if (conflict !== null) throw new BadRequestException(conflict);
      }

      const priceBefore =
        existing.priceAgorot === null ? null : Number(existing.priceAgorot);
      const priceAfter = fieldPatch.priceAgorot;
      // רק ירידה. העלאת מחיר סוגרת קונים, ואין בה מה לחגוג.
      if (
        priceBefore !== null &&
        priceAfter !== undefined &&
        priceAfter < priceBefore
      ) {
        trigger = {
          kind: "price_drop",
          fromAgorot: priceBefore,
          toAgorot: priceAfter,
        };
      }

      /*
       * ‎**הריקון נספר במוכנות, ולא רק בכתיבה.**
       *
       * ‏`clearFields` מרוקן עמודות ל-`NULL`, וחישוב שמתעלם ממנו
       * משאיר את הציון הישן: נכס שהמוכר מחק ממנו מחיר ושטח נשאר
       * „מוכן”, והאירועים שנגזרים מהסף יוצאים על מצב שכבר אינו נכון
       * (ביקורת Codex). המחיקה כאן על ההעתק בלבד — היא לא נוגעת
       * ב-`fieldPatch` שנכתב לשורה.
       */
      const mergedFields: Record<string, unknown> = {
        ...rowToFields(existing),
        ...fieldPatch,
      };
      for (const key of clearFields ?? []) delete mergedFields[key];
      /*
       * ‎**אותה אכיפה בנכס.** הבורר בשני הכרטיסים נשען על
       * ‎`tasks.assign`, ותפקיד `agent` מחזיק ב-`properties.edit`
       * ואין לו אותה — כלומר בלי השורה הזו הגבול קיים במסך בלבד.
       * הניתוק (`""`) הוא גם הוא העברה, ולכן גם הוא נאכף.
       */
      if (agentUserId !== undefined) {
        assertCanAssignAgents();
        if (agentUserId !== "") {
          await assertAgentInOffice(tx, tenantId, agentUserId);
        }
      }
      const readiness = computeReadiness(mergedFields, {
        hasImages: await this.hasMedia(tx, id),
        hasDescription: Boolean(
          marketingDescription ?? existing.marketingDescription,
        ),
        /*
         * הבעלים שנוצר בעדכון הזה גובר על מה שהיה: `ownerContact`
         * נכתב לרשומה מיד אחרי החישוב, וקריאת העמודה הישנה בלבד
         * הייתה נותנת „חסר בעל הנכס” על עדכון שהרגע הוסיף אותו.
         */
        hasOwner: ownerContact !== null || Boolean(existing.ownerContactId),
      });

      await tx.property.update({
        where: { id },
        data: {
          ...(fieldsToColumns(fieldPatch) as object),
          /*
           * הריקון **אחרי** ה-Patch: שדה שנמצא בשניהם התכוון להיות
           * ריק, ולא לקבל את הערך שהובא לפניו.
           */
          ...Object.fromEntries((clearFields ?? []).map((key) => [key, null])),
          ...(status !== undefined ? { status } : {}),
          ...(marketingTitle !== undefined ? { marketingTitle } : {}),
          ...(marketingDescription !== undefined
            ? { marketingDescription }
            : {}),
          ...(internalNotes !== undefined ? { internalNotes } : {}),
          /* מחרוזת ריקה = ניתוק מכוון; חסר = לא נגעו בשיוך */
          ...(agentUserId === undefined
            ? {}
            : { agentUserId: agentUserId === "" ? null : agentUserId }),
          ...(ownerContact ? { ownerContactId: ownerContact.id } : {}),
          /*
           * `occupantCleared` נבדק בנפרד מ-`occupantContact`: דירה
           * שהתפנתה צריכה דרך להסיר את הדייר, ו„שדה שלא נשלח” אינו
           * יכול לשמש גם ל„בלי שינוי” וגם ל„למחוק”.
           */
          ...(occupantContact ? { occupantContactId: occupantContact.id } : {}),
          ...(occupantCleared === true ? { occupantContactId: null } : {}),
          ...(occupancy === undefined ? {} : { occupancy }),
          ...(leaseEndsAt === undefined
            ? {}
            : { leaseEndsAt: leaseEndsAt === null ? null : new Date(`${leaseEndsAt}T00:00:00Z`) }),
          ...(noticePeriodDays === undefined ? {} : { noticePeriodDays }),
          /*
           * ‎**פרטי חוזה נמחקים כשנאמר במפורש שאין שכירות.**
           *
           * שורה שמצהירה „אין דייר” ונושאת תום חוזה עתידי היא סתירה
           * שהמסך יציג בלי לדעת מה לומר עליה, וכך גם „הדירה התפנתה”
           * שמשאיר את תאריך החוזה שהסתיים.
           *
           * ‎**ו-`null` אינו ברשימה, בכוונה.** ביטול הסימון פירושו
           * „איני יודע”, לא „אין שכירות” — ומחיקת תאריך שהמתווך
           * הקליד על סמך „לא ידוע” היא בדיוק אותה קפיצה למסקנה שכל
           * השדה הזה נועד למנוע.
           */
          ...(occupancy === "owner" || occupancy === "vacant" || occupantCleared === true
            ? { leaseEndsAt: null, noticePeriodDays: null }
            : {}),
          readinessScore: readiness.score,
        },
      });
      // נכס שיצא משיווק — ההתאמות המוצעות מתבטלות; אין להציע נכס שנמכר
      // (ביקורת Codex, PR #1). החלטות ידניות (offered/dismissed) נשמרות כהיסטוריה.
      if (status !== undefined && !["draft", "active"].includes(status)) {
        await this.retireMatches(tx, id);
        // מעבר אמיתי החוצה משיווק — סגירת מעגל מול קונים מעוניינים:
        // Worker יוצר משימות "הצע חלופה" לסוכנים (docs/01 — שום עסקה
        // לא נופלת בין הכיסאות)
        if (["draft", "active"].includes(existing.status)) {
          await this.outbox.emit(tx, "property.delisted", {
            propertyId: id,
            tenantId,
            newStatus: status,
          });
        }
      }
      await this.audit.record(tx, {
        action: "property.update",
        entityType: "property",
        entityId: id,
        metadata: { changedFields: Object.keys(patch) },
      });
      /*
       * ‎**ההעברה נרשמת בנפרד, ועם שני הצדדים.**
       *
       * ‎`changedFields: ["agentUserId"]` אומר שמשהו זז ולא לאן —
       * וזו השאלה שנשאלת אחר כך: „מי העביר את הנכס הזה ומתי”.
       */
      const handover = agentHandover(
        existing.agentUserId,
        agentUserId === undefined ? existing.agentUserId : agentUserId || null,
      );
      if (handover) {
        await this.audit.record(tx, {
          action: "property.agent_changed",
          entityType: "property",
          entityId: id,
          metadata: handover,
        });
      }
      /*
       * **חציית הסף, ולא הימצאות מעליו.** האירוע נפלט עד כה ביצירה
       * בלבד, ולכן נכס שהגיע למוכנות בעריכה לא הפעיל את האוטומציה
       * „נכס הגיע למוכנות” — פער שקדם לשינוי הזה. מרגע שגם תמונה
       * יכולה לחצות את הסף, שלושת המסלולים חייבים לשאול את אותה
       * שאלה; אחרת ההפעלה תלויה במה שבמקרה גרם לחצייה (ביקורת Codex).
       *
       * תנאי החצייה מונע פליטה חוזרת בכל שמירה של נכס שכבר מוכן.
       */
      if (
        existing.readinessScore < PROPERTY_READY_SCORE &&
        readiness.score >= PROPERTY_READY_SCORE
      ) {
        await this.outbox.emit(tx, "property.ready", {
          propertyId: id,
          tenantId,
          readinessScore: readiness.score,
        });
      }
      await this.outbox.emit(tx, "property.updated", {
        propertyId: id,
        tenantId,
        changedFields: Object.keys(patch),
      });
    });

    await this.matching.recomputeForProperty(id, { trigger });
    /*
     * הפרסום ברשת הוא צילום של הנכס, ולכן הוא מזדקן בכל עריכה: מחיר
     * שירד, מועד כניסה שהשתנה, מאפיין שנוסף. משרד אחר שמחליט על סמך
     * צילום ישן מגלה את הפער רק אחרי שהשקיע קונה — וזו בדיוק התקלה
     * שכבר תוקנה בצד הקונה. best-effort: העריכה כבר נשמרה, וכשל
     * זמני בסנכרון אינו הופך אותה ל"נכשלה".
     */
    try {
      await this.listings.resyncForProperty(id);
    } catch {
      // הצילום יתרענן בעריכה הבאה — כמו בחישוב ההתאמות
    }
    return this.getById(id);
  }

  async getById(id: string): Promise<PropertyDto> {
    return this.prisma.withTenant(async (tx) => {
      const row = await tx.property.findFirst({
        where: {
          id,
          tenantId: TenantContext.current().tenantId,
          deletedAt: null,
        },
      });
      if (!row) throw new NotFoundException("נכס לא נמצא");
      const fields = rowToFields(row);
      const readiness = computeReadiness(fields, {
        hasImages: await this.hasMedia(tx, id),
        hasDescription: Boolean(row.marketingDescription),
        hasOwner: Boolean(row.ownerContactId),
      });
      const ownerContact = row.ownerContactId
        ? await this.contacts.getById(tx, row.ownerContactId)
        : null;
      const occupantContact = row.occupantContactId
        ? await this.contacts.getById(tx, row.occupantContactId)
        : null;
      const agents = await agentNames(tx, TenantContext.current().tenantId, [row.agentUserId]);
      const agentName = agentNameOf(agents, row.agentUserId);
      return {
        ...fields,
        id: row.id,
        status: row.status,
        ...(row.agentUserId === null ? {} : { agentUserId: row.agentUserId }),
        ...(agentName === undefined ? {} : { agentName }),
        marketingTitle: row.marketingTitle ?? undefined,
        marketingDescription: row.marketingDescription ?? undefined,
        internalNotes: row.internalNotes ?? undefined,
        /*
         * הציון המחושב ולא העמודה השמורה. השתיים נפרדות: השדות
         * החסרים מחושבים כאן בכל קריאה, והעמודה נכתבת רק בשמירה —
         * ולכן כל שינוי ברשימת שדות החובה (למשל המעבר מ-`entryDate`
         * ל-`entryType`) הותיר נכסים ותיקים עם "0%" מעל השורה
         * "✓ הנכס מוכן לשיווק". סתירה כזו על המסך שוברת את האמון
         * בכל מד אחר במערכת. העמודה נשארת לשאילתות בלבד.
         */
        readinessScore: readiness.score,
        missingFields: readiness.missingFields,
        ...(ownerContact
          ? {
              ownerContact: {
                id: ownerContact.id,
                name: ownerContact.name,
                phone: ownerContact.phone,
                ...(ownerContact.email ? { email: ownerContact.email } : {}),
              },
            }
          : {}),
        ...(occupantContact
          ? {
              occupantContact: {
                id: occupantContact.id,
                name: occupantContact.name,
                phone: occupantContact.phone,
                ...(occupantContact.email ? { email: occupantContact.email } : {}),
              },
            }
          : {}),
        ...(row.occupancy === null ? {} : { occupancy: row.occupancy as OccupancyState }),
        /*
         * תאריך ולא חותמת זמן. העמודה היא `DATE`, ו-Prisma מחזירה
         * אותה כחצות UTC — הפורמט שהמסך מזין בו הוא בדיוק העשרה
         * הראשונים, וזו אינה גזירת „היום” משעון כלשהו אלא קריאה של
         * תאריך שנשמר ככזה.
         */
        ...(row.leaseEndsAt === null
          ? {}
          : { leaseEndsAt: row.leaseEndsAt.toISOString().slice(0, 10) }),
        ...(row.noticePeriodDays === null ? {} : { noticePeriodDays: row.noticePeriodDays }),
        archived: row.deletedAt !== null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });
  }

  async list(query: {
    status?: string;
    city?: string;
    /** כמה ערים בבת אחת — השאלה הקולית "מה יש לי ברמת גן ובגבעתיים" */
    cities?: string[];
    dealType?: string;
    q?: string;
    minPrice?: number;
    maxPrice?: number;
    minRooms?: number;
    maxRooms?: number;
    cursor?: string;
    /**
     * סדר התוצאות — „תמיד תציג מהזול ליקר” של הסוכן. עמוד ראשון
     * בלבד: סמן העימוד (`cursor`) גזור ממיון לפי `id`, והסוכן —
     * הקורא היחיד שמעביר סדר — אינו מעמד. נכס בלי מחיר אחרון.
     */
    order?: "newest" | "price_asc" | "price_desc";
    limit: number;
  }): Promise<Page<PropertyDto>> {
    const price = priceRangeAgorot(query.minPrice, query.maxPrice);
    const rooms = normalizeRange(query.minRooms, query.maxRooms);
    const terms = freeTextTerms(query.q);

    return this.prisma.withTenant(async (tx) => {
      const rows = await tx.property.findMany({
        where: {
          tenantId: TenantContext.current().tenantId,
          deletedAt: null,
          ...(query.status ? { status: query.status } : {}),
          ...(query.city ? { city: query.city } : {}),
          ...(query.cities && query.cities.length > 0
            ? { city: { in: query.cities } }
            : {}),
          ...(query.dealType ? { dealType: query.dealType } : {}),
          ...(price.min !== undefined || price.max !== undefined
            ? {
                priceAgorot: {
                  ...(price.min !== undefined ? { gte: price.min } : {}),
                  ...(price.max !== undefined ? { lte: price.max } : {}),
                },
              }
            : {}),
          ...(rooms.min !== undefined || rooms.max !== undefined
            ? {
                rooms: {
                  ...(rooms.min !== undefined ? { gte: rooms.min } : {}),
                  ...(rooms.max !== undefined ? { lte: rooms.max } : {}),
                },
              }
            : {}),
          /*
           * כל מונח חייב להתאים, וכל אחד יכול להתאים בשדה אחר —
           * כך ש"פנטהאוז רמת גן" מוצא נכס שסוגו פנטהאוז ועירו רמת גן.
           * AND בין המונחים, OR בין השדות; הנימוק המלא ב-list-filters.
           *
           * החיפוש כבר לא מוגבל לכתובת: הוא מכסה גם את הכותרת
           * השיווקית, התיאור, סוג הנכס וההערות הפנימיות — שם יושב
           * מה שהמתווך באמת זוכר על הנכס.
           */
          ...(terms.length > 0
            ? {
                AND: terms.map((term) => ({
                  OR: [
                    /*
                     * סוג הנכס נשמר באנגלית (apartment), והמסך מבטיח
                     * חיפוש בעברית. בלי התרגום הזה "דירה" לא היה
                     * מוצא דירה אלא במקרה, אם המילה הופיעה בשדה טקסט
                     * אחר (ביקורת Codex).
                     */
                    ...(propertyTypesFor(term).length > 0
                      ? [{ propertyType: { in: propertyTypesFor(term) } }]
                      : []),
                    {
                      street: { contains: term, mode: "insensitive" as const },
                    },
                    {
                      neighborhood: {
                        contains: term,
                        mode: "insensitive" as const,
                      },
                    },
                    { city: { contains: term, mode: "insensitive" as const } },
                    {
                      marketingTitle: {
                        contains: term,
                        mode: "insensitive" as const,
                      },
                    },
                    {
                      marketingDescription: {
                        contains: term,
                        mode: "insensitive" as const,
                      },
                    },
                    {
                      internalNotes: {
                        contains: term,
                        mode: "insensitive" as const,
                      },
                    },
                  ],
                })),
              }
            : {}),
          ...(query.cursor ? { id: { lt: query.cursor } } : {}),
        },
        orderBy:
          query.order === "price_asc"
            ? { priceAgorot: { sort: "asc" as const, nulls: "last" as const } }
            : query.order === "price_desc"
              ? { priceAgorot: { sort: "desc" as const, nulls: "last" as const } }
              : { id: "desc" as const }, // ULID ממוין-זמן — חדש ראשון
        take: query.limit + 1,
      });
      const hasMore = rows.length > query.limit;
      const pageRows = rows.slice(0, query.limit);

      // תמונה ראשית לכל נכס בעמוד — שאילתת מדיה אחת; הנתיב מוזרם דרך ה-API
      const media = await tx.propertyMedia.findMany({
        where: {
          tenantId: TenantContext.current().tenantId,
          propertyId: { in: pageRows.map((r) => r.id) },
        },
        orderBy: { sortOrder: "asc" },
        select: { propertyId: true, id: true },
      });
      const primaryIdByProperty = new Map<string, string>();
      for (const m of media) {
        if (!primaryIdByProperty.has(m.propertyId))
          primaryIdByProperty.set(m.propertyId, m.id);
      }

      // מספר הקונים הממתינים לכל נכס — זו הפעולה הבאה שהמתווך מחפש
      // ברשימה ("יש 17 קונים, שלח להם"). שאילתה מקובצת אחת על האינדקס
      // (tenantId, propertyId), לא שאילתה לכל שורה.
      const matchCounts = await tx.match.groupBy({
        by: ["propertyId"],
        where: {
          tenantId: TenantContext.current().tenantId,
          propertyId: { in: pageRows.map((r) => r.id) },
          status: "suggested",
        },
        _count: { _all: true },
      });
      const matchCountByProperty = new Map(
        matchCounts.map((row) => [row.propertyId, row._count._all]),
      );

      /*
       * שם הסוכן — **שאילתה אחת לכל העמוד**, כמו התמונות והמונים
       * שמעליה. שליפה לכל שורה היא N+1 שמתגלה רק כשלמשרד יש מאה
       * נכסים, כלומר בדיוק אצל הסוכנות שהשדה נוסף בשבילה.
       */
      const agents = await agentNames(
        tx,
        TenantContext.current().tenantId,
        pageRows.map((row) => row.agentUserId),
      );

      const items = pageRows.map((row) => {
        const fields = rowToFields(row);
        const agentName = agentNameOf(agents, row.agentUserId);
        const readiness = computeReadiness(fields, {
          // מפת התמונה הראשית כבר עונה על „יש מדיה” — בלי שאילתה נוספת
          hasImages: primaryIdByProperty.has(row.id),
          hasDescription: Boolean(row.marketingDescription),
          hasOwner: Boolean(row.ownerContactId),
        });
        const primaryId = primaryIdByProperty.get(row.id);
        return {
          ...fields,
          id: row.id,
          status: row.status,
          marketingTitle: row.marketingTitle ?? undefined,
          // מחושב ולא שמור — ראו ההסבר ב-getById
          readinessScore: readiness.score,
          missingFields: readiness.missingFields,
          thumbnailUrl: primaryId ? mediaRawPath(row.id, primaryId) : undefined,
          suggestedMatchCount: matchCountByProperty.get(row.id) ?? 0,
          ...(row.agentUserId === null ? {} : { agentUserId: row.agentUserId }),
          ...(agentName === undefined ? {} : { agentName }),
          archived: row.deletedAt !== null,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        } satisfies PropertyDto & {
          thumbnailUrl?: string;
          suggestedMatchCount: number;
        };
      });
      return { items, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
    });
  }

  /**
   * עדכון לבעל הנכס בוואטסאפ (docs/01 — שקיפות): משפך השיווק של הנכס
   * בהודעה אחת — כמה קונים הותאמו, כמה קיבלו הצעה, כמה פתחו וכמה סימנו
   * עניין. המתווך רק לוחץ שלח; ההודעה מתועדת ב-Messages Hub.
   */
  async prepareOwnerUpdate(
    id: string,
  ): Promise<{ waUrl: string; message: string }> {
    const tenantId = TenantContext.current().tenantId;
    return this.prisma.withTenant(async (tx) => {
      const property = await tx.property.findFirst({
        where: { id, tenantId, deletedAt: null },
      });
      if (!property) throw new NotFoundException("נכס לא נמצא");
      if (!property.ownerContactId) {
        throw new NotFoundException(
          "לנכס לא הוגדר בעל נכס — הוסיפו שם וטלפון בעריכת הנכס",
        );
      }
      const owner = await this.contacts.getById(tx, property.ownerContactId);
      if (!owner) throw new NotFoundException("איש הקשר של בעל הנכס לא נמצא");

      // התאמות שהסוכן דחה כלא-רלוונטיות לא נספרות — לא מנפחים את
      // המספר שמדווח למוכר (ביקורת Codex, P1; תואם listForProperty)
      const matches = await tx.match.findMany({
        where: { tenantId, propertyId: id, status: { not: "dismissed" } },
        select: { id: true },
      });
      const offers = await tx.offer.findMany({
        where: { tenantId, matchId: { in: matches.map((m) => m.id) } },
        select: { status: true, openCount: true },
      });
      const opened = offers.filter((o) => o.openCount > 0).length;
      const interested = offers.filter((o) => o.status === "interested").length;

      const title =
        property.marketingTitle ??
        [property.city ?? "", "הנכס"].filter(Boolean).join(" — ");
      const message = [
        `שלום ${owner.name}, עדכון שיווק על "${title}":`,
        `• ${matches.length} קונים מתאימים אותרו במערכת`,
        `• ${offers.length} הצעות נשלחו`,
        `• ${opened} פתחו את פרטי הנכס`,
        `• ${interested} סימנו שהם מעוניינים`,
        "נמשיך לעדכן בכל התקדמות. לשאלות — אפשר להשיב כאן.",
      ].join("\n");

      await this.messaging.recordOutbound(tx, {
        contactId: owner.id,
        channel: "whatsapp",
        provider: "walink",
        body: message,
      });
      await this.audit.record(tx, {
        action: "property.owner_update",
        entityType: "property",
        entityId: id,
      });

      return { waUrl: whatsappLink(owner.phone, message), message };
    });
  }

  /**
   * הורדת ההתאמות של נכס שיצא משיווק — במכירה, בהשכרה או במחיקה רכה.
   *
   * **כל** ההתאמות יורדות, לא רק ה-`suggested`. הסינון הקודם השאיר
   * התאמות במצב `offered` מצביעות על נכס מחוק, והרשימות מסננות
   * `dismissed` בלבד — כלומר הן הופיעו במסך, ובמונה שלידו. מחיקה
   * שלהן הייתה מיותמת הצעה שנשלחה (`offers.match_id`), ולכן הן
   * מסומנות `dismissed`: יוצאות מכל מסך ומכל מונה, וההיסטוריה
   * נשמרת.
   */
  private async retireMatches(tx: TenantTx, propertyId: string): Promise<void> {
    /*
     * ההצעות של ההתאמות הנמחקות יורדות איתן. התאמה במצב `suggested`
     * היא התאמה שלא הוצעה, ולכן בפועל אין כאן מה למחוק — אבל אין FK
     * בין `offers` ל-`matches`, כלומר האינווריאנט נשמר בקוד בלבד,
     * ורגע שבו הוא נשבר משאיר הצעה שמצביעה על התאמה שאיננה.
     */
    const doomed = await tx.match.findMany({
      where: { propertyId, status: "suggested" },
      select: { id: true },
    });
    if (doomed.length > 0) {
      await tx.offer.deleteMany({
        where: { matchId: { in: doomed.map((m) => m.id) } },
      });
    }
    await tx.match.deleteMany({ where: { propertyId, status: "suggested" } });
    await tx.match.updateMany({
      where: { propertyId, status: { not: "dismissed" } },
      data: { status: "dismissed" },
    });
  }

  /**
   * מחיקה לצמיתות — רק מנכס שכבר בארכיון.
   *
   * שני שלבים ולא אחד: נכס פעיל שנמחק בלחיצה אחת הוא היסטוריית
   * שיווק שנעלמת בטעות. מי שמוחק נכס מהארכיון כבר החליט פעם אחת.
   *
   * **ההסכמים מנותקים ולא נמחקים.** הסכם חתום הוא ראיה משפטית ובסיס
   * הזכאות לדמי התיווך — הוא אינו נכס של הנכס. אותו כלל בדיוק כמו
   * במחיקת לקוח.
   *
   * **הפגישות מנותקות ולא נמחקות** — סיור שהתקיים הוא אירוע ביומן
   * של הסוכן.
   *
   * התמונות ב-S3 נמחקות דרך אירועי `storage.cleanup_object`, והמפתחות
   * נאספים לפני מחיקת השורות שמכירות אותם.
   */
  /**
   * מה תמחק המחיקה לצמיתות — **לפני** שמוחקים.
   *
   * התמונות והרשומות של הנכס הן צפויות; כרטיס של אדם אינו. בעלים
   * שהנכס הזה הוא העוגן היחיד שלו יורד עם הנכס, על שמו וטלפוניו,
   * ומתווך שלוחץ „מחיקה לצמיתות” כדי לנקות כפילות אינו מתכוון לזה.
   * אותה גישה בדיוק כמו במסך מחיקת הלקוח — מראים לפני שמאשרים,
   * ולא מסבירים אחרי.
   */
  async purgePreview(id: string): Promise<{ contacts: number }> {
    const { tenantId } = TenantContext.current();
    return this.prisma.withTenant(async (tx) => {
      const property = await tx.property.findFirst({
        where: { id, tenantId },
        select: { ownerContactId: true, occupantContactId: true },
      });
      if (!property) throw new NotFoundException("נכס לא נמצא");
      const candidates = [
        ...new Set(
          [property.ownerContactId, property.occupantContactId].filter(
            (value): value is string => typeof value === "string",
          ),
        ),
      ];
      const orphaned = await Promise.all(
        // ‏`id` מוחרג: השאלה היא מה יישאר **אחרי** המחיקה
        candidates.map((contactId) => isOrphanContact(tx, tenantId, contactId, { propertyId: id })),
      );
      return { contacts: orphaned.filter(Boolean).length };
    });
  }

  /**
   * ‎**מה תגרור המחיקה המרוכזת — לפני האישור.**
   *
   * אותו גילוי כמו במחיקה הבודדת, בצורתו הקבוצתית: כמה כרטיסי אדם
   * יתומים יירדו יחד עם הנכסים שנבחרו. בעלים שהנכס הזה הוא העוגן
   * היחיד שלו יורד עם הנכס, על שמו וטלפוניו — ומתווך שמנקה
   * כפילויות אינו מתכוון לזה.
   *
   * ‎**ההחרגה היא של כל הבחירה, ולא של נכס אחד.** בעלים ששני
   * הנכסים שלו נבחרו היה נענה „יישאר” על החרגה בודדת, בעוד
   * שהמחיקה — שרצה נכס-נכס — כן הייתה מוחקת אותו בסוף. אותה תקלה
   * בדיוק נמצאה במחיקת הקונים המרוכזת (ביקורת Codex), והכלל
   * המשותף כבר יודע לקבל רשימה.
   */
  async bulkDeletionPreview(ids: readonly string[]): Promise<{ contacts: number }> {
    const { tenantId } = TenantContext.current();
    return this.prisma.withTenant(async (tx) => {
      /*
       * ‎**גם נכס שכבר בארכיון — והמסנן שהיה כאן הוא בדיוק הבאג.**
       *
       * ‎`deletedAt: null` נראה סביר („הרשימה מציגה פעילים”), אבל
       * המחיקה המרוכזת **כן** מוחקת נכס שכבר בארכיון: היא מארכבת
       * ומתעלמת מכישלון, ואז מוחקת. נכס שאורכב בלשונית אחרת בין
       * הטעינה לאישור היה נשמט מהתצוגה המקדימה — והאישור היה מודיע
       * „לא יימחקו כרטיסים” בזמן שכרטיסי הבעלים שלו נמחקים
       * (ביקורת Codex, P1).
       *
       * המסלול הבודד מעולם לא סינן כך; זו הייתה סטייה שלי ממנו.
       */
      const rows = await tx.property.findMany({
        where: { id: { in: [...ids] }, tenantId },
        select: { id: true, ownerContactId: true, occupantContactId: true },
      });
      const propertyIds = rows.map((row) => row.id);
      const candidates = [
        ...new Set(
          rows
            .flatMap((row) => [row.ownerContactId, row.occupantContactId])
            .filter((value): value is string => typeof value === "string"),
        ),
      ];
      const orphaned = await Promise.all(
        candidates.map((contactId) =>
          isOrphanContact(tx, tenantId, contactId, { propertyIds }),
        ),
      );
      return { contacts: orphaned.filter(Boolean).length };
    });
  }

  /**
   * מחיקה מרוכזת — ארכיון, או ארכיון ואז מחיקה לצמיתות.
   *
   * ‎**המחיקה לצמיתות עוברת דרך הארכיון ולא במקומו.** `purge` דורש
   * נכס שכבר בארכיון, וזו דרישה נכונה במחיקה בודדת — שם המשתמש
   * רואה את הנכס בארכיון ובוחר למחוק אותו משם. אבל הרשימה שממנה
   * נבחרים הנכסים מציגה **פעילים**, ולכן קריאה ישירה ל-`purge`
   * הייתה נדחית על כל אחד מהם ומדווחת אפס מחיקות בלי הסבר. שני
   * השלבים ברצף שומרים על אותו כלל, בלי להכריח מאתיים לחיצות.
   *
   * נכס שנכשל נספר כ„דולג” ואינו מפיל את השאר: הבחירה יכולה לכלול
   * נכס של עמית, או כזה שכבר נמחק ממסך אחר.
   */
  async removeMany(
    ids: readonly string[],
    permanent: boolean,
  ): Promise<{ removed: number; skipped: number }> {
    let removed = 0;
    let skipped = 0;
    for (const id of ids) {
      try {
        if (permanent) {
          await this.softDelete(id).catch(() => undefined); // כבר בארכיון — תקין
          await this.purge(id);
        } else {
          await this.softDelete(id);
        }
        removed += 1;
      } catch {
        skipped += 1;
      }
    }
    return { removed, skipped };
  }

  async purge(id: string): Promise<void> {
    const ctx = TenantContext.current();
    await this.prisma.withTenant(async (tx) => {
      /*
       * ‎**סדר הנעילות: כרטיסי איש הקשר → שורת הנכס → כל מה שתלוי בו.**
       *
       * שורת הנכס הייתה כאן הפעולה הראשונה בטרנזקציה, וזה היה נכון
       * כל עוד המחיקה לא נגעה בכרטיסים. מהרגע שהיא מוחקת כרטיס יתום
       * היא נוגעת בשני העולמות, וחלה עליה החצי העליון של הסדר
       * (`common/locks.ts`): מחיקת לקוח נועלת קודם את הכרטיס ואז את
       * שורות הנכסים שהיא מנתקת, ולכן מחיקה שתנעל נכס ואז כרטיס
       * סוגרת מעגל מול כל בקשת מחיקה שרצה במקביל.
       *
       * ‎**ומול הנגזרות היא עדיין הראשונה.** המדיה, ההתאמות, ההצעות
       * והנכסים התואמים הם שורות שנתיב אחר נועל **אחרי** שהוא כבר
       * מחזיק את שורת הנכס. נעילה באמצע הרשימה סוגרת מעגל מול כל מה
       * שקדם לה, ולכן היא לפני כולן ולא „לפני המדיה” — כך אין צורך
       * לדעת מראש איזו טבלה מתנגשת עם מי (ביקורת Codex). המסלול
       * פתוח: `MediaService.remove` אינה דוחה נכס בארכיון, וארכיון
       * הוא בדיוק התנאי למחיקה לצמיתות.
       *
       * ‎**הקריאה המקדימה בטוחה כאן, ולא במקרה.** נכס בארכיון אינו
       * ניתן לעריכה (`update` דורשת `deletedAt: null`) ואין מסלול
       * שמחזיר נכס מהארכיון — כלומר הבעלים והדייר של נכס בארכיון
       * קפואים. ובכל זאת החיתוך מול הקריאה הנעולה נשמר למטה, כדי
       * שהכלל „לא נוגעים בכרטיס שאיננו נעול” יהיה מבני ולא נימוק.
       */
      const before = await tx.property.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: { ownerContactId: true, occupantContactId: true },
      });
      // מיון — שתי מחיקות מקבילות שנוגעות באותם שני כרטיסים
      // בסדר הפוך נועלות זו את זו
      const candidates = [
        ...new Set(
          [before?.ownerContactId, before?.occupantContactId].filter(
            (value): value is string => typeof value === "string",
          ),
        ),
      ].sort();
      // ברצף ולא ב-`Promise.all`: המיון קובע סדר רק אם הנעילות
      // נלקחות בו
      const locks = new Map<string, ContactLock>();
      for (const contactId of candidates) {
        locks.set(contactId, await lockContact(tx, contactId));
      }

      await lockProperty(tx, ctx.tenantId, id);
      const existing = await tx.property.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: { deletedAt: true, ownerContactId: true, occupantContactId: true },
      });
      if (!existing) throw new NotFoundException("נכס לא נמצא");
      if (existing.deletedAt === null) {
        throw new BadRequestException(
          "יש להעביר את הנכס לארכיון לפני מחיקה לצמיתות",
        );
      }
      const anchored = [existing.ownerContactId, existing.occupantContactId]
        .filter((value): value is string => typeof value === "string")
        .filter((contactId) => locks.has(contactId));

      // לפני מחיקת השורות — אחריה אין מי שיודע אילו קבצים היו שלו
      const media = await tx.propertyMedia.findMany({
        where: { tenantId: ctx.tenantId, propertyId: id },
        select: { s3Key: true },
      });

      const matchRows = await tx.match.findMany({
        where: { tenantId: ctx.tenantId, propertyId: id },
        select: { id: true },
      });
      const matchIds = matchRows.map((m) => m.id);
      await tx.offer.deleteMany({
        where: { tenantId: ctx.tenantId, matchId: { in: matchIds } },
      });
      await tx.match.deleteMany({
        where: { tenantId: ctx.tenantId, propertyId: id },
      });

      // הצעות שת"פ שהוצעו על הנכס — הצעה על נכס שאיננו היא פנייה
      // שאיש לא יטפל בה
      await deleteCoopDeals(tx, {
        propertyId: id,
        listingTenantId: ctx.tenantId,
      });
      await tx.coopOffer.deleteMany({ where: { propertyId: id } });

      await tx.agreement.updateMany({
        where: { tenantId: ctx.tenantId, propertyId: id },
        data: { propertyId: null },
      });
      /*
       * ‎**סריקות שנחתמו על נייר — מנותקות, לא נמחקות.**
       *
       * ‎`signed_documents.property_id` הוא מזהה חופשי בלי מפתח זר,
       * ולכן מחיקת הנכס לא נגעה בו: הסריקה נשארה מצביעה לשורה שאיננה,
       * והתווית שהמסך בונה ממנה חדלה להיפתר — מזהה אטום על ראיה
       * משפטית (ביקורת Codex).
       *
       * ‎**ניתוק ולא מחיקה**, בדיוק כמו `agreement` שורה מעל: דף חתום
       * הוא בסיס הזכאות לדמי תיווך, ומחיקת רשומת הנכס אינה מבטלת
       * חתימה שכבר נחתמה. מה שנסגר הוא שער ההצעות על אותו נכס — ואין
       * מה לפתוח, הנכס עצמו נמחק.
       */
      await tx.signedDocument.updateMany({
        where: { tenantId: ctx.tenantId, propertyId: id },
        data: { propertyId: null },
      });
      await tx.appointment.updateMany({
        where: { tenantId: ctx.tenantId, propertyId: id },
        data: { propertyId: null },
      });
      await tx.voiceIntake.updateMany({
        where: { tenantId: ctx.tenantId, propertyId: id },
        data: { propertyId: null },
      });
      await tx.notification.deleteMany({
        where: { tenantId: ctx.tenantId, entityType: "property", entityId: id },
      });
      await tx.task.deleteMany({
        where: { tenantId: ctx.tenantId, entityType: "property", entityId: id },
      });

      /*
       * תיק הבלעדיות של הנכס. הפעולות לפני התקופות — הן מצביעות
       * עליהן. בלי זה נשארת בלעדיות "פתוחה" על נכס שאיננו, והיא
       * ממשיכה להופיע בסריקה וברשימה לנצח (ביקורת Codex).
       */
      await tx.marketingAction.deleteMany({
        where: { tenantId: ctx.tenantId, propertyId: id },
      });
      await tx.propertyExclusivity.deleteMany({
        where: { tenantId: ctx.tenantId, propertyId: id },
      });

      /*
       * קישורי הנכסים התואמים — משני הצדדים. קשר שמצביע על נכס
       * שאיננו אינו רק שורה מתה: הוא ממשיך להימנות בתקרה
       * של הנכס שבצד השני, שם הוא גם אינו מוצג ואינו ניתן להסרה.
       */
      const twins = await this.twins.purgeFor(tx, id);

      // property_media לפני properties — מפתח זר RESTRICT
      await tx.propertyMedia.deleteMany({
        where: { tenantId: ctx.tenantId, propertyId: id },
      });
      await tx.property.delete({ where: { id } });

      if (media.length > 0) {
        await tx.outboxEvent.createMany({
          data: media.map((m) => ({
            id: ulid(),
            tenantId: ctx.tenantId,
            name: "storage.cleanup_object",
            payload: { tenantId: ctx.tenantId, s3Key: m.s3Key },
          })),
        });
      }

      /*
       * ‎**הכרטיס שנשאר בלי אף עוגן — אחרי מחיקת השורה, לא לפניה.**
       *
       * בעלים־בלבד מגיעים אליו דרך הנכס ותו לא. ברגע שהשורה נמחקת,
       * כרטיס כזה מפסיק להופיע בכל מסך במערכת — ונשאר במסד עם שם,
       * טלפונים ואימייל. איש במשרד אינו יכול לראות אותו, לתקן אותו,
       * או למחוק אותו לפי בקשה; בקשת מחיקה פרטנית לא הייתה מוצאת
       * אותו, ורק מחיקת המשרד כולו הייתה מגיעה אליו. **מידע אישי
       * שאיש אינו יכול לממש עליו זכות הוא בדיוק מה שאסור להשאיר.**
       *
       * ‎**הבדיקה אחרי `property.delete`, ובהכרח:** לפניה השורה עדיין
       * קיימת, ומבחן היתמות היה מוצא אותה ומחזיר „יש עוגן” על כל
       * כרטיס.
       *
       * הכרטיס שעדיין נגיש — קונה חי, ליד, או נכס אחר — אינו נוגע:
       * `eraseUnreachable` מחזיר `false` והמחיקה ממשיכה כרגיל. וזו
       * הסיבה שהקריאה נעשית על **שני** התפקידים ולא על הבעלים בלבד:
       * שוכר שנרשם בכרטיס נפרד תלוי באותו עוגן יחיד.
       */
      const erasedContacts: string[] = [];
      for (const contactId of anchored) {
        const lock = locks.get(contactId);
        if (lock === undefined) continue;
        if (await this.erasure.eraseUnreachable(tx, ctx.tenantId, lock, "property.purge")) {
          erasedContacts.push(contactId);
        }
      }

      await this.audit.record(tx, {
        action: "property.purge",
        entityType: "property",
        entityId: id,
        metadata: {
          media: media.length,
          matches: matchIds.length,
          twins,
          // כמה כרטיסים ירדו איתו — הראיה שהמחיקה הזו נגעה גם באנשים
          erasedContacts: erasedContacts.length,
        },
      });
    });
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.withTenant(async (tx) => {
      const existing = await tx.property.findFirst({
        where: {
          id,
          tenantId: TenantContext.current().tenantId,
          deletedAt: null,
        },
      });
      if (!existing) throw new NotFoundException("נכס לא נמצא");
      await tx.property.update({
        where: { id },
        data: { deletedAt: new Date(), status: "archived" },
      });
      /*
       * אותו טיפול בדיוק כמו ביציאה משיווק, ולא רק מחיקת ה-`suggested`.
       *
       * מחיקה רכה שהשאירה התאמות `offered` על נכס מחוק הייתה מסתמכת
       * על כך שכל רשימה תסנן אותן בזיכרון — שלושה מקומות שצריכים
       * לזכור, ומונה הניווט שלא זכר. מטפלים במקור.
       */
      await this.retireMatches(tx, id);
      // גם מחיקה רכה היא ירידה משיווק — קונים מעוניינים מקבלים משימת
      // חלופה בדיוק כמו במכירה (ביקורת Codex, PR #21)
      if (["draft", "active"].includes(existing.status)) {
        await this.outbox.emit(tx, "property.delisted", {
          propertyId: id,
          tenantId: TenantContext.current().tenantId,
          newStatus: "archived",
        });
      }
      /*
       * הפרסום ברשת נסגר גם כאן, ולא רק בעריכה.
       *
       * הארכיון קורא ל-`softDelete` ישירות ואינו עובר ב-`update`,
       * ולכן נכס שהמשרד הוריד משיווק נשאר מוצג לרשת: משרדים אחרים
       * ראו אותו, פנו עליו, וקיבלו שקט. **הצילום נסגר בכל מסלול שבו
       * הנכס יורד**, ולא באחד מהם (ביקורת Codex).
       *
       * בתוך הטרנזקציה ולא אחריה: כאן, בניגוד לעריכה, כישלון בלוע
       * משאיר נכס שנמחק גלוי לכל הרשת.
       */
      await this.listings.closeForProperty(tx, id);
      await this.audit.record(tx, {
        action: "property.delete",
        entityType: "property",
        entityId: id,
      });
    });
  }
}
