import { groundedNumbers } from "../agent/insight-guard.js";
import type { CallHighlights, CallSummary } from "./call-summary.js";

/**
 * ‎**מה שמודל השפה מוסיף לשיחה מוקלטת — ומה שהוא לא מורשה להוסיף.**
 *
 * ## מה היה חסר
 *
 * התמלול הגיע כגוש טקסט אחד. `formatDiarizedTranscript` יודע לפצל
 * אותו לתורות, אבל רק כששירות ה-diarization רץ — והוא כבוי כברירת
 * מחדל (`DIARIZE_URL` מסומן כהערה ב-`.env.production.example`). גם
 * כשהוא רץ, מה שהוא יודע לומר הוא „דובר 1” ו„דובר 2”.
 *
 * ‎**„דובר 2 אמר שהתקציב 2.4 מיליון” הוא כמעט חסר ערך.** מה שמתווך
 * צריך לדעת הוא אם זה הוא אמר או הלקוח — כי אחד מהם מציע ואחד
 * מבקש. מודל שפה יודע להכריע את זה מהתוכן, וזה הדבר היחיד כאן
 * שדורש הבנה ולא התאמת תבנית.
 *
 * ## מה שנשאר מהחילוץ הישן, ולמה
 *
 * ‎`summarizeCall` נשאר ורץ תמיד. הוא לא נשען על רשת, לא עולה כסף
 * ולא ממציא — וכשהמודל אינו מוגדר, נכשל, או מחזיר תשובה שנפסלת,
 * השיחה עדיין מקבלת סיכום. זה בדיוק מה שההערה בראש `call-summary.ts`
 * ניבאה: „כשיחובר ספק LLM אפשר יהיה להוסיף שכבה מעליו; הבסיס הזה
 * יישאר כרשת ביטחון”.
 *
 * ## שלוש הגנות מפני המצאה
 *
 * מודל שנשמע חכם וממציא פרט אחד גרוע ממשפט יבש שכולו נכון — המתווך
 * יסתמך עליו מול הלקוח. לכן:
 *
 * 1. ‎**כל מספר נבדק מול התמלול** (`groundedNumbers`). תקציב, חדרים
 *    או מ"ר שלא נאמרו — נזרקים, לא מתוקנים.
 * 2. ‎**התורות אינן ניסוח מחדש.** המודל מפצל ומתייג בלבד, ואם אורך
 *    הטקסט שהוא החזיר רחוק מהמקור — הוא כתב מחדש, והתורות נפסלות.
 * 3. ‎**כל ערך חסום בטווח שפוי.** „14 חדרים” אפשרי, „140” הוא שגיאת
 *    פענוח.
 */

/** תור אחד בשיחה, מתויג בתפקיד ולא במספר. */
export interface CallIntelTurn {
  /**
   * ‎`agent` = המתווך, `client` = מי שמולו.
   *
   * ‎`other` קיים בשביל מה שבאמת קורה בשיחות: מענה קולי, בן זוג
   * שנכנס לרגע, מזכירה שמעבירה. אילוץ לשניים היה מדביק את זה על
   * אחד מהם.
   */
  role: "agent" | "client" | "other";
  text: string;
}

export interface CallIntel {
  turns: CallIntelTurn[];
  /** שורת הסיכום — מה שמתווך היה רושם בפנקס. */
  summary: string;
  highlights: CallHighlights;
  suggestedOutcome: CallSummary["suggestedOutcome"];
}

/** התוויות שמוצגות לפני כל תור. */
export const CALL_ROLE_LABELS: Record<CallIntelTurn["role"], string> = {
  agent: "מתווך",
  client: "לקוח",
  other: "אחר",
};

/* ==================== גבולות ==================== */

const SUMMARY_MAX = 400;
const TEXT_MAX = 2_000;
const LIST_MAX = 6;
const LIST_ITEM_MAX = 60;
const TURNS_MAX = 400;

/**
 * טווחים שפויים. הם אינם „ולידציה של קלט” אלא **מסננת פענוח**:
 * המודל קורא תמלול אוטומטי, ותמלול אוטומטי טועה בספרות.
 */
const RANGES = {
  // שכירות מתחילה באלפים בודדים, רכישה מגיעה לעשרות מיליונים
  budget: [1_000, 500_000_000],
  rooms: [1, 20],
  areaSqm: [5, 10_000],
} as const;

