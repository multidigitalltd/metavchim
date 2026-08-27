import { describe, expect, it } from "vitest";
import {
  DEFAULT_VIEWING_REMINDER_MESSAGES,
  VIEWING_REMINDER_DEFAULT_HOURS,
  renderViewingReminder,
  viewingReminderChannelLabel,
  viewingReminderDue,
  viewingReminderOccupantContactId,
  viewingReminderSkipReason,
  viewingReminderUses,
  viewingReminderWhenLabel,
  type ViewingReminderVars,
} from "./viewing-reminder.js";

const VARS: ViewingReminderVars = {
  שם: "דנה",
  מתי: "היום",
  שעה: "17:30",
  תאריך: "27/08",
  כתובת: "הרצל 12, רעננה",
  סוכן: "יוסי",
  משרד: "נדל\"ן רעננה",
};

describe("renderViewingReminder", () => {
  it("שותל את כל המשתנים בנוסח ברירת המחדל", () => {
    for (const text of Object.values(DEFAULT_VIEWING_REMINDER_MESSAGES)) {
      const out = renderViewingReminder(text, VARS);
      expect(out).not.toContain("{{");
      expect(out).toContain("17:30");
      expect(out).toContain("דנה");
    }
  });

  /*
   * ‎**זו הבדיקה שמונעת הרצה של קלט.** ערך ששתלנו אינו נסרק שוב,
   * אחרת שם לקוח שמכיל `{{כתובת}}` היה מדליף את כתובת הנכס לתוך
   * הודעה שנשלחת למישהו אחר.
   */
  it("ערך שנשתל אינו מתפרש שוב כמשתנה", () => {
    const out = renderViewingReminder("שלום {{שם}}", {
      ...VARS,
      שם: "{{כתובת}}",
    });
    expect(out).toBe("שלום {{כתובת}}");
  });

  it("מפתח לא מוכר נשאר גלוי ואינו נמחק בשקט", () => {
    expect(renderViewingReminder("היי {{משהו}}", VARS)).toBe("היי {{משהו}}");
  });

  it("סובלני לרווחים בתוך הסוגריים", () => {
    expect(renderViewingReminder("היי {{ שם }}", VARS)).toBe("היי דנה");
  });
});

describe("מי מקבל בצד הנכס", () => {
  /*
   * דירה מושכרת: הדלת נפתחת על ידי מי שגר שם, לא על ידי מי שמוכר.
   */
  it("נכס מושכר עם שוכר רשום — השוכר", () => {
    expect(
      viewingReminderOccupantContactId({
        occupancy: "rented",
        occupantContactId: "01SHOCHER",
        ownerContactId: "01BAALIM",
      }),
    ).toBe("01SHOCHER");
  });

  /*
   * ‎`occupancy` הוא מקור האמת. שוכר רשום על נכס שלא סומן כמושכר
   * אינו הופך אותו למושכר — הסכמה אומרת את זה במפורש, ובחירה לפי
   * קיום השדה בלבד הייתה סותרת אותה.
   */
  it("שוכר רשום בלי סימון „מושכר” — חוזרים לבעלים", () => {
    expect(
      viewingReminderOccupantContactId({
        occupancy: null,
        occupantContactId: "01SHOCHER",
        ownerContactId: "01BAALIM",
      }),
    ).toBe("01BAALIM");
  });

  it("נכס מושכר בלי שוכר רשום — הבעלים", () => {
    expect(
      viewingReminderOccupantContactId({
        occupancy: "rented",
        occupantContactId: null,
        ownerContactId: "01BAALIM",
      }),
    ).toBe("01BAALIM");
  });

  it("בלי בעלים ובלי שוכר — אין למי לשלוח", () => {
    expect(viewingReminderOccupantContactId({ occupancy: "vacant" })).toBeNull();
  });
});

describe("מתי מדלגים", () => {
  const base = { kind: "viewing", status: "scheduled", startsAt: new Date() };

  it("סיור מתוכנן — אין סיבה לדלג", () => {
    expect(viewingReminderSkipReason(base)).toBeNull();
  });

  it("פגישה שאינה סיור אינה מקבלת תזכורת סיור", () => {
    expect(viewingReminderSkipReason({ ...base, kind: "meeting" })).toBe("אינה סיור");
  });

  /*
   * תזכורת על סיור שבוטל היא הודעה שגורמת לאדם להגיע לשווא — כלומר
   * גרועה יותר מלא לשלוח כלום.
   */
  it("בוטל, לא הגיע והסתיים — כולם חוסמים", () => {
    expect(viewingReminderSkipReason({ ...base, status: "cancelled" })).not.toBeNull();
    expect(viewingReminderSkipReason({ ...base, status: "no_show" })).not.toBeNull();
    expect(viewingReminderSkipReason({ ...base, status: "completed" })).not.toBeNull();
  });
});

