import { describe, expect, it } from "vitest";
import { filterVisibleNotes } from "./note-visibility.js";

const note = (id: string, leadId: string | null, buyerId: string | null) => ({
  id,
  leadId,
  buyerId,
});

const scope = (leads: string[], buyers: string[]) => ({
  leadIds: new Set(leads),
  buyerIds: new Set(buyers),
});

describe("filterVisibleNotes", () => {
  it("מציג הערה שהליד שלה נראה למשתמש", () => {
    const result = filterVisibleNotes([note("n1", "lead-1", null)], scope(["lead-1"], []), 10);
    expect(result.map((n) => n.id)).toEqual(["n1"]);
  });

  it("מציג הערה שהקונה שלה נראה למשתמש", () => {
    const result = filterVisibleNotes([note("n1", null, "buyer-1")], scope([], ["buyer-1"]), 10);
    expect(result.map((n) => n.id)).toEqual(["n1"]);
  });

  // הבדיקה שבגללה הפונקציה קיימת: הערה על לקוח של סוכן אחר
  it("חוסם הערה שהישות שלה אינה נראית", () => {
    const result = filterVisibleNotes(
      [note("mine", "lead-1", null), note("theirs", "lead-2", null)],
      scope(["lead-1"], []),
      10,
    );
    expect(result.map((n) => n.id)).toEqual(["mine"]);
  });

  it("חוסם גם קונה של סוכן אחר", () => {
    const result = filterVisibleNotes(
      [note("theirs", null, "buyer-9")],
      scope(["lead-1"], ["buyer-1"]),
      10,
    );
    expect(result).toEqual([]);
  });

  it("הערה בלי ליד ובלי קונה אינה מוצגת — אין על מה לבסס הרשאה", () => {
    expect(filterVisibleNotes([note("orphan", null, null)], scope([], []), 10)).toEqual([]);
  });

  it("די בישות אחת נראית מתוך השתיים", () => {
    const result = filterVisibleNotes(
      [note("n1", "lead-hidden", "buyer-1")],
      scope([], ["buyer-1"]),
      10,
    );
    expect(result.map((n) => n.id)).toEqual(["n1"]);
  });

  it("חותך לתקרה אחרי הסינון, לא לפניו", () => {
    const notes = [
      note("hidden-1", "lead-x", null),
      note("ok-1", "lead-1", null),
      note("hidden-2", "lead-y", null),
      note("ok-2", "lead-1", null),
    ];
    // תקרה 2: בלי סינון-לפני-חיתוך היינו מקבלים שורה אחת בלבד
    expect(filterVisibleNotes(notes, scope(["lead-1"], []), 2).map((n) => n.id)).toEqual([
      "ok-1",
      "ok-2",
    ]);
  });

  it("תקרה 0 מחזירה ריק", () => {
    expect(filterVisibleNotes([note("n1", "lead-1", null)], scope(["lead-1"], []), 0)).toEqual([]);
  });
});
