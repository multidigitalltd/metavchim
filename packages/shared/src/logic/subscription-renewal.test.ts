import { describe, expect, it } from "vitest";
import {
  RENEW_BUTTON_TITLE,
  renewalBlockedText,
  renewalLinkText,
  subscriptionEndedText,
  subscriptionStatusText,
} from "./subscription-renewal";
import { WA_BUTTON_TITLE_MAX } from "./whatsapp-buttons";

/**
 * ‎**מה שנבדק כאן הוא שההודעה לא מפנה למקום אחר.**
 *
 * הכשל שהוליד את הקובץ: משרד שתקופתו נגמרה קיבל בוואטסאפ „חדשו
 * במסך ניהול המשרד” — הפניה שדורשת מחשב, ידיעה איזה מסך, וזיכרון.
 * הבדיקות כאן מקבעות את ההפך: לכל מצב יש **פעולה** בהודעה עצמה,
 * או שם של מי שיכול לעשות אותה.
 */

describe("subscriptionEndedText", () => {
  /*
   * ‎**הכפתור אינו מוצע למי שילחץ ויידחה.** `billing.manage` הוא
   * היכולת שפותחת תשלום; בלעדיה כפתור הוא הבטחה שנשברת בלחיצה.
   */
  it("מי שרשאי לשלם — מקבל דרך פעולה בהודעה עצמה", () => {
    const text = subscriptionEndedText({ mayPay: true });
    expect(text).toContain(RENEW_BUTTON_TITLE);
    expect(text).not.toContain("מסך ניהול המשרד");
  });

  it("מי שאינו רשאי — מקבל את מי שכן, ולא כפתור שייכשל", () => {
    const text = subscriptionEndedText({ mayPay: false });
    expect(text).not.toContain(RENEW_BUTTON_TITLE);
    expect(text).toContain("מנהל את החיוב");
  });

  /*
   * שתי הצורות אומרות את אותה עובדה מסחרית. מי שקורא את שתיהן
   * (בעלים וסוכן באותו משרד) אמור להבין שמדובר באותו דבר.
   */
  it("שתיהן אומרות שהמנוי הסתיים, ושהחזרה מיידית", () => {
    for (const mayPay of [true, false]) {
      const text = subscriptionEndedText({ mayPay });
      expect(text).toContain("הסתיימה");
      expect(text).toContain("מיד");
    }
  });
});

describe("RENEW_BUTTON_TITLE", () => {
  /*
   * ‎**כותרת ארוכה מהתקרה מפילה את ההודעה כולה אצל Meta** — כלומר
   * המשרד שתקופתו נגמרה לא מקבל שום דבר, וזה בדיוק המשרד שאסור
   * לאבד. התקרה מיובאת ולא נכתבת שוב.
   */
  it("נכנסת בתקרת הכותרת של Meta", () => {
    expect(RENEW_BUTTON_TITLE.length).toBeLessThanOrEqual(WA_BUTTON_TITLE_MAX);
    expect(RENEW_BUTTON_TITLE.trim()).toBe(RENEW_BUTTON_TITLE);
  });
});

describe("renewalLinkText", () => {
  /*
   * ‎**סכום לפני קישור.** „לחץ כאן לתשלום” בלי לומר על מה ובכמה
   * הוא בדיוק מה שאדם זהיר אינו לוחץ עליו — ובצדק.
   */
  it("אומר מה נרכש ובכמה, ורק אז את הקישור", () => {
    const text = renewalLinkText({
      url: "https://pay.example/abc",
      planName: "מקצועי",
      price: '299 ₪ לחודש + מע"מ',
      cycle: "monthly",
    });
    expect(text.indexOf("299")).toBeLessThan(text.indexOf("https://pay.example/abc"));
    expect(text).toContain("מקצועי");
    expect(text).toContain("חודשי");
  });

  it("בלי מחיר ידוע — הקישור עדיין שלם, בלי שורה ריקה במקום הסכום", () => {
    const text = renewalLinkText({
      url: "https://pay.example/abc",
      planName: "מקצועי",
      price: null,
      cycle: "yearly",
    });
    expect(text).toContain("https://pay.example/abc");
    expect(text).not.toMatch(/\n\n\n/u);
    expect(text).toContain("שנתי");
  });
});

describe("renewalBlockedText", () => {
  /*
   * הסיבה מגיעה מ-`checkoutRejectionReason` ואינה מנוסחת כאן
   * מחדש; מה שנוסף הוא לאן ללכת איתה.
   */
  it("נושא את הסיבה ואת הצעד הבא", () => {
    const text = renewalBlockedText("המסלול אינו נמכר באופן עצמאי — פנו אלינו");
    expect(text).toContain("אינו נמכר באופן עצמאי");
    expect(text).toContain("תמיכה");
  });
});

describe("subscriptionStatusText", () => {
  it("מסלול, מחזור, מחיר והמצב — והמצב מגיע כפי שהוא", () => {
    const text = subscriptionStatusText({
      statusLine: "מנוי פעיל — מתחדש בעוד 12 ימים",
      planName: "מקצועי",
      cycle: "monthly",
      price: '299 ₪ לחודש + מע"מ',
      mayPay: true,
    });
    expect(text).toContain("מנוי פעיל — מתחדש בעוד 12 ימים");
    expect(text).toContain("מקצועי");
    expect(text).toContain("299");
    expect(text).toContain("תחדש את המנוי");
  });

  /*
   * מי שאינו רשאי לשלם רואה את המצב ואינו מקבל הזמנה לפעולה
   * שתיעצר — אותו כלל של `subscriptionEndedText`.
   */
  it("בלי הרשאת חיוב — מידע בלבד, בלי הצעה לחדש", () => {
    const text = subscriptionStatusText({
      statusLine: "מנוי פעיל",
      planName: "מקצועי",
      cycle: "monthly",
      price: null,
      mayPay: false,
    });
    expect(text).toContain("מנוי פעיל");
    expect(text).not.toContain("תחדש את המנוי");
  });
});
