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
  goalPeriod,
  GOAL_HORIZON_LABELS,
  GOAL_HORIZONS,
  GOAL_UNIT_KIND,
  GOAL_UNIT_LABELS,
  GOAL_UNIT_NOTES,
  GOAL_UNITS,
  LEAD_MEASURE_LABELS,
  LEAD_MEASURES,
  mentorLine,
  mentorOpeningLine,
  type MomentKind,
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
    expect(plan.callsPerWorkday).toBeNull();
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
    /*
     * ‏מה שנבדק כאן הוא שאינסוף לא דלף החוצה. מאז שהשורות הן
     * ‎`number | null`, „לא חושב” הוא `null` — ו-`Number.isFinite`
     * לבדו היה עובר גם על `Infinity` שהוסב ל-`null` וגם נכשל על
     * ‎`null` תקין, כלומר בודק את הטיפוס ולא את הכוונה.
     */
    expect(plan.callsPerWorkday).toBeNull();
    for (const value of Object.values(plan)) {
      if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
    }
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
    const kinds = mentorMoments({
      score: behind,
      weekday: 0,
      previousPercents: [40, 55],
    }).map((m) => m.kind);
    expect(kinds).toContain("two_weak_weeks");
    expect(
      mentorMoments({ score: behind, weekday: 0, previousPercents: [95, 90] }).map(
        (m) => m.kind,
      ),
    ).not.toContain("two_weak_weeks");
  });

  it("שבוע חלש אחד שהסתיים אינו „פעמיים ברצף”", () => {
    /*
     * ‎**הבאג שהיה כאן** (ביקורת Codex, P2): ביום ראשון השבוע
     * הנוכחי הוא בן יום אחד וממילא מתחת לסף, ולכן „השבוע שעבר היה
     * חלש” לבדו הספיק — וההודעה נשלחה אחרי שבוע חלש **אחד**.
     *
     * ‏מנטור שסופר לא נכון גרוע ממנטור ששותק: ברגע שהוא טועה
     * במספר, אי אפשר לסמוך על שום דבר אחר שהוא אומר.
     */
    expect(
      mentorMoments({ score: behind, weekday: 0, previousPercents: [40] }).map(
        (m) => m.kind,
      ),
    ).not.toContain("two_weak_weeks");
    // השבוע שלפני האחרון היה טוב ⇒ אין רצף
    expect(
      mentorMoments({ score: behind, weekday: 0, previousPercents: [40, 92] }).map(
        (m) => m.kind,
      ),
    ).not.toContain("two_weak_weeks");
  });

  it("„פעמיים ברצף” נאמר רק בתחילת שבוע, לא באמצעו", () => {
    // באמצע השבוע יש עוד מה לתקן, ולכן ההודעה היא „midweek_behind”
    expect(
      mentorMoments({ score: behind, weekday: 3, previousPercents: [40, 55] }).map(
        (m) => m.kind,
      ),
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

/* ==========================================================================
 * ‏תקופות היעד — מרוצפות מהראשון בינואר, בלי חורים ובלי חפיפה
 * ========================================================================== */

describe("goalPeriod — התקופה שאליה היעד שייך", () => {
  /** חצות בשעון ישראל של תאריך נתון, כ-`Date` */
  const at = (iso: string): Date => new Date(`${iso}T09:00:00Z`);

  it("השנה היא שנה קלנדרית מלאה", () => {
    expect(goalPeriod("year", at("2026-06-15"))).toEqual({
      start: "2026-01-01",
      end: "2026-12-31",
    });
  });

  it("שנה מעוברת נסגרת ב-31 בדצמבר גם היא", () => {
    expect(goalPeriod("year", at("2028-03-01")).end).toBe("2028-12-31");
  });

  it("המחזור הראשון מתחיל בראשון בינואר", () => {
    expect(goalPeriod("cycle", at("2026-01-05")).start).toBe("2026-01-01");
  });

  it("ארבעת המחזורים מכסים את השנה ברצף — בלי חור ובלי חפיפה", () => {
    /*
     * ‏זו הבדיקה שכל השאר משרתות. תקופות שאינן מתחברות פירושן יום
     * שבו אין מחזור פעיל: המנטור שותק, והציון של אותו יום נעלם.
     */
    const seen: { start: string; end: string }[] = [];
    for (const day of ["2026-01-01", "2026-04-15", "2026-07-20", "2026-11-30"]) {
      const period = goalPeriod("cycle", at(day));
      if (!seen.some((p) => p.start === period.start)) seen.push(period);
    }
    expect(seen).toHaveLength(4);
    expect(seen[0]!.start).toBe("2026-01-01");
    expect(seen[3]!.end).toBe("2026-12-31");
    for (let i = 1; i < seen.length; i += 1) {
      const previousEnd = new Date(`${seen[i - 1]!.end}T12:00:00Z`);
      const thisStart = new Date(`${seen[i]!.start}T12:00:00Z`);
      // היום שאחרי סוף הקודם הוא בדיוק תחילת הבא
      expect((thisStart.getTime() - previousEnd.getTime()) / 86_400_000).toBe(1);
    }
  });

  it("היום האחרון בשנה שייך למחזור האחרון, ולא לחמישי שאינו קיים", () => {
    /*
     * ‎4 × 13 שבועות הם 364 ימים. בלי המתיחה, ה-31 בדצמבר היה נופל
     * מחוץ לכל מחזור — כלומר בדיוק ביום שבו סוגרים את השנה, המנטור
     * לא היה יודע לאיזו תקופה הוא שייך.
     */
    const last = goalPeriod("cycle", at("2026-12-31"));
    expect(last.start).toBe("2026-10-01");
    expect(last.end).toBe("2026-12-31");
  });

  it("שני החצאים מכסים את השנה, והשני נסגר ב-31 בדצמבר", () => {
    const first = goalPeriod("half", at("2026-02-01"));
    const second = goalPeriod("half", at("2026-09-01"));
    expect(first.start).toBe("2026-01-01");
    expect(second.end).toBe("2026-12-31");
    expect(first.end < second.start).toBe(true);
  });

  it("השבוע נמדד מיום ראשון של השבוע הנוכחי, ולא מינואר", () => {
    // 2026-06-17 הוא יום רביעי; יום ראשון שלו הוא ה-14
    const week = goalPeriod("week", at("2026-06-17"));
    expect(week).toEqual({ start: "2026-06-14", end: "2026-06-20" });
  });

  it("שבוע שחוצה גבול שנה נשאר שבוע שלם", () => {
    /*
     * ‏השבוע הוא יחידת הביצוע. שבוע שנחתך ב-31 בדצמבר היה מייצר
     * ציון על שלושה ימים ומשווה אותו לשבועות מלאים.
     */
    const week = goalPeriod("week", at("2026-12-31"));
    const start = new Date(`${week.start}T12:00:00Z`);
    const end = new Date(`${week.end}T12:00:00Z`);
    expect((end.getTime() - start.getTime()) / 86_400_000).toBe(6);
  });
});

/* ==========================================================================
 * ‏המילים — קול אחד למסך ולוואטסאפ
 * ========================================================================== */

describe("mentorLine — מה המנטור אומר", () => {
  it("לכל רגע יש נוסח, ואף אחד אינו ריק", () => {
    /*
     * ‏שער מול הכשל השקט: `MomentKind` שנוסף בלי משפט היה מחזיר
     * ‎`undefined` וקורס במסך, או — גרוע יותר — שולח הודעה ריקה.
     */
    const kinds: MomentKind[] = [
      "week_complete",
      "almost_there",
      "midweek_behind",
      "two_weak_weeks",
      "period_progress",
    ];
    for (const kind of kinds) {
      const line = mentorLine({ kind, percent: 50, measure: "calls", remaining: 3 });
      expect(line.title.length).toBeGreaterThan(5);
      expect(line.body.length).toBeGreaterThan(20);
    }
  });

  it("„כמעט שם” נוקב במספר שנשאר, ולא בעידוד ריק", () => {
    const line = mentorLine({
      kind: "almost_there",
      measure: "calls",
      remaining: 3,
      percent: 92,
    });
    expect(line.title).toContain("3");
    expect(line.title).toContain("שיחות");
  });

  it("אחד ביחיד — „נשארה שיחה אחת”, לא „נשאר 1 שיחות”", () => {
    const line = mentorLine({
      kind: "almost_there",
      measure: "appointments",
      remaining: 1,
      percent: 95,
    });
    expect(line.title).toContain("פגישה אחת");
    expect(line.title).not.toContain("1 פגישות");
  });

  it("שני שבועות חלשים הם שאלה, ולא נזיפה", () => {
    /*
     * ‏זו הכרעת המוצר המרכזית בטון: מעקב „הכול או כלום” מוביל
     * לנטישה, ומנטור ששואל „מה עצר אותך” מקבל תשובה שאפשר לעבוד
     * איתה. משפט שמתחיל ב„לא עמדת” סוגר את השיחה.
     */
    const line = mentorLine({ kind: "two_weak_weeks", percent: 40 });
    expect(line.title).toContain("?");
    expect(line.tone).toBe("ask");
    for (const scold of ["נכשלת", "לא עמדת", "אכזבת"]) {
      expect(line.title + line.body).not.toContain(scold);
    }
  });

  it("החגיגה היא על מה שנעשה, ולא על האחוז", () => {
    const line = mentorLine({ kind: "week_complete", percent: 100 });
    expect(line.tone).toBe("celebrate");
    expect(line.title).not.toContain("100");
  });

  it("המסך הריק מציע את הצעד הראשון, ולא „אין נתונים”", () => {
    const first = mentorOpeningLine(false, false);
    expect(first.title).toContain("?");
    const second = mentorOpeningLine(true, false);
    expect(second.title).not.toBe(first.title);
    const third = mentorOpeningLine(true, true);
    expect(third.title).not.toBe(second.title);
    for (const line of [first, second, third]) {
      expect(line.body).not.toContain("אין נתונים");
    }
  });

  it("לכל מדד ולכל רמה יש תווית בעברית", () => {
    expect(Object.keys(LEAD_MEASURE_LABELS).sort()).toEqual([...LEAD_MEASURES].sort());
    expect(Object.keys(GOAL_HORIZON_LABELS).sort()).toEqual([...GOAL_HORIZONS].sort());
    for (const label of [
      ...Object.values(LEAD_MEASURE_LABELS),
      ...Object.values(GOAL_HORIZON_LABELS),
    ]) {
      expect(/[֐-׿]/u.test(label)).toBe(true);
    }
  });
});

/* ==========================================================================
 * ‏שתי רגרסיות מביקורת Codex
 * ========================================================================== */

describe("backwardPlan — „בלעדיות” אינן עסקאות", () => {
  it("יעד בלעדיות אינו מייצר תוכנית משפך", () => {
    /*
     * ‏המשפך מתאר קונים: שיחה ⇐ פגישה ⇐ הצעה ⇐ עסקה. בלעדיות
     * מגיעות מהצד השני — פנייה לבעל נכס, הערכת שווי, חתימה — ואין
     * ביניהן ובין `offerToDeal` שום יחס. 20 בלעדיות שהוצגו כ„20
     * עסקאות ו-3,472 שיחות” הן תוכנית שנבנתה על יחס שאינו קיים.
     */
    const plan = backwardPlan({ target: 20, unit: "exclusives", ratios: DEFAULT_RATIOS });
    expect(plan.incomplete).toBe(true);
    /* ‏`null` ולא אפס: „אין תשובה”, לא „אפס שיחות” */
    expect(plan.callsPerYear).toBeNull();
    expect(plan.dealsPerYear).toBeNull();
  });

  it("„עסקאות” כן עוברות במשפך — היחסים כן מתארים אותן", () => {
    const plan = backwardPlan({ target: 20, unit: "deals", ratios: DEFAULT_RATIOS });
    expect(plan.incomplete).toBe(false);
    expect(plan.dealsPerYear).toBe(20);
    expect(plan.callsPerYear).toBeGreaterThan(0);
  });
});

describe("goalPeriod — מעבר שעון הקיץ", () => {
  it("היום הראשון של מחזור אינו נספר לקודם אחרי מעבר השעון", () => {
    /*
     * ‏שעון הקיץ בישראל מתחיל בסוף מרץ, ולכן הרבעון הראשון של 2026
     * מכיל יממה בת 23 שעות. חלוקת מילישניות ב-24 שעות ספרה 90 ימים
     * במקום 91, וה-2 באפריל — היום הראשון של המחזור השני — נשאר
     * משויך לראשון. יעד שנקבע בו נשמר לתקופה שנגמרה ונעלם למחרת.
     */
    const q1 = goalPeriod("cycle", new Date("2026-04-01T09:00:00Z"));
    const q2 = goalPeriod("cycle", new Date("2026-04-02T09:00:00Z"));
    expect(q1.start).toBe("2026-01-01");
    expect(q1.end).toBe("2026-04-01");
    expect(q2.start).toBe("2026-04-02");
    expect(q2.start).not.toBe(q1.start);
  });

  it("כל יום בשנה נופל בדיוק בתקופה אחת, בכל אחד מהאופקים", () => {
    /*
     * ‏הסריקה המלאה היא מה שתופס טעות של יום בודד: היא עוברת על כל
     * ימי 2026 ודורשת שכל יום ייפול בין ה-`start` ל-`end` של התקופה
     * שהפונקציה מחזירה עבורו. יום שנופל מחוץ לתקופה שלו הוא יום שבו
     * המנטור אינו יודע לאיזו תקופה הוא שייך.
     */
    for (const horizon of ["cycle", "half", "year"] as const) {
      let days = 0;
      for (let i = 0; i < 365; i += 1) {
        const at = new Date(Date.UTC(2026, 0, 1 + i, 9));
        const label = at.toISOString().slice(0, 10);
        const period = goalPeriod(horizon, at);
        expect(period.start <= label).toBe(true);
        expect(label <= period.end).toBe(true);
        days += 1;
      }
      expect(days).toBe(365);
    }
  });
});

describe("יעדי פעילות — לידים ושיחות", () => {
  /**
   * ‎**המפה והענף חייבים לומר אותו דבר.**
   *
   * ‏`backwardPlan` מסתעפת על `"leads" | "calls"` מפורשות (כדי
   * ש-TypeScript יצמצם את הטיפוס), ו-`GOAL_UNIT_KIND` היא מה שהמסך
   * מקבץ לפיו. שתיהן אמת נפרדת על אותה שאלה, ובדיקה שמצטטת רק את
   * אחת מהן מאשרת את עצמה — לכן הבדיקה הזו גוזרת את הרשימה מהמפה
   * ומריצה דרכה את החישוב.
   */
  it("כל יחידה שהמפה קוראת לה פעילות אינה עוברת במשפך", () => {
    const activity = GOAL_UNITS.filter((u) => GOAL_UNIT_KIND[u] === "activity");
    expect(activity.length).toBeGreaterThan(0);
    for (const unit of activity) {
      const plan = backwardPlan({ target: 1000, unit, ratios: DEFAULT_RATIOS });
      expect(plan.incomplete).toBe(false);
      /* ‏אין עסקאות ואין הצעות — לא אפס, אלא „לא נאמר” */
      expect(plan.dealsPerYear).toBeNull();
      expect(plan.offersPerYear).toBeNull();
    }
  });

  it("יעד שיחות מתחלק לימי עבודה ולא מומצא ממשפך", () => {
    const plan = backwardPlan({ target: 1000, unit: "calls", ratios: DEFAULT_RATIOS });
    expect(plan.callsPerYear).toBe(1000);
    /* ‏52 שבועות × 5 ימים = 260 ימי עבודה; 1000/260 = 3.85 ⇒ 4 */
    expect(plan.callsPerWorkday).toBe(4);
    expect(plan.appointmentsPerWeek).toBeNull();
  });

  it("יעד לידים נפרס על השבועות", () => {
    const plan = backwardPlan({ target: 104, unit: "leads", ratios: DEFAULT_RATIOS });
    expect(plan.leadsPerYear).toBe(104);
    expect(plan.leadsPerWeek).toBe(2);
    expect(plan.callsPerWorkday).toBeNull();
  });

  it("יעד תוצאה ממשיך לרוץ במשפך המלא", () => {
    const plan = backwardPlan({ target: 12, unit: "deals", ratios: DEFAULT_RATIOS });
    expect(plan.dealsPerYear).toBe(12);
    expect(plan.callsPerWorkday).not.toBeNull();
    expect(plan.incomplete).toBe(false);
  });

  it("„לידים חדשים” נספרים בציון השבועי ככל פעולה אחרת", () => {
    expect(LEAD_MEASURES).toContain("leads");
    const score = weeklyScore({ leads: 10, calls: 40 }, { leads: 10, calls: 20 });
    /* ‏לידים 100%, שיחות 50% ⇒ ממוצע 75% */
    expect(score.percent).toBe(75);
    expect(score.lines.map((l) => l.measure)).toContain("leads");
  });

  it("לכל יחידה יש שם, ולכל מדד יש שם", () => {
    for (const unit of GOAL_UNITS) expect(GOAL_UNIT_LABELS[unit]).toBeTruthy();
    for (const measure of LEAD_MEASURES) expect(LEAD_MEASURE_LABELS[measure]).toBeTruthy();
  });
});

describe("מה שהטופס מבטיח מול מה שהמנוע מחזיר", () => {
  /**
   * ‎**הבדיקה הזו נולדה מהערת ביקורת, והיא נכתבה מול המנוע ולא מול
   * הטקסט שלי.**
   *
   * ‏המשפטים היו לפי משפחה, ולכן „תוצאה” הבטיחה חישוב לאחור „עד כמה
   * שיחות ביום” גם ל„בלעדיות” — שעבורן התוכנית חוזרת `incomplete`
   * והכרטיס אינו מוצג. הטופס הבטיח פלט שלעולם אינו מגיע.
   *
   * ‏הבדיקה **מריצה** את `backwardPlan` על כל יחידה ושואלת אם יש
   * שורת „שיחות ביום עבודה”. רק אם יש — מותר למשפט להבטיח אותה.
   * ציטוט המחרוזות שלי בחזרה היה מאשר את עצמו.
   */
  const PROMISES_FUNNEL = /חשבון אחורה עד כמה שיחות ביום/u;

  it("רק יחידה שהתוכנית שלה באמת מגיעה לשיחות ביום מבטיחה זאת", () => {
    for (const unit of GOAL_UNITS) {
      const plan = backwardPlan({
        target: 100,
        unit,
        averageCommissionAgorot: 3_000_000,
        ratios: DEFAULT_RATIOS,
      });
      const promises = PROMISES_FUNNEL.test(GOAL_UNIT_NOTES[unit]);
      if (plan.callsPerWorkday === null) {
        expect({ unit, promises }).toEqual({ unit, promises: false });
      }
    }
  });

  it("„בלעדיות” אומרת במפורש שלא יוצג חישוב לאחור", () => {
    const plan = backwardPlan({ target: 20, unit: "exclusives", ratios: DEFAULT_RATIOS });
    expect(plan.incomplete).toBe(true);
    expect(GOAL_UNIT_NOTES.exclusives).toMatch(/לא יוצג/u);
  });

  it("לכל יחידה יש משפט, ואף אחד אינו ריק", () => {
    for (const unit of GOAL_UNITS) {
      expect(GOAL_UNIT_NOTES[unit].length).toBeGreaterThan(20);
    }
  });
});
