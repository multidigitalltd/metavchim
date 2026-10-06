import { describe, expect, it } from "vitest";
import { escapeHtml, firstNameOf, renderEmailHtml, renderEmailText } from "./email-template.js";

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

  it("תג מצב וכרטיס פרטים — בשתי הגרסאות, עם בריחה", () => {
    const content = {
      badge: { label: "שולם", tone: "success" as const },
      heading: "ההזמנה התקבלה",
      paragraphs: ["תודה."],
      details: [
        { label: "מדיה", value: "מגזין טאבו" },
        { label: "מוצר", value: "רבע <עמוד>" },
      ],
    };
    const html = renderEmailHtml(content);
    expect(html).toContain("שולם");
    expect(html).toContain("border-radius:999px");
    expect(html).toContain("רבע &lt;עמוד&gt;");
    expect(html).toContain("מגזין טאבו");
    const text = renderEmailText(content);
    expect(text.startsWith("[שולם]")).toBe(true);
    expect(text).toContain("מוצר: רבע <עמוד>");
  });

  it("אין תלות ב-CSS חיצוני או בגיליון סגנון", () => {
    const html = renderEmailHtml({ ...base, button: { label: "x", url: "https://a.co" } });
    expect(html).not.toContain("<style");
    expect(html).not.toContain("<link");
  });
});

/*
 * ‎**קישור ההסרה — לחיץ, ולא כתובת בטקסט** (חוק התקשורת §30א).
 *
 * ‏הוא ישב בהערת השוליים ככתובת גולמית, ובחלק מלקוחות הדואר לא היה
 * ‏לחיץ כלל — „דרך פשוטה להודיע על סירוב” שדורשת להעתיק כתובת.
 */
describe("קישור ההסרה", () => {
  const unsubscribe = {
    reason: "קיבלתם את ההודעה כי פתחתם חשבון.",
    label: "להפסקת ההודעות",
    url: "https://a.co/optout/t?x=1&y=2",
    oneClickUrl: "https://a.co/api/optout/t",
  };

  it("ב-HTML הוא קישור אמיתי לדף האישור, עם התווית", () => {
    const html = renderEmailHtml({ paragraphs: ["גוף"], unsubscribe });
    expect(html).toContain('<a href="https://a.co/optout/t?x=1&amp;y=2"');
    expect(html).toContain(">להפסקת ההודעות</a>");
    expect(html).toContain("קיבלתם את ההודעה כי פתחתם חשבון.");
    // ‏נתיב ה-POST שייך לכותרת בלבד — קישור בגוף היה מסיר בכל סריקה
    expect(html).not.toContain("https://a.co/api/optout/t");
  });

  it("בטקסט — הסיבה, התווית והכתובת", () => {
    expect(renderEmailText({ paragraphs: ["גוף"], unsubscribe })).toContain(
      "קיבלתם את ההודעה כי פתחתם חשבון. להפסקת ההודעות: https://a.co/optout/t?x=1&y=2",
    );
  });

  it("קו מפריד אחד בלבד כשיש גם הערת שוליים", () => {
    const html = renderEmailHtml({ paragraphs: ["גוף"], footnote: "הערה", unsubscribe });
    expect(html.split("border-top:1px solid").length - 1).toBe(1);
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

describe("firstNameOf", () => {
  it("‏המילה הראשונה של השם, בלי רווחים מסביב", () => {
    expect(firstNameOf("דנה כהן")).toBe("דנה");
    expect(firstNameOf("  יוסי   לוי ")).toBe("יוסי");
    expect(firstNameOf("מרים")).toBe("מרים");
  });

  it("‏שם ריק נשאר ריק — ולא „undefined” בפתיחת המייל", () => {
    expect(firstNameOf("")).toBe("");
    expect(firstNameOf("   ")).toBe("");
  });
});
