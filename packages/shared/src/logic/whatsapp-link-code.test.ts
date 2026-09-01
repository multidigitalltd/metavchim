import { describe, expect, it } from "vitest";
import {
  WHATSAPP_LINK_CODE_ALPHABET,
  WHATSAPP_LINK_CODE_LENGTH,
  WHATSAPP_LINK_MAX_AGE_DAYS,
  displayWhatsappNumber,
  formatWhatsappLinkCode,
  looksLikeWhatsappLinkCode,
  linkNeedsReverification,
  normalizeWhatsappLinkCode,
  whatsappPairingLink,
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
    expect(looksLikeWhatsappLinkCode("תוסיף קונה משה כהן")).toBe(false);
  });

  it("שש ספרות בלי קידומת — מספר, לא קוד", () => {
    expect(normalizeWhatsappLinkCode("123456")).toBeNull();
  });

  /*
   * טעות הקלדה בגוף הקוד היא עדיין **ניסיון קישור**, ולכן היא
   * חייבת להגיע למסלול הקישור ולקבל „הקוד אינו תקף” — ולא להתגלגל
   * למסלול המתעניין או להישלח למודל כפקודה.
   */
  it("אבל קוד שגוי עם קידומת עדיין נראה כניסיון", () => {
    expect(normalizeWhatsappLinkCode("MV-4F7K2O")).toBeNull();
    expect(looksLikeWhatsappLinkCode("MV-4F7K2O")).toBe(true);
    expect(looksLikeWhatsappLinkCode("MV-4F7K2")).toBe(true);
  });

  it("ומשפט ארוך שמתחיל ב-MV נשאר פקודה", () => {
    expect(looksLikeWhatsappLinkCode("MV תראה לי את הפגישות של מחר")).toBe(false);
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

describe("whatsappPairingLink", () => {
  const CODE = formatWhatsappLinkCode("4F7K2Q");

  it("בונה קישור wa.me אל המספר העסקי עם הקוד כטקסט", () => {
    expect(whatsappPairingLink("972501234567", CODE)).toBe(
      "https://wa.me/972501234567?text=MV-4F7K2Q",
    );
  });

  it("מנרמל מספר מקומי — מי שמקליד 05… לא מקבל קישור שבור", () => {
    expect(whatsappPairingLink("050-1234567", CODE)).toBe(
      "https://wa.me/972501234567?text=MV-4F7K2Q",
    );
  });

  it("null כשאין מספר עסקי — הקוד עדיין מוצג, רק הקיצור נעלם", () => {
    expect(whatsappPairingLink(null, CODE)).toBeNull();
    expect(whatsappPairingLink("  ", CODE)).toBeNull();
  });

  /*
   * ‎**זו הטענה שמחזיקה את כל התכונה.** הטקסט שהקישור פותח איתו
   * חייב לעבור בדיוק את אותה בדיקה שהשרת עושה על הודעה נכנסת —
   * אחרת הלחיצה שולחת הודעה שתפורש כשאלה לסוכן, לא כקוד.
   */
  it("הטקסט שנשלח מזוהה בשרת כקוד, ומפוענח חזרה לאותו קוד", () => {
    const url = new URL(whatsappPairingLink("972501234567", CODE)!);
    const text = url.searchParams.get("text")!;
    expect(looksLikeWhatsappLinkCode(text)).toBe(true);
    expect(normalizeWhatsappLinkCode(text)).toBe("4F7K2Q");
  });
});

describe("displayWhatsappNumber", () => {
  it("מספר ישראלי מוצג בפורמט המקומי — כך מקלידים אותו", () => {
    expect(displayWhatsappNumber("972553142235")).toBe("055-314-2235");
  });

  it("סימני עיצוב במקור אינם משנים את התוצאה", () => {
    expect(displayWhatsappNumber("+972-55-314-2235")).toBe("055-314-2235");
  });

  it("מספר זר נשאר בינלאומי — שם הקידומת היא ההקשר", () => {
    expect(displayWhatsappNumber("14155552671")).toBe("+14155552671");
  });

  it("אורך ישראלי חריג אינו מפוצל כאילו היה תקין", () => {
    expect(displayWhatsappNumber("97255314")).toBe("+97255314");
  });

  it("ריק נשאר ריק — אין מה להציג", () => {
    expect(displayWhatsappNumber("")).toBe("");
    expect(displayWhatsappNumber("---")).toBe("");
  });
});

describe("displayWhatsappNumber — הצורה שהמנהל באמת מקליד", () => {
  /*
   * ‎`0553142235` הוא מה שהתיעוד ושדה ההגדרה מציגים. בלי נרמול הוא
   * יצא `+0553142235` — מספר שאינו קיים, וגם `tel:` שבור. הקישור
   * ל-`wa.me` עבד בכל זאת, וזה מה שהסתיר את זה.
   */
  it("מספר מקומי מוצג כמו מספר ישראלי, לא כמו בינלאומי שבור", () => {
    expect(displayWhatsappNumber("0553142235")).toBe("055-314-2235");
  });

  it("אותה תוצאה בדיוק כמו מהצורה הבינלאומית — אין שני מסלולים", () => {
    expect(displayWhatsappNumber("0553142235")).toBe(displayWhatsappNumber("972553142235"));
  });

  it("חיוג בינלאומי ישן (00) נפתר גם הוא", () => {
    expect(displayWhatsappNumber("00972553142235")).toBe("055-314-2235");
  });
});
