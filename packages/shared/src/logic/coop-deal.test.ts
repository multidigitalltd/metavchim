import { describe, expect, it } from "vitest";
import {
  canMoveCoopDeal,
  COOP_DEAL_STAGE_HINTS,
  COOP_DEAL_STAGE_LABELS,
  COOP_DEAL_STAGES,
  coopDealMessageRejectionReason,
  coopDealMoveRejectionReason,
  coopDealSplitLabel,
  coopDealStageEventBody,
  isCoopDealStage,
  isFinalCoopDealStage,
  MAX_COOP_DEAL_MESSAGE,
} from "./coop-deal.js";

describe("שלבי חדר העסקה", () => {
  it("לכל שלב יש תווית ורמז בעברית", () => {
    for (const stage of COOP_DEAL_STAGES) {
      expect(COOP_DEAL_STAGE_LABELS[stage]).not.toBe("");
      expect(COOP_DEAL_STAGE_HINTS[stage]).not.toBe("");
    }
  });

  it("מזהה שלב תקף ופוסל מחרוזת שאינה שלב", () => {
    expect(isCoopDealStage("viewing")).toBe(true);
    expect(isCoopDealStage("whatever")).toBe(false);
  });

  it("מתקדם ונסוג שלב אחד בכל פעם", () => {
    expect(canMoveCoopDeal("contact", "viewing")).toBe(true);
    expect(canMoveCoopDeal("viewing", "contact")).toBe(true);
    expect(canMoveCoopDeal("negotiation", "viewing")).toBe(true);
  });

  it("אינו מדלג שני שלבים קדימה", () => {
    expect(canMoveCoopDeal("contact", "negotiation")).toBe(false);
    expect(coopDealMoveRejectionReason("contact", "negotiation")).toContain(
      "שלב אחד",
    );
  });

  it("סוגר עסקה מכל שלב פתוח", () => {
    for (const from of ["contact", "viewing", "negotiation"] as const) {
      expect(canMoveCoopDeal(from, "signed")).toBe(true);
      expect(canMoveCoopDeal(from, "cancelled")).toBe(true);
    }
  });

  /*
   * הכלל שבגללו הציר קיים: שני משרדים חולקים עמלה על סמך הרישום
   * הזה. עסקה שנחתמה ואפשר להחזיר אותה למו"מ היא רישום שאי אפשר
   * להסתמך עליו.
   */
  it("אינו פותח מחדש עסקה סגורה", () => {
    expect(canMoveCoopDeal("signed", "negotiation")).toBe(false);
    expect(canMoveCoopDeal("cancelled", "contact")).toBe(false);
    expect(canMoveCoopDeal("cancelled", "signed")).toBe(false);
    expect(coopDealMoveRejectionReason("signed", "contact")).toContain(
      "נסגרה",
    );
  });

  it("מעבר לאותו שלב אינו מעבר", () => {
    expect(canMoveCoopDeal("viewing", "viewing")).toBe(false);
    expect(coopDealMoveRejectionReason("viewing", "viewing")).toContain(
      "כבר נמצאת",
    );
  });

  it("מעבר מותר אינו מחזיר סיבת דחייה", () => {
    expect(coopDealMoveRejectionReason("contact", "viewing")).toBeNull();
  });

  it("מסמן את השלבים הסופיים ורק אותם", () => {
    expect(isFinalCoopDealStage("signed")).toBe(true);
    expect(isFinalCoopDealStage("cancelled")).toBe(true);
    expect(isFinalCoopDealStage("contact")).toBe(false);
    expect(isFinalCoopDealStage("negotiation")).toBe(false);
  });

  it("שורת האירוע נושאת את שם המעביר ואת תווית השלב", () => {
    const body = coopDealStageEventBody("viewing", "דנה");
    expect(body).toContain("דנה");
    expect(body).toContain(COOP_DEAL_STAGE_LABELS.viewing);
  });
});

describe("הודעות בחדר", () => {
  it("פוסל הודעה ריקה או רווחים בלבד", () => {
    expect(coopDealMessageRejectionReason("")).not.toBeNull();
    expect(coopDealMessageRejectionReason("   \n ")).not.toBeNull();
  });

  it("פוסל הודעה מעל התקרה ומקבל הודעה בדיוק בגבול", () => {
    expect(
      coopDealMessageRejectionReason("א".repeat(MAX_COOP_DEAL_MESSAGE)),
    ).toBeNull();
    expect(
      coopDealMessageRejectionReason("א".repeat(MAX_COOP_DEAL_MESSAGE + 1)),
    ).not.toBeNull();
  });

  it("מקבל הודעה רגילה", () => {
    expect(coopDealMessageRejectionReason("אפשר מחר ב-17:00?")).toBeNull();
  });
});

describe("חלוקת העמלה מנקודת מבט הצופה", () => {
  /*
   * המספר השמור הוא תמיד חלקו של צד הנכס. אם התווית לא הייתה
   * מתהפכת, אחד משני המשרדים היה קורא במסך שלו את חלקו של השני.
   */
  it("מתהפכת בין שני הצדדים", () => {
    expect(coopDealSplitLabel(60, "listing")).toBe("60% לכם · 40% לצד השני");
    expect(coopDealSplitLabel(60, "buyer")).toBe("40% לכם · 60% לצד השני");
  });

  it("חלוקה שווה נראית זהה משני הצדדים", () => {
    expect(coopDealSplitLabel(50, "listing")).toBe(
      coopDealSplitLabel(50, "buyer"),
    );
  });
});
