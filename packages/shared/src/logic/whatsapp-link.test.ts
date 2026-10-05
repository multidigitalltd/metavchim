import { describe, expect, it } from "vitest";
import { canReceiveWhatsapp, normalizePhoneForWhatsapp, phoneFromWaId, whatsappLink } from "./whatsapp-link.js";

describe("normalizePhoneForWhatsapp", () => {
  it("מספר ישראלי מקומי מקבל קידומת — 0 בהתחלה שובר את הקישור", () => {
    expect(normalizePhoneForWhatsapp("050-123-4567")).toBe("972501234567");
  });

  it("מספר שכבר בינלאומי אינו משוכפל", () => {
    expect(normalizePhoneForWhatsapp("+972-50-1234567")).toBe("972501234567");
  });

  it("חיוג בינלאומי ישן (00) מקוצר", () => {
    expect(normalizePhoneForWhatsapp("00972501234567")).toBe("972501234567");
  });

  it("מספר ישראלי בלי אפס מוביל", () => {
    expect(normalizePhoneForWhatsapp("50-1234567")).toBe("972501234567");
  });

  it("מספר זר נשאר כפי שהוא — לא ממציאים לו קידומת ישראלית", () => {
    // רוכש תושב חוץ הוא לקוח נפוץ; הפיכת מספר בריטי לישראלי שולחת
    // את ההודעה לאדם אחר לגמרי
    expect(normalizePhoneForWhatsapp("+44 7700 900123")).toBe("447700900123");
  });

  it("ריק נשאר ריק", () => {
    expect(normalizePhoneForWhatsapp("")).toBe("");
  });
});

describe("whatsappLink", () => {
  it("ההודעה מקודדת — עברית ושורות חדשות שוברות כתובת", () => {
    const url = whatsappLink("050-1234567", "שלום\nהסכם");
    expect(url.startsWith("https://wa.me/972501234567?text=")).toBe(true);
    expect(url).not.toContain("\n");
    expect(url).not.toContain(" ");
  });
});

describe("canReceiveWhatsapp", () => {
  it("נייד ישראלי — כן", () => {
    expect(canReceiveWhatsapp("+972501234567")).toBe(true);
    expect(canReceiveWhatsapp("0501234567")).toBe(true);
    expect(canReceiveWhatsapp("054-123-4567")).toBe(true);
  });

  /*
   * ‏קו נייח עובר את `ISRAELI_PHONE` — שיחה נכנסת ממנו היא שיחה
   * לכל דבר — אבל הודעה אליו אינה מגיעה לאיש, ו-Meta אינה אומרת
   * זאת. „נשלח” על הודעה שאיש לא קיבל גרוע מלא לשלוח.
   */
  it("קו נייח — לא", () => {
    expect(canReceiveWhatsapp("+97236543210")).toBe(false);
    expect(canReceiveWhatsapp("026543210")).toBe(false);
  });

  it("מספר מחו״ל עם קידומת מדינה — כן; ריק או קצר — לא", () => {
    expect(canReceiveWhatsapp("+14155550100")).toBe(true);
    expect(canReceiveWhatsapp("0044 7700 900123")).toBe(true);
    expect(canReceiveWhatsapp("")).toBe(false);
    expect(canReceiveWhatsapp("+1 555")).toBe(false);
  });
});

describe("phoneFromWaId", () => {
  it("מזהה ישראלי — ‎+972‎", () => {
    expect(phoneFromWaId("972501234567")).toBe("+972501234567");
  });

  /* ‏Meta שולחת קידומת מדינה בלי „+” — גם ללקוח מחו״ל (ביקורת Codex, P1) */
  it("מזהה מחו״ל נשאר עם קידומת המדינה שלו", () => {
    expect(phoneFromWaId("14155550100")).toBe("+14155550100");
    expect(phoneFromWaId("447700900123")).toBe("+447700900123");
  });

  it("צורה מקומית מפנקס הכתובות — כמו בכל המערכת", () => {
    expect(phoneFromWaId("050-123-4567")).toBe("+972501234567");
    expect(phoneFromWaId("+44 7700 900123")).toBe("+447700900123");
  });
});

describe("normalizePhoneForWhatsapp — מספר מחו״ל", () => {
  it("‎+‎ בהתחלה נשאר בינלאומי, גם באורך של מספר ישראלי בלי 0", () => {
    expect(normalizePhoneForWhatsapp("+687123456")).toBe("687123456");
    expect(normalizePhoneForWhatsapp("+14155550100")).toBe("14155550100");
  });
});
