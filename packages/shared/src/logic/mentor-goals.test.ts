import { describe, expect, it } from "vitest";
import {
  backwardPlan,
  comparePeriods,
  DEFAULT_RATIOS,
  HORIZON_WEEKS,
  mentorMoments,
  ON_TRACK_THRESHOLD,
  splitToHorizon,
  weekKey,
  weeklyScore,
} from "./mentor-goals.js";

/**
 * ‏מנוע היעדים הוא חשבון טהור, ולכן הוא נבדק על **התנהגות** ולא על
 * מבנה: מה קורה כשהיעד גבוה, כשחסר נתון, כשהשבוע נגמר בדיוק על
 * הסף, וכשהתקופה הקודמת הייתה אפס.
 *
 * ‏שלושת המקרים שהכי קל לפספס ושחוזרים כאן שוב ושוב: חלוקה באפס,
 * ‏עודף שמפצה על חוסר, ושינוי באחוזים ממצב של אפס.
 */

const RATIOS = { callToAppointment: 0.09, appointmentToOffer: 0.64, offerToDeal: 0.11 };

describe("החישוב לאחור", () => {
  /*
   * ‏המספר שמעניין את המתווך הוא האחרון: כמה שיחות מחר בבוקר. שאר
   * השורות הן הדרך אליו, וכל אחת מהן חייבת להיות גדולה מזו שמתחתיה
   * — משפך שמתרחב כלפי מטה אינו משפך.
   */
  it("מיעד עמלות ועד שיחות ליום — והמשפך מתרחב לכל אורכו", () => {
    const plan = backwardPlan({
      target: 65_000_000, // 650,000 ₪ באגורות
      unit: "commission",
      averageCommissionAgorot: 2_800_000, // 28,000 ₪
      ratios: RATIOS,
    });
    expect(plan.incomplete).toBe(false);
    expect(plan.dealsPerYear).toBe(24);
    expect(plan.offersPerYear).toBeGreaterThan(plan.dealsPerYear);
    expect(plan.appointmentsPerYear).toBeGreaterThan(plan.offersPerYear);
    expect(plan.callsPerYear).toBeGreaterThan(plan.appointmentsPerYear);
    expect(plan.callsPerWorkday).toBeGreaterThan(0);
  });

  /*
   * ‎**עיגול כלפי מעלה בכל שלב.** תוכנית שמעגלת כלפי מטה מייצרת יעד
   * שמי שיעמוד בו בדיוק עדיין יפספס את השנתי.
   */
  it("כל שלב מעוגל כלפי מעלה", () => {
    const plan = backwardPlan({
      target: 100,
      unit: "deals",
      ratios: { callToAppointment: 0.3, appointmentToOffer: 0.3, offerToDeal: 0.3 },
    });
    // 100/0.3 = 333.33 ⇒ 334, ולא 333
    expect(plan.offersPerYear).toBe(334);
  });

  /*
   * ‎**יעד בעמלות בלי עמלה ממוצעת אינו ניתן לחישוב.** להניח מספר
   * פירושו להמציא את כל התוכנית, ומסך שמציג „0 שיחות ביום” על חישוב
   * שלא רץ משקר בשקט.
   */
  it("בלי עמלה ממוצעת — לא מחשב, ומודה בזה", () => {
    const plan = backwardPlan({ target: 65_000_000, unit: "commission", ratios: RATIOS });
    expect(plan.incomplete).toBe(true);
    expect(plan.callsPerWorkday).toBe(0);
  });

  /* „עסקאות” ו„בלעדיות” הן כבר ספירה — אין להן המרה לכסף */
  it("יעד בעסקאות אינו דורש עמלה ממוצעת", () => {
    const plan = backwardPlan({ target: 24, unit: "deals", ratios: RATIOS });
    expect(plan.incomplete).toBe(false);
    expect(plan.dealsPerYear).toBe(24);
  });

  /*
   * ‎**יחס אפס הוא חלוקה באפס.** בלי השמירה הזו התוכנית מציגה
   * ‎`Infinity` שיחות ביום — מספר שנראה כמו באג ואינו ניתן לפעולה.
   */
  it("יחס המרה אפס אינו מייצר אינסוף", () => {
    const plan = backwardPlan({
      target: 24,
      unit: "deals",
      ratios: { ...RATIOS, callToAppointment: 0 },
    });
    expect(plan.incomplete).toBe(true);
    expect(Number.isFinite(plan.callsPerWorkday)).toBe(true);
  });

  it("יעד אפס או שלילי אינו תוכנית", () => {
    for (const target of [0, -5, Number.NaN]) {
      expect(backwardPlan({ target, unit: "deals", ratios: RATIOS }).incomplete).toBe(true);
    }
  });

  /* ברירות המחדל הענפיות חייבות להיות שמישות, אחרת אין נקודת פתיחה */
  it("ברירות המחדל הענפיות מייצרות תוכנית שלמה", () => {
    const plan = backwardPlan({
      target: 12,
      unit: "deals",
      ratios: DEFAULT_RATIOS,
    });
    expect(plan.incomplete).toBe(false);
  });
});

