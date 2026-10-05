/**
 * תיק הבדיקות של הנכס — מה בודקים לפני שמחתימים (docs/03 — property_checks).
 *
 * ## למה רשימה סגורה, ולמה כאן
 *
 * הבדיקות שמתווך עושה לפני שהוא לוקח נכס לשיווק הן אותן בדיקות בכל
 * משרד: נסח טאבו, שעבודים, תכנון, היתרים, חריגות, שוכר. רשימה
 * שכל משרד היה כותב לעצמו הייתה חסרה בדיוק את הפריט שמתגלה אחרי
 * זיכרון הדברים. לכן הרשימה סגורה ומרכזית — והמשרד מסמן „לא
 * רלוונטי” במקום למחוק.
 *
 * ## מה המצב אומר
 *
 * ‎`unchecked` — עוד לא בדקו. ‎`ok` — נבדק ותקין. ‎`issue` — נבדק
 * ונמצאה בעיה (השרשור של הסיכון). ‎`na` — אינו חל על הנכס הזה
 * (נכס ללא שוכר, קרקע ללא היתרים). ההתקדמות סופרת את שלושת
 * האחרונים כ„נבדק”: „לא רלוונטי” הוא החלטה, לא השמטה.
 *
 * ## למה אין כאן קובץ
 *
 * הנסח עצמו, האישור מהוועדה — נשמרים בלשונית „מסמכים והסכמים”, שכבר
 * יודעת להעלות, לשמור ולשרת קבצים תחת הנכס. הרשימה הזו היא
 * ה**מצב** של כל בדיקה, לא הארכיון שלה.
 */

export const PROPERTY_CHECK_KEYS = [
  "tabu",
  "liens",
  "rights",
  "planning",
  "permits",
  "deviations",
  "demolition",
  "municipal",
  "tenancy",
  "authority",
  "area",
] as const;
export type PropertyCheckKey = (typeof PROPERTY_CHECK_KEYS)[number];

export const PROPERTY_CHECK_STATUSES = ["unchecked", "ok", "issue", "na"] as const;
export type PropertyCheckStatus = (typeof PROPERTY_CHECK_STATUSES)[number];

export const PROPERTY_CHECK_STATUS_LABELS: Record<PropertyCheckStatus, string> = {
  unchecked: "לא נבדק",
  ok: "תקין",
  issue: "בעיה",
  na: "לא רלוונטי",
};

export const PROPERTY_CHECK_NOTE_MAX = 500;

export interface PropertyCheckDefinition {
  key: PropertyCheckKey;
  title: string;
  /** למה זה חשוב — מה מתגלה אחרי החתימה אם מדלגים */
  why: string;
  /** השירות הממשלתי שבו בודקים, כשיש אחד ארצי; `null` = ברשות המקומית */
  href: string | null;
}

export const PROPERTY_CHECKS: readonly PropertyCheckDefinition[] = [
  {
    key: "tabu",
    title: "נסח טאבו עדכני",
    why: "מי הבעלים הרשום, ומה רשום על הנכס — הבסיס לכל השאר. נסח מלפני חצי שנה אינו עדכני.",
    href: "https://www.gov.il/he/service/land_registry_extract",
  },
  {
    key: "liens",
    title: "הערות אזהרה, שעבודים ועיקולים",
    why: "משכנתה, עיקול או הערת אזהרה לטובת צד שלישי משנים את העסקה — ולפעמים מונעים אותה.",
    href: "https://www.gov.il/he/service/land_registry_extract",
  },
  {
    key: "rights",
    title: "סוג הזכות — טאבו, רמ״י או חברה משכנת",
    why: "חכירה מרמ״י או זכויות בחברה משכנת דורשות אישורים והעברה שונים, ולפעמים דמי הסכמה.",
    href: "https://www.gov.il/he/departments/israel_land_authority/govil-landing-page",
  },
  {
    key: "planning",
    title: "מידע תכנוני ותב״ע",
    why: "זכויות בנייה, ייעוד ותכניות בהכנה — מה שקובע אם „אפשר להוסיף קומה” הוא הבטחה או סיפור.",
    href: "https://mavat.iplan.gov.il/SV3",
  },
  {
    key: "permits",
    title: "היתרי בנייה ותיק בניין",
    why: "מה שנבנה בהיתר ומה לא. תיק הבניין בוועדה המקומית הוא המקור, לא דברי המוכר.",
    href: null,
  },
  {
    key: "deviations",
    title: "חריגות בנייה מול ההיתר",
    why: "מרפסת שנסגרה, יחידה שפוצלה — חריגה שמתגלה בשמאות הבנק מפילה משכנתה, ואיתה את העסקה.",
    href: null,
  },
  {
    key: "demolition",
    title: "צווי הריסה ותביעות תלויות",
    why: "צו הריסה או תביעה על הנכס עוברים עם הנכס לקונה.",
    href: null,
  },
  {
    key: "municipal",
    title: "ארנונה, ועד בית וחובות",
    why: "אישור עירייה לטאבו לא יינתן עם חוב ארנונה, וחוב ועד בית הופך לשיחה לא נעימה במסירה.",
    href: null,
  },
  {
    key: "tenancy",
    title: "שוכר קיים, חוזה ומועד פינוי",
    why: "נכס מושכר נמכר עם השוכר. מועד הפינוי ותנאי החוזה קובעים למי אפשר להציע אותו.",
    href: null,
  },
  {
    key: "authority",
    title: "ייפוי כוח, ירושה או צו קיום צוואה",
    why: "מי שמוכר חייב להיות מי שרשאי למכור. ירושה בלי צו, או ייפוי כוח שפג — אין עסקה.",
    href: null,
  },
  {
    key: "area",
    title: "שטח רשום מול שטח בפועל",
    why: "פער בין השטח בנסח לשטח שמודדים במקום הוא הטענה הראשונה של קונה שרוצה הנחה.",
    href: null,
  },
];

export const PROPERTY_CHECK_BY_KEY: Readonly<Record<PropertyCheckKey, PropertyCheckDefinition>> =
  Object.fromEntries(PROPERTY_CHECKS.map((c) => [c.key, c])) as Record<PropertyCheckKey, PropertyCheckDefinition>;

export interface PropertyChecksProgress {
  total: number;
  /** נבדק — תקין, בעיה או לא רלוונטי */
  checked: number;
  remaining: number;
  issues: number;
  percent: number;
  /** הכול נבדק ובלי בעיות — הנכס מוכן להחתמה */
  allClear: boolean;
}

/** ההתקדמות — פונקציה טהורה, אותו חישוב במסך ובשרת. */
export function propertyChecksProgress(
  items: readonly { status: PropertyCheckStatus }[],
): PropertyChecksProgress {
  const total = items.length;
  const checked = items.filter((i) => i.status !== "unchecked").length;
  const issues = items.filter((i) => i.status === "issue").length;
  return {
    total,
    checked,
    remaining: total - checked,
    issues,
    percent: total === 0 ? 0 : Math.round((checked / total) * 100),
    allClear: total > 0 && checked === total && issues === 0,
  };
}

/** כותרת המשימה שנולדת מבדיקה שטרם נעשתה. */
export function propertyCheckTaskTitle(key: PropertyCheckKey): string {
  return `לבדוק: ${PROPERTY_CHECK_BY_KEY[key].title}`;
}

/** מפתח האידמפוטנטיות של המשימה — בדיקה אחת, משימה אחת. */
export function propertyCheckTaskSourceKey(key: PropertyCheckKey): string {
  return `property-check:${key}`;
}
