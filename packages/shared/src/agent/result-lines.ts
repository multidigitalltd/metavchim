import { COOP_DEAL_STAGE_LABELS, type CoopDealStage } from "../logic/coop-deal.js";
import { formatJerusalemDate, formatJerusalemTime } from "../logic/israel-time.js";
import { CALL_OUTCOME_LABELS } from "../schemas/labels.js";

/**
 * התשובה לשאילתה — **שדות, תוויות וסדר, במקום אחד לשני המסכים.**
 *
 * ## מה הבעיה שזה פותר
 *
 * לסוכן יש שני פנים: פאנל במערכת ושיחה בוואטסאפ. שניהם מקבלים את
 * אותו `data` בדיוק מאותה פעולה, ועד היום כל אחד החליט בעצמו מה
 * להציג ממנו. התוצאה הייתה שתי מערכות שונות:
 *
 * - הפאנל הראה פגישות עם שעה, משימות עם מועד, שיחות עם תוצאה
 *   ותקציר. וואטסאפ הריץ מנסח כללי שמחפש `name`/`title` בלבד,
 *   ולכן על „מה השיחות האחרונות” הוא ענה „5 שיחות אחרונות” —
 *   **ובלי אף שיחה**. אותו דבר בדוח המשרד, שאינו מערך כלל.
 * - שלב בעסקה משותפת נקרא „לא יצא לפועל” במסך העסקה ו„בוטל”
 *   בפאנל הסוכן, כי לפאנל הייתה מפת תוויות משלו.
 * - התאמות לא הוצגו **באף אחד מהשניים**: הן חוזרות כמערך חשוף,
 *   ושני המסכים חיפשו מפתח בתוך אובייקט.
 *
 * לכן הבחירה מה מציגים ואיך קוראים לזה יושבת כאן, והמסכים מרנדרים
 * אותה — הפאנל כ-JSX, וואטסאפ כטקסט. מה שנשאר לכל מסך הוא הצורה
 * שלו בלבד, ולא התוכן.
 *
 * ## מה לא נמצא כאן
 *
 * הכרטיס המלא (`show_card`) ורשימת „למי לחזור” (`show_callbacks`)
 * — לשניהם כבר יש מנסח ייעודי בצד וואטסאפ, ומנסח שני היה הופך את
 * זה לשלושה מקומות במקום אחד.
 */

/** סוג הפגישה כפי שהיא נקראת למתווך. */
export const APPOINTMENT_KIND_LABELS: Record<string, string> = {
  viewing: "סיור",
  meeting: "פגישה",
  call: "שיחה",
};

const CALL_DIRECTION_LABELS: Record<string, string> = {
  inbound: "נכנסת",
  outbound: "יוצאת",
};

/** שורה אחת בתשובה — כותרת, פרטים, ולאן ממשיכים. */
export interface AgentResultRow {
  label: string;
  /** הפרטים שמתחת לכותרת, כבר מחוברים. ריק = אין מה להוסיף. */
  detail: string;
  /**
   * הטלפון — **בשדה נפרד ולא בתוך `detail`.**
   *
   * הוא נשלח למתווך אבל **לעולם אינו נשמר בזיכרון השיחה**, שנוסע
   * בתור הבא לפרומפט של מודל חיצוני. הפרדה מבנית ולא סינון של
   * מחרוזת: מספר שנבלע בתוך `detail` היה זולג לזיכרון ביום שמישהו
   * מוסיף אותו שם בלי לשים לב.
   */
  phone?: string;
  /**
   * מה שנשמר לזיכרון במקום `label` — **כשה-`label` עצמו הוא פרט מזהה.**
   *
   * שיחה ממספר לא מוכר מוצגת עם המספר, כי הוא בדיוק מה שדרוש כדי
   * לחזור אליו. אבל ה-`label` נשמר לזיכרון שנוסע בתור הבא לפרומפט
   * של מודל חיצוני, וכלל הבית הוא שטלפון אינו מגיע לשם לעולם.
   * הפרדת השדה `phone` לא הספיקה למקרה הזה, כי המספר היה גם
   * הכותרת (ביקורת Codex).
   *
   * הסדר נשמר גם כך, וזה מה שהזיכרון קיים בשבילו: „הראשון מהם”
   * עובד לפי מיקום ולא לפי שם.
   */
  memoryLabel?: string;
  /** קישור יחסי למסך המלא של השורה, כשיש כזה. */
  href?: string;
}

