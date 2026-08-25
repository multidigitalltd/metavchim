import { describe, expect, it } from "vitest";
import {
  WHATSAPP_LINK_CODE_ALPHABET,
  WHATSAPP_LINK_CODE_LENGTH,
  WHATSAPP_LINK_MAX_AGE_DAYS,
  formatWhatsappLinkCode,
  isWhatsappLinkCodeMessage,
  linkNeedsReverification,
  normalizeWhatsappLinkCode,
} from "./whatsapp-link-code.js";

describe("קוד הקישור — הצורה שהמתווך מעתיק", () => {
  it("הקידומת נוספת פעם אחת, והצורה קבועה", () => {
    expect(formatWhatsappLinkCode("4F7K2Q")).toBe("MV-4F7K2Q");
  });

  it("והנרמול מחזיר את הגוף בלבד", () => {
    expect(normalizeWhatsappLinkCode("MV-4F7K2Q")).toBe("4F7K2Q");
  });
});

/*
 * הקוד עובר במכשיר נייד: מועתק, מודבק, ולפעמים מוקלד ידנית עם
 * רווח או באותיות קטנות. סירוב על אלה היה נראה למתווך כמו „הקוד
 * לא עובד” בזמן שהוא רואה על המסך בדיוק את מה שהקליד.
 */
describe("סלחנות שאינה פגיעה", () => {
  it("רישיות אינן משנות", () => {
    expect(normalizeWhatsappLinkCode("mv-4f7k2q")).toBe("4F7K2Q");
  });

  it("רווחים ומקפים שנוספו בדרך נופלים", () => {
    expect(normalizeWhatsappLinkCode(" MV - 4F7 K2Q ")).toBe("4F7K2Q");
  });

  it("וסימני כיווניות בלתי-נראים מהעתקה בעברית", () => {
    expect(normalizeWhatsappLinkCode("‏MV-4F7K2Q‎")).toBe("4F7K2Q");
  });
});

/*
 * ההודעה נבדקת **לפני** הפירוש, ולכן טעות לכל כיוון יקרה: הודעה
 * שאינה קוד שנחשבה לקוד שורפת ניסיון ואינה מבוצעת, וקוד שלא זוהה
 * נשלח למודל חיצוני.
 */
describe("מה שאינו קוד אינו נחשב לניסיון", () => {
  it("פקודה בעברית", () => {
    expect(normalizeWhatsappLinkCode("תוסיף קונה משה כהן")).toBeNull();
    expect(isWhatsappLinkCodeMessage("תוסיף קונה משה כהן")).toBe(false);
  });

  it("שש ספרות בלי קידומת — מספר, לא קוד", () => {
    expect(normalizeWhatsappLinkCode("123456")).toBeNull();
  });

  it("קידומת עם אורך שגוי", () => {
    expect(normalizeWhatsappLinkCode("MV-4F7K2")).toBeNull();
    expect(normalizeWhatsappLinkCode("MV-4F7K2QQ")).toBeNull();
  });

  it("ותו שאינו באלפבית — כולל אלה שהושמטו בכוונה", () => {
    for (const ambiguous of ["0", "O", "1", "I", "L"]) {
      expect(WHATSAPP_LINK_CODE_ALPHABET).not.toContain(ambiguous);
    }
    expect(normalizeWhatsappLinkCode("MV-4F7K2O")).toBeNull();
    expect(normalizeWhatsappLinkCode("MV-4F7K2!")).toBeNull();
  });

  it("הודעה ריקה", () => {
    expect(normalizeWhatsappLinkCode("")).toBeNull();
    expect(normalizeWhatsappLinkCode("MV-")).toBeNull();
  });
});

describe("כל צירוף מהאלפבית מתקבל", () => {
  it("גם קוד שכולו אותיות וגם קוד שכולו ספרות", () => {
    const letters = WHATSAPP_LINK_CODE_ALPHABET.slice(0, WHATSAPP_LINK_CODE_LENGTH);
    const digits = "234567".slice(0, WHATSAPP_LINK_CODE_LENGTH);
    expect(normalizeWhatsappLinkCode(formatWhatsappLinkCode(letters))).toBe(letters);
    expect(normalizeWhatsappLinkCode(formatWhatsappLinkCode(digits))).toBe(digits);
  });
});

/*
 * אימות מחדש נמדד מהפעם האחרונה שמישהו **הוכיח** שהמספר שלו, ולא
 * מהשימוש: מכשיר גנוב משתמש בדיוק כמו הבעלים.
 */
describe("אימות מחדש", () => {
  const now = new Date("2026-08-25T00:00:00Z");
  const daysAgo = (days: number): Date => new Date(now.getTime() - days * 86_400_000);

  it("קישור טרי אינו נדרש", () => {
    expect(linkNeedsReverification(daysAgo(1), now)).toBe(false);
    expect(linkNeedsReverification(daysAgo(WHATSAPP_LINK_MAX_AGE_DAYS - 1), now)).toBe(false);
  });

  it("ובגיל המרבי — כן", () => {
    expect(linkNeedsReverification(daysAgo(WHATSAPP_LINK_MAX_AGE_DAYS), now)).toBe(true);
    expect(linkNeedsReverification(daysAgo(WHATSAPP_LINK_MAX_AGE_DAYS + 30), now)).toBe(true);
  });
});
