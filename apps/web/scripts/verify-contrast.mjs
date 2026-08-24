/**
 * ניגודיות טוקני הצבע — **נמדדת, לא מוערכת בעין.**
 *
 * ## למה שער ולא הנחיה
 *
 * זו הפעם השלישית שהמערכת מתקנת ניגודיות בעקבות דיווח משתמשים.
 * פעמיים הוכהה הטקסט, ובפעם הזו התברר שהתלונה על „טקסטים בהירים”
 * הצביעה בכלל על המסגרות: הטקסט כבר עמד ב-18.8:1 וב-10:1, בזמן
 * שגבול שדה הקלט עמד על **1.29:1** מול סף של 3:1.
 *
 * זה בדיוק סוג הכשל שאי אפשר לראות בעין — גבול חיוור נראה „עדין”
 * ולא „שבור”, והמצטבר על מסך מלא שדות הוא תחושת דהייה שאיש אינו
 * יודע להצביע על מקורה. מספר יודע.
 *
 * ## הספים
 *
 * מ-WCAG 2.2:
 * - 1.4.3 — טקסט רגיל: 4.5:1.
 * - 1.4.11 — **גבולות של פקדי ממשק**: 3:1. זה הסעיף שנשבר כאן,
 *   והוא חל על מסגרת של שדה קלט — היא מה שמגדיר איפה השדה מתחיל.
 *
 * ## מה **לא** נבדק
 *
 * מסגרות דקורטיביות (כרטיס, מפריד שורות) פטורות מהסף: הכרטיס
 * נבדל גם בצללית, והשורה גם ברווח. שער שהיה כופה עליהן 3:1 היה
 * הופך את המסך לרשת כבדה של קווים — כלומר מתקן קריאוּת בעזרת
 * פגיעה בקריאוּת. הן מופיעות בפלט כמידע, בלי להכשיל.
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "src", "app", "globals.css"), "utf8");

/**
 * הגיליון **בלי ההערות** — וזו הצורה היחידה שנקראת כאן.
 *
 * הערה אינה קוד, אבל היא נראית כמוהו לכל ביטוי רגולרי. שתי פעמים
 * כבר הטעתה אחת את השער הזה: הערה ישנה נשאה ערך צבע שכבר לא קיים
 * (`--color-bg: #f4f6f3`), והערה שמסבירה מחלקה גרמה לשם המחלקה
 * להיספר כ„מוגדרת” גם אחרי שהכלל עצמו נמחק — כי הבורר שנקרא הוא
 * מה שאחרי ה-`}` הקודם, כלומר ההערה **ועוד** הבורר של הכלל הבא
 * (ביקורת Codex).
 *
 * המחיקה שומרת על שורות: כל תו שאינו ירידת שורה הופך לרווח, ולכן
 * `slice(0, index)` ממשיך להחזיר את מספר השורה האמיתי בקובץ.
 */
const css = source.replace(/\/\*[\s\S]*?\*\//gu, (block) =>
  block.replace(/[^\n]/gu, " "),
);

/** כל כללי הגיליון פעם אחת — `[בורר, גוף, אינדקס]`. */
const CSS_RULES = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)];

/** הכללים שנוגעים במחלקה מסוימת — `.mv-select` ולא `.mv-select-list`. */
const rulesByClass = new Map();
function classRules(name) {
  const cached = rulesByClass.get(name);
  if (cached !== undefined) return cached;
  const probe = new RegExp(`\\.${name}(?![\\w-])`, "u");
  const found = CSS_RULES.filter((rule) => probe.test(rule[1]));
  rulesByClass.set(name, found);
  return found;
}

/**
 * ‎#rgb‎ ⟵ ‎#rrggbb‎. הצורה המקוצרת חוקית לגמרי ב-CSS, ויש 19 כאלה
 * בגיליון הזה — כמעט כולם `#fff`. ביטוי שמכיר רק שש ספרות אינו
 * „מפספס תו”: הוא **מדלג בשקט** על ההצהרה כולה, ולכן טקסט לבן על
 * רקע בהיר נספר כתקין (ביקורת Codex).
 */
function normalizeHex(value) {
  const short = /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/u.exec(value);
  if (short !== null) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  return /^#[0-9a-fA-F]{6}$/u.test(value) ? value.toLowerCase() : null;
}

/** ‎#rrggbb‎ ⟵ הבהירות היחסית לפי WCAG. */
function luminance(hex) {
  const c = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
    .map((s) => (s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)];
  const [hi, lo] = x > y ? [x, y] : [y, x];
  return (hi + 0.05) / (lo + 0.05);
}

/* ==================== הערך שמגיע למסך ==================== */

/**
 * **הטוקן הסמנטי נפתר עד לצבע, בכל ערכה בנפרד.**
 *
 * הגרסה הקודמת מדדה את `--dk-input-border` ישירות, ומעולם לא בדקה
 * ש-`--color-input-border` אכן מצביע עליו. החלפת המיפוי בשתי
 * ההצהרות הכהות ל-`var(--dk-border)` — הטוקן הדקורטיבי, 1.80:1 —
 * הייתה משאירה את השער ירוק: המספרים שנמדדו נשארו נכונים, והם
 * פשוט כבר לא היו הצבעים שהמשתמש מקבל (ביקורת Codex).
 *
 * לכן הבדיקה מנוסחת בשמות **סמנטיים** בלבד, והפתרון עובר דרך
 * המיפוי: `--color-X` בערכה הכהה הוא `var(--dk-Y)`, ו-`--dk-Y`
 * נפתר לצבע. מיפוי שיוסט מצביע כעת על ערך אחר, והמדידה נופלת.
 *
 * ## שלוש ערכות ולא שתיים
 *
 * `contrast` היא הערכה הכהה **ועליה** בלוק הניגודיות הגבוהה, כי כך
 * הדפדפן מרכיב אותן: הבלוק דורס טוקנים מסוימים ומשאיר את השאר
 * כפי שהערכה הכהה קבעה. זו הצירוף שאיש אינו חושב עליו — ושם היה
 * טקסט שחור על משטח כמעט-שחור.
 */
const THEME_SELECTORS = {
  light: [":root"],
  dark: [":root", ":root[data-theme=\"dark\"]"],
  contrast: [":root", ":root[data-theme=\"dark\"]", ":root[data-a11y-contrast=\"on\"]"],
};

/**
 * כל ההצהרות בגוף כלל — האחרונה גוברת, כמו בקסקייד.
 *
 * **לא רק טוקנים.** `color-scheme` אינו טוקן והוא קובע איך הדפדפן
 * מצייר את מה שאינו שלנו — חץ הבורר, אייקון לוח השנה, פסי הגלילה
 * וההשלמה האוטומטית. סינון ל-`--*` בלבד היה משאיר אותו מחוץ
 * לבדיקת הדליפה, וזה בדיוק המקום שבו הוא נשכח (ביקורת Codex).
 */
function declarationsIn(body, into) {
  for (const decl of body.matchAll(/([\w-]+)\s*:\s*([^;]+);/gu)) {
    into.set(decl[1], decl[2].trim());
  }
  return into;
}

/** כל ההצהרות של ערכה, לפי סדר הבוררים שמרכיבים אותה. */
function themeDeclarations(selectors) {
  const out = new Map();
  for (const selector of selectors) {
    for (const rule of CSS_RULES) {
      if (rule[1].trim() === selector) declarationsIn(rule[2], out);
    }
  }
  return out;
}

const THEMES = Object.fromEntries(
  Object.entries(THEME_SELECTORS).map(([name, selectors]) => [
    name,
    themeDeclarations(selectors),
  ]),
);

const THEME_LABEL = { light: "בהיר", dark: "כהה", contrast: "ניגודיות גבוהה" };

/**
 * הצבע שהטוקן מקבל בערכה — אחרי מעקב אחרי `var(--…)`.
 *
 * העומק חסום: שרשרת הפניות אמיתית כאן היא באורך אחת
 * (`--color-X` → `--dk-Y` → צבע), והחסם מונע לולאה אינסופית מכל
 * טעות עתידית שתיצור מעגל.
 */
