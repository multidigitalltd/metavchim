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
    expect(source).toContain("for (const [index, candidate] of candidates.entries())");
  });

  /*
   * **גם `uniqueid` הוא מועמד.**
   *
   * הקבוצה נבדקה מול הספק בשני ערכיה וקיבלה 404 בשניהם (דיווח
   * מהשטח: `recordgroup=12048|54936`), כלומר היא אינה החשוד. הצורה
   * שאנחנו שולחים — עם הנקודה — היא ההנחה הבאה, והדוגמה בתיעוד של
   * 015 היא ספרות בלבד.
   *
   * **הקבוצה בלולאה החיצונית והצורה בפנים** — כך שתי הצורות נבדקות
   * עם הקבוצה המוגדרת (הערך המהימן היחיד) לפני כל ניחוש מהנתיב.
   * הקינון ההפוך שם את הצורה המתוקנת מאחורי ניחוש הנתיב, וכל
   * תשובה שאינה 404 על הניחוש עצרה את הלולאה לפניה (ביקורת Codex).
   */
  it("וגם שתי צורות מזהה השיחה — הקבוצה בחוץ והצורה בפנים", () => {
    expect(source).toContain("pbx015UniqueIdForms(job.providerCallId)");
    expect(source).toContain(
      "groups.flatMap((recordGroup) =>\n      uniqueIds.map((uniqueId) => ({ uniqueId, recordGroup })),",
    );
  });

  /* הצורה שהוובהוק שלח נשארת ראשונה — היא מגיעה מהספק עצמו */
  it("והצורה שהתקבלה מהספק נבדקת ראשונה", () => {
    const forms = readFileSync(
      new URL("../../../../../packages/shared/src/logic/telephony.ts", import.meta.url),
      "utf8",
    );
    const fn = forms.slice(forms.indexOf("export function pbx015UniqueIdForms"));
    expect(fn.slice(0, 400)).toContain("return [uniqueId, digitsOnly]");
  });

  /*
   * ניסיון שני על „אישורים שגויים” או „החבילה אינה כוללת הקלטות”
   * אינו מוסיף מידע — הוא רק מכפיל פנייה ומאחר את הדיווח האמיתי.
   */
  it("והניסיון השני נעשה רק על „לא נמצא”", () => {
    const loop = source.slice(
      source.indexOf("for (const [index, candidate]"),
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
    expect(source).toContain("recordgroup=${groups.join(\"|\")}");
    expect(source).toContain("recordid=${ids.recordId}");
  });

  /*
   * ‎`uniqueid` מדווח ב**צורה ובאורך** ולא בערך: הוא מזהה שיחה
   * ספציפית, והדיווח הזה עובר בערוצים שאין סיבה שיישאו אותו. מה
   * שנחוץ לאבחון הוא אילו צורות נוסו — וזה בדיוק מה שנרשם.
   */
  it("וצורות מזהה השיחה מדווחות בלי הערך עצמו", () => {
    expect(source).toContain("uniqueid=${forms}");
    const detail = source.slice(source.indexOf("const forms = uniqueIds"));
    expect(detail.slice(0, 300)).toContain("form.length");
    expect(detail.slice(0, 300)).not.toContain("${form}");
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


/**
 * ‎`recordid` — **המזהה היחיד שמעולם לא נבדק מול הספק.**
 *
 * ## מה היה
 *
 * הלולאה מנסה מטריצה של `recordgroup` × `uniqueid`, שתי צורות לכל
 * אחד — ארבעה צירופים. ‎`recordid` נשלח בכל ארבעתם כערך **קבוע
 * יחיד**, והוא היחיד מבין השלושה שאנחנו מחלצים ממחרוזת: „הספרות
 * אחרי הקו התחתון האחרון” בשם הקובץ.
 *
 * כל עוד החילוץ שגוי, שום צירוף של השניים האחרים לא יעזור — וזה
 * בדיוק מה שנראה בשטח: „לא נמצא” בכל ניסיון.
 *
 * ## מה נבדק כאן
 *
 * לא שהתיקון „עובד” — הבקשה יוצאת לרשת. מה שנבדק הוא **הסדר
 * והמקור**, כלומר בדיוק מה שאפשר להזיז בשורה אחת בלי שאיש ירגיש:
 * שהשאלה לספק קורית רק אחרי כישלון, שהיא קורית לפני הוויתור,
 * ושהמזהה שנשלח בניסיון האחרון בא מהתשובה של הספק ולא מהחילוץ.
 */
describe("recordid נשאל מהספק במקום להיות מנוחש", () => {
  it("הרשימה נקראת רק אחרי „לא נמצא”, ולא בכל משיכה", () => {
    expect(source).toContain('if (lastRefusal !== null && lastRefusal.code === "404") {');
    /* הקריאה יושבת בתוך אותו תנאי ולא לפניו */
    const guard = source.indexOf('if (lastRefusal !== null && lastRefusal.code === "404") {');
    const call = source.indexOf("this.recordIdFromProvider(job, {");
    expect(guard).toBeGreaterThan(0);
    expect(call).toBeGreaterThan(guard);
  });

  it("והיא נקראת לפני שנרשמת סיבת הכישלון", () => {
    const call = source.indexOf("this.recordIdFromProvider(job, {");
    const giveUp = source.indexOf("`${RECORDING_ERRORS.provider}_${lastRefusal.code}`");
    expect(call).toBeGreaterThan(0);
    expect(giveUp).toBeGreaterThan(call);
  });

  it("הניסיון האחרון נושא את המזהה של הספק ולא את זה שחילצנו", () => {
    const after = source.slice(source.indexOf("if (authoritative !== null) {"));
    const attempt = after.slice(0, after.indexOf("if (attempt.kind === \"audio\")"));
    expect(attempt).toContain("recordId: authoritative.recordId");
    expect(attempt).not.toContain("recordId: ids.recordId");
  });

  it("חלון הזמן נגזר ממועד השיחה, ולא מרגע המשיכה", () => {
    const fn = source.slice(source.indexOf("private async recordIdFromProvider"));
    expect(fn.slice(0, 1200)).toContain("job.occurredAt.getTime()");
  });

  /*
   * „הספק החזיר N הקלטות ואף אחת אינה השיחה” ו„הספק מכיר אותה בלי
   * מזהה הורדה” הם שני אבחונים שונים לחלוטין, ומבחוץ הם נראים זהים
   * אם לא מבדילים ביניהם בכתב.
   */
  /*
   * ‎`parse015RecordingsList` שומר בכוונה את הקבוצה שהשורה נושאת.
   * להחזיר במקומה את משתנה הלולאה זה לזרוק בדיוק את המידע שהלכנו
   * לחפש, והניסיון החוזר היה חוזר לניחוש שכבר נכשל.
   */
  it("הקבוצה שמוחזרת היא של הספק ולא זו שביקשנו", () => {
    const fn = source.slice(source.indexOf("private async recordIdFromProvider"));
    expect(fn).toContain("recordGroup: match.recordGroup,");
  });

  /*
   * **האבחון הוא כל התכלית, ולכן הוא נרשם לפני הניסיון.**
   *
   * אם ההשוואה נכתבת רק במסלול המוצלח, אז דווקא כשהמשיכה ממשיכה
   * להיכשל — המקרה שבו התשובה הכי נחוצה — לא נדע אם המזהה של
   * הספק זהה לשלנו או שונה ממנו.
   */
  it("ההשוואה בין המזהים נרשמת עוד לפני הניסיון החוזר", () => {
    const after = source.slice(source.indexOf("if (authoritative !== null) {"));
    const log = after.indexOf("הספק מסר recordid=");
    const retry = after.indexOf("const attempt = await this.attemptFetch");
    expect(log).toBeGreaterThan(-1);
    expect(retry).toBeGreaterThan(log);
  });

  it("ושורת הכישלון מתארת גם את המזהה שהגיע מהספק", () => {
    expect(source).toContain("ואז מהספק: recordgroup=");
    expect(source).toContain("attemptedAuthoritative");
  });

  it("שני מצבי הכישלון של הרשימה נבדלים ביומן", () => {
    expect(source).toContain("ואף אחת אינה השיחה הזו");
    expect(source).toContain("אך שורתה בלי מזהה הורדה");
  });
});
