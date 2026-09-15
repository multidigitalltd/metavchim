import { describe, expect, it } from "vitest";
import {
  averagePerSqmAgorot,
  perSqmGapPercent,
  pricePerSqmAgorot,
} from "./price-per-sqm";

/**
 * ‏הטענה כאן אינה „החלוקה נכונה” אלא **„מתי אין מה להציג”** — זה
 * ‏החלק שנשבר כשכל מסך מחשב לעצמו.
 */
describe("pricePerSqmAgorot", () => {
  it("מחיר ושטח — המחיר למ״ר, מעוגל לאגורה", () => {
    // 2,650,000 ₪ על 100 מ״ר = 26,500 ₪ למ״ר
    expect(pricePerSqmAgorot(265_000_000, 100)).toBe(2_650_000);
  });

  it("מעגל, ולא גורר שבר אגורה", () => {
    expect(pricePerSqmAgorot(100_000, 3)).toBe(33_333);
  });

  /*
   * ‎**שלוש דרכים שבהן „אין מה להציג” נראה אחרת בקוד ואותו דבר
   * ‏למשתמש.** בלי הענפים האלה המסך היה מציג „0 ₪ למ״ר”, „אינסוף”,
   * ‏או NaN — שלושתם על נכס שפשוט לא מילא שדה.
   */
  it("בלי שטח — אין מה להציג", () => {
    expect(pricePerSqmAgorot(265_000_000, undefined)).toBeNull();
    expect(pricePerSqmAgorot(265_000_000, null)).toBeNull();
  });

  it("בלי מחיר — אין מה להציג", () => {
    expect(pricePerSqmAgorot(undefined, 100)).toBeNull();
    expect(pricePerSqmAgorot(null, 100)).toBeNull();
  });

  /* ‏אפס שטח הוא חלוקה באפס — התוצאה הייתה „אינסוף ₪ למ״ר” */
  it("שטח אפס או שלילי — אין מה להציג, ולא אינסוף", () => {
    expect(pricePerSqmAgorot(265_000_000, 0)).toBeNull();
    expect(pricePerSqmAgorot(265_000_000, -50)).toBeNull();
  });

  /* ‏מחיר אפס הוא „טרם הוזן”, ולא „הנכס שווה אפס” */
  it("מחיר אפס או שלילי — אין מה להציג", () => {
    expect(pricePerSqmAgorot(0, 100)).toBeNull();
    expect(pricePerSqmAgorot(-1, 100)).toBeNull();
  });

  /* ‏קלט פגום מייבוא Excel אינו אמור להגיע למסך כמספר */
  it("ערך שאינו סופי — אין מה להציג", () => {
    expect(pricePerSqmAgorot(Number.NaN, 100)).toBeNull();
    expect(pricePerSqmAgorot(265_000_000, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("averagePerSqmAgorot", () => {
  const row = (shekels: number, area: number) => ({ priceAgorot: shekels * 100, areaSqm: area });

  it("ממוצע המחירים למ״ר, עם הכמות שהוא נשען עליה", () => {
    // 20,000 / 30,000 / 40,000 ₪ למ״ר → 30,000
    expect(
      averagePerSqmAgorot([row(2_000_000, 100), row(3_000_000, 100), row(4_000_000, 100)]),
    ).toEqual({ avgPerSqmAgorot: 3_000_000, count: 3 });
  });

  /*
   * ‎**ההבחנה שקל לפספס.** סך המחירים חלקי סך השטח היה נותן כאן
   * ‏‎15,000 ₪ למ״ר — כי הנכס הגדול מושך את התוצאה אליו. „ממוצע
   * ‏למ״ר” הוא ממוצע של המחירים למ״ר, וזה 20,000.
   */
  it("ממוצע של המחירים למ״ר, ולא סך חלקי סך", () => {
    const result = averagePerSqmAgorot([
      row(1_000_000, 50), // 20,000
      row(1_000_000, 50), // 20,000
      row(3_000_000, 300), // 10,000 — הגדול
    ]);
    expect(result?.avgPerSqmAgorot).toBe(1_666_667);
  });

  /* ‏ממוצע של אחד הוא המחיר של אותו נכס, לא אמת מידה */
  it("מתחת לסף המדגם — אין ממוצע", () => {
    expect(averagePerSqmAgorot([row(2_000_000, 100)])).toBeNull();
    expect(averagePerSqmAgorot([row(2_000_000, 100), row(3_000_000, 100)])).toBeNull();
  });

  /* ‏שורה בלי שטח אינה „אפס למ״ר” — היא אינה נספרת כלל */
  it("שורות בלי מחיר או שטח יורדות מהמדגם ולא מאפסות אותו", () => {
    expect(
      averagePerSqmAgorot([
        row(2_000_000, 100),
        { priceAgorot: 2_000_000, areaSqm: null },
        { priceAgorot: null, areaSqm: 100 },
      ]),
    ).toBeNull();
  });

  it("רשימה ריקה — אין ממוצע", () => {
    expect(averagePerSqmAgorot([])).toBeNull();
  });
});

describe("perSqmGapPercent", () => {
  const benchmark = { avgPerSqmAgorot: 2_000_000, count: 5 };

  it("יקר מהממוצע — אחוז חיובי", () => {
    expect(perSqmGapPercent(2_200_000, benchmark)).toBe(10);
  });

  it("זול מהממוצע — אחוז שלילי", () => {
    expect(perSqmGapPercent(1_800_000, benchmark)).toBe(-10);
  });

  it("בדיוק הממוצע — אפס, ולא null", () => {
    expect(perSqmGapPercent(2_000_000, benchmark)).toBe(0);
  });

  it("בלי אחד מהשניים — אין מה להשוות", () => {
    expect(perSqmGapPercent(null, benchmark)).toBeNull();
    expect(perSqmGapPercent(2_000_000, null)).toBeNull();
  });

  /* ‏ממוצע אפס אינו אמור להתקיים — אבל חלוקה בו הייתה מחזירה אינסוף */
  it("ממוצע אפס — אין מה להשוות, ולא אינסוף", () => {
    expect(perSqmGapPercent(2_000_000, { avgPerSqmAgorot: 0, count: 5 })).toBeNull();
  });
});