function resolveValue(value, theme, backdrop = null) {
  const decls = THEMES[theme];
  let current = value;
  for (let step = 0; step < 5 && current !== undefined && current !== null; step += 1) {
    const hex = normalizeHex(current);
    if (hex !== null) return hex;
    const mixed = mixValue(current, theme, backdrop);
    if (mixed !== null) return mixed;
    const composited = compositeValue(current, backdrop);
    if (composited !== null) return composited;
    /*
     * `var(--x, #fff)` — הערך השני הוא מה שהדפדפן מצייר כשהטוקן
     * אינו מוגדר, ולכן הוא חלק מהמדידה ולא הערה צדדית.
     */
    const ref = /^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)$/u.exec(current);
    if (ref === null) return null;
    current = decls.get(ref[1]) ?? ref[2]?.trim();
  }
  return null;
}

/**
 * `rgba(0, 0, 0, 0.45)` ו-`rgb(255 255 255 / 22%)` — **מורכבים על
 * מה שמתחתיהם**, לא מדולגים.
 *
 * צבע שקוף־למחצה אינו „צבע” עד שיודעים על מה הוא יושב, ולכן הוא
 * דרש את שרשרת המשטחים: משטח הבסיס של המחלקה, ומתחתיו משטח
 * העמוד. בלי זה גלולה על רקע לבן־22% נספרה כלא־נמדדת — ושתיקה
 * כזו היא בדיוק מה שהסתיר את `#fff`.
 *
 * ‎`backdrop === null`‎ מחזיר `null` במכוון: אין שקר גרוע יותר
 * מלהניח לבן ולדווח „עובר”.
 */
function compositeValue(value, backdrop) {
  const parts = /^rgba?\(([^()]*)\)$/u.exec(value);
  if (parts === null) return null;
  const numbers = parts[1].split(/[\s,/]+/u).filter((token) => token !== "");
  if (numbers.length < 3) return null;
  const channels = numbers.slice(0, 3).map((token) => Number(token));
  if (channels.some((n) => !Number.isFinite(n))) return null;
  const raw = numbers[3];
  const alpha =
    raw === undefined ? 1 : raw.endsWith("%") ? Number(raw.slice(0, -1)) / 100 : Number(raw);
  if (!Number.isFinite(alpha)) return null;
  const hex = (list) =>
    `#${list.map((n) => Math.round(n).toString(16).padStart(2, "0")).join("")}`;
  if (alpha >= 0.999) return hex(channels);
  if (backdrop === null) return null;
  const under = [0, 1, 2].map((at) => parseInt(backdrop.slice(1 + at * 2, 3 + at * 2), 16));
  return hex(channels.map((n, at) => n * alpha + under[at] * (1 - alpha)));
}

function resolve(name, theme) {
  return resolveValue(THEMES[theme].get(`--${name}`), theme);
}

/**
 * `color-mix(in srgb, A 6%, B)` — נפתר ולא מדולג.
 *
 * זה הרקע של ריחוף על כפתור „כל הפרטים” ברשת. ביטוי רגולרי
 * שמחפש „הצבע הראשון” בערך היה קורא ממנו את `A` ומדווח על טקסט
 * בניגודיות 1.00:1 — התראת שווא על כפתור תקין. דילוג היה הקצה
 * השני: שקט על כל מה שנכתב בצורה הזו.
 *
 * המיזוג ב-sRGB הוא ממוצע משוקלל פשוט לכל ערוץ, ולכן אין סיבה
 * לוותר על המדידה.
 */
function mixValue(value, theme, backdrop = null) {
  const mix = /^color-mix\(\s*in\s+srgb\s*,\s*(.+?)\s+([\d.]+)%\s*,\s*(.+?)\s*\)$/u.exec(value);
  if (mix === null) return null;
  /*
   * `color-mix(…, var(--x) 12%, transparent)` הוא הניב המקובל
   * ל„שכבה קלה מעל מה שמתחת” — התוצאה שקופה־למחצה, ולכן היא
   * נפתרת רק מול מצע. בלי הענף הזה היא נספרה כבלתי־פתירה.
   */
  const first = resolveValue(mix[1], theme, backdrop);
  const second =
    mix[3].trim() === "transparent" ? backdrop : resolveValue(mix[3], theme, backdrop);
  if (first === null || second === null) return null;
  const weight = Number(mix[2]) / 100;
  const channel = (hex, at) => parseInt(hex.slice(1 + at * 2, 3 + at * 2), 16);
  return `#${[0, 1, 2]
    .map((at) => Math.round(channel(first, at) * weight + channel(second, at) * (1 - weight)))
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("")}`;
}

/** [ערכה, טוקן, טוקן הרקע, סף, תיאור] — הכול בשמות סמנטיים. */
const REQUIRED = [];

/*
 * גבול הפקד נמדד מול **כל** רקע שהוא יכול לשבת עליו, ולא רק מול
 * השדה: יש פקדים ש-`background` שלהם הוא `--color-bg` (בורר הספק
 * בהגדרות המרכזייה) ואחרים שיושבים על משטח הכרטיס. מדידה מול רקע
 * אחד היא הצהרה על מסך שלם לפי מקרה אחד (ביקורת Codex).
 *
 * שלוש הערכות × שלושה רקעים — כי הרקעים אינם זהים בכולן, ולא
 * מספיק שהם זהים היום.
 */
const SURFACES = [
  ["color-field", "השדה"],
  ["color-bg", "רקע העמוד"],
  ["color-surface", "הכרטיס"],
];
const TEXT_ON_SURFACE = [
  ["color-text", 4.5, "טקסט ראשי"],
  ["color-text-muted", 4.5, "טקסט משני"],
];

for (const theme of Object.keys(THEME_SELECTORS)) {
  const suffix = THEME_LABEL[theme];
  for (const [surface, where] of SURFACES) {
    REQUIRED.push([theme, "color-input-border", surface, 3, `גבול פקד מול ${where} (${suffix})`]);
  }
  /*
   * הטקסט נמדד גם הוא מול **השדה** ולא רק מול העמוד. זה הזוג
   * שנשבר בניגודיות גבוהה על ערכה כהה: הבלוק משחיר את הטקסט,
   * ומשאיר את משטח השדה כפי שהערכה הכהה קבעה אותו.
   */
  for (const [name, min, where] of TEXT_ON_SURFACE) {
    REQUIRED.push([theme, name, "color-bg", min, `${where} (${suffix})`]);
    REQUIRED.push([theme, name, "color-field", min, `${where} על שדה (${suffix})`]);
  }
  REQUIRED.push([theme, "color-text-soft", "color-bg", 4.5, `תוויות לשוניות (${suffix})`]);
  REQUIRED.push([theme, "color-danger", "color-bg", 4.5, `שגיאה (${suffix})`]);
  REQUIRED.push([theme, "color-primary", "color-bg", 4.5, `קישורים (${suffix})`]);
}

/** נמדדים ומוצגים, אך אינם מכשילים — ראו „מה לא נבדק”. */
const INFORMATIVE = [
  ["light", "color-border", "color-bg", "מסגרת כרטיס (בהיר)"],
  ["light", "color-row-border", "color-bg", "מפריד שורות (בהיר)"],
  ["dark", "color-border", "color-surface", "מסגרת כרטיס (כהה)"],
];

const failures = [];
let checked = 0;

for (const [theme, fg, bg, min, label] of REQUIRED) {
  const a = resolve(fg, theme);
  const b = resolve(bg, theme);
  if (a === null || b === null) {
    failures.push(
      `${label}: --${a === null ? fg : bg} אינו נפתר לצבע בערכה ה${THEME_LABEL[theme]}`,
    );
    continue;
  }
  checked += 1;
  const ratio = contrast(a, b);
  if (ratio < min) {
    failures.push(
      `${label}: --${fg} (${a}) מול --${bg} (${b}) = ${ratio.toFixed(2)}:1, נדרש ${min}:1`,
    );
  }
}

/* ==================== מי באמת משתמש בטוקן ==================== */

/**
 * הטוקן שנמדד אינו בהכרח הטוקן שהמשתמש רואה.
 *
 * הגרסה הראשונה של השער הזו עברה בירוק בזמן שרוב טפסי המערכת
 * המשיכו להיות חיוורים: הם אינם נשענים על מחלקת ה-CSS אלא על
 * `style={{ borderColor: "var(--color-border)" }}` בתוך ה-JSX,
 * והטוקן הזה הוא הדקורטיבי — 1.65:1 (ביקורת Codex). כלומר השער
 * הוכיח שהטוקן תקין ולא שהמסך תקין.
 *
 * לכן החלק הזה בודק **שימוש**: כל `input`, `select` ו-`textarea`
 * חייבים לקבל את גבול הפקד. סגנון בשורה גובר על CSS, ואין דרך
 * לתקן זאת בגיליון הסגנונות.
 */
