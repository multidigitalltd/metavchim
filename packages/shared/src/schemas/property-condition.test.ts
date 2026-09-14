import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentAction } from "../agent/actions.js";
import { parsePropertiesCsv } from "../logic/csv-import.js";
import { presentationDetailRows } from "../logic/network-card.js";
import {
  PROPERTY_CONDITION_LABELS,
  PROPERTY_CONDITIONS,
  PropertyFieldsSchema,
  propertyConditionLabel,
  type PropertyCondition,
} from "./property.js";

/**
 * ‎**מצב הנכס — קטלוג אחד, וכל הקוראים נגזרים ממנו.**
 *
 * ## ‏מה היה כאן לפני
 *
 * ‏השדה היה קיים בעמודה ובסכימה, והתוויות העבריות שלו נכתבו
 * ‏**שלוש פעמים בשלושה קבצים** — והן כבר נפרדו: קטלוג הסוכן אמר
 * ‏„חדש מקבלן”, כרטיס הרשת אמר אותו דבר ועוד `preserved: "שמור"`
 * ‏שאינו ערך בסכימה כלל, וייבוא ה-CSV החזיק את המיפוי ההפוך.
 *
 * ‏הבדיקות כאן הן מה שמונע את החזרה: כל קורא נבדק מול הקטלוג,
 * ‏ולא מול מחרוזת שנכתבה בו.
 */

describe("הקטלוג", () => {
  /*
   * ‎**חמישה ערכים, בסדר של סולם.** „משופץ מהיסוד” אינו ניסוח של
   * ‏„משופץ”: ההפרש ביניהם הוא מאות אלפי שקלים, וקונה ששאל
   * ‏„משופץ?” מתכוון לאחד משניהם ואינו יודע לאיזה.
   */
  it("חמשת המצבים, בסדר מהטוב לפחות טוב", () => {
    expect([...PROPERTY_CONDITIONS]).toEqual([
      "new",
      "renovated_full",
      "renovated",
      "good",
      "needs_renovation",
    ]);
  });

  it("ולכל אחד תווית עברית", () => {
    expect(PROPERTY_CONDITIONS.map((value) => PROPERTY_CONDITION_LABELS[value])).toEqual([
      "חדש",
      "משופץ מהיסוד",
      "משופץ",
      "שמור",
      "זקוק לשיפוץ",
    ]);
  });

  /* ‏הסכימה מקבלת בדיוק את אלה, ולא ערך שהומצא במסך */
  it("הסכימה מקבלת את הקטלוג ודוחה את השאר", () => {
    for (const value of PROPERTY_CONDITIONS) {
      expect(PropertyFieldsSchema.safeParse({ condition: value }).success, value).toBe(true);
    }
    for (const value of ["preserved", "renovatedFull", "חדש", ""]) {
      expect(PropertyFieldsSchema.safeParse({ condition: value }).success, value).toBe(false);
    }
  });
});

describe("הקוראים נגזרים ואינם כותבים שוב", () => {
  /*
   * ‎**קטלוג הסוכן.** עד עכשיו הוא החזיק רשימה משלו, ולכן אמר
   * ‏„חדש מקבלן” בזמן שהמסך לא היה קיים בכלל — ואילו נוסף ערך,
   * ‏הסוכן לא היה יודע עליו.
   */
  it("קטלוג הסוכן מציע בדיוק את ערכי הקטלוג", () => {
    const field = agentAction("create_property")?.fields.find((f) => f.key === "condition");
    expect(field, "השדה אינו בקטלוג הסוכן").toBeDefined();
    expect(field?.type).toBe("enum");
    if (field?.type !== "enum") throw new Error("unreachable");
    expect([...field.values]).toEqual([...PROPERTY_CONDITIONS]);
    for (const value of PROPERTY_CONDITIONS) {
      expect(field.valueLabels[value], value).toBe(PROPERTY_CONDITION_LABELS[value]);
    }
  });

  /*
   * ‎**כרטיס הרשת.** ערך ללא תווית היה מציג מפתח באנגלית למשרד
   * ‏אחר — וזה בדיוק מה שהיה קורה ל„משופץ מהיסוד” אילו הוספתי
   * ‏אותו לסכימה בלבד.
   */
  it.each(PROPERTY_CONDITIONS)("כרטיס הרשת מציג את %s בעברית", (condition) => {
    const rows = presentationDetailRows({ condition });
    const row = rows.find((r) => r.value === PROPERTY_CONDITION_LABELS[condition]);
    expect(row, `${condition} מוצג כמפתח ולא כתווית`).toBeDefined();
  });

  /*
   * ‎**וערך הרפאים נשאר קריא.** `preserved` לא היה בסכימה מעולם,
   * ‏כלומר אף כתיבה חדשה אינה יכולה לייצר אותו — אבל שורה ישנה
   * ‏שנושאת אותו הייתה מציגה „preserved” באנגלית אילו נמחקה
   * ‏התווית יחד עם איחוד המפות.
   */
  it("וערך ישן שאינו בסכימה עדיין מוצג בעברית", () => {
    const rows = presentationDetailRows({ condition: "preserved" });
    expect(rows.some((r) => r.value === "שמור")).toBe(true);
  });
});

/**
 * ‎**קורא אחד לתווית, כולל לערך הישן.**
 *
 * ‏המפה הקנונית לבדה הספיקה לטופס — אבל כרטיס הרשת ידע לקרוא
 * ‏‎`preserved` וכרטיס הנכס הפנימי לא, כלומר אותה שורה בדיוק הציגה
 * ‏„שמור” בצד אחד ושום דבר בצד השני. `propertyConditionLabel` היא
 * ‏התשובה היחידה, ושני הכרטיסים קוראים ממנה.
 */
