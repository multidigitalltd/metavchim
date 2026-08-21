import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import {
  agentAction,
  jerusalemDayRange,
  type BuyerRequirements,
  type PropertyFields,
} from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { GeminiService } from "../../core/gemini.service";
import { AnalyticsService, type ReportWindowDays } from "../analytics/analytics.service";
import { AgentResolveService } from "./resolve.service";
import { BuyersService } from "../buyers/buyers.service";
import { CalendarService } from "../calendar/calendar.service";
import { CallsService } from "../calls/calls.service";
import { DealRoomService } from "../collaboration/deal-room.service";
import { LeadsService } from "../leads/leads.service";
import { MatchingService } from "../matching/matching.service";
import { PropertiesService } from "../properties/properties.service";
import { SearchService } from "../search/search.service";
import { TasksService } from "../tasks/tasks.service";

/**
 * ביצוע — **דרך אותם שירותים שהטפסים הידניים משתמשים בהם.**
 *
 * ## למה לא כתיבה ישירה למסד
 *
 * `PropertiesService.create` אינו רק INSERT: הוא מחשב ציון מוכנות,
 * רושם ביומן הביקורת, פולט אירוע ל-outbox ומריץ את מנוע ההתאמות.
 * מסלול קליטה שעוקף אותו מייצר רשומות שנראות תקינות ומתנהגות אחרת
 * — נכס שלא מופיע בהתאמות, ליד בלי ציר זמן, פעולה שאינה ביומן.
 *
 * הסוכן הוא **ממשק** אל המערכת, לא מערכת שנייה לצדה.
 *
 * ## למה ההרשאה נבדקת גם כאן
 *
 * הבקר כבר נושא `@RequireCapability`, אבל היכולת שם היא של הנתיב
 * (`/agent/execute`) ולא של הפעולה שבתוכו. הפעולה נבחרת מהגוף של
 * הבקשה, ולכן הבדיקה האמיתית היא זו — מול הקטלוג, לפי מה שהתבקש
 * בפועל.
 */

export interface ExecuteResult {
  /** לאן לנווט אחרי הביצוע */
  href?: string;
  message: string;
  /** תוצאות לשאילתה — מוצגות במקום, בלי ניווט */
  data?: unknown;
  /**
   * משפט-שניים של תובנה על התוצאות — לא רשימה, מסקנה. המספרים
   * מגיעים מהנתונים שכבר נשלפו; המודל רק מנסח. אופציונלי: בלי
   * Gemini, או כשהניסוח נכשל, הרשימה עומדת בפני עצמה.
   */
  insight?: string;
}

@Injectable()
export class AgentExecuteService {
  constructor(
    private readonly leads: LeadsService,
    private readonly buyers: BuyersService,
    private readonly properties: PropertiesService,
    private readonly tasks: TasksService,
    private readonly calendar: CalendarService,
    private readonly matching: MatchingService,
    private readonly search: SearchService,
    private readonly calls: CallsService,
    private readonly analytics: AnalyticsService,
    private readonly dealRooms: DealRoomService,
    private readonly resolver: AgentResolveService,
    private readonly gemini: GeminiService,
  ) {}

  async execute(
    actionId: string,
    params: Record<string, unknown>,
    /** המשפט המקורי — לניסוח התובנה על תוצאות שאילתה בלבד */
    transcript?: string,
  ): Promise<ExecuteResult> {
    const action = agentAction(actionId);
    if (!action) throw new BadRequestException("פעולה לא מוכרת");

    /*
     * השער האמיתי. הפעולה מגיעה מגוף הבקשה, ולכן היכולת שהנתיב
     * מצהיר עליה אינה מספיקה — היא של הנתיב, לא של מה שהתבקש בו.
     */
    const ctx = TenantContext.current();
    if (!ctx.capabilities.has(action.capability)) {
      throw new ForbiddenException(`אין לך הרשאה ל${action.title}`);
    }

    /*
     * ביטוי זהות בלי מזהה נפתר כאן, רגע לפני הביצוע — זה מה שמאפשר
     * לצעד המשך של שרשור ("תוסיף קונה משה ותוסיף לו הערה") למצוא
     * את הרשומה שהצעד הקודם יצר זה עתה. ריבוי התאמות או היעדר —
     * שגיאה ברורה, לא ניחוש.
     */
    const resolution = await this.resolver.resolveForExecution(actionId, params);
    if (!resolution.ok) throw new BadRequestException(resolution.message);

    const result = await this.dispatch(actionId, params);
    return this.withInsight(actionId, transcript, result);
  }