/**
 * מה נחשב פקד — **לא רק תגית טופס.**
 *
 * `input`/`select`/`textarea` הן הצורה הנפוצה, אך לא היחידה. שטח
 * החתימה בהסכם הוא `canvas` שהמשתמש מצייר בתוכו, והמסגרת שלו היא
 * מילולית „חתמו כאן” — היא הייתה על המסגרת הדקורטיבית, 1.65:1
 * מול הקנבס הלבן, בעמוד חתימה משפטי (ביקורת Codex).
 *
 * `button` נוסף מאותו נימוק: 1.4.11 מדבר על „רכיבי ממשק”, וגבול
 * של כפתור מזהה אותו בדיוק כמו גבול של שדה. ההרחבה הזו מצאה מיד
 * שתי מחלקות כפתור שהיו בשימוש ולא הוגדרו כלל.
 *
 * `contentEditable` נבדק בנפרד למטה: זו הדרך השנייה והאחרונה
 * ב-HTML לייצר משטח קלט שאינו תגית טופס. אין כזה בקוד היום —
 * הכלל קיים כדי שגם לא יהיה בלי שיישאל.
 */
const CONTROL_TAGS = ["input", "select", "textarea", "canvas", "button"];
const DECORATIVE_BORDER = "var(--color-border)";

/**
 * **קישור שמעוצב ככפתור הוא כפתור.**
 *
 * פעולת ההתחברות עם Google היא `<a>` ולא `<button>`, ולכן היא
 * נשארה מחוץ לסריקה עם המסגרת הדקורטיבית — 1.65:1 — בזמן שהשער
 * הדפיס „כל הפקדים תקינים” (ביקורת Codex).
 *
 * ההבחנה אינה לפי שם המחלקה אלא לפי מה שהגיליון אומר עליה:
 * `cursor: pointer` על **נושא** הבורר. קישור הוא לחיץ מטבעו, ולכן
 * גיליון שטורח להצהיר זאת עליו מתאר כפתור. כרטיס או שורה שהם
 * קישור — אריח הנתון בדשבורד, פריט „טווח ההגעה” — אינם מצהירים
 * זאת, וזה נכון גם לגופו של עניין: 1.4.11 מדבר על מה שנדרש כדי
 * **לזהות** את הרכיב, וכרטיס מזוהה בתוכן שלו ולא בקצה שלו. שער
 * שהיה כופה 3:1 גם עליהם היה מקיף כל אריח בדשבורד בקו כהה.
 */
const LINK_TAGS = ["a", "Link"];
const clickableClasses = new Set();
for (const rule of CSS_RULES) {
  if (!/cursor\s*:\s*pointer/u.test(rule[2])) continue;
  for (const part of rule[1].split(",")) {
    const names = [...part.matchAll(/\.([\w-]+)(?![\w-])/gu)];
    if (names.length > 0) clickableClasses.add(names[names.length - 1][1]);
  }
}

/** תוכן התגית מהפתיחה ועד ה-`>` שסוגר אותה, בלי להיבלע בסוגריים מסולסלים. */
function openingTag(source, from) {
  let depth = 0;
  for (let i = from; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    else if (ch === ">" && depth === 0) return source.slice(from, i);
  }
  return source.slice(from);
}

/**
 * אובייקטי הסגנון שבקובץ — שם הקבוע ⟵ הגוף שלו.
 *
 * הבדיקה על התגית לבדה אינה מספיקה: `style={editInputStyle}` אינו
 * מכיל את שם הטוקן, והשדה בכל זאת מקבל אותו (ביקורת Codex). זו
 * הצורה השכיחה בקוד הזה — קבוע אחד בראש הקובץ שמוחל על חמישה
 * שדות — ולכן בדיקה שאינה פותרת אותו מפספסת דווקא את המקרה הנפוץ.
 *
 * המפה משמשת את שתי השאלות: אילו קבועים נושאים את המסגרת
 * הדקורטיבית, ואילו קובעים מסגרת כלשהי.
 */
function styleObjects(source) {
  const bodies = new Map();
  const pattern = /const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*\{/gu;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const open = source.indexOf("{", match.index);
    let depth = 0;
    let end = source.length;
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    bodies.set(match[1], source.slice(open, end));
  }
  return bodies;
}

