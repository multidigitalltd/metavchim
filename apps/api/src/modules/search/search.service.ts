import { Injectable } from "@nestjs/common";
import {
  filterVisibleNotes,
  normalizeIsraeliPhone,
  normalizeNameForMatch,
  parseSearchQuery,
  type ParsedSearchQuery,
} from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import {
  ownershipFilter,
  visibleCallsCondition,
  visibleContactIds,
} from "../../common/ownership";
import { CryptoService } from "../../core/crypto.service";
import { PrismaService, type TenantTx } from "../../core/prisma.service";

/**
 * חיפוש גלובלי (docs/06 §3 — "שיחה נכנסת: מי זה?"):
 * - קלט שנראה כטלפון מנורמל ל-E.164 ומחופש ב-phone_hash — התאמה מדויקת
 *   בלי לפענח אף רשומה (docs/04 §4).
 * - טקסט חופשי מחפש נכסים לפי כתובת/כותרת, ואנשי קשר לפי שם.
 *
 * **איך קונה נמצא.** עד כה רק דרך שם הלקוח, ורק אם איש הקשר שלו היה
 * בין 1,000 האחרונים שעודכנו — כלומר חיפוש "תל אביב" החזיר נכסים ואף
 * קונה, ובמשרד עם יותר מאלף אנשי קשר קונים ותיקים נעלמו **בשקט**.
 * שני מסלולים נוספו:
 *
 * 1. **גיבוב השם** (`name_hash`) — התאמה מדויקת בלי פענוח ובלי תקרה,
 *    ולכן שם מלא מוצא את הלקוח בכל גודל מאגר. זה מה שהעמודה נועדה לו.
 * 2. **ערי החיפוש של הקונה** — `cities` אינו מוצפן, ולכן "תל אביב"
 *    מוצא את מי שמחפש שם. זה החיפוש שמתווך באמת עושה.
 *
 * הסריקה המפוענחת נשארת להתאמה חלקית ("דוד" מוצא את "דוד כהן"), עם
 * אותה תקרה — היא כבר לא הדרך היחידה.
 * - קונים ולידים מסוננים לפי בעלות — סוכן עם view_own לא מגלה בחיפוש
 *   את הלקוחות של סוכן אחר (docs/04 §3).
 */

export interface SearchResults {
  /**
   * **קבוצה כלשהי נחתכה בשרת** — „מוצגים הראשונים” ולא „נמצאו N”.
   *
   * כל קבוצה מוגבלת ל-`GROUP_LIMIT`, ובלי הסימן הזה תשובה חתוכה
   * נקראת כרשימה מלאה בשני המסכים — והמתווך מסיק שאין יותר על סמך
   * תקרה שלנו (ביקורת Codex). נשאלת שורה אחת מעבר לתקרה, ולכן
   * הסימן מודד את מה שקיים ולא את מה שהוחזר.
   */
  hasMore: boolean;
  /** זהות בהתאמת-טלפון מדויקת — "מי מתקשר אליי?" */
  contact: { id: string; name: string; phone: string } | null;
  properties: {
    id: string;
    city: string | null;
    street: string | null;
    neighborhood: string | null;
    marketingTitle: string | null;
    status: string;
  }[];
  /*
   * `phone` הוא מה שהמתווך צריך בפועל: התוצאה נועדה להרים טלפון,
   * לא רק לדעת שהלקוח קיים. הוא מסונן באותה בעלות כמו כל השורה,
   * והוא כבר חוזר כך במסלול חיפוש-לפי-טלפון (`contact`).
   */
  buyers: { id: string; name: string; phone?: string; maturity: string; cities: string[] }[];
  leads: { id: string; name: string; phone?: string; status: string; requiresHuman: boolean }[];
  /* --- טקסט חופשי שנכתב בתוך המערכת: לא רק "מי", גם "מה נאמר" --- */
  appointments: { id: string; title: string; kind: string; startsAt: Date; status: string }[];
  tasks: { id: string; title: string; status: string; dueAt: Date | null }[];
  calls: {
    id: string;
    summary: string;
    occurredAt: Date;
    direction: string;
    /** שם הלקוח, כשהחיפוש היה לפי מספר וזהותו ידועה. */
    contactName?: string;
  }[];
  /** הערות ותיעודי שיחה על לידים וקונים. */
  notes: {
    id: string;
    content: string;
    createdAt: Date;
    leadId: string | null;
    buyerId: string | null;
    /**
     * שם הלקוח שההערה נכתבה עליו — **התשובה לשאלה עצמה.**
     *
     * „מי אמר שהוא גמיש בקומה” נענה עד כה ב„הערה — אמר שהוא גמיש
     * בקומה”, כלומר בחזרה על השאלה. `null` רק כשהכרטיס נמחק בינתיים.
     */
    entityLabel: string | null;
  }[];
}

