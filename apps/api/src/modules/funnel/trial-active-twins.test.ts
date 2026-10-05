import { describe, expect, it } from "vitest";
import {
  isTenantSubscribed,
  isTrialActive,
  trialActiveWhere,
} from "./funnel-enrollment.service";

/**
 * ‎**„הניסיון חי” — שתי צורות, כלל אחד.**
 *
 * ‏שאילתה אינה יכולה לקרוא לפונקציה, ושורה שכבר בידי אינה צריכה
 * ‏שאילתה; לכן שתי הצורות נחוצות. שני **כללים** אינם נחוצים, וזו
 * ‏בדיוק הפרידה שכבר קרתה כאן פעמיים: פעם `trialEndsAt: { not:
 * ‏null }` מול `> now`, ופעם `closePage` שחישב מהתאריך בלבד בזמן
 * ‏שהשאילתה דרשה גם `status` (ביקורת Codex, P2, שני סבבים).
 *
 * ‏שתיהן מיוצאות אך ורק בשביל הטבלה הזו. בדיקה מבנית על המקור
 * ‏הייתה מוכיחה ששני הביטויים **קיימים**, לא שהם מסכימים.
 */

const NOW = new Date("2026-09-06T12:00:00Z");
const FUTURE = new Date("2026-09-20T12:00:00Z");
const PAST = new Date("2026-08-20T12:00:00Z");

/** ‏האם השורה עוברת את תנאי ה-`where` שנבנה. */
function passesWhere(row: { status: string; trialEndsAt: Date | null }): boolean {
  const where = trialActiveWhere(NOW);
  if (row.status !== where.status) return false;
  return row.trialEndsAt !== null && row.trialEndsAt.getTime() > where.trialEndsAt.gt.getTime();
}

const ROWS: { status: string; trialEndsAt: Date | null; live: boolean; label: string }[] = [
  { status: "trial", trialEndsAt: FUTURE, live: true, label: "בניסיון, התאריך לפנינו" },
  { status: "trial", trialEndsAt: PAST, live: false, label: "בניסיון, התאריך עבר" },
  { status: "trial", trialEndsAt: null, live: false, label: "בניסיון בלי תפוגה — הוקם ידנית" },
  /*
   * ‏זו השורה שהפרידה נולדה עליה: משרד ששילם בזמן שהיה מסומן
   * ‏`trial` שומר את התאריך המקורי גם אחרי שהפך ל-`active`. הצורה
   * ‏שמסתכלת על התאריך לבדו קוראת לו „עדיין בניסיון”.
   */
  { status: "active", trialEndsAt: FUTURE, live: false, label: "שילם, והתאריך הישן עדיין עתידי" },
  { status: "suspended", trialEndsAt: FUTURE, live: false, label: "מושהה עם תאריך עתידי" },
  { status: "active", trialEndsAt: null, live: false, label: "לקוח משלם רגיל" },
];

describe("‏שתי הצורות של „הניסיון חי” מסכימות", () => {
  for (const row of ROWS) {
    it(row.label, () => {
      expect(isTrialActive(row, NOW), "הפונקציה").toBe(row.live);
      expect(passesWhere(row), "השאילתה").toBe(row.live);
    });
  }

  /*
   * ‏שני פיקוחים, ובלעדיהם הטבלה יכולה להיות ירוקה על „הכול פסול”
   * ‏או „הכול מותר”.
   */
  it("יש בטבלה מקרה חי ומקרה פסול", () => {
    expect(ROWS.some((row) => row.live)).toBe(true);
    expect(ROWS.some((row) => !row.live)).toBe(true);
  });

  /*
   * ‏והפיקוח שמכוון בדיוק אל הבאג: תאריך עתידי לבדו אינו מספיק.
   * ‏בלעדיו „התאריך לפנינו” היה עובר בשתי הצורות והטבלה לא הייתה
   * ‏מבדילה ביניהן כלל.
   */
  it("יש בטבלה שורה עם תאריך עתידי שאינה חיה", () => {
    expect(
      ROWS.some((row) => !row.live && row.trialEndsAt !== null && row.trialEndsAt > NOW),
    ).toBe(true);
  });
});

