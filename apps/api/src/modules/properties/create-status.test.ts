import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CreatePropertySchema } from "./properties.controller";

/**
 * ‎**מה שהמסך שולח — השרת חייב לקבל.**
 *
 * ## התקלה שהבדיקה הזו נולדה ממנה
 *
 * ‏טופס „נכס חדש” התחיל לשלוח `status: "active"` (בקשת בעל המוצר:
 * נכס שנקלט מהמשרד נולד פעיל ולא כטיוטה). ‏`CreatePropertySchema`
 * הוא `.strict()`, ו-`status` היה מוצהר **בסכימת העדכון בלבד** —
 * ולכן כל שמירה מהטופס נדחתה ב-400 לפני שהשירות בכלל רץ. לא שדה
 * שנבלע: **מסלול קליטת הנכס נחסם לגמרי.**
 *
 * ## למה אף בדיקה קיימת לא תפסה
 *
 * ‏`typecheck` מרוצה — הגוף נבנה ב-`apiPost` שמקבל `unknown`.
 * ‏`verify:shapes` משווה את **טיפוס ההחזרה** של הבקר למה שהמסך
 * קורא, ולא את הגוף שהוא שולח. וה-`.strict()` עצמו, שנוסף בכוונה
 * כדי ששדה לא ייבלע בשקט, הוא מה שהפך את זה משדה שנעלם למסלול
 * שנחסם. השילוב הזה — סכימה קפדנית שאיש אינו מריץ עליה את הגוף
 * האמיתי — הוא החור.
 *
 * ## ולכן הבדיקה מריצה את הסכימה על הגוף עצמו
 *
 * ‏ולא על טקסט הקובץ. שדה שיתווסף לטופס וייחסם יפיל אותה מיד.
 */

const FORM = readFileSync(
  new URL("../../../../web/src/app/properties/new/page.tsx", import.meta.url),
  "utf8",
);

/**
 * ‎**כל המפתחות שהטופס יכול לשלוח** — נחלצים מהקוד שלו, לא מועתקים.
 *
 * ‏זה התיקון לביקורת Codex (P2) על הגרסה הראשונה של הקובץ הזה:
 * ‏`FROM_THE_FORM` למטה הוא עותק ידני של חלק מהגוף, ולכן הוא מוכיח
 * שדבר אחד מתקבל — ולא שהגוף **כולו** מתקבל. שדה שיתווסף לטופס
 * מחר, או שדה קיים ש-`.strict()` יפסיק לקבל, היו חוסמים שוב את
 * הקליטה בזמן שהבדיקה ירוקה. בדיוק אותו כשל שהיא נכתבה בשבילו.
 *
 * החילוץ הוא של **המפתחות**, לא של הערכים: `.strict()` נופל על שם
 * מפתח שאינו מוצהר, וזו הבדיקה שצריכה לרוץ על הרשימה המלאה. הערכים
 * עצמם נבדקים בגוף לדוגמה שמתחת.
 *
 * ‏מפתחות שבתוך ה-spread המותנה (`ownerName`, `ownerPhone`) נאספים
 * גם הם — הם נשלחים בפועל כשהשדות מולאו, וזו בדיוק הצורה שבה שדה
 * „לא חובה” מתגלה כחסום רק אצל מי שמילא אותו.
 */
function keysTheFormSends(): string[] {
  const at = FORM.indexOf('apiPost<{ id: string }>("/properties", {');
  if (at === -1) return [];
  const start = FORM.indexOf("{", FORM.indexOf('"/properties"'));
  let depth = 0;
  let end = start;
  for (; end < FORM.length; end += 1) {
    if (FORM[end] === "{") depth += 1;
    else if (FORM[end] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  const body = FORM.slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^[ \t]*\/\/.*$/gmu, "");
  return [...new Set([...body.matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:/gmu)].map((m) => m[1]!))];
}

/** גוף לדוגמה — לבדיקת **ערכים**; המפתחות נבדקים מהחילוץ שלמעלה. */
const FROM_THE_FORM = {
  status: "active",
  city: "בני ברק",
  neighborhood: "פרדס כץ",
  street: "רבי עקיבא",
  houseNumber: "12",
  propertyType: "apartment",
  dealType: "sale",
  rooms: 4,
  areaSqm: 95,
  floor: 3,
  totalFloors: 6,
  priceAgorot: 230000000,
} as const;

describe("יצירת נכס — הגוף שהטופס שולח", () => {
  /*
   * ‎**הבדיקה המרכזית.** `.strict()` דוחה בקשה בגלל **שם** מפתח
   * שאינו מוצהר, ולכן ההשוואה היא בין רשימת המפתחות שהטופס בונה
   * לבין הצורה של הסכימה. שדה שיתווסף לטופס ולא לסכימה — ייפול
   * כאן, ולא אצל המתווך.
   */
  it("כל מפתח שהטופס שולח מוצהר בסכימת היצירה", () => {
    const sent = keysTheFormSends();
    /* ‎**אפס מפתחות אינו „הכול תקין”** — זו הסריקה שנשברה */
    expect(sent.length, "לא נמצא גוף הבקשה בטופס — הסריקה אינה קוראת").toBeGreaterThan(15);
    const declared = new Set(Object.keys(CreatePropertySchema.shape));
    const missing = sent.filter((key) => !declared.has(key));
    expect(
      missing,
      `‎.strict() יחסום את הקליטה: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("‎`status: \"active\"` מתקבל, ולא נחסם על ידי `.strict()`", () => {
    const parsed = CreatePropertySchema.safeParse(FROM_THE_FORM);
    expect(
      parsed.success,
      parsed.success ? "" : JSON.stringify(parsed.error.issues),
    ).toBe(true);
  });

  /*
   * ‏חסר ⇒ טיוטה, וזו עדיין ברירת המחדל של כל מי שנוצר מבחוץ:
   * טופס הקליטה הציבורי של מוכר, והסוכן הקולי. שינוי שיהפוך את
   * ברירת המחדל של השרת עצמו יפיל את הבדיקה הזו.
   */
  it("בלי `status` הבקשה תקינה, והשרת נשאר על טיוטה", () => {
    const { status: _status, ...withoutStatus } = FROM_THE_FORM;
    expect(CreatePropertySchema.safeParse(withoutStatus).success).toBe(true);
    const service = readFileSync(
      new URL("./properties.service.ts", import.meta.url),
      "utf8",
    );
    expect(service).toContain('status: input.status ?? "draft",');
  });

  /*
   * ‎**רק שני מצבי פתיחה.** „נמכר”, „הושכר” ו„הוקפא” הם תוצאות של
   * מהלך, ו„בארכיון” ביצירה הוא נכס שנולד מוסתר. כולם עוברים דרך
   * העדכון, ששם יש להם רישום ביומן.
   */
  it("סטטוס שאינו נקודת פתיחה נדחה", () => {
    for (const status of ["sold", "rented", "frozen", "archived"]) {
      const parsed = CreatePropertySchema.safeParse({ ...FROM_THE_FORM, status });
      expect(parsed.success, `${status} התקבל ביצירה`).toBe(false);
    }
  });

  /*
   * ‏השדה קיים בטופס בפועל — בלי זה הבדיקה שומרת על חוזה שאיש אינו
   * משתמש בו, ועוברת גם אחרי שהטופס הפסיק לשלוח אותו.
   */
  it("הטופס באמת שולח את השדה", () => {
    const form = readFileSync(
      new URL("../../../../web/src/app/properties/new/page.tsx", import.meta.url),
      "utf8",
    );
    expect(form).toContain('status: "active",');
  });
});