  private async dispatch(
    actionId: string,
    params: Record<string, unknown>,
  ): Promise<ExecuteResult> {
    switch (actionId) {
      case "search":
        return this.doSearch(params);
      case "find_buyers":
        return this.findBuyers(params);
      case "find_properties":
        return this.findProperties(params);
      case "show_matches":
        return this.showMatches(params);
      case "show_schedule":
        return this.showSchedule(params);
      case "show_tasks":
        return this.showTasks();
      case "show_calls":
        return this.showCalls();
      case "show_deals":
        return this.showDeals();
      case "office_report":
        return this.officeReport(params);
      case "create_lead":
        return this.createLead(params);
      case "create_buyer":
        return this.createBuyer(params);
      case "create_property":
        return this.createProperty(params);
      case "create_task":
        return this.createTask(params);
      case "schedule_appointment":
        return this.createAppointment(params);
      case "update_buyer":
        return this.updateBuyer(params);
      case "update_property":
        return this.updateProperty(params);
      case "complete_task":
        return this.completeTask(params);
      case "add_note":
        return this.addNote(params);
      case "update_lead_status":
        return this.updateLeadStatus(params);
      case "share_property":
        return this.shareProperty(params);
      case "share_buyer":
        return this.shareBuyer(params);
      case "send_offer":
        return this.sendOffer(params);
      default:
        throw new BadRequestException("פעולה לא מוכרת");
    }
  }

  /**
   * תובנה מסכמת על תוצאות שאילתה — מסקנה, לא רשימה.
   *
   * "מי מחפש 4 חדרים בגבעתיים?" מחזיר טבלה; מה שהמתווך באמת רוצה
   * לדעת הוא "יש שלושה, ואחד מהם חם ובלי סיור". הנתונים כבר נשלפו
   * ע"י הקוד — המודל רק קורא אותם ומנסח משפט. הוא אינו מקבל גישה
   * למסד ואינו יכול להמציא רשומות; לכל היותר ינסח רע, והרשימה
   * המלאה מוצגת מתחתיו בכל מקרה.
   *
   * best-effort במופגן: בלי מפתח, על שגיאה או על תשובה ריקה —
   * התוצאה חוזרת בלי תובנה ולא נכשלת. שאילתה שעבדה אינה נופלת
   * בגלל פסקת הסיכום שלה.
   */
  private async withInsight(
    actionId: string,
    transcript: string | undefined,
    result: ExecuteResult,
  ): Promise<ExecuteResult> {
    if (!INSIGHT_ACTIONS.has(actionId)) return result;
    if (result.data === undefined || transcript === undefined) return result;
    try {
      if (!(await this.gemini.isConfigured())) return result;
      // קיצוץ קשיח: המודל צריך את ראש הרשימה, לא את כל המאגר
      const compact = JSON.stringify(result.data).slice(0, 6000);
      const raw = await this.gemini.generateStructured(
        [
          'אתה עוזר של מתווך נדל"ן. המתווך שאל:',
          `"${transcript.replaceAll('"', "'")}"`,
          "",
          "אלו התוצאות שהמערכת שלפה (JSON, ייתכן קטוע):",
          compact,
          "",
          "כתוב משפט אחד או שניים בעברית שמסכמים את התובנה החשובה למתווך — כמה נמצאו, מה בולט, מה כדאי לעשות. אל תמציא נתונים שאינם ב-JSON. אם אין מה להוסיף מעבר לרשימה עצמה — החזר insight ריק.",
        ].join("\n"),
        {
          type: "object",
          properties: { insight: { type: "string" } },
        },
      );
      const insight =
        typeof (raw as { insight?: unknown })?.insight === "string"
          ? ((raw as { insight: string }).insight ?? "").trim()
          : "";
      return insight === "" || insight.length > 500 ? result : { ...result, insight };
    } catch {
      return result;
    }
  }

  // --- שאילתות ---

  private async doSearch(params: Record<string, unknown>): Promise<ExecuteResult> {
    const query = str(params["query"]);
    if (query === undefined) throw new BadRequestException("לא נאמר מה לחפש");
    return {
      href: `/search?q=${encodeURIComponent(query)}`,
      message: `מחפש „${query}”`,
      data: await this.search.search(query),
    };
  }

