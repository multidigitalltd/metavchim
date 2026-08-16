import { describe, expect, it } from "vitest";
import {
  MATCH_ENGINE_VERSION,
  MATCH_REFRESH_STALE_DAYS,
  matchRefreshDue,
  matchRefreshNotice,
  summarizeMatchRefresh,
  type MatchRefreshState,
} from "./match-refresh.js";

const NOW = new Date("2026-08-16T09:00:00.000Z");

function state(over: Partial<MatchRefreshState> = {}): MatchRefreshState {
  return {
    at: "2026-08-16T08:00:00.000Z",
    reason: "schedule",
    engineVersion: MATCH_ENGINE_VERSION,
    properties: 40,
    matches: 120,
    opened: 0,
    durationMs: 4200,
    ok: true,
    ...over,
  };
}

const FRESH = { engineVersion: MATCH_ENGINE_VERSION, weightsChangedAt: null };

describe("matchRefreshDue", () => {
  it("משרד שמעולם לא רץ בו סבב — סבב ראשון", () => {
    expect(matchRefreshDue(null, NOW, FRESH)).toBe("schedule");
  });

  it("סבב טרי ובלי שינוי — לא רץ", () => {
    expect(matchRefreshDue(state(), NOW, FRESH)).toBeNull();
  });

  it("גרסת מנוע אחרת גוברת על הכול", () => {
    expect(matchRefreshDue(state({ engineVersion: "2025-01-01-old" }), NOW, FRESH)).toBe("engine");
  });

  it("משקלים שהשתנו אחרי הסבב האחרון", () => {
    const due = matchRefreshDue(state(), NOW, {
      ...FRESH,
      weightsChangedAt: "2026-08-16T08:30:00.000Z",
    });
    expect(due).toBe("weights");
  });

  it("משקלים שהשתנו לפני הסבב האחרון — כבר טופלו", () => {
    const due = matchRefreshDue(state(), NOW, {
      ...FRESH,
      weightsChangedAt: "2026-08-16T07:00:00.000Z",
    });
    expect(due).toBeNull();
  });

  /*
   * הרגרסיה שהמנגנון הזה כולו נועד לה: חותמת פגומה חייבת להידלג ולא
   * להחזיר "weights" — אחרת כל תקתוק מפעיל סבב מלא, לנצח.
   */
  it("חותמת שאינה ניתנת לפענוח מדולגת ואינה מפעילה סבב חוזר", () => {
    const due = matchRefreshDue(state(), NOW, { ...FRESH, weightsChangedAt: "אתמול" });
    expect(due).toBeNull();
  });

  it("סבב שנקטע רץ שוב מיד, בלי לחכות ליממה", () => {
    expect(matchRefreshDue(state({ ok: false }), NOW, FRESH)).toBe("schedule");
  });

  it("יממה עברה — סבב יומי, בגלל התלות במועד הכניסה", () => {
    const due = matchRefreshDue(state({ at: "2026-08-15T08:00:00.000Z" }), NOW, FRESH);
    expect(due).toBe("schedule");
  });
});

describe("summarizeMatchRefresh", () => {
  it("מעולם לא רץ אינו ✓ — הוא היעדר ידיעה", () => {
    const s = summarizeMatchRefresh(null, NOW);
    expect(s.level).toBe("warn");
    expect(s.ageDays).toBeNull();
  });

  it("סבב תקין היום", () => {
    const s = summarizeMatchRefresh(state({ opened: 3 }), NOW);
    expect(s.level).toBe("ok");
    expect(s.headline).toContain("היום");
    expect(s.headline).toContain("3 התאמות חדשות");
  });

  it("סבב שלא פתח כלום הוא עדיין ✓ — המאגר מעודכן", () => {
    const s = summarizeMatchRefresh(state(), NOW);
    expect(s.level).toBe("ok");
    expect(s.headline).toContain("בלי התאמות חדשות");
  });

  it("סבב שנקטע — סכנה, כי חלק מהמאגר בניקוד ישן", () => {
    expect(summarizeMatchRefresh(state({ ok: false }), NOW).level).toBe("danger");
  });

  it("סבב ישן מדי — הסורק היומי כנראה אינו רץ", () => {
    const old = new Date(NOW.getTime() - MATCH_REFRESH_STALE_DAYS * 86_400_000).toISOString();
    const s = summarizeMatchRefresh(state({ at: old }), NOW);
    expect(s.level).toBe("warn");
  });
});

describe("matchRefreshNotice", () => {
  it("סבב שלא פתח דבר אינו חדשה", () => {
    expect(matchRefreshNotice(state())).toBeNull();
  });

  it("סבב שפתח התאמות מסביר גם למה הוא רץ", () => {
    const notice = matchRefreshNotice(state({ opened: 5, reason: "weights" }));
    expect(notice?.title).toContain("5 התאמות חדשות");
    expect(notice?.body).toContain("שינוי משקלי ההתאמה");
  });

  it("יחיד מנוסח כיחיד", () => {
    expect(matchRefreshNotice(state({ opened: 1 }))?.title).toContain("התאמה אחת חדשה");
  });
});
