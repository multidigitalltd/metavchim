import { describe, expect, it } from "vitest";

import { renderEmailHtml, renderEmailText } from "./email-template.js";
import {
  SUPPORT_QUOTE_MAX,
  supportReplyEmail,
  supportReplySubject,
  type SupportReplyContext,
} from "./support-reply.js";

/**
 * ‎**תשובה בלי הפנייה שעליה היא עונה אינה תשובה.**
 *
 * הנוסח הקודם היה „תשובה לפנייה שלך לתמיכה” ובגוף רק מה שהתומך
 * הקליד. הבדיקות כאן נועלות את שלושת הדברים שהפכו אותו לחסר ערך:
 * מספר הפנייה, הציטוט, וההזמנה להשיב.
 */

const base: SupportReplyContext = {
  reference: 1042,
  original: "לחצתי על ייצוא ולא קרה כלום",
  openedAt: new Date("2026-03-12T09:00:00Z"),
};

describe("supportReplySubject", () => {
  it("מספר הפנייה ראשון — הוא מה שנחתך אחרון בנייד", () => {
    expect(supportReplySubject(base)).toBe("[#1042] Re: תשובה מהתמיכה");
  });

  it("נושא קיים נשמר, עם המספר לפניו", () => {
    expect(supportReplySubject({ ...base, subject: "בעיה בייצוא" })).toBe(
      "[#1042] Re: בעיה בייצוא",
    );
  });

  /*
   * שרשור שכבר עבר סבב נושא „Re:”. בלי ההסרה מצטבר „Re: Re: Re:”,
   * וזה מה שדוחף את הנושא עצמו אל מחוץ לתצוגה המקדימה.
   */
  it("‏Re: אינו מצטבר", () => {
    expect(supportReplySubject({ ...base, subject: "Re: בעיה בייצוא" })).toBe(
      "[#1042] Re: בעיה בייצוא",
    );
  });

  it("הנושא נחתך ל-200 תווים", () => {
    expect(supportReplySubject({ ...base, subject: "א".repeat(400) }).length).toBe(200);
  });
});

describe("supportReplyEmail", () => {
  it("הפנייה המקורית מצוטטת, עם מספר הפנייה ותאריך הפתיחה", () => {
    const mail = supportReplyEmail({ body: "תוקן, נסו שוב", context: base });
    expect(mail.quote?.body).toBe("לחצתי על ייצוא ולא קרה כלום");
    expect(mail.quote?.title).toContain("12 במרץ 2026");
    expect(mail.quote?.meta).toContain("פנייה #1042");
  });

  it("סוג הפנייה והמסך נכנסים להקשר כשהם ידועים", () => {
    const mail = supportReplyEmail({
      body: "תוקן",
      context: { ...base, kind: "bug", screen: "/properties" },
    });
    expect(mail.quote?.meta).toContain("תקלה");
    expect(mail.quote?.meta).toContain("מסך: /properties");
  });

  /*
   * ‎`paragraphs` היא רשימת פסקאות ולא טקסט חופשי: פסקה ריקה
   * מרנדרת `<p></p>`, שנראה כרווח תקוע באמצע ההודעה.
   */
  it("שורות ריקות בטקסט של התומך אינן הופכות לפסקאות ריקות", () => {
    const mail = supportReplyEmail({ body: "שורה\n\n\nשורה שנייה", context: base });
    expect(mail.paragraphs).toEqual(["שורה", "שורה שנייה"]);
  });

  it("תשובה שהיא קבצים בלבד עדיין מייצרת גוף", () => {
    expect(supportReplyEmail({ body: "   ", context: base }).paragraphs).toEqual(["מצורף:"]);
  });

  /*
   * „אין צורך להשיב” היה מכבה את ה-Reply-To שנבנה בדיוק כדי
   * שהתשובה תחזור לאותה פנייה.
   */
  it("הערת השוליים מזמינה להשיב, ונוקבת במספר", () => {
    const mail = supportReplyEmail({ body: "תוקן", context: base });
    expect(mail.footnote).toContain("אפשר להשיב");
    expect(mail.footnote).toContain("#1042");
  });

  it("פנייה ארוכה נחתכת ולא קוברת את התשובה", () => {
    const mail = supportReplyEmail({
      body: "תוקן",
      context: { ...base, original: "א".repeat(SUPPORT_QUOTE_MAX + 500) },
    });
    expect(mail.quote?.body.length).toBe(SUPPORT_QUOTE_MAX + 1);
    expect(mail.quote?.body.endsWith("…")).toBe(true);
  });

  it("בלי טקסט מקורי אין גוש ציטוט ריק", () => {
    expect(supportReplyEmail({ body: "תוקן", context: { ...base, original: "  " } }).quote).toBe(
      undefined,
    );
  });
});

describe("הציטוט מגיע לשתי הגרסאות של הגוף", () => {
  const mail = supportReplyEmail({ body: "תוקן", context: { ...base, kind: "bug" } });

  it("בטקסט — כל שורה מסומנת ב-‎>", () => {
    const text = renderEmailText(mail);
    expect(text).toContain("> לחצתי על ייצוא ולא קרה כלום");
    expect(text).toContain("> פנייה #1042");
  });

  it("ב-HTML — בגוש נפרד, והתוכן מוברח", () => {
    const html = renderEmailHtml(
      supportReplyEmail({ body: "תוקן", context: { ...base, original: "<script>x</script>" } }),
    );
    expect(html).toContain("border-right:3px solid");
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
