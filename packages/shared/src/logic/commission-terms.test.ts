import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMMISSION_SPLIT,
  MAX_COMMISSION_SHARE,
  MIN_COMMISSION_SHARE,
} from "./collaboration-cost.js";
import {
  COMMISSION_SIDES,
  OTHER_SPLIT_MAX_NOTE,
  commissionSideRejectionReason,
  commissionTermsColumns,
  commissionTermsFromRow,
  commissionTermsRejectionReason,
  defaultCommissionTerms,
  describeCommissionSide,
  describeCommissionTerms,
  headlineCommissionSplit,
  normalizeCommissionSide,
  otherTerms,
  publisherSideOf,
  splitTerms,
  uniformTerms,
} from "./commission-terms.js";

describe("normalizeCommissionSide", () => {
  it("אחוז מוחק ניסוח שנשאר מ„אחר”", () => {
    expect(normalizeCommissionSide({ split: 60, note: "כל צד גובה מהלקוח שלו" })).toEqual({
      split: 60,
      note: null,
    });
  });

  it("„אחר” חותך רווחים", () => {
    expect(normalizeCommissionSide({ split: null, note: "  חצי מעל 1.5%  " })).toEqual({
      split: null,
      note: "חצי מעל 1.5%",
    });
  });

  it("„אחר” בלי ניסוח נשאר ריק ולא הופך לאחוז", () => {
    expect(normalizeCommissionSide({ split: null, note: null })).toEqual({
      split: null,
      note: "",
    });
  });
});

describe("commissionSideRejectionReason", () => {
  it("אחוז בטווח תקין", () => {
    expect(commissionSideRejectionReason("buyer", splitTerms(50))).toBeNull();
    expect(
      commissionSideRejectionReason("seller", splitTerms(MIN_COMMISSION_SHARE)),
    ).toBeNull();
    expect(
      commissionSideRejectionReason("buyer", splitTerms(MAX_COMMISSION_SHARE)),
    ).toBeNull();
  });

  it("אחוז מחוץ לטווח נדחה, וההודעה אומרת באיזו לשונית", () => {
    const reason = commissionSideRejectionReason("seller", splitTerms(20));
    expect(reason).not.toBeNull();
    expect(reason).toContain("צד מוכר");
  });

  it("„אחר” בלי ניסוח נדחה", () => {
    const reason = commissionSideRejectionReason("buyer", otherTerms(""));
    expect(reason).not.toBeNull();
    expect(reason).toContain("צד קונה");
  });

  it("„אחר” עם ניסוח תקין מתקבל", () => {
    expect(
      commissionSideRejectionReason("buyer", otherTerms("כל צד גובה מהלקוח שלו")),
    ).toBeNull();
  });

  it("ניסוח ארוך מדי נדחה", () => {
    expect(
      commissionSideRejectionReason("seller", otherTerms("א".repeat(OTHER_SPLIT_MAX_NOTE + 1))),
    ).not.toBeNull();
  });

  it("רווחים בלבד אינם ניסוח", () => {
    expect(commissionSideRejectionReason("buyer", otherTerms("   "))).not.toBeNull();
  });
});

describe("commissionTermsRejectionReason", () => {
  it("ברירת המחדל תקינה", () => {
    expect(commissionTermsRejectionReason(defaultCommissionTerms())).toBeNull();
  });

  it("צד פגום פוסל את השניים", () => {
    expect(
      commissionTermsRejectionReason({
        buyer: splitTerms(50),
        seller: otherTerms(""),
      }),
    ).not.toBeNull();
  });
});

describe("describeCommissionSide", () => {
  it("אחוז מנוסח כשני צדדים", () => {
    expect(describeCommissionSide(splitTerms(60))).toBe("60% / 40%");
  });

  it("„אחר” מוצג כלשונו", () => {
    expect(describeCommissionSide(otherTerms("כל צד גובה מהלקוח שלו"))).toBe(
      "כל צד גובה מהלקוח שלו",
    );
  });

  it("„אחר” בלי ניסוח אומר „לא צוין” ולא ממציא מספר", () => {
    expect(describeCommissionSide({ split: null, note: null })).toBe("לא צוין");
  });
});

describe("describeCommissionTerms", () => {
  it("חלוקה זהה נאמרת פעם אחת", () => {
    expect(describeCommissionTerms(uniformTerms(50))).toBe("50% / 50%");
  });

  it("חלוקה שונה מפרטת מי כל צד", () => {
    expect(
      describeCommissionTerms({ buyer: splitTerms(60), seller: splitTerms(40) }),
    ).toBe("קונה 60% / 40% · מוכר 40% / 60%");
  });
});