  private async findBuyers(params: Record<string, unknown>): Promise<ExecuteResult> {
    const cities = strList(params["cities"]);
    const rooms = { min: num(params["roomsMin"]), max: num(params["roomsMax"]) };
    const page = await this.buyers.list({
      limit: 50,
      ...(cities.length > 0 ? { cities } : {}),
      ...(rooms.min !== undefined ? { minRooms: rooms.min } : {}),
      ...(rooms.max !== undefined ? { maxRooms: rooms.max } : {}),
      /*
       * נשאלו חדרים ⇒ רק מי שהצהיר עליהם. קונה בלי מספר חדרים עובר
       * כל טווח בסינון הרגיל, ולכן הופיע בתשובה כאילו הוא „מחפש 4
       * חדרים” — בזמן שפשוט לא ידוע מה הוא מחפש.
       */
      ...(rooms.min !== undefined || rooms.max !== undefined
        ? { roomsDeclaredOnly: true }
        : {}),
      ...(num(params["budgetMinShekels"]) !== undefined
        ? { minPrice: num(params["budgetMinShekels"])! }
        : {}),
      ...(num(params["budgetMaxShekels"]) !== undefined
        ? { maxPrice: num(params["budgetMaxShekels"])! }
        : {}),
      /*
       * נשאל תקציב ⇒ התקרה המוצהרת קובעת, כמו roomsDeclaredOnly:
       * "עד 3 מיליון" לא יחזיר קונה עם תקציב 3.6 (דיווח המשתמש) —
       * חפיפת הטווחים של מסך הסינון אינה תשובה לשאלה ישירה.
       */
      ...(num(params["budgetMinShekels"]) !== undefined ||
      num(params["budgetMaxShekels"]) !== undefined
        ? { budgetDeclaredOnly: true }
        : {}),
    });
    return {
      message:
        page.items.length === 0
          ? "לא נמצאו קונים שמתאימים לקריטריונים"
          : `נמצאו ${page.items.length} קונים`,
      data: {
        hasMore: page.nextCursor !== null,
        buyers: page.items.map((buyer) => ({
          id: buyer.id,
          name: buyer.contact.name,
          cities: buyer.requirements.cities,
          maturity: buyer.maturity,
          ...(buyer.requirements.roomsMin !== undefined
            ? { roomsMin: buyer.requirements.roomsMin }
            : {}),
          ...(buyer.requirements.roomsMax !== undefined
            ? { roomsMax: buyer.requirements.roomsMax }
            : {}),
          ...(buyer.requirements.budgetMaxAgorot !== undefined
            ? { budgetMaxAgorot: buyer.requirements.budgetMaxAgorot }
            : {}),
        })),
      },
    };
  }

  private async findProperties(params: Record<string, unknown>): Promise<ExecuteResult> {
    const cities = strList(params["cities"]);
    const must = strList(params["mustFeatures"]);
    const page = await this.properties.list({
      limit: 50,
      ...(cities.length > 0 ? { cities } : {}),
      ...(str(params["dealType"]) !== undefined ? { dealType: str(params["dealType"])! } : {}),
      ...(num(params["roomsMin"]) !== undefined ? { minRooms: num(params["roomsMin"])! } : {}),
      ...(num(params["roomsMax"]) !== undefined ? { maxRooms: num(params["roomsMax"])! } : {}),
      ...(num(params["priceMinShekels"]) !== undefined
        ? { minPrice: num(params["priceMinShekels"])! }
        : {}),
      ...(num(params["priceMaxShekels"]) !== undefined
        ? { maxPrice: num(params["priceMaxShekels"])! }
        : {}),
    });
    /*
     * ערים וסוג עסקה מסוננים **בשאילתה** — סינון בזיכרון על עמוד של
     * חמישים היה ממלא את העמוד בנכסים מעיר אחרת ומחזיר תשובה חסרה
     * (ביקורת Codex). המאפיינים לבדם מסוננים כאן: `list` אינו מקבל
     * אותם, והם שדות boolean שרובם ממולאים — חמישים שורות בזיכרון
     * זולות משינוי חוזה משותף.
     */
    const items = page.items.filter((property) =>
      must.every((key) => (property as unknown as Record<string, unknown>)[key] === true),
    );
    return {
      message: items.length === 0 ? "אין נכסים שעונים על התנאים" : `נמצאו ${items.length} נכסים`,
      data: {
        hasMore: page.nextCursor !== null,
        properties: items.map((p) => ({
          id: p.id,
          title: p.marketingTitle ?? [p.street, p.city].filter(Boolean).join(", "),
          city: p.city,
          rooms: p.rooms,
          priceAgorot: p.priceAgorot,
          status: p.status,
        })),
      },
    };
  }

