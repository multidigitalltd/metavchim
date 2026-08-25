import { describe, expect, it } from "vitest";
import {
  DEFAULT_APARTMENT_EXCLUSIVITY_DAYS,
  MIN_BROKERS_FOR_NETWORK_ACTION,
  MIN_MARKETING_ACTIONS,
  addDays,
  defaultExclusivityEnd,
  describeExclusivity,
  exclusivityRejectionReason,
  exclusivityState,
  maxExclusivityEnd,
  ownerReportText,
  qualifyingActions,
  thirdDate,
  type ExclusivityPeriod,
  type MarketingAction,
} from "./exclusivity.js";

const START = new Date("2026-01-01T00:00:00Z");

/** תקופה של 90 יום — מועד השליש נופל בדיוק על יום 30. */
const period = (over: Partial<ExclusivityPeriod> = {}): ExclusivityPeriod => ({
  subject: "apartment",
  startsAt: START,
  endsAt: addDays(START, 90),
  agreedCustomAction: false,
  ...over,
});

const action = (
  kind: MarketingAction["kind"],
  dayOffset: number,
  brokerCount?: number,
): MarketingAction => ({
  kind,
  performedAt: addDays(START, dayOffset),
  ...(brokerCount === undefined ? {} : { brokerCount }),
});

describe("התקרות שבחוק", () => {
  it("דירה — שישה חודשים", () => {
    expect(maxExclusivityEnd("apartment", START)).toEqual(new Date("2026-07-01T00:00:00Z"));
  });

  it("מקרקעין שאינם דירה — שנה", () => {
    expect(maxExclusivityEnd("other", START)).toEqual(new Date("2027-01-01T00:00:00Z"));
  });

  it("ברירת מחדל של 30 יום קיימת לדירה בלבד", () => {
    expect(defaultExclusivityEnd("apartment", START)).toEqual(
      addDays(START, DEFAULT_APARTMENT_EXCLUSIVITY_DAYS),
    );
    // אין נוסח מאומת למקרקעין אחרים — ולכן אין מספר, ולא ניחוש
    expect(defaultExclusivityEnd("other", START)).toBeNull();
  });
});

describe("exclusivityRejectionReason", () => {
  it("תקופה בתוך התקרה מתקבלת", () => {
    expect(exclusivityRejectionReason({ subject: "apartment", startsAt: START, endsAt: addDays(START, 180) })).toBeNull();
  });

  it("חריגה מהתקרה נדחית ומצטטת את הסעיף", () => {
    const reason = exclusivityRejectionReason({
      subject: "apartment",
      startsAt: START,
      endsAt: addDays(START, 200),
    });
    expect(reason).toContain("6 חודשים");
    expect(reason).toContain("9(ב)");
  });

  it("אותה תקופה כשרה במקרקעין שאינם דירה", () => {
    expect(
      exclusivityRejectionReason({ subject: "other", startsAt: START, endsAt: addDays(START, 200) }),
    ).toBeNull();
  });

  it("סיום לפני התחלה נדחה", () => {
    expect(
      exclusivityRejectionReason({ subject: "apartment", startsAt: START, endsAt: START }),
    ).toContain("אחרי מועד ההתחלה");
  });
});

describe("מועד השליש", () => {
  it("שליש מהתקופה בפועל, ולא מספר קבוע", () => {
    expect(thirdDate(START, addDays(START, 90))).toEqual(addDays(START, 30));
    expect(thirdDate(START, addDays(START, 30))).toEqual(addDays(START, 10));
  });
});

describe("qualifyingActions", () => {
  it("שני סוגים שונים נספרים כשניים", () => {
    const counted = qualifyingActions(period(), [action("signage", 1), action("daily_newspaper", 2)], addDays(START, 30));
    expect(counted).toEqual(["signage", "daily_newspaper"]);
  });

  it("שתי מודעות מאותו סוג הן פעולה אחת", () => {
    const counted = qualifyingActions(period(), [action("signage", 1), action("signage", 5)], addDays(START, 30));
    expect(counted).toEqual(["signage"]);
  });

  it("פעולה שבוצעה אחרי המועד אינה נספרת", () => {
    const counted = qualifyingActions(period(), [action("signage", 40)], addDays(START, 30));
    expect(counted).toEqual([]);
  });

  it("פעולה מוסכמת נספרת רק כשסוכם עליה", () => {
    const actions = [action("agreed_other", 1)];
    expect(qualifyingActions(period(), actions, addDays(START, 30))).toEqual([]);
    expect(
      qualifyingActions(period({ agreedCustomAction: true }), actions, addDays(START, 30)),
    ).toEqual(["agreed_other"]);
  });

  it("שיתוף מתווכים נספר רק מחמישה ומעלה", () => {
    const few = qualifyingActions(period(), [action("broker_network", 1, MIN_BROKERS_FOR_NETWORK_ACTION - 1)], addDays(START, 30));
    expect(few).toEqual([]);
    const enough = qualifyingActions(period(), [action("broker_network", 1, MIN_BROKERS_FOR_NETWORK_ACTION)], addDays(START, 30));
    expect(enough).toEqual(["broker_network"]);
  });

  it("חמש הצעות למשרדים שונים מצטברות לפעולה אחת — במערכת כל הצעה יוצאת לאחד", () => {
    const one = Array.from({ length: MIN_BROKERS_FOR_NETWORK_ACTION }, (_, i) =>
      action("broker_network", i + 1),
    );
    expect(qualifyingActions(period(), one, addDays(START, 30))).toEqual(["broker_network"]);
    expect(qualifyingActions(period(), one.slice(0, -1), addDays(START, 30))).toEqual([]);
  });

  it("הצבירה מכבדת את חלון הזמן — הצעה מאוחרת אינה משלימה את החמישית", () => {
    const four = Array.from({ length: 4 }, (_, i) => action("broker_network", i + 1));
    const late = action("broker_network", 40);
    expect(qualifyingActions(period(), [...four, late], addDays(START, 30))).toEqual([]);
  });
});

