import { describe, expect, it } from "vitest";
import { normalizePhoneForWhatsapp, whatsappLink } from "./whatsapp-link.js";

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
