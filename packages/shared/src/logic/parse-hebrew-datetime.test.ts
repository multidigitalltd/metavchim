import { describe, expect, it } from "vitest";
import { parseAppointmentKind, parseHebrewDateTime } from "./parse-hebrew-datetime.js";

/*
 * הבדיקות קוראות את התוצאה **בשעון ירושלים** ולא בשעון התהליך.
 *
 * קודם הן קראו ‎`.getHours()`‎ ישירות, ולכן הן עברו רק במקרה: הן רצו
 * במכונה ששעונה מקומי, בעוד ה-API רץ ב-UTC. כלומר הן אישרו את הבאג
 * שבגללו כל פגישה שנקבעה בקול נשמרה שלוש שעות מאוחר מדי — "בשעה 5"
 * הוצג למתווך כ-08:00.
 *
 * ‎NOW‎ מוגדר כרגע מוחלט (UTC) ולא בבנאי המקומי, מאותה סיבה בדיוק.
 */
const IL = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jerusalem",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function il(date: Date | undefined): { day: number; month: number; hour: number; minute: number } {
  if (!date) throw new Error("לא זוהה תאריך");
  const parts = IL.formatToParts(date);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { day: get("day"), month: get("month"), hour: get("hour"), minute: get("minute") };
}

// יום ראשון, 1 בפברואר 2026, 09:00 בירושלים (חורף = UTC+2)
const NOW = new Date("2026-02-01T07:00:00.000Z");

