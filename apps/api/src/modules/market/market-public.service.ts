import { Injectable, NotFoundException } from "@nestjs/common";
import {
  MARKET_SOURCE_ATTRIBUTION,
  formatMarketIls,
  propertyTypeToNatureGroup,
  selectComparables,
  type MarketPublicEstimateDto,
  type MarketSubject,
  type PropertyType,
} from "@metavchim/shared";
import { PrismaService } from "../../core/prisma.service";
import { WebLeadService } from "../leads/web-lead.service";
import { MarketService } from "./market.service";

/** המקור שנרשם על הליד — באורך העמודה (20). */
const LEAD_SOURCE = "הערכת שווי";

export interface PublicEstimateInput {
  city: string;
  street?: string;
  houseNumber?: string;
  propertyType?: PropertyType;
  rooms: number;
  areaSqm?: number;
  contact?: { name: string; phone: string; email?: string };
}

/**
 * ‎**„כמה שווה הדירה שלי” — טופס לאתר של המשרד** (docs/18 §3, יכולת 4).
 *
 * הליד החסר ביותר בתיווך הוא **מוכר**. בעל דירה שמתלבט שואל קודם
 * כמה היא שווה, ומי שעונה לו ראשון הוא מי שיקבל את הבלעדיות. הטופס
 * עונה מיד, מעסקאות אמת, ומציע להשאיר פרטים לדו"ח מפורט ממתווך.
 *
 * ## המפתח הוא מפתח הקליטה של המשרד
 *
 * אותו מפתח של טופס הלידים באתר (`lead_webhooks`) — לא מפתח חדש.
 * הוא מזהה את המשרד ואת הערוץ, והליד נכנס דרך `WebLeadService`, אותו
 * שירות בדיוק של כל טופס באתר: נעילה פר טלפון, הצטרפות לליד פתוח,
 * הצפנת הפרטים. אין כאן מסלול שני לכתיבת ליד.
 *
 * ## הטווח מוצג גם בלי פרטים
 *
 * טופס שמסתיר את התשובה עד שמשאירים טלפון נתפס כמלכודת, ומשאיר
 * פרטים מזויפים. התשובה ניתנת מיד; הפרטים הם בחירה — ואז הם שווים
 * משהו.
 */
@Injectable()
export class MarketPublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly market: MarketService,
    private readonly webLeads: WebLeadService,
  ) {}

  /** שם המשרד לכותרת הטופס. מפתח לא מוכר — אותה תשובה כמו בקליטת לידים. */
  async office(key: string): Promise<{ officeName: string }> {
    const hook = await this.prisma.leadWebhook.findUnique({ where: { key }, select: { tenantId: true } });
    if (!hook) throw new NotFoundException("לא נמצא");
    const tenant = await this.prisma.tenant.findUnique({ where: { id: hook.tenantId }, select: { name: true } });
    return { officeName: tenant?.name ?? "" };
  }

  async estimate(key: string, input: PublicEstimateInput, now: Date): Promise<MarketPublicEstimateDto> {
    const hook = await this.prisma.leadWebhook.findUnique({ where: { key }, select: { tenantId: true } });
    if (!hook) throw new NotFoundException("לא נמצא");

    const settlement = await this.market.resolveSettlement(input.city);
    let result: MarketPublicEstimateDto = {
      settlement: settlement?.name ?? null,
      sampleSize: 0,
      scope: null,
      estimate: null,
      leadCreated: false,
      attribution: MARKET_SOURCE_ATTRIBUTION,
    };

    if (settlement) {
      /*
       * הרחוב → גוש, כשהחלקות של הרחוב כבר הועשרו. בלי זה ההשוואה
       * היא לכל היישוב — נכונה, אבל רחבה מכדי לומר משהו על רחוב.
       */
      const parcel = input.street
        ? await this.prisma.marketParcel.findFirst({
            where: { settlementId: settlement.id, street: input.street.trim() },
            select: { gush: true, statArea: true },
          })
        : null;
      const subject: MarketSubject = {
        group: propertyTypeToNatureGroup(input.propertyType ?? null),
        rooms: input.rooms,
        areaSqm: input.areaSqm ?? null,
        gush: parcel?.gush ?? null,
        helka: null,
        statArea: parcel?.statArea ?? null,
      };
      const comparison = selectComparables(
        subject,
        await this.market.candidates(settlement.id, subject.group, subject, now),
        now,
      );
      result = {
        ...result,
        sampleSize: comparison.sampleSize,
        scope: comparison.scope,
        estimate: comparison.estimate,
      };
    }

    if (input.contact) {
      const address = [input.street, input.houseNumber].filter(Boolean).join(" ");
      const details = [
        `${input.city}${address ? `, ${address}` : ""}`,
        `${input.rooms} חד'`,
        input.areaSqm !== undefined ? `${input.areaSqm} מ"ר` : null,
      ]
        .filter((part): part is string => part !== null)
        .join(" · ");
      const shown = result.estimate
        ? `טווח שהוצג לפונה: ${formatMarketIls(result.estimate.low)}–${formatMarketIls(result.estimate.high)} (לפי ${result.sampleSize} עסקאות).`
        : "לא הוצג טווח — אין מספיק עסקאות דומות.";
      await this.webLeads.ingestForTenant(
        hook.tenantId,
        {
          name: input.contact.name,
          phone: input.contact.phone,
          ...(input.contact.email === undefined ? {} : { email: input.contact.email }),
          intent: "sell",
          message: `בקשת הערכת שווי מהאתר: ${details}. ${shown}`,
        },
        LEAD_SOURCE,
      );
      result = { ...result, leadCreated: true };
    }
    return result;
  }
}