describe("פריסה בין האופקים", () => {
  it("חצי שנה הוא חצי מהשנה, ומחזור הוא רבע ממנה", () => {
    expect(splitToHorizon(52, "half")).toBe(26);
    expect(splitToHorizon(52, "cycle")).toBe(13);
    expect(splitToHorizon(52, "week")).toBe(1);
  });

  /*
   * ‎**האופקים חייבים להתחבר לשנה.** זו הבדיקה שהפילה את הבחירה
   * הראשונה: מחזור בן 12 שבועות נותן 4 × 12 = 48, כלומר ארבעה
   * מחזורים מושלמים שעדיין מפספסים את היעד השנתי. מנטור שהחשבון
   * שלו אינו סוגר הוא מנטור שאי אפשר לסמוך עליו.
   */
  it("ארבעה מחזורים ושתי מחציות מכסים שנה שלמה", () => {
    expect(HORIZON_WEEKS.cycle * 4).toBe(HORIZON_WEEKS.year);
    expect(HORIZON_WEEKS.half * 2).toBe(HORIZON_WEEKS.year);
    expect(HORIZON_WEEKS.week * 52).toBe(HORIZON_WEEKS.year);
  });

  it("עיגול כלפי מעלה — ארבעה מחזורים מכסים את היעד השנתי", () => {
    for (const target of [100, 7, 24, 365]) {
      expect(splitToHorizon(target, "cycle") * 4).toBeGreaterThanOrEqual(target);
      expect(splitToHorizon(target, "half") * 2).toBeGreaterThanOrEqual(target);
    }
  });
});

describe("הציון השבועי", () => {
  /*
   * ‎**עודף אינו מפצה על חוסר.** בלי החיתוך ל-100% לכל פעולה, מאה
   * שיחות ביום אחד היו „מכסות” אפס פגישות — ציון שנראה טוב ואינו
   * אומר דבר.
   */
  it("עודף בפעולה אחת אינו מכסה חוסר באחרת", () => {
    const score = weeklyScore(
      { calls: 40, appointments: 6 },
      { calls: 400, appointments: 0 },
    );
    expect(score.percent).toBe(50);
    expect(score.onTrack).toBe(false);
  });

  it("‎85% הוא הסף, והוא כולל", () => {
    expect(weeklyScore({ calls: 100 }, { calls: 85 }).onTrack).toBe(true);
    expect(weeklyScore({ calls: 100 }, { calls: 84 }).onTrack).toBe(false);
    expect(ON_TRACK_THRESHOLD).toBe(85);
  });

  /* פעולה שלא התחייבו לה אינה נספרת — יעד ריק אינו ציון אפס */
  it("פעולות שלא הובטחו אינן נכנסות לציון", () => {
    const score = weeklyScore({ calls: 10 }, { calls: 10, offers: 0 });
    expect(score.lines).toHaveLength(1);
    expect(score.percent).toBe(100);
  });

  it("בלי התחייבות כלל — אין ציון ואין „מאחור”", () => {
    const score = weeklyScore({}, { calls: 30 });
    expect(score.percent).toBe(0);
    expect(score.onTrack).toBe(false);
    expect(score.lines).toEqual([]);
  });

  it("כל שורה אומרת כמה נשאר", () => {
    const score = weeklyScore({ calls: 40 }, { calls: 31 });
    expect(score.lines[0]).toMatchObject({ committed: 40, actual: 31, remaining: 9 });
  });
});