describe("parseHebrewDateTime", () => {
  it("'מחר בעשר' — יום אחד קדימה בשעה 10:00", () => {
    const result = parseHebrewDateTime("קבע פגישה מחר בעשר", NOW);
    expect(il(result.date)).toMatchObject({ day: 2, hour: 10 });
    expect(result.timeExplicit).toBe(true);
  });

  it("'מחרתיים' — יומיים קדימה", () => {
    expect(il(parseHebrewDateTime("סיור מחרתיים", NOW).date).day).toBe(3);
  });

  it("שעה בפורמט מספרי נשמרת כלשונה", () => {
    expect(il(parseHebrewDateTime("מחר ב-16:30", NOW).date)).toMatchObject({
      hour: 16,
      minute: 30,
    });
  });

  it("'ב-4' מתפרש כאחר הצהריים", () => {
    expect(il(parseHebrewDateTime("מחר בשעה 4", NOW).date).hour).toBe(16);
  });

  it("'ב-9 בבוקר' נשאר בבוקר", () => {
    expect(il(parseHebrewDateTime("מחר בשעה 9 בבוקר", NOW).date).hour).toBe(9);
  });

  it("יום בשבוע — הקרוב שעוד לא עבר", () => {
    // NOW הוא יום ראשון; "יום שלישי" ⇒ עוד יומיים
    expect(il(parseHebrewDateTime("קבע פגישה ביום שלישי", NOW).date).day).toBe(3);
  });

  it("יום בשבוע שהוא היום — נדחה לשבוע הבא", () => {
    expect(il(parseHebrewDateTime("ביום ראשון", NOW).date).day).toBe(8);
  });

  it("'בעוד שעתיים' — יחסית לעכשיו", () => {
    const result = parseHebrewDateTime("קבע פגישה בעוד שעתיים", NOW);
    expect(il(result.date).hour).toBe(11);
    expect(result.timeExplicit).toBe(true);
  });

  /*
   * מהשטח, עם צילום: המתווך ענה לסוכן „תזכיר לי להתקשר אליו **עוד
   * שעה**” — בדיוק המשפט שהסוכן עצמו הציע — ו„עוד שעה” הופיע במסך
   * תחת „נאמר ולא שויך לשדה”. הצורה הקודמת דרשה את המילה `בעוד`
   * בדיוק, כלומר ביטוי הזמן הבסיסי בעברית נפל בגלל אות אחת.
   */
  it("'עוד שעה' — בלי בי\"ת — הוא מועד ולא טקסט חופשי", () => {
    const result = parseHebrewDateTime("תזכיר לי להתקשר אליו עוד שעה", NOW);
    expect(il(result.date).hour).toBe(10);
    expect(result.timeExplicit).toBe(true);
    expect(result.evidence).toBe("עוד שעה");
  });

  it("וגם דקות, ימים ושבועות — לא רק שעות", () => {
    expect(il(parseHebrewDateTime("תזכיר לי עוד עשרים דקות", NOW).date).minute).toBe(20);
    expect(il(parseHebrewDateTime("תזכיר לי בעוד רבע שעה", NOW).date).minute).toBe(15);
    expect(il(parseHebrewDateTime("תזכיר לי עוד חצי שעה", NOW).date).minute).toBe(30);
    expect(il(parseHebrewDateTime("תזכיר לי עוד יומיים", NOW).date).day).toBe(3);
    expect(il(parseHebrewDateTime("תזכיר לי עוד שבוע", NOW).date).day).toBe(8);
  });

  /*
   * תמלול ותשובה בוואטסאפ מסתיימים בפיסוק כדבר שבשגרה. ‎`\S+` בולע
   * את הנקודה, והתבניות העוגנות דוחות את „שעה.” — כלומר הצורה
   * הבסיסית ביותר נופלת שוב, והפעם גם בנסיגה מהקוד הישן.
   */
  it("ופיסוק שנדבק למילה אינו מבטל את הזיהוי", () => {
    expect(il(parseHebrewDateTime("תזכיר לי עוד שעה.", NOW).date).hour).toBe(10);
    expect(il(parseHebrewDateTime("חזור אליו בעוד שעתיים,", NOW).date).hour).toBe(11);
    expect(il(parseHebrewDateTime("תזכיר לי עוד עשרים דקות!", NOW).date).minute).toBe(20);
  });

  /*
   * „עוד פעם” אינו זמן, וחיפוש יחיד נעצר עליו — בזמן ש„בעוד שעה”
   * יושב מיד אחריו. חזרה ותיקון עצמי הם דיבור רגיל לגמרי.
   */
  it("ו'עוד' שאינו זמן אינו מסתיר 'עוד' שכן", () => {
    expect(il(parseHebrewDateTime("תתקשר עוד פעם בעוד שעה", NOW).date).hour).toBe(10);
    expect(il(parseHebrewDateTime("תשלח לו עוד הודעה, ותזכיר לי עוד יומיים", NOW).date).day).toBe(3);
  });

  /* „מעודכן” ו„עודף” אינם „עוד” — ההתאמה היא בגבול מילה */
  it("ו'עוד' בתוך מילה אחרת אינו נחשב", () => {
    expect(parseHebrewDateTime("תעדכן אותי כשהמצב מעודכן", NOW).date).toBeUndefined();
  });

  /*
   * „עוד שעות” אינו „עוד שעה”. רק היחיד והזוגי נושאים כמות מוגדרת;
   * רבים בלי מספר הוא ניסוח מעורפל, ומועד מדויק שנגזר ממנו גרוע
   * משדה ריק.
   */
  it("ורבים בלי מספר אינו מועד", () => {
    expect(parseHebrewDateTime("תזכיר לי עוד שעות", NOW).date).toBeUndefined();
    expect(parseHebrewDateTime("נדבר בעוד ימים", NOW).date).toBeUndefined();
    // אבל עם מספר — כן
    expect(il(parseHebrewDateTime("תזכיר לי בעוד שלוש שעות", NOW).date).hour).toBe(12);
  });

  /* „תזכיר לי,עוד שעה” ומרכאות — פיסוק שלפני הביטוי אינו גבול חוקי פחות */
  it("ופיסוק שלפני הביטוי אינו מבטל אותו", () => {
    expect(il(parseHebrewDateTime("תזכיר לי,עוד שעה", NOW).date).hour).toBe(10);
    expect(il(parseHebrewDateTime('אמרתי "בעוד שעתיים"', NOW).date).hour).toBe(11);
  });

  it("ו'תוך' עובד כמו 'עוד'", () => {
    expect(il(parseHebrewDateTime("תחזור אליו תוך שעתיים", NOW).date).hour).toBe(11);
  });

  /*
   * „עוד 900 שעות” הוא כמעט תמיד תמלול שגוי, ותאריך שנקבע ממנו
   * נראה על המסך כמו החלטה. שדה ריק לפחות נראה כמו משהו למלא.
   */
  it("והיסט לא סביר נדחה ולא הופך לתאריך", () => {
    expect(parseHebrewDateTime("תזכיר לי עוד 900 שעות", NOW).date).toBeUndefined();
    expect(parseHebrewDateTime("תזכיר לי עוד קצת", NOW).date).toBeUndefined();
  });

  /*
   * ‎„בעוד 2” — מספר עירום, בלי יחידה. הצורה הישנה קראה אותו
   * כשעות, והדרישה החדשה ליחידה מפורשת הפילה אותו בשקט (ביקורת
   * Codex). זו נסיגה בצורה שאנשים באמת כותבים.
   *
   * רק ספרות: „בעוד שלוש” במילה מתחלף עם השעון („בשלוש”), ואין
   * דרך להכריע — ולכן הוא נשאר מחוץ לתחום ולא מנוחש.
   */
  it("מספר עירום אחרי מילת הפתיחה נקרא כשעות, כמו קודם", () => {
    expect(il(parseHebrewDateTime("תחזור אליו בעוד 2", NOW).date).hour).toBe(11);
    expect(parseHebrewDateTime("תחזור אליו בעוד 900", NOW).date).toBeUndefined();
    expect(parseHebrewDateTime("תחזור אליו בעוד שלוש", NOW).date).toBeUndefined();
  });

  /*
   * ‎„שעה וחצי” — השבר נגרר אחרי היחידה, והענף שקיבל „שעה” בלע
   * אותו. עד שהצורה בלי בי"ת נתמכה המשפט לא ייצר תאריך כלל, כלומר
   * שדה ריק וגלוי; ההתעלמות הפכה אותו למועד סביר-למראה ומוקדם
   * בחצי שעה (ביקורת Codex). מוקדם מדי הוא הכשל שאיש אינו מבחין
   * בו עד שהשיחה קורית בזמן הלא נכון.
   *
   * החצי הוא **חצי יחידה** ולא חצי מהצורה: „שעתיים וחצי” הן 2.5
   * שעות, לא שלוש.
   */
  it("השבר שנגרר אחרי היחידה נספר, ולא נבלע", () => {
    expect(il(parseHebrewDateTime("תזכיר לי עוד שעה וחצי", NOW).date).minute).toBe(30);
    expect(il(parseHebrewDateTime("תזכיר לי עוד שעה וחצי", NOW).date).hour).toBe(10);
    expect(il(parseHebrewDateTime("תחזור אליו בעוד שעתיים וחצי", NOW).date).hour).toBe(11);
    expect(il(parseHebrewDateTime("תחזור אליו בעוד שעתיים וחצי", NOW).date).minute).toBe(30);
    expect(il(parseHebrewDateTime("תזכיר לי עוד שעה ורבע", NOW).date).minute).toBe(15);
  });

  /*
   * ואותו שבר גם **אחרי כמות** — „שלוש שעות וחצי”. התיקון הראשון
   * כיסה רק את היחידה שעומדת לבדה, כי חלון המילים היה שתיים; אחרי
   * כמות השבר הוא המילה השלישית ולכן הוא נשאר נבלע (ביקורת Codex).
   */
  it("וגם כשהשבר בא אחרי כמות", () => {
    const at = parseHebrewDateTime("תחזור אליו בעוד שלוש שעות וחצי", NOW);
    expect(il(at.date).hour).toBe(12);
    expect(il(at.date).minute).toBe(30);
    expect(il(parseHebrewDateTime("תזכיר לי בעוד 2 וחצי", NOW).date).hour).toBe(11);
    expect(il(parseHebrewDateTime("תזכיר לי בעוד 2 וחצי", NOW).date).minute).toBe(30);
  });

  /*
   * ‎„בעוד 0” אינו מועד. הענף של המספר העירום בדק רק את הגבול
   * העליון, ולכן אפס עבר והפך להיסט של אפס — תזכורת שמצלצלת מיד
   * (ביקורת Codex). שני הגבולות נבדקים עכשיו באותו מקום, לכל
   * הצורות, וזו הסיבה שהבדיקה מרוכזת ולא משוכפלת בכל ענף.
   */
  it("ואפס אינו היסט, בשום צורה", () => {
    expect(parseHebrewDateTime("תזכיר לי בעוד 0", NOW).date).toBeUndefined();
    expect(parseHebrewDateTime("תזכיר לי בעוד 0 שעות", NOW).date).toBeUndefined();
    expect(parseHebrewDateTime("תזכיר לי בעוד 0 דקות", NOW).date).toBeUndefined();
  });

  /*
   * ‎„-2” אינו „2”. הניקוי הסיר את הסימן כאילו היה פיסוק, הכמות
   * הגיעה חיובית, ונקבעה תזכורת שעתיים קדימה ממשפט שאומר את ההפך
   * (ביקורת Codex).
   */
  it("וסימן מינוס אינו פיסוק", () => {
    expect(parseHebrewDateTime("תזכיר לי בעוד -2 שעות", NOW).date).toBeUndefined();
    expect(parseHebrewDateTime("תזכיר לי בעוד -2", NOW).date).toBeUndefined();
  });

  /*
   * הסימן נבדק צמוד לספרה ולא בתחילת האסימון, ובכל צורותיו:
   * „‎(-2)‎” עטוף בסוגריים, ו„‎−2‎” משתמש בסימן המינוס הטיפוגרפי.
   * שניהם נוקו לכדי „2” חיובי (ביקורת Codex).
   */
  it("וגם כשהוא עטוף או טיפוגרפי", () => {
    expect(parseHebrewDateTime("תזכיר לי בעוד (-2) שעות", NOW).date).toBeUndefined();
    expect(parseHebrewDateTime("תזכיר לי בעוד −2 שעות", NOW).date).toBeUndefined();
  });

  /*
   * תיקון אל ביטוי פסול מבטל את מה שתוקן. „עוד שעה, לא, בעוד 900
   * שעות” — הדובר חזר בו מהשעה, וענף הדחייה יצא מהלולאה לפני
   * בדיקת התיקון, ולכן נקבעה תזכורת למה שבוטל במפורש (ביקורת
   * Codex). שדה ריק הוא התשובה הנכונה: עדיף שהמתווך יראה שאין
   * מועד מאשר שיקבל את זה שהוא ביטל.
   */
  it("תיקון אל ביטוי פסול מבטל את מה שתוקן", () => {
    expect(parseHebrewDateTime("תזכיר לי עוד שעה, לא, בעוד 900 שעות", NOW).date).toBeUndefined();
    expect(parseHebrewDateTime("תזכיר לי עוד שעה, לא, בעוד 0 שעות", NOW).date).toBeUndefined();
  });

  /* ותיקון נוסף אחרי הפסול עדיין נתפס — הביטול אינו סוף הסריקה */
  it("ותיקון תקין שאחרי הפסול עדיין מנצח", () => {
    const at = parseHebrewDateTime("עוד שעה, לא, בעוד 900 שעות, לא, בעוד שעתיים", NOW);
    expect(il(at.date).hour).toBe(11);
  });

  /*
   * אבל **רק תיקון** מחייה את הבחירה. „אין בחירה עדיין” ו„הבחירה
   * בוטלה” הם שני מצבים שונים, ו-null לבדו אינו מבחין ביניהם: אחרי
   * הביטול, ביטוי תקין שאינו תיקון נבלע כאילו היה הראשון, והתזכורת
   * נקבעה למועד של משפט אחר לגמרי (ביקורת Codex).
   */
  it("ומקום פנוי אינו הזמנה לביטוי הבא במשפט", () => {
    const at = parseHebrewDateTime(
      "תזכיר לי עוד שעה, לא, בעוד 900 שעות, והמסמך צריך להגיע בעוד יומיים",
      NOW,
    );
    expect(at.date).toBeUndefined();
  });

  /*
   * וי"ו החיבור נבלעת: „ובעוד שעה” הוא „בעוד שעה” עם חיבור למשפט
   * שלפניו. המבט לאחור ראה בה אות ופסל את הביטוי (ביקורת Codex).
   *
   * שאר התחיליות אינן נבלעות, וזה נבדק: „ש” משעבדת פסוקית ומשנה
   * את מה שנאמר.
   */
  it("וי\"ו החיבור נבלעת, ושאר התחיליות לא", () => {
    expect(il(parseHebrewDateTime("תזכיר לי ובעוד שעה להתקשר", NOW).date).hour).toBe(10);
    expect(il(parseHebrewDateTime("ועוד שעתיים תחזור אליו", NOW).date).hour).toBe(11);
    expect(parseHebrewDateTime("המערכת מעודכנת", NOW).date).toBeUndefined();
  });

  /* וביטוי שנדחה אינו עוצר את הסריקה — ביטוי תקין אחריו עדיין נמצא */
  it("היסט שנדחה אינו מסתיר היסט תקין שאחריו", () => {
    expect(il(parseHebrewDateTime("עוד 900 שעות, לא, בעוד שעה", NOW).date).hour).toBe(10);
  });

  /*
   * תיקון עצמי — „עוד שעה, לא, בעוד שעתיים”. עצירה על הראשון
   * הייתה נסיגה: הביטוי הישן דרש `בעוד`, דילג על הצורה בלי בי"ת
   * והגיע דווקא לתיקון (ביקורת Codex).
   *
   * „האחרון תמיד” אינו התשובה, ולכן הוא נבדק כאן משני הכיוונים:
   * בלי מילת תיקון הראשון מנצח, כי לביטוי השני יש נושא משלו.
   */
  it("מילת תיקון מעבירה את המועד לביטוי שאחריה", () => {
    expect(il(parseHebrewDateTime("תזכיר לי עוד שעה, לא, בעוד שעתיים", NOW).date).hour).toBe(11);
    expect(il(parseHebrewDateTime("עוד שעה, בעצם בעוד שלוש שעות", NOW).date).hour).toBe(12);
  });

  it("ובלי מילת תיקון — הראשון, כי השני שייך למשפט אחר", () => {
    const at = parseHebrewDateTime(
      "תזכיר לי בעוד שעה לשלוח את המסמך שצריך להגיע בעוד יומיים",
      NOW,
    );
    expect(il(at.date).hour).toBe(10);
    expect(il(at.date).day).toBe(1);
  });

  /*
   * וכשמילת יום גוברת על הכול — **כל** ביטויי הזמן מוסתרים מהשעון,
   * לא רק הנבחר. אחרת „שלוש” שבביטוי שלא נבחר נקראת כ-15:00.
   */
  it("וכל ביטויי הזמן מוסתרים מהשעון, לא רק הנבחר", () => {
    const at = parseHebrewDateTime("מחר עוד שלוש שעות, לא, בעוד ארבע שעות", NOW);
    expect(il(at.date).day).toBe(2);
    expect(il(at.date).hour).toBe(10);
    expect(at.timeExplicit).toBe(false);
  });

  /* „מחר בעוד שעה” סותר את עצמו — מילת היום גוברת על ההיסט */
  it("ומילת יום מפורשת גוברת על ההיסט", () => {
    expect(il(parseHebrewDateTime("מחר בעוד שעה", NOW).date).day).toBe(2);
  });

  /*
   * ‎„מחר בעוד שלוש שעות”: מילת היום גוברת, אבל „שלוש” שייכת להיסט
   * שנדחה — לא לשעון. בלי הסתרת הביטוי היא נקראה כ-15:00, כלומר
   * מילת יום שגוברת על ההיסט הייתה גוררת אחריה חצי ממנו (ביקורת
   * Codex). מה שנשאר הוא ברירת המחדל, והיא מסומנת ככזו.
   */
  it("והמספר שבהיסט שנדחה אינו הופך לשעה על השעון", () => {
    const result = parseHebrewDateTime("מחר בעוד שלוש שעות", NOW);
    expect(il(result.date).day).toBe(2);
    expect(il(result.date).hour).toBe(10);
    expect(result.timeExplicit).toBe(false);
    expect(result.evidence ?? "").not.toContain("שלוש");
  });

  /*
   * אותו דבר כשההיסט נדחה בגלל **התקרה** ולא בגלל מילת היום:
   * „מחר בעוד תשע שבועות” אינו מייצר תאריך יחסי, אבל „תשע” שבו
   * אינה 09:00. נתיב הדחייה זרק את גבולות הביטוי יחד עם המשך
   * הפסול, ואז המספר דלף לשעון (ביקורת Codex).
   */
  it("וגם היסט שנדחה בגלל תקרה אינו דולף לשעון", () => {
    const result = parseHebrewDateTime("קבע פגישה מחר בעוד תשע שבועות", NOW);
    expect(il(result.date).day).toBe(2);
    expect(il(result.date).hour).toBe(10);
    expect(result.timeExplicit).toBe(false);
  });

  /*
   * ‎`setSeconds(0, 0)` קיצץ, ולכן ב-10:00:59 „עוד דקה” הפכה לדקה
   * אחת פחות חמישים ותשע שניות — תזכורת שמצלצלת כמעט מיד (ביקורת
   * Codex). העיגול כלפי מעלה שומר שההמתנה לעולם אינה קצרה מהמבוקש.
   */
  it("היסט של דקות אינו מתקצר בגלל השניות שעל השעון", () => {
    const almost = new Date("2026-02-01T07:00:59.000Z");
    const at = parseHebrewDateTime("תזכיר לי עוד דקה", almost).date!;
    expect(at.getTime() - almost.getTime()).toBeGreaterThanOrEqual(60_000);
    expect(at.getSeconds()).toBe(0);
  });

  it("בלי שעה — ברירת מחדל 10:00 ומסומן שלא נאמר במפורש", () => {
    const result = parseHebrewDateTime("פגישה מחר", NOW);
    expect(il(result.date).hour).toBe(10);
    expect(result.timeExplicit).toBe(false);
  });

  it("בלי תאריך — לא מנחש", () => {
    expect(parseHebrewDateTime("קבע פגישה עם משה", NOW).date).toBeUndefined();
  });
});

