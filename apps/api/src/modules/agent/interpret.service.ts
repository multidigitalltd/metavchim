import { Injectable, Logger } from "@nestjs/common";
import {
  AGENT_ACTIONS,
  agentAction,
  buildInterpretPrompt,
  extractPersonFromTranscript,
  extractPropertyFromTranscript,
  interpretJsonSchema,
  InterpretResponseSchema,
  narrowParams,
  routeVoiceCommand,
  stripCommandPrefix,
  taskTitleFromTranscript,
  type AgentActionDef,
} from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { GeminiService } from "../../core/gemini.service";

/**
 * הבנת המשפט — **שלב אחד, לא שניים.**
 *
 * ## מה השתנה מהסוכן הקודם
 *
 * קודם ה-LLM עשה דבר אחד בלבד: בחר כוונה מתוך תשע, והחזיר את המשפט
 * בלי מילות הפקודה. את **השדות** מיפה מנוע חוקים — רשימת ערים
 * קשיחה של תשעה-עשר שמות בקוד, טבלת מילות מספר ידנית, וביטוי רגולרי
 * לכל שדה. כלומר החוכמה נעצרה בדיוק בשלב שדורש אותה.
 *
 * גרוע מזה: המסך העביר את הטקסט למסך אחר בפרמטר URL, ושם החילוץ רץ
 * **מחדש** — מה שהמודל הבין נזרק בדרך.
 *
 * כאן קריאה אחת מחזירה גם את הפעולה וגם את השדות שלה, בסכימה
 * שה-API אוכף, וההבנה נשמרת עד לביצוע.
 *
 * ## מה המודל עדיין לא מכריע
 *
 * תאריכים, מיקומים ומזהי רשומות. הוא מחזיר ביטויים, והקוד פותר
 * אותם מול לוח השנה ומול המאגר. ראו `AgentResolveService`.
 *
 * ## הרצפה הדטרמיניסטית
 *
 * כשאין מפתח Gemini, כשהקריאה נכשלת או מתמהמהת, וכשהתשובה לא
 * נקראת — נופלים למנוע החוקים הקיים. הוא פחות מדויק ועובד; מערכת
 * שנעצרת כשספק חיצוני שותק אינה מערכת.
 */

export interface Interpretation {
  actionId: string;
  params: Record<string, unknown>;
  evidence: Record<string, string>;
  /** מה שנאמר ולא נכנס לשום שדה — מוצג ולא נבלע */
  unmapped: string[];
  /** שדות שהמודל החזיר ונפסלו בוולידציה */
  rejected: string[];
  clarify?: string;
  /** true = מנוע החוקים הכריע, כלומר Gemini לא היה זמין */
  fallback: boolean;
}

@Injectable()
export class AgentInterpretService {
  private readonly logger = new Logger(AgentInterpretService.name);

  constructor(private readonly gemini: GeminiService) {}

  /**
   * הפעולות שלמשתמש הזה מותר לבקש.
   *
   * זו אינה שכבת האבטחה — הבדיקה בשרת נשארת בכל מקרה לפני הביצוע.
   * זו שכבת החוויה: מודל שמכיר פעולה יציע אותה, והמתווך יקבל „אין
   * לך הרשאה” על ניסוח סביר לגמרי. עדיף שהמודל יבחר את הפעולה
   * המותרת הקרובה, או יודה שאינו יודע.
   */
  allowedActions(): AgentActionDef[] {
    const ctx = TenantContext.current();
    return AGENT_ACTIONS.filter((action) => ctx.capabilities.has(action.capability));
  }

  async interpret(
    transcript: string,
    prior?: { action: string; params: Record<string, unknown> },
  ): Promise<Interpretation> {
    const allowed = this.allowedActions();
    const viaLlm = await this.viaLlm(transcript, allowed, prior);
    return viaLlm ?? this.viaRules(transcript, allowed);
  }

