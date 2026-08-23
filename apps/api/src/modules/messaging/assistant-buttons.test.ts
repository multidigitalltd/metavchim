import { describe, expect, it } from "vitest";
import { buttonTitle, type WhatsAppListRow } from "@metavchim/shared";
import { buttonAsText, choiceVariant } from "./assistant-buttons";

const row = (title: string, i: number, description?: string): WhatsAppListRow => ({
  action: "pick",
  arg: String(i + 1),
  title,
  ...(description === undefined ? {} : { description }),
});

describe("choiceVariant", () => {
  it("כפתורים כששתי התוויות שונות ונכנסות בתקרה", () => {
    const variant = choiceVariant([row("משה כהן", 0), row("דנה לוי", 1)]);
    expect(variant.buttons).toHaveLength(2);
    expect(variant.list).toBeUndefined();
  });

  it("רשימה כשהתוויות זהות — התיאור הוא מה שמבדיל", () => {
    const variant = choiceVariant([
      row("משה כהן", 0, "גבעתיים · 4 חדרים"),
      row("משה כהן", 1, "רמת גן · 3 חדרים"),
    ]);
    expect(variant.buttons).toBeUndefined();
    expect(variant.list?.rows[1]?.description).toBe("רמת גן · 3 חדרים");
  });

  it("רשימה כשההבדל קיים רק אחרי החיתוך של Meta", () => {
    /*
     * שתי הכותרות שונות בטקסט הגולמי, אבל תקרת עשרים התווים חותכת
     * את שתיהן לאותה מחרוזת — ולכן על המסך הן זהות (ביקורת Codex).
     */
    const variant = choiceVariant([
      row("משה כהן מרחוב הרצל 12", 0, "גבעתיים"),
      row("משה כהן מרחוב הרצל 84", 1, "רמת גן"),
    ]);
    expect(variant.buttons).toBeUndefined();
    expect(variant.list?.rows).toHaveLength(2);
  });

  it("מוסיף מספר סידורי כשאין תיאור להבחין בו — גם הרשימה נחתכת", () => {
    const variant = choiceVariant([row("משה כהן", 0), row("משה כהן", 1)]);
    const titles = (variant.list?.rows ?? []).map((r) => buttonTitle(r.title));
    expect(new Set(titles).size).toBe(2);
    expect(titles[0]).toContain("1.");
    expect(titles[1]).toContain("2.");
  });

  it("כותרות מבחינות נשארות כמו שהן ברשימה ארוכה", () => {
    const variant = choiceVariant(
      ["א", "ב", "ג", "ד"].map((title, i) => row(title, i)),
    );
    expect(variant.list?.rows.map((r) => r.title)).toEqual(["א", "ב", "ג", "ד"]);
  });

  it("רשימה כשיש יותר משלוש אפשרויות — Meta מתירה שלושה כפתורים", () => {
    const variant = choiceVariant(
      ["א", "ב", "ג", "ד"].map((title, i) => row(title, i)),
    );
    expect(variant.buttons).toBeUndefined();
    expect(variant.list?.rows).toHaveLength(4);
  });

  it("גרסת הכפתורים אינה נושאת תיאור — Meta אינה מציגה אותו", () => {
    const variant = choiceVariant([row("משה", 0, "גבעתיים"), row("דנה", 1, "רמת גן")]);
    expect(variant.buttons?.every((button) => !("description" in button))).toBe(true);
  });
});

describe("buttonAsText", () => {
  it("מתרגם אישור וביטול למילים שהשיחה מכירה", () => {
    expect(buttonAsText("confirm")).toBe("אשר");
    expect(buttonAsText("cancel")).toBe("בטל");
  });

  it("בחירה היא המספר הסידורי", () => {
    expect(buttonAsText("pick", "3")).toBe("3");
  });

  it("ארגומנט שאינו מספר סידורי אינו פקודה", () => {
    expect(buttonAsText("pick", "או-לא")).toBeNull();
    expect(buttonAsText("pick")).toBeNull();
  });

  it("פקודה מוכנה נשלחת כמשפט, ומפתח לא מוכר נדחה", () => {
    expect(buttonAsText("cmd", "urgent")).toBe("מה הכי דחוף לי היום?");
    expect(buttonAsText("cmd", "drop_all")).toBeNull();
  });
});
