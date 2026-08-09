import { describe, expect, it } from "vitest";
import { escapeHtml, renderEmailHtml, renderEmailText } from "./email-template.js";

const base = { paragraphs: ["שורה ראשונה", "שורה שנייה"] };

describe("escapeHtml", () => {
  it("מנטרל את התווים שמייצרים מבנה", () => {
    expect(escapeHtml('<b>"x"</b>')).toBe("&lt;b&gt;&quot;x&quot;&lt;/b&gt;");
  });

  it("האמפרסנד ראשון — אחרת הבריחות עצמן נשברות", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });
});

describe("renderEmailHtml", () => {
  it("הכיוון מוצהר על המסמך ועל הגוף", () => {
    const html = renderEmailHtml(base);
    expect(html).toContain('<html dir="rtl" lang="he">');
    expect(html).toContain('<body dir="rtl"');
    expect(html).toContain("text-align:right");
  });

  it("רספונסיבי: רוחב מלא עם תקרה, ו-viewport", () => {
    const html = renderEmailHtml(base);
    expect(html).toContain('name="viewport"');
    expect(html).toContain("width:100%;max-width:600px");
  });

  it("שם המשתמש עובר בריחה — הוא קלט של אדם", () => {
    // שם עם סוגר זווית היה שובר את המבנה; ממוקד יותר היה מזריק קישור
    const html = renderEmailHtml({ ...base, greeting: 'שלום <img src=x onerror="1">' });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("כפתור נבנה כטבלה — ריפוד על עוגן נופל ב-Outlook", () => {
    const html = renderEmailHtml({ ...base, button: { label: "כניסה", url: "https://a.co/x" } });
    expect(html).toContain('<table role="presentation"');
    expect(html).toContain('href="https://a.co/x"');
    // הכתובת גם כטקסט, ללקוחות שחוסמים כפתורים
    expect(html).toContain('<span dir="ltr">https://a.co/x</span>');
  });

  it("כתובת שאינה http נזרקת — javascript: בקישור הוא פישינג", () => {
    const html = renderEmailHtml({
      ...base,
      button: { label: "לחץ", url: "javascript:alert(1)" },
    });
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("לחץ");
  });

  it("קוד אימות מוצג ב-LTR — ספרות בפסקה עברית מתהפכות", () => {
    const html = renderEmailHtml({ ...base, code: "048213" });
    expect(html).toContain("direction:ltr");
    expect(html).toContain("048213");
  });

  it("אין תלות ב-CSS חיצוני או בגיליון סגנון", () => {
    const html = renderEmailHtml({ ...base, button: { label: "x", url: "https://a.co" } });
    expect(html).not.toContain("<style");
    expect(html).not.toContain("<link");
  });
});

describe("renderEmailText", () => {
  it("נגזר מאותו תוכן ולא נכתב בנפרד", () => {
    const content = {
      greeting: "שלום דנה,",
      paragraphs: ["פסקה א", "פסקה ב"],
      button: { label: "לאיפוס", url: "https://a.co/r" },
      footnote: "אם לא ביקשת — התעלם",
    };
    const text = renderEmailText(content);
    expect(text).toContain("שלום דנה,");
    expect(text).toContain("פסקה א");
    expect(text).toContain("פסקה ב");
    expect(text).toContain("לאיפוס: https://a.co/r");
    expect(text).toContain("אם לא ביקשת — התעלם");
  });

  it("אין בו בריחות HTML — הוא נקרא כטקסט", () => {
    expect(renderEmailText({ paragraphs: ['משרד "אלפא" & שות׳'] })).toContain(
      'משרד "אלפא" & שות׳',
    );
  });

  it("הקוד נכלל גם בטקסט", () => {
    expect(renderEmailText({ paragraphs: [], code: "123456" })).toContain("123456");
  });

  it("בלי רווחים מיותרים בסוף", () => {
    expect(renderEmailText(base).endsWith("\n")).toBe(false);
  });
});
