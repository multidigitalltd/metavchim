import { describe, expect, it, vi } from "vitest";
import { ServiceUnavailableException } from "@nestjs/common";
import { chargeFixedWindow, releaseFixedWindow } from "./fixed-window-quota";

/**
 * ‎**מה נבדק כאן, ומה לא.**
 *
 * ‏הסקריפט עצמו רץ בתוך Redis, ולכן אי אפשר לאמת כאן את האטומיות —
 * ‏זו תכונה של השרת. מה שכן נשבר בשקט הוא **המסירה**: כמה מפתחות
 * ‏הוכרזו, באיזה סדר הם נמסרו, ומה נעשה בתשובה. `numkeys` שגוי
 * ‏אינו מפיל דבר — הוא רק גורם ל-`KEYS[2]` להיות ריק, כלומר לחותם
 * ‏החלון להיעלם ולכל החזר לפספס. בדיוק זה נבדק.
 */

function redisReturning(reply: unknown): { eval: ReturnType<typeof vi.fn> } {
  return { eval: vi.fn(async () => reply) };
}

const BASE = { key: "k", limit: 3, windowSeconds: 60, unavailableMessage: "לא זמין" };

describe("מסירת המפתחות לסקריפט", () => {
  it("בלי חותם — מפתח אחד מוכרז, ואין מפתח שני", async () => {
    const redis = redisReturning([1, ""]);
    await chargeFixedWindow(redis as never, BASE);
    const args = redis.eval.mock.calls[0]!;
    /* [script, numkeys, key, windowSeconds, stamp, limit] */
    expect(args[1]).toBe(1);
    expect(args[2]).toBe("k");
    expect(args.slice(3)).toEqual(["60", "", "3"]);
  });

  /*
   * ‏זו הטעות שהייתה נעלמת בשקט: שני מפתחות נמסרים אבל רק אחד
   * ‏מוכרז, ואז `KEYS[2]` ריק — החותם אינו נכתב, `window` חוזר
   * ‏`null`, וכל החזר מכסה מפספס לנצח.
   */
  it("עם חותם — שני מפתחות מוכרזים, והמונה לפני החותם", async () => {
    const redis = redisReturning([1, "w1"]);
    const out = await chargeFixedWindow(redis as never, {
      ...BASE,
      stampKey: "k:window",
      stamp: "w1",
    });
    const args = redis.eval.mock.calls[0]!;
    expect(args[1]).toBe(2);
    expect(args[2]).toBe("k");
    expect(args[3]).toBe("k:window");
    expect(args.slice(4)).toEqual(["60", "w1", "3"]);
    expect(out).toEqual({ allowed: true, window: "w1" });
  });
});

describe("קריאת התשובה", () => {
  it("‎0 = נדחה", async () => {
    const out = await chargeFixedWindow(redisReturning([0, ""]) as never, BASE);
    expect(out.allowed).toBe(false);
  });

  /*
   * ‎**כשל לכיוון הסגור.** „אם זה מספר וגם מעל התקרה” היה הופך
   * ‏תקלה בספירה לביטול ההגבלה — כלומר הנתיב המוגן ביותר נפתח
   * ‏לרווחה בדיוק כשהתשתית מתנדנדת.
   */
  it("תשובה שאי אפשר לקרוא — עוצרת, ולא מאשרת", async () => {
    for (const reply of [null, "מה", [], ["1", ""], undefined]) {
      await expect(chargeFixedWindow(redisReturning(reply) as never, BASE)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    }
  });

  /* ‏חותם שלא נקרא — עדיף לגבות יתר על החזר שיפגע בחלון זר. */
  it("בלי מזהה חלון בתשובה — `window` הוא null", async () => {
    const out = await chargeFixedWindow(redisReturning([1]) as never, {
      ...BASE,
      stampKey: "k:window",
      stamp: "w1",
    });
    expect(out).toEqual({ allowed: true, window: null });
  });
});

describe("ההחזר", () => {
  it("מוסר את שני המפתחות ואת החותם שנגבה", async () => {
    const redis = redisReturning(1);
    await releaseFixedWindow(redis as never, { key: "k", stampKey: "k:window", window: "w1" });
    const args = redis.eval.mock.calls[0]!;
    expect(args[1]).toBe(2);
    expect(args.slice(2)).toEqual(["k", "k:window", "w1"]);
  });
});
