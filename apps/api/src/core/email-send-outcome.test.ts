import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { EmailAmbiguousError, EmailRejectedError, emailSendOutcome } from "./email.service";

/**
 * ‎**„ייתכן שההודעה יצאה” — נשאל פעם אחת, במקום אחד.**
 *
 * ‏שישה נתיבי שליחה ענו על השאלה הזו בעצמם, וכולם באותו ניסוח:
 * ‎`error instanceof EmailRejectedError ? "failed" : "unknown"`.
 * ‏הכוונה נכונה, אבל התשובה נשענה על **שלילה** — ולכן כל מה שאינו
 * ‏דחיית ספק נספר כ„ייתכן שיצא”, כולל באג אצלנו שקרה לפני שהבקשה
 * ‏בכלל נשלחה.
 */
describe("emailSendOutcome", () => {
  it("‏עמום — ורק עמום — הוא „לא ידוע”", () => {
    expect(emailSendOutcome(new EmailAmbiguousError("פסק זמן", "k"))).toBe("unknown");
  });

  it("‏דחיית ספק היא „נכשלה”", () => {
    expect(emailSendOutcome(new EmailRejectedError("כתובת פסולה"))).toBe("failed");
    expect(emailSendOutcome(new EmailRejectedError("חריגה מקצב", true))).toBe("failed");
  });

  /*
   * ‎**זו הבדיקה שהניסוח הקודם היה נכשל בה.**
   *
   * ‏באג אצלנו אינו `EmailRejectedError`, ולכן הכלל הישן רשם עליו
   * ‏„ייתכן שיצא”: הלקוח לא קיבל דבר, המסך אמר לסוכן שאולי כן,
   * ‏והסוכן לא שלח שוב. „לא `EmailRejectedError`” אינו ידיעה
   * ‏חיובית — גם באג נראה כך.
   */
  it("‏באג אצלנו הוא „נכשלה” — לא „לא ידוע”", () => {
    expect(emailSendOutcome(new TypeError("cannot read properties of null"))).toBe("failed");
    expect(emailSendOutcome(new Error("שליפת ההגדרות נכשלה"))).toBe("failed");
  });

  it("‏וגם מה שאינו שגיאה בכלל", () => {
    expect(emailSendOutcome("boom")).toBe("failed");
    expect(emailSendOutcome(null)).toBe("failed");
    expect(emailSendOutcome(undefined)).toBe("failed");
  });

  /*
   * ‏שתי המחלקות יורשות מ-`ServiceUnavailableException`, ולכן
   * ‏„עמום” אינו יכול להיקבע מהאב המשותף.
   */
  it("‏ההבחנה אינה נופלת על האב המשותף", () => {
    expect(emailSendOutcome(new EmailRejectedError("x"))).not.toBe(
      emailSendOutcome(new EmailAmbiguousError("y")),
    );
  });
});

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sources(path, out);
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

/**
 * ‎**השער מנסח את ההכרעה, לא את צורתה.**
 *
 * ‏הניסוח הראשון שכתבתי כאן חיפש את הזיווג „failed”/„unknown” בכל
 * ‏קוד ה-API, והוא **נכשל על שלושה דברים תקינים**: מסך ההתחברות
 * ‏מזווג את אותן שתי מילים בפרמטר הפניה שאין לו קשר לדואר, וההערה
 * ‏שמסבירה את הכלל מצטטת את הניסוח הישן. הניסוח השני ספר כל
 * ‏הופעה של `sendState:` — ותפס **קריאות**: `sendState: row.sendState`
 * ‏בבניית DTO, ואיבר בטיפוס. שער שמודד טקסט מודד צורה, לא הכרעה;
 * ‏זה הכשל שנתפס גם בשער השלוחות.
 *
 * ‏מה שנטען כאן הוא הדבר עצמו, בשלוש טענות: **ההכרעה אינה נופלת
 * ‏בשורת הכתיבה**, **ארבעת נתיבי השליחה עוברים דרך הפונקציה**,
 * ‏ו**מי עוד מסווג שגיאת שליחה בעצמו**. הערות מוסרות לפני הסריקה,
 * ‏כי הערה אינה הכרעה.
 */
