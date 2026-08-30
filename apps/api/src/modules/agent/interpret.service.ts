import { Injectable, Logger } from "@nestjs/common";
import {
  AGENT_ACTIONS,
  agentAction,
  type AgentHistoryTurn,
  buildInterpretPrompt,
  extractPersonFromTranscript,
  extractPropertyFromTranscript,
  interpretJsonSchema,
  InterpretResponseSchema,
  mayUseAction,
  narrowParams,
  routeVoiceCommand,
  stripCommandPrefix,
  taskTitleFromTranscript,
  type AgentActionDef,
} from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { GeminiService, type GeminiUsage } from "../../core/gemini.service";
import { AgentEventsService } from "./agent-events.service";

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
  /** תשובה שיחתית לברכה/שאלה כללית — תצוגה בלבד, במקום "לא הבנתי" */
  reply?: string;
  /**
   * הפעולות הקרובות ל„לא הבנתי” — מוצעות ואינן מבוצעות.
   *
   * מסוננות למה שלמשתמש **מותר**: הצעה שתיחסם בביצוע גרועה מהיעדר
   * הצעה, כי היא נראית כמו דרך החוצה ואינה.
   */
  suggest: string[];
  /**
   * מילות המועד של הפעולה הראשית, כפי שהמודל שמע אותן.
   *
   * הקוד מחשב מהן את התאריך; בלעדיהן הוא סורק את המשפט המלא כרשת
   * ביטחון. ראו `AgentResolveService`.
   */
  dateText?: string;
  /** true = מנוע החוקים הכריע, כלומר Gemini לא היה זמין */
  fallback: boolean;
  /** צעדי המשך — כשהמשפט ביקש כמה פעולות. מותרים ומצומצמים כמו הראשי. */
  steps: {
    actionId: string;
    params: Record<string, unknown>;
    rejected: string[];
    /** מילות המועד של הצעד הזה בלבד — הקוד מחשב מהן את התאריך */
    dateText?: string;
  }[];
}

@Injectable()
export class AgentInterpretService {
  private readonly logger = new Logger(AgentInterpretService.name);

