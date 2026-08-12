import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import {
  DEFAULT_COMMISSION_SPLIT,
  IdSchema,
  MAX_COMMISSION_SHARE,
  MAX_REFERRAL_CITY,
  MAX_REFERRAL_NOTE,
  MAX_REFERRAL_PRICE,
  MAX_REFERRAL_RATING,
  MAX_REFERRAL_RATING_COMMENT,
  MAX_REFERRAL_REASON_DETAIL,
  MIN_COMMISSION_SHARE,
  MIN_REFERRAL_PRICE,
  MIN_REFERRAL_RATING,
} from "@metavchim/shared";
import { RequireCapability } from "../../common/auth.decorators";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import {
  CollaborationService,
  type CoopOfferDto,
  type NetworkDemandMatchDto,
  type NetworkPropertyOfferDto,
  type ReferralTermsDto,
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
  .object({
    buyerId: IdSchema,
    commissionSplit: CommissionSplitSchema,
    /** "מה הקונה מחפש" במילים — מוצג בפיד; באחריות המשתף בלי PII */
    note: z.string().trim().max(300).optional(),
  })
  .strict();
/** עדכון ביקוש קיים — הקונה מגיע מהנתיב, ולכן אינו חוזר בגוף הבקשה. */
const UpdateShareSchema = z
  .object({
    commissionSplit: CommissionSplitSchema,
    note: z.string().trim().max(300).optional(),
  })
  .strict();
const OfferSchema = z
  .object({ propertyId: IdSchema, commissionSplit: CommissionSplitSchema })
  .strict();
const RespondSchema = z.object({ response: z.enum(["interested", "declined"]) }).strict();
/*
 * פרסום הפניה. הגבולות והסיבות מגיעים מהכלל המשותף — הטופס והשרת
 * חייבים לדחות בדיוק את אותם ערכים, אחרת המסך מציג אפשרות שהשרת
 * ידחה. תוקף הסיבה עצמה נבדק בשירות (`referralReasonRejectionReason`),
 * כי הכלל "אחר מחייב פירוט" חוצה שני שדות.
 */
const ShareLeadSchema = z
  .object({
    leadId: IdSchema,
    priceCredits: z.number().int().min(MIN_REFERRAL_PRICE).max(MAX_REFERRAL_PRICE),
    reason: z.string().trim().min(1).max(30),
    reasonDetail: z.string().trim().max(MAX_REFERRAL_REASON_DETAIL).optional(),
    note: z.string().trim().max(MAX_REFERRAL_NOTE).optional(),
    city: z.string().trim().max(MAX_REFERRAL_CITY).optional(),
  })
  .strict();
const RateReferralSchema = z
  .object({
    score: z.number().int().min(MIN_REFERRAL_RATING).max(MAX_REFERRAL_RATING),
    comment: z.string().trim().max(MAX_REFERRAL_RATING_COMMENT).optional(),
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
    return this.collaboration.shareBuyer(body.buyerId, body.commissionSplit, body.note);
  }

  /**
   * מצב השיתוף של קונה — null כשאינו משותף.
   *
   * כרטיס הקונה קורא את זה בטעינה: בלי זה הוא היה מציע לשתף קונה
   * שכבר משותף, והשרת היה דוחה בשגיאה על פעולה שהמסך עצמו הציע.
   */
  @Get("share/buyer/:buyerId")
  @RequireCapability("collaboration.share")
  async buyerShare(
    @Param("buyerId", new ZodValidationPipe(IdSchema)) buyerId: string,
  ): Promise<SharedDemandDto | null> {
    return this.collaboration.activeDemandForBuyer(buyerId);
  }

  /** עדכון חלוקת עמלה ותיאור של ביקוש קיים, בלי לסגור ולפרסם מחדש. */
  @Patch("share/buyer/:buyerId")
  @RequireCapability("collaboration.share")
  async updateShare(
    @Param("buyerId", new ZodValidationPipe(IdSchema)) buyerId: string,
    @Body(new ZodValidationPipe(UpdateShareSchema)) body: z.infer<typeof UpdateShareSchema>,
  ): Promise<SharedDemandDto> {
    return this.collaboration.updateSharedDemand(buyerId, body.commissionSplit, body.note);
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

  /**
   * העמודה השנייה בכרטיס הנכס — ביקושים ברשת שהנכס עונה עליהם.
   *
   * מאחורי `collaboration.offer` ולא `properties.view`: מי שאינו רשאי
   * להציע ברשת אינו אמור לראות את הביקושים שלה, ובוודאי לא לקבל
   * עמודה שלמה של פעולות שכל אחת מהן תיחסם.
   */
  @Get("network-matches/property/:propertyId")
  @RequireCapability("collaboration.offer")
  async networkMatchesForProperty(
    @Param("propertyId", new ZodValidationPipe(IdSchema)) propertyId: string,
  ): Promise<NetworkDemandMatchDto[]> {
    return this.collaboration.networkMatchesForProperty(propertyId);
  }

  /**
   * העמודה השנייה בכרטיס הקונה — נכסים שמשרדים אחרים הציעו עליו.
   *
   * `collaboration.share` ולא `.offer`: זו התוצאה של פרסום הקונה
   * שלי, וזו היכולת שמאפשרת לפרסם אותו מלכתחילה.
   */
  @Get("network-matches/buyer/:buyerId")
  @RequireCapability("collaboration.share")
  async networkMatchesForBuyer(
    @Param("buyerId", new ZodValidationPipe(IdSchema)) buyerId: string,
  ): Promise<{ shared: boolean; offers: NetworkPropertyOfferDto[] }> {
    return this.collaboration.networkMatchesForBuyer(buyerId);
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

  /**
   * סיכום לדשבורד: כמה מחכה לי ברשת ומה היתרה, בבקשה אחת.
   *
   * לא רשימות מקוצצות — הדשבורד מציג מספרים, והמספרים נספרים במסד.
   */
  @Get("summary")
  @RequireCapability("collaboration.offer")
  async summary(): Promise<{ incomingOffers: number; openReferrals: number; credits: number }> {
    return this.collaboration.networkSummary();
  }

  /* ============================================================
     לוח ההפניות: הפניית לקוח בין משרדים תמורת קרדיטים.
     פרסום = אותה יכולת כמו שיתוף ביקוש; קליטה = אותה יכולת כמו
     הצעה על ביקוש — אין תפקיד חדש לנהל.
     ============================================================ */

  /**
   * תנאי ההפניה לליד מסוים — הצעת מחיר פתיחה ושיעור עמלת הפלטפורמה.
   * מגיע מהשרת ולא מחושב במסך: טופס שמנחש את ההצעה יציג מספר אחר
   * ממה שהשרת מכיר.
   */
  @Get("leads/terms/:leadId")
  @RequireCapability("collaboration.share")
  async referralTerms(
    @Param("leadId", new ZodValidationPipe(IdSchema)) leadId: string,
  ): Promise<ReferralTermsDto> {
    return this.collaboration.referralTerms(leadId);
  }

  @Post("leads")
  @RequireCapability("collaboration.share")
  async shareLead(
    @Body(new ZodValidationPipe(ShareLeadSchema)) body: z.infer<typeof ShareLeadSchema>,
  ): Promise<SharedLeadDto> {
    return this.collaboration.shareLead(body);
  }

  @Delete("leads/:id")
  @RequireCapability("collaboration.share")
  @HttpCode(204)
  async withdrawLead(@Param("id", new ZodValidationPipe(IdSchema)) id: string): Promise<void> {
    await this.collaboration.withdrawLead(id);
  }

  /**
   * הרישומים שלי בלבד — תחת יכולת ה**שיתוף**: מי שמותר לו להפנות
   * חייב לראות ולהסיר את מה שפרסם גם בלי יכולת הקליטה, אחרת כרטיס
   * הליד מציג "לא משותף" על ליד שכן משותף (ביקורת Codex).
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

  /* ------------------------------------------------------------
     דירוג הדדי. **שני נתיבים ולא אחד** — לא כפילות אלא הפרדת
     היכולות: המשרד המפנה מחזיק ב-share, המשרד הקולט ב-offer, ומשרד
     שמחזיק רק באחת מהן חייב לדרג. התפקיד מגיע מהנתיב ונבדק בשירות
     מול השורה עצמה.
     ------------------------------------------------------------ */

  /** דירוג הלקוח שהפניתי — נשמר ומוצג לצד השני, ואינו נספר למוניטין. */
  @Post("leads/:id/rating/given")
  @RequireCapability("collaboration.share")
  @HttpCode(200)
  async rateReferralGiven(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(RateReferralSchema)) body: z.infer<typeof RateReferralSchema>,
  ): Promise<{ ok: true }> {
    await this.collaboration.rateReferral(id, "referrer", body.score, body.comment);
    return { ok: true };
  }

  /** דירוג ההפניה שקלטתי — זה מה שבונה את המוניטין של המשרד המפנה. */
  @Post("leads/:id/rating/received")
  @RequireCapability("collaboration.offer")
  @HttpCode(200)
  async rateReferralReceived(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(RateReferralSchema)) body: z.infer<typeof RateReferralSchema>,
  ): Promise<{ ok: true }> {
    await this.collaboration.rateReferral(id, "receiver", body.score, body.comment);
    return { ok: true };
  }
}
