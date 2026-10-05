import { describe, expect, it } from "vitest";
import {
  contactNameUpgrade,
  isPlaceholderContactName,
} from "./contact-placeholder-name.js";

const PHONE = "+972501234567";

describe("שם שהוא מציין מקום", () => {
  it("ריק הוא מציין מקום", () => {
    expect(isPlaceholderContactName("", PHONE)).toBe(true);
    expect(isPlaceholderContactName("   ", PHONE)).toBe(true);
  });

  /*
   * ‏זה מה שהשיחה כותבת: `callerName ?? phone`. הכרטיס נקרא
   * ‏במספר של עצמו, בכל צורה שהמרכזייה מסרה אותו.
   */
  it("והמספר עצמו — בכל צורה שנכתב", () => {
    for (const written of [
      "+972501234567",
      "0501234567",
      "050-123-4567",
      "050 123 4567",
      "(050) 123-4567",
    ]) {
      expect(isPlaceholderContactName(written, PHONE), written).toBe(true);
    }
  });

  /*
   * ‎**הגבול שמונע איבוד נתונים.** שם אמיתי שנשמר קודם הוא ידע
   * ‏של המשרד, ועדכון שקט שלו גרוע מהתקלה שהתיקון בא לפתור.
   */
  it("ושם אמיתי אינו מציין מקום — גם כשיש בו ספרה", () => {
    for (const name of ["דנה", "דנה כהן", "דנה 2", "דירה 4", "יוסי לוי"]) {
      expect(isPlaceholderContactName(name, PHONE), name).toBe(false);
    }
  });

  /*
   * ‏מספר **אחר** ששמור כשם הוא משהו שמישהו הקליד — טלפון נוסף,
   * ‏מספר של בן זוג — ואינו מציין המקום של הכרטיס הזה.
   */
  it("ומספר אחר אינו מציין מקום", () => {
    expect(isPlaceholderContactName("0529999999", PHONE)).toBe(false);
  });
});

describe("שדרוג השם", () => {
  it("מחליף מציין מקום בשם אמיתי", () => {
    expect(contactNameUpgrade("0501234567", "דנה כהן", PHONE)).toBe("דנה כהן");
    expect(contactNameUpgrade("", "דנה כהן", PHONE)).toBe("דנה כהן");
  });

  it("ואינו דורס שם אמיתי", () => {
    expect(contactNameUpgrade("יוסי לוי", "דנה כהן", PHONE)).toBeNull();
  });

  it("ואינו מחליף מציין מקום במציין מקום", () => {
    expect(contactNameUpgrade("0501234567", "+972501234567", PHONE)).toBeNull();
  });

  it("ושם נכנס ריק אינו מוחק", () => {
    expect(contactNameUpgrade("0501234567", "   ", PHONE)).toBeNull();
  });
});
