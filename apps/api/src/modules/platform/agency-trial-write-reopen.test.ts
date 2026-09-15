import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ‎**כל כתיבה שנוגעת ב„ניסיון חי” שואלת על הפתיחה מחדש.**
 *
 * ‏„ניסיון חי” הוא `status` **וגם** `trialEndsAt`, ומסך הפלטפורמה
 * ‏מגיע אליו בשני מסכים נפרדים: מסך העקיפה כותב תאריך, ומסך
 * ‏המשרדים כותב סטטוס. כל עוד רק אחד מהם קרא למשפך, אפשר היה
 * ‏להרכיב ניסיון חי בשני צעדים ולהשאיר לצידו רישום סגור — מצב
 * ‏**קבוע**, ש-`reopenLapsed` אינו סורק ו-`enrollDue` אינו מקבל
 * ‏(ביקורת Codex, P2).
 *
 * ‏זו בדיקה מבנית ולא בדיקת התנהגות, כי מה שנשבר כאן הוא **חיווט**
 * ‏ולא כלל: `reopenRows` נבדק מול מסד במקום אחר, והשאלה היחידה
 * ‏שנשארה היא האם הוא נקרא. מוטציה שמוחקת את הקריאה אינה נראית
 * ‏לשום בדיקה אחרת.
 *
 * ‏והיא מנוסחת כתכונה ולא כביטוי שנעוץ: היא מוצאת בעצמה כל כתיבת
 * ‏דייר בקובץ, ושואלת רק על אלה שנוגעות בשני השדות. כתיבה שלישית
 * ‏שתתווסף מחר תיבדק בלי לגעת כאן, וכתיבה שאינה נוגעת בהם —
 * ‏מסלול, מודולים חסומים, תכונות — אינה נדרשת לדבר.
 */

const SOURCE = readFileSync(join(__dirname, "platform.controller.ts"), "utf8");

/** ‏השדות ש„ניסיון חי” מורכב מהם. */
const TRIAL_FIELDS = ["status", "trialEndsAt"];

/** ‏חותך מ-`from` עד הסוגר שסוגר את הסוגר הראשון שנפתח אחריו. */
function block(source: string, from: number, open: string, close: string): string {
  const start = source.indexOf(open, from);
  if (start === -1) return "";
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === open) depth += 1;
    else if (source[i] === close) {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return "";
}

/**
 * ‎**האם אפשר להוכיח שהכתיבה אינה נוגעת ב„ניסיון חי”.**
 *
 * ‏ברירת המחדל היא „לא”: ‎`data` שהוא משתנה שנבנה למעלה אינו ניתן
 * ‏לקריאה מכאן, ולכן הוא נדרש לחיווט בדיוק כמו כתיבה שכותבת את
 * ‏השדות במפורש. רק אובייקט שכתוב בגוף הקריאה, ואין בו אף אחד
 * ‏מהשדות, פטור — וזו בדיוק הכתיבה שאפשר להסתכל עליה ולדעת.
 */
function provablyUnrelated(call: string): boolean {
  const at = call.indexOf("data:");
  if (at === -1) return false;
  const inline = block(call, at, "{", "}");
  if (inline === "") return false;
  return !TRIAL_FIELDS.some((field) => inline.includes(`${field}:`));
}

/** ‏כל כתיבת דייר בקובץ, עם גוף הקריאה שלה. */
function tenantWrites(): { at: number; call: string }[] {
  const found: { at: number; call: string }[] = [];
  const pattern = /tenant\.(?:update|updateMany|upsert)\(/gu;
  for (const match of SOURCE.matchAll(pattern)) {
    found.push({ at: match.index, call: block(SOURCE, match.index, "{", "}") });
  }
  return found;
}

describe("‏כתיבת „ניסיון חי” במסך הפלטפורמה", () => {
  const writes = tenantWrites();
  const guarded = writes.filter((write) => !provablyUnrelated(write.call));

  it("יש בקובץ כתיבות דייר לבדוק", () => {
    expect(writes.length).toBeGreaterThanOrEqual(4);
    expect(
      writes.every((write) => write.call.length > 0),
      "לא נחתך גוש",
    ).toBe(true);
  });

  /*
   * ‏שני פיקוחים. בלי הראשון הבדיקה הייתה ירוקה גם אילו הסיווג היה
   * ‏„הכול פטור”; בלי השני — גם אילו היה „הכול נדרש”, ואז היא לא
   * ‏הייתה מבחינה בין כתיבה שנוגעת בשדות לכתיבה שאינה נוגעת.
   */
  it("יש כתיבות שנדרשות לחיווט ויש כאלה שאינן", () => {
    expect(guarded.length, "אף כתיבה אינה נדרשת").toBeGreaterThanOrEqual(2);
    expect(guarded.length, "כל כתיבה נדרשת").toBeLessThan(writes.length);
  });

  it("כל כתיבה שאי אפשר להוכיח שאינה נוגעת בהם — קוראת ל-reopenWithin באותה טרנזקציה", () => {
    for (const write of guarded) {
      /*
       * ‏הטרנזקציה שעוטפת: הפתיחה מחדש חייבת לרוץ על אותה שורה
       * ‏שנכתבה ובאותה התחייבות, אחרת תקלה ביניהן משאירה בדיוק את
       * ‏המצב הקבוע שהממצא תיאר.
       */
      const opened = SOURCE.lastIndexOf("$transaction(", write.at);
      const where = `שורה ${SOURCE.slice(0, write.at).split("\n").length}`;
      expect(opened, `${where}: כתיבה מחוץ לטרנזקציה`).toBeGreaterThan(-1);
      const scope = block(SOURCE, opened, "{", "}");
      expect(scope.includes(write.call), `${where}: הטרנזקציה שנמצאה אינה העוטפת`).toBe(true);
      expect(scope.includes("reopenWithin("), `${where}: בלי reopenWithin באותה טרנזקציה`).toBe(
        true,
      );
    }
  });
});
