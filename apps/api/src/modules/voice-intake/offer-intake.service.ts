import { Injectable } from "@nestjs/common";
import { MatchingService } from "../matching/matching.service";
import { SearchService } from "../search/search.service";

/**
 * שליחת הצעה בקול — שלב הזיהוי בלבד. הפקודה "שלח את הנכס בהרב שך
 * למשה כהן" נפתרת כאן לישויות אמיתיות מהמאגר, והתשובה מוצגת למתווך
 * לאישור. היצירה והשליחה עצמן נעשות במסלול הרגיל של ההצעות
 * (offers.service) רק אחרי לחיצה מפורשת — דיבור לעולם לא שולח ללקוח.
 */

export interface OfferCandidate {
  propertyId: string;
  propertyLabel: string;
  buyerId: string;
  buyerLabel: string;
  matchId: string;
  score: number;
  explanation: string;
  /** קיימת כבר הצעה להתאמה הזו — המתווך יראה ולא ישלח פעמיים */
  alreadyOffered: boolean;
}

export interface OfferResolution {
  candidates: OfferCandidate[];
  /** מה לא הצלחנו לזהות — מוצג למתווך כדי שישלים ידנית */
  unresolved: { property: boolean; buyer: boolean };
  /** התאמות שנמצאו לנכס אך לא לקונה שנאמר (או להפך) — לבחירה ידנית */
  note?: string;
}

function propertyLabel(p: {
  street: string | null;
  neighborhood: string | null;
  city: string | null;
  marketingTitle: string | null;
}): string {
  return (
    p.marketingTitle ??
    [p.street, p.neighborhood, p.city].filter(Boolean).join(", ") ??
    "נכס"
  );
}

@Injectable()
export class OfferIntakeService {
  constructor(
    private readonly search: SearchService,
    private readonly matching: MatchingService,
  ) {}

  /**
   * מזהה נכס + קונה מהדיבור ומחזיר את ההתאמות ביניהם. כשרק אחד הצדדים
   * זוהה — מוחזרות ההתאמות של אותו צד, והמתווך בוחר את השני.
   */
  async resolve(input: {
    propertyPhrase?: string;
    buyerPhrase?: string;
  }): Promise<OfferResolution> {
    const propertyResults = input.propertyPhrase
      ? await this.search.search(input.propertyPhrase)
      : null;
    const buyerResults = input.buyerPhrase ? await this.search.search(input.buyerPhrase) : null;

    const properties = propertyResults?.properties ?? [];
    const buyers = buyerResults?.buyers ?? [];

    const unresolved = {
      property: input.propertyPhrase !== undefined && properties.length === 0,
      buyer: input.buyerPhrase !== undefined && buyers.length === 0,
    };

    // אין ממה לבנות — המתווך יבחר ידנית מהמסכים
    if (properties.length === 0 && buyers.length === 0) {
      return { candidates: [], unresolved, note: "לא זוהו נכס או קונה מהמאגר" };
    }

    const candidates: OfferCandidate[] = [];
    const buyerIds = new Set(buyers.map((b) => b.id));
    const buyerNameById = new Map(buyers.map((b) => [b.id, b.name]));
    const propertyLabelById = new Map(properties.map((p) => [p.id, propertyLabel(p)]));

    // רשימת ההתאמות המועשרת (כוללת כתובת נכס ושם קונה) — מקור אחד
    // לשני המסלולים, במקום שאילתה פר ישות
    const enriched = await this.matching.listAll({ minScore: 50, limit: 100 });

    // מסלול א': זוהה נכס — ההתאמות שלו, מסוננות לקונה שנאמר (אם נאמר)
    for (const match of enriched) {
      if (!propertyLabelById.has(match.propertyId)) continue;
      if (buyerIds.size > 0 && !buyerIds.has(match.buyerId)) continue;
      candidates.push({
        propertyId: match.propertyId,
        propertyLabel: propertyLabelById.get(match.propertyId) ?? match.property.address,
        buyerId: match.buyerId,
        buyerLabel: buyerNameById.get(match.buyerId) ?? match.buyerName ?? "קונה",
        matchId: match.id,
        score: match.score,
        explanation: match.explanation,
        alreadyOffered: match.status === "offered",
      });
    }

    // מסלול ב': זוהה רק קונה — ההתאמות שלו, כדי לבחור נכס
    if (candidates.length === 0 && buyerIds.size > 0) {
      for (const match of enriched) {
        if (!buyerIds.has(match.buyerId)) continue;
        candidates.push({
          propertyId: match.propertyId,
          propertyLabel: match.property.title ?? match.property.address,
          buyerId: match.buyerId,
          buyerLabel: buyerNameById.get(match.buyerId) ?? "קונה",
          matchId: match.id,
          score: match.score,
          explanation: match.explanation,
          alreadyOffered: match.status === "offered",
        });
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    const note =
      candidates.length === 0
        ? "לא נמצאה התאמה בין הנכס לקונה שזוהו — אפשר לשלוח מכרטיס הנכס"
        : undefined;

    return { candidates: candidates.slice(0, 10), unresolved, ...(note ? { note } : {}) };
  }
}
