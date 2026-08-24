import { describe, expect, it } from "vitest";
import {
  RECORDING_GIVE_UP_MS,
  recordingReasonLabel,
  recordingStateLabel,
  recordingStateOf,
} from "./recording-state";

/**
 * הטענה שנבדקת כאן היא **שלא נשארים שלושה מצבים שנראים כאחד.**
 *
 * הכשל שהוביל לקוד הזה לא היה חישוב שגוי אלא ויתור: המסך הציג
 * „לא צורפה הקלטה” גם כשהמרכזייה שלחה נתיב תקין והמשיכה נכשלה
 * בשקט. לכן הבדיקות כאן מפרידות בעיקר בין מצבים, ולא מוודאות
 * מספרים.
 */

const hour = 60 * 60 * 1000;
const now = Date.UTC(2026, 7, 24, 18, 0, 0);
const minutesAgo = (n: number) => new Date(now - n * 60 * 1000);

describe("recordingStateOf", () => {
  it("קובץ אצלנו — זמין, גם אם נרשמה תקלה קודמת", () => {
    /*
     * הצלחה מנקה את הסיבה, אבל אם שורה ישנה עדיין נושאת אותה —
     * הקובץ מנצח. המשתמש יכול לנגן, וזה כל מה שמעניין אותו.
     */
    expect(
      recordingStateOf(
        {
          recordingKey: "calls/t/c/x",
          providerRecordingPath: "54936/12048/record_1_2",
          providerRecordingError: "network_error",
          occurredAt: minutesAgo(10),
        },
        now,
      ),
    ).toEqual({ state: "ready" });
  });

  it("בלי נתיב מהמרכזייה — באמת אין הקלטה", () => {
    expect(recordingStateOf({ occurredAt: minutesAgo(10) }, now)).toEqual({ state: "none" });
  });

  it("נתיב הגיע וטרם נוסה — ממתינה, ולא „אין”", () => {
    // זה המצב שבו נשאלה השאלה מהשטח: השיחה הסתיימה לפני רגע
    expect(
      recordingStateOf(
        { providerRecordingPath: "54936/12048/record_1_2", occurredAt: minutesAgo(2) },
        now,
      ),
    ).toEqual({ state: "pending" });
  });

  it("נכשלה ועדיין בחלון — ננסה שוב, עם הסיבה", () => {
    expect(
      recordingStateOf(
        {
          providerRecordingPath: "54936/12048/record_1_2",
          providerRecordingAttemptAt: minutesAgo(5),
          providerRecordingError: "missing_credentials",
          occurredAt: minutesAgo(30),
        },
        now,
      ),
    ).toEqual({ state: "retrying", reason: "missing_credentials" });
  });

  it("מחוץ לחלון — נכשלה סופית, גם אם הניסיון האחרון היה לפני רגע", () => {
    /*
     * הגבול נמדד ממועד השיחה ולא ממועד הניסיון, בדיוק כמו תנאי
     * הבחירה בסבב. שיחה שיצאה מהחלון לא תיבחר שוב, ולכן „ננסה
     * שוב” היה מבטיח למשתמש דבר שלא יקרה.
     */
    expect(
      recordingStateOf(
        {
          providerRecordingPath: "54936/12048/record_1_2",
          providerRecordingAttemptAt: minutesAgo(1),
          providerRecordingError: "provider_rejected_500",
          occurredAt: new Date(now - RECORDING_GIVE_UP_MS - hour),
        },
        now,
      ),
    ).toEqual({ state: "failed", reason: "provider_rejected_500" });
  });

  it("בדיוק על הגבול — עדיין בפנים", () => {
    expect(
      recordingStateOf(
        {
          providerRecordingPath: "54936/12048/record_1_2",
          providerRecordingAttemptAt: minutesAgo(40),
          occurredAt: new Date(now - RECORDING_GIVE_UP_MS),
        },
        now,
      ),
    ).toEqual({ state: "pending" });
  });

  it("מחוץ לחלון בלי סיבה רשומה — נכשלה, בלי להמציא סיבה", () => {
    /*
     * כך נראית שיחה שהתהליך נפל באמצע הניסיון שלה: החותמת נכתבה,
     * הסיבה לא. בלי המצב הזה היא הייתה מוצגת „ממתינה” לנצח.
     */
    const status = recordingStateOf(
      {
        providerRecordingPath: "54936/12048/record_1_2",
        providerRecordingAttemptAt: minutesAgo(90),
        occurredAt: new Date(now - RECORDING_GIVE_UP_MS - hour),
      },
      now,
    );
    expect(status).toEqual({ state: "failed" });
    expect(status.reason).toBeUndefined();
  });

  it("שיחה ישנה שטרם נוסתה — ממתינה, כי הסבב עוד ייקח אותה", () => {
    /*
     * חלון הוויתור חל על מי שכבר נוסתה. שיחה שחותמת הניסיון שלה
     * ריקה — למשל בגלל שהסבב היה מושבת — תיבחר בלי קשר לגילה,
     * ולכן „נכשלה” היה כאן שקר.
     */
    expect(
      recordingStateOf(
        {
          providerRecordingPath: "54936/12048/record_1_2",
          occurredAt: new Date(now - RECORDING_GIVE_UP_MS - hour),
        },
        now,
      ),
    ).toEqual({ state: "pending" });
  });

  it("„נסו למשוך שוב” על שיחה ישנה מחזיר אותה לתור ולא ל„נכשלה”", () => {
    /*
     * זו בדיוק הלחיצה מהמסך: הנתיב מאפס את החותמת ואת הסיבה.
     * אם ההכרעה כאן הייתה נשארת „נכשלה”, המתווך היה לוחץ ורואה
     * שדבר לא השתנה — וזה גרוע יותר מכפתור שאינו קיים.
     */
    expect(
      recordingStateOf(
        {
          providerRecordingPath: "54936/12048/record_1_2",
          providerRecordingAttemptAt: null,
          providerRecordingError: null,
          occurredAt: new Date(now - RECORDING_GIVE_UP_MS - hour),
        },
        now,
      ),
    ).toEqual({ state: "pending" });
  });
});

