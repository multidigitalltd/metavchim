import { describe, expect, it } from "vitest";
import {
  build015RecordingsListUrl,
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
   * `recordgroup` **אינו** נשלח: ברירת המחדל היא כל הקבוצות של
   * הלקוח, ומשרד יכול להחזיק כמה — קיבוע קבוצה אחת היה מייבא חלק
   * מההקלטות ומשאיר את השאר מאחור בלי שאיש ישים לב.
   */
  it("אינה מקבעת קבוצת הקלטה אחת", () => {
    expect(url).not.toContain("recordgroup=");
  });

  it("מבקשת רק הקלטות שהסתיימו", () => {
    expect(url).toContain("complete=1");
  });

  it("שניות ולא מילישניות, וגם כשהקלט שבור", () => {
    const fractional = build015RecordingsListUrl({
      authUsername: "u",
      authPassword: "p",
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