describe("אזור זמן — הרגע הנכון ולא שעון התהליך", () => {
  it("'מחר בשעה 10' הוא 10:00 בירושלים גם כשהשרת ב-UTC", () => {
    /*
     * זו הבדיקה שהייתה חסרה. ‎setHours‎ על שרת UTC ייצר 10:00 UTC,
     * שהוא 12:00 בישראל בקיץ — והמתווך ראה פגישה שלא קבע.
     */
    const result = parseHebrewDateTime("פגישה מחר בשעה 10 בבוקר", NOW);
    expect(result.date?.toISOString()).toBe("2026-02-02T08:00:00.000Z"); // חורף: UTC+2
  });

  it("בקיץ ההיסט הוא שלוש שעות, ואותו משפט נותן רגע אחר", () => {
    const summer = new Date("2026-08-09T05:00:00.000Z"); // 08:00 בישראל
    const result = parseHebrewDateTime("פגישה מחר בשעה 10 בבוקר", summer);
    expect(result.date?.toISOString()).toBe("2026-08-10T07:00:00.000Z"); // קיץ: UTC+3
  });

  it("'בשעה 5' ו'בשעה 5:00' נותנים אותה שעה", () => {
    /*
     * הענף של hh:mm חזר מיד ודילג על הכרעת בוקר/ערב: אותו משפט נתן
     * 17:00 בצורה אחת ו-05:00 בשנייה — פגישה בחמש לפנות בוקר.
     */
    const a = parseHebrewDateTime("פגישה מחר בשעה 5", NOW);
    const b = parseHebrewDateTime("פגישה מחר בשעה 5:00", NOW);
    expect(il(a.date).hour).toBe(17);
    expect(il(b.date).hour).toBe(17);
  });
});

