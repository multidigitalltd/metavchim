import { describe, expect, it } from "vitest";
import {
  RECORDING_BLOCKED_REASON,
  RECORDING_GIVE_UP_MS,
  RECORDING_STATES,
  recordingReasonLabel,
  recordingStateLabel,
  recordingStateOf,
} from "./recording-state";
import { UNANSWERED_OUTCOMES } from "./telephony";

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

  /*
   * ‎**שיחה שלא נענתה — לא נמשכת, והמסך אומר זאת.**
   *
   * שלוש טענות בבדיקה אחת, כי הן חייבות להיות עקביות: הסבב מדלג,
   * המסך אינו מבטיח „בדרך”, והזמן אינו הופך את זה ל„נכשלה”. אלמלא
   * כן היה המסך מבטיח משיכה שלא תקרה — התקלה שכבר תוקנה כאן פעם
   * אחת עם `no_integration`.
   */
  it("שיחה שלא נענתה — מדולגת, ולא „בדרך” ולא „נכשלה”", () => {
    const row = {
      providerRecordingPath: "54936/12048/record_1_2",
      outcome: "missed",
      occurredAt: minutesAgo(10),
    };
    expect(recordingStateOf(row, now)).toEqual({ state: "skipped" });
    // גם אחרי שחלון הוויתור נסגר — עדיין „מדולגת”, לא „נכשלה”
    expect(
      recordingStateOf(
        { ...row, providerRecordingAttemptAt: minutesAgo(5) },
        now + RECORDING_GIVE_UP_MS + hour,
      ),
    ).toEqual({ state: "skipped" });
  });

  /*
   * ‎**כל תוצאה שמשמעותה „לא נענתה”, ולא רק `missed`.**
   *
   * ‎`callOutcomeOf` כותב `missed` בלבד, אבל מתווכת יכולה לסמן שיחה
   * ידנית כ-`voicemail` — וזה בדיוק המקרה שנאמר עליו במפורש שאין
   * לתמלל. הרשימה נגזרת מ-`UNANSWERED_OUTCOMES` ואינה מועתקת, כדי
   * שתוצאה חדשה לא תישאר בחוץ בשקט (ביקורת Codex).
   */
  it("כל תוצאה שאינה מענה — מדולגת", () => {
    for (const outcome of UNANSWERED_OUTCOMES) {
      expect(
        recordingStateOf(
          {
            providerRecordingPath: "54936/12048/record_1_2",
            outcome,
            occurredAt: minutesAgo(10),
          },
          now,
        ),
      ).toEqual({ state: "skipped" });
    }
  });

  /*
   * ‎**„לא ידוע” אינו „לא נענתה”.** אין בידינו ראיה שמישהו ענה,
   * וההקלטה היא בדיוק הראיה החסרה — ולכן היא כן נמשכת. זו ההבחנה
   * שהופרה שלוש פעמים בקובץ הטלפוניה, ואין להפר אותה כאן בעקיפין.
   */
  it("„לא ידוע” נמשכת כרגיל — היעדר ראיה אינו ראיה", () => {
    expect(
      recordingStateOf(
        {
          providerRecordingPath: "54936/12048/record_1_2",
          outcome: "unknown",
          occurredAt: minutesAgo(10),
        },
        now,
      ),
    ).toEqual({ state: "pending" });
  });

  /*
   * החלטה של אדם גוברת על הכלל האוטומטי: הקלטה שכבר שמורה אצלנו
   * נשמעת, גם על שיחה שלא נענתה.
   */
  it("הקלטה ששמורה כבר — זמינה גם בשיחה שלא נענתה", () => {
    expect(
      recordingStateOf(
        {
          recordingKey: "calls/t/c/x",
          providerRecordingPath: "54936/12048/record_1_2",
          outcome: "missed",
          occurredAt: minutesAgo(10),
        },
        now,
      ),
    ).toEqual({ state: "ready" });
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

  it("אין חיבור פעיל — חסומה, ולא „ננסה שוב”", () => {
    /*
     * הסבב חוזר ריק לפני שהוא בוחר ולו שיחה אחת, ולכן „ננסה שוב”
     * הוא הבטחה שלא תתקיים כמה שלא ימתינו. התיקון בהגדרות.
     */
    expect(
      recordingStateOf(
        {
          providerRecordingPath: "54936/12048/record_1_2",
          providerRecordingError: RECORDING_BLOCKED_REASON,
          occurredAt: minutesAgo(30),
        },
        now,
      ),
    ).toEqual({ state: "blocked", reason: RECORDING_BLOCKED_REASON });
  });

  it("אין חיבור, אבל השיחה כבר נוסתה ויצאה מהחלון — נכשלה", () => {
    /*
     * חותמת הניסיון שלה כתובה, ולכן גם החזרת החיבור לא תחזיר אותה
     * לתור. „חסומה” כאן היה מרמז שיש מה לעשות.
     */
    expect(
      recordingStateOf(
        {
          providerRecordingPath: "54936/12048/record_1_2",
          providerRecordingAttemptAt: minutesAgo(1),
          providerRecordingError: RECORDING_BLOCKED_REASON,
          occurredAt: new Date(now - RECORDING_GIVE_UP_MS - hour),
        },
        now,
      ),
    ).toEqual({ state: "failed", reason: RECORDING_BLOCKED_REASON });
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
  /*
   * הרשימה נגזרת מ-`RECORDING_STATES` ואינה מועתקת: מצב חדש שיצטרף
   * בלי ניסוח משלו ייפול כאן, במקום להיבלע בבדיקה שממשיכה לעבור.
   */
  it("כל מצב מקבל משפט משלו", () => {
    const seen = new Set(RECORDING_STATES.map((state) => recordingStateLabel({ state })));
    expect(seen.size).toBe(RECORDING_STATES.length);
  });

  it("„חסומה” אינה מבטיחה ניסיון נוסף", () => {
    /*
     * זה כל ההבדל בין המצב הזה ל„ננסה שוב”: הכפתור אינו מוצג,
     * ולכן גם המשפט אינו רומז שיש מה ללחוץ.
     */
    const label = recordingStateLabel({ state: "blocked", reason: RECORDING_BLOCKED_REASON });
    expect(label).not.toContain("ננסה שוב");
    expect(label).toContain("הגדרות");
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