/** רשימת תשובה שלמה — מה נמצא, כמה, ומה לומר כשאין. */
export interface AgentResultList {
  /** „קונים”, „פגישות” — לשורת הסיכום שמעל */
  noun: string;
  emptyText: string;
  rows: AgentResultRow[];
  /** נחתך בשרת — „מוצגים N ראשונים” ולא „נמצאו N” */
  hasMore: boolean;
}

/** „14:30 · 25.08.2026”, או ריק כשהתאריך אינו קריא. */
function whenText(iso: unknown): string {
  if (typeof iso !== "string" && !(iso instanceof Date)) return "";
  const at = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return `${formatJerusalemTime(at)} · ${formatJerusalemDate(at)}`;
}

/** חיבור החלקים שקיימים בלבד — חלק ריק אינו משאיר מפריד יתום. */
function join(parts: (string | null | undefined)[]): string {
  return parts.filter((part): part is string => typeof part === "string" && part !== "").join(" · ");
}

function rooms(min: unknown, max: unknown): string | null {
  if (typeof min !== "number") return null;
  if (typeof max === "number" && max !== min) return `${min}–${max} חדרים`;
  return `${min} חדרים`;
}

const SHEKEL = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  maximumFractionDigits: 0,
});

/** אגורות ⟵ „₪1,200,000”. לא-מספר נשאר חסר ולא הופך ל-0. */
function price(agorot: unknown): string | null {
  return typeof agorot === "number" ? SHEKEL.format(Math.round(agorot / 100)) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * הטלפון של השורה — **בשני השמות שקיימים בפועל.**
 *
 * פעולות השיחה מחזירות `contactPhone`, והשאר `phone`. הסורק הכללי
 * שקדם לכאן קיבל את שניהם, וקריאה של אחד בלבד הייתה מוחקת מספרים
 * מחצי מהצורות — אותה נסיגה שבגללה השדה הזה נוסף מלכתחילה.
 */
function phoneOf(record: Record<string, unknown>): string | null {
  return text(record["phone"]) ?? text(record["contactPhone"]);
}

function rowsOf(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Record<string, unknown> => typeof item === "object" && item !== null,
  );
}

/**
 * בונה השורות לכל מקטע, ומה שמסביבו — **טבלה אחת ולא שרשרת תנאים.**
 *
 * שרשרת `if` על מפתחות עבדה כל עוד לכל תשובה היה מקטע אחד. תוצאת
 * החיפוש הכללי נושאת את כולם בבת אחת, והשרשרת בחרה את הראשון —
 * גם כשהוא ריק. בטבלה אפשר גם לבחור אחד וגם לאחד את כולם.
 */