  private async showMatches(params: Record<string, unknown>): Promise<ExecuteResult> {
    const propertyId = str(params["propertyId"]);
    const buyerId = str(params["buyerId"]);
    const refresh = params["refresh"] === true;

    if (propertyId !== undefined) {
      if (refresh) await this.matching.recomputeForProperty(propertyId);
      return {
        href: `/properties/${propertyId}`,
        message: refresh ? "ההתאמות חושבו מחדש" : "ההתאמות של הנכס",
        data: await this.matching.listForProperty(propertyId),
      };
    }
    if (buyerId !== undefined) {
      if (refresh) await this.matching.recomputeForBuyer(buyerId);
      return {
        href: `/buyers/${buyerId}`,
        message: refresh ? "ההתאמות חושבו מחדש" : "ההתאמות של הקונה",
        data: await this.matching.listForBuyer(buyerId),
      };
    }
    return {
      href: "/matches",
      message: "ההתאמות של המשרד",
      // אותו סף שמסך ההתאמות מציג — תשובה של הסוכן לא אמורה לכלול
      // התאמות שהמסך מסתיר, אחרת שתי דרכים לשאול נותנות שתי תשובות
      data: await this.matching.listAll({ limit: 50, minScore: 50 }),
    };
  }

  /**
   * "מה יש לי ביומן" — היום שנפתר מהתמלול, ואם לא נאמר יום — היום.
   * הטווח מחושב בשעון ירושלים, כמו כל תאריך במערכת.
   */
  private async showSchedule(params: Record<string, unknown>): Promise<ExecuteResult> {
    const anchor = date(params["day"]) ?? new Date();
    const { start, end } = jerusalemDayRange(anchor);
    const appointments = await this.calendar.list({ from: start, to: end });
    const dayLabel = new Intl.DateTimeFormat("he-IL", {
      timeZone: "Asia/Jerusalem",
      dateStyle: "full",
    }).format(anchor);
    return {
      href: "/calendar",
      message:
        appointments.length === 0
          ? `אין פגישות ב${dayLabel}`
          : `${appointments.length} פגישות ב${dayLabel}`,
      data: {
        appointments: appointments.map((a) => ({
          id: a.id,
          kind: a.kind,
          ...(a.title !== undefined ? { title: a.title } : {}),
          startsAt: a.startsAt,
          status: a.status,
        })),
      },
    };
  }

  private async showTasks(): Promise<ExecuteResult> {
    const tasks = await this.tasks.list({ status: "open" });
    return {
      href: "/tasks",
      message: tasks.length === 0 ? "אין משימות פתוחות" : `${tasks.length} משימות פתוחות`,
      data: {
        tasks: tasks.map((t) => ({
          id: t.id,
          title: t.title,
          ...(t.dueAt !== undefined && t.dueAt !== null ? { dueAt: t.dueAt } : {}),
          ...(t.entityLabel !== undefined ? { entityLabel: t.entityLabel } : {}),
        })),
      },
    };
  }

  private async showCalls(): Promise<ExecuteResult> {
    const calls = await this.calls.list({ limit: 20 });
    return {
      href: "/calls",
      message: calls.length === 0 ? "אין שיחות אחרונות" : `${calls.length} שיחות אחרונות`,
      data: {
        calls: calls.map((c) => ({
          id: c.id,
          direction: c.direction,
          ...(c.contactName !== undefined ? { contactName: c.contactName } : {}),
          ...(c.phone !== undefined ? { phone: c.phone } : {}),
          occurredAt: c.occurredAt,
          outcome: c.outcome,
          ...(c.summary !== undefined ? { summary: c.summary } : {}),
        })),
      },
    };
  }