describe("מתי מגיע הרגע לשלוח", () => {
  const now = new Date("2026-08-27T09:00:00Z");
  const inHours = (h: number): Date => new Date(now.getTime() + h * 60 * 60 * 1000);

  it("בתוך החלון — נשלח", () => {
    expect(viewingReminderDue(inHours(4), 5, now)).toBe(true);
  });

  it("רחוק מדי — עוד לא", () => {
    expect(viewingReminderDue(inHours(6), 5, now)).toBe(false);
  });

  /*
   * ‎**סיור שנקבע ברגע האחרון מקבל תזכורת מיד.** דרישה ל„בדיוק חמש
   * שעות לפני” הייתה משאירה אותו בלי תזכורת כלל, וזה בדיוק הסיור
   * שהכי קל לשכוח.
   */
  it("סיור בעוד חצי שעה — נשלח מיד ולא נופל בין הכיסאות", () => {
    expect(viewingReminderDue(inHours(0.5), 5, now)).toBe(true);
  });

  /*
   * הסיור כבר התחיל — תזכורת „אנחנו נפגשים היום” על משהו שקורה
   * עכשיו או שכבר עבר היא רעש.
   */
  it("סיור שכבר התחיל — לא נשלח", () => {
    expect(viewingReminderDue(inHours(-0.1), 5, now)).toBe(false);
    expect(viewingReminderDue(now, 5, now)).toBe(false);
  });
});

describe("ערוצים", () => {
  it("„שניהם” כולל את שני האמצעים", () => {
    expect(viewingReminderUses("both", "email")).toBe(true);
    expect(viewingReminderUses("both", "whatsapp")).toBe(true);
  });

  it("ערוץ יחיד אינו כולל את האחר", () => {
    expect(viewingReminderUses("email", "whatsapp")).toBe(false);
    expect(viewingReminderUses("whatsapp", "email")).toBe(false);
  });

  it("לכל ערוץ יש ניסוח למסך", () => {
    expect(viewingReminderChannelLabel("both")).toContain("וואטסאפ");
    expect(viewingReminderChannelLabel("email")).toContain("מייל");
  });
});

describe("ברירת המחדל", () => {
  it("חמש שעות, כפי שהוגדר", () => {
    expect(VIEWING_REMINDER_DEFAULT_HOURS).toBe(5);
  });

  /*
   * שני נוסחים שונים ולא אחד: „מגיעים אליך” אינו „אנחנו נפגשים”.
   */
  it("לכל נמען נוסח משלו", () => {
    expect(DEFAULT_VIEWING_REMINDER_MESSAGES.occupant).not.toBe(
      DEFAULT_VIEWING_REMINDER_MESSAGES.buyer,
    );
    expect(DEFAULT_VIEWING_REMINDER_MESSAGES.occupant).toContain("מגיעים");
    expect(DEFAULT_VIEWING_REMINDER_MESSAGES.buyer).toContain("נפגשים");
  });
});

describe("„היום” נכון רק כשזה באמת היום", () => {
  const today = { date: "2026-08-27" };
  const tomorrow = { date: "2026-08-28" };

  it("אותו יום — „היום”", () => {
    expect(viewingReminderWhenLabel({ date: "2026-08-27" }, today, tomorrow)).toBe("היום");
  });

  /*
   * ‎**זה המקרה שהתקלה חיה בו.** ברירת המחדל של חמש שעות חוצה
   * חצות: סיור ב-01:00 מקבל תזכורת ב-20:00 של אתמול, ו„היום” קבוע
   * היה שולח את הלקוח ביום הלא נכון (ביקורת Codex).
   */
  it("היום שאחרי — „מחר”", () => {
    expect(viewingReminderWhenLabel({ date: "2026-08-28" }, today, tomorrow)).toBe("מחר");
  });

  /*
   * החלון ניתן להגדרה עד 48 שעות, ואז גם „מחר” אינו נכון.
   */
  it("רחוק יותר — התאריך עצמו", () => {
    expect(viewingReminderWhenLabel({ date: "2026-08-29" }, today, tomorrow)).toBe("ב-29/08");
  });

  it("נוסחי ברירת המחדל משתמשים בתווית ולא במילה קבועה", () => {
    for (const text of Object.values(DEFAULT_VIEWING_REMINDER_MESSAGES)) {
      expect(text).toContain("{{מתי}}");
      expect(text).not.toContain("היום");
    }
  });
});