describe("שער: הכלל מנוסח במקום אחד", () => {
  const ROOT = join(__dirname, "..");

  /** ‏קוד בלבד. „‎//” נחתך רק בתחילת שורה או אחרי רווח, כדי ש-`https://` יישרד. */
  function code(path: string): string {
    return readFileSync(path, "utf8")
      .replace(/\/\*[\s\S]*?\*\//gu, "")
      .replace(/(^|\s)\/\/.*$/gmu, "$1");
  }

  const FILES = sources(ROOT).map((path) => ({
    name: path.slice(ROOT.length + 1).replace(/\\/gu, "/"),
    src: code(path),
  }));

  const WRITES = /sendState:\s*([^,}\n]+)/gu;

  /** ‏האם הערך הזה הגיע מהפונקציה — בקריאה, או דרך משתנה שהוצב ממנה. */
  function fromHelper(value: string, src: string): boolean {
    if (/^emailSendOutcome\(\w+\)$/u.test(value)) return true;
    if (!/^\w+$/u.test(value)) return false;
    return new RegExp(String.raw`const ${value}\s*(:[^=]+)?=\s*emailSendOutcome\(`, "u").test(src);
  }

  /*
   * ‎**ההכרעה אינה נופלת בשורה שכותבת את התוצאה.**
   *
   * ‏זה הכלל עצמו: `sendState` מקבל **עובדה** — `"pending"` לפני
   * ‏השליחה, `"sent"` אחריה, או הערך שהפונקציה החזירה — ולעולם לא
   * ‏ביטוי מותנה. הניסוח שהיה בשישה נתיבים (`… ? "failed" : "unknown"`)
   * ‏הוא בדיוק ביטוי מותנה כזה, וכל חזרה עליו נופלת כאן.
   *
   * ‏העברת ערך קיים הלאה — `sendState: row.sendState` בבניית DTO —
   * ‏אינה הכרעה, ולכן עוברת.
   */
  it("‏מצב השליחה לעולם אינו מוכרע בשורה שכותבת אותו", () => {
    const offenders: string[] = [];
    for (const { name, src } of FILES) {
      for (const [, raw] of src.matchAll(WRITES)) {
        const value = raw.trim();
        if (value.replace(/\?\?/gu, "").includes("?")) offenders.push(`${name}: ${value}`);
      }
    }
    expect(offenders, "מצב שהוכרע בשורת הכתיבה").toEqual([]);
  });

  /*
   * ‎**והצד החיובי: מי כן מסווג, ודרך מי.**
   *
   * ‏ארבעת הנתיבים שכותבים שורת הודעה נכשלת עוברים כולם דרך
   * ‏הפונקציה. **מקור הערך נבדק, לא שמו:** משתנה בשם „מתאים”
   * ‏שהוצב ממקום אחר אינו עובר. נתיב חמישי חייב להופיע כאן.
   */
  it("‏ארבעת נתיבי השליחה מסווגים דרך הפונקציה", () => {
    const via = FILES.filter(({ src }) =>
      [...src.matchAll(WRITES)].some(([, raw]) => fromHelper(raw.trim(), src)),
    )
      .map(({ name }) => name)
      .sort();
    expect(via).toEqual([
      "modules/email-inbox/email-inbox.service.ts",
      "modules/property-pitch/property-pitch.service.ts",
      "modules/support/support-inbox.service.ts",
      "modules/support/support.service.ts",
    ]);
  });

  /*
   * ‎**ומי עוד מסווג שגיאת שליחה בעצמו.**
   *
   * ‏כל הכרעה עצמאית חייבת לעבור באחד משני הסוגים, ולכן זו הרשימה
   * ‏המלאה של מי שמכריע לבדו — מלבד הקובץ שמנסח את הכלל. שלושת
   * ‏הנותרים שואלים שאלות **אחרות**: `offer-email` שואל „האם לקבור
   * ‏את ההצעה לתמיד” וצריך גם את `retryable`; `signup-verification`
   * ‏שואל „האם להחזיר מכסה ולבטל את הקוד הקודם”; ו-`intake` כבר
   * ‏הכריע דרך הפונקציה, ומשתמש בסוג רק כדי לבחור **נוסח** לסוכן.
   *
   * ‏נתיב שליחה חדש שיכריע בעצמו יופיע כאן, וזו כל תכליתו של השער.
   *
   * ‎**נספרות הכרעות, לא קבצים.** הניסוח הראשון אסף שמות קבצים,
   * ‏ומוטציה ששתלה סיווג **נוסף** בקובץ שכבר ברשימה עברה בשקט:
   * ‏הרשימה לא השתנתה. אחד לכל קובץ הוא מה שנטען, ולכן הוא מה
   * ‏שנספר.
   */
  it("‏מי שמסווג שגיאת שליחה בעצמו — רשימה סגורה ומנומקת", () => {
    const deciders = Object.fromEntries(
      FILES.filter(({ name }) => name !== "core/email.service.ts")
        .map(({ name, src }) => [
          name,
          (src.match(/instanceof Email(Rejected|Ambiguous)Error/gu) ?? []).length,
        ])
        .filter(([, count]) => (count as number) > 0)
        .sort(),
    );
    expect(deciders).toEqual({
      "modules/intake/intake.service.ts": 1,
      "modules/offers/offer-email.service.ts": 1,
      "modules/signup/signup-verification.service.ts": 1,
    });
  });
});
