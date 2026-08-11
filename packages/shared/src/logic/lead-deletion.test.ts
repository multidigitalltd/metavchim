import { describe, expect, it } from "vitest";
import { leadDeletionRejectionReason } from "./lead-deletion.js";

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