  private async showDeals(): Promise<ExecuteResult> {
    const deals = await this.dealRooms.list();
    return {
      href: "/collaboration?tab=deals",
      message: deals.length === 0 ? "אין עסקאות משותפות" : `${deals.length} עסקאות משותפות`,
      data: {
        deals: deals.map((d) => ({
          id: d.id,
          title: d.title,
          stage: d.stage,
          counterpartOffice: d.counterpartOffice,
          lastActivityAt: d.lastActivityAt,
        })),
      },
    };
  }

  private async officeReport(params: Record<string, unknown>): Promise<ExecuteResult> {
    // הקטלוג מדבר במחרוזות enum; השירות מקבל 30 | 90 | 365
    const raw = Number(str(params["windowDays"]) ?? "30");
    const windowDays: ReportWindowDays = raw === 90 ? 90 : raw === 365 ? 365 : 30;
    return {
      href: "/reports",
      message: "דוח המשרד",
      data: { report: await this.analytics.officeStats(windowDays) },
    };
  }

  // --- יצירה ---

  private async createLead(params: Record<string, unknown>): Promise<ExecuteResult> {
    const name = str(params["name"]);
    const phone = str(params["phone"]);
    if (name === undefined || phone === undefined) {
      throw new BadRequestException("ליד דורש שם וטלפון");
    }
    const result = await this.leads.create({
      contactName: name,
      contactPhone: phone,
      // המקור האמיתי: המתווך תיעד שיחה, לא מילא טופס
      source: "voice_call",
      intent: str(params["intent"]) ?? "info",
      ...(str(params["summary"]) !== undefined ? { summary: str(params["summary"])! } : {}),
    });
    return {
      /*
       * ליד שמוזג לליד קיים של סוכן אחר אינו גלוי למי שקלט אותו,
       * וניווט אליו היה מסתיים ב-403. במקרה כזה חוזרים לרשימה.
       */
      href: result.visible ? `/leads/${result.id}` : "/leads",
      message: result.merged ? "הפנייה צורפה לליד קיים" : "הליד נוצר",
    };
  }

  private async createBuyer(params: Record<string, unknown>): Promise<ExecuteResult> {
    const name = str(params["name"]);
    const phone = str(params["phone"]);
    if (name === undefined || phone === undefined) {
      throw new BadRequestException("כרטיס קונה דורש שם וטלפון");
    }
    const buyer = await this.buyers.create({
      contactName: name,
      contactPhone: phone,
      source: "voice",
      requirements: this.buyerRequirements(params),
      ...(str(params["maturity"]) !== undefined ? { maturity: str(params["maturity"])! } : {}),
      ...(str(params["financing"]) !== undefined ? { financing: str(params["financing"])! } : {}),
      ...(str(params["agentNotes"]) !== undefined
        ? { agentNotes: str(params["agentNotes"])! }
        : {}),
    });
    return { href: `/buyers/${buyer.id}`, message: "כרטיס הקונה נוצר" };
  }

  private async createProperty(params: Record<string, unknown>): Promise<ExecuteResult> {
    const fields = this.propertyFields(params);
    const ownerName = str(params["ownerName"]);
    const ownerPhone = str(params["ownerPhone"]);
    const property = await this.properties.create({
      fields,
      ...(buildTitle(fields) === undefined ? {} : { marketingTitle: buildTitle(fields)! }),
      ...(str(params["marketingDescription"]) !== undefined
        ? { marketingDescription: str(params["marketingDescription"])! }
        : {}),
      /*
       * בעל הנכס נקשר רק כששני הפרטים קיימים: `findOrCreateByPhone`
       * מזהה אדם לפי הטלפון, ושם בלי טלפון היה יוצר איש קשר חדש בכל
       * קליטה — כלומר כפילויות במקום קישור.
       */
      ...(ownerName !== undefined && ownerPhone !== undefined
        ? { owner: { name: ownerName, phone: ownerPhone } }
        : {}),
    });
    return { href: `/properties/${property.id}`, message: "הנכס נקלט" };
  }

  private async createTask(params: Record<string, unknown>): Promise<ExecuteResult> {
    const title = str(params["title"]);
    if (title === undefined) throw new BadRequestException("לתזכורת דרושה כותרת");
    const dueAt = date(params["dueAt"]);
    await this.tasks.create({
      title,
      ...(dueAt ? { dueAt } : {}),
    });
    return {
      href: "/tasks",
      message: dueAt ? "התזכורת נוצרה — תישלח התראה במועד" : "המשימה נוצרה",
    };
  }

