import { describe, expect, it } from "vitest";

import {
  FLOOR_CHOICES,
  FLOOR_MAX,
  FLOOR_MIN,
  floorLabel,
  floorMatches,
  floorPreferenceText,
} from "./floor-preference.js";
import { BuyerRequirementsSchema } from "../schemas/buyer.js";

const base = { cities: [], neighborhoods: [], searchAreas: [], dealType: "sale" as const };

describe("קומה רצויה", () => {
  describe("„לא נאמר” אינו „לא מתאים”", () => {
    it("בלי העדפה — אין מה לבדוק", () => {
      expect(floorMatches(undefined, 3)).toBeNull();
    });

    /*
     * ‎**הכיוון החשוב יותר.** נכס בלי קומה רשומה היה נפסל אילו
     * החזרנו `false`, כלומר כרטיס חסר-נתון היה נראה כמו כרטיס לא
     * מתאים — וזה בדיוק ההבדל שרצועת ההסבר קיימת כדי להראות.
     */
    it("ונכס בלי קומה רשומה אינו נפסל", () => {
      expect(floorMatches({ mode: "list", floors: [0, 1] }, undefined)).toBeNull();
      expect(floorMatches({ mode: "range", min: 3 }, undefined)).toBeNull();
    });

    it("וטווח פתוח משני הצדדים הוא כמו שלא נאמר דבר", () => {
      expect(floorMatches({ mode: "range" }, 7)).toBeNull();
    });
  });

  describe("טווח", () => {
    it.each([
      [{ min: 3 }, 3, true],
      [{ min: 3 }, 2, false],
      [{ min: 3 }, 40, true],
      [{ max: 2 }, 2, true],
      [{ max: 2 }, 3, false],
      [{ max: 2 }, -1, true],
      [{ min: 1, max: 4 }, 1, true],
      [{ min: 1, max: 4 }, 4, true],
      [{ min: 1, max: 4 }, 0, false],
      [{ min: 1, max: 4 }, 5, false],
    ])("%o מול קומה %i ⇒ %s", (range, floor, expected) => {
      expect(floorMatches({ mode: "range", ...range }, floor)).toBe(expected);
    });

    /* הקצוות **בפנים**: „משלוש ומעלה” כולל את שלוש. */
    it("הגבולות כלולים", () => {
      expect(floorMatches({ mode: "range", min: 3, max: 3 }, 3)).toBe(true);
    });
  });

  describe("רשימה", () => {
    it("שייכות לקבוצה, ולא טווח שנגזר ממנה", () => {
      const pick = { mode: "list", floors: [0, 5] } as const;
      expect(floorMatches(pick, 0)).toBe(true);
      expect(floorMatches(pick, 5)).toBe(true);
      /*
       * ‎**זה הלב.** קומה 3 היא „בין” 0 ל-5, ובכל זאת לא נבחרה.
       * מימוש שגוזר טווח מהרשימה היה עונה כאן „מתאים”.
       */
      expect(floorMatches(pick, 3)).toBe(false);
    });

    it("קרקע ומרתף הם ערכים ככל ערך אחר", () => {
      expect(floorMatches({ mode: "list", floors: [0] }, 0)).toBe(true);
      expect(floorMatches({ mode: "list", floors: [-1] }, -1)).toBe(true);
      expect(floorMatches({ mode: "list", floors: [0] }, -1)).toBe(false);
    });
  });

  describe("תוויות", () => {
    it.each([
      [-1, "מרתף"],
      [0, "קרקע"],
      [1, "קומה 1"],
      [20, "קומה 20"],
    ])("קומה %i נקראת %s", (floor, label) => {
      expect(floorLabel(floor)).toBe(label);
    });

    it.each([
      [{ mode: "range", min: 3 } as const, "קומה 3 ומעלה"],
      [{ mode: "range", max: 2 } as const, "עד קומה 2"],
      [{ mode: "range", min: 1, max: 4 } as const, "קומה 1 עד קומה 4"],
      [{ mode: "range", min: 2, max: 2 } as const, "קומה 2"],
      [{ mode: "list", floors: [0, 1] } as const, "קרקע, קומה 1"],
    ])("%o נאמר „%s”", (preference, text) => {
      expect(floorPreferenceText(preference)).toBe(text);
    });

    /*
     * הסדר שבו סומנו התיבות אינו סדר שמישהו רוצה לקרוא: „קרקע, 5, 1”
     * הוא אותה דרישה בדיוק ונראה כמו טעות.
     */
    it("והרשימה ממוינת בקריאה, לא בסדר הסימון", () => {
      expect(floorPreferenceText({ mode: "list", floors: [5, 0, 1] })).toBe(
        "קרקע, קומה 1, קומה 5",
      );
    });

    it("וטווח ריק אינו מנוסח כלל", () => {
      expect(floorPreferenceText({ mode: "range" })).toBeUndefined();
      expect(floorPreferenceText(undefined)).toBeUndefined();
    });
  });

  describe("הצורה מונעת שאלה שאין לה תשובה טובה", () => {
    /*
     * ‎**שדה שנושא גם טווח וגם רשימה** היה מוליד את „מה גובר”, ולכל
     * תשובה יש מקרה שבו היא מפתיעה. ה-`union` המתויג מונע את השאלה
     * מלהיוולד — וזה נבדק ולא מונח.
     */
    it("טווח ורשימה יחד נדחים", () => {
      const parsed = BuyerRequirementsSchema.safeParse({
        ...base,
        floorPreference: { mode: "range", min: 1, floors: [3] },
      });
      /* `mode: "range"` אינו מכיר `floors`, ו-`mode` יחיד אינו יכול להיות שניהם */
      expect(parsed.success && "floors" in (parsed.data.floorPreference ?? {})).toBe(false);
    });

    it("רשימה ריקה נדחית — „בחרתי כלום” אינו מצב", () => {
      expect(
        BuyerRequirementsSchema.safeParse({
          ...base,
          floorPreference: { mode: "list", floors: [] },
        }).success,
      ).toBe(false);
    });

    it("וקומה מחוץ לגבולות הנכס נדחית", () => {
      for (const bad of [FLOOR_MIN - 1, FLOOR_MAX + 1, 1.5]) {
        expect(
          BuyerRequirementsSchema.safeParse({
            ...base,
            floorPreference: { mode: "list", floors: [bad] },
          }).success,
          String(bad),
        ).toBe(false);
      }
    });

    /* כרטיס קיים בלי השדה נשאר תקין — זו קריאה שרצה על כל שורה במסד */
    it("וכרטיס בלי השדה נקרא כרגיל", () => {
      const parsed = BuyerRequirementsSchema.safeParse(base);
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.floorPreference).toBeUndefined();
    });
  });

  /*
   * הצ׳קליסט מכסה מרתף, קרקע ו-20 קומות. מי שמחפש גבוה מזה מחפש
   * טווח („גבוה”) ולא מסמן תיבה ברשימה של שישים.
   */
  it("הצ׳קליסט מוצע במלואו ובגבולות הנכס", () => {
    expect(FLOOR_CHOICES[0]).toBe(-1);
    expect(FLOOR_CHOICES.at(-1)).toBe(20);
    expect(FLOOR_CHOICES).toHaveLength(22);
    for (const floor of FLOOR_CHOICES) {
      expect(floor).toBeGreaterThanOrEqual(FLOOR_MIN);
      expect(floor).toBeLessThanOrEqual(FLOOR_MAX);
    }
  });
});
