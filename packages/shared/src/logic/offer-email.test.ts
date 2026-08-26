import { describe, expect, it } from "vitest";
import { renderEmailHtml, renderEmailText } from "./email-template.js";
import {
  AUTO_OFFER_MAX_PER_EMAIL,
  AUTO_OFFER_MIN_SCORE,
  buildOfferEmail,
  offerEmailLineLabel,
} from "./offer-email.js";

describe("offerEmailLineLabel", () => {
  it("מצרף מחיר בפורמט ישראלי — באגורות נכנס, בשקלים יוצא", () => {
    expect(
      offerEmailLineLabel({
        title: "דירת 4 חדרים בחיפה",
        priceAgorot: 265_000_000,
        url: "https://x",
      }),
    ).toBe("דירת 4 חדרים בחיפה — ‏2,650,000 ₪");
  });

  it("נכס בלי מחיר — הכותרת לבדה, בלי „0 ₪”", () => {
    expect(offerEmailLineLabel({ title: "דירה", url: "https://x" })).toBe("דירה");
  });
});

describe("buildOfferEmail", () => {
  const base = {
    officeName: "נדל\"ן הצפון",
    buyerName: "דנה",
    optOutUrl: "https://app.example/offer-optout/tok",
  };

  it("הצעה אחת — יחיד; כמה — רבים עם המניין", () => {
    const one = buildOfferEmail({
      ...base,
      offers: [{ title: "דירה", url: "https://a" }],
    });
    expect(one.subject).toContain("נכס חדש");
    expect(one.subject).toContain("נדל\"ן הצפון");

    const three = buildOfferEmail({
      ...base,
      offers: [
        { title: "א", url: "https://a" },
        { title: "ב", url: "https://b" },
        { title: "ג", url: "https://c" },
      ],
    });
    expect(three.subject).toContain("3 נכסים חדשים");
  });

  it("ההודעה מדברת בשם המשרד וכוללת קישור הסרה — חוק הספאם", () => {
    const { content } = buildOfferEmail({
      ...base,
      offers: [{ title: "דירה", url: "https://a" }],
    });
    expect(content.footnote).toContain("נדל\"ן הצפון");
    expect(content.footnote).toContain(base.optOutUrl);
    expect(content.greeting).toBe("שלום דנה,");
  });

  it("בלי שם לקוח — בלי שורת ברכה, לא „שלום ,”", () => {
    const { content } = buildOfferEmail({
      ...base,
      buyerName: "",
      offers: [{ title: "דירה", url: "https://a" }],
    });
    expect(content.greeting).toBeUndefined();
  });

  it("עובר את התבנית המשותפת: הקישורים מופיעים ב-HTML ובטקסט", () => {
    const { content } = buildOfferEmail({
      ...base,
      offers: [
        { title: "דירת 3 חדרים", priceAgorot: 180_000_000, url: "https://app.example/o/abc" },
        { title: "דירת גן", url: "https://app.example/o/def" },
      ],
    });
    const html = renderEmailHtml(content);
    const text = renderEmailText(content);
    for (const rendered of [html, text]) {
      expect(rendered).toContain("https://app.example/o/abc");
      expect(rendered).toContain("https://app.example/o/def");
      expect(rendered).toContain("דירת גן");
    }
    // המחיר מעוצב גם בגרסת הטקסט — היא זו שאיש אינו בודק
    expect(text).toContain("1,800,000 ₪");
  });

  it("הספים מוסכמים: שליחה אוטומטית רק מהתאמה מומלצת, עד 5 במייל", () => {
    // מסמך חי — שינוי מודע לספים חייב לעבור כאן
    expect(AUTO_OFFER_MIN_SCORE).toBe(85);
    expect(AUTO_OFFER_MAX_PER_EMAIL).toBe(5);
  });
});
