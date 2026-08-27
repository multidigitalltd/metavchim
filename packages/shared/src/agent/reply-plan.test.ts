import { describe, expect, it } from "vitest";
import { agentReplySegments } from "./reply-plan.js";

describe("תוכנית התשובה — הרכב וסדר אחד לשני הערוצים", () => {
  it("הסדר: מסקנה, תובנה, נתונים, קישורים, צעדים", () => {
    const kinds = agentReplySegments({
      message: "3 קונים",
      insight: "אחד מהם חם",
      data: { buyers: [] },
      href: "/buyers",
      link: "https://wa.me/x",
      nextSteps: [{ text: "לשלוח הצעה?", label: "📤 שלח" }],
      suggestion: "לא אמור להופיע",
    }).map((segment) => segment.kind);
    expect(kinds).toEqual([
      "headline",
      "insight",
      "data",
      "screen-link",
      "external-link",
      "steps",
    ]);
  });

  it("suggestion רק כשאין אף צעד נגזר — לא שתי עצות באותה תשובה", () => {
    const kinds = agentReplySegments({
      message: "בוצע",
      suggestion: "לקבוע סיור?",
    }).map((segment) => segment.kind);
    expect(kinds).toEqual(["headline", "suggestion"]);
  });

  it("מקטע ריק אינו נפלט — אין שורות רפאים", () => {
    expect(agentReplySegments({ message: "", insight: "" })).toEqual([]);
  });
});