  private async viaLlm(
    transcript: string,
    allowed: AgentActionDef[],
    prior?: { action: string; params: Record<string, unknown> },
  ): Promise<Interpretation | null> {
    if (allowed.length === 0) return null;
    if (!(await this.gemini.isConfigured())) return null;

    const prompt = buildInterpretPrompt(transcript, {
      nowText: nowInJerusalem(),
      allowedActions: allowed.map((a) => a.id),
      ...(prior ? { prior } : {}),
    });

    const raw = await this.gemini.generateStructured(prompt, interpretJsonSchema());
    const parsed = InterpretResponseSchema.safeParse(raw);
    if (!parsed.success) return null;

    const answer = parsed.data;
    if (answer.action === "unknown") {
      /*
       * לא נופלים לחוקים כאן. המודל ראה את כל הפעולות ואת הדוגמאות
       * שלהן ואמר במפורש שאינו יודע; מנוע החוקים, שמזהה ביטויים
       * רגולריים, אינו מקור סמכות טוב יותר ממנו — הוא היה דוחף את
       * המשפט למשבצת הקרובה וקורא לזה הבנה.
       */
      return {
        actionId: "unknown",
        params: {},
        evidence: {},
        unmapped: answer.unmapped,
        rejected: [],
        ...(answer.clarify ? { clarify: answer.clarify } : {}),
        fallback: false,
      };
    }

    const action = agentAction(answer.action);
    /*
     * פעולה שהמודל בחר ואין אליה הרשאה. היא לא הייתה בפרומפט, ולכן
     * זה אמור להיות בלתי אפשרי — אבל „אמור” אינו הרשאה. עדיף לומר
     * שלא הבנו מאשר להציע פעולה שתיחסם בביצוע.
     */
    if (!action || !allowed.some((a) => a.id === action.id)) {
      this.logger.warn(`המודל בחר פעולה שאינה מותרת: ${answer.action}`);
      return null;
    }

    const { params, rejected } = narrowParams(action, answer.params);
    if (rejected.length > 0) {
      this.logger.warn(`שדות שנפסלו ב-${action.id}: ${rejected.join(", ")}`);
    }

    return {
      actionId: action.id,
      params,
      // ראיה לשדה שנפסל היא ראיה למשהו שלא נכנס — מטעה יותר משימושית
      evidence: Object.fromEntries(
        Object.entries(answer.evidence).filter(([key]) => key in params),
      ),
      unmapped: answer.unmapped,
      rejected,
      ...(answer.clarify ? { clarify: answer.clarify } : {}),
      fallback: false,
    };
  }

  /**
   * הרצפה: מנוע החוקים הקיים, ממופה לקטלוג החדש.
   *
   * הוא מזהה פחות ומדייק פחות — רשימת הערים הקשיחה שלו היא בדיוק
   * הסיבה לשכתוב — אבל הוא עובד בלי רשת ובלי מפתח. פעולה שהחוקים
   * אינם מכירים מוחזרת כ-`unknown` ולא נדחקת למשבצת הקרובה.
   */
  private viaRules(transcript: string, allowed: AgentActionDef[]): Interpretation {
    const command = routeVoiceCommand(transcript);
    const actionId = RULE_ACTION_MAP[command.action];
    if (actionId === undefined || !allowed.some((a) => a.id === actionId)) {
      return {
        actionId: "unknown",
        params: {},
        evidence: {},
        unmapped: [],
        rejected: [],
        fallback: true,
      };
    }

    const action = agentAction(actionId)!;
    const raw = this.rulesParams(actionId, transcript, command.query);
    const { params, rejected } = narrowParams(action, raw);
    return {
      actionId,
      params,
      evidence: {},
      unmapped: [],
      rejected,
      fallback: true,
    };
  }