function inRange(value: number, key: keyof typeof RANGES): boolean {
  const [min, max] = RANGES[key];
  return Number.isFinite(value) && value >= min && value <= max;
}

function text(value: unknown, max = LIST_ITEM_MAX): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.trim().replace(/\s+/gu, " ");
  return clean === "" ? undefined : clean.slice(0, max);
}

function list(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .map((item) => text(item))
    .filter((item): item is string => item !== undefined)
    .slice(0, LIST_MAX);
  return items.length > 0 ? items : undefined;
}

/** מספר שנאמר בתמלול ונמצא בטווח. שתי הבדיקות, לא אחת. */
function grounded(value: unknown, key: keyof typeof RANGES, transcript: string): number | undefined {
  const n = typeof value === "number" ? value : Number(value);
  if (!inRange(n, key)) return undefined;
  return groundedNumbers(String(n), [transcript]) ? n : undefined;
}

/* ==================== הסכמה שנשלחת למודל ==================== */

const STR = { type: "string" } as const;

/**
 * ‎`responseSchema` של Gemini — מה שהופך „בערך JSON” ל-JSON.
 *
 * בלעדיו המודל מחזיר לפעמים מחרוזת במקום מספר וממציא ערך ל-enum.
 * שום שדה אינו `required`: פרט שלא נאמר בשיחה **צריך** להיעדר,
 * וסכמה שדורשת אותו מזמינה את המודל להמציא אותו.
 */
export const CALL_INTEL_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    turns: {
      type: "array",
      items: {
        type: "object",
        properties: {
          role: { type: "string", enum: ["agent", "client", "other"] },
          text: STR,
        },
      },
    },
    summary: STR,
    outcome: { type: "string", enum: ["interested", "not_fit", "callback"] },
    side: { type: "string", enum: ["buyer", "seller", "renter", "landlord"] },
    propertyType: STR,
    city: STR,
    neighborhood: STR,
    address: STR,
    budget: { type: "number" },
    rooms: { type: "number" },
    areaSqm: { type: "number" },
    timeline: STR,
    motivation: STR,
    financing: STR,
    callback: STR,
    exclusivity: { type: "boolean" },
    features: { type: "array", items: STR },
    objections: { type: "array", items: STR },
    commitments: { type: "array", items: STR },
  },
};

/* ==================== ההנחיה ==================== */

/** ההקשר שהמערכת כבר יודעת — כדי שהמודל לא ינחש אותו. */
export interface CallIntelContext {
  /** ‎`outbound` = המתווך יזם. זה כמעט תמיד מי שפותח בדיבור. */
  direction?: "inbound" | "outbound" | undefined;
  /** שם המתווך, כשידוע — עוזר לזהות מי הוא בתמלול. */
  agentName?: string | undefined;
  /** שם הלקוח, כשידוע. */
  contactName?: string | undefined;
}

export function buildCallIntelPrompt(transcript: string, context: CallIntelContext = {}): string {
  const hints: string[] = [];
  if (context.direction === "outbound") {
    hints.push("- השיחה יוצאת: המתווך הוא שהתקשר, ולרוב הוא שפותח.");
  }
  if (context.direction === "inbound") {
    hints.push("- השיחה נכנסת: הלקוח הוא שהתקשר.");
  }
  if (context.agentName) hints.push(`- שם המתווך: ${context.agentName}`);
  if (context.contactName) hints.push(`- שם הלקוח: ${context.contactName}`);

  return [
    "אתה עוזר של מתווך נדל\"ן בישראל. לפניך תמלול אוטומטי של שיחת טלפון.",
    "",
    "## מה לעשות",
    "",
    "1. **פצל את התמלול לתורות דיבור וסמן מי דיבר** — `agent` למתווך, `client` למי שמולו, `other` למענה קולי או לאדם שלישי.",
    "   העתק את הטקסט **כמו שהוא**. אל תנסח מחדש, אל תתקן ואל תקצר — רק פצל ותייג.",
    "2. **כתוב `summary`** — שתיים עד שלוש שורות בעברית, מה שמתווך היה רושם בפנקס אחרי השיחה:",
    "   מה הלקוח מחפש או מוכר, מה הסיכום המעשי, ומה הצעד הבא. בלי פתיחות כמו \"בשיחה זו\".",
    "3. **חלץ את השדות** שנאמרו בשיחה.",
    "",
    "## הכלל החשוב ביותר",
    "",
    "**אל תמציא.** שדה שלא נאמר בשיחה — השמט אותו לגמרי. אל תנחש תקציב מסוג הנכס,",
    "אל תסיק עיר משכונה, ואל תשלים מספר שנשמע חלקי. תמלול אוטומטי משבש ספרות;",
    "אם אינך בטוח במספר — אל תחזיר אותו. עדיף שדה חסר על שדה שגוי.",
    "",
    "## הבהרות על השדות",
    "",
    "- `side` — הצד שבו **הלקוח** עומד: קונה, מוכר, שוכר או משכיר. זה השדה החשוב ביותר.",
    "- `budget` — בשקלים, מספר שלם. \"שני מיליון וחצי\" הוא 2500000.",
    "- `commitments` — מה שהמתווך הבטיח לעשות, לא מה שהלקוח ביקש.",
    "- `objections` — מה שהרתיע את הלקוח.",
    "- `exclusivity` — רק אם דובר על בלעדיות במפורש.",
    "- `outcome` — `interested` / `not_fit` / `callback`. אם אין איתות ברור, השמט.",
    ...(hints.length > 0 ? ["", "## מה שידוע מראש", "", ...hints] : []),
    "",
    "## התמלול",
    "",
    transcript,
  ].join("\n");
}