const SECTION_ROWS: Record<string, (value: unknown) => AgentResultRow[]> = {
  appointments: (value) =>
    rowsOf(value).map((a) => ({
      label: text(a["title"]) ?? APPOINTMENT_KIND_LABELS[String(a["kind"])] ?? "פגישה",
      detail: whenText(a["startsAt"]),
      href: "/calendar",
    })),
  tasks: (value) =>
    rowsOf(value).map((t) => ({
      label: text(t["title"]) ?? "משימה",
      detail: join([text(t["entityLabel"]), whenText(t["dueAt"])]),
      href: "/tasks",
    })),
  calls: (value) =>
    rowsOf(value).map((c) => {
      const phone = phoneOf(c);
      const name = text(c["contactName"]);
      return {
        /*
         * מספר לא מוכר נשאר מספר **בתשובה** — הוא בדיוק מה שדרוש
         * כדי לחזור אליו. אבל אז הוא גם ה-`label`, ו-`label` נשמר
         * לזיכרון שנוסע למודל חיצוני; לכן `memoryLabel` מחליף אותו
         * שם (ביקורת Codex).
         */
        label: name ?? phone ?? "מספר לא מזוהה",
        ...(name === null ? { memoryLabel: "מספר לא מזוהה" } : {}),
        detail: join([
          CALL_DIRECTION_LABELS[String(c["direction"])],
          CALL_OUTCOME_LABELS[String(c["outcome"])],
          whenText(c["occurredAt"]),
          text(c["summary"]),
        ]),
        ...(phone !== null ? { phone } : {}),
        href: "/calls",
      };
    }),
  deals: (value) =>
    rowsOf(value).map((d) => ({
      label: text(d["title"]) ?? "עסקה משותפת",
      detail: join([
        COOP_DEAL_STAGE_LABELS[String(d["stage"]) as CoopDealStage],
        text(d["counterpartOffice"]),
        whenText(d["lastActivityAt"]),
      ]),
      ...(text(d["id"]) !== null ? { href: `/collaboration/deals/${String(d["id"])}` } : {}),
    })),
  buyers: (value) =>
    rowsOf(value).map((b) => ({
      label: text(b["name"]) ?? "קונה",
      detail: join([
        rooms(b["roomsMin"], b["roomsMax"]),
        Array.isArray(b["cities"]) ? b["cities"].join(" / ") : null,
        price(b["budgetMaxAgorot"]) === null ? null : `עד ${price(b["budgetMaxAgorot"])!}`,
      ]),
      /*
       * `summarizeData` הציג את הטלפון, והמנסח הזה קודם לו — ולכן
       * השמטתו כאן הייתה **נסיגה** (ביקורת Codex).
       */
      ...(phoneOf(b) !== null ? { phone: phoneOf(b)! } : {}),
      ...(text(b["id"]) !== null ? { href: `/buyers/${String(b["id"])}` } : {}),
    })),
  leads: (value) =>
    rowsOf(value).map((l) => ({
      label: text(l["name"]) ?? "ליד",
      detail: join([text(l["status"]), l["requiresHuman"] === true ? "דורש טיפול" : null]),
      ...(phoneOf(l) !== null ? { phone: phoneOf(l)! } : {}),
      ...(text(l["id"]) !== null ? { href: `/leads/${String(l["id"])}` } : {}),
    })),
  /*
   * הערה שנמצאה בחיפוש היא **תוצאה לכל דבר**: היא הסיבה היחידה
   * שהחיפוש מוצא „מי אמר שהוא גמיש בקומה”. השמטתה מהאיחוד הייתה
   * הופכת חיפוש שנפל רק עליה ל„לא נמצא כלום” — טענה שקרית על
   * המאגר, וזה בדיוק הכשל שהמקטעים אוחדו בגללו.
   *
   * הכותרת קבועה, והתוכן יורד ל-`detail`: `detail` נשלח למתווך
   * ואינו נשמר לזיכרון, וכך תוכן ההערה — שהוא טקסט חופשי ויכול
   * להכיל כל פרט — אינו נוסע לפרומפט של המודל החיצוני.
   */
  notes: (value) =>
    rowsOf(value).map((n) => ({
      label: "הערה",
      detail: join([text(n["content"]), whenText(n["createdAt"])]),
    })),
  properties: (value) =>
    rowsOf(value).map((p) => ({
      label: text(p["title"]) ?? text(p["marketingTitle"]) ?? text(p["street"]) ?? "נכס",
      detail: join([rooms(p["rooms"], undefined), text(p["city"]), price(p["priceAgorot"])]),
      ...(text(p["id"]) !== null ? { href: `/properties/${String(p["id"])}` } : {}),
    })),
};

