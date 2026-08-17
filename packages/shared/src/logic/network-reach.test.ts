import { describe, expect, it } from "vitest";
import {
  REACH_MIN_SCORE,
  describeReach,
  rankReach,
  summarizeReach,
} from "./network-reach.js";

describe("rankReach", () => {
  it("פריט משותף אינו הזדמנות שהוחמצה", () => {
    const out = rankReach([
      { id: "a", title: "דירה בפתח תקווה", shared: true, scores: [95, 88] },
    ]);
    expect(out).toHaveLength(0);
  });

  /*
   * זו הבדיקה שמונעת את ההבטחה הריקה: "פרסמו את הנכס" על נכס שאף
   * ביקוש ברשת לא מחפש הוא בקשה להאמין לכלום, ואחרי פעמיים כאלה
   * המשתמש מפסיק להאמין גם להצעה האמיתית.
   */
  it("פריט בלי התאמה מעל הסף אינו מוצע לפרסום", () => {
    const out = rankReach([
      {
        id: "a",
        title: "דירה",
        shared: false,
        scores: [REACH_MIN_SCORE - 1, 40],
      },
    ]);
    expect(out).toHaveLength(0);
  });

  it("סופר רק את ההתאמות שמעל הסף", () => {
    const [item] = rankReach([
      { id: "a", title: "דירה", shared: false, scores: [95, 71, 60, 12] },
    ]);
    expect(item?.matches).toBe(2);
    expect(item?.bestScore).toBe(95);
  });

  /* נכס אחד ב-95% שווה יותר משלושה ב-71% — מי שרואה שורה אחת רוצה את הטובה */
  it("ממיין לפי ההתאמה הטובה ביותר ולא לפי הכמות", () => {
    const out = rankReach([
      { id: "many", title: "רבים", shared: false, scores: [71, 72, 73] },
      { id: "best", title: "הטוב", shared: false, scores: [95] },
    ]);
    expect(out.map((i) => i.id)).toEqual(["best", "many"]);
  });

  it("הסף עצמו נחשב התאמה", () => {
    const [item] = rankReach([
      { id: "a", title: "דירה", shared: false, scores: [REACH_MIN_SCORE] },
    ]);
    expect(item?.matches).toBe(1);
  });
});

describe("summarizeReach", () => {
  it("בלי כלום — `any` שקרי, כדי שהקורא לא יציג שורה שמכריזה על אפס", () => {
    const s = summarizeReach({ properties: [], buyers: [] });
    expect(s.any).toBe(false);
    expect(describeReach(s)).toBeNull();
  });

  it("מפריד בין נכסים לקונים", () => {
    const s = summarizeReach({
      properties: [{ id: "p", title: "דירה", shared: false, scores: [90] }],
      buyers: [{ id: "b", title: "יוסי", shared: false, scores: [80] }],
    });
    expect(s.properties).toHaveLength(1);
    expect(s.buyers).toHaveLength(1);
    expect(s.any).toBe(true);
  });
});

describe("describeReach", () => {
  it("יחיד ורבים בעברית תקינה", () => {
    expect(
      describeReach(
        summarizeReach({
          properties: [{ id: "p", title: "דירה", shared: false, scores: [90] }],
          buyers: [],
        }),
      ),
    ).toBe("נכס אחד שלכם מתאים למשהו שכבר ברשת — ואינם מפורסמים בה");

    expect(
      describeReach(
        summarizeReach({
          properties: [
            { id: "p1", title: "א", shared: false, scores: [90] },
            { id: "p2", title: "ב", shared: false, scores: [80] },
          ],
          buyers: [{ id: "b", title: "יוסי", shared: false, scores: [80] }],
        }),
      ),
    ).toBe(
      "2 מהנכסים שלכם ו-קונה אחד שלכם מתאימים למשהו שכבר ברשת — ואינם מפורסמים בה",
    );
  });
});
