import { describe, expect, it } from "vitest";
import { mentorAdvice } from "./mentor-advice.js";
import { buildMentorPrompt } from "./mentor-chat.js";
import {
  closestDeal,
  closestDealLine,
  dealScore,
  type DealCandidate,
} from "./mentor-deal.js";
import { mentorDailyPlan, type MentorActivity } from "./mentor.js";

const NOW = new Date("2026-09-07T06:00:00.000Z"); // שני
const PLURAL = /אתם|שלכם|לכם|כתבו|לחצו|קבעו|תם[.,!?:]|תם$/u;
const quiet: MentorActivity = {
  deals_closed: 0,
  offers_sent: 0,
  viewings_held: 0,
  leads_answered: 0,
  new_buyers: 0,
  new_properties: 0,
  calls_made: 0,
  calls_answered: 0,
  leads_answered_fast: 0,
  followups_done: 0,
  owner_updates_sent: 0,
};
const candidate = (over: Partial<DealCandidate>): DealCandidate => ({
  buyerId: "01BUYERAAAAAAAAAAAAAAAAAAA",
  name: "דנה לוי",
  viewings: 0,
  distinctProperties: 0,
  lastViewingAt: null,
  lastProperty: null,
  interestedOffers: 0,
  pendingOffers: 0,
  maturity: "interested",
  ...over,
});

describe("העסקה הקרובה ביותר — קונה אחד, מכשול אחד", () => {
  it("סף: שני סיורים או „מעוניין”; סיור אחד בלי הצעה — עדיין לא", () => {
    expect(closestDeal([candidate({ viewings: 1 })], NOW)).toBeNull();
    expect(closestDeal([], NOW)).toBeNull();
    expect(closestDeal([candidate({ viewings: 2 })], NOW)?.buyerId).toBe(
      "01BUYERAAAAAAAAAAAAAAAAAAA",
    );
    expect(closestDeal([candidate({ interestedOffers: 1 })], NOW)?.name).toBe(
      "דנה לוי",
    );
  });

  it("הציון: סיור 2, „מעוניין” 3, הצעה פתוחה 1, חם מאוד 3; שלושה שבועות בלי סיור מורידים", () => {
    const recent = new Date("2026-09-01T10:00:00.000Z");
    const old = new Date("2026-08-10T10:00:00.000Z");
    expect(
      dealScore(candidate({ viewings: 2, lastViewingAt: recent }), NOW),
    ).toBe(4);
    expect(dealScore(candidate({ viewings: 2, lastViewingAt: old }), NOW)).toBe(
      2,
    );
    expect(
      dealScore(
        candidate({
          viewings: 1,
          interestedOffers: 1,
          pendingOffers: 1,
          maturity: "very_hot",
        }),
        NOW,
      ),
    ).toBe(9);
    // הגבוה נבחר; בשוויון — הסיור האחרון יותר טרי
    const a = candidate({
      buyerId: "01A",
      name: "א",
      viewings: 2,
      lastViewingAt: old,
    });
    const b = candidate({
      buyerId: "01B",
      name: "ב",
      viewings: 2,
      lastViewingAt: recent,
    });
    expect(closestDeal([a, b], NOW)?.name).toBe("ב");
  });

  it("הניסוח: עובדה, שאלה שפותחת את המכשול, וצעד — לשאול ולא להציע; בלי רבים", () => {
    const twice = closestDeal(
      [
        candidate({
          viewings: 2,
          distinctProperties: 1,
          lastViewingAt: new Date("2026-09-03T10:00:00.000Z"),
          lastProperty: "הרצל 12, תל אביב",
        }),
      ],
      NOW,
    )!;
    expect(twice.reason).toBe(
      "שני סיורים בהרצל 12, תל אביב ב-30 הימים האחרונים, ובלי הצעה על השולחן",
    );
    expect(twice.question).toBe(
      "ראה את אותו נכס פעמיים ולא הציע — מה עוצר? מחיר, מימון, או מישהו שמחליט איתו?",
    );
    expect(twice.step).toMatch(/^טלפון אחד היום — לשאול, לא להציע עוד נכס\./u);
    const many = closestDeal(
      [
        candidate({
          viewings: 3,
          distinctProperties: 3,
          lastProperty: "ביאליק 4",
        }),
      ],
      NOW,
    )!;
    expect(many.reason).toBe(
      "3 סיורים (האחרון בביאליק 4) ב-30 הימים האחרונים, ובלי הצעה על השולחן",
    );
    expect(many.question).toContain("ראה כמה נכסים ולא הציע");
    const interested = closestDeal(
      [candidate({ viewings: 1, interestedOffers: 1, pendingOffers: 0 })],
      NOW,
    )!;
    expect(interested.reason).toBe(
      "סיור אחד ב-30 הימים האחרונים, ענה „מעוניין” על הצעה",
    );
    expect(interested.question).toContain("אמר שמעוניין");
    expect(closestDealLine(twice)).toBe(
      `העסקה הקרובה ביותר: דנה לוי — ${twice.reason}. ${twice.question}`,
    );
    for (const t of [twice.reason, twice.question, twice.step, many.question])
      expect(t, t).not.toMatch(PLURAL);
  });

  it("העצה הראשונה עם קישור לקונה; בבוקר של יום שני בלבד; ובפרומפט — החריג לכלל 6", () => {
    const deal = closestDeal([candidate({ viewings: 2 })], NOW)!;
    const advice = mentorAdvice({
      goals: [],
      activity: quiet,
      closestDeal: deal,
      now: NOW,
    });
    expect(advice[0]).toMatchObject({
      kind: "closest_deal",
      metric: "deals_closed",
      title: "העסקה הקרובה ביותר: דנה לוי",
      question: "מה חסר לדנה לוי כדי להחליט?",
      link: {
        href: "/buyers/01BUYERAAAAAAAAAAAAAAAAAAA",
        label: "לכרטיס הקונה",
      },
    });
    expect(
      mentorAdvice({ goals: [], activity: quiet, now: NOW })[0]?.kind,
    ).not.toBe("closest_deal");
    const line = closestDealLine(deal);
    const monday = mentorDailyPlan({ goals: [], now: NOW, closestDeal: line });
    expect(monday?.body).toContain(line);
    const tuesday = mentorDailyPlan({
      goals: [],
      now: new Date("2026-09-08T06:00:00.000Z"),
      closestDeal: line,
    });
    expect(tuesday).toBeNull();
    const base = {
      firstName: "דנה",
      nowText: "יום שני",
      goals: [],
      lastReview: null,
      history: [],
      question: "מה לעשות היום?",
    };
    expect(buildMentorPrompt(base)).not.toContain("העסקה הקרובה ביותר");
    const text = buildMentorPrompt({ ...base, closestDeal: deal });
    expect(text).toContain("העסקה הקרובה ביותר: דנה לוי");
    expect(text).toContain("בניגוד לכלל 6, מותר לדבר עליו בשמו");
  });
});