/** הצהרת מסגרת — `border`, `borderColor`, `border-inline-start` וכו'. אך לא `border-radius`. */
const BORDER_DECL =
  /(?:^|[\s;{,])border(?:-?(?:block|inline|top|right|bottom|left|start|end))?(?:-?(?:start|end))?(?:-?(?:color|width|style|Color|Width|Style))?\s*:/mu;

/**
 * כל מקום בקובץ שהמשתמש מזין או פועל בו.
 *
 * תגית מרשימת הפקדים, **או** כל תגית שנושאת `contentEditable` —
 * שתי הדרכים היחידות ב-HTML לייצר משטח קלט. הסריקה עוברת פעם
 * אחת על כל התגיות בקובץ במקום פעם לכל שם, וזה גם מה שמאפשר
 * לתפוס תגית שאינה ברשימה מראש.
 */
function controlSites(source) {
  const sites = [];
  for (const match of source.matchAll(/<([a-zA-Z][\w.]*)/gu)) {
    const tag = match[1];
    const native = CONTROL_TAGS.includes(tag);
    const body = openingTag(source, match.index);
    const link =
      LINK_TAGS.includes(tag) &&
      (/role="button"/u.test(body) ||
        classNamesIn(body).some((cls) => clickableClasses.has(cls)));
    if (!native && !link && !/\bcontentEditable\b/u.test(body)) continue;
    sites.push({ tag, body, index: match.index });
  }
  return sites;
}

/**
 * כל מחרוזת בתוך `className` — גם `"a b"` וגם ביטוי מותנה שבתוכו
 * מחרוזות. השמות האלה הם מה שהחלק שב-CSS מחפש.
 */
function classNamesIn(body) {
  const classes = [];
  for (const attr of body.matchAll(/className=(?:"([^"]*)"|\{([\s\S]*?)\})/gu)) {
    const text = attr[1] ?? attr[2] ?? "";
    for (const quoted of text.matchAll(/["'`]([^"'`]*)["'`]/gu)) {
      classes.push(...quoted[1].split(/\s+/u));
    }
    if (attr[1] !== undefined) classes.push(...attr[1].split(/\s+/u));
  }
  return classes;
}

/** המחלקות שמופיעות על פקד ב-JSX — לחצי השני של הבדיקה, ב-CSS. */
const controlClasses = new Set();

/** פקד אחד ב-JSX והמחלקות שהוא נושא — לבדיקה השלישית. */
const controlUses = [];

/**
 * כל אתר ב-JSX שקובע צבע **בסגנון בשורה** — הצבע והמשטח יחד.
 *
 * המדידה של הגיליון אינה רואה אותו כלל, ולכן כפתור הבחירה בטופס
 * הציבורי הציג `#fff` על `var(--color-primary)` — בערכה הכהה
 * 1.68:1 — והשער דיווח שכל צמדי הטקסט עוברים (ביקורת Codex).
 *
 * **בלי רשימת תגיות.** התנאי היחיד הוא שהמחבר כתב את הצבע בשורה:
 * אם הוא קבע אותו שם, הצמד ניתן להכרעה, ו-1.4.3 חל על טקסט ולא
 * על „פקדים”. שני מהכשלים שנמצאו כאן הם `span` ולא כפתור.
 */
const inlineUses = [];

/** הטקסט הגולמי של מאפיין סגנון — עד הפסיק הבא ברמת האובייקט. */
function rawValue(style, property) {
  const found = new RegExp(`(?:^|[,{\\s])${property}\\s*:\\s*`, "u").exec(style);
  if (found === null) return null;
  let depth = 0;
  const from = found.index + found[0].length;
  for (let i = from; i < style.length; i += 1) {
    const ch = style[i];
    if ("({[".includes(ch)) depth += 1;
    else if (")}]".includes(ch)) {
      if (depth === 0) return style.slice(from, i);
      depth -= 1;
    } else if (ch === "," && depth === 0) return style.slice(from, i);
  }
  return style.slice(from);
}

/**
 * הענפים של ביטוי הסגנון — **הערכים בלבד, לא התנאים.**
 *
 * שליפת „כל מחרוזת שבביטוי” נראית פשוטה וטועה בדיוק במקום הרגיש:
 * התנאי עצמו נושא מחרוזות (`weight === "must" ? … : …`), והן
 * נקראו כצבעים. שרשרת תנאים מפורקת כאן לפי מבנה — התנאי לחוד
 * והערך לחוד — ולכן `"must"` אינו נמדד, ושלושת הענפים כן.
 */
function branches(raw) {
  const text = raw.trim();
  let depth = 0;
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote !== null) {
      if (ch === quote) quote = null;
      continue;
    }
    if ("\"'`".includes(ch)) quote = ch;
    else if ("({[".includes(ch)) depth += 1;
    else if (")}]".includes(ch)) depth -= 1;
    else if (ch === "?" && depth === 0) {
      const split = matchingColon(text, i + 1);
      if (split === -1) break;
      const left = branches(text.slice(i + 1, split));
      const right = branches(text.slice(split + 1));
      return {
        conditions: [text.slice(0, i).trim(), ...left.conditions.slice(1), ...right.conditions],
        values: [...left.values, ...right.values],
      };
    }
  }
  const literal = /^("([^"]*)"|'([^']*)')$/u.exec(text);
  return { conditions: [null], values: [literal === null ? null : (literal[2] ?? literal[3])] };
}

/** ה-`:` שסוגר את ה-`?` — מדלג על תנאים מקוננים. */
function matchingColon(text, from) {
  let depth = 0;
  let pending = 0;
  let quote = null;
  for (let i = from; i < text.length; i += 1) {
    const ch = text[i];
    if (quote !== null) {
      if (ch === quote) quote = null;
      continue;
    }
    if ("\"'`".includes(ch)) quote = ch;
    else if ("({[".includes(ch)) depth += 1;
    else if (")}]".includes(ch)) depth -= 1;
    else if (ch === "?" && depth === 0) pending += 1;
    else if (ch === ":" && depth === 0) {
      if (pending === 0) return i;
      pending -= 1;
    }
  }
  return -1;
}

function styleValues(style, property) {
  const raw = rawValue(style, property);
  return raw === null ? null : branches(raw);
}

function collectInline(file, source, styles) {
  for (const match of source.matchAll(/<([a-zA-Z][\w.]*)/gu)) {
    const body = openingTag(source, match.index);
    const direct = /style=\{\{([\s\S]*)$/u.exec(body);
    const named = direct === null ? /style=\{([A-Za-z_$][\w$]*)\}/u.exec(body) : null;
    const style = direct?.[1] ?? (named === null ? null : styles.get(named[1]));
    if (style === null || style === undefined) continue;
    const text = styleValues(style, "color");
    if (text === null) continue;
    inlineUses.push({
      where: `${file}:${source.slice(0, match.index).split("\n").length}`,
      tag: match[1],
      classes: classNamesIn(body).filter((cls) => /^mv-[\w-]+$/u.test(cls)),
      text,
      fill: styleValues(style, "background") ?? styleValues(style, "backgroundColor"),
    });
  }
}

function scanControls(dir, hits) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      scanControls(full, hits);
      continue;
    }
    if (!entry.name.endsWith(".tsx")) continue;
    const source = readFileSync(full, "utf8");
    const styles = styleObjects(source);
    const tainted = [...styles].filter(([, body]) => body.includes(DECORATIVE_BORDER));
    const bordered = [...styles].filter(([, body]) => BORDER_DECL.test(body));
    collectInline(full, source, styles);
    for (const site of controlSites(source)) {
      const { tag, body } = site;
      const line = source.slice(0, site.index).split("\n").length;
      const classes = classNamesIn(body);
      const mine = classes.filter((cls) => /^mv-[\w-]+$/u.test(cls));
      for (const cls of mine) controlClasses.add(cls);
      if (mine.length > 0) {
        controlUses.push({
          where: `${full}:${line}`,
          tag,
          classes: mine,
          /*
           * מסגרת שנקבעת על התגית עצמה מייתרת את המחלקה: מחלקת
           * Tailwind (`border-0` על גלולת הסטטוס), סגנון בשורה,
           * או קבוע סגנון שקובע מסגרת.
           */
          explicit:
            classes.some((cls) => /^border(?:-|$)/u.test(cls)) ||
            BORDER_DECL.test(body) ||
            bordered.some(([name]) => new RegExp(`\\b${name}\\b`, "u").test(body)),
        });
      }
      const direct = body.includes(DECORATIVE_BORDER);
      // הפניה לקבוע נגוע — כולל בפריסה (`{...inputStyle, ...}`)
      const viaName = tainted
        .map(([name]) => name)
        .find((name) => new RegExp(`\\b${name}\\b`, "u").test(body));
      if (!direct && viaName === undefined) continue;
      hits.push(
        `${full}:${line} — <${tag}> עם ${direct ? DECORATIVE_BORDER : `${viaName} (סגנון נגוע)`}`,
      );
    }
  }
}

/* ==================== הצד השני: גיליון הסגנונות ==================== */

/**
 * פקד שהמסגרת שלו מגיעה מ-CSS ולא מסגנון בשורה.
 *
 * הסריקה ב-JSX לבדה מכסה חצי מהמערכת: `.mv-control` מוחלת על שדות
 * ישירות, ו-`.mv-search-field` היא **עוטפת** — השדה עצמו חסר מסגרת
 * והגבול הנראה שייך לה. שינוי של אחת מהן חזרה למסגרת הדקורטיבית
 * היה משאיר שדות אמיתיים בניגודיות נמוכה בזמן שהשער מדפיס „הכול
 * תקין” (ביקורת Codex).
 *
 * הרשימה אינה מתוחזקת ביד — היא **נגזרת**: מחלקה נחשבת מחלקה של
 * פקד אם היא הופיעה על פקד ב-JSX, או אם קיים כלל CSS שבו היא
 * הורה של פקד (`.x input`). מחלקה חדשה שתיווצר מחר נכנסת מאליה.
 */
/**
 * `tags` — אילו תגיות הופכות עוטפת ל„מחלקה של פקד”.
 *
 * שתי השאלות אינן זהות, ולכן גם הרשימה אינה. **באיזה טוקן משתמש
 * הגבול** היא שאלה על שדה טופס: שם העוטפת נושאת את המסגרת ממש
 * (`.mv-search-field > input` — לשדה עצמו אין), ולכן היא נמדדת
 * בסף הפקד. מסלול הלשוניות אינו כזה: הכפתורים שבתוכו מזוהים
 * במילוי שלהם, והקו שמקיף את כולם הוא קישוט. כפיית 3:1 עליו הייתה
 * מקיפה כל סרגל לשוניות במערכת בקו כהה.
 *
 * **מה יוצא על המסך** היא שאלה אחרת לגמרי, והיא חלה על כל פקד —
 * כולל כפתור עירום בתוך עוטפת. שם הרשימה רחבה.
 */
function controlSelectorNames(tags = ["input", "select", "textarea"]) {
  const names = new Set(controlClasses);
  for (const rule of CSS_RULES) {
    const selector = rule[1];
    // `.x input`, `.x > textarea`, `.x:focus-within select` — כולם עוטפים
    const wrapper = new RegExp(
      `\\.([\\w-]+)[^,{]*[\\s>+~](?:${tags.join("|")})(?![\\w-])`,
      "u",
    ).exec(selector);
    if (wrapper) names.add(wrapper[1]);
  }
  return names;
}

function scanStylesheet(hits) {
  const names = controlSelectorNames();
  for (const rule of CSS_RULES) {
    // ההערות כבר נמחקו מהמקור; נשאר רק לקצץ את הרווח שהן הותירו
    const selector = rule[1].trim();
    const body = rule[2];
    if (!/(?:^|[\s;])border(?:-[a-z-]+)?:[^;]*var\(--color-border\)/mu.test(body)) continue;
    const touchesControl =
      /(?:^|[\s,>+~])(?:input|select|textarea)\b/u.test(selector) ||
      /*
       * `(?![\w-])` ולא `\b`: מקף אינו תו-מילה, ולכן `\b` אחרי
       * `.mv-select` נתפס גם בתוך `.mv-select-list` — והשער דיווח
       * על רשימת הבחירה כאילו היא שדה קלט.
       */
      [...names].some((name) => new RegExp(`\\.${name}(?![\\w-])`, "u").test(selector));
    if (!touchesControl) continue;
    const line = css.slice(0, rule.index).split("\n").length;
    hits.push(`globals.css:${line} — ${selector.replace(/\s+/gu, " ")} עם ${DECORATIVE_BORDER}`);
  }
}

/* ==================== מסגרת שלא נקבעה כלל ==================== */

/**
 * שתי הבדיקות הקודמות שואלות **איזו** מסגרת הפקד מקבל. הן אינן
 * שואלות אם הוא מקבל מסגרת בכלל.
 *
 * `className="mv-input"` הופיע על חמישה שדות — שני אזורי הטקסט
 * בעסקה המשותפת, שני שדות מחיקת הקרדיטים ושדה הימים בייבוא
 * ההקלטות — בלי שקיים לה כלל בגיליון. Preflight של Tailwind מאפס
 * `input`/`textarea` ל-`border: 0` ולרקע שקוף, ולכן הם הוצגו בלי
 * שדה סביבם; השער דיווח „הכול תקין”, כי אין שם טוקן דקורטיבי
 * להיתפס בו (ביקורת Codex).
 *
 * לכן פקד שנשען על מחלקת מערכת נבדק גם על מה שהמחלקה **מספקת**:
 * שהיא מוגדרת, ושהיא קובעת מסגרת. פקד שמסגרתו נקבעת על התגית
 * עצמה — `border-0` על גלולת הסטטוס, סגנון בשורה — מוחרג, כי שם
 * ההחלטה מפורשת וגלויה במקום שבו קוראים אותה.
 *
 * הבדיקה חלה על פקד שנושא מחלקת `mv-` דווקא: פקד בלי מחלקה כזו
 * מקבל את מסגרתו מסגנון בשורה או מעוטפת (`.mv-search-field`), ואלה
 * אינם ניתנים להכרעה מקריאת התגית לבדה. הכשל שנתפס כאן הוא הפער
 * בין מה שהמחלקה מבטיחה למה שהיא עושה.
 */
function scanClassDefinitions(hits) {
  for (const use of controlUses) {
    const undefinedNames = use.classes.filter((name) => classRules(name).length === 0);
    if (undefinedNames.length > 0) {
      hits.push(`${use.where} — <${use.tag}> נושא מחלקה שאינה מוגדרת: ${undefinedNames.join(", ")}`);
      continue;
    }
    if (use.explicit) continue;
    const anyBorder = use.classes.some((name) =>
      classRules(name).some((rule) => BORDER_DECL.test(rule[2])),
    );
    if (anyBorder) continue;
    hits.push(
      `${use.where} — <${use.tag}> אינו מקבל מסגרת מאף מקור (${use.classes.join(" ")})`,
    );
  }
}

/* ==================== הצבע שהמחלקה באמת נותנת ==================== */

/**
 * **הצבעים של הפקד נמדדים, ולא רק נבדק באיזה טוקן הם כתובים.**
 *
 * שלוש הבדיקות שקדמו שואלות אם הפקד נשען על הטוקן הנכון. אף אחת
 * מהן אינה שואלת כמה יוצא בסוף — ולכן ערך שנכתב כצבע קשיח, בלי
 * טוקן כלל, עבר בשקט. `.mv-search-input:focus` ו-`.mv-field:focus`
 * החליפו את גבול הפקד ב-`#2ecc66`, שהוא 2.11:1 מול השדה הלבן:
 * ברגע שהמשתמש נכנס לשדה, המסגרת התקינה מוחלפת בחיוורת ממנה
 * (ביקורת Codex).
 *
 * ## למה זה חוזר דווקא במצבים
 *
 * המצב — ריחוף, מיקוד, „נבחר” — הוא המקום שבו מעצב כותב צבע
 * מהעין ולא מהמערכת. שלושה מתוך חמשת הכשלים שנמצאו כאן היו
 * צבעים קשיחים בהירים שמעולם לא עברו דרך הערכה הכהה, ולכן היו
 * זהים בשלוש הערכות: כפתור ירקרק על לבן נראה סביר, ואותו כפתור
 * עצמו על מסך כהה הוא כתם בהיר עם טקסט בהיר עליו.
 *
 * ## מה נמדד
 *
 * לכל מחלקה של פקד — ולכל **מצב** שלה — נבנית שרשרת הכללים כפי
 * שהדפדפן מרכיב אותה: כלל הבסיס ואחריו כלל המצב, ומהם נלקחות
 * המסגרת, המשטח והטקסט. אחר כך:
 *
 * - **מסגרת מול המשטח שלה** — 3:1 (1.4.11).
 * - **טקסט מול המשטח שלו** — 4.5:1 (1.4.3).
 * - **מצב שאין לו מסגרת נפרדת** (המסגרת בצבע המשטח) נמדד אחרת:
 *   המשטח שלו מול משטח הבסיס. אם המצב מסומן במילוי בלבד, המילוי
 *   הוא כל ההבדל — וגלולת סינון „נבחרה” בצבע ‎#111513‎ עומדת על
 *   1.02:1 מול העמוד הכהה, כלומר אין דרך לדעת מה נבחר.
 *
 * ## מה לא נמדד כאן, ולמה
 *
 * שני הטוקנים הדקורטיביים — מסגרת הכרטיס ומפריד השורות. יש להם
 * מדיניות משלהם ובדיקה משלהם (`scanStylesheet`), והכפלתה כאן
 * הייתה מבטלת את הפטור שהקובץ הזה מנמק בפתיחתו.
 */
const DECORATIVE_TOKENS = ["var(--color-border)", "var(--color-row-border)"];
/*
 * ‎`[^)]*`‎ אינו יכול לחצות סוגריים מקוננים, ו-`color-mix(in srgb,
 * var(--x) 6%, var(--y))` נחתך אצלו בסוגר הראשון — כלומר הערך
 * שנקרא היה `color-mix(in srgb, var(--x)`, שאינו נפתר. רמה אחת של
 * קינון היא כל מה שיש כאן, ודי בה.
 */
const NESTED = "(?:[^()]|\\([^()]*\\))*";
const COLOR_VALUE = new RegExp(
  `(#[0-9a-fA-F]{6}(?![0-9a-fA-F])|#[0-9a-fA-F]{3}(?![0-9a-fA-F])|var\\(--[\\w-]+\\)|color-mix\\(${NESTED}\\)|rgba?\\(${NESTED}\\)|transparent|currentColor)`,
  "u",
);
const BORDER_PROP =
  /(?:^|[\s;])border(?:-(?:top|right|bottom|left|block|inline|start|end))?(?:-(?:start|end))?(?:-color)?\s*:\s*([^;]+)/gmu;
const BACKGROUND_PROP = /(?:^|[\s;])background(?:-color)?\s*:\s*([^;]+)/gmu;
const TEXT_PROP = /(?:^|[\s;])color\s*:\s*([^;]+)/gmu;

/** הערך האחרון שהצהרה כזו קובעת בגוף הכלל — האחרון גובר, כמו בקסקייד. */
function lastColor(body, property) {
  let found = null;
  for (const decl of body.matchAll(new RegExp(property.source, "gmu"))) {
    const color = COLOR_VALUE.exec(decl[1]);
    if (color !== null) found = color[1];
    else if (/^\s*(?:none|0)\b/u.test(decl[1])) found = "transparent";
  }
  return found;
}

/**
 * הערכות שבהן הבורר בכלל חל.
 *
 * הסדר כאן אינו קוסמטי: `:root:not([data-theme="light"])` — הבורר
 * של העדפת המערכת — **מכיל** את המחרוזת `[data-theme="light"]`,
 * ולכן בדיקת הבהיר לפני הכהה הייתה קוראת את הכלל הכהה כבהיר
 * ומחליפה בו את ערכי הערכה הבהירה.
 */
function themesFor(selector) {
  if (/\[data-a11y-contrast="on"\]/u.test(selector)) return ["contrast"];
  if (/:not\(\[data-theme="light"\]\)|\[data-theme="dark"\]/u.test(selector)) {
    return ["dark", "contrast"];
  }
  if (/\[data-theme="light"\]/u.test(selector)) return ["light"];
  return ["light", "dark", "contrast"];
}

/** בורר אחד בלי קידומת הערכה — `:root[data-theme="dark"] .mv-chip:hover` ⟵ `.mv-chip:hover`. */
function withoutThemePrefix(part) {
  return part.replace(/^:root(?:\[[^\]]*\]|:not\([^)]*\))*\s+/u, "").trim();
}

