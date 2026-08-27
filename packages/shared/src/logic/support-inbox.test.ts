import { describe, expect, it } from "vitest";
import {
  normalizeSupportSubject,
  parseSenderEmail,
  parseSenderName,
  supportReplyRejectionReason,
  supportSubjectOrDefault,
} from "./support-inbox.js";

describe("normalizeSupportSubject", () => {
  it("מסיר קידומות מענה בעברית ובאנגלית", () => {
    expect(normalizeSupportSubject("Re: לא עובד לי")).toBe("לא עובד לי");
    expect(normalizeSupportSubject("תשובה: לא עובד לי")).toBe("לא עובד לי");
  });

  /* "Re: Fwd: Re:" הוא שרשור אמיתי, לא מקרה קצה תיאורטי. */
  it("מסיר גם שרשרת של קידומות", () => {
    expect(normalizeSupportSubject("Re: Fwd: Re: תקלה")).toBe("תקלה");
  });

  it("אינו נוגע בנושא שמתחיל במילה שנראית כמו קידומת", () => {
    expect(normalizeSupportSubject("Refund של החודש")).toBe("Refund של החודש");
  });

  it("נושא ריק מקבל תיאור ולא מחרוזת ריקה", () => {
    expect(supportSubjectOrDefault("")).toBe("פנייה ללא נושא");
    expect(supportSubjectOrDefault(undefined)).toBe("פנייה ללא נושא");
  });
});

describe("parseSenderEmail", () => {
  it("קורא כתובת משתי הצורות ומנרמל לאותיות קטנות", () => {
    expect(parseSenderEmail('"דנה כהן" <Dana@Example.co.il>')).toBe("dana@example.co.il");
    expect(parseSenderEmail("dana@example.co.il")).toBe("dana@example.co.il");
  });

  it("קלט שאינו כתובת מוחזר כ-null ולא כמחרוזת חלקית", () => {
    expect(parseSenderEmail("לא כתובת")).toBeNull();
    expect(parseSenderEmail("<>")).toBeNull();
    expect(parseSenderEmail("a@b")).toBeNull();
  });
});

describe("parseSenderName", () => {
  it("לוקח את השם כשהוא קיים", () => {
    expect(parseSenderName('"דנה כהן" <dana@example.co.il>', "dana@example.co.il")).toBe("דנה כהן");
  });

  it("בלי שם — החלק שלפני ה-@, ולא הכתובת המלאה", () => {
    expect(parseSenderName("dana@example.co.il", "dana@example.co.il")).toBe("dana");
  });

  it("בלי כלום — תיאור, לא ריק", () => {
    expect(parseSenderName("", null)).toBe("פונה לא מזוהה");
  });
});

describe("supportReplyRejectionReason", () => {
  it("שרשור עם כתובת ניתן למענה", () => {
    expect(supportReplyRejectionReason({ contactEmail: "a@b.co.il" })).toBeNull();
  });

  /* הפנייה כן מוצגת — פשוט אי אפשר להשיב לה במייל. */
  it("שרשור בלי כתובת אינו בר-מענה", () => {
    expect(supportReplyRejectionReason({ contactEmail: null })).toContain("אי אפשר להשיב");
  });
});
