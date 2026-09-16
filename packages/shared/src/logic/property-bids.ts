import { shekelsLabel } from "./forum.js";

/**
 * ‏הצעות מחיר ומו״מ על נכס (docs/03 — property_bids).
 *
 * ## ‏למה יומן ולא „ההצעה הנוכחית”
 *
 * ‏מו״מ הוא רצף: קונה מציע, המוכר עונה בהצעת נגד, הקונה מעלה. מי
 * ‏שמחזיק רק את המספר האחרון אינו יכול לומר למוכר „הוא כבר עלה
 * ‏פעמיים”, וזה בדיוק המשפט שסוגר עסקה. לכן כל צעד הוא שורה, וה„על
 * ‏השולחן” נגזר: הצעה **אחת** פתוחה לכל קונה — האחרונה.
 *
 * ## ‏מה נגזר כאן
 *
 * ‏שיוך לשרשור לפי קונה, ההצעה הפתוחה של כל שרשור, סיכום לנכס
 * ‏(כמה מציעים, הגבוהה ביותר, האם התקבלה), ומשפטים למוכר. הכול טהור
 * ‏ובדוק; המסך וה-API רק קוראים.
 */

export const BID_SIDES = ["buyer", "seller"] as const;
export type BidSide = (typeof BID_SIDES)[number];
export const BID_SIDE_LABELS: Record<BidSide, string> = {
  buyer: "הצעת הקונה",
  seller: "הצעת נגד של המוכר",
};

/**
 * ‏‎`open` — על השולחן. ‎`countered` — הצד השני ענה בהצעה אחרת.
 * ‏‎`superseded` — אותו צד הציע מספר חדש. ‎`accepted/rejected/withdrawn` —
 * ‏הכרעה; היא חלה על ההצעה הפתוחה בלבד.
 */
export const BID_STATUSES = ["open", "countered", "superseded", "accepted", "rejected", "withdrawn"] as const;
export type BidStatus = (typeof BID_STATUSES)[number];
export const BID_DECISIONS = ["accepted", "rejected", "withdrawn"] as const;
export type BidDecision = (typeof BID_DECISIONS)[number];
export const BID_STATUS_LABELS: Record<BidStatus, string> = {
  open: "על השולחן",
  countered: "נענתה בהצעת נגד",
  superseded: "הוחלפה בהצעה חדשה",
  accepted: "התקבלה",
  rejected: "נדחתה",
  withdrawn: "נמשכה",
};

export const BID_NOTE_MAX = 500;

export interface BidEvent {
  id: string;
  buyerId: string;
  side: BidSide;
  amountAgorot: number;
  status: BidStatus;
  note: string | null;
  /** ISO */
  createdAt: string;
}

export interface BidThread {
  buyerId: string;
  /** מהחדש לישן */
  events: BidEvent[];
  /** ‏ההצעה הפתוחה — האחרונה, אם לא הוכרעה */
  open: BidEvent | null;
  /** ‏ההכרעה של השרשור, אם הייתה */
  outcome: BidDecision | null;
  /** ‏המועד האחרון שקרה בו משהו */
  lastAt: string;
}

/** ‏מה קורה להצעה הפתוחה הקודמת כשמתווסף צעד חדש באותו שרשור. */
export function statusAfterNext(previousSide: BidSide, nextSide: BidSide): BidStatus {
  return previousSide === nextSide ? "superseded" : "countered";
}

export function groupBidThreads(events: readonly BidEvent[]): BidThread[] {
  const byBuyer = new Map<string, BidEvent[]>();
  for (const event of events) byBuyer.set(event.buyerId, [...(byBuyer.get(event.buyerId) ?? []), event]);
  const threads: BidThread[] = [];
  for (const [buyerId, list] of byBuyer) {
    const sorted = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const latest = sorted[0]!;
    const outcome = latest.status === "accepted" || latest.status === "rejected" || latest.status === "withdrawn" ? latest.status : null;
    threads.push({
      buyerId,
      events: sorted,
      open: latest.status === "open" ? latest : null,
      outcome,
      lastAt: latest.createdAt,
    });
  }
  return threads.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

export interface BidsSummary {
  /** ‏קונים שיש להם שרשור */
  bidders: number;
  /** ‏שרשורים עם הצעה פתוחה */
  openThreads: number;
  /** ‏ההצעה הפתוחה הגבוהה ביותר **של קונה** — לא הצעת נגד */
  highestOpenAgorot: number | null;
  /** ‏הצעת הנגד הפתוחה האחרונה של המוכר, אם יש */
  latestCounterAgorot: number | null;
  accepted: { buyerId: string; amountAgorot: number } | null;
}

export function bidsSummary(threads: readonly BidThread[]): BidsSummary {
  let highest: number | null = null;
  let counter: { at: string; amount: number } | null = null;
  let accepted: BidsSummary["accepted"] = null;
  let openThreads = 0;
  for (const thread of threads) {
    if (thread.open !== null) {
      openThreads += 1;
      if (thread.open.side === "buyer" && (highest === null || thread.open.amountAgorot > highest)) highest = thread.open.amountAgorot;
      if (thread.open.side === "seller" && (counter === null || thread.open.createdAt > counter.at)) {
        counter = { at: thread.open.createdAt, amount: thread.open.amountAgorot };
      }
    }
    if (thread.outcome === "accepted" && accepted === null) {
      accepted = { buyerId: thread.buyerId, amountAgorot: thread.events[0]!.amountAgorot };
    }
  }
  return {
    bidders: threads.length,
    openThreads,
    highestOpenAgorot: highest,
    latestCounterAgorot: counter === null ? null : counter.amount,
    accepted,
  };
}

/**
 * ‏המשפטים למוכר — מספרים בלבד, בלי שמות: „שתי הצעות על השולחן,
 * ‏הגבוהה 2,350,000 ₪”. השם הוא של המתווך לומר בטלפון.
 */
export function bidSummarySentences(summary: BidsSummary): string[] {
  const out: string[] = [];
  /* ‏כמה קונים במו״מ — נאמר גם כשכל ההצעות נענו בהצעת נגד ואין „על השולחן” */
  if (summary.bidders > 0) {
    out.push(summary.bidders === 1 ? "קונה אחד במו״מ על הנכס." : `${summary.bidders} קונים במו״מ על הנכס.`);
  }
  if (summary.accepted !== null) {
    out.push(`הצעה בסך ${shekelsLabel(summary.accepted.amountAgorot / 100)} התקבלה.`);
  }
  if (summary.highestOpenAgorot !== null) {
    const buyerBids = summary.openThreads;
    out.push(
      `${buyerBids === 1 ? "הצעה אחת על השולחן" : `${buyerBids} הצעות על השולחן`}, הגבוהה ${shekelsLabel(summary.highestOpenAgorot / 100)}.`,
    );
  }
  if (summary.latestCounterAgorot !== null) {
    out.push(`הצעת הנגד האחרונה שלכם: ${shekelsLabel(summary.latestCounterAgorot / 100)}.`);
  }
  return out;
}