describe("תאריך מפורש", () => {
  it("'11 באוגוסט' — לא היום ולא מחר", () => {
    expect(il(parseHebrewDateTime("פגישה ב-11 באוגוסט", NOW)?.date)).toMatchObject({
      day: 11,
      month: 8,
    });
  });

  it("'11 לשמיני' — החודש בצורה סודרת, כמו שמדברים", () => {
    expect(il(parseHebrewDateTime("קבע פגישה 11 לשמיני בשעה 5", NOW).date)).toMatchObject({
      day: 11,
      month: 8,
      hour: 17,
    });
  });

  it("תאריך מפורש גובר על 'היום'", () => {
    /*
     * התמלול האמיתי שהתגלה בשימוש הכיל את שניהם. "היום" ניצח,
     * והפגישה נקבעה ליום הלא נכון בלי שום סימן במסך.
     */
    const result = parseHebrewDateTime("תקבע פגישה עם ריקי היום 11 לשמיני בשעה 5:00", NOW);
    expect(il(result.date)).toMatchObject({ day: 11, month: 8, hour: 17 });
  });

  it("תאריך שכבר חלף שייך לשנה הבאה", () => {
    // NOW הוא פברואר 2026; "11 לינואר" הוא ינואר 2027
    const result = parseHebrewDateTime("פגישה 11 בינואר", NOW);
    expect(result.date?.getUTCFullYear()).toBe(2027);
  });

  it("שנה מפורשת מתקבלת כלשונה", () => {
    const result = parseHebrewDateTime("פגישה בתאריך 11.1.2026", NOW);
    expect(result.date?.getUTCFullYear()).toBe(2026);
    expect(il(result.date)).toMatchObject({ day: 11, month: 1 });
  });

  it("'3.5 חדרים' אינו תאריך", () => {
    /*
     * הצורה המספרית דורשת "בתאריך" או שנה מלאה בדיוק בשביל זה:
     * ניחוש של 3 במאי מתוך תיאור נכס גרוע מלא לזהות תאריך בכלל.
     */
    expect(parseHebrewDateTime("דירה 3.5 חדרים בתל אביב", NOW).date).toBeUndefined();
  });

  it("'יום שלישי' אינו נקרא כחודש שלישי", () => {
    // הצורה הסודרת דורשת מספר יום לפניה; בלעדיו זו סתם מילה
    expect(il(parseHebrewDateTime("קבע פגישה ביום שלישי", NOW).date).month).toBe(2);
  });
});