  private async createAppointment(params: Record<string, unknown>): Promise<ExecuteResult> {
    const startsAt = date(params["startsAt"]);
    if (!startsAt) throw new BadRequestException("לא זוהה מועד לפגישה");
    const appointment = await this.calendar.create({
      kind: str(params["kind"]) ?? "meeting",
      startsAt,
      durationMinutes: 60,
      ...(str(params["notes"]) !== undefined ? { notes: str(params["notes"])! } : {}),
      ...(str(params["propertyId"]) !== undefined
        ? { propertyId: str(params["propertyId"])! }
        : {}),
      ...(str(params["buyerId"]) !== undefined ? { buyerId: str(params["buyerId"])! } : {}),
    });
    return { href: `/calendar`, message: "הפגישה נקבעה", data: { id: appointment.id } };
  }

  // --- עדכון ---

  private async updateBuyer(params: Record<string, unknown>): Promise<ExecuteResult> {
    const buyerId = str(params["buyerId"]);
    if (buyerId === undefined) throw new BadRequestException("לא נבחר קונה לעדכון");
    /*
     * מיזוג עם הקיים ולא החלפה.
     *
     * „משה כהן העלה את התקציב לשלושה מיליון” מזכיר שדה אחד. שליחת
     * `requirements` שנבנה מהמשפט בלבד הייתה **מוחקת** את הערים,
     * החדרים והמאפיינים שכבר בכרטיס — עדכון שנראה מוצלח ומוחק את
     * רוב הביקוש בשקט.
     */
    const existing = await this.buyers.getById(buyerId);
    const patch = this.buyerRequirements(params, existing.requirements);
    const buyer = await this.buyers.update(buyerId, {
      requirements: patch,
      ...(str(params["maturity"]) !== undefined ? { maturity: str(params["maturity"])! } : {}),
      ...(str(params["financing"]) !== undefined ? { financing: str(params["financing"])! } : {}),
      ...(str(params["agentNotes"]) !== undefined
        ? { agentNotes: str(params["agentNotes"])! }
        : {}),
    });
    return { href: `/buyers/${buyer.id}`, message: "הכרטיס עודכן" };
  }

  private async updateProperty(params: Record<string, unknown>): Promise<ExecuteResult> {
    const propertyId = str(params["propertyId"]);
    if (propertyId === undefined) throw new BadRequestException("לא נבחר נכס לעדכון");
    // רק מה שנאמר — `update` הוא patch, ושדה שלא נאמר אינו נשלח
    const property = await this.properties.update(propertyId, {
      ...this.propertyFields(params),
      ...(str(params["status"]) !== undefined ? { status: str(params["status"])! } : {}),
      ...(str(params["marketingDescription"]) !== undefined
        ? { marketingDescription: str(params["marketingDescription"])! }
        : {}),
    });
    return { href: `/properties/${property.id}`, message: "הנכס עודכן" };
  }

  private async completeTask(params: Record<string, unknown>): Promise<ExecuteResult> {
    const taskId = str(params["taskId"]);
    if (taskId === undefined) throw new BadRequestException("לא נבחרה משימה");
    await this.tasks.update(taskId, { status: "done" });
    return { href: "/tasks", message: "המשימה סומנה כבוצעה" };
  }

  /**
   * הערה — לקונה או לליד, לפי מה שנבחר.
   *
   * המזהה מגיע מהחיפוש בצורה `kind:id`, כי "הכרטיס של שרה" יכול
   * להיות שניהם והבחירה היא של המתווך. אצל ליד ההערה היא אינטראקציה
   * בציר הזמן; אצל קונה — צירוף להערות הסוכן, עם חותמת תאריך.
   */
  private async addNote(params: Record<string, unknown>): Promise<ExecuteResult> {
    const cardId = str(params["cardId"]);
    const note = str(params["note"]);
    if (cardId === undefined) throw new BadRequestException("לא נבחר כרטיס");
    if (note === undefined) throw new BadRequestException("לא נאמר תוכן ההערה");

    const [kind, id] = cardId.split(":", 2);
    if (kind === "lead" && id !== undefined) {
      await this.leads.addNote(id, note);
      return { href: `/leads/${id}`, message: "ההערה נוספה לליד" };
    }
    if (kind === "buyer" && id !== undefined) {
      const existing = await this.buyers.getById(id);
      const stamp = new Intl.DateTimeFormat("he-IL", {
        timeZone: "Asia/Jerusalem",
        dateStyle: "short",
      }).format(new Date());
      const merged = [existing.agentNotes, `[${stamp}] ${note}`]
        .filter((part): part is string => typeof part === "string" && part !== "")
        .join("\n");
      await this.buyers.update(id, { agentNotes: merged });
      return { href: `/buyers/${id}`, message: "ההערה נוספה לכרטיס הקונה" };
    }
    throw new BadRequestException("כרטיס לא מזוהה");
  }