/** תוצאה ריקה — נקודת פתיחה אחת לכל מסלולי החיפוש. */
const EMPTY: SearchResults = {
  hasMore: false,
  contact: null,
  properties: [],
  buyers: [],
  leads: [],
  appointments: [],
  tasks: [],
  calls: [],
  notes: [],
};

const GROUP_LIMIT = 8;
/**
 * נשאלת שורה אחת מעבר לתקרה — **כדי לדעת אם יש עוד.**
 *
 * השוואת אורך התוצאה לתקרה אינה מבחינה בין „בדיוק שמונה” לבין
 * „שמונה מתוך רבים”, ושורה עודפת אחת הופכת את ההבחנה למדידה.
 * היא נחתכת מיד אחרי (`capped`), ולכן אינה מגיעה לאף מסך.
 */
const GROUP_PROBE = GROUP_LIMIT + 1;

/** הקבוצה בגודלה המוצג, והאם נחתכה. */
function capped<T>(rows: T[]): { rows: T[]; more: boolean } {
  return { rows: rows.slice(0, GROUP_LIMIT), more: rows.length > GROUP_LIMIT };
}
/**
 * הערות נשלפות בעודף ומסוננות לפי בעלות אחרי כן (ראו visibleNotes) —
 * בלי העודף, סינון של סוכן עם view_own היה מרוקן את הקבוצה כמעט תמיד.
 */
const NOTE_CANDIDATE_LIMIT = 60;
/** כמה אנשי קשר אחרונים מפוענחים לחיפוש שם — תקרת עלות קבועה לבקשה. */
const NAME_SCAN_LIMIT = 1000;