/** שם הרשימה ומה לומר כשאין — למקטע שעומד לבדו. */
const SECTION_META: Record<string, { noun: string; empty: string; counted: boolean }> = {
  appointments: { noun: "פגישות", empty: "אין פגישות ביום הזה", counted: false },
  tasks: { noun: "משימות פתוחות", empty: "אין משימות פתוחות", counted: false },
  calls: { noun: "שיחות אחרונות", empty: "אין שיחות אחרונות", counted: false },
  deals: { noun: "עסקאות משותפות", empty: "אין עסקאות משותפות", counted: false },
  buyers: { noun: "קונים", empty: "לא נמצאו קונים שמתאימים לקריטריונים", counted: true },
  leads: { noun: "לידים", empty: "לא נמצאו לידים", counted: true },
  notes: { noun: "הערות", empty: "לא נמצאו הערות", counted: false },
  properties: { noun: "נכסים", empty: "אין נכסים שעונים על התנאים", counted: true },
};

/** הסדר קובע מה מוצג ראשון בתוצאת חיפוש כללי. */
const SECTION_KEYS = Object.keys(SECTION_ROWS);

/**
 * המדדים שהסוכן מוסר מדוח המשרד, לפי הסדר.
 *
 * **עסקאות שנסגרו ראשונה במכוון** — זה המדד היחיד שמודד תוצאה
 * ולא פעילות, ומתווך שמבקש דוח רוצה לדעת כמה סגר לפני כמה שלח.
 * הסדר זהה למה שהפאנל מציג, כי שתי התשובות אמורות להיות אותה
 * תשובה.
 */
export function officeReportStats(report: unknown): { label: string; value: number }[] {
  if (typeof report !== "object" || report === null) return [];
  const r = report as Record<string, Record<string, unknown> | undefined>;
  const pairs: [string, unknown][] = [
    ["עסקאות שנסגרו", r["deals"]?.["closed"]],
    ["נכסים פעילים", r["properties"]?.["active"]],
    ["קונים חמים", r["buyers"]?.["hot"]],
    ["לידים פתוחים", r["leads"]?.["open"]],
    ["הצעות שנשלחו", r["offers"]?.["sent"]],
    ["פגישות קרובות", r["appointments"]?.["upcoming"]],
  ];
  return pairs
    .filter((pair): pair is [string, number] => typeof pair[1] === "number")
    .map(([label, value]) => ({ label, value }));
}

/**
 * אורך כותרת מרבי — **כדי שהזיכרון לא ייחתך באמצע שם.**
 *
 * ‎`historySummary` חותכת ל-600 תווים. שם איש קשר יכול להגיע ל-120,
 * ולכן שמונה כותרות מלאות יכלו לחרוג ולהיקטע באמצע החמישית: המסך
 * הראה שמונה, והתור הבא קיבל ארבע וחצי — כלומר „השמינית” נשברה
 * שוב, רק בדלת אחורית (ביקורת Codex).
 *
 * החיתוך כאן ולא שם, כי הוא חייב לחול על **שניהם**: מה שנקטע
 * להצגה ולא לזיכרון (או להפך) הוא בדיוק אותו פער. שמונה כותרות
 * של 40 תווים הן 336 תווים — מתחת לתקציב בכל מקרה.
 */
export const AGENT_RESULT_LABEL_MAX = 40;

/** הכותרת המוצגת — חתוכה, **עם סימן** שהיא נחתכה. */
function clamp(label: string): string {
  return label.length <= AGENT_RESULT_LABEL_MAX
    ? label
    : `${label.slice(0, AGENT_RESULT_LABEL_MAX - 1)}…`;
}

/**
 * הכותרת הנשמרת — אותו גבול, **בלי הסימן.**
 *
 * ההבדל בתו אחד הוא ההבדל בין שם שנמצא לשם שלא: הכותרת שנשמרת
 * חוזרת בתור הבא כביטוי מזהה, ו-`SearchService` מוצאת רשומה בשתי
 * דרכים — גיבוב מדויק של השם, וסריקה שבודקת `name.includes(phrase)`.
 * „…” בסוף שוברת את שתיהן, ולכן שורה שהמתווך בדיוק ראה הייתה
 * חוזרת כ„לא נמצא במאגר” (ביקורת Codex). רישא נקייה עדיין נמצאת
 * בדרך השנייה.
 *
 * הגבול זהה לזה של התצוגה במכוון: מה שנראה ומה שנזכר חייבים
 * להיחתך באותה נקודה, אחרת „השמינית” נשברת שוב.
 */