function controlRuleGroups() {
  // כאן הרשימה הרחבה: גם כפתור עירום בתוך עוטפת הוא פקד שנצבע
  const names = controlSelectorNames(CONTROL_TAGS);
  const groups = new Map();
  for (const rule of CSS_RULES) {
    const line = css.slice(0, rule.index).split("\n").length;
    for (const raw of rule[1].split(",")) {
      const part = raw.trim();
      if (part === "" || part.startsWith("@")) continue;
      const key = withoutThemePrefix(part);
      const mine = [...key.matchAll(/\.([\w-]+)(?![\w-])/gu)].map((m) => m[1]);
      if (!mine.some((name) => names.has(name))) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ body: rule[2], line, themes: themesFor(part) });
    }
  }
  return groups;
}

/**
 * ערך שהוצהר ואי אפשר לפתור אותו לצבע.
 *
 * זו אותה משפחה של הכשל שהתגלה ב-`#fff`: הבדיקה לא „טעתה
 * במספר”, היא **דילגה בשקט** — ופלט השער אמר „הכול נמדד”. ערך
 * ששקוף במכוון (`transparent`, `none`, `currentColor`) הוא החלטה
 * מפורשת ולכן מוחרג; כל השאר חייב להגיע לכאן ולהיאמר בקול.
 */