  private rulesParams(
    actionId: string,
    transcript: string,
    query?: string,
  ): Record<string, unknown> {
    if (actionId === "search") {
      return { query: query?.trim() || stripCommandPrefix(transcript) };
    }
    if (actionId === "create_task") {
      return { title: taskTitleFromTranscript(transcript) };
    }
    if (actionId === "create_property") {
      const { fields, marketingDescription } = extractPropertyFromTranscript(transcript);
      return {
        ...fields,
        // הסכימה של הסוכן מדברת בשקלים; מנוע החוקים מחזיר אגורות
        ...(fields.priceAgorot === undefined
          ? {}
          : { priceShekels: Math.round(fields.priceAgorot / 100) }),
        priceAgorot: undefined,
        ...(marketingDescription === undefined ? {} : { marketingDescription }),
      };
    }

    // שאלות קריאה בלי שדות — אין מה לחלץ; התאריך נפתר בשלב הבא
    if (["show_schedule", "show_tasks", "show_calls", "show_deals"].includes(actionId)) {
      return {};
    }
    if (actionId === "office_report") {
      return {
        windowDays: /רבעון/u.test(transcript) ? "90" : /שנה/u.test(transcript) ? "365" : "30",
      };
    }
    if (actionId === "complete_task") {
      return {
        taskPhrase: transcript
          .replace(/^.*?(?:סגור|תסגור|סמן|תסמן|סיימתי)\s+(?:את\s+)?(?:ה?משימה)?\s*(?:של)?\s*/u, "")
          .replace(/\s+/gu, " ")
          .trim(),
      };
    }
    if (actionId === "share_property" || actionId === "share_buyer") {
      const phrase = transcript
        .replace(/^.*?(?:שתף|תשתף|פרסם|תפרסם|העלה|תעלה)\s+(?:את\s+)?/u, "")
        .replace(/\s*(?:ברשת|לרשת)(?:\s+השיתופים)?\s*$/u, "")
        .replace(/\s+/gu, " ")
        .trim();
      return actionId === "share_property"
        ? { propertyPhrase: phrase }
        : { buyerPhrase: phrase };
    }

    // ליד, קונה ושאלות על הקונים — כולם נגזרים מאותו חילוץ אדם
    const { person } = extractPersonFromTranscript(transcript);
    const shekels = (agorot?: number): number | undefined =>
      agorot === undefined ? undefined : Math.round(agorot / 100);
    const base: Record<string, unknown> = {
      name: person.name,
      phone: person.phone,
      cities: person.cities,
      dealType: person.dealType,
      roomsMin: person.roomsMin,
      roomsMax: person.roomsMax,
      areaSqmMin: person.areaSqmMin,
      budgetMinShekels: shekels(person.budgetMinAgorot),
      budgetMaxShekels: shekels(person.budgetMaxAgorot),
      maturity: person.maturity,
      financing: person.financing,
      mustFeatures: featureKeys(person.features, "must"),
      niceFeatures: featureKeys(person.features, "nice"),
    };
    if (actionId === "create_lead") {
      return {
        name: base["name"],
        phone: base["phone"],
        intent: person.intent === "unknown" ? undefined : person.intent,
        summary: person.summary,
      };
    }
    /*
     * שאלה על מאגר הנכסים מדברת ב-`price*` ולא ב-`budget*`.
     *
     * אותו חילוץ אדם מספק את הערים, החדרים והסכום — "עד שני מיליון"
     * הוא אותו מספר בשתי השאלות — אבל שמות השדות שונים, ושדה שאינו
     * בסכימה נזרק ב-`narrowParams` בשקט. כלומר בלי המיפוי הזה
     * השאלה הייתה מזוהה נכון וחוזרת בלי אף קריטריון.
     */
    if (actionId === "find_properties") {
      /*
       * שני תיקונים מביקורת Codex:
       *
       * **מאפיינים** — לפעולה הזו יש שדה `mustFeatures` בלבד, ולכן
       * "עם מעלית" שחולץ כרמת „רצוי” היה נזרק ב-`narrowParams`
       * בשקט. בשאלת מלאי אין הבדל בין חובה לרצוי — המתווך אמר
       * מאפיין וציפה שהוא ישתתף בסינון — ולכן שתי הרשימות מאוחדות.
       *
       * **סוג עסקה** — חילוץ האדם מזהה עסקה רק דרך פועל של כוונה
       * ("מחפש לשכור"), ו"אילו דירות יש להשכרה" נשאר בלעדיו. בשאלת
       * מלאי המילים "להשכרה"/"למכירה" חד-משמעיות גם לבדן.
       */
      const features = [
        ...(base["mustFeatures"] as string[]),
        ...(base["niceFeatures"] as string[]),
      ];
      const dealType =
        base["dealType"] ??
        (/להשכרה|לשכור|שכירות/u.test(transcript)
          ? "rent"
          : /למכירה/u.test(transcript)
            ? "sale"
            : undefined);
      return {
        cities: base["cities"],
        dealType,
        roomsMin: base["roomsMin"],
        roomsMax: base["roomsMax"],
        priceMinShekels: base["budgetMinShekels"],
        priceMaxShekels: base["budgetMaxShekels"],
        ...(features.length > 0 ? { mustFeatures: features } : {}),
      };
    }
    if (actionId === "add_note") {
      // מנוע החוקים אינו מפריד כרטיס מהערה — השם למי, וכל המשפט כתוכן
      return { cardPhrase: base["name"], note: person.summary };
    }
    if (actionId === "update_lead_status") {
      return {
        leadPhrase: base["name"],
        leadStatus: /בטיפול/u.test(transcript)
          ? "in_progress"
          : /ממתין/u.test(transcript)
            ? "waiting_customer"
            : /סגור|תסגור|לסגור/u.test(transcript)
              ? "closed"
              : undefined,
      };
    }
    return base;
  }
}

/** הכוונות של מנוע החוקים ⟵ מזהי הקטלוג. */
const RULE_ACTION_MAP: Record<string, string | undefined> = {
  add_property: "create_property",
  add_buyer: "create_buyer",
  add_lead: "create_lead",
  schedule_appointment: "schedule_appointment",
  add_task: "create_task",
  query_buyers: "find_buyers",
  query_properties: "find_properties",
  show_schedule: "show_schedule",
  show_tasks: "show_tasks",
  show_calls: "show_calls",
  show_deals: "show_deals",
  office_report: "office_report",
  complete_task: "complete_task",
  add_note: "add_note",
  update_lead_status: "update_lead_status",
  share_property: "share_property",
  share_buyer: "share_buyer",
  send_offer: "send_offer",
  search: "search",
  unknown: undefined,
};

function featureKeys(
  features: Partial<Record<string, "must" | "nice">>,
  level: "must" | "nice",
): string[] {
  return Object.entries(features)
    .filter(([, value]) => value === level)
    .map(([key]) => key);
}

/**
 * „עכשיו” כפי שהמתווך חווה אותו — לפרשנות בלבד.
 *
 * המודל מקבל את זה כדי להבין ש„מחר” הוא יום חמישי ולא כדי להחזיר
 * תאריך; החישוב עצמו נשאר דטרמיניסטי בשעון ירושלים.
 */
function nowInJerusalem(): string {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    dateStyle: "full",
    timeStyle: "short",
  }).format(new Date());
}
