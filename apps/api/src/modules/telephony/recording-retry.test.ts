import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * „לא נמצא” על הקלטה שקיימת — **מי מכריע, אנחנו או הספק.**
 *
 * ## מה קרה
 *
 * 015 השיבה `404 · Not found` על הקלטה שנמצאת בממשק שלה (דיווח
 * מהשטח). הנתיב שהיא עצמה שולחת פותח בשני מספרים —
 * ‎`54936/12048/2026/…` — והקוד לקח תמיד את הראשון כ-`recordgroup`.
 * ההנחה הזו לא נבדקה מעולם מול הספק, ומספר שגוי מייצר תשובה **זהה
 * לחלוטין** לתשובה על הקלטה שנמחקה: אין דרך להבחין ביניהן מבחוץ.
 *
 * ## למה מבנית
 *
 * הבקשה עצמה יוצאת לרשת, ומה שנשבר בקלות הוא **הסדר**: שהניסיון
 * השני בכלל קורה, ושהוא קורה רק על „לא נמצא”. שורות בודדות שאפשר
 * להזיז בלי שאף בדיקה תרגיש.
 */

const source = readFileSync(new URL("./recording-fetch.service.ts", import.meta.url), "utf8");

describe("מספר קבוצה שגוי אינו נראה כמו הקלטה שנמחקה", () => {
  it("שני המועמדים נשלחים, לפי הסדר שבנתיב", () => {
    expect(source).toContain("pbx015RecordingGroups(job.recordingPath)");
    expect(source).toContain("for (const [index, recordGroup] of candidates.entries())");
  });

  /*
   * ניסיון שני על „אישורים שגויים” או „החבילה אינה כוללת הקלטות”
   * אינו מוסיף מידע — הוא רק מכפיל פנייה ומאחר את הדיווח האמיתי.
   */
  it("והניסיון השני נעשה רק על „לא נמצא”", () => {
    const loop = source.slice(
      source.indexOf("for (const [index, recordGroup]"),
      source.indexOf("private async attemptFetch("),
    );
    expect(loop).toContain('attempt.code === "404"');
    expect(loop).toContain("index + 1 < candidates.length");
  });

  it("ונתיב עם מספר אחד אינו מנסה פעמיים", () => {
    expect(source).toContain("fromPath.length > 0 ? fromPath : [ids.recordGroup]");
  });

  /*
   * בעל הפלטפורמה אישר שהגזירה מהנתיב שגויה: בנתיב `54936/12048/…`
   * הקבוצה היא **השני**, ולכל משרד מספר אחר. לכן היא הגדרה של
   * המשרד ולא נגזרת — והנתיב נשאר נפילה לאחור בלבד.
   */
  it("וקבוצה שהוגדרה במפורש קודמת לניחוש מהנתיב", () => {
    expect(source).toContain('const configured = (config["recordGroup"] ?? "").trim()');
    expect(source).toContain(
      'configured === "" ? guesses : [configured, ...guesses.filter((g) => g !== configured)]',
    );
  });

  /*
   * הסירוב חוזר לקורא במקום להירשם במקום: הפונקציה שמבצעת את
   * הפנייה אינה יודעת אם נשאר מה לנסות, והרישום שם היה מסמן כישלון
   * סופי על ניסיון ראשון מתוך שניים.
   */
  it("הסירוב שבמעטפת מוחזר לקורא ואינו נרשם בתוך הפנייה", () => {
    const attempt = source.slice(source.indexOf("private async attemptFetch("));
    expect(attempt).toContain('return { kind: "refused", code: status.code, detail }');
    /*
     * מ-`parse015Status` ועד ההחזרה אין `note` — זה בדיוק המקום שבו
     * הגרסה הקודמת סימנה כישלון סופי על ניסיון ראשון מתוך שניים.
     * הסירוב ברמת HTTP שמעליו כן נרשם שם, והוא מקרה אחר: הוא אינו
     * מבדיל בין מספרי קבוצה.
     */
    const envelope = attempt.slice(
      attempt.indexOf("const status = parse015Status(payload)"),
      attempt.indexOf('return { kind: "refused"'),
    );
    expect(envelope).not.toContain("this.note(");
  });
});

/*
 * „לא נמצא” על הקלטה שקיימת בממשק הוא שאלה על **הבקשה**, לא על
 * ההקלטה — ובלי לדעת מה ביקשנו אין דרך להשוות מול הממשק.
 */
describe("הדיווח נושא את מה שנשלח", () => {
  it("מספרי הקבוצה והרשומה מופיעים בתיאור הכישלון", () => {
    expect(source).toContain("recordgroup=${candidates.join(\"|\")}");
    expect(source).toContain("recordid=${ids.recordId}");
  });

  /*
   * ‎`provider_recording_detail` הוא `VARCHAR(200)`, וחריגה ממנו
   * **זורקת** — ו-`note` בולעת את השגיאה כדי שרישום כישלון לא יפיל
   * את הסבב. בלי הגבול, תיאור ספק ארוך היה מוחק גם את הסיבה וגם את
   * הפירוט, והשיחה נשארת עם מצב ישן בדיוק כשיש מה לומר.
   */
  it("והפירוט נכתב בתוך גבול העמודה — מה שנחתך הוא תיאור הספק", () => {
    expect(source).toContain("const PROVIDER_DETAIL_MAX = 200");
    expect(source).toContain("joinDetail(lastRefusal.detail, asked)");
    const join = source.slice(source.indexOf("function joinDetail("));
    expect(join).toContain("PROVIDER_DETAIL_MAX - asked.length");
    // הגבול נאכף גם בכתיבה עצמה, לכל קורא ולא רק לזה
    expect(source).toContain("detail.slice(0, PROVIDER_DETAIL_MAX)");
  });

  /* האישורים לעולם לא — אותו כלל של כל מסלול המרכזייה */
  it("והאישורים אינם", () => {
    const start = source.indexOf("const asked =");
    const asked = source.slice(start, source.indexOf("\n", start));
    expect(asked).not.toContain("authPassword");
    expect(asked).not.toContain("authUsername");
  });
});
