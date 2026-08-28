"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  agentHistorySummary,
  agentReplySegments,
  agentResultRefs,
  agentTurnRefs,
  proposalRunsImmediately,
  type AgentHistoryRef,
} from "@metavchim/shared";
import { Button } from "@metavchim/ui";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { useUserDismissed } from "@/lib/dismissed-panels";
import { useRequireAuth } from "@/lib/use-auth";
import { IconMic, IconTarget } from "../icons";
import { VoiceRecorder } from "../voice-recorder";
import { AgentResults } from "./results";
import { ProposalCard, type ExecuteResult, type Proposal } from "./proposal-card";

/**
 * הסוכן — **צ'אט, לא טופס.**
 *
 * ## מה השתנה, ולמה
 *
 * הגלגול הקודם היה „משפט אחד נכנס, הצעה אחת יוצאת”: כל שאלה החליפה
 * את הקודמת על המסך, והשיחה — שהשרת כבר זכר (`history`) — לא נראתה.
 * בקשת בעל המוצר: שהסוכן במערכת יעבוד כמו צ'אט, כמו שהוא עובד
 * בוואטסאפ. עכשיו כל תור הוא בועה בשרשור: מה שנאמר, מה שהוצע, מה
 * שבוצע — נשארים על המסך, ו„ומה עם רמת גן?” נקרא כמו ההמשך שהוא.
 *
 * ## מה נשאר בדיוק כפי שהיה
 *
 * - **הפרדת הבנה⟵אישור.** `interpret` מציע, כרטיס ההצעה מוצג בתוך
 *   השרשור, ופעולה כותבת מבוצעת רק בלחיצה. הצ'אט משנה את הצורה,
 *   לא את הגבול.
 * - **שאילתה רצה מיד.** זה היה הכלל המוצהר של הקטלוג („`read` רץ
 *   מיד ומציג תשובה”) והמסך דווקא ביקש לחיצה — בצ'אט זה סוף סוף
 *   נכון: מי ששאל שאלה מקבל תשובה, לא כרטיס „הצג תשובה”. כרטיס
 *   מוצג לשאילתה רק כשיש מה להכריע — מועמדים או הבהרה.
 * - **זיכרון השיחה** — אותם שישה תורות, אותם `refs`, אותה גזירה
 *   משותפת עם וואטסאפ.
 *
 * ## מה השתנה בכוונה
 *
 * פעולה שיצרה רשומה כבר **אינה מנווטת** מהצ'אט החוצה: ניווט אוטומטי
 * זרק את המתווך מהשיחה באמצע („תוסיף קונה… ועכשיו תקבע לו סיור”
 * דורש להישאר). הקישור לכרטיס מוצג בבועה, והבחירה לעבור היא שלו.
 */

interface AgentCapability {
  id: string;
  title: string;
  examples: readonly string[];
}

/** תור בשיחה — נשלח לשרת כהקשר למשפטי המשך ("ומה עם רמת גן?"). */
interface HistoryTurn {
  transcript: string;
  action: string;
  /** ‎`"assistant"` = תור דיווח שהסוכן יזם (התראה) — לא משפט של המתווך */
  origin?: "user" | "assistant";
  params: Record<string, unknown>;
  resultSummary?: string;
  /**
   * ההפניות לרשומות שהוצגו — תווית ומזהה. המזהה נשאר בין הדפדפן
   * לשרת ו**אינו** נכתב לפרומפט: הוא מה שהופך „הראשון מהם” לרשומה
   * בלי לחפש את התווית כטקסט.
   */
  refs?: AgentHistoryRef[];
}

interface Recommendation {
  priority: number;
  type: string;
  title: string;
  body: string;
  entityType?: "property" | "lead" | "buyer" | "offer" | "appointment";
  entityId?: string;
}

function recHref(rec: Recommendation): string | null {
  if (!rec.entityId) return null;
  switch (rec.entityType) {
    case "property":
      return `/properties/${rec.entityId}`;
    case "lead":
      return `/leads/${rec.entityId}`;
    case "buyer":
      return `/buyers/${rec.entityId}`;
    case "appointment":
      return "/calendar";
    default:
      return null;
  }
}

