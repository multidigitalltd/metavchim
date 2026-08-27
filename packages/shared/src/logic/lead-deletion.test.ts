import { describe, expect, it } from "vitest";
import {
  leadDeletionKeepsContact,
  leadDeletionOutcome,
  leadDeletionRejectionReason,
} from "./lead-deletion.js";

describe("leadDeletionRejectionReason", () => {
  it("ליד פתוח נמחק", () => {
    for (const status of ["new", "in_progress", "waiting_customer", "closed"]) {
      expect(leadDeletionRejectionReason(status)).toBeNull();
    }
  });

  it("ליד שהומר חסום — יש כרטיס שמצביע עליו", () => {
    expect(leadDeletionRejectionReason("converted")).toContain("כרטיס");
  });
});

describe("leadDeletionKeepsContact", () => {
  it("מחיקת הליד בלבד משאירה את הלקוח", () => {
    expect(leadDeletionKeepsContact("lead")).toBe(true);
  });

  it("מחיקת ליד וכרטיס מרשה למחוק גם את הלקוח", () => {
    expect(leadDeletionKeepsContact("lead_and_contact")).toBe(false);
  });
});

describe("leadDeletionOutcome", () => {
  it("כרטיס שנשאר — נאמר במפורש", () => {
    expect(leadDeletionOutcome("דנה", false)).toContain("נשאר במאגר");
  });

  /*
   * מי שביקש למחוק גם את הכרטיס ונשאר לו קונה או נכס מקבל את אותה
   * הודעה כמו מי שביקש להשאיר — התשובה מגיעה מהשרת ולא מהבחירה.
   */
  it("כרטיס שירד — נאמר במפורש", () => {
    expect(leadDeletionOutcome("דנה", true)).toContain("וגם כרטיס הלקוח");
  });
});
