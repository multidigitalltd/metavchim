import { describe, expect, it } from "vitest";
import {
  build015RecordingUrl,
  parse015RecordingResponse,
  parseTelephonyEvent,
  split015RecordingPath,
} from "./telephony.js";

/*
 * הנתונים כאן הם **הוובהוק האמיתי מהשטח**, לא דוגמה שהומצאה.
 * שלושת האירועים שהמרכזייה שלחה על שיחה אחת, כולל השדות שנבלעו עד
 * עכשיו: `recording`, `callername` ו-`start`.
 */
const HANGUP = {
  callid: "1787204775.1258756",
  status: "Hangup",
  direction: "outbound",
  callerid_external: "0501234567",
  snumber: "5826830221",
  cnumber: "0501234567",
  talktime: "32",
  totaltime: "43",
  extension: "5826830221",
  recording: "54936/12048/2026/08/20/record_17872047751258756_23747",
  callername: "משה כהן",
  start: "1787204776",
  uniqueid: "1787204775.1258756",
};

describe("שדות הוובהוק של 015 שנבלעו עד עכשיו", () => {
  it("שלושתם נקלטים מהאירוע האמיתי", () => {
    const event = parseTelephonyEvent(HANGUP)!;
    expect(event.callerName).toBe("משה כהן");
    expect(event.providerRecordingPath).toBe(
      "54936/12048/2026/08/20/record_17872047751258756_23747",
    );
    expect(event.startedAt?.toISOString()).toBe("2026-08-20T05:46:16.000Z");
  });

  /*
   * המרכזייה שולחת שלושה אירועים לשיחה אחת. `start` זהה בכולם,
   * ולכן שעת השיחה יציבה — בעוד ש-`new Date()` הייתה נותנת שלוש
   * שעות שונות, והאחרונה שבהן מנצחת.
   */
  it("שלושת האירועים מדווחים על אותה שעת התחלה", () => {
    const times = ["Calling", "Answer", "Hangup"].map(
      (status) => parseTelephonyEvent({ ...HANGUP, status })!.startedAt?.getTime(),
    );
    expect(new Set(times).size).toBe(1);
  });

  it("שם שהוא בעצם מספר אינו נשמר כשם", () => {
    expect(parseTelephonyEvent({ ...HANGUP, callername: "0501234567" })!.callerName).toBeUndefined();
    expect(parseTelephonyEvent({ ...HANGUP, callername: "Unknown" })!.callerName).toBeUndefined();
    expect(parseTelephonyEvent({ ...HANGUP, callername: "  " })!.callerName).toBeUndefined();
  });

  /*
   * ‎`Number("0")`‎ תקין לחלוטין ומתורגם ל-1970. בלי בדיקת הסבירות
   * שיחה הייתה נרשמת כאילו קרתה לפני חמישים שנה, במקום ליפול חזרה
   * לשעת הקליטה.
   */
  it("חותם זמן לא סביר נדחה ולא מתקבל כ-1970", () => {
    expect(parseTelephonyEvent({ ...HANGUP, start: "0" })!.startedAt).toBeUndefined();
    expect(parseTelephonyEvent({ ...HANGUP, start: "abc" })!.startedAt).toBeUndefined();
  });

  it("מילישניות מזוהות לפי סדר הגודל", () => {
    const event = parseTelephonyEvent({ ...HANGUP, start: "1787204776000" })!;
    expect(event.startedAt?.toISOString()).toBe("2026-08-20T05:46:16.000Z");
  });

  /* שלושת השדות ירדו מרשימת „לא ממופה” — זו הנקודה של כל השינוי */
  it("אינם נחשבים עוד לשדות שלא שויכו", async () => {
    const { unmappedFields } = await import("./telephony.js");
    expect(unmappedFields(HANGUP)).toEqual([]);
  });
});

describe("פענוח נתיב ההקלטה", () => {
  it("מחלץ את קבוצת ההקלטה ואת מזהה הרשומה", () => {
    expect(split015RecordingPath("54936/12048/2026/08/20/record_17872047751258756_23747")).toEqual({
      recordGroup: "54936",
      recordId: "23747",
    });
  });

  it("צורה לא מוכרת מוחזרת כ-null ולא כניחוש", () => {
    expect(split015RecordingPath("")).toBeNull();
    expect(split015RecordingPath("record_only")).toBeNull();
    expect(split015RecordingPath("abc/def/record_x_y")).toBeNull();
  });
});

describe("בניית הבקשה ל-015", () => {
  const url = build015RecordingUrl({
    authUsername: "user",
    authPassword: "p@ss word",
    recordGroup: "54936",
    uniqueId: "1787204775.1258756",
    recordId: "23747",
  });

  it("כוללת את חמשת הפרמטרים שהתיעוד דורש", () => {
    for (const key of ["auth_username", "auth_password", "recordgroup", "uniqueid", "recordid"]) {
      expect(url).toContain(`${key}=`);
    }
  });

  /*
   * ‎`uniqueid` נשלח **עם הנקודה**, כפי שהוובהוק שלח אותו. בשם הקובץ
   * הוא מופיע בלעדיה, ושחזור הנקודה משם הוא ניחוש שאין דרך לאמת.
   */
  it("מזהה השיחה נשלח כפי שהתקבל, עם הנקודה", () => {
    expect(url).toContain("uniqueid=1787204775.1258756");
  });

  it("סיסמה עם תווים מיוחדים מקודדת", () => {
    expect(url).toContain("auth_password=p%40ss%20word");
  });
});

describe("פענוח תשובת ההקלטה", () => {
  it("מוצא את הקובץ תחת שמות השדה המקובלים", () => {
    for (const key of ["sound", "soundfile", "file"]) {
      expect(parse015RecordingResponse({ data: { [key]: "QUJD" } })?.base64).toBe("QUJD");
    }
  });

  it("עובד גם כשהקובץ יושב בשורש ולא תחת data", () => {
    expect(parse015RecordingResponse({ sound: "QUJD" })?.base64).toBe("QUJD");
  });

  it("סוג הקובץ נגזר מהפורמט, וברירת המחדל היא WAV", () => {
    expect(parse015RecordingResponse({ data: { sound: "QUJD", format: "mp3" } })?.contentType).toBe(
      "audio/mpeg",
    );
    expect(parse015RecordingResponse({ data: { sound: "QUJD" } })?.contentType).toBe("audio/wav");
  });

  it("תשובה בלי קובץ מוחזרת כ-null", () => {
    expect(parse015RecordingResponse({ data: {} })).toBeNull();
    expect(parse015RecordingResponse(null)).toBeNull();
    expect(parse015RecordingResponse({ data: { sound: "" } })).toBeNull();
  });
});
