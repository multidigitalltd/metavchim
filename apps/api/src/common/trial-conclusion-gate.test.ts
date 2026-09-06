import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ‎**כל מי שמוחק את תאריך הניסיון רושם גם למה.**
 *
 * ## ‏למה שער ולא בדיקה
 *
 * ‏`trialEndsAt` ריק הוא דו-משמעי: „הניסיון נגמר” ו„הערך אופס
 * ‏זמנית”. משפך ההמרה מכריע **הפוך** בין השניים — הראשון סוגר את
 * ‏הרישום, השני מחייב להשאיר אותו פתוח — ולכן מוחק שאינו רושם את
 * ‏הסיבה יוצר רישום שנשאר פתוח לנצח וכל סבב סורק אותו מחדש.
 *
 * ‏מניתי את המוחקים פעמיים, ופעמיים פספסתי אחד. בפעם הראשונה את
 * ‏„פתח ללא תפוגה”, ובשנייה את הפעלת המנוי בקופון של 100% — ששם
 * ‏גם אין כרטיס, ולכן „הרישום ייסגר כ„שילם”” אינו נכון (ביקורת
 * ‏Codex, שתי פעמים). ספירה ידנית אינה מחזיקה; שער כן.
 *
 * ## ‏מה השער אינו יכול לראות
 *
 * ‏הוא קורא כתיבה מפורשת של `trialEndsAt: null`. השמה דרך משתנה —
 * ‏כמו ב-`billing-override`, שם `null` הוא **בכוונה** האיפוס הזמני
 * ‏שאין לרשום עליו סיבה — אינה נתפסת, וזה הנכון: שם היעדר הרישום
 * ‏הוא ההחלטה עצמה.
 */

const API_SRC = join(import.meta.dirname, "..");

function sourceFiles(dir: string): { name: string; code: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return sourceFiles(join(dir, entry.name));
    if (!entry.name.endsWith(".ts") || entry.name.includes(".test.")) return [];
    const full = join(dir, entry.name);
    return [{ name: full.slice(API_SRC.length + 1), code: readFileSync(full, "utf8") }];
  });
}


/**
 * ‎**כל כתיבה של תאריך הניסיון — בשתי הצורות שהקוד משתמש בהן.**
 *
 * ‏הגרסה הראשונה חיפשה `trialEndsAt: null` בלבד, ולכן כותב חדש
 * ‏שמשתמש בהשמה (`data.trialEndsAt = …`) היה עובר בשקט — וזו אינה
 * ‏צורה תאורטית: `billing-override` כתוב בדיוק כך (ביקורת Codex).
 * ‏הפטור שהיה משתמע מהצורה חל על כל קובץ; עכשיו הוא **רשימה
 * ‏מפורשת** של הנתיבים שאינם מסיימים ניסיון, כל אחד עם נימוק.
 */
const ALLOWED_WITHOUT_CONCLUSION: readonly {
  file: string;
  statement: string;
  why: string;
}[] = [
  {
    file: "modules/platform/platform.controller.ts",
    statement: "data.trialEndsAt = body.trialEndsAt ? new Date(body.trialEndsAt) : null;",
    why: "‏`billing-override`: איפוס התאריך לבדו הוא המצב הזמני שאין להסיק ממנו — היעדר הרישום כאן הוא ההחלטה",
  },
  {
    file: "modules/signup/signup.service.ts",
    statement: "trialEndsAt,",
    why: "‏הרשמה: משרד חדש, אין ניסיון קודם שאפשר לסיים — התאריך נכתב ולא נמחק",
  },
];

function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//gu, (block) => "\n".repeat((block.match(/\n/gu) ?? []).length))
    .replace(/(^|[^:])\/\/.*$/gmu, "$1");
}

/**
 * ‎**כתיבה לשורת הדייר — ולא כל אזכור של השדה.**
 *
 * ‏חיפוש טקסטואלי על השם לבדו סופר גם `select`, גם `where`, גם
 * ‏טיפוסים וגם DTO של תשובה — עשרים אזכורים שאינם כותבים דבר,
 * ‏ושער שמתריע עליהם מפסיק להיקרא. לכן הסריקה מוצאת קודם את
 * ‏**קריאת הכתיבה** (`tenant.update(` / `tenant.create(`), חותכת
 * ‏את הארגומנט שלה לפי סוגריים מאוזנים, ובודקת רק בתוכו.
 *
 * ‎**ובנוסף צורת ההשמה**, שהיא הבלתי-נראית משתיהן: `data.trialEndsAt = …`
 * ‏נבנה מחוץ לקריאה ומועבר אליה, ולכן אינו נמצא באזור שלה כלל.
 * ‏זו הצורה ש-`billing-override` משתמש בה, וזה בדיוק החור שהשער
 * ‏הקודם השאיר (ביקורת Codex).
 */
