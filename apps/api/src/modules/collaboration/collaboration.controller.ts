import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
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
  type PayoutMode,
} from "@metavchim/shared";
import { RequireCapability } from "../../common/auth.decorators";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import {
  CollaborationService,
  type CoopOfferDto,
  type CreditExpiryInfo,
  type NetworkDemandMatchDto,
  type NetworkPropertyOfferDto,
  type ReferralTermsDto,
  type SharedDemandDto,
  type SharedLeadDto,
} from "./collaboration.service";
import { ListingsService, type SharedListingDto } from "./listings.service";
import { NetworkFilterSchema } from "./network-filter";

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
const PublishListingSchema = z
  .object({
    propertyId: IdSchema,
    commissionSplit: CommissionSplitSchema,
    /** "מה מיוחד בנכס" במילים; באחריות המפרסם בלי כתובת ובלי בעלים */
    note: z.string().trim().max(300).optional(),
  })
  .strict();

const InterestSchema = z
  .object({
    buyerId: IdSchema,
    commissionSplit: CommissionSplitSchema,
  })
  .strict();

const OfferSchema = z
  .object({ propertyId: IdSchema, commissionSplit: CommissionSplitSchema })
  .strict();
const RespondSchema = z
  .object({ response: z.enum(["interested", "declined"]) })
  .strict();
/*
 * פרסום הפניה. הגבולות והסיבות מגיעים מהכלל המשותף — הטופס והשרת
 * חייבים לדחות בדיוק את אותם ערכים, אחרת המסך מציג אפשרות שהשרת
 * ידחה. תוקף הסיבה עצמה נבדק בשירות (`referralReasonRejectionReason`),
 * כי הכלל "אחר מחייב פירוט" חוצה שני שדות.
 */
/*
 * `satisfies` ולא רשימה חופשית: אם `PayoutMode` יקבל מסלול שלישי,
 * השורה הזו תיכשל בקומפילציה במקום לקבל ערך שהשרת לא יודע לטפל בו.
 */
const PayoutModeSchema = z.enum([
  "credits",
  "cash",
]) satisfies z.ZodType<PayoutMode>;

