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
const css = readFileSync(join(here, "..", "src", "app", "globals.css"), "utf8");

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

/**
 * ערך טוקן כפי שהוא מוגדר בקובץ.
 *
 * ההגדרה הראשונה בלבד: הטוקנים הבהירים מוגדרים ב-`:root`, ומיפוי
 * הערכה הכהה מצביע עליהם דרך `var(--dk-*)` — כלומר הופעה שנייה של
 * אותו שם אינה ערך חדש אלא הפניה.
 */
function token(name) {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`, "u").exec(css);
  return match?.[1] ?? null;
}

/** [שם הטוקן, שם הרקע שמולו הוא נמדד, סף, תיאור] */
const REQUIRED = [
  /*
   * גבול הפקד נמדד מול **כל** רקע שהוא יכול לשבת עליו, ולא רק מול
   * השדה: יש פקדים ש-`background` שלהם הוא `--color-bg` (בורר הספק
   * בהגדרות המרכזייה) ואחרים שיושבים על משטח הכרטיס. מדידה מול
   * רקע אחד היא הצהרה על מסך שלם לפי מקרה אחד (ביקורת Codex).
   *
   * בערכה הבהירה שלושתם לבנים כרגע ולכן המספר זהה; בכהה הם שונים
   * זה מזה, ושם ההבדל אמיתי.
   */
  ["color-input-border", "color-field", 3, "גבול שדה קלט (בהיר)"],
  ["color-input-border", "color-bg", 3, "גבול פקד מול רקע העמוד (בהיר)"],
  ["color-input-border", "color-surface", 3, "גבול פקד מול הכרטיס (בהיר)"],
  ["dk-input-border", "dk-field", 3, "גבול שדה קלט (כהה)"],
  ["dk-input-border", "dk-bg", 3, "גבול פקד מול רקע העמוד (כהה)"],
  ["dk-input-border", "dk-surface", 3, "גבול פקד מול הכרטיס (כהה)"],
  ["color-text", "color-bg", 4.5, "טקסט ראשי (בהיר)"],
  ["dk-text", "dk-bg", 4.5, "טקסט ראשי (כהה)"],
  ["color-text-muted", "color-bg", 4.5, "טקסט משני (בהיר)"],
  ["dk-text-muted", "dk-bg", 4.5, "טקסט משני (כהה)"],
  ["color-text-soft", "color-bg", 4.5, "תוויות לשוניות (בהיר)"],
  ["color-danger", "color-bg", 4.5, "שגיאה (בהיר)"],
  ["color-primary", "color-bg", 4.5, "קישורים (בהיר)"],
  /*
   * הערכה הכהה של אותם שלושה. הן מוגדרות פעם אחת ב-`:root` ומוחלפות
   * במיפוי הכהה ל-`--dk-*`, ולכן בדיקת השם הסמנטי בלבד מדדה את
   * הערך הבהיר וטענה על „שתי הערכות” (ביקורת Codex). נסיגה בערך
   * הכהה הייתה עוברת את השער בשקט.
   */
  ["dk-text-soft", "dk-bg", 4.5, "תוויות לשוניות (כהה)"],
  ["dk-danger", "dk-bg", 4.5, "שגיאה (כהה)"],
  ["dk-primary", "dk-bg", 4.5, "קישורים (כהה)"],
];

/** נמדדים ומוצגים, אך אינם מכשילים — ראו „מה לא נבדק”. */
const INFORMATIVE = [
  ["color-border", "color-bg", "מסגרת כרטיס (בהיר)"],
  ["color-row-border", "color-bg", "מפריד שורות (בהיר)"],
  ["dk-border", "dk-surface", "מסגרת כרטיס (כהה)"],
];

const failures = [];
let checked = 0;

for (const [fg, bg, min, label] of REQUIRED) {
  const a = token(fg);
  const b = token(bg);
  if (!a || !b) {
    failures.push(`טוקן חסר: --${!a ? fg : bg}`);
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
const CONTROL_TAGS = ["input", "select", "textarea"];
const DECORATIVE_BORDER = "var(--color-border)";

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

/** המחלקות שמופיעות על פקד ב-JSX — לחצי השני של הבדיקה, ב-CSS. */
const controlClasses = new Set();

/** פקד אחד ב-JSX והמחלקות שהוא נושא — לבדיקה השלישית. */
const controlUses = [];

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
    for (const tag of CONTROL_TAGS) {
      const pattern = new RegExp(`<${tag}\\b`, "gu");
      let match;
      while ((match = pattern.exec(source)) !== null) {
        const body = openingTag(source, match.index);
        const line = source.slice(0, match.index).split("\n").length;
        /*
         * כל מחרוזת בתוך `className` — גם `"a b"` וגם ביטוי מותנה
         * שבתוכו מחרוזות. השמות האלה הם מה שהחלק שב-CSS מחפש.
         */
        const classes = [];
        for (const attr of body.matchAll(/className=(?:"([^"]*)"|\{([\s\S]*?)\})/gu)) {
          const text = attr[1] ?? attr[2] ?? "";
          for (const quoted of text.matchAll(/["'`]([^"'`]*)["'`]/gu)) {
            classes.push(...quoted[1].split(/\s+/u));
          }
          if (attr[1] !== undefined) classes.push(...attr[1].split(/\s+/u));
        }
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