describe("מתי למנטור יש מה לומר", () => {
  const full = weeklyScore({ calls: 40 }, { calls: 40 });
  const near = weeklyScore({ calls: 40, appointments: 10 }, { calls: 37, appointments: 9 });
  const behind = weeklyScore({ calls: 40 }, { calls: 12 });

  it("יעד שהושלם — חוגגים, ולא מוסיפים עידוד מיותר", () => {
    const moments = mentorMoments({ score: full, weekday: 3 });
    expect(moments).toHaveLength(1);
    expect(moments[0]?.kind).toBe("week_complete");
  });

  /*
   * ‎**מדרג-היעד:** העידוד יושב על הפעולה הקרובה ביותר לסיום — היא
   * הניצחון הזמין, ולכן היא זו שמזיזה.
   */
  it("קרוב ליעד — מצביע על הפעולה שהכי קרובה להסתיים", () => {
    const moments = mentorMoments({ score: near, weekday: 4 });
    expect(moments[0]?.kind).toBe("almost_there");
    expect(moments[0]?.measure).toBe("appointments");
    expect(moments[0]?.remaining).toBe(1);
  });

  /*
   * ‏אמצע שבוע בלבד: ביום ראשון אין על מה לדבר, ובשישי כבר מאוחר
   * מכדי לתקן — והודעה שאי אפשר לפעול לפיה היא רק אשמה.
   */
  it("„מאחור” נאמר באמצע השבוע, ולא בתחילתו ולא בסופו", () => {
    expect(mentorMoments({ score: behind, weekday: 2 })[0]?.kind).toBe("midweek_behind");
    expect(mentorMoments({ score: behind, weekday: 3 })[0]?.kind).toBe("midweek_behind");
    expect(mentorMoments({ score: behind, weekday: 4 }).map((m) => m.kind)).not.toContain(
      "midweek_behind",
    );
    expect(mentorMoments({ score: behind, weekday: 0 }).map((m) => m.kind)).not.toContain(
      "midweek_behind",
    );
  });

  /* שבוע חלש אחד אינו סיפור; שניים ברציפות הם שאלה, לא נזיפה */
  it("שני שבועות חלשים ברציפות — פנייה אחת, בתחילת השבוע", () => {
    const kinds = mentorMoments({ score: behind, weekday: 0, previousPercent: 40 }).map(
      (m) => m.kind,
    );
    expect(kinds).toContain("two_weak_weeks");
    expect(
      mentorMoments({ score: behind, weekday: 0, previousPercent: 95 }).map((m) => m.kind),
    ).not.toContain("two_weak_weeks");
  });

  /*
   * ‎**שתיקה היא התשובה הנפוצה.** מנטור שמדבר בכל יום נעשה רעש
   * שמסננים, ואז גם ההודעה שבאמת חשובה אינה נקראת.
   */
  it("בלי יעד — אין מה לומר", () => {
    expect(mentorMoments({ score: weeklyScore({}, {}), weekday: 3 })).toEqual([]);
  });

  it("על המסלול באמצע השבוע — אין הודעת „מאחור”", () => {
    const onTrack = weeklyScore({ calls: 40 }, { calls: 36 });
    const kinds = mentorMoments({ score: onTrack, weekday: 3 }).map((m) => m.kind);
    expect(kinds).not.toContain("midweek_behind");
  });
});

describe("איפה היית, ואיפה אתה", () => {
  it("עלייה, ירידה ושוויון", () => {
    expect(comparePeriods(9, 6).direction).toBe("up");
    expect(comparePeriods(9, 6).changePercent).toBe(50);
    expect(comparePeriods(4, 6).direction).toBe("down");
    expect(comparePeriods(6, 6).direction).toBe("same");
  });

  /*
   * ‎**מאפס אין אחוזים.** מי שסגר עסקה ראשונה לא „השתפר ב-100%”,
   * הוא התחיל — וזה משפט אחר לגמרי, שהמסך צריך לדעת לכתוב.
   */
  it("תקופה קודמת של אפס אינה אחוז שינוי", () => {
    const c = comparePeriods(3, 0);
    expect(c.changePercent).toBeNull();
    expect(c.direction).toBe("up");
  });
});

describe("מפתח השבוע", () => {
  /*
   * ‏השבוע נמדד בלוח הישראלי — ראשון עד שבת — ולא בשעון המכשיר של
   * מי שפתח את המסך.
   */
  it("כל ימות השבוע מצביעים על אותו יום ראשון", () => {
    // ראשון 2026-08-30 עד שבת 2026-09-05
    const keys = [
      "2026-08-30T06:00:00Z",
      "2026-09-01T22:00:00Z",
      "2026-09-05T20:00:00Z",
    ].map((iso) => weekKey(new Date(iso)));
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe("2026-08-30");
  });

  it("יום ראשון הבא פותח שבוע חדש", () => {
    expect(weekKey(new Date("2026-09-06T06:00:00Z"))).toBe("2026-09-06");
  });
});
