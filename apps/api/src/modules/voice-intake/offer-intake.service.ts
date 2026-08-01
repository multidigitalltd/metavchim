import { Injectable } from "@nestjs/common";
import { MatchingService } from "../matching/matching.service";
import { PropertiesService } from "../properties/properties.service";
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
    private readonly properties: PropertiesService,
  ) {}

  /** תווית נכס לתצוגה במסלול "רק קונה זוהה". */
  private async propertyLabelById(propertyId: string): Promise<string> {
    try {
      const property = await this.properties.getById(propertyId);
      return (
        property.marketingTitle ??
        [property.street, property.neighborhood, property.city].filter(Boolean).join(", ") ??
        "נכס"
      );
    } catch {
      return "נכס";
    }
  }

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

    // שאילתה ממוקדת לישויות שזוהו — לא חיתוך של 100 ההתאמות המובילות
    // במשרד, שהיה מפספס התאמה אמיתית במשרד עמוס (ביקורת Codex)
    if (properties.length > 0) {
      // מסלול א': זוהה נכס — ההתאמות שלו, מסוננות לקונה שנאמר (אם נאמר)
      for (const property of properties.slice(0, 3)) {
        const matches = await this.matching.listForProperty(property.id);
        for (const match of matches) {
          if (buyerIds.size > 0 && !buyerIds.has(match.buyerId)) continue;
          candidates.push({
            propertyId: property.id,
            propertyLabel: propertyLabelById.get(property.id) ?? "נכס",
            buyerId: match.buyerId,
            buyerLabel: buyerNameById.get(match.buyerId) ?? "קונה",
            matchId: match.id,
            score: match.score,
            explanation: match.explanation,
            alreadyOffered: match.status === "offered",
          });
        }
      }
    } else if (buyers.length > 0) {
      // מסלול ב': *רק* קונה זוהה — ההתאמות שלו, כדי לבחור נכס.
      // כשגם נכס נאמר אך אין ביניהם התאמה, לא מציעים נכס אחר בטעות
      // (ביקורת Codex) — מוחזרת רשימה ריקה עם הערה.
      for (const buyer of buyers.slice(0, 3)) {
        const matches = await this.matching.listForBuyer(buyer.id);
        for (const match of matches) {
          const label = await this.propertyLabelById(match.propertyId);
          candidates.push({
            propertyId: match.propertyId,
            propertyLabel: label,
            buyerId: buyer.id,
            buyerLabel: buyer.name,
            matchId: match.id,
            score: match.score,
            explanation: match.explanation,
            alreadyOffered: match.status === "offered",
          });
        }
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    const note =
      candidates.length === 0
        ? properties.length > 0 && buyers.length > 0
          ? "הנכס והקונה זוהו, אבל אין ביניהם התאמה — אפשר לשלוח ידנית מכרטיס הנכס"
          : "לא נמצאה התאמה מתאימה — אפשר לשלוח מכרטיס הנכס"
        : undefined;

    return { candidates: candidates.slice(0, 10), unresolved, ...(note ? { note } : {}) };
  }
}
