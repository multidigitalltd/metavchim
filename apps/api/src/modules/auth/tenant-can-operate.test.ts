import { describe, expect, it } from "vitest";
import { tenantCanOperate, tenantPeriodEnded, tenantSuspended } from "./auth.service";

/**
 * שער ההרשאה של המשרד.
 *
 * הבדיקות כאן קיימות כי אותה תקלה חזרה פעמיים במבנה זהה: תפוגה
 * שנשמרת בטבלה אחת ונאכפת בטבלה אחרת — או לא נאכפת בכלל. פעם עם
 * תקופת הניסיון, ופעם עם המנוי בתשלום (ביקורת Codex על שתיהן).
 */

const future = new Date(Date.now() + 86_400_000);
const past = new Date(Date.now() - 86_400_000);

describe("tenantCanOperate — סטטוס", () => {
  it("משרד פעיל עובד", () => {
    expect(tenantCanOperate({ status: "active" })).toBe(true);
  });

  it("משרד מושהה אינו עובד", () => {
    expect(tenantCanOperate({ status: "suspended" })).toBe(false);
    expect(tenantCanOperate({ status: "closed" })).toBe(false);
  });
});

describe("tenantCanOperate — ניסיון", () => {
  it("בתוך התקופה", () => {
    expect(tenantCanOperate({ status: "trial", trialEndsAt: future })).toBe(true);
  });

  it("אחרי התפוגה נחסם", () => {
    expect(tenantCanOperate({ status: "trial", trialEndsAt: past })).toBe(false);
  });

  it("ניסיון בלי תאריך אינו נחסם", () => {
    expect(tenantCanOperate({ status: "trial", trialEndsAt: null })).toBe(true);
  });
});

describe("tenantCanOperate — מנוי בתשלום", () => {
  it("בתוך התקופה ששולמה", () => {
    expect(tenantCanOperate({ status: "active", paidUntil: future })).toBe(true);
  });

  it("אחרי שהתקופה נגמרה נחסם — בלי תלות בסורק כלשהו", () => {
    // זו כל הנקודה: תשלום אחד לא קונה גישה לנצח
    expect(tenantCanOperate({ status: "active", paidUntil: past })).toBe(false);
  });

  it("משרד שהוקם ידנית, בלי תאריך תשלום, עובד", () => {
    // null = בלי תפוגה, ולא "לא שילם"
    expect(tenantCanOperate({ status: "active", paidUntil: null })).toBe(true);
    expect(tenantCanOperate({ status: "active" })).toBe(true);
  });

  it("תפוגת תשלום אינה נבדקת על משרד בניסיון", () => {
    // משרד בניסיון עדיין לא שילם; paidUntl ישן משדרוג שבוטל לא אמור
    // לנעול אותו במקום כלל הניסיון
    expect(tenantCanOperate({ status: "trial", trialEndsAt: future, paidUntil: past })).toBe(true);
  });

  it("שתי התפוגות יחד — הרלוונטית לסטטוס היא שקובעת", () => {
    expect(tenantCanOperate({ status: "active", trialEndsAt: past, paidUntil: future })).toBe(true);
  });
});

describe("השהיה ותפוגה אינן אותו דבר", () => {
  it("ניסיון שפג אינו מושהה — הוא חייב להצליח להתחבר", () => {
    // זו כל הנקודה: נעילה בהתחברות הייתה חוסמת אותו מחוץ למסך המנוי,
    // כלומר הופכת כל ניסיון שפג ללקוח אבוד
    const tenant = { status: "trial", trialEndsAt: past };
    expect(tenantSuspended(tenant)).toBe(false);
    expect(tenantPeriodEnded(tenant)).toBe(true);
    expect(tenantCanOperate(tenant)).toBe(false);
  });

  it("מנוי שהסתיים אינו מושהה", () => {
    const tenant = { status: "active", paidUntil: past };
    expect(tenantSuspended(tenant)).toBe(false);
    expect(tenantPeriodEnded(tenant)).toBe(true);
  });

  it("משרד מושהה מושהה, ותפוגה אינה רלוונטית לו", () => {
    // סטטוס שאינו active/trial חוסם התחברות לגמרי; אין טעם לבדוק
    // תאריכים על משרד שבעל הפלטפורמה סגר
    const tenant = { status: "suspended", paidUntil: future };
    expect(tenantSuspended(tenant)).toBe(true);
    expect(tenantPeriodEnded(tenant)).toBe(false);
  });

  it("משרד תקין אינו אף אחד מהשניים", () => {
    expect(tenantSuspended({ status: "active", paidUntil: future })).toBe(false);
    expect(tenantPeriodEnded({ status: "active", paidUntil: future })).toBe(false);
  });
});

/*
 * מסלול חינמי הוא לתמיד.
 *
 * זו לא הקלה אלא תיקון: „חינם = בלי תפוגה” הוכרע פעם אחת בהרשמה
 * ונכתב לשורה כתאריך, ולכן כל דרך אחרת להגיע למסלול חינמי — שיוך
 * מהפלטפורמה, מסלול שנערך והפך לחינמי — הותירה תאריך שפג אחרי 14
 * יום וסגר חשבון שאינו אמור להיסגר (דיווח המשתמש).
 */
describe("tenantCanOperate — מסלול חינמי", () => {
  it("ניסיון שפג אינו סוגר חשבון חינמי", () => {
    const tenant = { status: "trial", trialEndsAt: past, planIsFree: true };
    expect(tenantPeriodEnded(tenant)).toBe(false);
    expect(tenantCanOperate(tenant)).toBe(true);
  });

  it("גם תקופה ששולמה והסתיימה אינה סוגרת אותו", () => {
    const tenant = { status: "active", paidUntil: past, planIsFree: true };
    expect(tenantPeriodEnded(tenant)).toBe(false);
    expect(tenantCanOperate(tenant)).toBe(true);
  });

  it("השהיה מהפלטפורמה חזקה מהמסלול — היא אינה עניין של חיוב", () => {
    const tenant = { status: "suspended", planIsFree: true };
    expect(tenantSuspended(tenant)).toBe(true);
    expect(tenantCanOperate(tenant)).toBe(false);
  });

  it("מסלול שאינו חינמי ממשיך לפוג כרגיל", () => {
    expect(tenantPeriodEnded({ status: "trial", trialEndsAt: past, planIsFree: false })).toBe(true);
    // שדה חסר אינו „חינמי” — ברירת המחדל היא ההתנהגות הקיימת
    expect(tenantPeriodEnded({ status: "trial", trialEndsAt: past })).toBe(true);
  });
});
