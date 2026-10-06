import { describe, expect, it } from "vitest";
import { countsWithin, groundedNumbers } from "./insight-guard.js";

const SOURCE = JSON.stringify([
  { name: "משה כהן", city: "גבעתיים", rooms: 4, price: 2450000 },
  { name: "דנה לוי", city: "רמת גן", rooms: 3.5, price: 1900000, nextViewing: "2026-08-27" },
]);

describe("groundedNumbers — מספר שלא נשלף אינו נאמר", () => {
  it("טקסט בלי ספרות תמיד מעוגן — מילים הן פרשנות, לא נתון", () => {
    expect(groundedNumbers("נמצאו שלושה קונים, ואחד מהם חם במיוחד.", [SOURCE])).toBe(true);
  });

  it("מספר שקיים בנתונים עובר, גם בעיצוב אחר", () => {
    expect(groundedNumbers("שניהם מחפשים עד 2,450,000 ש\"ח.", [SOURCE])).toBe(true);
    expect(groundedNumbers("דנה מחפשת 3.5 חדרים.", [SOURCE])).toBe(true);
  });

  it("מחיר מומצא נפסל — גם כשהוא כתוב עם מפרידי אלפים", () => {
    /*
     * בלי איחוד הספרות בצד הטקסט, „1,200,000” מתפרק ל-„1”, „200”,
     * ‎„000” — רצפים שנמצאים כמעט בכל JSON עם מחירים. זה בדיוק
     * העיוורון שהשומר קיים כדי למנוע.
     */
    expect(groundedNumbers("הממוצע סביב 1,200,000 ש\"ח.", [SOURCE])).toBe(false);
    expect(groundedNumbers("נמצאו 17 קונים.", [SOURCE])).toBe(false);
  });

  it("תאריך שעוצב מחדש עובר — חלקיו קיימים במקור הגולמי", () => {
    expect(groundedNumbers("הסיור הקרוב ב-27.8.", [SOURCE])).toBe(true);
  });

  it("מספר מהשאלה של המתווך מעוגן דרך התמליל", () => {
    // „עד 12,500?” — המספר לא חייב להופיע בתוצאות כדי להיאמר בתשובה
    const text = "אין קונים בתקציב של 12,500 לחודש.";
    expect(groundedNumbers(text, [SOURCE, "מי מחפש שכירות עד 12500 שקל?"])).toBe(true);
    expect(groundedNumbers(text, [SOURCE])).toBe(false);
  });

  it("ספרה בודדת מעוגנת כמעט תמיד — השומר מקל בכוונה", () => {
    /*
     * ‎„5” נמצא בתוך „2450000”. זה מתועד ולא באג: השומר תופס מחירים,
     * ספירות וטלפונים — לא ספרות בודדות, שממילא אינן „עובדה” שמתווך
     * יצטט. מי שמצפה כאן ל-false משנה את אופי השומר, לא מתקן אותו.
     */
    expect(groundedNumbers("אולי שווה לחפש גם 5 חדרים.", [SOURCE])).toBe(true);
  });
});

const buyers = (total: number) => ({ section: "buyers", total });
const leads = (total: number) => ({ section: "leads", total });
const offers = (total: number) => ({ section: "offers", total });

describe("countsWithin — ספירה שנאמרה אינה גדולה ממה שחזר", () => {
  it("ספירה במילים שגדולה מהרשימה — נפסלת", () => {
    expect(countsWithin("יש לך שבעה קונים ברמת גן", buyers(2))).toBe(false);
    // ‏רשימה ריקה ומלאה — סך אפס
    expect(countsWithin("יש שבע הצעות שממתינות", offers(0))).toBe(false);
  });

  it("ספירה בספרות שגדולה מהרשימה — נפסלת", () => {
    expect(countsWithin("נמצאו 7 קונים", buyers(2))).toBe(false);
    expect(countsWithin("נמצאו 1,200 קונים", buyers(1199))).toBe(false);
  });

  it("הספירה הנכונה ותת-ספירה — עוברות", () => {
    expect(countsWithin("יש לך שני קונים, ו-1 קונים חמים מהם", buyers(2))).toBe(true);
    expect(countsWithin("שלושה לידים חדשים, ושני לידים מהם חמים", leads(3))).toBe(true);
  });

  it("מספר שאינו ספירה של רשומות — אינו נבדק כאן", () => {
    expect(countsWithin("הפגישה ביום שני בשעה 10", buyers(1))).toBe(true);
    expect(countsWithin("דירה של 5 חדרים", buyers(1))).toBe(true);
  });
});

/*
 * ‏הסך הוא של השורות ברשימה. מדד בתוך שורה — מיילים בשיחה, נכסים
 * ‏מתאימים לביקוש — אינו ספירה שלהן (ביקורת Codex).
 */
