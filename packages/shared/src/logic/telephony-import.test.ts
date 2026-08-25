import { describe, expect, it } from "vitest";
import {
  build015RecordingsListUrl,
  dropped015ListRows,
  pbx015ListRowKeys,
  parse015RecordingsList,
  pbx015RecordingPath,
  split015RecordingPath,
  unmatched015ListKeys,
} from "./telephony.js";

/**
 * ייבוא הקלטות שקדמו לחיבור.
 *
 * הוובהוק מכסה רק את מה שקרה אחרי החיבור. כל מה שהוקלט לפני כן
 * יושב אצל הספק בלי שנדע עליו — ויימחק כשמדיניות השמירה שלו
 * תגיע אליו. `recording/recordings/list` הוא הדרך היחידה לגלות
 * אותו.
 */

const LIST_RESPONSE = {
  responses: { code: 200, key: "ok", message: "" },
  data: [
    { uniqueid: "1787204775.1258756", recordid: "23747", recordgroup: "54936", start: "1787204776" },
    { uniqueid: "1787100000.1000001", recordid: "23700", recordgroup: "54936", start: "1787100001" },
  ],
};

describe("בניית בקשת הרשימה", () => {
  const url = build015RecordingsListUrl({
    authUsername: "user",
    authPassword: "p@ss word",
    recordGroup: "12048",
    fromEpochSeconds: 1787000000,
    toEpochSeconds: 1787999999,
  });

  it("כוללת את הזיהוי ואת טווח הזמן", () => {
    for (const key of ["auth_username", "auth_password", "start", "end"]) {
      expect(url).toContain(`${key}=`);
    }
    expect(url).toContain("start=1787000000");
    expect(url).toContain("end=1787999999");
  });

  /*
   * ‎`recordgroup` **חובה**, ולא ברירת מחדל.
   *
   * כאן עמדה בדיוק ההפך: בדיקה שאכפה שהוא **לא** יישלח, על סמך
   * הנחה שברירת המחדל היא „כל הקבוצות של הלקוח”. התיעוד של 015
   * אומר `recordgroup` או `customer` — „Yes, unless the other is
   * specified” — כלומר הבקשה שלנו הייתה חסרה, וכנראה שהייבוא לא
   * עבד מעולם. רשימה ריקה נראית בדיוק כמו „אין הקלטות”.
   */
  it("נושאת את קבוצת ההקלטות, כפי שהתיעוד דורש", () => {
    expect(url).toContain("recordgroup=12048");
  });

  it("מבקשת רק הקלטות שהסתיימו", () => {
    expect(url).toContain("complete=1");
  });

  it("שניות ולא מילישניות, וגם כשהקלט שבור", () => {
    const fractional = build015RecordingsListUrl({
      authUsername: "u",
      authPassword: "p",
      recordGroup: "12048",
      fromEpochSeconds: 1787000000.9,
      toEpochSeconds: 1787999999.9,
    });
    expect(fractional).toContain("start=1787000000");
  });
});