  constructor(
    private readonly gemini: GeminiService,
    private readonly events: AgentEventsService,
  ) {}

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
    return AGENT_ACTIONS.filter((action) => mayUseAction(action, ctx.capabilities));
  }

  async interpret(
    transcript: string,
    prior?: { action: string; params: Record<string, unknown> },
    history?: AgentHistoryTurn[],
    /** מאיפה הפקודה הגיעה — ליומן המשימות, ולניסוח התשובה השיחתית */
    channel: "web" | "whatsapp" = "web",
    /** מי מדבר — שם ותפקיד. ההיקף נגזר מהיכולות ולא מהקורא. */
    speaker?: { name?: string; roleLabel?: string },
    /**
     * הפעולה שהמתווך בחר מתוך ההצעות שאחרי „לא הבנתי”.
     *
     * ‎**נאכפת כאן ולא רק מוצעת למודל.** הבחירה היא של המתווך, ומודל
     * שיחזיר פעולה אחרת יעקוף אותה בשקט — בדיוק ההתנהגות שהופכת
     * כפתור לניחוש. הרשאה נבדקת כרגיל: בחירה אינה מרחיבה הרשאות.
     */
    pin?: string,
  ): Promise<Interpretation> {
    const allowed = this.allowedActions();
    const pinned =
      pin !== undefined && allowed.some((a) => a.id === pin) ? pin : undefined;
    const attempt = await this.viaLlm(
      transcript,
      allowed,
      prior,
      history,
      channel,
      speaker,
      pinned,
    );
    const interpretation = attempt?.interpretation ?? this.viaRules(transcript, allowed);
    /*
     * כל פירוש נרשם ביומן המשימות — גם כשה-LLM נכשל ונפלנו לחוקים,
     * כי אז נרשמת גם העלות ששולמה על הכישלון. fire-and-forget:
     * הרישום לעולם אינו מעכב את התשובה למתווך.
     */
    void this.events.record({
      channel,
      kind: "interpret",
      transcript,
      actionId: interpretation.actionId,
      payload: interpretation as unknown as Record<string, unknown>,
      source: interpretation.fallback ? "rules" : "llm",
      ...(attempt === null
        ? {}
        : {
            model: attempt.model,
            latencyMs: attempt.latencyMs,
            ...(attempt.usage === undefined ? {} : { usage: attempt.usage }),
          }),
    });
    return interpretation;
  }

  /**
   * הפירוש דרך המודל, יחד עם הנתונים התפעוליים של הקריאה.
   *
   * `null` = לא נקראה קריאה כלל (אין מפתח או אין פעולות מותרות);
   * `interpretation: null` = הקריאה נעשתה (ושולמה) אבל התשובה לא
   * שמישה — נופלים לחוקים, והעלות עדיין נרשמת ביומן.
   */
  private async viaLlm(
    transcript: string,
    allowed: AgentActionDef[],
    prior?: { action: string; params: Record<string, unknown> },
    history?: AgentHistoryTurn[],
    channel: "web" | "whatsapp" = "web",
    speaker?: { name?: string; roleLabel?: string },
    pin?: string,
  ): Promise<{
    interpretation: Interpretation | null;
    model: string;
    latencyMs: number;
    usage?: GeminiUsage;
  } | null> {
    if (allowed.length === 0) return null;
    if (!(await this.gemini.isConfigured())) return null;

    /*
     * ההיקף נגזר מהיכולות בשרת ולא מפרמטר של הקורא: „מי מחפש
     * בגבעתיים” של סוכן שרואה רק את שלו הוא שאלה אחרת מזו של בעל
     * המשרד, והמודל היה עונה על שתיהן אותו דבר.
     */
    const capabilities = TenantContext.current().capabilities;
    const scope: "all" | "own" = capabilities.has("buyers.view_all") ? "all" : "own";

    const prompt = buildInterpretPrompt(transcript, {
      nowText: nowInJerusalem(),
      allowedActions: allowed.map((a) => a.id),
      channel,
      speaker: { ...speaker, scope },
      ...(pin === undefined ? {} : { pin }),
      ...(prior ? { prior } : {}),
      ...(history !== undefined && history.length > 0 ? { history } : {}),
    });

    const detailed = await this.gemini.generateStructuredDetailed(prompt, interpretJsonSchema());
    const meta = {
      model: detailed.model,
      latencyMs: detailed.latencyMs,
      ...(detailed.usage === undefined ? {} : { usage: detailed.usage }),
    };
    const withMeta = (
      interpretation: Interpretation | null,
    ): { interpretation: Interpretation | null } & typeof meta => ({ interpretation, ...meta });
    const parsed = InterpretResponseSchema.safeParse(detailed.value);
    if (!parsed.success) return withMeta(null);

    const answer = parsed.data;
    /*
     * ‎**הנעיצה גוברת על תשובת המודל.**
     *
     * המסלול היחיד לכאן הוא לחיצה של המתווך על שם פעולה שהוצג לו,
     * ולכן הבחירה כבר נעשתה — על ידו. מודל שיחזיר משהו אחר (או
     * ‎`unknown` שוב, על משפט שבאמת אין בו שדות) היה מבטל בשקט את
     * הלחיצה, וזה בדיוק מה שהופך כפתור לניחוש. מה שנלקח ממנו כאן
     * הוא השדות בלבד; ההרשאה לפעולה כבר נבדקה אצל הקורא, והביצוע
     * בודק אותה שוב.
     */
    const chosenId = pin ?? answer.action;
    if (chosenId === "unknown") {
      /*
       * לא נופלים לחוקים כאן. המודל ראה את כל הפעולות ואת הדוגמאות
       * שלהן ואמר במפורש שאינו יודע; מנוע החוקים, שמזהה ביטויים
       * רגולריים, אינו מקור סמכות טוב יותר ממנו — הוא היה דוחף את
       * המשפט למשבצת הקרובה וקורא לזה הבנה.
       */
      return withMeta({
        actionId: "unknown",
        params: {},
        evidence: {},
        unmapped: answer.unmapped,
        rejected: [],
        ...(answer.clarify ? { clarify: answer.clarify } : {}),
        ...(answer.reply ? { reply: answer.reply } : {}),
        /*
         * מסונן למותר, וללא כפילויות: המודל רואה רק פעולות מותרות
         * אבל „רואה” אינו „מובטח”, והצעה חסומה היא דרך יציאה מדומה.
         */
        suggest: [...new Set(answer.suggest)].filter((id) =>
          allowed.some((a) => a.id === id),
        ),
        fallback: false,
        steps: [],
      });
    }

    const action = agentAction(chosenId);
    /*
     * פעולה שהמודל בחר ואין אליה הרשאה. היא לא הייתה בפרומפט, ולכן
     * זה אמור להיות בלתי אפשרי — אבל „אמור” אינו הרשאה. עדיף לומר
     * שלא הבנו מאשר להציע פעולה שתיחסם בביצוע.
     */
    if (!action || !allowed.some((a) => a.id === action.id)) {
      this.logger.warn(`המודל בחר פעולה שאינה מותרת: ${chosenId}`);
      return withMeta(null);
    }

    const { params, rejected } = narrowParams(action, answer.params);
    if (rejected.length > 0) {
      this.logger.warn(`שדות שנפסלו ב-${action.id}: ${rejected.join(", ")}`);
    }

    /*
     * צעדי המשך עוברים את אותם שערים כמו הצעד הראשי: פעולה שאין
     * אליה הרשאה יורדת (ולא מפילה את השרשור כולו), והפרמטרים
     * מצטמצמים לסכימה של הפעולה שלהם.
     */
    /*
     * בנעיצה אין צעדי המשך: המתווך לחץ על **פעולה אחת** מתוך רשימה,
     * ולא ביקש שרשור. צעד שהמודל היה מוסיף כאן הוא פעולה שאיש לא
     * בחר, נגררת אחרי לחיצה על אחרת.
     */
    const steps = (pin !== undefined ? [] : answer.steps).flatMap((step) => {
      const stepAction = agentAction(step.action);
      if (!stepAction || !allowed.some((a) => a.id === stepAction.id)) {
        this.logger.warn(`צעד המשך לפעולה שאינה מותרת: ${step.action}`);
        return [];
      }
      const narrowed = narrowParams(stepAction, step.params);
      return [
        {
          actionId: stepAction.id,
          params: narrowed.params,
          rejected: narrowed.rejected,
          ...(step.dateText !== undefined && step.dateText.trim() !== ""
            ? { dateText: step.dateText.trim() }
            : {}),
        },
      ];
    });

    return withMeta({
      actionId: action.id,
      params,
      // ראיה לשדה שנפסל היא ראיה למשהו שלא נכנס — מטעה יותר משימושית
      evidence: Object.fromEntries(
        Object.entries(answer.evidence).filter(([key]) => key in params),
      ),
      unmapped: answer.unmapped,
      rejected,
      ...(answer.clarify ? { clarify: answer.clarify } : {}),
      ...(answer.dateText !== undefined && answer.dateText.trim() !== ""
        ? { dateText: answer.dateText.trim() }
        : {}),
      // פעולה נבחרה — אין „אולי התכוונת”; ההצעות שייכות ל„לא הבנתי” בלבד
      suggest: [],
      fallback: false,
      steps,
    });
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
        /*
         * מנוע החוקים אינו יודע „מה כמעט התאים” — הוא מתאים ביטויים
         * ולא מודד קרבה. הצעה שהיה מייצר הייתה הפעולה שהתבנית שלה
         * הכי דומה, לא הפעולה שהמתווך התכוון אליה.
         */
        suggest: [],
        fallback: true,
        steps: [],
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
      suggest: [],
      fallback: true,
      steps: [],
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
      /*
       * "תוסיף הערה למשה כהן שהוא נוסע לחו״ל" — הכרטיס הוא מה שאחרי
       * ה-ל', וההערה היא מה שאחרי השם. הגרסה הקודמת שלחה את **כל
       * המשפט** כולל מילות הפקודה כתוכן ההערה, ולא זיהתה למי בכלל
       * (דיווח המשתמש — הכרטיס לא הראה אצל מי הולכים לשנות).
       */
      const clean = transcript.replace(/\s+/gu, " ").trim();
      const match =
        /הערה\s+(?:ל|אצל\s+|על\s+)(?:הליד\s+של\s+|הקונה\s+|הכרטיס\s+של\s+|משפחת\s+)?(?<name>[א-ת]+(?:\s+[א-ת]+)?)\s*(?<rest>.*)$/u.exec(
          clean,
        );
      let cardPhrase = match?.groups?.["name"];
      let note = match?.groups?.["rest"]?.trim() ?? "";
      /*
       * "דנה שהיא…" — המילה השנייה היא פסוקית זיקה, לא שם משפחה.
       * הבדיקה מול פתיחי פסוקית מפורשים ולא כל מילה שמתחילה ב-ש':
       * "משה שלום" הוא שם מלא, ו"שלום" שנקרע ממנו היה משבש גם את
       * החיפוש וגם את ההערה (ביקורת Codex).
       */
      const tokens = cardPhrase?.split(" ") ?? [];
      if (tokens.length === 2 && CLAUSE_OPENER.test(tokens[1]!)) {
        cardPhrase = tokens[0]!;
        note = `${tokens[1]!} ${note}`.trim();
      }
      // "שהוא נוסע" ⟵ "הוא נוסע" — ש' החיבור אינה חלק מהתוכן
      if (CLAUSE_OPENER.test(note)) note = note.slice(1);
      return {
        cardPhrase: cardPhrase ?? base["name"],
        note: note !== "" ? note : person.summary,
      };
    }
    if (actionId === "update_lead_status") {
      // "תעדכן את הליד של דני לבטיפול" — השם אחרי "הליד של", לפני מילת הסטטוס
      const leadMatch = /ה?ליד\s+(?:של\s+)?(?<name>[א-ת]+(?:\s+[א-ת]+)?)/u.exec(transcript);
      let leadPhrase = leadMatch?.groups?.["name"];
      const leadTokens = leadPhrase?.split(/\s+/u) ?? [];
      if (leadTokens.length === 2 && /^ל?(?:בטיפול|ממתין|סגור|חדש)/u.test(leadTokens[1]!)) {
        leadPhrase = leadTokens[0]!;
      }
      return {
        leadPhrase: leadPhrase ?? base["name"],
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

/**
 * פתיחי פסוקית זיקה — "שהוא", "שרוצה", "שיש"… רשימה סגורה בכוונה:
 * כל מילה שמתחילה ב-ש' אינה פסוקית ("שלום", "שרה"), והכרעה רחבה
 * מדי קורעת שמות משפחה אמיתיים.
 */
const CLAUSE_OPENER =
  /^ש(?:הוא|היא|הם|הן|יש|אין|צריך|צריכה|רוצה|רוצים|מחפש|מחפשת|ביקש|ביקשה|אמר|אמרה)/u;

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
  show_callbacks: "show_callbacks",
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