const ShareLeadSchema = z
  .object({
    leadId: IdSchema,
    priceCredits: z
      .number()
      .int()
      .min(MIN_REFERRAL_PRICE)
      .max(MAX_REFERRAL_PRICE),
    reason: z.string().trim().min(1).max(30),
    reasonDetail: z.string().trim().max(MAX_REFERRAL_REASON_DETAIL).optional(),
    note: z.string().trim().max(MAX_REFERRAL_NOTE).optional(),
    city: z.string().trim().max(MAX_REFERRAL_CITY).optional(),
    /*
     * המסלול נקבע כאן פעם אחת ולתמיד — הוא נצרב על ההפניה. חסר =
     * קרדיטים, כדי שלקוחות ישנים של ה-API ימשיכו לעבוד כמו קודם.
     */
    payoutMode: PayoutModeSchema.optional(),
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
  constructor(
    private readonly collaboration: CollaborationService,
    private readonly listings: ListingsService,
  ) {}

  /* ============================================================
     הכיוון השני של הרשת: נכס שמתפרסם, וקונה שמביע בו עניין.
     אותם שערי הרשאה כמו בכיוון הקיים — `collaboration.share`
     לפרסום מה ששלי, `collaboration.offer` לפנייה למה שאחרים
     פרסמו. הרשאה חדשה הייתה אומרת שמשרד שכבר מורשה לשתף צריך
     הגדרה נוספת כדי לשתף בכיוון השני, וזו הפתעה ולא הגנה.
     ============================================================ */

  @Post("listings")
  @RequireCapability("collaboration.share")
  async publishListing(
    @Body(new ZodValidationPipe(PublishListingSchema))
    body: z.infer<typeof PublishListingSchema>,
  ): Promise<SharedListingDto> {
    return this.listings.publish(
      body.propertyId,
      body.commissionSplit,
      body.note,
    );
  }

  /**
   * מצב הפרסום של נכס — null כשאינו מפורסם.
   *
   * כרטיס הנכס קורא את זה בטעינה, מאותה סיבה שכרטיס הקונה עושה זאת:
   * מסך שמציע לפרסם נכס שכבר מפורסם מקבל שגיאה על פעולה שהוא עצמו
   * הציע.
   */
  @Get("listings/property/:propertyId")
  @RequireCapability("collaboration.share")
  async propertyListing(
    @Param("propertyId", new ZodValidationPipe(IdSchema)) propertyId: string,
  ): Promise<SharedListingDto | null> {
    return this.listings.activeForProperty(propertyId);
  }

  @Patch("listings/property/:propertyId")
  @RequireCapability("collaboration.share")
  async updateListing(
    @Param("propertyId", new ZodValidationPipe(IdSchema)) propertyId: string,
    @Body(new ZodValidationPipe(UpdateShareSchema))
    body: z.infer<typeof UpdateShareSchema>,
  ): Promise<SharedListingDto> {
    return this.listings.updatePublication(
      propertyId,
      body.commissionSplit,
      body.note,
    );
  }

  @Delete("listings/property/:propertyId")
  @RequireCapability("collaboration.share")
  @HttpCode(204)
  async unpublishListing(
    @Param("propertyId", new ZodValidationPipe(IdSchema)) propertyId: string,
  ): Promise<void> {
    await this.listings.unpublish(propertyId);
  }

  /**
   * פיד הנכסים ברשת.
   *
   * **מוכרח לשבת לפני `listings/:id`** אילו היה נתיב כזה — ואין,
   * בדיוק כדי שלא ייווצר. פרסום נקרא לפי הנכס שממנו נגזר, כי זה
   * המזהה שהמסך מחזיק.
   */
  @Get("listings")
  @RequireCapability("collaboration.offer")
  async networkListings(
    @Query(new ZodValidationPipe(NetworkFilterSchema))
    query: z.infer<typeof NetworkFilterSchema>,
  ): Promise<SharedListingDto[]> {
    return this.listings.list(query);
  }

  @Post("listings/:id/interest")
  @RequireCapability("collaboration.offer")
  @HttpCode(204)
  async expressInterest(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(InterestSchema))
    body: z.infer<typeof InterestSchema>,
  ): Promise<void> {
    await this.listings.expressInterest(id, body.buyerId, body.commissionSplit);
  }

  /** קונים שמשרדים אחרים מציעים על הנכסים שפרסמתי. */
  @Get("interests")
  @RequireCapability("collaboration.share")
  async interests(): Promise<
    Awaited<ReturnType<ListingsService["listInterests"]>>
  > {
    return this.listings.listInterests();
  }

  @Patch("interests/:id/respond")
  @RequireCapability("collaboration.share")
  @HttpCode(204)
  async respondToInterest(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(RespondSchema))
    body: z.infer<typeof RespondSchema>,
  ): Promise<void> {
    await this.listings.respondToInterest(id, body.response);
  }

  /**
   * מה מהמאגר שלי מתאים למשהו שכבר ברשת ואינו מפורסם בה.
   *
   * `collaboration.offer` ולא `share`: זו קריאה על הרשת, וסוכן
   * שרואה את הפיד אמור לדעת גם מה הוא מפספס בו.
   */
  @Get("reach")
  @RequireCapability("collaboration.offer")
  async reach(): Promise<Awaited<ReturnType<ListingsService["reach"]>>> {
    return this.listings.reach();
  }

  @Post("share")
  @RequireCapability("collaboration.share")
  async share(
    @Body(new ZodValidationPipe(ShareSchema)) body: z.infer<typeof ShareSchema>,
  ): Promise<SharedDemandDto> {
    return this.collaboration.shareBuyer(
      body.buyerId,
      body.commissionSplit,
      body.note,
    );
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
    @Body(new ZodValidationPipe(UpdateShareSchema))
    body: z.infer<typeof UpdateShareSchema>,
  ): Promise<SharedDemandDto> {
    return this.collaboration.updateSharedDemand(
      buyerId,
      body.commissionSplit,
      body.note,
    );
  }

  @Delete("demands/:id")
  @RequireCapability("collaboration.share")
  @HttpCode(204)
  async unshare(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<void> {
    await this.collaboration.unshare(id);
  }

  @Get("demands")
  @RequireCapability("collaboration.offer")
  async demands(
    @Query(new ZodValidationPipe(NetworkFilterSchema))
    query: z.infer<typeof NetworkFilterSchema>,
  ): Promise<SharedDemandDto[]> {
    return this.collaboration.listDemands(query);
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
    return this.collaboration.offerProperty(
      id,
      body.propertyId,
      body.commissionSplit,
    );
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
    @Body(new ZodValidationPipe(RespondSchema))
    body: z.infer<typeof RespondSchema>,
  ): Promise<{ ok: true }> {
    await this.collaboration.respondToCoopOffer(id, body.response);
    return { ok: true };
  }

  @Get("credits")
  @RequireCapability("collaboration.offer")
  async credits(): Promise<{
    balance: number;
    unitPriceAgorot: number;
    packages: { credits: number; priceAgorot: number }[];
    expiry: CreditExpiryInfo;
  }> {
    return this.collaboration.credits();
  }

  /**
   * סיכום לדשבורד: כמה מחכה לי ברשת ומה היתרה, בבקשה אחת.
   *
   * לא רשימות מקוצצות — הדשבורד מציג מספרים, והמספרים נספרים במסד.
   */
  @Get("summary")
  @RequireCapability("collaboration.offer")
  async summary(): Promise<{
    incomingOffers: number;
    openReferrals: number;
    credits: number;
  }> {
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
    @Body(new ZodValidationPipe(ShareLeadSchema))
    body: z.infer<typeof ShareLeadSchema>,
  ): Promise<SharedLeadDto> {
    return this.collaboration.shareLead(body);
  }

  @Delete("leads/:id")
  @RequireCapability("collaboration.share")
  @HttpCode(204)
  async withdrawLead(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<void> {
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
    @Body(new ZodValidationPipe(RateReferralSchema))
    body: z.infer<typeof RateReferralSchema>,
  ): Promise<{ ok: true }> {
    await this.collaboration.rateReferral(
      id,
      "referrer",
      body.score,
      body.comment,
    );
    return { ok: true };
  }

  /** דירוג ההפניה שקלטתי — זה מה שבונה את המוניטין של המשרד המפנה. */
  @Post("leads/:id/rating/received")
  @RequireCapability("collaboration.offer")
  @HttpCode(200)
  async rateReferralReceived(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(RateReferralSchema))
    body: z.infer<typeof RateReferralSchema>,
  ): Promise<{ ok: true }> {
    await this.collaboration.rateReferral(
      id,
      "receiver",
      body.score,
      body.comment,
    );
    return { ok: true };
  }
}