describe("פענוח הרשימה", () => {
  it("מחלץ את שלושת המזהים מכל שורה", () => {
    expect(parse015RecordingsList(LIST_RESPONSE)).toEqual([
      { uniqueId: "1787204775.1258756", recordId: "23747", recordGroup: "54936" },
      { uniqueId: "1787100000.1000001", recordId: "23700", recordGroup: "54936" },
    ]);
  });

  /* המספרים מגיעים לפעמים כמספרים ולא כמחרוזות — שתי הצורות תקפות */
  it("מקבל מזהים גם כמספרים", () => {
    const rows = parse015RecordingsList({
      data: [{ uniqueid: "1787204775.1258756", recordid: 23747, recordgroup: 54936 }],
    });
    expect(rows[0]).toEqual({
      uniqueId: "1787204775.1258756",
      recordId: "23747",
      recordGroup: "54936",
    });
  });

  /*
   * **הקבוצה היא פרמטר של הבקשה, לא שדה של התשובה.**
   *
   * התיעוד מונה לשורה `uniqueid`, `snumber`, `cnumber`, `start`,
   * ‎`totaltime` ו-`expires` — ולא `recordgroup`. הדרישה שיופיע
   * בשורה הפילה **כל** שורה בשקט, והייבוא דיווח „אין הקלטות אצל
   * הספק” על תשובה מלאה. זה בדיוק הדיווח שהתקבל מהשטח.
   */
  it("שורה בלי קבוצה משתייכת לקבוצה שביקשנו", () => {
    const rows = parse015RecordingsList(
      { data: [{ uniqueid: "1787204775.1258756", recordid: "23747", start: "1787204776" }] },
      "12048",
    );
    expect(rows).toEqual([
      { uniqueId: "1787204775.1258756", recordId: "23747", recordGroup: "12048" },
    ]);
  });

  /* וקבוצה שהספק כן מסר גוברת — הוא יודע טוב מאיתנו */
  it("וקבוצה שהתקבלה בשורה גוברת על זו שביקשנו", () => {
    const rows = parse015RecordingsList({ data: [LIST_RESPONSE.data[0]] }, "12048");
    expect(rows[0]?.recordGroup).toBe("54936");
  });

  /*
   * הספירה היא מה שמבדיל „שם שדה שהשתנה” מ„אין הקלטות” — שני
   * מצבים שנראים זהים מבחוץ ודורשים פעולה הפוכה.
   */
  it("ושורות שנשמטו נספרות, גם כשאחרות נקראו", () => {
    const body = { data: [{ ping: "pong" }, LIST_RESPONSE.data[0]] };
    expect(parse015RecordingsList(body, "12048")).toHaveLength(1);
    expect(dropped015ListRows(body, "12048")).toBe(1);
    expect(dropped015ListRows(LIST_RESPONSE, "12048")).toBe(0);
  });

  /*
   * **וגם `recordid` אינו שדה שהתשובה מבטיחה.**
   *
   * זו אותה תקלה של `recordgroup`, באותה שורה — ותיקון אחד מהם
   * לבדו לא היה משנה דבר: שורה בצורה המתועדת בדיוק המשיכה ליפול,
   * רק על שדה אחר (ביקורת Codex).
   *
   * הקלטה בלי מזהה הורדה אינה ניתנת למשיכה, אבל היא קיימת — וזה
   * ההבדל בין אבחון לבין מבוי סתום.
   */
  it("שורה בצורה המתועדת נקראת, גם בלי מזהה הורדה", () => {
    const documented = {
      uniqueid: "1787204775.1258756",
      snumber: "5826830221",
      cnumber: "0501234567",
      start: "1787204776",
      totaltime: "43",
      expires: "1790000000",
    };
    const rows = parse015RecordingsList({ data: [documented] }, "12048");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.uniqueId).toBe("1787204775.1258756");
    expect(rows[0]?.recordGroup).toBe("12048");
    expect(rows[0]?.recordId).toBeUndefined();
    expect(dropped015ListRows({ data: [documented] }, "12048")).toBe(0);
  });

  /*
   * שמות השדות הם הדרך היחידה ללמוד את צורת השורה האמיתית: היא
   * אינה מתועדת, וכל בחירת שם בלעדיה היא הימור. שמות בלבד — ערכי
   * השורה נושאים מספרי טלפון.
   */
  it("ושמות השדות של השורה הראשונה נחשפים לאבחון", () => {
    expect(pbx015ListRowKeys(LIST_RESPONSE)).toEqual([
      "uniqueid",
      "recordid",
      "recordgroup",
      "start",
    ]);
    expect(pbx015ListRowKeys({ data: [] })).toEqual([]);
  });

  it("שורה בלי מזהה שיחה נזרקת ואינה מפילה את השאר", () => {
    const rows = parse015RecordingsList({
      data: [{ recordid: "1", recordgroup: "2" }, LIST_RESPONSE.data[0]],
    });
    expect(rows).toHaveLength(1);
  });

  it("תשובה שאינה מערך אינה מפילה", () => {
    for (const body of [null, {}, { data: "x" }, []]) {
      expect(parse015RecordingsList(body)).toEqual([]);
    }
  });

  /*
   * הצורה הנפוצה אצל 015: מערך של תשובה אחת, והשורות בתוכה. בלי
   * פתיחת המעטפת נבחר המערך החיצוני, השורה היחידה שנבדקה הייתה
   * המעטפת עצמה, והייבוא דיווח אפס הקלטות על תשובה מלאה.
   */
  it("קורא שורות גם מתוך מעטפת שהיא מערך", () => {
    const rows = parse015RecordingsList({
      responses: [{ code: "200", message: "", data: LIST_RESPONSE.data }],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.recordId).toBe("23747");
  });

  /* ונתיב שמחזיר את השורות ישירות ב-`responses` ממשיך לעבוד */
  it("וגם כשהשורות עצמן הן המעטפת", () => {
    const rows = parse015RecordingsList({ responses: LIST_RESPONSE.data });
    expect(rows).toHaveLength(2);
  });
});

/*
 * שמות השדות אינם מתועדים. ביום ש-015 ישנה אותם הייבוא יחזיר אפס
 * שורות **בשקט**, וזה בדיוק סוג הכשל שאי אפשר לאבחן מהשטח.
 */
describe("אבחון שמות שדות", () => {
  it("מדווח על שדות שהגיעו ולא זוהו — בלי הערכים", () => {
    expect(unmatched015ListKeys(LIST_RESPONSE)).toEqual(["start"]);
  });

  it("תשובה ריקה אינה מייצרת רעש", () => {
    expect(unmatched015ListKeys({ data: [] })).toEqual([]);
  });
});

/**
 * הנתיב שנבנה מהרשימה חייב להיקרא בחזרה על ידי אותו מפענח שקורא
 * את נתיב הוובהוק — אחרת הייבוא כותב משהו שהסבב לא ידע למשוך.
 */
describe("הנתיב שנבנה תואם למפענח הקיים", () => {
  it("הלוך-ושוב מחזיר את אותם מזהים", () => {
    const row = { uniqueId: "1787204775.1258756", recordId: "23747", recordGroup: "54936" };
    const path = pbx015RecordingPath(row);
    expect(split015RecordingPath(path)).toEqual({ recordGroup: "54936", recordId: "23747" });
  });

  /*
   * הנקודה יורדת משם הקובץ, בדיוק כפי שהמרכזייה כותבת אותו —
   * `1787204775.1258756` ⟵ `record_17872047751258756_23747`.
   * המזהה עם הנקודה נשמר בשיחה עצמה, כי ממנו נבנית בקשת המשיכה.
   */
  it("שם הקובץ נכתב בלי הנקודה, כמו אצל הספק", () => {
    expect(
      pbx015RecordingPath({
        uniqueId: "1787204775.1258756",
        recordId: "23747",
        recordGroup: "54936",
      }),
    ).toBe("54936/record_17872047751258756_23747");
  });
});