describe("parseAppointmentKind", () => {
  it("מזהה סיור בנכס", () => {
    expect(parseAppointmentKind("סיור בדירה מחר")).toBe("viewing");
  });

  it("מזהה שיחת טלפון", () => {
    expect(parseAppointmentKind("שיחה עם הלקוח")).toBe("call");
  });

  it("ברירת מחדל — פגישה", () => {
    expect(parseAppointmentKind("להיפגש עם משה")).toBe("meeting");
  });
});

describe("תאריך מפורש — מקרי קצה מביקורת Codex", () => {
  it("'31 בפברואר' נדחה ולא הופך ל-3 במרץ", () => {
    /*
     * setFullYear מגלגל בשקט, והתוצאה הוצגה כתאריך שזוהה בהצלחה —
     * כלומר המתווך אישר פגישה ביום שאיש לא אמר.
     */
    expect(parseHebrewDateTime("פגישה 31 בפברואר", NOW).date).toBeUndefined();
  });

  it("חודש שאינו קיים נדחה", () => {
    expect(parseHebrewDateTime("פגישה בתאריך 10.19", NOW).date).toBeUndefined();
  });

  it("29 בפברואר בשנה מעוברת מתקבל", () => {
    // 2028 מעוברת; NOW הוא פברואר 2026, ולכן צריך שנה מפורשת
    const result = parseHebrewDateTime("פגישה בתאריך 29.2.2028", NOW);
    expect(il(result.date)).toMatchObject({ day: 29, month: 2 });
  });

  it("אתמול מתגלגל לשנה הבאה", () => {
    /*
     * הסובלנות של יממה גרמה ל"9 באוגוסט" שנאמר ב-10 באוגוסט ליפול
     * בין הכיסאות: בדיוק יממה אחורה, לא עמד בתנאי, ונשמר כפגישה
     * בעבר — ונתיב הפגישות מקבל זמנים בעבר בשקט.
     */
    const aug10 = new Date("2026-08-10T09:00:00.000Z");
    const result = parseHebrewDateTime("פגישה 9 באוגוסט", aug10);
    expect(result.date?.getUTCFullYear()).toBe(2027);
  });

  it("היום עצמו אינו מתגלגל, גם כשהשעה כבר עברה", () => {
    // 10 באוגוסט בצהריים, "10 באוגוסט בשעה 9 בבוקר" — היום, לא 2027
    const noon = new Date("2026-08-10T09:00:00.000Z"); // 12:00 בישראל
    const result = parseHebrewDateTime("פגישה 10 באוגוסט בשעה 9 בבוקר", noon);
    expect(result.date?.getUTCFullYear()).toBe(2026);
    expect(il(result.date)).toMatchObject({ day: 10, month: 8, hour: 9 });
  });
});