@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async search(query: string): Promise<SearchResults> {
    const ctx = TenantContext.current();
    const canProperties = ctx.capabilities.has("properties.view");
    const canBuyers =
      ctx.capabilities.has("buyers.view_all") || ctx.capabilities.has("buyers.view_own");
    const canLeads =
      ctx.capabilities.has("leads.view_all") || ctx.capabilities.has("leads.view_own");

    const phone = normalizeIsraeliPhone(query);
    return phone !== undefined
      ? this.searchByPhone(phone, { canProperties, canBuyers, canLeads })
      : this.searchByText(query, { canProperties, canBuyers, canLeads });
  }

  private async searchByPhone(
    phone: string,
    can: { canProperties: boolean; canBuyers: boolean; canLeads: boolean },
  ): Promise<SearchResults> {
    const tenantId = TenantContext.current().tenantId;
    const phoneHash = this.crypto.phoneHash(phone);

    return this.prisma.withTenant(async (tx) => {
      const contact = await tx.contact.findUnique({
        where: { tenantId_phoneHash: { tenantId, phoneHash } },
        select: { id: true, nameEncrypted: true, phoneEncrypted: true },
      });
      if (!contact) return EMPTY;

      const identity = {
        id: contact.id,
        name: this.crypto.decrypt(contact.nameEncrypted),
        phone: this.crypto.decrypt(contact.phoneEncrypted),
      };
      const [properties, buyers, leads] = await Promise.all([
        can.canProperties
          ? tx.property.findMany({
              where: { tenantId, ownerContactId: contact.id, deletedAt: null },
              select: {
                id: true, city: true, street: true, neighborhood: true,
                marketingTitle: true, status: true,
              },
              take: GROUP_PROBE,
            })
          : [],
        can.canBuyers
          ? tx.buyer.findMany({
              where: {
                tenantId,
                contactId: contact.id,
                deletedAt: null,
                ...ownershipFilter("buyers.view_all", "ownerUserId"),
              },
              select: { id: true, maturity: true, cities: true },
              take: GROUP_PROBE,
            })
          : [],
        can.canLeads
          ? tx.lead.findMany({
              where: {
                tenantId,
                contactId: contact.id,
                ...ownershipFilter("leads.view_all", "assignedToUserId"),
              },
              select: { id: true, status: true, requiresHuman: true },
              take: GROUP_PROBE,
            })
          : [],
      ]);

      // זהות איש הקשר נחשפת רק למי שרואה לפחות ישות מקושרת אחת, או
      // לבעל ראייה משרדית (view_all) — משתמש view_own שמחפש טלפון של
      // לקוח של סוכן אחר מקבל "אין תוצאות", בדיוק כמו ברשימות (docs/04 §3).
      const ctx = TenantContext.current();
      const officeWide =
        ctx.capabilities.has("buyers.view_all") || ctx.capabilities.has("leads.view_all");
      const anyVisible = properties.length + buyers.length + leads.length > 0;
      if (!anyVisible && !officeWide) {
        return EMPTY;
      }

      /*
       * שיחות מהמספר הזה — התשובה ל„מי התקשר אליי” כוללת גם את
       * ההיסטוריה של השיחות איתו, לא רק את הכרטיס.
       *
       * דרך אותו שער כמו החיפוש החופשי: השער שמעל („יש לו כרטיס
       * גלוי, או שיש לי גישה משרדית”) קרוב אך אינו זהה לכלל
       * השיחות — `buyers.view_all` לבדה פתחה גם שיחות של ליד שאינו
       * שלי. תנאי אחד לשני המסלולים מסיר את ההשוואה הזו מהתמונה.
       */
      const calls = await this.visibleCalls(tx, tenantId, { contactId: contact.id });

      const shownProperties = capped(properties);
      const shownBuyers = capped(buyers);
      const shownLeads = capped(leads);
      const shownCalls = capped(calls);
      return {
        ...EMPTY,
        hasMore: [shownProperties, shownBuyers, shownLeads, shownCalls].some((g) => g.more),
        contact: identity,
        properties: shownProperties.rows,
        buyers: shownBuyers.rows.map((b) => ({ ...b, name: identity.name })),
        leads: shownLeads.rows.map((l) => ({ ...l, name: identity.name })),
        /*
         * שם הלקוח נלווה לכל שיחה — **הוא ידוע כאן.** בלעדיו השורה
         * מתויגת „שיחה” בזמן שהזהות מוצגת שורה מעליה (ביקורת Codex).
         */
        calls: shownCalls.rows.map((c) => ({
          ...c,
          summary: c.summary ?? "",
          contactName: identity.name,
        })),
      };
    });
  }

  private async searchByText(
    query: string,
    can: { canProperties: boolean; canBuyers: boolean; canLeads: boolean },
  ): Promise<SearchResults> {
    const tenantId = TenantContext.current().tenantId;
    const needle = query.toLowerCase();

    /*
     * "קונים 4 חדרים בני ברק" — שאילתה שעד כה החזירה כלום, כי המחרוזת
     * השלמה חופשה בשמות ובכתובות ולא נמצאה. הפרסור מפריד אותה
     * לאילוצים (ישות, חדרים, עיר, תקציב) ולשארית טקסטואלית, והשארית
     * ממשיכה בדיוק במסלול הקודם — שאילתה רגילה מתנהגת כשהייתה.
     */
    const parsed = parseSearchQuery(query);
    const needleText = parsed.structured ? parsed.rest.toLowerCase() : needle;
    const textForMatch = parsed.structured ? parsed.rest : query;

    return this.prisma.withTenant(async (tx) => {
      // "דיזנגוף 10 תל אביב" — כל מילה חייבת להופיע באחד משדות הכתובת
      // (AND על מילים, OR על שדות), כולל מספר בית; עד 5 מילים.
      const tokens = textForMatch.split(/\s+/u).filter((t) => t.length > 0).slice(0, 5);

      // ישות מבוקשת מדירה את האחרות: "קונים ..." לא יחזיר נכסים
      const wantsProperties = parsed.entity === undefined || parsed.entity === "properties";
      const wantsBuyers = parsed.entity === undefined || parsed.entity === "buyers";
      const wantsLeads = parsed.entity === undefined || parsed.entity === "leads";

      const properties =
        can.canProperties && wantsProperties
          ? await tx.property.findMany({
              where: {
                tenantId,
                deletedAt: null,
                ...(parsed.city !== undefined
                  ? { city: { contains: parsed.city, mode: "insensitive" as const } }
                  : {}),
                ...(parsed.dealType !== undefined ? { dealType: parsed.dealType } : {}),
                ...this.roomsFilter(parsed),
                ...this.priceFilter(parsed),
                AND: tokens.map((token) => ({
                  OR: [
                    { city: { contains: token, mode: "insensitive" as const } },
                    { street: { contains: token, mode: "insensitive" as const } },
                    { neighborhood: { contains: token, mode: "insensitive" as const } },
                    { houseNumber: { contains: token, mode: "insensitive" as const } },
                    { marketingTitle: { contains: token, mode: "insensitive" as const } },
                  ],
                })),
              },
              select: {
                id: true, city: true, street: true, neighborhood: true,
                marketingTitle: true, status: true,
              },
              orderBy: { updatedAt: "desc" },
              take: GROUP_PROBE,
            })
          : [];

      /*
       * טקסט חופשי שנכתב בתוך המערכת: כותרות ופתקים ביומן, משימות,
       * סיכומי שיחות והערות. אלה לא מכילים PII מוצפן, ולכן אפשר לחפש
       * בהם ישירות במסד. משימות מסוננות לבעליהן — סוכן לא רואה את
       * המשימות של סוכן אחר בחיפוש (docs/04 §3).
       */
      const { userId } = TenantContext.current();
      /*
       * הטקסט החופשי מחופש בשארית ולא בשאילתה המלאה: "קונים 4 חדרים
       * בני ברק" כמחרוזת שלמה לא מופיע באף פתק. כששאילתה מובְנית לא
       * הותירה שארית, אין מה לחפש כאן בכלל והקבוצות נשארות ריקות.
       */
      const searchesFreeText = textForMatch.trim().length > 0;
      const like = { contains: textForMatch, mode: "insensitive" as const };
      /*
       * בלי שארית טקסטואלית אין מה לחפש כאן — ו-`contains: ""` מתאים
       * ל**כל** שורה במשרד. עד כה ארבע השאילתות רצו בכל מקרה ותוצאתן
       * נזרקה מיד; מלבד העלות, זה מה שאפשר לקיטום של קבוצה שאינה
       * מוצגת לזלוג לתשובה (ביקורת Codex).
       */
      const [appointments, tasks, calls, notes] = !searchesFreeText
        ? [[], [], [], []]
        : await Promise.all([
        tx.appointment.findMany({
          where: { tenantId, OR: [{ title: like }, { notes: like }] },
          select: { id: true, title: true, kind: true, startsAt: true, status: true },
          orderBy: { startsAt: "desc" },
          take: GROUP_PROBE,
        }),
        tx.task.findMany({
          where: {
            tenantId,
            assignedToUserId: userId,
            OR: [{ title: like }, { notes: like }],
          },
          select: { id: true, title: true, status: true, dueAt: true },
          orderBy: { createdAt: "desc" },
          take: GROUP_PROBE,
        }),
        this.visibleCalls(tx, tenantId, { text: textForMatch }),
        /*
         * מועמדים בלבד — הסינון לפי בעלות נעשה מיד אחרי, ולכן שולפים
         * יותר מהתקרה כדי שלא נישאר עם רשימה ריקה אחרי הסינון.
         */
        tx.interaction.findMany({
          where: { tenantId, content: like },
          select: { id: true, content: true, createdAt: true, leadId: true, buyerId: true },
          orderBy: { createdAt: "desc" },
          take: NOTE_CANDIDATE_LIMIT,
        }),
      ]);

      const visibleNotes = searchesFreeText ? await this.visibleNotes(tx, tenantId, notes) : [];
      const shownAppointments = capped(appointments);
      const shownTasks = capped(tasks);
      const shownCalls = capped(calls);
      const shownNotes = capped(visibleNotes);
      const shownProperties = capped(properties);
      const freeText = searchesFreeText
        ? {
            appointments: shownAppointments.rows.map((a) => ({ ...a, title: a.title ?? "פגישה" })),
            tasks: shownTasks.rows,
            calls: shownCalls.rows.map((c) => ({ ...c, summary: c.summary ?? "" })),
            notes: await this.labelNotes(tx, tenantId, shownNotes.rows),
          }
        : { appointments: [], tasks: [], calls: [], notes: [] };
      /**
       * האם קבוצה כלשהי נחתכה — **רק מבין אלה שבאמת מוצגות.**
       *
       * שאילתה מובְנית בלי שארית („קונים 4 חדרים בבני ברק”) אינה
       * מציגה את קבוצות הטקסט החופשי כלל, וספירת הקיטום שלהן הייתה
       * הופכת כל משרד עם יותר משמונה פגישות ל„יש עוד קונים” — טענה
       * על קבוצה שכן מוצגת, ושקרית לגביה (ביקורת Codex).
       */
      const truncated = searchesFreeText
        ? [shownProperties, shownAppointments, shownTasks, shownCalls, shownNotes]
        : [shownProperties];

      if (!can.canBuyers && !can.canLeads) {
        return {
          ...EMPTY,
          hasMore: truncated.some((g) => g.more),
          properties: shownProperties.rows,
          ...freeText,
        };
      }

      /*
       * שלושה מסלולים לאיתור אנשי קשר, ומאוחדים למפה אחת:
       *
       * 1. **גיבוב השם** — התאמה מדויקת, בלי פענוח ו**בלי תקרה**. זה
       *    מה שמבטיח ששם מלא נמצא גם במאגר של עשרות אלפים.
       * 2. סריקה מפוענחת של האחרונים — להתאמה חלקית ("דוד" ⟵ "דוד
       *    כהן"). חסומה ב-NAME_SCAN_LIMIT, כי כאן משלמים בפענוח.
       *
       * PII לעולם אינו נחשף למנוע ה-DB כטקסט גלוי בשני המסלולים.
       */
      const nameById = new Map<string, string>();
      /** אותו מפתח כמו `nameById` — המספר להרמת טלפון מהתוצאה. */
      const phoneById = new Map<string, string>();
      if (searchesFreeText) {
        const exact = await tx.contact.findMany({
          where: { tenantId, nameHash: this.crypto.nameHash(normalizeNameForMatch(textForMatch)) },
          select: { id: true, nameEncrypted: true, phoneEncrypted: true },
          take: GROUP_LIMIT * 4,
        });
        const recent = await tx.contact.findMany({
          where: { tenantId },
          select: { id: true, nameEncrypted: true, phoneEncrypted: true },
          orderBy: { updatedAt: "desc" },
          take: NAME_SCAN_LIMIT,
        });
        for (const c of exact) {
          nameById.set(c.id, this.crypto.decrypt(c.nameEncrypted));
          phoneById.set(c.id, this.crypto.decrypt(c.phoneEncrypted));
        }
        for (const c of recent) {
          if (nameById.has(c.id)) continue;
          const name = this.crypto.decrypt(c.nameEncrypted);
          if (!name.toLowerCase().includes(needleText)) continue;
          nameById.set(c.id, name);
          phoneById.set(c.id, this.crypto.decrypt(c.phoneEncrypted));
        }
      }
      const matchedIds = [...nameById.keys()];

      /*
       * **3. ערי החיפוש של הקונה.**
       *
       * `cities` אינו מוצפן, ולכן הוא נשאל ישירות — וזה החיפוש שמתווך
       * באמת עושה: "מי מחפש בתל אביב". `hasSome` הוא התאמה מדויקת של
       * איבר במערך, ולכן נשלחים גם הביטוי המלא (שמות ערים דו-מיליים
       * כמו "תל אביב") וגם המילים הבודדות.
       */
      const cityTerms = [...new Set([textForMatch.trim(), ...tokens])].filter((t) => t.length >= 2);

      /*
       * שני סוגי תנאים, והם מתנהגים אחרת לגמרי:
       *
       * - **אילוצים מובְנים** (עיר מזוהה, חדרים, תקציב, סוג עסקה) הם
       *   AND: "קונים 4 חדרים בני ברק" חייב לקיים את שלושתם.
       * - **טקסט חופשי** הוא OR בין שם הלקוח לערי החיפוש, כמו קודם.
       *
       * הצירוף הזה הוא מה שגורם לשאילתה לעבוד: בלי האילוצים כ-AND
       * היו חוזרים כל הקונים בבני ברק בלי קשר לחדרים, ובלי ה-OR
       * לטקסט חופשי "כהן" היה מפסיק למצוא את מר כהן.
       */
      const structuredBuyer = {
        ...(parsed.city !== undefined ? { cities: { has: parsed.city } } : {}),
        ...(parsed.dealType !== undefined ? { dealType: parsed.dealType } : {}),
        ...this.buyerRoomsFilter(parsed),
        ...this.buyerBudgetFilter(parsed),
      };
      const hasStructured = Object.keys(structuredBuyer).length > 0;

      const freeTextOr = [
        ...(matchedIds.length > 0 ? [{ contactId: { in: matchedIds } }] : []),
        ...(searchesFreeText && cityTerms.length > 0
          ? [{ cities: { hasSome: cityTerms } }]
          : []),
      ];

      const buyerWhere = {
        tenantId,
        deletedAt: null,
        ...ownershipFilter("buyers.view_all", "ownerUserId"),
        ...structuredBuyer,
        ...(freeTextOr.length > 0 ? { OR: freeTextOr } : {}),
      };
      // בלי תנאי כלשהו לא מחזירים את כל המשרד — "אין מה לחפש"
      const buyerQueryable = hasStructured || freeTextOr.length > 0;

      const [buyers, leads] = await Promise.all([
        can.canBuyers && wantsBuyers && buyerQueryable
          ? tx.buyer.findMany({
              where: buyerWhere,
              select: { id: true, maturity: true, cities: true, contactId: true },
              orderBy: { updatedAt: "desc" },
              take: GROUP_PROBE,
            })
          : [],
        can.canLeads && wantsLeads && matchedIds.length > 0
          ? tx.lead.findMany({
              where: {
                tenantId,
                contactId: { in: matchedIds },
                ...ownershipFilter("leads.view_all", "assignedToUserId"),
              },
              select: { id: true, status: true, requiresHuman: true, contactId: true },
              take: GROUP_PROBE,
            })
          : [],
      ]);

      /*
       * קונה שנמצא לפי עיר — שם הלקוח שלו לא עבר במפה, ולכן הוא
       * מפוענח כאן. אלה בודדים (עד GROUP_LIMIT), ובלי זה התוצאה הייתה
       * שורה בלי שם.
       */
      const missing = buyers.map((b) => b.contactId).filter((id) => !nameById.has(id));
      if (missing.length > 0) {
        const extra = await tx.contact.findMany({
          where: { tenantId, id: { in: [...new Set(missing)] } },
          select: { id: true, nameEncrypted: true, phoneEncrypted: true },
        });
        for (const c of extra) {
          nameById.set(c.id, this.crypto.decrypt(c.nameEncrypted));
          phoneById.set(c.id, this.crypto.decrypt(c.phoneEncrypted));
        }
      }

      const shownBuyers = capped(buyers);
      const shownLeads = capped(leads);
      return {
        ...EMPTY,
        hasMore: [...truncated, shownBuyers, shownLeads].some((g) => g.more),
        properties: shownProperties.rows,
        ...freeText,
        buyers: shownBuyers.rows.map((b) => ({
          id: b.id,
          maturity: b.maturity,
          cities: b.cities,
          name: nameById.get(b.contactId) ?? "",
          ...(phoneById.has(b.contactId) ? { phone: phoneById.get(b.contactId)! } : {}),
        })),
        leads: shownLeads.rows.map((l) => ({
          id: l.id,
          status: l.status,
          requiresHuman: l.requiresHuman,
          name: nameById.get(l.contactId) ?? "",
          ...(phoneById.has(l.contactId) ? { phone: phoneById.get(l.contactId)! } : {}),
        })),
      };
    });
  }

  /* ---------- תרגום האילוצים המפורסרים לתנאי Prisma ---------- */

  /** חדרי הנכס בתוך הטווח המבוקש. */
  private roomsFilter(parsed: ParsedSearchQuery): Record<string, unknown> {
    if (parsed.rooms === undefined) return {};
    return {
      rooms: {
        ...(parsed.rooms.min !== undefined ? { gte: parsed.rooms.min } : {}),
        ...(parsed.rooms.max !== undefined ? { lte: parsed.rooms.max } : {}),
      },
    };
  }

  /** מחיר הנכס בתוך טווח התקציב. */
  private priceFilter(parsed: ParsedSearchQuery): Record<string, unknown> {
    if (parsed.budget === undefined) return {};
    return {
      priceAgorot: {
        ...(parsed.budget.minAgorot !== undefined ? { gte: parsed.budget.minAgorot } : {}),
        ...(parsed.budget.maxAgorot !== undefined ? { lte: parsed.budget.maxAgorot } : {}),
      },
    };
  }

  /**
   * **חפיפה** בין הטווח המבוקש לטווח שהקונה מחפש, ולא הכלה.
   *
   * קונה שרשום "3 עד 5 חדרים" הוא תשובה נכונה ל"קונים 4 חדרים" — הוא
   * ייקח דירה כזו. בדיקת הכלה הייתה מחזירה רק את מי שרשום בדיוק 4—4,
   * כלומר מסתירה את רוב המאגר. טווח פתוח מצד אחד (roomsMax ריק) נחשב
   * כאינסוף ולכן מותר, ומטופל ב-null.
   */
  private buyerRoomsFilter(parsed: ParsedSearchQuery): Record<string, unknown> {
    if (parsed.rooms === undefined) return {};
    const conditions: Record<string, unknown>[] = [];
    if (parsed.rooms.max !== undefined) {
      conditions.push({ OR: [{ roomsMin: null }, { roomsMin: { lte: parsed.rooms.max } }] });
    }
    if (parsed.rooms.min !== undefined) {
      conditions.push({ OR: [{ roomsMax: null }, { roomsMax: { gte: parsed.rooms.min } }] });
    }
    return conditions.length > 0 ? { AND: conditions } : {};
  }

  /**
   * תקציב הקונה מול הסכום בשאילתה.
   *
   * "קונים עד 2 מיליון" = מי שהתקציב שלו אינו עולה על 2 מיליון, ולכן
   * ההשוואה היא מול budgetMaxAgorot — השדה שמייצג כמה הוא מוכן לשלם.
   */
  private buyerBudgetFilter(parsed: ParsedSearchQuery): Record<string, unknown> {
    if (parsed.budget === undefined) return {};
    return {
      budgetMaxAgorot: {
        ...(parsed.budget.minAgorot !== undefined ? { gte: parsed.budget.minAgorot } : {}),
        ...(parsed.budget.maxAgorot !== undefined ? { lte: parsed.budget.maxAgorot } : {}),
      },
    };
  }

  /**
   * סינון הערות ותיעודים לפי בעלות. ההערות עצמן אינן נושאות בעלים —
   * הן תלויות בליד או בקונה שאליו הן מקושרות, ולכן הנראות נגזרת משם,
   * בדיוק כמו ב-listInteractions (docs/04 §3).
   *
   * בלי זה סוכן עם view_own היה מוצא בחיפוש חופשי הערות על הלקוחות של
   * סוכן אחר — וזה בדיוק המידע המסחרי הרגיש ביותר במערכת (תקציב,
   * מניעים, מצב מו"מ).
   */
  /**
   * שם הלקוח לכל הערה — **אחרי סינון הנראות, לא לפניו.**
   *
   * הסדר אינו סגנון: `visibleNotes` כבר צמצמה לשמונה הערות שהמשתמש
   * רשאי לראות, ולכן כאן נפתחים רק הכרטיסים שלהן. פענוח לפני הסינון
   * היה מפענח שמות של לקוחות שהמשתמש אינו רשאי לראות בכלל — עלות
   * מיותרת, וגרוע מכך, PII שנפתח בלי סיבה.
   *
   * שלוש שאילתות חסומות בגודלן (‏≤8 הערות): הליד/הקונה למזהה
   * הכרטיס, והכרטיסים לשמות. שדה יחס אינו קיים בסכימה, ולכן
   * ‎`contactId` נשלף במפורש.
   */
  private async labelNotes(
    tx: TenantTx,
    tenantId: string,
    notes: {
      id: string;
      content: string;
      createdAt: Date;
      leadId: string | null;
      buyerId: string | null;
    }[],
  ): Promise<SearchResults["notes"]> {
    const leadIds = [...new Set(notes.map((n) => n.leadId).filter((id): id is string => id !== null))];
    const buyerIds = [...new Set(notes.map((n) => n.buyerId).filter((id): id is string => id !== null))];
    if (leadIds.length === 0 && buyerIds.length === 0) {
      return notes.map((note) => ({ ...note, entityLabel: null }));
    }

    const [leads, buyers] = await Promise.all([
      leadIds.length > 0
        ? tx.lead.findMany({
            where: { tenantId, id: { in: leadIds } },
            select: { id: true, contactId: true },
          })
        : [],
      buyerIds.length > 0
        ? tx.buyer.findMany({
            where: { tenantId, id: { in: buyerIds } },
            select: { id: true, contactId: true },
          })
        : [],
    ]);

    const contactIds = [...new Set([...leads, ...buyers].map((row) => row.contactId))];
    const contacts =
      contactIds.length > 0
        ? await tx.contact.findMany({
            where: { tenantId, id: { in: contactIds } },
            select: { id: true, nameEncrypted: true },
          })
        : [];
    const nameByContact = new Map(
      contacts.map((c) => [c.id, this.crypto.decrypt(c.nameEncrypted)] as const),
    );
    const nameByLead = new Map(
      leads.map((l) => [l.id, nameByContact.get(l.contactId) ?? null] as const),
    );
    const nameByBuyer = new Map(
      buyers.map((b) => [b.id, nameByContact.get(b.contactId) ?? null] as const),
    );

    return notes.map((note) => ({
      ...note,
      entityLabel:
        (note.buyerId === null ? null : (nameByBuyer.get(note.buyerId) ?? null)) ??
        (note.leadId === null ? null : (nameByLead.get(note.leadId) ?? null)),
    }));
  }

  /**
   * שיחות שהתקציר שלהן מכיל את הטקסט — **ורק כאלה שמותר לו לראות.**
   *
   * השאילתה כאן שלפה לפי `tenantId` בלבד, בזמן שיומן השיחות מסנן
   * לפי בעלות. פעולת `search` דורשת `properties.view`, ולכן סוכן
   * בלי גישה משרדית ללידים ולקונים יכול היה לחפש ביטוי מתוך שיחה
   * של סוכן אחר ולקבל את התקציר שלה — בפאנל ובוואטסאפ כאחד
   * (ביקורת Codex, P1). התנאי אינו נכתב כאן מחדש: הוא מיובא מאותו
   * מקום שהיומן משתמש בו.
   *
   * SQL גולמי לבחירת מזהים ואז שליפה ב-Prisma — אותו דפוס בדיוק
   * כמו ב-`CallsService.list`, מפני שענף היתומה דורש `NOT EXISTS`.
   * זה אינו מעקף RLS: `withTenant` פתחה טרנזקציה עם `app.tenant_id`,
   * והשאילתה רצה בתוכה.
   */
  private async visibleCalls(
    tx: TenantTx,
    tenantId: string,
    /** לפי תקציר (חיפוש חופשי) או לפי לקוח („מי התקשר אליי”) */
    match: { text: string } | { contactId: string },
  ): Promise<{ id: string; summary: string | null; occurredAt: Date; direction: string }[]> {
    const select = { id: true, summary: true, occurredAt: true, direction: true } as const;
    const visible = await visibleContactIds(tx, tenantId);
    const { userId } = TenantContext.current();
    const allowed = await tx.$queryRaw<{ id: string }[]>`
      SELECT c.id
        FROM calls c
       WHERE ${visibleCallsCondition(tenantId, userId, visible)}
         AND (${"text" in match ? match.text : null}::text IS NULL
              OR c.summary ILIKE '%' || ${"text" in match ? match.text : null} || '%')
         AND (${"contactId" in match ? match.contactId : null}::char(26) IS NULL
              OR c.contact_id = ${"contactId" in match ? match.contactId : null})
       ORDER BY c.occurred_at DESC
       LIMIT ${GROUP_PROBE}
    `;
    if (allowed.length === 0) return [];
    return tx.call.findMany({
      where: { tenantId, id: { in: allowed.map((row) => row.id) } },
      select,
      orderBy: { occurredAt: "desc" },
      take: GROUP_PROBE,
    });
  }

  private async visibleNotes(
    tx: TenantTx,
    tenantId: string,
    candidates: {
      id: string;
      content: string;
      createdAt: Date;
      leadId: string | null;
      buyerId: string | null;
    }[],
  ): Promise<typeof candidates> {
    const ctx = TenantContext.current();
    const seesAllLeads = ctx.capabilities.has("leads.view_all");
    const seesAllBuyers = ctx.capabilities.has("buyers.view_all");
    if (seesAllLeads && seesAllBuyers) return candidates.slice(0, GROUP_PROBE);

    const leadIds = [...new Set(candidates.map((n) => n.leadId).filter((id): id is string => id !== null))];
    const buyerIds = [...new Set(candidates.map((n) => n.buyerId).filter((id): id is string => id !== null))];

    const [leads, buyers] = await Promise.all([
      leadIds.length > 0
        ? tx.lead.findMany({
            where: {
              tenantId,
              id: { in: leadIds },
              ...ownershipFilter("leads.view_all", "assignedToUserId"),
            },
            select: { id: true },
          })
        : [],
      buyerIds.length > 0
        ? tx.buyer.findMany({
            where: {
              tenantId,
              id: { in: buyerIds },
              deletedAt: null,
              ...ownershipFilter("buyers.view_all", "ownerUserId"),
            },
            select: { id: true },
          })
        : [],
    ]);
    return filterVisibleNotes(
      candidates,
      { leadIds: new Set(leads.map((l) => l.id)), buyerIds: new Set(buyers.map((b) => b.id)) },
      GROUP_PROBE,
    );
  }
}