const TRANSPARENT_BY_DESIGN = ["transparent", "currentColor", "none"];

/**
 * המצע שהפקד יושב עליו.
 *
 * ברירת המחדל היא שלושת משטחי העמוד — פקד יכול לשבת על כל אחד
 * מהם, ולכן הוא נמדד מול שלושתם. אבל כשהבורר עצמו אומר מי ההורה
 * (`.mv-seg > button[aria-selected="true"] .mv-chip`), ההנחה הזו
 * פשוט **שגויה**: התג יושב על הלשונית הירוקה, לא על העמוד, ומדידה
 * מול העמוד מייצרת מספר שאיש לא יראה על המסך.
 */
function groundsFor(key, theme, groups) {
  const surfaces = SURFACES.map(([token]) => resolve(token, theme));
  const split = key.match(/^(.*[\s>+~])\s*[^\s>+~]+$/u);
  if (split === null) return surfaces;
  const ancestor = split[1].replace(/[\s>+~]+$/u, "").trim();
  let background = null;
  for (const rule of CSS_RULES) {
    for (const raw of rule[1].split(",")) {
      if (withoutThemePrefix(raw.trim()) !== ancestor) continue;
      if (!themesFor(raw.trim()).includes(theme)) continue;
      const value = lastColor(rule[2], BACKGROUND_PROP);
      if (value !== null) background = value;
    }
  }
  if (background === null || background === "transparent") return surfaces;
  const solved = surfaces.map((ground) => resolveValue(background, theme, ground));
  return solved.every((hex) => hex === null) ? surfaces : solved;
}