function remembered(label: string): string {
  return label.slice(0, AGENT_RESULT_LABEL_MAX);
}

/**
 * שער היציאה היחיד של `agentResultList` — **כאן, ורק כאן, נחתכות
 * הכותרות.**
 *
 * חיתוך בכל בונה מקטע בנפרד היה שבעה מקומות לזכור, ובונה שמיני
 * שיתווסף מחר היה נכנס בלי חיתוך — בדיוק צורת הכפילות שהביאה
 * לכאן. מעבר אחד על התוצאה מבטיח שגם הכותרת המוצגת וגם זו שנשמרת
 * לזיכרון נחתכו **באותו מקום בדיוק**.
 *
 * `memoryLabel` נשאר חסר כשאין הבדל בין השתיים — כך „יש כאן משהו
 * לזכור אחרת” נשאר סימן ולא רעש על כל שורה.
 */
function bounded(list: AgentResultList): AgentResultList {
  return {
    ...list,
    rows: list.rows.map((row) => {
      const label = clamp(row.label);
      const memory = remembered(row.memoryLabel ?? row.label);
      return { ...row, label, ...(memory === label ? {} : { memoryLabel: memory }) };
    }),
  };
}

/**
 * התשובה כרשימה — או `null` כשהצורה אינה מוכרת.
 *
 * `null` ולא רשימה ריקה: „לא זיהיתי את הצורה” ו„הצורה מוכרת ואין
 * בה שורות” הן שתי תשובות שונות לחלוטין, והקורא צריך להבחין
 * ביניהן. רשימה ריקה אומרת „אין לך פגישות היום” — טענה על המאגר.
 */
export function agentResultList(data: unknown): AgentResultList | null {
  /*
   * התאמות חוזרות כמערך **חשוף**, ולא תחת מפתח. שני המסכים חיפשו
   * מפתח בתוך אובייקט, ולכן „תראה לי התאמות” לא הציג דבר בשניהם.
   */
  if (Array.isArray(data)) {
    return bounded({
      noun: "התאמות",
      emptyText: "אין התאמות פעילות",
      hasMore: false,
      rows: rowsOf(data).map((match) => {
        const property = match["property"];
        const address =
          typeof property === "object" && property !== null
            ? (text((property as Record<string, unknown>)["title"]) ??
              text((property as Record<string, unknown>)["address"]))
            : null;
        const score = typeof match["score"] === "number" ? `${match["score"]}%` : null;
        /*
         * **שתי צורות הפוכות של אותה שאלה.**
         *
         * „התאמות לנכס” מחזירה קונים, ו„התאמות לקונה” מחזירה
         * נכסים — עם `property` מקונן ובלי `buyerName`. נפילה
         * אחידה ל„קונה של סוכן אחר” תייגה כל שורה בצד השני של
         * המשוואה בשם של ישות שאינה שם בכלל (ביקורת Codex).
         *
         * לכן: שם הקונה כשיש, אחרת הנכס — והנפילה האנונימית
         * נשמרת למה שהיא נועדה לו, קונה של סוכן אחר ברשימה
         * שמרכזה נכס.
         */
        const buyerName = text(match["buyerName"]);
        const label = buyerName ?? address ?? "קונה של סוכן אחר";
        return {
          label,
          detail: join([label === address ? null : address, score, text(match["explanation"])]),
          ...(text(match["propertyId"]) !== null
            ? { href: `/properties/${String(match["propertyId"])}` }
            : {}),
        };
      }),
    });
  }

  if (typeof data !== "object" || data === null) return null;
  const payload = data as Record<string, unknown>;
  const hasMore = payload["hasMore"] === true;

  /*
   * **צורת החיפוש הכללי — לפני כל מקטע בודד.**
   *
   * `SearchService.search` מחזירה תמיד את כל המקטעים, כולל
   * `appointments: []` גם כשהתוצאה היא קונה. בדיקת מקטע-אחר-מקטע
   * זיהתה כל חיפוש כרשימת פגישות **ריקה**, ענתה „אין פגישות ביום
   * הזה”, וחסמה גם את המקטעים שאחריה וגם את הסורק הכללי — כלומר
   * שברה את פעולת הקריאה הנפוצה ביותר (ביקורת Codex).
   *
   * הסימן: יותר ממקטע מוכר אחד. תוצאה של פעולה יחידה נושאת מקטע
   * אחד בלבד.
   */
  const sections = SECTION_KEYS.filter((key) => Array.isArray(payload[key]));
  if (sections.length > 1 || payload["contact"] !== undefined) {
    const rows: AgentResultRow[] = [];
    const contact = payload["contact"];
    if (typeof contact === "object" && contact !== null) {
      const record = contact as Record<string, unknown>;
      const name = text(record["name"]);
      if (name !== null) {
        rows.push({
          label: name,
          detail: "",
          ...(phoneOf(record) !== null ? { phone: phoneOf(record)! } : {}),
          ...(text(record["id"]) !== null ? { href: `/contacts/${String(record["id"])}` } : {}),
        });
      }
    }
    for (const key of sections) rows.push(...SECTION_ROWS[key]!(payload[key]));
    return bounded({ noun: "תוצאות", emptyText: "לא נמצא כלום", hasMore, rows });
  }

  const only = sections[0];
  if (only !== undefined) {
    const meta = SECTION_META[only]!;
    return bounded({
      noun: meta.noun,
      emptyText: meta.empty,
      hasMore: meta.counted ? hasMore : false,
      rows: SECTION_ROWS[only]!(payload[only]),
    });
  }

  if (typeof payload["report"] === "object" && payload["report"] !== null) {
    const stats = officeReportStats(payload["report"]);
    return bounded({
      noun: "נתוני המשרד",
      emptyText: "אין נתונים לתקופה שנבחרה",
      hasMore: false,
      rows: stats.map((stat) => ({ label: stat.label, detail: String(stat.value) })),
    });
  }

  return null;
}

