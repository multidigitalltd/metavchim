import { describe, expect, it } from "vitest";
import {
  isMentorReflectRequest,
  isSkipMessage,
  mentorPlanPrompt,
  mentorReflectionPrompt,
} from "./assistant-mentor";

describe("המנטור בשיחה — הרפלקציה והתוכנית", () => {
  it("„לענות למנטור” כלשונו פותח את הרפלקציה — לא משפט שמכיל אותו", () => {
    expect(isMentorReflectRequest("לענות למנטור")).toBe(true);
    expect(isMentorReflectRequest("לענות למנטור!")).toBe(true);
    expect(isMentorReflectRequest("אני רוצה לענות למנטור מחר")).toBe(false);
  });

  it("„דלג” ו„לא עכשיו” מדלגים על התוכנית; תוכנית אמיתית — לא", () => {
    expect(isSkipMessage("דלג")).toBe(true);
    expect(isSkipMessage("לא עכשיו")).toBe(true);
    expect(isSkipMessage("כשאין זמן — אז ההצעות ראשונות בבוקר")).toBe(false);
  });

  it("השאלה של המנטור נשלחת עם הסבר שההודעה הבאה היא התשובה", () => {
    const reply = mentorReflectionPrompt("מה עצר את ההצעות השבוע?");
    expect(reply.text).toContain("מה עצר את ההצעות השבוע?");
    expect(reply.text).toContain("ההודעה הבאה נשמרת כתשובה");
    expect(reply.buttons).toBeUndefined();
  });

  it("אחרי התשובה — שלוש הצעות ללחיצה עם החותם, ואפשרות לכתוב או לדלג", () => {
    const reply = mentorPlanPrompt(
      "לא היה זמן",
      ["כשאין זמן — אז בבוקר", "כש… אז…", "שלישית"],
      "TOKEN",
    );
    expect(reply.text).toContain("נשמר: „לא היה זמן”");
    expect(reply.text).toContain("1. כשאין זמן — אז בבוקר");
    expect(reply.text).toContain("„דלג”");
    expect(reply.buttons?.map((b) => b.arg)).toEqual(["1", "2", "3"]);
    expect(reply.buttons?.every((b) => b.token === "TOKEN")).toBe(true);
  });

  it("בלי הצעות — טקסט בלבד, בלי כפתורים ריקים", () => {
    const reply = mentorPlanPrompt("לא היה זמן", [], "T");
    expect(reply.buttons).toBeUndefined();
    expect(reply.list).toBeUndefined();
  });
});
