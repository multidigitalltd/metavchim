import { describe, expect, it } from "vitest";
import {
  bulkContactErasureDisclosure,
  contactErasureDisclosure,
} from "./contact-erasure-disclosure.js";

describe("משפט הגילוי — בודד וקבוצתי, מאותם חלקים", () => {
  it("ספירת אפס אינה מוצגת — „0 שיחות” מלמד לא לקרוא את האזהרה", () => {
    const text = contactErasureDisclosure({ calls: 2, messages: 0, emails: 1 });
    expect(text).toContain("2 שיחות (כולל הקלטות)");
    expect(text).toContain("מייל אחד");
    expect(text).not.toContain("הודע");
  });

  it("גם בלי היסטוריה — הגילוי אומר שהכרטיס עצמו יורד", () => {
    expect(contactErasureDisclosure({ calls: 0, messages: 0, emails: 0 })).toContain(
      "יימחק גם כרטיס הלקוח",
    );
  });

  it("קבוצתי: אפס כרטיסים = אין מה לגלות", () => {
    expect(bulkContactErasureDisclosure(0, { calls: 5, messages: 3, emails: 1 })).toBe("");
  });

  it("קבוצתי: יחיד ורבים, עם הספירה המצטברת", () => {
    expect(bulkContactErasureDisclosure(1, { calls: 1, messages: 0, emails: 0 })).toBe(
      "יימחק גם כרטיס לקוח אחד שזה הקישור האחרון אליו במשרד, כולל שיחה מוקלטת אחת.",
    );
    const many = bulkContactErasureDisclosure(3, { calls: 7, messages: 2, emails: 0 });
    expect(many).toContain("יימחקו גם 3 כרטיסי לקוח");
    expect(many).toContain("7 שיחות (כולל הקלטות), 2 הודעות");
  });
});