describe("commissionTermsFromRow", () => {
  it("שורה ישנה נופלת ל-commissionSplit בשני הצדדים", () => {
    expect(commissionTermsFromRow({ commissionSplit: 55 })).toEqual(uniformTerms(55));
  });

  it("שדות ריקים במפורש נחשבים גם הם לשורה ישנה", () => {
    expect(
      commissionTermsFromRow({
        commissionSplit: 45,
        buyerSplit: null,
        buyerSplitNote: null,
        sellerSplit: null,
        sellerSplitNote: null,
      }),
    ).toEqual(uniformTerms(45));
  });

  it("אחוז לכל צד בנפרד", () => {
    expect(
      commissionTermsFromRow({ commissionSplit: 60, buyerSplit: 60, sellerSplit: 40 }),
    ).toEqual({ buyer: splitTerms(60), seller: splitTerms(40) });
  });

  it("צד אחד באחוז והשני בניסוח", () => {
    expect(
      commissionTermsFromRow({
        commissionSplit: 50,
        buyerSplit: 50,
        sellerSplit: null,
        sellerSplitNote: "המוכר משלם לנו בנפרד",
      }),
    ).toEqual({ buyer: splitTerms(50), seller: otherTerms("המוכר משלם לנו בנפרד") });
  });

  it("0% הוא ערך ולא חוסר", () => {
    /*
     * `?? legacy` על מספר היה הופך 0 לברירת המחדל רק אם הוא null,
     * אבל בדיקת אמת (`if (split)`) הייתה בולעת אותו. הבדיקה כאן
     * מקבעת את ההתנהגות: אפס נשמר.
     */
    expect(
      commissionTermsFromRow({ commissionSplit: 50, buyerSplit: 0, sellerSplit: 100 }),
    ).toEqual({ buyer: splitTerms(0), seller: splitTerms(100) });
  });
});

describe("commissionTermsColumns", () => {
  it("צד באחוז נשמר בלי ניסוח", () => {
    expect(commissionTermsColumns(uniformTerms(50))).toEqual({
      buyerSplit: 50,
      buyerSplitNote: null,
      sellerSplit: 50,
      sellerSplitNote: null,
    });
  });

  it("„אחר” נשמר בלי אחוז", () => {
    expect(
      commissionTermsColumns({
        buyer: otherTerms(" כל צד גובה מהלקוח שלו "),
        seller: splitTerms(40),
      }),
    ).toEqual({
      buyerSplit: null,
      buyerSplitNote: "כל צד גובה מהלקוח שלו",
      sellerSplit: 40,
      sellerSplitNote: null,
    });
  });

  it("ניסוח שנשאר מ„אחר” אינו נשמר לצד אחוז", () => {
    expect(
      commissionTermsColumns({
        buyer: { split: 60, note: "טיוטה שבוטלה" },
        seller: splitTerms(40),
      }).buyerSplitNote,
    ).toBeNull();
  });
});

describe("headlineCommissionSplit", () => {
  it("קונה משותף — הכותרת היא צד הקונה", () => {
    expect(
      headlineCommissionSplit({ buyer: splitTerms(60), seller: splitTerms(40) }, "buyer"),
    ).toBe(60);
  });

  it("נכס מפורסם — הכותרת היא צד המוכר", () => {
    expect(
      headlineCommissionSplit({ buyer: splitTerms(60), seller: splitTerms(40) }, "seller"),
    ).toBe(40);
  });

  it("צד שנוסח במילים נופל לברירת המחדל", () => {
    expect(
      headlineCommissionSplit({ buyer: otherTerms("כמו תמיד"), seller: splitTerms(40) }, "buyer"),
    ).toBe(DEFAULT_COMMISSION_SPLIT);
  });
});

describe("publisherSideOf", () => {
  it("משתף קונה מחזיק את צד הקונה", () => {
    expect(publisherSideOf("buyer")).toBe("buyer");
  });

  it("מפרסם נכס מחזיק את צד המוכר", () => {
    expect(publisherSideOf("property")).toBe("seller");
  });
});

describe("COMMISSION_SIDES", () => {
  it("שני צדדים, צד הקונה ראשון", () => {
    expect(COMMISSION_SIDES).toEqual(["buyer", "seller"]);
  });
});
