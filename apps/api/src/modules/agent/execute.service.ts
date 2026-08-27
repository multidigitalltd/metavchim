import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import {
  AGENT_ACTIONS,
  MARKETING_ACTION_KINDS,
  MARKETING_ACTION_LABEL,
  agentNextSteps,
  jerusalemWallParts,
  type MarketingActionKind,
  agentAction,
  AGENT_RESULT_LABEL_MAX,
  jerusalemDayRange,
  mayUseAction,
  pendingMissedCalls,
  rankCallbacks,
  type AgentHistoryRef,
  type BuyerRequirements,
  type CallbackCandidate,
  type PropertyFields,
} from "@metavchim/shared";
import { isCardAccessible } from "../../common/ownership";
import { TenantContext } from "../../common/tenant-context";
import { PrismaService } from "../../core/prisma.service";
import { GeminiService } from "../../core/gemini.service";
import { AgentEventsService } from "./agent-events.service";
import { AgreementsService } from "../agreements/agreements.service";
import { ExclusivityService } from "../exclusivity/exclusivity.service";
import { ContactsService } from "../contacts/contacts.service";
import { AnalyticsService, type ReportWindowDays } from "../analytics/analytics.service";
import { AgentResolveService } from "./resolve.service";
import { BuyersService } from "../buyers/buyers.service";
import { CalendarService } from "../calendar/calendar.service";
import type { Readable } from "node:stream";
import { CallsService, type CallDto } from "../calls/calls.service";
import { DealRoomService } from "../collaboration/deal-room.service";
import { LeadsService } from "../leads/leads.service";
import { MATCH_LIST_LIMIT, MatchingService } from "../matching/matching.service";
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

/**
 * חלון החזרות — חייב להיות זהה לזה שב-`pendingMissedCalls`.
 *
 * הוא מוזרק לשאילתה כאן וגם משמש שם לסינון; שני מספרים שונים היו
 * מייצרים שיחות שנשלפו ונזרקו, או להפך — חלון שהשאילתה מקצרת.
 */
const MISSED_CALL_WINDOW_DAYS = 14;
/**
 * תקרת הלידים הממתינים.
 *
 * זו התקרה היחידה שנשארה, והיא חותכת את **החדשים**: `openAwaitingResponse`
 * ממיינת מהוותיק, כלומר מה שנופל מעבר לה הוא הפחות דחוף. השיחות אינן
 * מוגבלות כלל — שם התקרה הסירה בשקט לקוחות שממתינים, ולכן הוחלפה
 * בשאילתה שמחזירה שורה אחת לאיש קשר (ביקורת Codex).
 */
const CALLBACK_LEAD_SCAN = 500;
/** אותו היגיון, על המשימות הפתוחות שקשורות ללידים בלבד. */
const CALLBACK_TASK_SCAN = 500;

/**
 * הפניה לרשומה שהפעולה נגעה בה — **חתוכה לאותו גבול כמו שורת תוצאה.**
 *
 * ‎`InterpretSchema` בבקר מגביל תווית ל-`AGENT_RESULT_LABEL_MAX`, ולכן
 * שם ארוך או כותרת שיווקית ארוכה לא היו „פשוט ארוכים”: הם היו מפילים
 * את **הבקשה הבאה** כולה ב-400, כלומר תור שלם נעלם בגלל אורך של שם.
 *
 * החיתוך הוא בלי „…” — בדיוק כמו התווית הנשמרת של שורת תוצאה. הסימן
 * שובר גם את הגיבוב וגם את ‎`includes`‎ בחיפוש, ותווית שאינה נמצאת
 * באף מסלול גרועה מתווית מקוצרת.
 *
 * תווית ריקה אינה הפניה: הוולידציה דורשת תו אחד לפחות, ואיש אינו
 * מצביע על רשומה בשם ריק.
 *
 * מחזירה אובייקט לפרישה (`...refOf(...)`) ולא ערך, כדי שהקוראים לא
 * ייבנו את התנאי בכל אתר מחדש.
 */
function refOf(
  label: string | undefined | null,
  entityType: AgentHistoryRef["entityType"],
  entityId: string,
): { ref?: AgentHistoryRef } {
  const trimmed = (label ?? "").trim();
  if (trimmed === "" || entityId === "") return {};
  return { ref: { label: trimmed.slice(0, AGENT_RESULT_LABEL_MAX), entityType, entityId } };
}

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
  /**
   * צעד המשך מוצע — משפט פקודה שהמתווך יכול לומר עכשיו ("קבע סיור
   * לראשון מהם"). תצוגה בלבד: לחיצה עליו שולחת אותו לאותו מסלול
   * הבנה⟵אישור כמו כל משפט, שום דבר אינו מבוצע ישירות.
   *
   * ‎**מקורו נגזר, ורק בהיעדר כלל — מנוסח.** `agentNextSteps`
   * מחשב אותו מהתוצאה שכבר חזרה, בלי קריאה למודל ובלי חיתוך;
   * ההצעה מהמודל נשארת כרשת ביטחון לפעולות שאין להן כלל. ראו
   * ‎`next-step.ts` — שם גם הסיבה שהסדר הזה ולא ההפוך.
   */
  suggestion?: string;
  /**
   * הקלטה שאפשר להשמיע — **הפניה, לא בייטים**.
   *
   * הזרם עצמו אינו נכנס לתשובת ה-API: כל ערוץ מביא אותו בדרכו
   * (`AgentExecuteService.recording`). במסך זו הפניה לנגן; בוואטסאפ
   * הודעת שמע אמיתית, כדי שהמתווך ישמע את הלקוח בלי לפתוח דשבורד.
   */
  audio?: { callId: string; label: string };
  /**
   * הרשומה ש**הפעולה עצמה נגעה בה** — ההקשר של „אליו” בתור הבא.
   *
   * שורות של שאילתה כבר מייצרות הפניות (`agentResultRefs`), אבל הן
   * נגזרות מרשימה. יצירה, עדכון וכרטיס בודד אינם רשימה, ולכן דווקא
   * הרשומה שהמתווך בדיוק פתח או יצר — זו שכינוי גוף מצביע עליה
   * בסבירות הגבוהה ביותר — לא הותירה שום עקבה. „תוסיף קונה דנה
   * לוי” ואז „תזכיר לי להתקשר אליה” נפל לחיפוש טקסט.
   *
   * התווית היא **השם**, כי זה מה שהמודל רואה בתמלול ובתקציר ויכול
   * להחזיר; המזהה נשאר בצד שלנו. שני הערוצים מחברים אותה לשורות
   * המוצגות ב-`agentTurnRefs`, ולכן אין כאן ניסוח שני.
   */
  ref?: AgentHistoryRef;
}