/* ==================== פענוח התשובה ==================== */

/**
 * ‎**התורות מתקבלות רק אם הן פיצול, לא כתיבה מחדש.**
 *
 * הבקשה היא להעתיק את הטקסט ולתייג אותו. מודל שמנסח מחדש מייצר
 * תמלול שנראה טוב יותר ואינו מה שנאמר — וזה בדיוק מה שאסור בתיעוד
 * שיחה. אורך מצטבר שרחוק מהמקור הוא הסימן הזול והאמין לכך.
 *
 * הסף רחב בכוונה (‎±25%): פיצול לגיטימי מוסיף ומוריד רווחים, והמודל
 * משמיט „אהה” ו„אמ”. מה שנתפס כאן הוא סטייה של קיצור או המצאה.
 */
function turnsAreFaithful(turns: readonly CallIntelTurn[], transcript: string): boolean {
  const source = transcript.replace(/\s+/gu, "").length;
  if (source === 0) return false;
  const got = turns.reduce((sum, turn) => sum + turn.text.replace(/\s+/gu, "").length, 0);
  return got >= source * 0.75 && got <= source * 1.25;
}

function parseTurns(value: unknown, transcript: string): CallIntelTurn[] {
  if (!Array.isArray(value)) return [];
  const turns: CallIntelTurn[] = [];
  for (const raw of value.slice(0, TURNS_MAX)) {
    const row = raw as { role?: unknown; text?: unknown };
    const body = text(row.text, TEXT_MAX);
    if (body === undefined) continue;
    const role =
      row.role === "agent" || row.role === "client" || row.role === "other" ? row.role : "other";
    turns.push({ role, text: body });
  }
  /*
   * תור אחד בלבד אינו הפרדה — הוא הטקסט המקורי עם תווית. הוא נפסל
   * כדי שהמסך יציג תמלול רגיל במקום „מתווך:” על כל השיחה.
   */
  if (turns.length < 2) return [];
  return turnsAreFaithful(turns, transcript) ? turns : [];
}

/**
 * תשובת המודל ⟵ `CallIntel`, או `null` כשאין בה דבר שימושי.
 *
 * ‎`transcript` נדרש כאן ולא רק לפרומפט: הוא מקור האמת שכל מספר
 * נבדק מולו.
 */