  private async updateLeadStatus(params: Record<string, unknown>): Promise<ExecuteResult> {
    const leadId = str(params["leadId"]);
    if (leadId === undefined) throw new BadRequestException("לא נבחר ליד");
    const status = str(params["leadStatus"]);
    if (status === undefined) throw new BadRequestException("לא נאמר סטטוס");
    await this.leads.updateStatus(leadId, status);
    return { href: `/leads/${leadId}`, message: "סטטוס הליד עודכן" };
  }

  /**
   * שיתוף ברשת — ניווט למסך השיתוף, לא פרסום.
   *
   * הפרסום לרשת חושף את הכרטיס למשרדים אחרים, והחשיפה עצמה נשארת
   * לחיצה מפורשת במסך שמראה בדיוק מה ישותף. הסוכן מזהה את הכרטיס
   * ומביא את המתווך לשם — כמו `send_offer`.
   */
  private async shareProperty(params: Record<string, unknown>): Promise<ExecuteResult> {
    const propertyId = str(params["propertyId"]);
    if (propertyId === undefined) throw new BadRequestException("לא נבחר נכס לשיתוף");
    return {
      href: `/properties/${propertyId}?tab=network`,
      message: "בחרו מה לחשוף ושתפו — הפרסום לרשת נעשה מהכרטיס",
    };
  }

  private async shareBuyer(params: Record<string, unknown>): Promise<ExecuteResult> {
    const buyerId = str(params["buyerId"]);
    if (buyerId === undefined) throw new BadRequestException("לא נבחר קונה לשיתוף");
    return {
      href: `/buyers/${buyerId}?tab=network`,
      message: "בחרו מה לחשוף ושתפו — הפרסום לרשת נעשה מהכרטיס",
    };
  }

  /**
   * שליחת הצעה — לא מכאן.
   *
   * ההצעה נשלחת מתוך התאמה קיימת (`OffersService.createFromMatch`),
   * כי היא נושאת את הציון, את סיבת ההתאמה ואת מה שהלקוח יראה.
   * יצירת הצעה יש-מאין מהסוכן הייתה עוקפת את זה ושולחת ללקוח מסמך
   * בלי הקשר. לכן הסוכן מזהה את הצדדים ומעביר למסך האישור, שם
   * המתווך רואה את ההתאמה ולוחץ.
   */
  private async sendOffer(params: Record<string, unknown>): Promise<ExecuteResult> {
    const buyerId = str(params["buyerId"]);
    if (buyerId === undefined) throw new BadRequestException("לא נבחר לקוח לשליחה");
    const propertyId = str(params["propertyId"]);
    return {
      href: propertyId === undefined ? `/buyers/${buyerId}` : `/properties/${propertyId}`,
      message: "בחרו את ההתאמה ושלחו — השליחה ללקוח נעשית מהכרטיס",
    };
  }

  // --- המרות ---