/**
 * פריט אחד בשרשור. הצעה שהוכרעה אינה נמחקת אלא מסומנת — שיחה
 * שמעלימה את מה שאושר בה מאבדת את היכולת לגלול ולהבין מה קרה.
 */
type ChatItem =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "agent"; kind: "reply"; result: ExecuteResult }
  | { id: number; role: "agent"; kind: "note"; tone: "info" | "danger"; text: string }
  /** תור משוחזר מהשיחה השמורה — תקציר, בלי הנתונים המלאים */
  | { id: number; role: "agent"; kind: "recap"; text: string }
  | {
      id: number;
      role: "agent";
      kind: "proposal";
      proposal: Proposal;
      transcript: string;
      /** `superseded` — נענה בניסוח חדש בהודעה הבאה, לא בוטל */
      settled?: "confirmed" | "cancelled" | "superseded";
    };

let nextId = 1;
const itemId = (): number => nextId++;

/*
 * `Omit` על איחוד מתמוטט למאפיינים המשותפים בלבד — מפזרים אותו על
 * כל ענף כדי ש-`push` יקבל כל צורת פריט בלי `id`.
 */
type NewChatItem = ChatItem extends infer T ? (T extends ChatItem ? Omit<T, "id"> : never) : never;

export default function AgentPage(): React.JSX.Element {
  const { loading: authLoading } = useRequireAuth();
  const [transcript, setTranscript] = useState("");
  const [thread, setThread] = useState<ChatItem[]>([]);
  const [examples, setExamples] = useState<string[]>([]);
  /*
   * „אל תציג יותר” על הדוגמאות — העדפה שנשמרת למשתמש, בכל מכשיר.
   * היא שרדה את המעבר לצ'אט: מי שסגר אותן לפניו לא מקבל אותן שוב
   * רק כי הן עברו לבועת הפתיחה (ביקורת Codex).
   */
  const examplesBox = useUserDismissed("agent-examples");
  /**
   * זיכרון השיחה — רק מה ש**בוצע**, לא כל מה שהוצע. הצעה שבוטלה
   * אינה הקשר; פעולה שנעשתה כן. שישה תורות אחרונים מספיקים
   * ל"ומה עם…" בלי לנפח את הפרומפט.
   */
  const [history, setHistory] = useState<HistoryTurn[]>([]);
  // "כדאי לטפל היום" — הסוכן פותח ביוזמה, לא רק ממתין לפקודה
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [busy, setBusy] = useState(false);
  /**
   * ההצעה שממתינה לתיקון — „לא, 4 חדרים”. נשלחת עם המשפט הבא כדי
   * שהמודל יתקן במקום להתחיל מאפס. מתאפסת ברגע שנשלחה.
   */
  const [priorForRefine, setPriorForRefine] = useState<{
    action: string;
    params: Record<string, unknown>;
  } | null>(null);
  /**
   * הקראת התשובות בקול — העדפה של המכשיר (כמו עוצמת שמע), לא של
   * החשבון: מי שמדליק באוזניות במשרד לא רוצה שהטלפון יקריא בבית לקוח.
   */
  const [tts, setTts] = useState(false);
  useEffect(() => {
    try {
      setTts(localStorage.getItem("agent-tts") === "on");
    } catch {
      /* דפדפן שחוסם אחסון — נשאר כבוי */
    }
  }, []);
  const speakOut = useCallback(
    (text: string) => {
      if (!tts || text.trim() === "" || typeof window === "undefined") return;
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "he-IL";
        window.speechSynthesis.speak(utterance);
      } catch {
        /* דפדפן בלי תמיכה — ההקראה פשוט לא קוראת */
      }
    },
    [tts],
  );

  /*
   * גלילה לתחתית על כל פריט חדש — שיחה שמתקדמת מחוץ למסך אינה
   * שיחה. `behavior: "smooth"` רק אחרי הפריט הראשון: טעינת העמוד
   * אינה צריכה אנימציה.
   */
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (thread.length > 0 || busy) {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [thread.length, busy]);

  /*
   * הדוגמאות נטענות מהשרת ולא מוקלדות כאן: נגזרות מהקטלוג ומסוננות
   * לפי ההרשאות, ולכן מי שאין לו הרשאת שליחה אינו רואה „שלח את
   * הדירה למשה”. שש נבחרות ולא כל הקטלוג — קיר צ'יפים איש אינו קורא.
   */
  /*
   * ‎**השיחה נמשכת — מהשרת, לא מאפס.**
   *
   * אותה שורה שהוואטסאפ כותב אליה: שיחה שהתחילה שם נמשכת כאן,
   * ורענון הדף אינו מוחק את ההקשר. התורות השמורים נזרעים גם
   * כזיכרון (ל„ומה עם רמת גן?”) וגם כבועות תקציר בראש השרשור —
   * תקציר ולא התוצאה המלאה, כי רק הוא נשמר.
   */
  useEffect(() => {
    if (authLoading) return;
    apiGet<{ turns: HistoryTurn[] }>("/agent/conversation")
      .then(({ turns }) => {
        if (turns.length === 0) return;
        setHistory(turns.slice(-6));
        setThread((prev) => [
          ...turns.flatMap((turn): ChatItem[] =>
            /*
             * תור התראה הוא דיווח של הסוכן („עדכנתי אותך על…”) —
             * בועה אחת שלו; הצגתו כבועת מתווך הייתה שמה בפיו מילים
             * שהוא לא אמר.
             */
            turn.origin === "assistant"
              ? [{ id: itemId(), role: "agent", kind: "recap", text: turn.transcript }]
              : [
                  { id: itemId(), role: "user", text: turn.transcript },
                  {
                    id: itemId(),
                    role: "agent",
                    kind: "recap",
                    text: turn.resultSummary ?? "בוצע.",
                  },
                ],
          ),
          ...prev,
        ]);
      })
      .catch(() => undefined); // אין שיחה שמורה — מתחילים נקי
  }, [authLoading]);

  useEffect(() => {
    if (authLoading) return;
    const FEATURED = [
      "search",
      "find_buyers",
      "create_buyer",
      "create_property",
      "create_task",
      "share_property",
    ];
    apiGet<AgentCapability[]>("/agent/capabilities")
      .then((caps) => {
        const featured = caps.filter((cap) => FEATURED.includes(cap.id));
        const rest = caps.filter((cap) => !FEATURED.includes(cap.id));
        const picked = [...featured, ...rest].slice(0, 6);
        setExamples(picked.map((cap) => cap.examples[0]).filter(Boolean) as string[]);
      })
      .catch(() => setExamples([]));
    // אותן המלצות של המאמן בדשבורד — שלוש הדחופות, כפתיחה יזומה
    apiGet<Recommendation[]>("/coach/recommendations")
      .then((all) => setRecs(all.slice(0, 3)))
      .catch(() => setRecs([]));
  }, [authLoading]);

  const push = useCallback((item: NewChatItem): void => {
    setThread((prev) => [...prev, { ...item, id: itemId() } as ChatItem]);
  }, []);

  /**
   * תור שבוצע נכנס לזיכרון, עם הפרמטרים **שנשלחו בפועל** — כולל
   * עריכות ובחירת מועמד (ביקורת Codex). התקציר והשמות לפי הסדר הם
   * מה שמאפשר "תתקשר לראשון מהם" בתור הבא — אותה גזירה משותפת
   * כמו בוואטסאפ (`agentHistorySummary`, `agentTurnRefs`).
   */
  const remember = useCallback(
    (
      said: string,
      actionId: string,
      executedParams: Record<string, unknown>,
      executed: ExecuteResult,
      refs: AgentHistoryRef[],
    ): void => {
      const turn: HistoryTurn = {
        transcript: said,
        action: actionId,
        params: executedParams,
        resultSummary: agentHistorySummary(executed.message, executed.data),
        refs,
      };
      setHistory((prev) => [...prev.slice(-5), turn]);
      /*
       * התור נרשם גם לשיחה השמורה בשרת — זו שהוואטסאפ קורא. כשל
       * ברישום אינו מפיל את השיחה שעל המסך: ההקשר המקומי כבר עודכן,
       * ורק ההמשכיות בין הערוצים מפסידה תור אחד.
       */
      void apiPost("/agent/conversation/turn", turn).catch(() => undefined);
    },
    [],
  );

  /** תוצאת ביצוע ⟵ בועת תשובה + זיכרון + הקראה. */
  const settle = useCallback(
    (
      said: string,
      actionId: string,
      executed: ExecuteResult,
      executedParams?: Record<string, unknown>,
      refs?: AgentHistoryRef[],
    ): void => {
      if (executed.message === "") return; // בוטל — הסימון נעשה אצל הקורא
      if (actionId !== "unknown" && executedParams !== undefined) {
        remember(said, actionId, executedParams, executed, refs ?? []);
      }
      push({ role: "agent", kind: "reply", result: executed });
      // ההקראה: המסקנה והתובנה, לא רשימת הנתונים כולה
      speakOut([executed.message, executed.insight].filter(Boolean).join(". "));
    },
    [push, remember, speakOut],
  );

  /** הצעה בשרשור הוכרעה — מסומנת, לא נמחקת. */
  const markSettled = useCallback((id: number, settled: "confirmed" | "cancelled" | "superseded"): void => {
    setThread((prev) =>
      prev.map((item) =>
        item.id === id && item.role === "agent" && item.kind === "proposal"
          ? { ...item, settled }
          : item,
      ),
    );
  }, []);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (text.length < 2 || busy) return;
      /*
       * ‎**תשובה לשאלה פתוחה היא תיקון, לא בקשה חדשה.**
       *
       * כשהסוכן שאל — הציג מועמדים או ביקש הבהרה — וההודעה הבאה
       * מגיעה בהקלדה, היא התשובה לשאלה: „הראשון”, „4 חדרים”. ההצעה
       * הפתוחה נשלחת כ-prior כדי שהמודל ישלים אותה במקום להתחיל
       * מאפס, והכרטיס הישן מסומן כ„נענה בהמשך” — כמו שהוואטסאפ
       * עושה עם מצב ההמתנה שלו. שאלה סגורה (הצעה רגילה) אינה
       * נגררת: משפט חדש עליה הוא באמת בקשה חדשה.
       */
      let prior = priorForRefine ?? undefined;
      if (prior === undefined) {
        const last = thread[thread.length - 1];
        if (
          last !== undefined &&
          last.role === "agent" &&
          last.kind === "proposal" &&
          last.settled === undefined &&
          (last.proposal.candidates !== undefined || last.proposal.clarify !== undefined)
        ) {
          prior = {
            action: last.proposal.actionId,
            params: Object.fromEntries(last.proposal.fields.map((f) => [f.key, f.value])),
          };
          markSettled(last.id, "superseded");
        }
      }
      setPriorForRefine(null);
      setTranscript("");
      push({ role: "user", text });
      setBusy(true);
      try {
        const proposal = await apiPost<Proposal>("/agent/interpret", {
          transcript: text,
          ...(prior ? { prior } : {}),
          ...(history.length > 0 ? { history: history.slice(-6) } : {}),
        });

        // ברכה/שאלה כללית — תשובה שיחתית, לא כרטיס "לא הבנתי"
        if (proposal.actionId === "unknown" && proposal.reply !== undefined && proposal.reply !== "") {
          push({ role: "agent", kind: "reply", result: { message: proposal.reply } });
          speakOut(proposal.reply);
          return;
        }
        if (proposal.actionId === "unknown") {
          /*
           * **למה זה נכשל, ולא רק שזה נכשל.** כשמנוע ההבנה אינו זמין
           * רץ מנוע החוקים, שמזהה ניסוחים מוכרים בלבד — בלי השורה
           * הזו הכישלון נראה כמו תקלה או כמו משפט שגוי (דיווח
           * המשתמש). "אינו זמין כרגע" ולא "אינו מוגדר": ה-fallback
           * נדלק גם על כשל רגעי של הספק (ביקורת Codex).
           */
          push({
            role: "agent",
            kind: "note",
            tone: "info",
            text: [
              proposal.clarify ?? "לא הצלחתי לזהות מה לעשות — אפשר לנסח אחרת.",
              ...(proposal.fallback
                ? [
                    "שירות ההבנה החכמה אינו זמין כרגע, ולכן זוהו רק ניסוחים מוכרים. אם זה חוזר — בדקו את ההגדרה שלו במסך ההגדרות.",
                  ]
                : []),
              ...proposal.warnings,
            ].join("\n"),
          });
          return;
        }

        /*
         * **שאילתה רצה מיד — הכלל המשותף, לא ניסוח מקומי.**
         *
         * כרטיס אישור על „מי מחפש 4 חדרים” מאמן ללחוץ בלי לקרוא.
         * מתי בכל זאת מציגים כרטיס גם על שאילתה — מועמדים, הבהרה,
         * שרשור — מוכרע ב-`proposalRunsImmediately` המשותפת לשני
         * הערוצים, כדי ששיפור בכלל יגיע לשניהם ולא ייפרד.
         */
        if (proposalRunsImmediately(proposal)) {
          const params = Object.fromEntries(
            proposal.fields.map((field) => [field.key, field.value]),
          );
          const executed = await apiPost<ExecuteResult>("/agent/execute", {
            action: proposal.actionId,
            params,
            transcript: text,
          });
          settle(
            text,
            proposal.actionId,
            executed,
            params,
            agentTurnRefs([executed.ref], agentResultRefs(executed.data)),
          );
          return;
        }

        push({ role: "agent", kind: "proposal", proposal, transcript: text });
      } catch (err: unknown) {
        push({
          role: "agent",
          kind: "note",
          tone: "danger",
          text: err instanceof ApiError ? err.message : "לא הצלחתי לנתח את הבקשה",
        });
      } finally {
        setBusy(false);
      }
    },
    [busy, history, markSettled, priorForRefine, push, settle, speakOut, thread],
  );


  if (authLoading) return <p aria-live="polite">טוען…</p>;

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mv-hero mb-4">
        <span className="mv-hero-icon" aria-hidden="true">
          <IconMic s={24} />
        </span>
        <div>
          <h1 className="m-0 text-[length:calc(26/16*1rem)] font-extrabold leading-tight">הסוכן</h1>
          <p className="m-0 mt-1 text-[length:var(--type-button)]" style={{ color: "var(--color-text-muted)" }}>
            דברו או הקלידו רגיל — כמו בצ'אט. אראה מה הבנתי לפני שאעשה משהו.
          </p>
        </div>
        <button
          type="button"
          className="ms-auto self-start"
          aria-pressed={tts}
          aria-label={tts ? "כיבוי הקראת התשובות" : "הקראת התשובות בקול"}
          title={tts ? "הקראה פועלת — לחצו לכיבוי" : "הקראת התשובות בקול"}
          style={{ color: tts ? "var(--color-primary)" : "var(--color-text-muted)", lineHeight: 0 }}
          onClick={() => {
            const next = !tts;
            setTts(next);
            try {
              localStorage.setItem("agent-tts", next ? "on" : "off");
            } catch {
              /* דפדפן שחוסם אחסון — ההעדפה תחיה עד הרענון */
            }
            if (!next && typeof window !== "undefined") window.speechSynthesis?.cancel();
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" />
            {tts ? (
              <path
                d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            ) : (
              <path
                d="M16.5 9.5l5 5m0-5l-5 5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            )}
          </svg>
        </button>
      </header>

      <div className="flex flex-col gap-3" aria-live="polite">
        {/*
          בועת הפתיחה — הסוכן פותח ביוזמה: מה כדאי לטפל בו היום
          (אותו מנוע המלצות של הדשבורד) ודוגמאות למה אפשר לבקש.
          זה תוכן השיחה הראשון, לא קופסה מעל השיחה.
        */}
        <div className="mv-chat-bubble mv-chat-agent">
          <p className="m-0 font-semibold">היי 👋 מה אפשר לעשות בשבילך?</p>
          {recs.length === 0 ? null : (
            <div className="mt-2">
              <p className="m-0 mb-1 text-[length:var(--type-caption-lg)] font-bold">
                <IconTarget s={14} /> כדאי לטפל היום:
              </p>
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {recs.map((rec) => {
                  const href = recHref(rec);
                  return (
                    <li key={`${rec.type}-${rec.entityId ?? rec.title}`} className="text-[length:var(--type-caption-lg)]">
                      <span className="font-semibold">{rec.title}</span>
                      <span style={{ color: "var(--color-text-muted)" }}> — {rec.body}</span>{" "}
                      {href === null ? null : (
                        <a href={href} className="underline">
                          לטיפול ←
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {examples.length === 0 || examplesBox.hidden ? null : (
            <div className="mt-2.5">
              <div className="flex flex-wrap gap-2">
                {examples.map((example) => (
                  <button
                    key={example}
                    type="button"
                    className="mv-example-chip"
                    onClick={() => void send(example)}
                  >
                    {example}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="mt-1.5 text-[length:var(--type-caption)] underline"
                style={{ color: "var(--color-text-muted)" }}
                onClick={examplesBox.never}
              >
                אל תציג דוגמאות יותר
              </button>
            </div>
          )}
        </div>

        {thread.map((item) => {
          if (item.role === "user") {
            return (
              <div key={item.id} className="mv-chat-bubble mv-chat-user">
                <span style={{ whiteSpace: "pre-line" }}>{item.text}</span>
              </div>
            );
          }
          if (item.kind === "recap") {
            // תקציר מהשיחה השמורה — מוקטן: מה שקרה, לא התוצאה המלאה
            return (
              <div
                key={item.id}
                className="mv-chat-bubble mv-chat-agent"
                style={{ color: "var(--color-text-muted)" }}
              >
                <span style={{ whiteSpace: "pre-line" }}>{item.text}</span>
              </div>
            );
          }
          if (item.kind === "note") {
            return (
              <div
                key={item.id}
                className="mv-chat-bubble mv-chat-agent"
                style={item.tone === "danger" ? { borderColor: "var(--color-danger)" } : undefined}
              >
                <span style={{ whiteSpace: "pre-line" }}>{item.text}</span>
              </div>
            );
          }
          if (item.kind === "proposal") {
            if (item.settled === "cancelled") {
              return (
                <div key={item.id} className="mv-chat-bubble mv-chat-agent" style={{ color: "var(--color-text-muted)" }}>
                  „{item.proposal.title}” — בוטל.
                </div>
              );
            }
            if (item.settled === "superseded") {
              // הסוכן שאל, והתשובה הגיעה בהודעה הבאה — לא ביטול
              return (
                <div key={item.id} className="mv-chat-bubble mv-chat-agent" style={{ color: "var(--color-text-muted)" }}>
                  ✏️ „{item.proposal.title}” — נענה בהמשך השיחה.
                </div>
              );
            }
            if (item.settled === "confirmed") {
              return (
                <div key={item.id} className="mv-chat-bubble mv-chat-agent" style={{ color: "var(--color-text-muted)" }}>
                  ✅ „{item.proposal.title}” אושר.
                </div>
              );
            }
            return (
              <div key={item.id} className="mv-chat-card">
                <ProposalCard
                  proposal={item.proposal}
                  transcript={item.transcript}
                  onDone={(executed, executedParams, refs) => {
                    if (executed.message === "") {
                      markSettled(item.id, "cancelled");
                      return;
                    }
                    markSettled(item.id, "confirmed");
                    settle(item.transcript, item.proposal.actionId, executed, executedParams, refs);
                  }}
                  onRefine={(params) => {
                    setPriorForRefine({ action: item.proposal.actionId, params });
                    markSettled(item.id, "cancelled");
                    push({
                      role: "agent",
                      kind: "note",
                      tone: "info",
                      text: "אמרו מה לתקן — למשל „לא, 4 חדרים” או „תוסיף גם גבעתיים”",
                    });
                  }}
                />
              </div>
            );
          }
          /*
           * ‎**בועת תשובה — ההרכב והסדר מהתוכנית המשותפת.**
           *
           * ‎`agentReplySegments` מכתיב לשני הערוצים מה מופיע ומתי:
           * מסקנה⟵תובנה⟵נתונים⟵קישורים⟵צעדים, ו-`suggestion` רק
           * בהיעדר צעד נגזר. כאן רק הרינדור: כל מקטע לצורתו במסך.
           * לחיצה על צעד שולחת את המשפט כתור חדש — אותו מסלול
           * הבנה⟵אישור, כמו כפתור בוואטסאפ.
           */
          return (
            <div key={item.id} className="mv-chat-bubble mv-chat-agent">
              {agentReplySegments(item.result).map((segment, i) => {
                switch (segment.kind) {
                  case "headline":
                    return (
                      <p key={i} className="m-0" style={{ whiteSpace: "pre-line" }}>
                        {segment.text}
                      </p>
                    );
                  case "insight":
                    return (
                      <p
                        key={i}
                        className="mb-0 mt-2 rounded-lg px-3 py-2 text-[length:var(--type-body-sm)] font-semibold"
                        style={{ background: "var(--color-primary-soft)" }}
                      >
                        {segment.text}
                      </p>
                    );
                  case "data":
                    return (
                      <div key={i} className="mt-2">
                        <AgentResults data={segment.data} />
                      </div>
                    );
                  /*
                   * הניווט הוא הצעה, לא כפייה: הקישור מוצג והמעבר
                   * הוא בחירה — לא זריקה מהשיחה באמצע.
                   */
                  case "screen-link":
                    return (
                      <p key={i} className="m-0 mt-2 text-[length:var(--type-body-sm)]">
                        <a href={segment.href} className="underline">
                          למסך המלא ←
                        </a>
                      </p>
                    );
                  case "external-link":
                    return (
                      <p key={i} className="m-0 mt-2 text-[length:var(--type-body-sm)]">
                        <a href={segment.url} target="_blank" rel="noreferrer" className="underline">
                          פתיחה בוואטסאפ ←
                        </a>
                      </p>
                    );
                  case "steps":
                    return (
                      <div key={i} className="mt-2 flex flex-wrap gap-2">
                        {segment.steps.map((step) => (
                          <button
                            key={step.text}
                            type="button"
                            className="mv-example-chip"
                            disabled={busy}
                            onClick={() => void send(step.text)}
                          >
                            {step.label} — „{step.text}”
                          </button>
                        ))}
                      </div>
                    );
                  case "suggestion":
                    return (
                      <button
                        key={i}
                        type="button"
                        className="mv-example-chip mt-2"
                        disabled={busy}
                        onClick={() => void send(segment.text)}
                      >
                        אפשר להמשיך: „{segment.text}”
                      </button>
                    );
                }
              })}
            </div>
          );
        })}

        {/* מחוון הקלדה — הסוכן „חושב” נראה, לא כפתור קפוא */}
        {busy ? (
          <div className="mv-chat-bubble mv-chat-agent" aria-label="הסוכן חושב">
            <span className="mv-chat-typing" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      <div className="mt-4">
        <VoiceRecorder
          value={transcript}
          onChange={setTranscript}
          rows={2}
          label="מה לעשות?"
          placeholder='למשל: "מי מחפש 4 חדרים בגבעתיים?" · Enter שולח, Shift+Enter יורד שורה'
          onError={(message) => push({ role: "agent", kind: "note", tone: "danger", text: message })}
          onSubmit={() => void send(transcript)}
        />
        {/*
          הכפתור מנוטרל עד שיש מה לשלוח — לחיצה על „שליחה” ריקה
          שחוזרת בשקט נראית כמו כפתור שבור (ביקורת Codex). המינימום
          זהה לזה של `send`, כדי ששניהם יסכימו תמיד.
        */}
        <Button
          onClick={() => void send(transcript)}
          disabled={busy || transcript.trim().length < 2}
          className="w-full"
        >
          {busy ? "חושב…" : "שליחה"}
        </Button>
      </div>
    </div>
  );
}
