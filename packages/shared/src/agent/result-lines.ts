import { COOP_DEAL_STAGE_LABELS, type CoopDealStage } from "../logic/coop-deal.js";
import { numberedLabels } from "./history.js";
import type { AgentHistoryRef } from "./prompt.js";
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

/**
 * רשימת תשובה שלמה — מה נמצא וכמה.
 *
 * **מה שאין אינו נאמר כאן.** „אין משימות פתוחות” הוא כבר המסר של
 * הפעולה עצמה (`ExecuteResult.message`), והתשובה בוואטסאפ פותחת בו.
 * נוסח שני לאותה מסקנה היה נאמר פעמיים באותה הודעה — ובמקרה של
 * היומן גם בניסוח **פחות** מדויק, כי הפעולה יודעת על איזה יום
 * נשאלה והרשימה אינה יודעת (ביקורת Codex).
 */
export interface AgentResultList {
  /** „קונים”, „פגישות” — לשורת הסיכום שמעל */
  noun: string;
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
         * שלושה מצבים, ולא שניים.
         *
         * שם — הכותרת. מספר בלי שם — **המספר עצמו**, כי הוא בדיוק מה
         * שדרוש כדי לחזור; אבל אז הוא גם ה-`label`, ו-`label` נשמר
         * לזיכרון שנוסע למודל חיצוני, ולכן `memoryLabel` מחליף אותו
         * שם (ביקורת Codex).
         *
         * ובלי שניהם — „שיחה”, ולא „מספר לא מזוהה”. תוצאות החיפוש
         * מחזירות שורת שיחה בלי שם ובלי מספר (היא נמצאה לפי התקציר),
         * ו„לא מזוהה” הוא טענה על הלקוח — שקרית במיוחד כשהחיפוש היה
         * לפי מספר והזהות מוצגת שורה מעליה (ביקורת Codex).
         */
        label: name ?? phone ?? "שיחה",
        ...(name === null && phone !== null ? { memoryLabel: "מספר לא מזוהה" } : {}),
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
    rowsOf(value).map((n) => {
      const who = text(n["entityLabel"]);
      return {
        /*
         * **מי אמר את זה** — זו כל השאלה. „מי אמר שהוא גמיש בקומה”
         * נענה ב„הערה — אמר שהוא גמיש בקומה”, כלומר חזר על השאלה
         * במקום לענות עליה (ביקורת Codex). השם מגיע מ-`SearchService`,
         * שכבר יודע לאיזה קונה או ליד ההערה שייכת.
         */
        label: who ?? "הערה",
        detail: join([text(n["content"]), whenText(n["createdAt"])]),
        ...(text(n["buyerId"]) !== null
          ? { href: `/buyers/${String(n["buyerId"])}` }
          : text(n["leadId"]) !== null
            ? { href: `/leads/${String(n["leadId"])}` }
            : {}),
      };
    }),
  /*
   * התאמות — **מקטע ככל האחרים, ולא מערך חשוף.**
   *
   * הן חזרו כמערך, וטופלו בענף נפרד. מערך אינו יכול לשאת `hasMore`
   * (‏`JSON.stringify` משמיט מאפיינים שאינם אינדקסים), ולכן עמוד
   * חתוך הוצג כרשימה מלאה: „ועוד 42 התאמות” על 50 שהן התקרה
   * (ביקורת Codex). עטיפה באובייקט נותנת להן את אותו סימן קיטום
   * שיש לכל רשימה אחרת.
   */
  matches: (value) =>
    rowsOf(value).map((match) => {
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
       * „התאמות לנכס” מחזירה קונים, ו„התאמות לקונה” מחזירה נכסים —
       * עם `property` מקונן ובלי `buyerName`. נפילה אחידה ל„קונה של
       * סוכן אחר” תייגה כל שורה בצד השני של המשוואה בשם של ישות
       * שאינה שם בכלל (ביקורת Codex).
       */
      const buyerName = text(match["buyerName"]);
      const label = buyerName ?? address ?? "קונה של סוכן אחר";
      /*
       * **הקישור הולך לישות שבכותרת.**
       *
       * שורה שכותרתה שם הקונה קישרה לנכס — כלומר לכרטיס שהמתווך
       * כבר עומד עליו, כי משם הוא שאל. הקישור היחיד בשורה החזיר
       * אותו למקום שממנו בא, ולא לקונה שהשורה מדברת עליו
       * (ביקורת Codex).
       */
      const target =
        buyerName !== null && text(match["buyerId"]) !== null
          ? `/buyers/${String(match["buyerId"])}`
          : text(match["propertyId"]) !== null
            ? `/properties/${String(match["propertyId"])}`
            : null;
      return {
        label,
        detail: join([label === address ? null : address, score, text(match["explanation"])]),
        ...(target === null ? {} : { href: target }),
      };
    }),
  properties: (value) =>
    rowsOf(value).map((p) => ({
      label: text(p["title"]) ?? text(p["marketingTitle"]) ?? text(p["street"]) ?? "נכס",
      detail: join([rooms(p["rooms"], undefined), text(p["city"]), price(p["priceAgorot"])]),
      ...(text(p["id"]) !== null ? { href: `/properties/${String(p["id"])}` } : {}),
    })),
};