describe("propertyConditionLabel", () => {
  it.each(PROPERTY_CONDITIONS)("מחזירה את התווית של %s", (condition) => {
    expect(propertyConditionLabel(condition)).toBe(PROPERTY_CONDITION_LABELS[condition]);
  });

  it("ואת התווית של הערך הישן", () => {
    expect(propertyConditionLabel("preserved")).toBe(PROPERTY_CONDITION_LABELS.good);
  });

  /* ‏חוסר הוא חוסר — ולא מחרוזת ריקה שתרנדר כשורה ריקה בכרטיס */
  it("וחוסר מחזיר undefined", () => {
    for (const value of [undefined, null, ""]) {
      expect(propertyConditionLabel(value)).toBeUndefined();
    }
  });

  /*
   * ‎**ולא מפתח מהפרוטוטייפ.** `condition` מגיע מהמסד כמחרוזת
   * ‏חופשית (אין `CHECK` על העמודה), ואינדוקס ישיר על
   * ‏`Record<string, string>` היה מחזיר פונקציה עבור „constructor” —
   * ‏כלומר קוד שמרונדר לכרטיס.
   */
  it("ומפתח מהפרוטוטייפ אינו תווית", () => {
    for (const key of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(propertyConditionLabel(key), key).toBeUndefined();
    }
  });

  it("וערך שאיש אינו מכיר מחזיר undefined ולא את עצמו", () => {
    expect(propertyConditionLabel("renovatedFull")).toBeUndefined();
  });
});

describe("ייבוא CSV", () => {
  /*
   * ‏התווית הקנונית של כל ערך מתקבלת אוטומטית,
   * ‏ולכן ערך חדש נקלט ביום שהוא נוסף ולא ביום שמישהו יזכור.
   */
  it.each(PROPERTY_CONDITIONS)("הייבוא מזהה את התווית של %s", (condition) => {
    const label = PROPERTY_CONDITION_LABELS[condition];
    const parsed = parsePropertiesCsv(`עיר,מצב\nחולון,${label}`);
    expect(parsed.rows[0]?.fields.condition, label).toBe(condition);
  });

  /*
   * ‏ומה שהמערכת עצמה הציגה בעבר עדיין נקלט: קובץ שיוצא ממנה
   * ‏אתמול חייב להיכנס אליה מחר.
   */
  it.each([
    ["חדש מקבלן", "new"],
    ["במצב טוב", "good"],
    ["דורש שיפוץ", "needs_renovation"],
    ["משופץ מן היסוד", "renovated_full"],
  ] as [string, PropertyCondition][])("והניסוח הישן %s עדיין נקלט", (text, expected) => {
    const parsed = parsePropertiesCsv(`עיר,מצב\nחולון,${text}`);
    expect(parsed.rows[0]?.fields.condition).toBe(expected);
  });
});

describe("אין מפת תוויות שנייה", () => {
  /*
   * ‎**השער שמונע את החזרה למה שהיה.**
   *
   * ‏עד האיחוד היו שלוש מפות: `actions.ts`, `network-card.ts`
   * ‏ו-`csv-import.ts`. הן לא נשברו ביום שנכתבו — הן נפרדו לאט,
   * ‏עד ש„חדש מקבלן” הופיע בסוכן, „שמור” הופיע בכרטיס הרשת על
   * ‏ערך שהסכימה אינה מקבלת, ולטופס לא היה מה להציג כי הוא לא
   * ‏היה קיים.
   *
   * ‎`needs_renovation` ו-`preserved` הם המפתחות שנבחרו לבדיקה כי
   * ‏הם ייחודיים לשדה הזה: `good` ו-`new` מופיעים בהקשרים אחרים,
   * ‏והם לא. מפתח כזה שמוצמד למחרוזת עברית הוא **הכרזת תווית**,
   * ‏וזה בדיוק מה שמותר במקום אחד בלבד — כולל לערך הישן, שהיה
   * ‏מוכרז בכרטיס הרשת וגרם לכך שהכרטיס הפנימי לא ידע לקרוא אותו.
   */
  const HEBREW_LABEL = /(?:needs_renovation|preserved)\s*:\s*["'`][֐-׿]/u;

  it("רק הקטלוג מצמיד ערך לתווית עברית", () => {
    const root = join(import.meta.dirname, "..", "..", "..", "..");
    const listed = execFileSync(
      "git",
      ["ls-files", "*.ts", "*.tsx"],
      { cwd: root, encoding: "utf8" },
    )
      .split("\n")
      .filter((file) => file !== "")
      /* ‏הקטלוג עצמו, והבדיקה הזו שמצטטת את התבנית */
      .filter(
        (file) =>
          !file.endsWith("packages/shared/src/schemas/property.ts") &&
          !file.endsWith("property-condition.test.ts"),
      );

    const offenders = listed.filter((file) =>
      HEBREW_LABEL.test(readFileSync(join(root, file), "utf8")),
    );
    expect(
      offenders,
      "מפת תוויות שנייה — התוויות מגיעות מ-PROPERTY_CONDITION_LABELS",
    ).toEqual([]);
  });

  /* ‏ושהשער באמת סורק קבצים, ולא רשימה ריקה */
  it("והשער סורק את המאגר בפועל", () => {
    const root = join(import.meta.dirname, "..", "..", "..", "..");
    const listed = execFileSync("git", ["ls-files", "*.ts", "*.tsx"], {
      cwd: root,
      encoding: "utf8",
    }).split("\n");
    expect(listed.length).toBeGreaterThan(200);
  });
});
