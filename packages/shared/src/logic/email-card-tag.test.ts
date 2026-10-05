import { describe, expect, it } from "vitest";
import {
  EMAIL_CARD_KINDS,
  emailCardHref,
  emailCardLabel,
  emailCardTag,
  isEmailCardKind,
  type EmailCardKind,
} from "./email-card-tag.js";

describe("emailCardTag — חצי תג אינו תג", () => {
  it("סוג ומזהה — תג", () => {
    expect(emailCardTag("buyer", "01J")).toEqual({ kind: "buyer", id: "01J" });
  });

  /*
   * ‏שורה עם סוג בלי מזהה הייתה מייצרת קישור אל `/buyers/null`.
   * ‏קישור שמוביל למסך שגיאה גרוע מתא ריק, כי לוחצים עליו.
   */
  it("סוג בלי מזהה — אין תג", () => {
    expect(emailCardTag("buyer", null)).toBeNull();
    expect(emailCardTag("buyer", "")).toBeNull();
  });

  it("מזהה בלי סוג — אין תג", () => {
    expect(emailCardTag(null, "01J")).toBeNull();
  });

  /*
   * ‎**וסוג שאינו מוכר אינו נכנס פנימה.** העמודה היא טקסט חופשי
   * ‏במסד, ושורה מגרסה עתידית (או מייבוא) עם `"deal"` הייתה
   * ‏מייצרת `/undefined/01J`.
   */
  it("סוג לא מוכר — אין תג", () => {
    expect(emailCardTag("deal", "01J")).toBeNull();
    expect(isEmailCardKind("deal")).toBe(false);
  });
});

describe("‏לכל סוג יש תווית ונתיב", () => {
  for (const kind of EMAIL_CARD_KINDS) {
    it(kind, () => {
      expect(emailCardLabel(kind)).not.toBe("");
      /* ‏הנתיב מתחיל בלוכסן ומסתיים במזהה — קישור ולא טקסט */
      expect(emailCardHref({ kind, id: "01J" }).startsWith("/")).toBe(true);
      expect(emailCardHref({ kind, id: "01J" }).endsWith("/01J")).toBe(true);
    });
  }

  /*
   * ‏שתי מפות נפרדות בקוד; בלי זה סוג שנוסף לרשימה ונשכח באחת
   * ‏מהן מחזיר `undefined` בזמן ריצה, וזה נראה כתא ריק.
   */
  it("אין סוג בלי תווית או בלי נתיב", () => {
    for (const kind of EMAIL_CARD_KINDS) {
      expect(typeof emailCardLabel(kind)).toBe("string");
      expect(emailCardHref({ kind, id: "x" })).not.toContain("undefined");
    }
  });

  /* ‏והנתיבים שונים זה מזה — מפה שהודבקה מייצרת שני סוגים לאותו מסך */
  it("כל סוג מוביל למסך אחר", () => {
    const hrefs = EMAIL_CARD_KINDS.map((kind: EmailCardKind) =>
      emailCardHref({ kind, id: "x" }),
    );
    expect(new Set(hrefs).size).toBe(EMAIL_CARD_KINDS.length);
  });
});