/**
 * שם הרשימה — למקטע שעומד לבדו.
 *
 * `counted` מבדיל בין „נחתך בשרת” לבין „זה הכול”: שאילתות החיפוש
 * מחזירות עמוד ומדווחות `hasMore`, ורשימות היום אינן.
 */
const SECTION_META: Record<string, { noun: string; counted: boolean }> = {
  appointments: { noun: "פגישות", counted: false },
  tasks: { noun: "משימות פתוחות", counted: false },
  calls: { noun: "שיחות אחרונות", counted: false },
  deals: { noun: "עסקאות משותפות", counted: false },
  buyers: { noun: "קונים", counted: true },
  leads: { noun: "לידים", counted: true },
  notes: { noun: "הערות", counted: false },
  matches: { noun: "התאמות", counted: true },
  properties: { noun: "נכסים", counted: true },
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
  /*
   * **שתי רשומות באותו שם מקבלות מספר.**
   *
   * תווית שחוזרת אינה מזהה דבר: „תעדכן את משה כהן” מצביע על שתי
   * שורות, וההכרעה נופלת על הראשונה — ניחוש שקט ברשומה של מישהו
   * אחר (ביקורת Codex). המספור נעשה כאן, על התווית **המקוצרת**,
   * כדי שגם שני שמות ארוכים שנחתכו לאותה רישא יובחנו — ובאותה
   * מחרוזת בדיוק בתצוגה, בזיכרון ובהפניה.
   */
  const display = numberedLabels(list.rows.map((row) => clamp(row.label)));
  const memory = numberedLabels(list.rows.map((row) => remembered(row.memoryLabel ?? row.label)));
  return {
    ...list,
    rows: list.rows.map((row, i) => {
      const label = display[i]!;
      const remembers = memory[i]!;
      return { ...row, label, ...(remembers === label ? {} : { memoryLabel: remembers }) };
    }),
  };
}

/**
 * האם זו תוצאת חיפוש כללי — **הכרעה אחת לשני המסכים.**
 *
 * `SearchService.search` מחזירה תמיד את כל המקטעים, כולל הריקים,
 * ולכן מסך שבודק מקטע-אחר-מקטע מזהה כל חיפוש כרשימת פגישות ריקה
 * ועונה „אין פגישות”. זה קרה **בשני המסכים בנפרד**, ולכן הסימן
 * יושב כאן: יותר ממקטע מוכר אחד, או זהות בהתאמת-טלפון.
 */
export function isAggregateResult(data: unknown): boolean {
  if (typeof data !== "object" || data === null) return false;
  const payload = data as Record<string, unknown>;
  if (payload["contact"] !== undefined) return true;
  return SECTION_KEYS.filter((key) => Array.isArray(payload[key])).length > 1;
}

/**
 * התשובה כרשימה — או `null` כשהצורה אינה מוכרת.
 *
 * `null` ולא רשימה ריקה: „לא זיהיתי את הצורה” ו„הצורה מוכרת ואין
 * בה שורות” הן שתי תשובות שונות לחלוטין, והקורא צריך להבחין
 * ביניהן. רשימה ריקה אומרת „אין לך פגישות היום” — טענה על המאגר.
 */