/**
 * כמה שורות נלקחות מהתוצאה — **לתשובה ולזיכרון גם יחד.**
 *
 * שתי תקרות נפרדות היו שוברות את ההמשך הרב-תורי: המתווך רואה שורה
 * שביעית, אומר „תקבע לשביעי”, והזיכרון שנשלח לתור הבא מכיר חמש
 * (ביקורת Codex). מה שנראה ומה שנזכר חייבים להיות אותה רשימה
 * בדיוק — ולכן אותו קבוע.
 */
export const AGENT_RESULT_ROWS = 8;

/**
 * אותה תשובה, כטקסט לוואטסאפ. `null` כשהצורה אינה מוכרת — הקורא
 * נופל אז למנסח הכללי, ולא לשורה ריקה.
 */
export function agentResultText(data: unknown): string | null {
  const list = agentResultList(data);
  if (list === null) return null;
  if (list.rows.length === 0) return list.emptyText;

  const shown = list.rows.slice(0, AGENT_RESULT_ROWS);
  const lines = shown.map((row) =>
    /* כשהכותרת **היא** המספר (מתקשר לא מוכר), הוא נאמר פעם אחת. */
    [`• ${row.label}`, row.detail, row.phone === row.label ? undefined : row.phone]
      .filter((part) => part !== undefined && part !== "")
      .join(" — "),
  );
  /*
   * „ועוד N” נאמר במפורש. רשימה שנחתכת בשקט נקראת כרשימה מלאה,
   * והמתווך מסיק שאין יותר — על סמך תקרת תצוגה שלנו.
   */
  const hidden = list.rows.length - shown.length;
  if (hidden > 0) lines.push(`ועוד ${hidden} ${list.noun}`);
  else if (list.hasMore) lines.push(`מוצגים ${shown.length} ה${list.noun} הראשונים — יש עוד`);
  return lines.join("\n");
}