/**
 * ‎**„הפעיל מנוי” — הקצה השני של אותו שדה.**
 *
 * ‏שלוש כתיבות משאירות משרד ב-`status: "active"`, ורק שתיים מהן
 * ‏הן המרה. הטבלה כאן היא הכתיבות עצמן, כפי שהן נראות בשורה אחרי
 * ‏שהן רצו — כי הכלל נקרא מהשורה, לא מהקוד שכתב אותה.
 */
const WRITES: { status: string; paidUntil: Date | null; subscribed: boolean; label: string }[] = [
  { status: "trial", paidUntil: null, subscribed: false, label: "בניסיון — לפני הכול" },
  {
    status: "active",
    paidUntil: FUTURE,
    subscribed: true,
    label: "‏רכישה רגילה — `activateWithin` עם כרטיס",
  },
  /* ‏הממצא: אותה כתיבה בדיוק, אבל `card: null` */
  {
    status: "active",
    paidUntil: FUTURE,
    subscribed: true,
    label: "‏קופון של 100%‎ — אותה כתיבה בלי כרטיס",
  },
  /* ‏וההכרעה שאסור לדרוס: משרד חינמי נשאר במסלול ומקבל את שלבי התוכן */
  {
    status: "active",
    paidUntil: null,
    subscribed: false,
    label: "‏שיוך למסלול חינמי — פעיל, בלי תקופה בתשלום",
  },
  /* ‏הענקה ידנית: התקופה נכתבת, אבל הסטטוס נשאר „ניסיון” */
  {
    status: "trial",
    paidUntil: FUTURE,
    subscribed: false,
    label: "‏הענקת תקופה ידנית — הסטטוס נשאר „ניסיון”",
  },
  { status: "suspended", paidUntil: FUTURE, subscribed: false, label: "מושהה" },
];

describe("‏„הפעיל מנוי” — שני השדות, ולא אחד", () => {
  for (const row of WRITES) {
    it(row.label, () => {
      expect(isTenantSubscribed(row)).toBe(row.subscribed);
    });
  }

  /* ‏שני פיקוחים, כדי שהטבלה לא תהיה ירוקה על „תמיד” או „לעולם”. */
  it("יש בטבלה מנוי שהופעל ומנוי שלא", () => {
    expect(WRITES.some((row) => row.subscribed)).toBe(true);
    expect(WRITES.some((row) => !row.subscribed)).toBe(true);
  });

  /*
   * ‏והפיקוח שמכוון אל שני חצאי השער: לכל שדה יש בטבלה שורה
   * ‏שבה **רק הוא** מתקיים ואינה נחשבת מנוי. בלעדיהן חצי מהשער
   * ‏היה יכול להימחק והטבלה הייתה נשארת ירוקה.
   */
  it("יש שורה פעילה בלי תקופה, ושורה עם תקופה שאינה פעילה", () => {
    expect(
      WRITES.some((row) => !row.subscribed && row.status === "active"),
      "פעיל בלי תקופה בתשלום",
    ).toBe(true);
    expect(
      WRITES.some((row) => !row.subscribed && row.paidUntil !== null),
      "תקופה בתשלום בלי סטטוס פעיל",
    ).toBe(true);
  });

  /*
   * ‎**וההנחה שהכלל של הסגירה נשען עליה.**
   *
   * ‏`funnelExitReason` סוגר על „כרטיס **או** מנוי”, ו-`reopenRows`
   * ‏שואל על הכרטיס בלבד. שני הכללים אינם יכולים לסתור זה את זה רק
   * ‏משום ש„בניסיון חי” ו„הפעיל מנוי” אינם יכולים להתקיים יחד —
   * ‏הנחה שנכתבה שם בהערה, ונבדקת כאן.
   */
  it("‏„ניסיון חי” ו„מנוי שהופעל” אינם יכולים להתקיים יחד", () => {
    for (const status of ["trial", "active", "suspended", "churned"]) {
      for (const trialEndsAt of [FUTURE, PAST, null]) {
        for (const paidUntil of [FUTURE, PAST, null]) {
          const row = { status, trialEndsAt, paidUntil };
          expect(
            isTrialActive(row, NOW) && isTenantSubscribed(row),
            `${status} / ${String(trialEndsAt)} / ${String(paidUntil)}`,
          ).toBe(false);
        }
      }
    }
  });
});
