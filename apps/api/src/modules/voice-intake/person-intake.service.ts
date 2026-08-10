import { BadRequestException, Injectable } from "@nestjs/common";
import { extractPersonFromTranscript, type ExtractedPerson } from "@metavchim/shared";
import { BuyersService, type BuyerDto } from "../buyers/buyers.service";
import { LeadsService } from "../leads/leads.service";

/**
 * קליטת ליד/קונה בקול — במקביל לקליטת נכס: תמלול ⟵ חילוץ ⟵ רשומה
 * אמיתית דרך אותם שירותים כמו הטפסים הידניים (מיזוג לידים, התאמות,
 * אירועים ויומן ביקורת — הכול נשמר).
 */

export interface PersonIntakePreview {
  person: ExtractedPerson;
  evidence: Record<string, string>;
  /** מה חסר כדי ליצור את הרשומה — מוצג למתווך להשלמה מהירה */
  missing: string[];
}

export interface LeadIntakeResult {
  leadId: string;
  merged: boolean;
  visible: boolean;
}

/** תשובה לשאלה "מי מחפש …" — הקריטריונים שהובנו + הקונים שנמצאו. */
export interface BuyerQueryAnswer {
  criteria: {
    cities: string[];
    roomsMin?: number;
    roomsMax?: number;
    budgetMaxShekels?: number;
  };
  buyers: {
    id: string;
    name: string;
    cities: string[];
    roomsMin?: number;
    roomsMax?: number;
    budgetMaxAgorot?: number;
    maturity: string;
  }[];
}

@Injectable()
export class PersonIntakeService {
  constructor(
    private readonly leads: LeadsService,
    private readonly buyers: BuyersService,
  ) {}

  /** שלב 1: חילוץ בלבד — המתווך רואה ומאשר/משלים לפני שנוצרת רשומה. */
  preview(transcript: string, target: "lead" | "buyer"): PersonIntakePreview {
    const { person, evidence } = extractPersonFromTranscript(transcript);
    const missing: string[] = [];
    if (!person.name) missing.push("שם");
    if (!person.phone) missing.push("טלפון");
    if (target === "buyer") {
      if (person.cities.length === 0) missing.push("עיר");
      if (person.budgetMaxAgorot === undefined) missing.push("תקציב");
    }
    return { person, evidence: evidence as Record<string, string>, missing };
  }

  /**
   * "מי מחפש 4 חדרים בגבעתיים?" — שאלה על המאגר, לא חיפוש טקסט.
   *
   * הקריטריונים מחולצים באותו מנוע דטרמיניסטי של קליטת קונה
   * (extractPerson: חדרים, תקציב, ערים), והסינון הוא אותו סינון של
   * מסך הקונים — כולל סמנטיקת החפיפה של טווחי תקציב. אפס לוגיקה
   * חדשה: שאלה = חילוץ קיים + פילטר קיים.
   */
  async queryBuyers(transcript: string): Promise<BuyerQueryAnswer> {
    const { person } = extractPersonFromTranscript(transcript);
    const budgetMaxShekels =
      person.budgetMaxAgorot !== undefined
        ? Math.round(person.budgetMaxAgorot / 100)
        : undefined;

    const page = await this.buyers.list({
      limit: 10,
      // "4 חדרים" סתם ⇒ min=max=4, והחפיפה מוצאת כל קונה שהטווח
      // שלו כולל 4 (גם "3–5 חדרים")
      ...(person.roomsMin !== undefined ? { minRooms: person.roomsMin } : {}),
      ...(person.roomsMax !== undefined ? { maxRooms: person.roomsMax } : {}),
      ...(budgetMaxShekels !== undefined ? { maxPrice: budgetMaxShekels } : {}),
      ...(person.cities.length > 0 ? { q: person.cities[0] } : {}),
    });

    return {
      criteria: {
        cities: person.cities,
        ...(person.roomsMin !== undefined ? { roomsMin: person.roomsMin } : {}),
        ...(person.roomsMax !== undefined ? { roomsMax: person.roomsMax } : {}),
        ...(budgetMaxShekels !== undefined ? { budgetMaxShekels } : {}),
      },
      buyers: page.items.map((buyer) => ({
        id: buyer.id,
        name: buyer.contact.name,
        cities: buyer.requirements.cities,
        ...(buyer.requirements.roomsMin !== undefined
          ? { roomsMin: buyer.requirements.roomsMin }
          : {}),
        ...(buyer.requirements.roomsMax !== undefined
          ? { roomsMax: buyer.requirements.roomsMax }
          : {}),
        ...(buyer.requirements.budgetMaxAgorot !== undefined
          ? { budgetMaxAgorot: buyer.requirements.budgetMaxAgorot }
          : {}),
        maturity: buyer.maturity,
      })),
    };
  }

  async createLead(input: {
    transcript: string;
    name: string;
    phone: string;
    intent: string;
  }): Promise<LeadIntakeResult> {
    const result = await this.leads.create({
      contactName: input.name,
      contactPhone: input.phone,
      // המקור האמיתי: המתווך תיעד שיחה בקול, לא מילא טופס (ביקורת Codex)
      source: "voice_call",
      intent: input.intent,
      summary: input.transcript.slice(0, 2000),
    });
    return { leadId: result.id, merged: result.merged, visible: result.visible };
  }

  async createBuyer(input: {
    transcript: string;
    name: string;
    phone: string;
    cities: string[];
    dealType: "sale" | "rent";
    budgetMaxAgorot: number;
    budgetMinAgorot?: number;
    roomsMin?: number;
    roomsMax?: number;
    areaSqmMin?: number;
    features: Record<string, "must" | "nice">;
    maturity?: string;
    financing?: string;
    agentNotes?: string;
  }): Promise<BuyerDto> {
    if (input.cities.length === 0) throw new BadRequestException("חסרה עיר מבוקשת");
    // התמלול המלא נשמר כהערות הסוכן — פרטים שהחילוץ לא מכסה (שכונות,
    // תזמון, הקשר חופשי) לא הולכים לאיבוד (ביקורת Codex)
    const agentNotes = [input.agentNotes, `נקלט בקול: ${input.transcript}`]
      .filter(Boolean)
      .join("\n")
      .slice(0, 4000);
    return this.buyers.create({
      contactName: input.name,
      contactPhone: input.phone,
      source: "voice",
      agentNotes,
      ...(input.maturity !== undefined ? { maturity: input.maturity } : {}),
      ...(input.financing !== undefined ? { financing: input.financing } : {}),
      requirements: {
        cities: input.cities,
        neighborhoods: [],
        dealType: input.dealType,
        propertyTypes: [],
        budgetMaxAgorot: input.budgetMaxAgorot,
        ...(input.budgetMinAgorot !== undefined ? { budgetMinAgorot: input.budgetMinAgorot } : {}),
        ...(input.roomsMin !== undefined ? { roomsMin: input.roomsMin } : {}),
        ...(input.roomsMax !== undefined ? { roomsMax: input.roomsMax } : {}),
        ...(input.areaSqmMin !== undefined ? { areaSqmMin: input.areaSqmMin } : {}),
        features: input.features as Record<
          "hasElevator" | "hasParking" | "hasBalcony" | "hasSafeRoom" | "hasStorage",
          "must" | "nice"
        >,
      },
    });
  }
}
