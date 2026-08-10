import { BadRequestException, Injectable } from "@nestjs/common";
import { z } from "zod";
import { extractPersonFromTranscript, type ExtractedPerson } from "@metavchim/shared";
import { GeminiService } from "../../core/gemini.service";
import { BuyersService, type BuyerDto } from "../buyers/buyers.service";
import { LeadsService } from "../leads/leads.service";

/**
 * מה ש-Gemini רשאי להציע כקריטריונים לשאלת קונים. הכול אופציונלי,
 * הכול מגודר — מחוץ לזה נזרק. תאריכים אין כאן בכלל.
 */
const LlmCriteriaSchema = z
  .object({
    cities: z.array(z.string().trim().min(2).max(40)).max(5).optional(),
    roomsMin: z.number().min(1).max(20).optional(),
    roomsMax: z.number().min(1).max(20).optional(),
    budgetMinShekels: z.number().int().positive().max(1_000_000_000).optional(),
    budgetMaxShekels: z.number().int().positive().max(1_000_000_000).optional(),
  })
  .passthrough();

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
  /** יש עוד מעבר ל-50 שהוחזרו — המסך אומר זאת במקום "נמצאו 50" חלקי */
  hasMore: boolean;
  criteria: {
    cities: string[];
    roomsMin?: number;
    roomsMax?: number;
    budgetMinShekels?: number;
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
    private readonly gemini: GeminiService,
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
   * שני מחלצים, קוד מכריע: המנוע הדטרמיניסטי של קליטת קונה
   * (extractPerson) הוא הרצפה שעובדת תמיד, ו-Gemini משלים מעליו את
   * מה שביטוי רגולרי לא תופס — "עד שני מיליון" במילים, "משהו קטן
   * במרכז ראשון". ערך שהמנוע מצא מנצח את ה-LLM (הוא מדויק), וה-LLM
   * ממלא רק חורים. הסינון עצמו הוא הפילטר של מסך הקונים — כולל
   * חפיפת טווחי תקציב ו-ownershipFilter.
   */
  async queryBuyers(transcript: string): Promise<BuyerQueryAnswer> {
    const { person } = extractPersonFromTranscript(transcript);
    const llm = await this.criteriaViaLlm(transcript);

    const roomsMin = person.roomsMin ?? llm?.roomsMin;
    const roomsMax = person.roomsMax ?? llm?.roomsMax;
    // "בין 1.5 ל-2 מיליון" — בלי הרצפה, קונה שכל התקציב שלו מתחת
    // ל-1.5 היה עובר את בדיקת החפיפה (ביקורת Codex)
    const budgetMinShekels =
      person.budgetMinAgorot !== undefined
        ? Math.round(person.budgetMinAgorot / 100)
        : llm?.budgetMinShekels;
    const budgetMaxShekels =
      person.budgetMaxAgorot !== undefined
        ? Math.round(person.budgetMaxAgorot / 100)
        : llm?.budgetMaxShekels;
    const cities =
      person.cities.length > 0 ? person.cities : (llm?.cities ?? []);

    const page = await this.buyers.list({
      limit: 50,
      // "4 חדרים" סתם ⇒ min=max=4, והחפיפה מוצאת כל קונה שהטווח
      // שלו כולל 4 (גם "3–5 חדרים")
      ...(roomsMin !== undefined ? { minRooms: roomsMin } : {}),
      ...(roomsMax !== undefined ? { maxRooms: roomsMax } : {}),
      ...(budgetMinShekels !== undefined ? { minPrice: budgetMinShekels } : {}),
      ...(budgetMaxShekels !== undefined ? { maxPrice: budgetMaxShekels } : {}),
      // כל הערים שנאמרו, לא רק הראשונה — "תל אביב או רמת גן" מוצא
      // גם קונה שמעוניין רק בשנייה (ביקורת Codex)
      ...(cities.length > 0 ? { cities } : {}),
    });

    return {
      // תשובה חתוכה מסומנת — "נמצאו 50" כשיש יותר הוא שקר שקט
      hasMore: page.nextCursor !== null,
      criteria: {
        cities,
        ...(roomsMin !== undefined ? { roomsMin } : {}),
        ...(roomsMax !== undefined ? { roomsMax } : {}),
        ...(budgetMinShekels !== undefined ? { budgetMinShekels } : {}),
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

  /** קריטריונים מ-Gemini — null על כל כשל; הרצפה הדטרמיניסטית נשארת. */
  private async criteriaViaLlm(
    transcript: string,
  ): Promise<z.infer<typeof LlmCriteriaSchema> | null> {
    if (!(await this.gemini.isConfigured())) return null;
    const raw = await this.gemini.generateJson(
      [
        'חלץ קריטריונים לחיפוש קונים במאגר נדל"ן מתוך שאלה בעברית מדוברת. החזר JSON בלבד.',
        "שדות (כולם אופציונליים — השמט כל שדה שלא נאמר במפורש):",
        '- cities: מערך שמות ערים בישראל בכתיב הרשמי ("תל אביב", "ראשון לציון")',
        '- roomsMin, roomsMax: מספר חדרים (מ"ארבע חדרים" ⇒ 4 ו-4; מ"3 עד 5" ⇒ 3 ו-5; מ"לפחות 3" ⇒ רק roomsMin)',
        '- budgetMinShekels, budgetMaxShekels: תקציב בשקלים ("עד שני מיליון" ⇒ budgetMaxShekels: 2000000)',
        "אל תמציא ערכים. אל תחזיר שדות אחרים.",
        `השאלה: "${transcript.replaceAll('"', "'")}"`,
      ].join("\n"),
    );
    const parsed = LlmCriteriaSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
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