  /**
   * שדות הסוכן ⟵ `BuyerRequirements`.
   *
   * `base` הוא הביקוש הקיים בעדכון, ו-`undefined` ביצירה. ההפרדה
   * הזאת היא ההבדל בין „הוסיף גם גבעתיים” לבין „מחק את כל השאר”.
   */
  private buyerRequirements(
    params: Record<string, unknown>,
    base?: BuyerRequirements,
  ): BuyerRequirements {
    const features: Record<string, "must" | "nice"> = { ...(base?.features ?? {}) };
    for (const key of strList(params["mustFeatures"])) features[key] = "must";
    for (const key of strList(params["niceFeatures"])) features[key] = "nice";

    const cities = strList(params["cities"]);
    const neighborhoods = strList(params["neighborhoods"]);
    const propertyTypes = strList(params["propertyTypes"]);
    const entryBy = date(params["entryBy"]);

    return {
      cities: cities.length > 0 ? cities : (base?.cities ?? []),
      neighborhoods: neighborhoods.length > 0 ? neighborhoods : (base?.neighborhoods ?? []),
      searchAreas: base?.searchAreas ?? [],
      dealType: (str(params["dealType"]) as "sale" | "rent" | undefined) ??
        base?.dealType ??
        "sale",
      propertyTypes: (propertyTypes.length > 0
        ? propertyTypes
        : (base?.propertyTypes ?? [])) as BuyerRequirements["propertyTypes"],
      features,
      ...pick(base, "budgetMinAgorot", agorot(params["budgetMinShekels"])),
      ...pick(base, "budgetMaxAgorot", agorot(params["budgetMaxShekels"])),
      ...pick(base, "roomsMin", num(params["roomsMin"])),
      ...pick(base, "roomsMax", num(params["roomsMax"])),
      ...pick(base, "areaSqmMin", num(params["areaSqmMin"])),
      ...pick(
        base,
        "entryType",
        str(params["entryNeed"]) as BuyerRequirements["entryType"] | undefined,
      ),
      ...pick(base, "entryBy", entryBy),
      ...(base?.flexibilityNotes !== undefined
        ? { flexibilityNotes: base.flexibilityNotes }
        : {}),
    };
  }

  /** שדות הסוכן ⟵ `PropertyFields`. רק מה שנאמר. */
  private propertyFields(params: Record<string, unknown>): PropertyFields {
    const fields: Record<string, unknown> = {};
    for (const key of [
      "city",
      "neighborhood",
      "street",
      "houseNumber",
      "propertyType",
      "dealType",
      "condition",
      "entryType",
      "entryNote",
    ]) {
      const value = str(params[key]);
      if (value !== undefined) fields[key] = value;
    }
    for (const key of ["rooms", "areaSqm", "floor", "totalFloors"]) {
      const value = num(params[key]);
      if (value !== undefined) fields[key] = value;
    }
    for (const key of [
      "hasElevator",
      "hasParking",
      "hasBalcony",
      "hasSafeRoom",
      "hasStorage",
      "priceFlexible",
      "exclusive",
    ]) {
      if (typeof params[key] === "boolean") fields[key] = params[key];
    }
    const price = agorot(params["priceShekels"]);
    if (price !== undefined) fields["priceAgorot"] = price;
    const entryDate = date(params["entryDate"]);
    if (entryDate) fields["entryDate"] = entryDate;
    return fields as PropertyFields;
  }
}

// --- קריאה בטוחה מ-`unknown` ---

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function date(value: unknown): Date | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/** שקלים ⟵ אגורות. כסף הוא מספר שלם, תמיד. */
function agorot(value: unknown): number | undefined {
  const shekels = num(value);
  return shekels === undefined ? undefined : Math.round(shekels * 100);
}

/**
 * הערך החדש, ואם אין — הקיים. שדה שאיש לא נגע בו נשאר כפי שהיה,
 * ושדה שמעולם לא היה נשאר חסר ולא הופך ל-`undefined` מפורש.
 */
function pick<T extends object, K extends keyof T>(
  base: T | undefined,
  key: K,
  incoming: T[K] | undefined,
): Partial<Pick<T, K>> {
  const value = incoming ?? base?.[key];
  return value === undefined ? {} : ({ [key]: value } as Partial<Pick<T, K>>);
}

function buildTitle(fields: PropertyFields): string | undefined {
  if (fields.rooms === undefined || fields.city === undefined) return undefined;
  return `דירת ${fields.rooms} חדרים ב${fields.city}${fields.neighborhood ? `, ${fields.neighborhood}` : ""}`;
}

/**
 * הפעולות שמקבלות תובנה מסכמת — שאילתות עם תוצאות להשוואה. יומן
 * ומשימות של יום אחד אינם כאן: הרשימה שם קצרה וקריאה בעצמה, ומשפט
 * סיכום עליה הוא רעש.
 */
const INSIGHT_ACTIONS = new Set([
  "search",
  "find_buyers",
  "find_properties",
  "show_matches",
  "office_report",
]);
