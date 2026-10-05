import { describe, expect, it } from "vitest";
import { bidSummarySentences, bidsSummary, groupBidThreads, statusAfterNext, type BidEvent } from "./property-bids.js";

const ev = (id: string, buyerId: string, side: "buyer" | "seller", amount: number, status: BidEvent["status"], at: string): BidEvent => ({
  id, buyerId, side, amountAgorot: amount, status, note: null, createdAt: at,
});

describe("הצעות מחיר — שרשורים וסיכום", () => {
  it("שרשור לכל קונה, ההצעה הפתוחה היא האחרונה, מיון לפי הפעילות האחרונה", () => {
    const threads = groupBidThreads([
      ev("a1", "A", "buyer", 200_000_000, "countered", "2026-09-01T10:00:00Z"),
      ev("a2", "A", "seller", 230_000_000, "countered", "2026-09-02T10:00:00Z"),
      ev("a3", "A", "buyer", 215_000_000, "open", "2026-09-03T10:00:00Z"),
      ev("b1", "B", "buyer", 220_000_000, "open", "2026-09-02T12:00:00Z"),
      ev("c1", "C", "buyer", 210_000_000, "rejected", "2026-09-04T12:00:00Z"),
    ]);
    expect(threads.map((t) => t.buyerId)).toEqual(["C", "A", "B"]);
    expect(threads[1]!.open?.id).toBe("a3");
    expect(threads[1]!.events.map((e) => e.id)).toEqual(["a3", "a2", "a1"]);
    expect(threads[0]!.open).toBeNull();
    expect(threads[0]!.outcome).toBe("rejected");
  });

  it("הסיכום: הגבוהה מבין הצעות הקונים הפתוחות, והצעת הנגד האחרונה", () => {
    const threads = groupBidThreads([
      ev("a1", "A", "buyer", 215_000_000, "open", "2026-09-03T10:00:00Z"),
      ev("b1", "B", "buyer", 220_000_000, "open", "2026-09-02T12:00:00Z"),
      ev("c1", "C", "seller", 240_000_000, "open", "2026-09-04T12:00:00Z"),
    ]);
    const s = bidsSummary(threads);
    expect(s).toEqual({ bidders: 3, openThreads: 3, highestOpenAgorot: 220_000_000, latestCounterAgorot: 240_000_000, accepted: null });
    expect(bidSummarySentences(s).slice(1)).toEqual(["3 הצעות על השולחן, הגבוהה 2,200,000 ₪.", "הצעת הנגד האחרונה שלכם: 2,400,000 ₪."]);
    expect(bidSummarySentences(s)[0]).toMatch(/^\d+ קונים במו״מ על הנכס\.$/u);
  });

  it("הצעה שהתקבלה נאמרת ראשונה; בלי הצעות — בלי משפטים", () => {
    const s = bidsSummary(groupBidThreads([ev("a1", "A", "buyer", 230_000_000, "accepted", "2026-09-03T10:00:00Z")]));
    expect(s.accepted).toEqual({ buyerId: "A", amountAgorot: 230_000_000 });
    expect(bidSummarySentences(s)).toEqual(["קונה אחד במו״מ על הנכס.", "הצעה בסך 2,300,000 ₪ התקבלה."]);
    expect(bidSummarySentences(bidsSummary([]))).toEqual([]);
  });

  it("צעד חדש: אותו צד — הוחלפה; צד שני — נענתה", () => {
    expect(statusAfterNext("buyer", "buyer")).toBe("superseded");
    expect(statusAfterNext("buyer", "seller")).toBe("countered");
  });
});