function controlSelectorNames() {
  const names = new Set(controlClasses);
  for (const rule of CSS_RULES) {
    const selector = rule[1];
    // `.x input`, `.x > textarea`, `.x:focus-within select` — כולם עוטפים
    const wrapper = /\.([\w-]+)[^,{]*[\s>+~](?:input|select|textarea)\b/u.exec(selector);
    if (wrapper) names.add(wrapper[1]);
  }
  return names;
}

function scanStylesheet(hits) {
  const names = controlSelectorNames();
  for (const rule of CSS_RULES) {
    /*
     * הבורר הוא מה שאחרי ה-`}` הקודם, ולכן הוא גורר איתו את ההערה
     * שמעליו. חיתוך להערה האחרונה שנסגרה משאיר את הבורר עצמו —
     * שורה שאפשר לחפש בקובץ, ולא פסקה שלמה בפלט השגיאה.
     */
    const selector = rule[1].split("*/").pop().trim();
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

const misuse = [];
const unresolved = [];
// סדר: הסריקה ב-JSX אוספת את שמות המחלקות ואת השימושים שהמשך מחפש
scanControls(join(here, "..", "src"), misuse);
scanStylesheet(misuse);
scanClassDefinitions(unresolved);

/* ==================== מצב ניגודיות גבוהה ==================== */

/**
 * מה שההגדרה מחזקת — חייב לכלול גם את גבול הפקד.
 *
 * `[data-a11y-contrast="on"]` דורס טוקנים לשחור. כל עוד הפקדים
 * נשענו על המסגרת הדקורטיבית הם ירשו את השחור בחינם; ברגע שקיבלו
 * טוקן משלהם, שכחה של הטוקן החדש בבלוק הזה **מחלישה** אותם דווקא
 * במצב שנועד לחזק (ביקורת Codex). זו בדיקה מבנית ולא מספרית: אין
 * מה למדוד — יש רק לוודא שהטוקן נדרס יחד עם אחיו.
 */
const contrastBlock = /:root\[data-a11y-contrast="on"\]\s*\{([^}]*)\}/u.exec(css)?.[1] ?? "";
const HIGH_CONTRAST_REQUIRED = ["color-border", "color-input-border", "color-border-hover"];
const missingInHighContrast = HIGH_CONTRAST_REQUIRED.filter(
  (name) => !new RegExp(`--${name}:`, "u").test(contrastBlock),
);

if (
  failures.length > 0 ||
  misuse.length > 0 ||
  unresolved.length > 0 ||
  missingInHighContrast.length > 0
) {
  if (missingInHighContrast.length > 0) {
    console.error("\n✗ טוקנים שאינם נדרסים במצב ניגודיות גבוהה:\n");
    for (const name of missingInHighContrast) console.error(`  • --${name}`);
    console.error(
      "\nההגדרה נועדה לחזק גבולות. טוקן גבול שנשכח בבלוק" +
        " ‎:root[data-a11y-contrast=\"on\"]‎ נשאר בצבע הרגיל בזמן שכל השאר משחירים.",
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
  console.error(
    "\nהמסגרות והצבעים מוגדרים ב-apps/web/src/app/globals.css. סף 3:1 לגבול פקד" +
      " הוא WCAG 1.4.11; 4.5:1 לטקסט הוא 1.4.3.",
  );
  process.exit(1);
}

const notes = INFORMATIVE.map(([fg, bg, label]) => {
  const a = token(fg);
  const b = token(bg);
  return a && b ? `${label} ${contrast(a, b).toFixed(2)}:1` : null;
}).filter(Boolean);

console.log(`✓ ${checked} זוגות צבע נמדדו — כולם מעל הסף`);
console.log("✓ כל הפקדים משתמשים בגבול הפקד ולא במסגרת הדקורטיבית");
console.log(`✓ ${controlUses.length} פקדים עם מחלקת מערכת — לכולם מחלקה מוגדרת שקובעת מסגרת`);
console.log(`  דקורטיבי (לידיעה בלבד): ${notes.join(" · ")}`);