function balancedFrom(text: string, open: number): string {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return text.slice(open, index + 1);
    }
  }
  return text.slice(open);
}

function writeSites(): { file: string; line: number; statement: string; window: string }[] {
  const sites: { file: string; line: number; statement: string; window: string }[] = [];
  for (const file of sourceFiles(API_SRC)) {
    const code = codeOnly(file.code);
    const lineOf = (offset: number): number => code.slice(0, offset).split("\n").length;

    for (const match of code.matchAll(/\btenant\.(?:update|create)\s*\(/gu)) {
      const region = balancedFrom(code, (match.index ?? 0) + match[0].length - 1);
      /*
       * ‎`[,:]` ולא `:` בלבד: קיצור אובייקט (`trialEndsAt,`) הוא
       * ‏כתיבה לכל דבר, וזו הצורה שההרשמה משתמשת בה.
       */
      const written = region.match(/^[^\n]*\btrialEndsAt\s*[,:][^\n]*$/mu);
      if (written === null) continue;
      sites.push({
        file: file.name,
        line: lineOf(match.index ?? 0),
        statement: written[0].trim(),
        window: region,
      });
    }

    for (const match of code.matchAll(/^[^\n]*\.trialEndsAt\s*=[^\n]*$/gmu)) {
      const at = match.index ?? 0;
      const lines = code.split("\n");
      const index = lineOf(at) - 1;
      sites.push({
        file: file.name,
        line: index + 1,
        statement: (lines[index] ?? "").trim(),
        /*
         * ‎**חלון צמוד, ולא נדיב.** בצורת ההשמה הרישום נכתב בשורה
         * ‏שאחריה — וחלון רחב היה נתפס על `trialConcludedAt` של
         * ‏**כתיבה אחרת** באותו אזור. אימתתי: עם חלון של שמונה
         * ‏שורות, השתלת השמה חדשה ליד הקיימת עברה בשקט.
         */
        window: lines.slice(index, index + 3).join("\n"),
      });
    }
  }
  return sites;
}

describe("שער: מחיקת תאריך ניסיון רושמת את הסיבה", () => {
  const sites = writeSites();

  /*
   * ‏בלי זה השער ירוק על כלום: ביטוי שנשבר או תיקיה שזזה היו
   * ‏הופכים אותו לבדיקה שעוברת תמיד. שני הכותבים המוכרים רשומים
   * ‏בשמם — לא כרשימה שנייה לתחזק, אלא כדי שנפילת הסריקה תיראה.
   */
  it("יש מה לבדוק, ובשתי הצורות", () => {
    expect(sites.length).toBeGreaterThanOrEqual(4);
    const files = new Set(sites.map((site) => site.file));
    expect(files).toContain("modules/billing/billing.service.ts");
    expect(files).toContain("modules/platform/platform.controller.ts");
    // ‏ושצורת ההשמה אכן נתפסת, ולא רק צורת האובייקט
    expect(sites.some((site) => /\.trialEndsAt\s*=/u.test(site.window))).toBe(true);
  });

  it("כל כתיבה רושמת `trialConcludedAt` — או מופיעה ברשימת החריגים", () => {
    /*
     * ‎**החריג נקשר למשפט, לא לקובץ.**
     *
     * ‏פטור ברמת הקובץ היה מכסה גם כותב **חדש** באותו קובץ — כלומר
     * ‏בדיוק את הבאג הבא, בקובץ שכבר יש בו חריג לגיטימי אחד. אימתתי
     * ‏זאת: עם פטור לפי קובץ, השתלת השמה חדשה ב-`platform.controller`
     * ‏עברה בשקט.
     */
    const silent = sites.filter(
      (site) =>
        !site.window.includes("trialConcludedAt") &&
        !ALLOWED_WITHOUT_CONCLUSION.some(
          (entry) => entry.file === site.file && site.statement === entry.statement,
        ),
    );
    expect(
      silent.map((site) => `${site.file}:${site.line}`),
      "כתבו את תאריך הניסיון בלי לרשום אם הוא נגמר",
    ).toEqual([]);
  });

  /*
   * ‏החריגים הם היחידים שהשער אינו מאמת, ולכן הם היחידים שצריך
   * ‏לקרוא בעין. שמירתם מעטים ומנומקים היא מה שהופך את הקריאה הזו
   * ‏לאפשרית — ורשימה שמתארכת בשקט היא בדיוק הכישלון.
   */
  it("רשימת החריגים נשארת קצרה ומנומקת", () => {
    expect(ALLOWED_WITHOUT_CONCLUSION.length).toBeLessThanOrEqual(3);
    for (const entry of ALLOWED_WITHOUT_CONCLUSION) {
      expect(entry.why, `${entry.file}:${entry.statement} ללא נימוק`).not.toBe("");
      expect(entry.statement).not.toBe("");
      expect(entry.file).toMatch(/\.ts$/u);
    }
  });
});
