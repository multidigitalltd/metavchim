import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import {
  DEFAULT_COMMISSION_SPLIT,
  IdSchema,
  MAX_COMMISSION_SHARE,
  MAX_SHARED_LEAD_CITY,
  MAX_SHARED_LEAD_NOTE,
  MIN_COMMISSION_SHARE,
} from "@metavchim/shared";
import { RequireCapability } from "../../common/auth.decorators";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import {
  CollaborationService,
  type CoopOfferDto,
  type SharedDemandDto,
  type SharedLeadDto,
} from "./collaboration.service";

/**
 * חלוקת העמלה. הגבולות מגיעים מהכלל המשותף ולא נכתבים כאן שוב —
 * שני מקורות למינימום היו נפרדים ביום שמישהו משנה אחד מהם.
 */
const CommissionSplitSchema = z
  .number()
  .int()
  .min(MIN_COMMISSION_SHARE)
  .max(MAX_COMMISSION_SHARE)
  .default(DEFAULT_COMMISSION_SPLIT);

const ShareSchema = z
  .object({ buyerId: IdSchema, commissionSplit: CommissionSplitSchema })
  .strict();
const OfferSchema = z
  .object({ propertyId: IdSchema, commissionSplit: CommissionSplitSchema })
  .strict();
const RespondSchema = z.object({ response: z.enum(["interested", "declined"]) }).strict();
const ShareLeadSchema = z
  .object({
    leadId: IdSchema,
    note: z.string().trim().max(MAX_SHARED_LEAD_NOTE).optional(),
    city: z.string().trim().max(MAX_SHARED_LEAD_CITY).optional(),
  })
  .strict();

/*
 * **בלי שער מסלול.** שיתוף פעולה בין משרדים פתוח בכל המסלולים —
 * רשת שרק המסלולים הגבוהים נמצאים בה אינה רשת, ומשרד שאינו יכול
 * להציע נכס לעמית פשוט לא ישתף גם את הביקושים שלו.
 *
 * מה שכן עולה הוא **ליד ממקור חיצוני**, והתמחור לפי מקור הביקוש
 * ולא לפי המסלול — ראו packages/shared/logic/collaboration-cost.ts.
 */
@Controller("collaboration")
export class CollaborationController {
  constructor(private readonly collaboration: CollaborationService) {}

  @Post("share")
  @RequireCapability("collaboration.share")
  async share(
    @Body(new ZodValidationPipe(ShareSchema)) body: z.infer<typeof ShareSchema>,
  ): Promise<SharedDemandDto> {
    return this.collaboration.shareBuyer(body.buyerId, body.commissionSplit);
  }

  @Delete("demands/:id")
  @RequireCapability("collaboration.share")
  @HttpCode(204)
  async unshare(@Param("id", new ZodValidationPipe(IdSchema)) id: string): Promise<void> {
    await this.collaboration.unshare(id);
  }

  @Get("demands")
  @RequireCapability("collaboration.offer")
  async demands(): Promise<SharedDemandDto[]> {
    return this.collaboration.listDemands();
  }

  @Post("demands/:id/offer")
  @RequireCapability("collaboration.offer")
  async offer(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(OfferSchema)) body: z.infer<typeof OfferSchema>,
  ): Promise<CoopOfferDto> {
    return this.collaboration.offerProperty(id, body.propertyId, body.commissionSplit);
  }

  @Get("offers")
  @RequireCapability("collaboration.offer")
  async offers(): Promise<CoopOfferDto[]> {
    return this.collaboration.listCoopOffers();
  }

  @Patch("offers/:id/respond")
  @RequireCapability("collaboration.offer")
  @HttpCode(200)
  async respond(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(RespondSchema)) body: z.infer<typeof RespondSchema>,
  ): Promise<{ ok: true }> {
    await this.collaboration.respondToCoopOffer(id, body.response);
    return { ok: true };
  }

  @Get("credits")
  @RequireCapability("collaboration.offer")
  async credits(): Promise<{ balance: number }> {
    return this.collaboration.credits();
  }

  /* ============================================================
     שוק הלידים: מכירת ליד בקרדיטים בין משרדים.
     שיתוף = אותה יכולת כמו שיתוף ביקוש; קנייה = אותה יכולת כמו
     הצעה על ביקוש — אין תפקיד חדש לנהל.
     ============================================================ */

  @Post("leads")
  @RequireCapability("collaboration.share")
  async shareLead(
    @Body(new ZodValidationPipe(ShareLeadSchema)) body: z.infer<typeof ShareLeadSchema>,
  ): Promise<SharedLeadDto> {
    return this.collaboration.shareLead(body.leadId, body.note, body.city);
  }

  @Delete("leads/:id")
  @RequireCapability("collaboration.share")
  @HttpCode(204)
  async withdrawLead(@Param("id", new ZodValidationPipe(IdSchema)) id: string): Promise<void> {
    await this.collaboration.withdrawLead(id);
  }

  /**
   * הרישומים שלי בלבד — תחת יכולת ה**שיתוף**: מי שמותר לו למכור חייב
   * לראות ולהסיר את מה שפרסם גם בלי יכולת הקנייה, אחרת כרטיס הליד
   * מציג "לא משותף" על ליד שכן משותף (ביקורת Codex).
   */
  @Get("leads/mine")
  @RequireCapability("collaboration.share")
  async mySharedLeads(): Promise<SharedLeadDto[]> {
    return this.collaboration.listMySharedLeads();
  }

  @Get("leads")
  @RequireCapability("collaboration.offer")
  async sharedLeads(): Promise<SharedLeadDto[]> {
    return this.collaboration.listSharedLeads();
  }

  @Post("leads/:id/buy")
  @RequireCapability("collaboration.offer")
  async buyLead(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<{ leadId: string }> {
    return this.collaboration.buyLead(id);
  }
}