describe("countsWithin — רק שמות העצם של הרשימה", () => {
  it("„חמישה מיילים שלא נקראו” בשתי שיחות — אינו ספירה של השיחות", () => {
    const emails = { section: "emails", total: 2 };
    expect(countsWithin("לדנה יש חמישה מיילים שלא נקראו", emails)).toBe(true);
    expect(countsWithin("יש לך חמש שיחות מייל פתוחות", emails)).toBe(false);
  });

  it("נכסים מתאימים לביקוש — מדד בשורה, לא ספירה של הביקושים", () => {
    const demands = { section: "demands", total: 1 };
    expect(countsWithin("לביקוש של רון יש שלושה נכסים מתאימים", demands)).toBe(true);
    expect(countsWithin("יש שלושה ביקושים חדשים ברשת", demands)).toBe(false);
  });

  it("„תוצאות”, „רשומות” — ספירה של השורות בכל רשימה", () => {
    expect(countsWithin("יש שבע תוצאות", buyers(2))).toBe(false);
    expect(countsWithin("מצאתי שתי רשומות", buyers(2))).toBe(true);
    expect(countsWithin("יש תוצאה אחת", { section: "emails", total: 0 })).toBe(false);
  });

  it("משימות ופגישות — נספרות מול הסך שלהן", () => {
    expect(countsWithin("יש לך שבע משימות פתוחות", { section: "tasks", total: 0 })).toBe(false);
    expect(countsWithin("שלוש פגישות היום", { section: "appointments", total: 3 })).toBe(true);
    expect(countsWithin("ארבעה סיורים היום", { section: "appointments", total: 3 })).toBe(false);
    expect(countsWithin("יש שבע התראות חדשות", { section: "notifications", total: 2 })).toBe(false);
  });

  it("רשימה שאין לה שמות עצם מוכרים — אינה נבדקת", () => {
    expect(countsWithin("עשרה דברים", { section: "unknown", total: 0 })).toBe(true);
  });
});

describe("countsWithin — יחיד, ומה שאינו ספירה", () => {
  it("„קונה אחד” כשלא חזר אף קונה — נפסל; כשחזר — עובר", () => {
    expect(countsWithin("יש לך קונה אחד ברמת גן", buyers(0))).toBe(false);
    expect(countsWithin("יש לך קונה אחד ברמת גן", buyers(1))).toBe(true);
  });

  it("„דירות 4 חדרים” אינה ספירה של רשומות", () => {
    expect(countsWithin("שתיהן דירות 4 חדרים", { section: "properties", total: 2 })).toBe(true);
  });
});

describe("countsWithin — מספרים במילים מעל עשר", () => {
  it("עשרות, י״א–י״ט, ו„עשרים ושלושה” — נבדקים מול הסך", () => {
    expect(countsWithin("יש לך עשרים קונים", buyers(12))).toBe(false);
    expect(countsWithin("יש לך שנים עשר קונים", buyers(12))).toBe(true);
    expect(countsWithin("יש לך שלושה עשר קונים", buyers(12))).toBe(false);
    expect(countsWithin("עשרים ושלושה לידים חדשים", leads(23))).toBe(true);
    expect(countsWithin("עשרים ושלושה לידים חדשים", leads(22))).toBe(false);
    expect(countsWithin("מאה הצעות", offers(50))).toBe(false);
    expect(countsWithin("שלוש מאות הצעות", offers(150))).toBe(false);
  });

  // ‏היחידה שלפני „מאות”/„אלפים” כופלת אותן (ביקורת Codex)
  it("„תשע מאות”, „שלושת אלפים” — היחידה כופלת", () => {
    expect(countsWithin("תשע מאות הצעות", offers(500))).toBe(false);
    expect(countsWithin("תשע מאות הצעות", offers(900))).toBe(true);
    expect(countsWithin("שלושת אלפים קונים", buyers(2500))).toBe(false);
    expect(countsWithin("עשרת אלפים קונים", buyers(9999))).toBe(false);
    expect(countsWithin("אלפיים קונים", buyers(1999))).toBe(false);
    expect(countsWithin("מאות הצעות", offers(250))).toBe(true);
    expect(countsWithin("מאות הצעות", offers(150))).toBe(false);
  });

  // ‏מאות ואלפים עם שארית — „מאה וחמישים” (ביקורת Codex)
  it("מספר מורכב — אלפים, מאות ושארית עם „ו”", () => {
    expect(countsWithin("מאה וחמישים הצעות", offers(120))).toBe(false);
    expect(countsWithin("מאה וחמישים הצעות", offers(150))).toBe(true);
    expect(countsWithin("שלושת אלפים ומאתיים וחמישים קונים", buyers(3249))).toBe(false);
    expect(countsWithin("שלושת אלפים ומאתיים וחמישים קונים", buyers(3250))).toBe(true);
    expect(countsWithin("עשרים ושלושה אלף קונים", buyers(22999))).toBe(false);
    expect(countsWithin("ושלושה לידים מהם חמים", leads(2))).toBe(false);
  });

  // ‏„שנים-עשר” במקף — מספר אחד, לא „עשר” (ביקורת Codex)
  it("מספר במקף או במקף עברי — נקרא שלם", () => {
    expect(countsWithin("יש לך שנים-עשר קונים", buyers(10))).toBe(false);
    expect(countsWithin("יש לך שלושה־עשר קונים", buyers(13))).toBe(true);
    expect(countsWithin("יש לך שלושה־עשר קונים", buyers(12))).toBe(false);
  });

  it("מילות מספר צמודות שאינן מספר אחד — אינן מתחברות", () => {
    expect(countsWithin("ביום שני שלושה קונים הגיעו", buyers(3))).toBe(true);
  });
});

describe("countsWithin — הצעות מחיר על נכס", () => {
  it("שורה היא קונה שמתמקח; הצעדים בתוכה אינם ספירה של השורות", () => {
    const bids = { section: "bids", total: 1 };
    expect(countsWithin("משה הגיש שלוש הצעות עד עכשיו", bids)).toBe(true);
    expect(countsWithin("שלושה קונים הציעו על הנכס", bids)).toBe(false);
  });
});