function scanControlColors(hits, unmeasured) {
  const groups = controlRuleGroups();
  let measured = 0;
  const note = (where, property, value) => {
    if (value === null || TRANSPARENT_BY_DESIGN.includes(value)) return;
    if (resolveValue(value, "light") !== null) return;
    const line = `${where} — ${property}: ${value}`;
    if (!unmeasured.includes(line)) unmeasured.push(line);
  };
  for (const key of groups.keys()) {
    const base = /^\.[\w-]+/u.exec(key)?.[0] ?? null;
    const chain = base !== null && base !== key ? [base, key] : [key];
    for (const theme of Object.keys(THEME_SELECTORS)) {
      const at = { border: null, background: null, text: null, line: null };
      for (const name of chain) {
        for (const rule of groups.get(name) ?? []) {
          if (!rule.themes.includes(theme)) continue;
          for (const [field, property] of [
            ["border", BORDER_PROP],
            ["background", BACKGROUND_PROP],
            ["text", TEXT_PROP],
          ]) {
            const value = lastColor(rule.body, property);
            if (value === null) continue;
            at[field] = value;
            if (name === key) at.line = rule.line;
          }
        }
      }
      if (at.line === null) continue;
      const where = `globals.css:${at.line} — ${key} (${THEME_LABEL[theme]})`;
      note(where, "border-color", at.border);
      note(where, "color", at.text);

      /*
       * המצעים שהפקד יכול לשבת עליהם. רקע אטום מורכב לאותו צבע
       * מעל שלושתם ולכן מתקפל לערך אחד; רקע שקוף־למחצה אינו
       * מתקפל, וזו בדיוק הסיבה שהשרשרת נדרשת.
       */
      const grounds = groundsFor(key, theme, groups);
      const surfacesOn = (value) => {
        if (value === null || value === "transparent") return grounds;
        return grounds.map((ground) => {
          if (ground === null) return null;
          const solved = resolveValue(value, theme, ground);
          if (solved === null) note(where, "background", value);
          return solved;
        });
      };
      const surfaces = surfacesOn(at.background);
      const label = at.background ?? "רקע העמוד";
      const decorative = at.border !== null && DECORATIVE_TOKENS.includes(at.border);
      const edge =
        at.border === null || at.border === "transparent" || at.border === "currentColor"
          ? null
          : resolveValue(at.border, theme);

      const said = new Set();
      const once = (line) => {
        if (said.has(line)) return;
        said.add(line);
        hits.push(line);
      };

      if (edge !== null && !decorative) {
        for (const color of surfaces) {
          if (color === null || color === edge) continue;
          measured += 1;
          const ratio = contrast(edge, color);
          if (ratio < 3) {
            once(`${where}: ${at.border} (${edge}) מול ${label} (${color}) = ${ratio.toFixed(2)}:1, נדרש 3:1`);
          }
        }
      }

      /*
       * מצב שהמסגרת שלו בצבע המשטח שלו — הצבע לא מסמן קצה אלא
       * מילוי, וההבדל שהמשתמש אמור לראות הוא מולו לפני הלחיצה.
       *
       * **רק מצב שנשאר.** ‎`[aria-pressed]`‎, ‎`[data-preferred]`‎ —
       * מצב שהמשתמש צריך לקרוא מהמסך כדי לדעת מה בחר. ריחוף,
       * מיקוד ולחיצה הם פסאודו-מחלקות והם חולפים: הם מלווים את
       * הסמן, הפקד כבר מזוהה, ודרישת 3:1 ביניהם הייתה מחייבת כל
       * ריחוף במערכת להיות קפיצת צבע. `:disabled` אף גרוע מכך —
       * ההנחתה שלו היא **המטרה**.
       */
      const persistentState = /\[(?:aria|data)-[\w-]+/u.test(key.slice(base?.length ?? 0));
      if (base !== key && persistentState && at.background !== null) {
        let baseBackground = null;
        let baseText = null;
        for (const rule of groups.get(base) ?? []) {
          if (!rule.themes.includes(theme)) continue;
          const fill = lastColor(rule.body, BACKGROUND_PROP);
          if (fill !== null) baseBackground = fill;
          const ink = lastColor(rule.body, TEXT_PROP);
          if (ink !== null) baseText = ink;
        }
        const before = surfacesOn(baseBackground);
        surfaces.forEach((surface, index) => {
          const previous = before[index];
          if (surface === null || previous === null || previous === surface) return;
          if (edge !== null && edge !== surface) return;
          /*
           * „מסומן במילוי בלבד” — והמילה **בלבד** צריכה להיבדק.
           * מצב שגם החליף את צבע הטקסט מסומן בשני ערוצים, ודי
           * באחד מהם שיהיה קריא. בלי התנאי הזה כל מתג מקוטע
           * במערכת נופל, כולל כאלה שברור לגמרי מה נבחר בהם.
           */
          const ink = at.text === null ? null : resolveValue(at.text, theme, surface);
          const wasInk = baseText === null ? null : resolveValue(baseText, theme, previous);
          const inkSpeaks = ink !== null && wasInk !== null && contrast(ink, wasInk) >= 3;
          /*
           * צללית היא גבול לכל דבר — כך מסומנת לשונית נבחרת
           * שמורמת מעל המסלול, וכך גם WCAG מכיר בה. מדידת הצללית
           * עצמה אינה בהישג ידו של שער סטטי; די בכך שהיא קיימת
           * כדי שהמצב לא יהיה „מילוי בלבד”.
           */
          const shadowSpeaks = (groups.get(key) ?? []).some(
            (rule) => rule.themes.includes(theme) && /box-shadow\s*:/u.test(rule.body),
          );
          if (inkSpeaks || shadowSpeaks) return;
          measured += 1;
          const ratio = contrast(surface, previous);
          if (ratio < 3) {
            once(
              `${where}: המצב מסומן במילוי בלבד — ${label} (${surface}) מול ${baseBackground ?? "רקע העמוד"} (${previous}) = ${ratio.toFixed(2)}:1, נדרש 3:1`,
            );
          }
        });
      }

      for (const surface of at.text === null ? [] : surfaces) {
        const ink = resolveValue(at.text, theme, surface);
        if (surface !== null && ink !== null && ink !== surface) {
          measured += 1;
          const ratio = contrast(ink, surface);
          if (ratio < 4.5) {
            once(
              `${where}: טקסט ${at.text} (${ink}) על ${label} (${surface}) = ${ratio.toFixed(2)}:1, נדרש 4.5:1`,
            );
          }
        }
      }
    }
  }
  return measured;
}

/**
 * הצבעים שנכתבו בשורה — נמדדים באותם ספים ובאותן שלוש ערכות.
 *
 * המשטח נלקח מהסגנון עצמו; ובהיעדרו, מהמחלקה שעל התגית, ובהיעדרה
 * משלושת משטחי העמוד. `transparent` ו-`inherit` אינם „ערך שלא
 * נפתר” אלא **החלטה מפורשת** של המחבר להישען על מה שמסביב, ולכן
 * הם נופלים למצע ולא לרשימת הבלתי־פתירים.
 *
 * כשגם הצבע וגם המשטח הם תנאי עם **אותו** תנאי, הענפים מזווגים
 * לפי סדר: `active ? A : B` מול `active ? C : D` הם הצמדים (A,C)
 * ו-(B,D) בלבד. זיווג צולב היה ממציא צירוף שלא קיים על המסך.
 */
function classBackground(classes, theme) {
  for (const name of classes) {
    for (const rule of classRules(name)) {
      const value = lastColor(rule[2], BACKGROUND_PROP);
      if (value !== null && value !== "transparent") {
        const solved = resolveValue(value, theme);
        if (solved !== null) return solved;
      }
    }
  }
  return null;
}

/**
 * הצמדים שבאמת מגיעים למסך — לפי **התנאי** ולא לפי מספר הענפים.
 *
 * הגרסה הקודמת זיווגה ענף מול ענף רק כששתי השרשראות זהות באורכן,
 * ואחרת ויתרה בשקט. זה בדיוק המקרה של גלולת המאפיין בטופס
 * הציבורי: לצבע שני ענפים ולמשטח שלושה, ולכן הצירוף שנשבר —
 * `level === "must"` עם `#fff` על הירוק — לא נבדק כלל (ביקורת
 * Codex). ויתור בשקט הוא הכשל שכל השער הזה נבנה נגדו.
 *
 * במקום זאת: אוסף התנאים משתי השרשראות, ולכל תנאי שיכול להיות
 * הראשון שמתקיים — ולמצב שבו אף אחד אינו מתקיים — נבחר הערך שכל
 * שרשרת הייתה מחזירה. כך נוצרים בדיוק המצבים שקיימים, בלי להמציא
 * ובלי לדלג.
 */
function reachablePairs(text, fill) {
  if (fill?.values == null) return text.values.map((ink) => [ink, null]);
  const guards = [];
  for (const condition of [...text.conditions, ...fill.conditions]) {
    if (condition !== null && !guards.includes(condition)) guards.push(condition);
  }
  const pick = (chain, active) => {
    for (const [index, condition] of chain.conditions.entries()) {
      if (condition === null || condition === active) return chain.values[index];
    }
    return chain.values[chain.values.length - 1];
  };
  const seen = new Set();
  const pairs = [];
  const add = (active) => {
    const pair = [pick(text, active), pick(fill, active)];
    const key = JSON.stringify(pair);
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push(pair);
  };
  for (const active of guards) add(active);
  /*
   * **„אף תנאי אינו מתקיים” נוסף תמיד.**
   *
   * ניסיתי לוותר עליו כשענף ה-`else` של שתי השרשראות כבר הופיע
   * תחת תנאי נקוב, בהנחה שהתנאים הם חלופות של אותו משתנה. ההנחה
   * שגויה ברגע שהתנאים **בלתי תלויים**: ב-`a ? A : B` מול
   * `b ? C : D` נוצרים (A,D) ו-(B,C), והמצב `!a && !b` — הצמד
   * (B,D) — הוא מצב אמיתי לכל דבר שנפל מהרשימה (ביקורת Codex).
   *
   * להוכיח מיצוי היה דורש את הטיפוס של המשתנה, ואין לו גישה
   * מכאן. לכן המצב נכלל תמיד: מוטב שהקוד יהיה קריא גם במצב
   * שכרגע אינו נוצר, מאשר ששער יסתמך על הנחה שאינו יכול לבדוק.
   */
  add(null);
  return pairs;
}

function scanInlineColors(hits, unmeasured) {
  let measured = 0;
  let runtime = 0;
  let unknown = 0;
  for (const use of inlineUses) {
    const inks = use.text.values;
    if (inks.every((value) => value === null)) {
      runtime += 1;
      continue;
    }
    const fills = use.fill?.values ?? [null];
    const pairs = reachablePairs(use.text, use.fill);
    for (const [ink, fill] of pairs) {
      if (ink === null || TRANSPARENT_BY_DESIGN.includes(ink) || ink === "inherit") continue;
      for (const theme of Object.keys(THEME_SELECTORS)) {
        /*
         * **רק משטח שידוע.** אלמנט בלי רקע משלו יושב על מה
         * שההורה שלו נותן, וההורה ב-JSX אינו נקרא מכאן. ניחוש
         * „רקע העמוד” היה מדווח על הנקודה שבלוגו — טקסט ירוק על
         * סרגל כהה — כאילו היא על לבן. גבול הבדיקה נספר ומוצג.
         */
        const declared = fill !== null && fill !== "transparent";
        const ground = declared
          ? resolveValue(fill, theme)
          : classBackground(use.classes, theme);
        if (ground === null) {
          /*
           * משטח שהוצהר ואינו נפתר הוא **ממצא**, לא „לא ידוע”:
           * הדפדפן לא יצייר אותו כלל. אלמנט שלא הצהיר משטח הוא
           * המקרה השני — שם באמת אין לשער דרך לדעת.
           */
          if (declared) {
            const line = `${use.where} — <${use.tag}> background: ${fill}`;
            if (!unmeasured.includes(line)) unmeasured.push(line);
          } else if (theme === "light") unknown += 1;
          continue;
        }
        const color = resolveValue(ink, theme, ground);
        if (color === null) {
          const line = `${use.where} — <${use.tag}> color: ${ink}`;
          if (!unmeasured.includes(line)) unmeasured.push(line);
          continue;
        }
        measured += 1;
        const ratio = contrast(color, ground);
        if (ratio < 4.5) {
          hits.push(
            `${use.where} — <${use.tag}> ${ink} (${color}) על ${fill ?? "מחלקת האלמנט"} (${ground}) = ${ratio.toFixed(2)}:1, נדרש 4.5:1 (${THEME_LABEL[theme]})`,
          );
        }
      }
    }
  }
  return { measured, runtime, unknown };
}

const misuse = [];
const unresolved = [];
const measuredControls = [];
const unmeasuredControls = [];
// סדר: הסריקה ב-JSX אוספת את שמות המחלקות ואת השימושים שהמשך מחפש
scanControls(join(here, "..", "src"), misuse);
scanStylesheet(misuse);
scanClassDefinitions(unresolved);
const controlPairs = scanControlColors(measuredControls, unmeasuredControls);
const inline = scanInlineColors(measuredControls, unmeasuredControls);

/* ==================== מצב ניגודיות גבוהה ==================== */

/**
 * **כל מה שהערכה הכהה קובעת — חייב להידרס גם כאן.**
 *
 * הבדיקה הקודמת רשמה שלושה שמות ביד, ולכן ענתה רק על השאלה
 * שבגללה נכתבה. השאלה הכללית היא אחרת: הבלוק הזה יושב גם **מעל
 * הערכה הכהה**, וכל טוקן שהוא אינו דורס נשאר בערך הכהה שלו — על
 * עמוד שהבלוק הזה בדיוק הפך ללבן.
 *
 * כך דלפו שמונה-עשר טוקנים, ושלושה מהם הפכו לבלתי קריאים ממש
 * (ביקורת Codex). המדידה תופסת אותם רק אם הם משתתפים בזוג נמדד;
 * הבדיקה המבנית תופסת את **כולם**, כולל אלה שאיש עוד לא חשב
 * למדוד.
 *
 * הרשימה נגזרת מהערכה הכהה ואינה מתוחזקת: מה שיתווסף שם ייכנס
 * לכאן מאליו — כולל הצהרה שאינה טוקן, כמו `color-scheme`.
 */
const CONTRAST_DECLS = themeDeclarations([':root[data-a11y-contrast="on"]']);
const DARK_DECLS = themeDeclarations([':root[data-theme="dark"]']);
const DARK_MEDIA_DECLS = themeDeclarations([':root:not([data-theme="light"])']);
/*
 * **איחוד שתי ההצהרות הכהות, ולא רק המפורשת.**
 *
 * הצהרה שנוספה רק ל-`prefers-color-scheme` לא נבדקה כאן כלל:
 * הרשימה נגזרה מהמפה המפורשת בלבד, ולכן גם השוואת שתי ההצהרות
 * וגם בדיקת הדליפה לניגודיות גבוהה פסחו עליה. משתמש שערכת
 * המערכת שלו כהה היה מקבל התנהגות שאיש אינו בודק (ביקורת Codex).
 */
const DARK_NAMES = [...new Set([...DARK_DECLS.keys(), ...DARK_MEDIA_DECLS.keys()])];
const missingInHighContrast = DARK_NAMES.filter((name) => !CONTRAST_DECLS.has(name));

/**
 * שתי ההצהרות הכהות חייבות להיות זהות.
 *
 * הערכה הכהה כתובה פעמיים — פעם ב-`prefers-color-scheme` ופעם
 * ב-`[data-theme="dark"]` — כי אלה שני מצבים שונים לגמרי: העדפת
 * המערכת, והבחירה המפורשת של המשתמש. המדידה נעשית על השנייה,
 * ולכן שינוי שנעשה רק באחת מהן היה עובר בשקט אצל **חצי**
 * המשתמשים (ביקורת Codex).
 */
const darkMismatch = DARK_NAMES.filter(
  (name) => DARK_MEDIA_DECLS.get(name) !== DARK_DECLS.get(name),
);

if (
  failures.length > 0 ||
  misuse.length > 0 ||
  unresolved.length > 0 ||
  measuredControls.length > 0 ||
  unmeasuredControls.length > 0 ||
  missingInHighContrast.length > 0 ||
  darkMismatch.length > 0
) {
  if (missingInHighContrast.length > 0) {
    console.error("\n✗ הצהרות שאינן נדרסות במצב ניגודיות גבוהה:\n");
    for (const name of missingInHighContrast) console.error(`  • ${name}`);
    console.error(
      "\nהבלוק הזה יושב גם מעל הערכה הכהה. מה שנשכח בו נשאר בערך הכהה" +
        " שלו על עמוד לבן — כלומר ההגדרה שנועדה לחזק קריאוּת פוגעת בה.",
    );
  }
  if (darkMismatch.length > 0) {
    console.error("\n✗ שתי ההצהרות של הערכה הכהה אינן זהות:\n");
    for (const name of darkMismatch) console.error(`  • ${name}`);
    console.error(
      "\n‎prefers-color-scheme‎ ו-‎[data-theme=\"dark\"]‎ הם שני מצבים נפרדים," +
        " ושינוי שנעשה רק באחד מהם מגיע רק לחלק מהמשתמשים.",
    );
  }
  if (failures.length > 0) {
    console.error("✗ ניגודיות מתחת לסף:\n");
    for (const line of failures) console.error(`  • ${line}`);
  }
  if (misuse.length > 0) {
    console.error("\n✗ פקדים שמקבלים את המסגרת הדקורטיבית במקום את גבול הפקד:\n");
    for (const line of misuse.slice(0, 20)) console.error(`  • ${line}`);
    if (misuse.length > 20) console.error(`  • ...ועוד ${misuse.length - 20}`);
    console.error(
      "\nהחליפו ל-var(--color-input-border). המסגרת הדקורטיבית עומדת על" +
        " 1.65:1 בלבד — היא נועדה לכרטיס, לא לשדה.",
    );
  }
  if (unresolved.length > 0) {
    console.error("\n✗ פקדים שהמחלקה שלהם אינה נותנת להם מסגרת:\n");
    for (const line of unresolved.slice(0, 20)) console.error(`  • ${line}`);
    if (unresolved.length > 20) console.error(`  • ...ועוד ${unresolved.length - 20}`);
    console.error(
      "\nהגדירו את המחלקה ב-globals.css עם border ב-var(--color-input-border)." +
        " בלי הגדרה, Preflight של Tailwind מותיר את השדה בלי מסגרת ובלי רקע —" +
        " כלומר בלי שדה נראה כלל.",
    );
  }
  if (measuredControls.length > 0) {
    console.error("\n✗ צבעים של פקדים שנמדדו מתחת לסף:\n");
    for (const line of measuredControls.slice(0, 20)) console.error(`  • ${line}`);
    if (measuredControls.length > 20) {
      console.error(`  • ...ועוד ${measuredControls.length - 20}`);
    }
    console.error(
      "\nצבע קשיח בכלל של מצב (ריחוף, מיקוד, „נבחר”) אינו עובר דרך הערכות" +
        " הצבע, ולכן הוא זהה בשלושתן. השתמשו בטוקן.",
    );
  }
  if (unmeasuredControls.length > 0) {
    console.error("\n✗ צבעים של פקדים שאי אפשר לפתור, ולכן לא נמדדו:\n");
    for (const line of unmeasuredControls.slice(0, 20)) console.error(`  • ${line}`);
    if (unmeasuredControls.length > 20) {
      console.error(`  • ...ועוד ${unmeasuredControls.length - 20}`);
    }
    console.error(
      "\nערך שהשער אינו יודע לפתור אינו „עובר” — הוא פשוט לא נבדק, והפלט" +
        " היה מצהיר „הכול נמדד”. כתבו אותו כטוקן, כ-‎#rgb‎/‎#rrggbb‎ או" +
        " כ-color-mix, או הצהירו transparent במפורש.",
    );
  }
  console.error(
    "\nהמסגרות והצבעים מוגדרים ב-apps/web/src/app/globals.css. סף 3:1 לגבול פקד" +
      " הוא WCAG 1.4.11; 4.5:1 לטקסט הוא 1.4.3.",
  );
  process.exit(1);
}

const notes = INFORMATIVE.map(([theme, fg, bg, label]) => {
  const a = resolve(fg, theme);
  const b = resolve(bg, theme);
  return a && b ? `${label} ${contrast(a, b).toFixed(2)}:1` : null;
}).filter(Boolean);

console.log(
  `✓ ${checked} זוגות צבע נמדדו בשלוש הערכות (בהיר · כהה · ניגודיות גבוהה) — כולם מעל הסף`,
);
console.log("✓ כל הפקדים משתמשים בגבול הפקד ולא במסגרת הדקורטיבית");
console.log(`✓ ${controlUses.length} פקדים עם מחלקת מערכת — לכולם מחלקה מוגדרת שקובעת מסגרת`);
console.log(
  `✓ ${controlPairs} צבעים של פקדים נמדדו בכל מצב ובכל ערכה — מסגרת, מילוי וטקסט`,
);
console.log(
  `✓ ${inline.measured} צבעים שנכתבו בסגנון בשורה נמדדו — כולל כל ענפי התנאי` +
    ` (${inline.runtime + inline.unknown} נקבעים בזמן ריצה או על משטח שאינו ידוע מכאן)`,
);
console.log(`  דקורטיבי (לידיעה בלבד): ${notes.join(" · ")}`);
