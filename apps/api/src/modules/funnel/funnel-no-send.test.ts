import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ‎**שלב א׳ אינו שולח דבר — ושער, לא הבטחה.**
 *
 * ## ‏למה זה שווה בדיקה
 *
 * ‏המנוע הזה נוגע ב**כל** המשרדים במאגר. באג בו אינו מקלקל מסך
 * אחד — הוא מדוור לכל הקטלוג. ההגנה בשלב א׳ אינה „נזהרנו”, אלא
 * שאין במודול הזה בכלל דרך אל ערוץ יוצא: אין `EmailService`, אין
 * שליחת וואטסאפ, ואין `imports` במודול שיכולים להביא אותם.
 *
 * ‏הבדיקה בודקת את **הקוד**, לא את הכוונה. עריכה עתידית שתוסיף
 * שליחה לשלב הזה תיפול כאן, ומי שיוסיף אותה יידרש להזיז אותה
 * לשלב ב׳ — או למחוק את השער במפורש ולהסביר למה.
 *
 * ‏זו אותה תבנית של שער ההפרדה בנכסים לגיוס: מבנה שנאכף, לא
 * משמעת שנזכרים בה.
 */

const DIR = import.meta.dirname;

function sourceFiles(): { name: string; text: string }[] {
  return readdirSync(DIR)
    .filter((name) => name.endsWith(".ts"))
    .filter((name) => !name.endsWith(".test.ts"))
    .map((name) => ({ name, text: readFileSync(join(DIR, name), "utf8") }));
}

/**
 * ‏הקוד בלי ההערות.
 *
 * ‏בלי זה השער נפל על התיעוד של עצמו: ההסבר „אין כאן `EmailService`”
 * מכיל את המחרוזת שהוא אוסר. שער שאי אפשר להסביר בלי להפיל אותו
 * הוא שער שיימחק — ולכן הסריקה היא על מה שהקוד **עושה**.
 */
function codeOnly(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/.*$/gmu, "");
}

describe("מנוע המסלולים — שלב א׳ אינו שולח", () => {
  it("יש קבצים לבדוק (אחרת הבדיקה ירוקה על כלום)", () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThanOrEqual(3);
    expect(files.map((f) => f.name)).toContain("funnel-enrollment.service.ts");
  });

  /**
   * ‏השמות מכסים את שלוש הדרכים החוצה שקיימות במערכת: שירות הדואר,
   * שירות השליחה בוואטסאפ, ותור ה-outbox שמוביל לשתיהן.
   */
  it("אף קובץ במודול אינו נוגע בערוץ יוצא", () => {
    const forbidden = [
      /EmailService/u,
      /WhatsAppSendService/u,
      /sendTemplate\s*\(/u,
      /sendText\s*\(/u,
      /\.send\s*\(/u,
      /OutboxService/u,
      /PlatformAdminNotifier/u,
    ];
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const code = codeOnly(file.text);
      for (const pattern of forbidden) {
        if (pattern.test(code)) offenders.push(`${file.name} ← ${String(pattern)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * ‎`imports: []` הוא חלק מההבטחה ולא סגנון: מודול שמייבא את
   * ‏`MessagingModule` מקבל את השליחה בהזרקה, וכל שאר הבדיקה כאן
   * הופכת לעקיפה של שורה אחת.
   */
  it("המודול אינו מייבא מודול אחר", () => {
    const module = readFileSync(join(DIR, "funnel.module.ts"), "utf8");
    expect(module).not.toMatch(/imports\s*:/u);
  });

  /**
   * ‏הטבלאות של הדיירים נקראות דרך `withFunnelAdmin` בלבד. קריאה
   * ישירה מ-`this.prisma.funnelMessage` הייתה עוקפת את RLS — וזה
   * בדיוק מה ש-`rls-access` אוסר, אבל כאן זה נבדק גם בהקשר של
   * המודול עצמו, שבו הפיתוי הזה חוזר בכל שאילתה.
   */
  it("טבלאות הדיירים נקראות רק דרך withFunnelAdmin", () => {
    for (const file of sourceFiles()) {
      const code = codeOnly(file.text);
      expect(code).not.toMatch(/this\.prisma\.funnelEnrollment\b/u);
      expect(code).not.toMatch(/this\.prisma\.funnelMessage\b/u);
    }
  });

  /**
   * ‎**ההוצאה של „כבר רשום” יושבת בשאילתה, לא אחרי השליפה.**
   *
   * ‏זה נראה כמו העדפת סגנון והוא כלל נכונות: סינון אחרי `take`
   * ‏עוצר את הקליטה לגמרי ברגע שדף שלם מתמלא במי שכבר נרשם, ואז
   * ‏גם הרשמה טרייה שאמורה לעקוף כל מכסה אינה נכנסת לעולם. חזרה
   * ‏לסינון-אחרי-שליפה נראית תמימה בקוד ולכן היא נבדקת.
   */
  it("מי שכבר רשום מוצא מהשאילתה עצמה", () => {
    const code = codeOnly(readFileSync(join(DIR, "funnel-enrollment.service.ts"), "utf8"));
    expect(code).toMatch(/funnelEnrollments:\s*\{\s*none:/u);
  });

  /**
   * ‎**סריקת הרישומים החיים עוברת על כולם, ולא על הדף הראשון.**
   *
   * ‏בלי סמן, `take` הופך לתקרת עבודה: אותם רישומים ישנים נקראים
   * ‏בכל סבב, וכל עוד הם פתוחים אף רישום מאוחר אינו נבדק — משרד
   * ‏שהזין כרטיס לא נסגר לעולם.
   */
  it("סגירת הרישומים משתמשת בסמן", () => {
    const code = codeOnly(readFileSync(join(DIR, "funnel-enrollment.service.ts"), "utf8"));
    expect(code).toMatch(/cursor:\s*\{\s*id:\s*cursor\s*\}/u);
  });

  /**
   * ‎**`startedAt` הוא רגע הכניסה — לא `createdAt` של המשרד.**
   *
   * ‏זו ההחלטה של המשתמש בשורה אחת של קוד, והיא הדבר היחיד שמפריד
   * בין „כל משרד מיום 0 שלו” לבין „כניסה בנקודה” שנדחתה. עריכה
   * שתחליף אותה נראית תמימה לגמרי בקוד, ולכן היא נבדקת.
   */
  it("הכניסה למשפך מתחילה מהרגע, ולא מתאריך ההרשמה", () => {
    const text = readFileSync(join(DIR, "funnel-enrollment.service.ts"), "utf8");
    const openCall = /startedAt:\s*(\w+)/u.exec(text);
    expect(openCall?.[1]).toBe("now");
    expect(text).not.toMatch(/startedAt:\s*\w*\.?createdAt/u);
  });
});
