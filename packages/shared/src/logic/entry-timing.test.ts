import { describe, expect, it } from "vitest";
import { describeEntry, describeEntryNeed, scoreEntryFit } from "./entry-timing.js";

const NOW = new Date("2026-08-12T00:00:00Z");

describe("scoreEntryFit", () => {
  it("קונה גמיש מקבל ניקוד מלא גם על נכס שמתפנה בעוד שנה", () => {
    const fit = scoreEntryFit(
      { entryType: "on_date", entryDate: new Date("2027-08-01") },
      { entryType: "flexible" },
      NOW,
    );
    expect(fit).toEqual({ score: 1 });
  });

  it("נכס גמיש מקבל ניקוד גבוה אך לא מלא — זו שיחה ולא הבטחה", () => {
    const fit = scoreEntryFit({ entryType: "flexible" }, { entryType: "immediate" }, NOW);
    expect(fit?.score).toBe(0.8);
    expect(fit?.note).toBeDefined();
  });

  it("נכס פנוי מיידית עונה גם לדד-ליין וגם לצורך מיידי", () => {
    expect(
      scoreEntryFit(
        { entryType: "immediate" },
        { entryType: "by_date", entryBy: new Date("2026-10-01") },
        NOW,
      ),
    ).toEqual({ score: 1 });
    expect(scoreEntryFit({ entryType: "immediate" }, { entryType: "immediate" }, NOW)).toEqual({
      score: 1,
    });
  });

  it("מסירה לפני המועד המבוקש — ניקוד מלא", () => {
    const fit = scoreEntryFit(
      { entryType: "on_date", entryDate: new Date("2026-09-01") },
      { entryType: "by_date", entryBy: new Date("2026-10-01") },
      NOW,
    );
    expect(fit).toEqual({ score: 1 });
  });

  it("איחור בתוך חלון החסד אינו פוסל", () => {
    const fit = scoreEntryFit(
      { entryType: "on_date", entryDate: new Date("2026-10-20") },
      { entryType: "by_date", entryBy: new Date("2026-10-01") },
      NOW,
    );
    expect(fit?.score).toBe(0.6);
    expect(fit?.note).toContain("מעט אחרי");
  });

  it("איחור גדול מוריד לרצפה", () => {
    const fit = scoreEntryFit(
      { entryType: "on_date", entryDate: new Date("2027-03-01") },
      { entryType: "by_date", entryBy: new Date("2026-10-01") },
      NOW,
    );
    expect(fit?.score).toBe(0.2);
  });

  it('קונה "מיידי" נמדד מול היום, לא מול תאריך שאין לו', () => {
    // הנכס מתפנה בעוד שבועיים — בתוך חלון החסד מהיום
    expect(
      scoreEntryFit(
        { entryType: "on_date", entryDate: new Date("2026-08-26") },
        { entryType: "immediate" },
        NOW,
      )?.score,
    ).toBe(0.6);
    // בעוד חצי שנה — לא
    expect(
      scoreEntryFit(
        { entryType: "on_date", entryDate: new Date("2027-02-01") },
        { entryType: "immediate" },
        NOW,
      )?.score,
    ).toBe(0.2);
  });

  it("צד בלי מידע מדלג על הקריטריון במקום לנחש", () => {
    expect(scoreEntryFit({}, { entryType: "immediate" }, NOW)).toBeNull();
    expect(scoreEntryFit({ entryType: "immediate" }, {}, NOW)).toBeNull();
    // מצב עם תאריך שנמחק — אין מה להשוות, ולא ניקוד שרירותי
    expect(scoreEntryFit({ entryType: "on_date" }, { entryType: "immediate" }, NOW)).toBeNull();
  });

  it("כרטיסים ישנים בלי מצב נגזרים מהתאריך ולא מאבדים את הקריטריון", () => {
    const fit = scoreEntryFit(
      { entryDate: new Date("2026-09-01") },
      { entryBy: new Date("2026-10-01") },
      NOW,
    );
    expect(fit).toEqual({ score: 1 });
  });
});

describe("describeEntry", () => {
  it("מצרף את המצב ואת ההערה החופשית", () => {
    expect(
      describeEntry({ entryType: "flexible", entryNote: "לאחר פינוי השוכר" }),
    ).toBe("גמיש / בתיאום · לאחר פינוי השוכר");
  });

  it('"החל מ-" מוצג ככזה ולא כתאריך מסירה', () => {
    expect(describeEntry({ entryType: "from_date", entryDate: new Date("2027-01-15") })).toContain(
      "החל מ-",
    );
  });

  it("נכס בלי מידע אינו מייצר שורה ריקה", () => {
    expect(describeEntry({})).toBeUndefined();
    expect(describeEntry({ entryNote: "   " })).toBeUndefined();
  });
});

describe("describeEntryNeed", () => {
  it("מתרגם את אילוץ הקונה לעברית", () => {
    expect(describeEntryNeed({ entryType: "immediate" })).toBe("צריך להיכנס מיידית");
    expect(describeEntryNeed({ entryType: "flexible" })).toBe("גמיש במועד הכניסה");
    expect(describeEntryNeed({ entryType: "by_date", entryBy: new Date("2026-10-01") })).toContain(
      "עד",
    );
    expect(describeEntryNeed({})).toBeUndefined();
  });
});
