import { describe, expect, it } from "vitest";
import { choiceIndex, isCancelMessage, isConfirmMessage, waPhoneVariants } from "./assistant-lang";

/**
 * "אשר" מבצע פעולה אמיתית אצל מתווך אמיתי — לכן ההתאמה חייבת להיות
 * מילה שלמה בלבד. משפט שמכיל את המילה ("אשר לי פגישה") הוא בקשה
 * חדשה, ופירוש שלו כאישור היה מבצע את ההצעה הקודמת בטעות.
 */
describe("isConfirmMessage", () => {
  it("מזהה מילות אישור נקיות, גם עם פיסוק ורווחים", () => {
    expect(isConfirmMessage("אשר")).toBe(true);
    expect(isConfirmMessage(" כן! ")).toBe(true);
    expect(isConfirmMessage("אוקיי.")).toBe(true);
    expect(isConfirmMessage("OK")).toBe(true);
  });

  it("משפט שמכיל מילת אישור אינו אישור", () => {
    expect(isConfirmMessage("אשר לי פגישה ליום שלישי")).toBe(false);
    expect(isConfirmMessage("כן אבל תשנה את המחיר")).toBe(false);
  });
});

describe("isCancelMessage", () => {
  it("מזהה ביטול", () => {
    expect(isCancelMessage("בטל")).toBe(true);
    expect(isCancelMessage("לא")).toBe(true);
  });

  it("משפט עם תוכן אינו ביטול", () => {
    expect(isCancelMessage("לא, תרשום 4 חדרים")).toBe(false);
  });
});

describe("choiceIndex", () => {
  it("מספר בטווח נבחר (מאונדקס מאפס)", () => {
    expect(choiceIndex("2", 3)).toBe(1);
    expect(choiceIndex("1.", 3)).toBe(0);
  });

  it("מחוץ לטווח או לא-מספר — לא בחירה", () => {
    expect(choiceIndex("4", 3)).toBeNull();
    expect(choiceIndex("0", 3)).toBeNull();
    expect(choiceIndex("הראשון", 3)).toBeNull();
  });
});

describe("waPhoneVariants", () => {
  it("מספר בינלאומי מקבל גם צורה מקומית", () => {
    expect(waPhoneVariants("972501234567")).toEqual(["972501234567", "0501234567"]);
  });

  it("מספר מקומי מקבל גם צורה בינלאומית", () => {
    expect(waPhoneVariants("0501234567")).toEqual(["0501234567", "972501234567"]);
  });
});