export function agentResultList(data: unknown): AgentResultList | null {
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
  if (isAggregateResult(data)) {
    const rows: AgentResultRow[] = [];
    const contact = payload["contact"];
    if (typeof contact === "object" && contact !== null) {
      const record = contact as Record<string, unknown>;
      const name = text(record["name"]);
      if (name !== null) {
        /*
         * **בלי קישור.** לאיש קשר אין מסך משלו — הוא נצפה דרך כרטיס
         * הקונה או הליד, ו-`/contacts/…` הוא 404 (ביקורת Codex).
         * הכרטיסים עצמם מופיעים כשורות במקטעים שמתחת, ומהם אפשר
         * להמשיך.
         */
        rows.push({
          label: name,
          detail: "",
          ...(phoneOf(record) !== null ? { phone: phoneOf(record)! } : {}),
        });
      }
    }
    for (const key of sections) rows.push(...SECTION_ROWS[key]!(payload[key]));
    return bounded({ noun: "תוצאות", hasMore, rows });
  }

  const only = sections[0];
  if (only !== undefined) {
    const meta = SECTION_META[only]!;
    return bounded({
      noun: meta.noun,
      hasMore: meta.counted ? hasMore : false,
      rows: SECTION_ROWS[only]!(payload[only]),
    });
  }

  if (typeof payload["report"] === "object" && payload["report"] !== null) {
    const stats = officeReportStats(payload["report"]);
    return bounded({
      noun: "נתוני המשרד",
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
 * אותה תשובה, כטקסט לוואטסאפ — או `null` כשאין מה **להוסיף.**
 *
 * שני מצבים שונים מחזירים `null`, ולשניהם אותה משמעות לקורא: צורה
 * שאינה מוכרת (נופל למנסח הכללי), ורשימה מוכרת שאין בה שורות. על
 * „אין” כבר ענתה שורת המסר של הפעולה, שפותחת את ההודעה — ותוספת
 * שנייה הייתה אומרת את אותו דבר פעמיים ברצף (ביקורת Codex).
 */
export function agentResultText(data: unknown): string | null {
  const list = agentResultList(data);
  if (list === null || list.rows.length === 0) return null;

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
   *
   * **שני קיטומים, ושניהם נאמרים.** אחד שלנו (8 שורות מתוך מה
   * שחזר) ואחד של השרת (עמוד מתוך המאגר), והם מצטברים: „ועוד 42”
   * לבדו על עמוד של 50 עם `hasMore` נשמע כמו סך הכול, בזמן
   * שבמאגר יש עוד (ביקורת Codex).
   */
  const hidden = list.rows.length - shown.length;
  const beyond = list.hasMore ? " — ויש עוד מעבר להם" : "";
  if (hidden > 0) lines.push(`ועוד ${hidden} ${list.noun}${beyond}`);
  else if (list.hasMore) lines.push(`מוצגים ${shown.length} ה${list.noun} הראשונים — יש עוד`);
  return lines.join("\n");
}

/**
 * תקרת הזיכרון שנשמר לתור הבא — **מוסכמת עם סכימת הנתיב.**
 *
 * `resultSummary` בבקר מוגבל לאותו אורך, ושני מספרים נפרדים היו
 * נפרדים ביום שאחד מהם משתנה — וההודעה הייתה נדחית או נקטעת בשקט.
 */
export const AGENT_RESULT_SUMMARY_MAX = 600;

/** שורה כפי שהיא נזכרת: כותרת, מה שנשמר במקומה, והטלפון לתצוגה. */
export interface AgentMemoryRow {
  label: string;
  memoryLabel?: string;
  phone?: string;
}

/**
 * שורות התוצאה לפי הסדר שהוחזר — **קודם הרשימה המשותפת.**
 *
 * זו לא אופטימיזציה אלא מה שמחזיק את ההמשך הרב-תורי: מה שהמתווך
 * ראה נבנה מ-`agentResultList`, וכשהזיכרון נבנה מסריקה אחרת — עם
 * תקרה אחרת ועם שמות משדות אחרים — נוצר פער שהוא נופל לתוכו.
 * אחרי `show_calls` אפילו „הראשון מהם” לא היה מוכר, כי שורת שיחה
 * נושאת `contactName` ולא `name` (ביקורת Codex).
 *
 * הסריקה הכללית נשארת לצורות שהרשימה המשותפת אינה מכירה — כרטיס
 * יחיד, ותוצאות של פעולות שאינן קריאה. רשימת השדות שהיא אוספת
 * סגורה, ולכן שדה חדש בתשובה אינו יכול לזלוג לזיכרון בלי שמישהו
 * יוסיף אותו כאן במפורש.
 */
export function agentResultRows(data: unknown): AgentMemoryRow[] {
  const shared = agentResultList(data);
  if (shared !== null) {
    return shared.rows.slice(0, AGENT_RESULT_ROWS).map((row) => ({
      label: row.label,
      ...(row.memoryLabel === undefined ? {} : { memoryLabel: row.memoryLabel }),
      ...(row.phone === undefined ? {} : { phone: row.phone }),
    }));
  }

  const rows: AgentMemoryRow[] = [];
  const collect = (items: unknown): void => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (rows.length >= AGENT_RESULT_ROWS) return;
      if (typeof item !== "object" || item === null) continue;
      const record = item as Record<string, unknown>;
      const label = record["name"] ?? record["title"] ?? record["marketingTitle"];
      if (typeof label !== "string" || label === "") continue;
      /* `contactPhone` הוא השם שפעולות השיחה משתמשות בו. */
      const phone = record["phone"] ?? record["contactPhone"];
      rows.push(typeof phone === "string" && phone !== "" ? { label, phone } : { label });
    }
  };
  if (Array.isArray(data)) collect(data);
  else if (typeof data === "object" && data !== null) {
    for (const value of Object.values(data as Record<string, unknown>)) collect(value);
  }
  return rows;
}

/**
 * מה שנשמר לתור הבא — שורת המצב, ואחריה השמות לפי הסדר.
 *
 * ## למה כאן ולא בכל מסך
 *
 * לסוכן שני פנים, ולשניהם אותו זיכרון בדיוק: „תקבע לראשון מהם”
 * חייב להתייחס לאותה רשימה שהמתווך ראה, ולא משנה אם ראה אותה
 * בפאנל או בוואטסאפ. שני מנסחים נפרדים כבר נפרדו בפועל — אחד
 * שמר חמישה שמות והאחר שמונה, אחד חיפש `name` והאחר את השורות
 * המשותפות — ולכן אותה שאלה בשני הערוצים נזכרה אחרת (ביקורת Codex).
 *
 * ## מה לעולם אינו נכנס
 *
 * שם וסדר בלבד. לא טלפון, לא אימייל, לא הערות ולא תקצירי שיחות:
 * הזיכרון נוסע בתור הבא לפרומפט של מודל חיצוני, והתשובה שנשלחה
 * למתווך נשארת אצלו. `memoryLabel` מחליף כותרת שהיא עצמה פרט מזהה.
 *
 * ## למה ההודעה נחתכת ולא השמות
 *
 * שם קטוע אינו רק פחות קריא — הוא מפתח חיפוש שבור, ובתור הבא
 * הרשומה שהמתווך בדיוק ראה חוזרת כ„לא נמצא במאגר”. ההודעה, לעומת
 * זאת, היא ניסוח שהמודל מייצר מחדש ממילא.
 */
export function agentHistorySummary(message: string, data: unknown): string {
  const labels = agentResultRows(data).map((row) => row.memoryLabel ?? row.label);
  const head = message.replaceAll("\n", " ").trim();
  if (labels.length === 0) return head.slice(0, AGENT_RESULT_SUMMARY_MAX);
  const tail = ` | לפי הסדר: ${labels.join(", ")}`;
  return `${head.slice(0, Math.max(0, AGENT_RESULT_SUMMARY_MAX - tail.length))}${tail}`.slice(
    0,
    AGENT_RESULT_SUMMARY_MAX,
  );
}

/** הקידומת בקישור ⟵ סוג הרשומה שאפשר להצביע עליה. */
const REF_TYPE_BY_SECTION: Record<string, AgentHistoryRef["entityType"]> = {
  buyers: "buyer",
  leads: "lead",
  properties: "property",
};

/**
 * הפניות לרשומות שהוצגו — **מזהה יציב לצד התווית, ולא במקומה.**
 *
 * ## למה תווית לבדה אינה מספיקה
 *
 * מה שנשמר לזיכרון חוזר בתור הבא כביטוי מזהה, והחיפוש מתרגם אותו
 * חזרה לרשומה בשתי דרכים: גיבוב מדויק של השם, וסריקה מפוענחת של
 * אלף אנשי הקשר שעודכנו לאחרונה. שתיהן נכשלות על **רישא** של שם
 * ארוך שבעליו אינו בין האלף — הגיבוב אינו של השם, והסריקה אינה
 * מגיעה אליו. כלומר קונה שהמתווך רואה מולו, ו„תוסיף לו הערה”
 * שעונה „לא נמצא במאגר” (ביקורת Codex).
 *
 * ## למה זה בטוח
 *
 * המזהה **אינו נכתב לפרומפט** — `buildInterpretPrompt` מדפיס את
 * התווית בלבד, ויש בדיקה שאוכפת זאת. הוא נשאר בצד שלנו,
 * ו-`matchHistoryRef` הוא שמתרגם את מה שהמודל החזיר בחזרה לרשומה,
 * **לפני** שהוא בכלל מגיע לחיפוש. המנגנון כבר קיים לעדכונים
 * שהסוכן יוזם; מה שחסר היה להשתמש בו גם בתוצאות של שאילתה.
 *
 * התווית זהה למה שנשמר בסיכום (`memoryLabel ?? label`), כי זו
 * המחרוזת שהמודל רואה ומעתיק. שורה בלי רשומה שאפשר להצביע עליה
 * (שיחה, פגישה, משימה) אינה מייצרת הפניה — היא הייתה מזמינה את
 * המודל להשתמש בה ואז נופלת בשקט.
 */
export function agentResultRefs(data: unknown): AgentHistoryRef[] {
  const list = agentResultList(data);
  if (list === null) return [];
  const refs: AgentHistoryRef[] = [];
  for (const row of list.rows.slice(0, AGENT_RESULT_ROWS)) {
    const parts = (row.href ?? "").split("/");
    if (parts.length !== 3) continue;
    const entityType = REF_TYPE_BY_SECTION[parts[1] ?? ""];
    const entityId = parts[2] ?? "";
    if (entityType === undefined || entityId === "") continue;
    refs.push({ label: row.memoryLabel ?? row.label, entityType, entityId });
  }
  return refs;
}