describe("הניסוח למתווך", () => {
  it("כל מצב מקבל משפט משלו", () => {
    const seen = new Set(
      (["ready", "none", "pending", "retrying", "failed"] as const).map((state) =>
        recordingStateLabel({ state }),
      ),
    );
    expect(seen.size).toBe(5);
  });

  it("„נכשלה” ו„ננסה שוב” אינם אותו משפט", () => {
    const reason = "missing_credentials";
    expect(recordingStateLabel({ state: "retrying", reason })).not.toBe(
      recordingStateLabel({ state: "failed", reason }),
    );
  });

  it("קוד דחייה של הספק מוצג עם המספר", () => {
    expect(recordingReasonLabel("provider_rejected_403")).toContain("403");
  });

  it("דחייה בלי מספר אינה מדפיסה סוגריים ריקים", () => {
    expect(recordingReasonLabel("provider_rejected")).not.toContain("(");
  });

  it("קוד שאיננו מכירים אינו מוצג כפי שהוא", () => {
    /*
     * הקוד עלול להגיע משורה ישנה או מגרסה אחרת. הצגה גולמית של
     * מחרוזת שלא נבדקה היא בדיוק הדרך שבה פרט פנימי מגיע למסך.
     */
    expect(recordingReasonLabel("weird_internal_code")).toBe("הסיבה אינה ידועה");
    expect(recordingReasonLabel(undefined)).toBe("הסיבה אינה ידועה");
  });

  it("„אישורים חסרים” אומר למשתמש לאן ללכת", () => {
    expect(recordingReasonLabel("missing_credentials")).toContain("הגדרות");
  });

  it("„אין חיבור” אינו מנוסח כמו „אישורים חסרים”", () => {
    /*
     * שתי תקלות שונות עם שני תיקונים שונים: להפעיל חיבור מול
     * להשלים סיסמה. ניסוח אחד לשתיהן היה שולח את המתווך לחפש
     * שדה שאינו קיים אצלו.
     */
    expect(recordingReasonLabel("no_integration")).not.toBe(
      recordingReasonLabel("missing_credentials"),
    );
    expect(recordingReasonLabel("no_integration")).toContain("הגדרות");
  });
});