/**
 * כמה התאמות משרדיות הסוכן מוסר — ומול מה נבדק „יש עוד”.
 *
 * רשימה שחזרה בדיוק בגודל התקרה אינה בהכרח הרשימה כולה, וזה מה
 * ש-`hasMore` אומר. בלעדיו „ועוד 42 התאמות” נקרא כסך הכול, והמתווך
 * מפסיק לחפש על סמך תקרה שלנו (ביקורת Codex).
 */
const OFFICE_MATCHES = 50;
/** הסף שמסך ההתאמות מציג — כאן ובספירה, מאותו מקום. */
const OFFICE_MIN_SCORE = 50;

/**
 * עמוד + סימן קיטום — **הספירה היא מה שקובע „יש עוד”.**
 *
 * אורך הרשימה אינו מעיד: שירות ההתאמות מסנן שורות מיושנות (קונה
 * או נכס שנמחקו) **אחרי** ה-`take`, ומרווח קבוע נשבר כשמספרן עולה
 * עליו (ביקורת Codex). הספירה נשאלת מהמסד באותו תנאי בדיוק, ולכן
 * היא מודדת את מה שקיים ולא את מה שנשאר.
 *
 * כיוון אי-הדיוק שנשאר מכוון: שורה מיושנת נספרת ואינה מוצגת, ולכן
 * התשובה עלולה לומר „יש עוד” כשאין — ולעולם לא „זה הכול” כשיש.
 */
function page<T>(rows: T[], total: number, limit: number): { matches: T[]; hasMore: boolean } {
  return { matches: rows.slice(0, limit), hasMore: total > limit };
}

/**
 * שורת בלעדיות כפי שהיא מוצגת — **שדות שכבר קיימים, בשם אחד.**
 *
 * ‎`list()` מחזירה `ExclusivityListItem` ו-`current()` מחזירה DTO
 * מלא. שתיהן נושאות את אותם ארבעה דברים שהתשובה צריכה, ובלי
 * הצמצום כאן כל ערוץ היה בורר מהן בעצמו — וזו בדיוק הכפילות
 * ש-`result-lines` קיים כדי למנוע.
 */
function exclusivityRow(item: {
  propertyTitle?: string;
  daysLeft: number;
  missing: number;
  summary: string;
}): Record<string, unknown> {
  return {
    ...(item.propertyTitle === undefined ? {} : { propertyTitle: item.propertyTitle }),
    daysLeft: item.daysLeft,
    missing: item.missing,
    summary: item.summary,
  };
}

@Injectable()
export class AgentExecuteService {
  constructor(
    private readonly prisma: PrismaService,
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
    private readonly exclusivity: ExclusivityService,
    private readonly resolver: AgentResolveService,
    private readonly gemini: GeminiService,
    private readonly events: AgentEventsService,
    private readonly agreements: AgreementsService,
    private readonly contacts: ContactsService,
  ) {}