export function parseCallIntel(raw: unknown, transcript: string): CallIntel | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;

  const highlights: CallHighlights = {};
  const budget = grounded(row["budget"], "budget", transcript);
  if (budget !== undefined) highlights.budget = Math.round(budget);
  const rooms = grounded(row["rooms"], "rooms", transcript);
  if (rooms !== undefined) highlights.rooms = rooms;
  const areaSqm = grounded(row["areaSqm"], "areaSqm", transcript);
  if (areaSqm !== undefined) highlights.areaSqm = Math.round(areaSqm);

  const side = row["side"];
  if (side === "buyer" || side === "seller" || side === "renter" || side === "landlord") {
    highlights.side = side;
  }
  if (typeof row["exclusivity"] === "boolean") highlights.exclusivity = row["exclusivity"];

  for (const key of ["city", "neighborhood", "address", "propertyType", "timeline", "motivation", "financing", "callback"] as const) {
    const value = text(row[key]);
    if (value !== undefined) highlights[key] = value;
  }
  for (const key of ["features", "objections", "commitments"] as const) {
    const value = list(row[key]);
    if (value !== undefined) highlights[key] = value;
  }

  /*
   * הסיכום נפסל כולו על מספר שלא נאמר — לא מתוקן ולא נחתך. אותו
   * כלל בדיוק של `insight` בסוכן, ומאותה סיבה: משפט שתוקן חלקית
   * הוא משפט שאיש אינו יודע עד כמה לסמוך עליו.
   */
  const rawSummary = text(row["summary"], SUMMARY_MAX);
  const summary =
    rawSummary !== undefined && groundedNumbers(rawSummary, [transcript]) ? rawSummary : "";

  const outcome = row["outcome"];
  const suggestedOutcome =
    outcome === "interested" || outcome === "not_fit" || outcome === "callback" ? outcome : null;

  const turns = parseTurns(row["turns"], transcript);

  const empty =
    turns.length === 0 &&
    summary === "" &&
    suggestedOutcome === null &&
    Object.keys(highlights).length === 0;
  return empty ? null : { turns, summary, highlights, suggestedOutcome };
}

/* ==================== מיזוג עם רשת הביטחון ==================== */

/**
 * המודל גובר, והחילוץ הדטרמיניסטי ממלא חוסרים.
 *
 * לא להפך: המודל קרא את השיחה, ו-`summarizeCall` מתאים תבניות על
 * טקסט. אבל מה שהמודל השמיט — בין אם לא ראה ובין אם נפסל בבדיקת
 * המספרים — עדיין שווה משהו, ואין סיבה לזרוק אותו.
 */
export function mergeCallIntel(model: CallIntel | null, fallback: CallSummary): CallIntel {
  if (model === null) {
    return {
      turns: [],
      summary: fallback.summary,
      highlights: fallback.highlights,
      suggestedOutcome: fallback.suggestedOutcome,
    };
  }
  return {
    turns: model.turns,
    summary: model.summary !== "" ? model.summary : fallback.summary,
    highlights: { ...fallback.highlights, ...model.highlights },
    suggestedOutcome: model.suggestedOutcome ?? fallback.suggestedOutcome,
  };
}

/* ==================== תצוגה ==================== */

/**
 * התורות ⟵ הטקסט שנשמר בעמודת `transcript`.
 *
 * נשמר כטקסט ולא כמבנה, בדיוק כמו הפורמט של `formatDiarizedTranscript`
 * ומאותה סיבה: העמודה היא `String`, ואין מיגרציה. `parseRoleTranscript`
 * קורא אותו בחזרה, ובדיקת הלוך-ושוב שומרת שהשתיים נשארות צמודות.
 */
export function formatRoleTranscript(turns: readonly CallIntelTurn[]): string {
  return turns.map((turn) => `${CALL_ROLE_LABELS[turn.role]}: ${turn.text}`).join("\n");
}

const ROLE_LINE = /^(מתווך|לקוח|אחר):\s*(.*)$/u;
const LABEL_TO_ROLE: Record<string, CallIntelTurn["role"]> = {
  מתווך: "agent",
  לקוח: "client",
  אחר: "other",
};

/** קריאה חזרה של מה ש-`formatRoleTranscript` כתב. */
export function parseRoleTranscript(transcript: string): CallIntelTurn[] {
  const clean = transcript.trim();
  if (clean === "") return [];
  const turns: CallIntelTurn[] = [];
  for (const raw of clean.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    const match = ROLE_LINE.exec(line);
    /*
     * שורה בלי תווית מצטרפת לתור שלפניה. זה מה שקורה בטקסט שנשמר
     * עם מעברי שורה בתוך דברי הדובר — ופתיחת תור חדש עליה הייתה
     * מפצלת משפט אחד לשניים.
     */
    if (match === null) {
      const last = turns[turns.length - 1];
      if (last) last.text = `${last.text}\n${line}`;
      continue;
    }
    turns.push({ role: LABEL_TO_ROLE[match[1]!]!, text: (match[2] ?? "").trim() });
  }
  return turns.filter((turn) => turn.text !== "");
}