describe("exclusivityState", () => {
  it("לפני מועד השליש בלי פעולות — בסיכון, וסופרים את הימים שנשארו לתקן", () => {
    const state = exclusivityState(period(), [], addDays(START, 10));
    expect(state.phase).toBe("at_risk");
    expect(state.missing).toBe(MIN_MARKETING_ACTIONS);
    expect(state.daysToThird).toBe(20);
    // כל עוד יש זמן, הסיום המוצג הוא הסיום שבהסכם
    expect(state.effectiveEndsAt).toEqual(addDays(START, 90));
  });

  it("שתי פעולות בזמן — פעילה, והשליש כבר לא מאיים", () => {
    const state = exclusivityState(
      period(),
      [action("signage", 2), action("client_database", 3)],
      addDays(START, 10),
    );
    expect(state.phase).toBe("active");
    expect(state.missing).toBe(0);
    expect(state.daysLeft).toBe(80);
  });

  it("מועד השליש חלף בלי הפעולות — הבלעדיות נגמרה שם, לא בסוף", () => {
    const state = exclusivityState(period(), [action("signage", 5)], addDays(START, 45));
    expect(state.phase).toBe("ended_by_third_rule");
    expect(state.effectiveEndsAt).toEqual(addDays(START, 30));
    expect(state.daysLeft).toBeLessThan(0);
  });

  it("פעולה מאוחרת אינה מחייה בלעדיות שפקעה במועד השליש", () => {
    const state = exclusivityState(
      period(),
      [action("signage", 5), action("daily_newspaper", 40), action("local_newspaper", 41)],
      addDays(START, 45),
    );
    expect(state.phase).toBe("ended_by_third_rule");
    expect(state.counted).toEqual(["signage"]);
  });

  it("עמדה בדרישה ואז הגיעה לסופה — פגה, לא 'נגמרה בשליש'", () => {
    const state = exclusivityState(
      period(),
      [action("signage", 2), action("client_database", 3)],
      addDays(START, 95),
    );
    expect(state.phase).toBe("expired");
    expect(state.effectiveEndsAt).toEqual(addDays(START, 90));
  });

  it("בדיוק ברגע מועד השליש הכלל כבר נבחן", () => {
    const state = exclusivityState(period(), [], addDays(START, 30));
    expect(state.phase).toBe("ended_by_third_rule");
    expect(state.daysToThird).toBeNull();
  });
});

describe("ownerReportText", () => {
  const base = {
    propertyTitle: "דירת 4 חדרים ברמת גן",
    officeName: "משרד הדגמה",
    period: { startsAt: START, endsAt: addDays(START, 90) },
    now: addDays(START, 20),
  };

  it("מקבץ לפי סוג ומציין כמה פעמים ובאיזה טווח", () => {
    const text = ownerReportText({
      ...base,
      actions: [action("client_database", 2), action("client_database", 9), action("signage", 3)],
    });
    expect(text).toContain("2 פעמים, מ-03.01.2026 עד 10.01.2026");
    expect(text).toContain("שילוט");
  });

  it("פעולה עתידית אינה מדווחת כאילו כבר בוצעה", () => {
    const text = ownerReportText({ ...base, actions: [action("signage", 40)] });
    expect(text).toContain("טרם בוצעו פעולות שיווק");
  });

  /*
   * הבדיקה שהייתה חסרה: כל התאריכים בבדיקות האחרות נופלים בחצות
   * UTC, שהיא 02:00 בירושלים — כלומר אותו יום קלנדרי בשני השעונים,
   * ולכן מעצב שמחשב ב-UTC עובר אותן בשלמות. פעולה בערב חושפת את
   * ההפרש.
   */
  it("פעולה בערב מדווחת בתאריך הישראלי ולא בזה של UTC", () => {
    const evening = new Date("2026-01-20T22:30:00Z"); // 00:30 ב-21.01 בירושלים
    const text = ownerReportText({
      ...base,
      now: new Date("2026-01-25T00:00:00Z"),
      actions: [{ kind: "signage", performedAt: evening }],
    });
    expect(text).toContain("21.01.2026");
    expect(text).not.toContain("20.01.2026");
  });

  it("אינו חושף למוכר את מצב כלל השליש", () => {
    const text = ownerReportText({ ...base, actions: [action("signage", 2)] });
    expect(text).not.toContain("שליש");
    expect(text).not.toContain("9(ב2)");
  });
});

describe("describeExclusivity", () => {
  it("בסיכון — אומר מה חסר, עד מתי, ומה המחיר", () => {
    const text = describeExclusivity(exclusivityState(period(), [], addDays(START, 10)));
    expect(text).toContain("חסרות 2 פעולות שיווק");
    expect(text).toContain("31.01.2026");
  });

  it("נגמרה בשליש — מצטט את הסעיף שגרם לזה", () => {
    const text = describeExclusivity(exclusivityState(period(), [], addDays(START, 45)));
    expect(text).toContain("9(ב2)");
  });

  it("פעילה — מספר ימים ותאריך", () => {
    const text = describeExclusivity(
      exclusivityState(period(), [action("signage", 1), action("signage", 2), action("daily_newspaper", 2)], addDays(START, 10)),
    );
    expect(text).toContain("80 ימים");
  });
});