  async execute(
    actionId: string,
    params: Record<string, unknown>,
    /** המשפט המקורי — לניסוח התובנה על תוצאות שאילתה בלבד */
    transcript?: string,
    /** מאיפה הפקודה הגיעה — ליומן המשימות של הסוכן בלבד */
    channel: "web" | "whatsapp" = "web",
  ): Promise<ExecuteResult> {
    const action = agentAction(actionId);
    if (!action) throw new BadRequestException("פעולה לא מוכרת");

    /*
     * השער האמיתי. הפעולה מגיעה מגוף הבקשה, ולכן היכולת שהנתיב
     * מצהיר עליה אינה מספיקה — היא של הנתיב, לא של מה שהתבקש בו.
     */
    const ctx = TenantContext.current();
    if (!mayUseAction(action, ctx.capabilities)) {
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
    const final = await this.withInsight(actionId, transcript, result);
    /*
     * ‎**הצעד הנגזר גובר על זה שנוסח.**
     *
     * ‎`withInsight` שולח את התוצאה למודל ומבקש „משפט פקודה שאפשר
     * לומר עכשיו”. זה עבד, אבל על JSON חתוך ובלי ערובה שהשם שיצא
     * ממנו קיים בכלל. כאן הצעד מחושב מהתוצאה עצמה, ולכן כשיש כלל
     * הוא הנכון — והניסוח נשאר למקרים שאין להם.
     */
    const derived = agentNextSteps(
      actionId,
      { ...(final.data === undefined ? {} : { data: final.data }), ...(final.ref === undefined ? {} : { ref: final.ref }) },
      AGENT_ACTIONS.filter((a) => mayUseAction(a, TenantContext.current().capabilities)).map(
        (a) => a.id,
      ),
      new Date(),
    )[0];
    if (derived !== undefined) final.suggestion = derived.text;
    /*
     * הביצוע נרשם ביומן המשימות — הפרמטרים שאושרו ותקציר התוצאה,
     * בלי `data` (תוצאות שאילתה שלמות היו מנפחות את היומן בהעתק
     * של המאגר). fire-and-forget — הרישום אינו מעכב את התשובה.
     */
    void this.events.record({
      channel,
      kind: "execute",
      ...(transcript === undefined ? {} : { transcript }),
      actionId,
      payload: {
        params,
        message: final.message,
        ...(final.href === undefined ? {} : { href: final.href }),
        ...(final.insight === undefined ? {} : { insight: final.insight }),
        ...(final.suggestion === undefined ? {} : { suggestion: final.suggestion }),
      },
    });
    return final;
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
      case "show_card":
        return this.showCard(params);
      case "play_recording":
        return this.playRecording(params);
      case "show_callbacks":
        return this.showCallbacks();
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
      case "send_agreement":
        return this.sendAgreement(params);
      case "show_exclusivity":
        return this.showExclusivity(params);
      case "log_marketing_action":
        return this.logMarketingAction(params);
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
    /*
     * אין תוצאות — אין קריאה. ההודעה כבר אומרת שלא נמצא דבר, ותובנה
     * על רשימה ריקה אינה שווה את הקריאה השנייה ל-Gemini שהיא עולה
     * (בקשת המשתמש: להוזיל כל הפעלה בלי לפגוע באיכות).
     */
    if (Array.isArray(result.data) && result.data.length === 0) return result;
    try {
      if (!(await this.gemini.isConfigured())) return result;
      // קיצוץ קשיח: המודל צריך את ראש הרשימה, לא את כל המאגר
      const compact = JSON.stringify(redactForInsight(result.data)).slice(0, 6000);
      /*
       * ההצעה מוגבלת לפעולות שלמשתמש הזה יש הרשאה אליהן — הצעה
       * לפעולה חסומה הייתה מסתיימת ב"אין לך הרשאה" על משהו שהסוכן
       * עצמו הציע.
       */
      const allowedTitles = AGENT_ACTIONS.filter((a) =>
        mayUseAction(a, TenantContext.current().capabilities),
      )
        .map((a) => a.title)
        .join(", ");
      const raw = await this.gemini.generateStructured(
        [
          'אתה עוזר של מתווך נדל"ן. המתווך שאל:',
          `"${transcript.replaceAll('"', "'")}"`,
          "",
          "אלו התוצאות שהמערכת שלפה (JSON, ייתכן קטוע):",
          compact,
          "",
          "כתוב משפט אחד או שניים בעברית שמסכמים את התובנה החשובה למתווך — כמה נמצאו, מה בולט, מה כדאי לעשות. אל תמציא נתונים שאינם ב-JSON. אם אין מה להוסיף מעבר לרשימה עצמה — החזר insight ריק.",
          "",
          `בנוסף, אם מתבקש צעד המשך טבעי — כתוב ב-suggestion משפט פקודה קצר אחד שהמתווך יכול לומר לך עכשיו (למשל "קבע סיור לרות כהן מחר"), מבוסס רק על מה שבתוצאות ומהסוגים האלה: ${allowedTitles}. אם אין המשך מתבקש — השאר ריק.`,
        ].join("\n"),
        {
          type: "object",
          properties: { insight: { type: "string" }, suggestion: { type: "string" } },
        },
      );
      const insight =
        typeof (raw as { insight?: unknown })?.insight === "string"
          ? ((raw as { insight: string }).insight ?? "").trim()
          : "";
      const suggestion =
        typeof (raw as { suggestion?: unknown })?.suggestion === "string"
          ? ((raw as { suggestion: string }).suggestion ?? "").trim()
          : "";
      return {
        ...result,
        ...(insight !== "" && insight.length <= 500 ? { insight } : {}),
        ...(suggestion !== "" && suggestion.length <= 200 ? { suggestion } : {}),
      };
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
          /*
           * הטלפון הוא מה שהמתווך עושה עם התשובה: רשימת שמות בלי
           * מספרים מחייבת אותו לפתוח את הדשבורד, וזו בדיוק המטרה
           * שהסוכן בוואטסאפ נבנה לחסוך.
           */
          phone: buyer.contact.phone,
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
        data: page(
          await this.matching.listForProperty(propertyId, MATCH_LIST_LIMIT),
          await this.matching.countForProperty(propertyId),
          MATCH_LIST_LIMIT,
        ),
      };
    }
    if (buyerId !== undefined) {
      if (refresh) await this.matching.recomputeForBuyer(buyerId);
      return {
        href: `/buyers/${buyerId}`,
        message: refresh ? "ההתאמות חושבו מחדש" : "ההתאמות של הקונה",
        data: page(
          await this.matching.listForBuyer(buyerId, MATCH_LIST_LIMIT),
          await this.matching.countForBuyer(buyerId),
          MATCH_LIST_LIMIT,
        ),
      };
    }
    /*
     * אותו סף שמסך ההתאמות מציג — תשובה של הסוכן לא אמורה לכלול
     * התאמות שהמסך מסתיר, אחרת שתי דרכים לשאול נותנות שתי תשובות.
     */
    const officeQuery = { limit: OFFICE_MATCHES, minScore: OFFICE_MIN_SCORE };
    return {
      href: "/matches",
      message: "ההתאמות של המשרד",
      data: page(
        await this.matching.listAll(officeQuery),
        await this.matching.countAll({ minScore: OFFICE_MIN_SCORE }),
        OFFICE_MATCHES,
      ),
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

  /**
   * הכרטיס המלא — כל מה שיש על הלקוח, במכה אחת.
   *
   * זו הפעולה שהופכת את הסוכן לתחליף אמיתי לדשבורד: „מה יש לנו על
   * משה כהן” החזיר עד עכשיו שורה עם שם, והמתווך נאלץ לפתוח מסך.
   * כאן חוזרים פרטי הקשר, מה הלקוח מחפש, ההערות, והשיחות האחרונות
   * איתו — כולל סימון אילו מהן מוקלטות, כדי שאפשר יהיה לבקש לשמוע.
   *
   * המזהה בצורה `kind:id` כמו ב-`add_note`: „הכרטיס של שרה” יכול
   * להיות קונה או ליד, וההכרעה היא של המתווך.
   */
  private async showCard(params: Record<string, unknown>): Promise<ExecuteResult> {
    /*
     * ‎**נכס נבדק כאן ולא ב-`cardTarget`.** אותו עוזר משרת גם
     * „תוסיף הערה” וגם „תשמיע לי”, ולשתיהן נכס אינו יעד חוקי.
     */
    const raw = str(params["cardId"]) ?? "";
    if (raw.startsWith("property:")) {
      const propertyId = raw.slice("property:".length);
      if (!TenantContext.current().capabilities.has("properties.view")) {
        throw new ForbiddenException("אין לך הרשאה לצפות בנכסים");
      }
      const property = await this.properties.getById(propertyId);
      const exclusivity = await this.exclusivity.current(propertyId);
      const label =
        property.marketingTitle ??
        ([property.street, property.city].filter(Boolean).join(", ") || "הנכס");
      return {
        href: `/properties/${propertyId}`,
        message: `הכרטיס של ${label}`,
        data: {
          card: {
            kind: "property",
            ...property,
            /*
             * ‎**הבלעדיות בתוך הכרטיס, ולא כשאלה נפרדת.**
             * „מה יש על הדירה” כולל „ומתי היא נגמרת” — ומתווך
             * שלא שאל במפורש הוא בדיוק מי שצריך לדעת.
             */
            ...(exclusivity === null ? {} : { exclusivity: exclusivity.summary }),
          },
        },
        ...refOf(label, "property", propertyId),
      };
    }

    const { kind, id } = this.cardTarget(params);

    if (kind === "buyer") {
      const buyer = await this.buyers.getById(id);
      const calls = await this.callsForContact(buyer.contact.id);
      return {
        href: `/buyers/${id}`,
        message: `הכרטיס של ${buyer.contact.name}`,
        data: { card: { kind: "buyer", ...buyer, calls } },
        ...refOf(buyer.contact.name, "buyer", id),
      };
    }
    if (kind === "lead") {
      const { lead, timeline } = await this.leads.getById(id);
      const calls = await this.callsForContact(lead.contact.id);
      return {
        href: `/leads/${id}`,
        message: `הכרטיס של ${lead.contact.name}`,
        data: {
          card: {
            kind: "lead",
            ...lead,
            calls,
            // ציר הזמן מקוצר: הכרטיס נקרא בטלפון, לא נסרק במסך
            timeline: timeline.slice(0, 8),
          },
        },
        ...refOf(lead.contact.name, "lead", id),
      };
    }
    throw new BadRequestException("כרטיס לא מזוהה");
  }

  /**
   * ההקלטה האחרונה של הלקוח — כהודעת שמע.
   *
   * „האחרונה” ולא בחירה מרשימה: כשמתווך מבקש לשמוע שיחה עם לקוח,
   * הוא כמעט תמיד מתכוון לזו שהרגע הסתיימה. בחירה מפורשת נשארת
   * דרך `show_card`, שמראה את כל השיחות ומסמן אילו מוקלטות.
   */
  private async playRecording(params: Record<string, unknown>): Promise<ExecuteResult> {
    const { kind, id } = this.cardTarget(params);
    /*
     * הכרטיס נשלף ממילא בשביל `contactId`, ולכן השם כאן אינו עולה
     * שאילתה — הוא רק לא נקרא קודם. „תשמיע לי את השיחה עם משה” ואז
     * „תזכיר לי לחזור אליו” הוא בדיוק הרצף שדורש את ההפניה.
     */
    const contact =
      kind === "buyer"
        ? (await this.buyers.getById(id)).contact
        : (await this.leads.getById(id)).lead.contact;
    const contactId = contact.id;
    const ref = refOf(contact.name, kind, id);

    /*
     * שאילתה נפרדת ולא `find` על השיחות של הכרטיס: התקרה חייבת
     * לחול על השיחות **המוקלטות**, אחרת עשר שיחות חדשות בלי הקלטה
     * מסתירות את ההקלטה שקיימת מתחתן.
     */
    const [recorded] = await this.calls.list({ contactId, recordedOnly: true, limit: 1 });
    if (!recorded) {
      // הכרטיס נבחר גם כשאין הקלטה, ולכן ההפניה נשמרת: „אין הקלטה”
      // אינו „לא ידוע על מי דיברנו”.
      return { message: "אין הקלטה זמינה לשיחות עם הלקוח הזה", ...ref };
    }
    const when = new Intl.DateTimeFormat("he-IL", {
      timeZone: "Asia/Jerusalem",
      dateStyle: "short",
      timeStyle: "short",
    }).format(recorded.occurredAt);
    return {
      /*
       * הקישור מצביע על השיחה עצמה ולא על המסך.
       *
       * `/calls` לבדו פותח את החדשה מבין המאה שנטענו — כלומר על
       * הקלטה שאינה האחרונה הוא נוחת על שיחה אחרת לגמרי, ועל אחת
       * ישנה מספיק היא כלל אינה ברשימה (ביקורת Codex). המסך כבר
       * יודע לפתוח שיחה מבוקשת לפי `?call=`.
       */
      href: `/calls?call=${recorded.id}`,
      message: `ההקלטה מ-${when}`,
      audio: { callId: recorded.id, label: `שיחה מ-${when}` },
      ...(recorded.summary === undefined ? {} : { data: { summary: recorded.summary } }),
      ...ref,
    };
  }

  /**
   * הכרטיס שנבחר — **עם השער של הסוג שלו**.
   *
   * היכולת שהפעולה מצהירה עליה היא אחת, והכרטיס יכול להיות שניים.
   * מי שיש לו `buyers.view_own` אבל מודול הלידים חסום אצלו היה
   * עובר את שער הפעולה ומקבל ליד מלא — כולל פרטי קשר, ציר זמן
   * ושיחות (ביקורת Codex). לכן הסוג הנבחר נבדק כאן שוב, מול
   * היכולת שלו.
   */
  /**
   * ‎**בלעדיות — מה בסיכון, ולמה.**
   *
   * שתי שאלות שונות באותה פעולה, וההבחנה היא נוכחות של נכס:
   *
   * ‎**עם נכס** — התיק שלו: מועד השליש, כמה פעולות שיווק חסרות, וכמה
   * ימים נשארו בפועל. זו השאלה של מי שעומד על כרטיס.
   *
   * ‎**בלי נכס** — כל הבלעדיות של המשרד, כפי שהשירות כבר ממיין אותן
   * (לפי דחיפות). זו השאלה השכיחה יותר, והיא זו שאי אפשר היה לשאול
   * עד היום בלי לפתוח כרטיס אחרי כרטיס.
   *
   * ‎**„אין בלעדיות” ו„לא נבדק” אינם אותו דבר.** נכס שאין עליו
   * בלעדיות מקבל תשובה מפורשת, ולא רשימה ריקה שנקראת כאילו הכול
   * תקין.
   */
  private async showExclusivity(params: Record<string, unknown>): Promise<ExecuteResult> {
    const propertyId = typeof params["propertyId"] === "string" ? params["propertyId"] : null;
    if (propertyId !== null) {
      const current = await this.exclusivity.current(propertyId);
      if (current === null) {
        return { href: `/properties/${propertyId}`, message: "אין בלעדיות פעילה על הנכס הזה" };
      }
      return {
        href: `/properties/${propertyId}`,
        message: current.summary,
        data: { exclusivity: [exclusivityRow(current)] },
      };
    }
    const items = await this.exclusivity.list();
    return {
      href: "/exclusivity",
      message:
        items.length === 0
          ? "אין בלעדיות פעילות במשרד"
          : `${items.length} בלעדיות — לפי דחיפות`,
      data: { exclusivity: items.map(exclusivityRow) },
    };
  }

  /**
   * ‎**תיעוד פעולת שיווק — הראיה שמאריכה את הבלעדיות.**
   *
   * ‎`performedAt` הוא **היום הישראלי** ולא `new Date()` גולמי: זו
   * רשומה שסופרים בה ימים מול מועד השליש, ובין חצות לשלוש לפנות
   * בוקר שעון UTC מציין את אתמול. אותה הכרעה בדיוק כמו בטופס במסך.
   */
  private async logMarketingAction(params: Record<string, unknown>): Promise<ExecuteResult> {
    const propertyId = typeof params["propertyId"] === "string" ? params["propertyId"] : "";
    const kind = typeof params["actionKind"] === "string" ? params["actionKind"] : "";
    if (!MARKETING_ACTION_KINDS.includes(kind as MarketingActionKind)) {
      throw new BadRequestException("לא ברור איזו פעולת שיווק בוצעה");
    }
    const detail = typeof params["detail"] === "string" ? params["detail"].trim() : "";
    const next = await this.exclusivity.logAction(propertyId, {
      kind: kind as MarketingActionKind,
      /*
       * חצות UTC של **היום הישראלי** — אותה מוסכמה שהעמודה נשמרת
       * בה, ואותה שרשרת שהמסך עובר: תווית תאריך ואז המרה. `Z`
       * מפורש, ולכן זו אינה קריאה בשעון המכשיר.
       */
      performedAt: new Date(`${jerusalemWallParts(new Date()).date}T00:00:00Z`),
      ...(detail === "" ? {} : { detail }),
    });
    return {
      href: `/properties/${propertyId}`,
      message: `${MARKETING_ACTION_LABEL[kind as MarketingActionKind]} תועדה — ${next.summary}`,
    };
  }

  private cardTarget(params: Record<string, unknown>): {
    kind: "buyer" | "lead";
    id: string;
  } {
    const cardId = str(params["cardId"]);
    if (cardId === undefined) throw new BadRequestException("לא נבחר כרטיס");
    const [kind, id] = cardId.split(":", 2);
    if (id === undefined || (kind !== "buyer" && kind !== "lead")) {
      throw new BadRequestException("כרטיס לא מזוהה");
    }
    const needed = kind === "buyer" ? "buyers.view_own" : "leads.view_own";
    if (!TenantContext.current().capabilities.has(needed)) {
      throw new ForbiddenException(
        kind === "buyer" ? "אין לך הרשאה לצפות בקונים" : "אין לך הרשאה לצפות בלידים",
      );
    }
    return { kind, id };
  }

  /**
   * אותה הכרעה כמו `cardTarget`, אבל **מוותרת במקום לזרוק**.
   *
   * שיוך התזכורת לכרטיס הוא שיפור ולא תנאי: תזכורת שנוצרה בלי
   * קישור עדיין עושה את עבודתה, ותזכורת שלא נוצרה כלל בגלל שיוך
   * שלא נפתר — לא.
   *
   * בדיקת ההרשאה נשארת זהה ואינה מתרככת. שיוך לליד שהסוכן אינו
   * רשאי לראות היה מחזיר את **שמו** אל תוך רשימת המשימות שלו
   * (`entityLabel`), כלומר הופך שדה עזר לדלת אחורית להיקף.
   */
  private async optionalCardTarget(
    raw: unknown,
  ): Promise<{ kind: "buyer" | "lead"; id: string } | null> {
    const cardId = str(raw);
    if (cardId === undefined) return null;
    const [kind, id] = cardId.split(":", 2);
    if (id === undefined || (kind !== "buyer" && kind !== "lead")) return null;
    const needed = kind === "buyer" ? "buyers.view_own" : "leads.view_own";
    if (!TenantContext.current().capabilities.has(needed)) return null;

    /*
     * היכולת מוכיחה גישה **למודול**, לא לכרטיס הזה.
     *
     * המזהה אינו תמיד משהו שהסוכן הקליד: הוא מגיע גם מהתראות
     * ברמת המשרד — `call_missed` למשל — ולכן סוכן עם `view_own`
     * בלבד יכול להחזיק מזהה של כרטיס של עמית. בדיקת היכולת לבדה
     * קיבלה אותו, והתזכורת נקשרה לכרטיס שאינו שלו; מכאן
     * `entityLabel` שולף את שם הלקוח אל תוך רשימת המשימות שלו
     * (ביקורת Codex).
     *
     * ההערה שמעל תיארה בדיוק את הסיכון הזה, והמימוש לא אכף אותו.
     * הבדיקה כאן היא אותו סינון בעלות של הרשימות עצמן, ולכן שיוך
     * לכרטיס לא-נגיש פשוט לא נוצר — התזכורת עדיין נוצרת בלעדיו.
     */
    const { tenantId } = TenantContext.current();
    const accessible = await this.prisma.withTenant((tx) =>
      isCardAccessible(tx, tenantId, kind, id),
    );
    return accessible ? { kind, id } : null;
  }

  /** השיחות של איש קשר, החדשות תחילה — משותף לכרטיס ולהשמעה. */
  private async callsForContact(contactId: string): Promise<CallDto[]> {
    return this.calls.list({ contactId, limit: 10 });
  }

  /**
   * ההקלטה עצמה — נקראת אחרי ש-`audio` סימן שיש מה להשמיע.
   *
   * כאן ולא בערוץ: `CallsService.recording` אוכף בעלות ומחזיר 404
   * זהה ל„אין הקלטה” ול„לא שלך”, וכל ערוץ שיעקוף אותו היה מאבד את
   * ההגנה הזו.
   */
  async recording(
    callId: string,
  ): Promise<{ body: Readable; contentType: string; contentLength?: number }> {
    return this.calls.recording(callId);
  }

  /**
   * „למי אני צריך לחזור” — הרשימה שהמתווך ביקש וקיבל במקומה משימות.
   *
   * ## למה שלושה מקורות ולא אחד
   *
   * „ממתין לחזרה” אינו עמודה במסד — הוא נגזר משלושה מצבים שונים
   * שהמתווך חווה כאותה מטלה: שיחה שלא נענתה, ליד שאיש לא חזר אליו,
   * ומשימה שקשורה לאיש קשר. כל אחד חי בטבלה אחרת ולכל אחד מסנן
   * בעלות משלו — ולכן שלוש קריאות דרך השירותים הקיימים, ולא JOIN
   * ידני שעוקף אותם.
   *
   * המיזוג והדירוג נעשים בלוגיקה טהורה ב-`@metavchim/shared`, שם יש
   * להם בדיקות: „מי דוחק יותר” הוא כלל מוצר, לא שאילתה.
   *
   * ## מה הופך את זה לתשובה ולא לרשימה
   *
   * כל שורה נושאת **מספר טלפון**. `show_tasks` מחזירה כותרות בלבד,
   * ולכן מתווך שקיבל אותה נשאר בדיוק במקום שבו התחיל — הוא יודע
   * למי לחזור ולא יודע לאן לחייג.
   */
  private async showCallbacks(): Promise<ExecuteResult> {
    const now = new Date();
    /*
     * שאילתות ממוקדות ולא „העמוד הראשון ואז מסננים”.
     *
     * גרסה קודמת שלפה שיחות ולידים אחרונים וסיננה אחר כך, ושתיהן
     * חתכו בדיוק את הצד הלא-נכון: לקוח ששקט מאז השיחה שלא נענתה
     * נפל מהתקרה, והליד הוותיק — זה שהרשימה קיימת בשבילו — נעלם
     * בשקט (שתי ביקורות Codex).
     *
     * לכן כל מקור נשאל בדיוק על מה שהוא צריך: שיחה אחרונה לכל איש
     * קשר בחלון, לידים פתוחים ממוינים מהוותיק, ומשימות פתוחות
     * שקשורות ללידים — מסוננות במסד ולא אחרי תקרה משותפת לכל סוגי
     * הישויות.
     *
     * ## גבול המודול נשמר גם כאן
     *
     * מקור המשימות מותנה ב-`calendar.manage`, היכולת שכל נתיבי
     * המשימות דורשים. הפעולה עצמה נשענת על `leads.view_own`, ובלי
     * התנאי הזה היא הייתה דלת אחורית: משתמש שמודול היומן חסום אצלו
     * — או תפקיד `viewer` — היה מקבל כותרות משימות שהמסך אינו מראה
     * לו (ביקורת Codex). מי שאין לו את היכולת עדיין מקבל את שני
     * המקורות האחרים; הרשימה מצטמצמת, לא נחסמת.
     */
    const mayReadTasks = TenantContext.current().capabilities.has("calendar.manage");
    const [calls, waiting, tasks] = await Promise.all([
      this.calls.latestPerContactSince(
        new Date(now.getTime() - MISSED_CALL_WINDOW_DAYS * 24 * 60 * 60 * 1000),
      ),
      this.leads.openAwaitingResponse(CALLBACK_LEAD_SCAN),
      mayReadTasks ? this.tasks.openLinkedToLeads(CALLBACK_TASK_SCAN) : Promise.resolve([]),
    ]);

    const candidates: CallbackCandidate[] = pendingMissedCalls(
      calls.map((call) => ({
        id: call.id,
        ...(call.contactId !== undefined ? { contactId: call.contactId } : {}),
        ...(call.contactName !== undefined ? { contactName: call.contactName } : {}),
        ...(call.phone !== undefined ? { phone: call.phone } : {}),
        direction: call.direction,
        outcome: call.outcome,
        occurredAt: call.occurredAt,
        ...(call.summary !== undefined ? { summary: call.summary } : {}),
      })),
      now,
    );

    /*
     * ליד שהכדור אצלנו. `converted` ו-`closed` יצאו מהתמונה,
     * ו-`waiting_customer` הוא בדיוק ההפך — שם ממתינים ללקוח.
     */
    for (const lead of waiting) {
      candidates.push({
        contactId: lead.contact.id,
        name: lead.contact.name,
        phone: lead.contact.phone === "" ? null : lead.contact.phone,
        reason: "waiting_lead",
        since: lead.createdAt,
        href: `/leads/${lead.id}`,
        ...(lead.summary !== undefined ? { detail: lead.summary } : {}),
      });
    }

    /*
     * משימה נכנסת רק כשהיא קשורה לליד — שם יש איש קשר, ולכן מספר.
     * משימה על נכס („לצלם את הדירה”) אינה חזרה לאדם, והכללתה הייתה
     * מחזירה בדיוק את הרשימה שהמתווך התלונן עליה.
     */
    /*
     * הלידים של המשימות נשלפים **בנפרד**, ולא מתוך `waiting`.
     *
     * שימוש חוזר ב-`waiting` נראה כמו חיסכון בשאילתה והיה ביטול של
     * המקור כולו: הוא מחזיק `new` ו-`in_progress` בלבד, שכל אחד מהם
     * כבר נכנס לרשימה כ„פנייה שממתינה” — סיבה שגוברת על „משימה”.
     * כלומר משימה על ליד משם לעולם אינה הסיבה המוצגת, ומשימה על ליד
     * ב-`waiting_customer` — „לחזור אליו ביום שישי”, בדיוק המשימה
     * שצריך להזכיר — נשמטה כליל (ביקורת Codex).
     */
    const taskLeadIds = tasks
      .filter((task) => task.entityType === "lead" && task.entityId !== undefined)
      .map((task) => task.entityId as string);
    const leadById = new Map((await this.leads.activeByIds(taskLeadIds)).map((l) => [l.id, l]));
    for (const task of tasks) {
      if (task.entityType !== "lead" || task.entityId === undefined) continue;
      const lead = leadById.get(task.entityId);
      if (!lead) continue;
      candidates.push({
        contactId: lead.contact.id,
        name: lead.contact.name,
        phone: lead.contact.phone === "" ? null : lead.contact.phone,
        reason: "task",
        /*
         * בלי מועד יעד — מועד היצירה, ולא „עכשיו”.
         *
         * `now` איפס את הוותק בכל בקשה מחדש: תזכורת בלי תאריך שנפתחה
         * לפני חודשיים הוצגה תמיד כ„ממתין דקה”, נשארה בדרגת הדחיפות
         * הנמוכה, ומוינה לפי שם במקום לפי ותק. הדבר היחיד שיכול
         * להזדקן הוא הרגע שבו היא נוצרה (ביקורת Codex).
         */
        since: task.dueAt ?? task.createdAt,
        href: `/leads/${lead.id}`,
        detail: task.title,
      });
    }

    const rows = rankCallbacks(candidates, now);
    return {
      href: "/leads",
      message:
        rows.length === 0
          ? "אין כרגע אף אחד שממתין לחזרה"
          : `${rows.length} ממתינים לחזרה — הדחוף ביותר: ${rows[0]?.name}`,
      data: { callbacks: rows },
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
      /*
       * **רק ליד שגלוי למי שקלט אותו.** פנייה שמוזגה לליד של סוכן
       * אחר אינה שלו, וניווט אליה מסתיים ב-403 — הפניה אליה הייתה
       * מזמינה את הצעד הבא לפעול על רשומה שהשירותים ידחו.
       */
      ...(result.visible ? refOf(name, "lead", result.id) : {}),
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
    return {
      href: `/buyers/${buyer.id}`,
      message: "כרטיס הקונה נוצר",
      ...refOf(name, "buyer", buyer.id),
    };
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
    return {
      href: `/properties/${property.id}`,
      message: "הנכס נקלט",
      /*
       * לנכס אין שם של אדם, והכותרת השיווקית היא מה שהמתווך מכנה
       * אותו בשיחה. בלעדיה אין תווית שאפשר להצביע עליה, ולכן אין
       * הפניה — פחות טוב מהפניה, וטוב בהרבה מתווית שאיש לא יאמר.
       */
      ...refOf(buildTitle(fields), "property", property.id),
    };
  }

  private async createTask(params: Record<string, unknown>): Promise<ExecuteResult> {
    const title = str(params["title"]);
    if (title === undefined) throw new BadRequestException("לתזכורת דרושה כותרת");
    const dueAt = date(params["dueAt"]);
    /*
     * הקישור לכרטיס — מה שהופך „תזכיר לי להתקשר אליו” לתזכורת
     * שאפשר לפעול לפיה.
     *
     * `relatedId` נפתר ב-`AgentResolveService` בצורת `lead:01J…` /
     * `buyer:01J…`, כמו כל ביטוי מסוג „כרטיס”. עד עכשיו השדה נאסף
     * מהמודל, הוצג בכרטיס האישור — ונזרק: כל תזכורת שנוצרה בקול
     * נכתבה בלי שיוך, ומסך המשימות הראה „להתקשר אליו” בלי לומר
     * למי.
     */
    const related = await this.optionalCardTarget(params["relatedId"]);
    const task = await this.tasks.create({
      title,
      ...(dueAt ? { dueAt } : {}),
      ...(related ? { entityType: related.kind, entityId: related.id } : {}),
    });
    return {
      href: related ? `/${related.kind}s/${related.id}` : "/tasks",
      message: dueAt ? "התזכורת נוצרה — תישלח התראה במועד" : "המשימה נוצרה",
      data: { id: task.id },
      // „תסגור אותה” על המשימה שהרגע נוצרה — הכותרת היא מה שנאמר
      ...refOf(title, "task", task.id),
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
    return {
      href: `/buyers/${buyer.id}`,
      message: "הכרטיס עודכן",
      // הכרטיס נשלף ממילא בשביל המיזוג, ולכן השם כאן חינם
      ...refOf(existing.contact.name, "buyer", buyer.id),
    };
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
    return {
      href: `/properties/${property.id}`,
      message: "הנכס עודכן",
      ...refOf(property.marketingTitle, "property", property.id),
    };
  }

  private async completeTask(params: Record<string, unknown>): Promise<ExecuteResult> {
    const taskId = str(params["taskId"]);
    if (taskId === undefined) throw new BadRequestException("לא נבחרה משימה");
    const task = await this.tasks.update(taskId, { status: "done" });
    return {
      href: "/tasks",
      message: "המשימה סומנה כבוצעה",
      ...refOf(task.title, "task", task.id),
    };
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
      /*
       * **בלי `ref`, ובכוונה.** ענף הקונה מחזיר הפניה כי הכרטיס
       * נשלף כאן ממילא (ההערות ממוזגות מולו); ענף הליד אינו שולף
       * דבר, ושליפה רק בשביל תווית הייתה מוסיפה קריאה לנתיב כתיבה —
       * ובנוסף עוברת דרך מסנן בעלות אחר מזה של `addNote`, כלומר
       * עלולה להיכשל דווקא היכן שההערה עצמה מותרת. הפתרון שם דורש
       * השוואת שני מסנני הבעלות, וזה שינוי בפני עצמו.
       *
       * עד אז „אליו” אחרי הערה לליד נפתר בחיפוש, כמו היום. פחות
       * טוב מהפניה, וטוב בהרבה משיוך שגוי.
       */
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
      return {
        href: `/buyers/${id}`,
        message: "ההערה נוספה לכרטיס הקונה",
        ...refOf(existing.contact.name, "buyer", id),
      };
    }
    throw new BadRequestException("כרטיס לא מזוהה");
  }

  private async updateLeadStatus(params: Record<string, unknown>): Promise<ExecuteResult> {
    const leadId = str(params["leadId"]);
    if (leadId === undefined) throw new BadRequestException("לא נבחר ליד");
    const status = str(params["leadStatus"]);
    if (status === undefined) throw new BadRequestException("לא נאמר סטטוס");
    await this.leads.updateStatus(leadId, status);
    // בלי `ref` — מאותה סיבה שב-`addNote` על ליד: אין כאן שליפה
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

  /**
   * ‎**קישור חתימה על הזמנה בכתב — הפעולה היחידה של הסוכן שמייצרת
   * מסמך משפטי.**
   *
   * המתווך יושב מול הלקוח וצריך את הקישור עכשיו. עד כה התשובה
   * הייתה „אני עדיין לא יכול” (דיווח המשתמשת), והדרך היחידה הייתה
   * לפתוח דשבורד ולמצוא את הכרטיס.
   *
   * ‎**דרך `AgreementsService.create`, ולא כתיבה משלנו.** שם יושבות
   * בדיקת הבעלות על הלקוח, מיחזור הסכם ממתין קיים במקום מסמך שני
   * לאותה עסקה, שחרור קישורים שפגו, וסירוב לקפוא מסמך שחסרים בו
   * פרטי חובה. כל אחת מהן היא תיקון שכבר עלה ביוקר פעם אחת.
   *
   * ‎**הנכס אינו רשות.** ההזמנה בכתב נוקבת בנכס מסוים — היא מתארת
   * אותו, ו-`hasSigned` מחפש חתימה על אותו נכס בדיוק. מסמך שנוצר
   * בלי נכס אינו פותח שום הצעה, ולכן קישור כזה הוא בזבוז של פעולה
   * משפטית ולא „פחות מדויק”. כשהנכס לא נפתר — נעצרים ואומרים מה
   * חסר.
   */
  private async sendAgreement(params: Record<string, unknown>): Promise<ExecuteResult> {
    const buyerId = str(params["buyerId"]);
    if (buyerId === undefined) throw new BadRequestException("לא נבחר לקוח להחתמה");
    const propertyId = str(params["propertyId"]);
    if (propertyId === undefined) {
      throw new BadRequestException(
        "הזמנה בכתב נוקבת בנכס מסוים. אמרו על איזה נכס מדובר, או שלחו את ההסכם מכרטיס הלקוח",
      );
    }

    /*
     * מהקונה אל איש הקשר. הבדיקה שהקונה שייך למשרד ולסוכן נעשית
     * ב-`AgreementsService.create` דרך `assertContactAccess`, אבל
     * השליפה עצמה חייבת להיות מסוננת לפי הדייר — אחרת מזהה קונה של
     * משרד אחר היה מחזיר איש קשר שאפילו לא נבדק.
     */
    const tenantId = TenantContext.current().tenantId;
    const { url, reused, unfilled, buyerName } = await this.prisma.withTenant(async (tx) => {
      const buyer = await tx.buyer.findFirst({
        where: { id: buyerId, tenantId, deletedAt: null },
        select: { contactId: true },
      });
      if (!buyer) throw new BadRequestException("הלקוח לא נמצא");
      /*
       * השם נשלף **לפני** היצירה ודרך `ContactsService`, כי הוא
       * מוצפן במסד ורק שם הוא מפוענח. הוא נחוץ בהודעה: זו הנקודה
       * האחרונה שבה מתווך שעומד להעביר קישור חתימה יכול לראות
       * שהוא בחר את הלקוח הלא נכון.
       */
      const contact = await this.contacts.getById(tx, buyer.contactId);
      const created = await this.agreements.create(tx, {
        kind: "brokerage",
        contactId: buyer.contactId,
        propertyId,
      });
      return { ...created, buyerName: contact?.name ?? "הלקוח" };
    });

    /*
     * הקישור נוסע ב-`message` ולא ב-`href`: `href` הוא נתיב יחסי
     * שכל ערוץ מקדים לו את מוצא האתר, והקישור הציבורי כבר מוחלט —
     * הקידומת הייתה שוברת אותו. `href` נשאר מה שהוא: לאן ללכת
     * בדשבורד.
     */
    const lines = [
      reused
        ? `יש כבר הסכם שממתין לחתימה של ${buyerName} — זה הקישור שלו:`
        : `ההסכם מוכן לחתימה של ${buyerName}:`,
      url,
      /*
       * ‎**נאמר במפורש שהוא לא נשלח.** „ההסכם מוכן” יכול להישמע
       * כאילו הלקוח כבר קיבל אותו, והמתווך היה ממתין לחתימה שלא
       * תגיע.
       */
      "עדיין לא נשלח ללקוח — העבירו לו את הקישור, או שלחו מהכרטיס בוואטסאפ או במייל.",
      ...(unfilled.length > 0
        ? [`פרטים שנשארו ריקים במסמך: ${unfilled.map((f) => f.replace(/_/gu, " ")).join(", ")}`]
        : []),
    ];

    return {
      href: `/buyers/${buyerId}?tab=agreements`,
      message: lines.join("\n"),
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
 * סיכום עליה הוא רעש. שיחות ועסקאות כן — הרשימות שם ארוכות ומזמינות
 * מסקנה ("שלוש שיחות בלי מענה מאתמול").
 */
/**
 * מה **לא** נשלח למודל כשמנסחים תובנה — טלפונים, אימיילים, סיכומי
 * שיחות והערות חופשיות. התובנה זקוקה לשמות, ערים, מחירים וסטטוסים;
 * היא אינה זקוקה לדרכי התקשרות או לתוכן שיחה של לקוח קצה, ושליחתם
 * הייתה מייצאת בשקט בדיוק את מה שהתמלול המקומי נבנה כדי לשמור
 * בתוך המכונה (ביקורת Codex).
 */
function redactForInsight(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactForInsight);
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (/phone|email|summary|transcript|notes/iu.test(key)) continue;
      out[key] = redactForInsight(inner);
    }
    return out;
  }
  return value;
}

const INSIGHT_ACTIONS = new Set([
  "search",
  "find_buyers",
  "find_properties",
  "show_matches",
  "show_calls",
  "show_deals",
  "office_report",
]);
