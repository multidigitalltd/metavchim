import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
} from "@nestjs/common";
import { z } from "zod";
import {
  COOP_DEAL_STAGES,
  DEFAULT_COMMISSION_SPLIT,
  IdSchema,
  MAX_COOP_DEAL_MESSAGE,
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
  OTHER_SPLIT_MAX_NOTE,
  uniformTerms,
  type CommissionTerms,
  type CoopDealStage,
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
import {
  DealRoomService,
  type DealDto,
  type DealSummaryDto,
} from "./deal-room.service";
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

/**
 * חלוקה בצד אחד — אחוז, או „אחר” עם ניסוח.
 *
 * הסכימה כאן בודקת **צורה** בלבד: `split` מספר שלם או `null`.
 * הטווח והחובה לנסח את „אחר” נאכפים ב-`commissionTermsRejectionReason`
 * המשותף, כדי שההודעה שהמסך מקבל תהיה אותה הודעה בדיוק שהמסך כבר
 * מציג לפני השליחה — ולא שתי גרסאות שנפרדות ביום שמישהו משנה גבול.
 */
const CommissionSideSchema = z
  .object({
    split: z.number().int().nullable(),
    note: z.string().trim().max(OTHER_SPLIT_MAX_NOTE).nullable().optional(),
  })
  .strict();

/**
 * שני הצדדים — מה שהטופס שולח.
 *
 * רשות, ו-`commissionSplit` נשאר לצדו: לקוח שאינו מכיר את ההפרדה
 * (למשל אינטגרציה קיימת) שולח מספר אחד, והוא נקרא כחלוקה זהה בשני
 * הצדדים — בדיוק מה שהוא אמר, ולא ניחוש.
 */
const CommissionTermsSchema = z
  .object({ buyer: CommissionSideSchema, seller: CommissionSideSchema })
  .strict();

/** מה שהשרת עובד איתו: התנאים המפורשים, או המספר היחיד כשאין. */
function termsFrom(body: {
  terms?: z.infer<typeof CommissionTermsSchema>;
  commissionSplit: number;
}): CommissionTerms {
  if (body.terms === undefined) return uniformTerms(body.commissionSplit);
  const { buyer, seller } = body.terms;
  return {
    buyer: { split: buyer.split, note: buyer.note ?? null },
    seller: { split: seller.split, note: seller.note ?? null },
  };
}

/**
 * התיאור החופשי — **חובה**, ולא רשות.
 *
 * מודעה בלי מילה אחת של המשתף היא רשימת מספרים: תקציב, חדרים
 * ועיר. הצד השני אינו יכול לדעת ממנה אם שווה לו להשקיע נכס
 * ולחכות לתשובה, ובפועל הוא מדלג עליה. שורה אחת — „זוג צעיר,
 * גמיש בקומה, חייב כניסה תוך חודשיים” — היא ההבדל בין מודעה
 * שנענית למודעה שיושבת בפיד.
 *
 * 10 תווים כמינימום: קצר מזה הוא „דירה” או „דחוף”, שאינם אומרים
 * דבר, ואילו כל דרישה גבוהה יותר הייתה מזמינה מילוי מהשפה.
 */
const NetworkNoteSchema = z
  .string()
  .trim()
  .min(10, "תיאור קצר מדי — כתבו לפחות משפט אחד שיעזור לצד השני להחליט")
  .max(300);

const ShareSchema = z
  .object({
    buyerId: IdSchema,
    commissionSplit: CommissionSplitSchema,
    terms: CommissionTermsSchema.optional(),
    /** "מה הקונה מחפש" במילים — מוצג בפיד; באחריות המשתף בלי PII */
    note: NetworkNoteSchema,
  })
  .strict();

/**
 * שיתוף/פרסום מרוכז מהרשימות — מזהים בלבד.
 *
 * בלי חלוקת עמלה ובלי תיאור: הפעולה המרוכזת מפרסמת בברירת המחדל,
 * והתיאור נשאב מהכרטיס עצמו. מי שרוצה תנאים אחרים עורך את הפרסום
 * הבודד. 50 — גבול שפוי לבקשה אחת, לא מכסה.
 */
const BulkShareSchema = z
  .object({ buyerIds: z.array(IdSchema).min(1).max(50) })
  .strict();
const BulkPublishSchema = z
  .object({ propertyIds: z.array(IdSchema).min(1).max(50) })
  .strict();
/** עדכון ביקוש קיים — הקונה מגיע מהנתיב, ולכן אינו חוזר בגוף הבקשה. */
const UpdateShareSchema = z
  .object({
    commissionSplit: CommissionSplitSchema,
    terms: CommissionTermsSchema.optional(),
    note: NetworkNoteSchema,
  })
  .strict();
const PublishListingSchema = z
  .object({
    propertyId: IdSchema,
    commissionSplit: CommissionSplitSchema,
    terms: CommissionTermsSchema.optional(),
    /** "מה מיוחד בנכס" במילים; באחריות המפרסם בלי כתובת ובלי בעלים */
    note: NetworkNoteSchema,
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
  .object({
    response: z.enum(["interested", "declined"]),
    /** סיבת „לא מתאים” — נשלחת למשרד שהציע. רלוונטית רק בדחייה. */
    note: z.string().trim().max(300).optional(),
  })
  .strict();

/*
 * חדר העסקה. השלבים מגיעים מהכלל המשותף ולא נכתבים כאן שוב — רשימה
 * שנייה הייתה מקבלת שלב שהשרת אינו יודע לטפל בו ביום שמישהו מוסיף
 * אחד. `as [string, ...string[]]` כי `z.enum` דורש טאפל לא-ריק,
 * ו-`COOP_DEAL_STAGES` היא `readonly` בקבוע.
 */
const DealStageSchema = z
  .object({
    stage: z.enum(COOP_DEAL_STAGES as unknown as [string, ...string[]]),
    /** סיבת הסגירה — נשמרת רק כשעוברים לשלב סופי. */
    note: z.string().trim().max(200).optional(),
  })
  .strict();

const DealMessageSchema = z
  .object({ body: z.string().trim().min(1).max(MAX_COOP_DEAL_MESSAGE) })
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
    /*
     * הצהרת המפנה על איכות הלקוח — **חובה**, ולא שדה רשות.
     *
     * זה מה שהמשרד הקולט רואה לפני שהוא משלם, וזה מה שהאישור שלו
     * נמדד מולו אחר כך. הפניה בלי הצהרה הייתה שורה בלוח שאין עליה
     * מה לדעת ומחיר שמשלמים על סמך אמון בלבד.
     */
    scores: z
      .record(
        z.string().max(30),
        z.number().int().min(MIN_REFERRAL_RATING).max(MAX_REFERRAL_RATING),
      )
      /*
       * חסם עליון על מספר הממדים. הקטלוג ארוך מארבעה, והשירות דוחה
       * מפתח שאינו בו — אבל הבדיקה הזו עוברת על כל המפתחות שהתקבלו,
       * ואובייקט עם עשרות אלפי מפתחות היה עבודה שנעשית לפני שהיא
       * נדחית. הסינון כאן זול והוא לפני העבודה.
       */
      .refine((value) => {
        const keys = Object.keys(value).length;
        return keys > 0 && keys <= 10;
      }, "יש לדרג לפחות ממד אחד"),
  })
  .strict();
/**
 * אישור רב-ממדי: מפתח לכל ממד, ציון לכל אחד.
 *
 * המפתחות עצמם מאומתים בשירות מול הקטלוג — כאן רק הצורה. ציון
 * הדיוק **אינו** מתקבל מהלקוח: הוא נגזר מהפער מול ההצהרה, ושליחתו
 * הייתה נתון שאפשר לזייף עבור חישוב שממילא שלנו.
 */
/**
 * מקום התמונה בגלריה. תקרה מכוונת: הנתיב מגיע מהמסך שלנו, ואינדקס
 * שרירותי הוא ניסיון סריקה ולא בקשה.
 */
const PhotoIndexSchema = z.coerce.number().int().min(0).max(99);

/** גוף מהאחסון ⟵ תשובת Nest, עם אורך כשידוע. */
function streamed(obj: {
  body: NodeJS.ReadableStream;
  contentType?: string;
  contentLength?: number;
}): StreamableFile {
  return new StreamableFile(obj.body as never, {
    type: obj.contentType,
    ...(obj.contentLength !== undefined ? { length: obj.contentLength } : {}),
  });
}

const RateReferralSchema = z
  .object({
    scores: z
      .record(
        z.string().max(30),
        z.number().int().min(MIN_REFERRAL_RATING).max(MAX_REFERRAL_RATING),
      )
      /*
       * חסם עליון על מספר הממדים. הקטלוג ארוך מכולם בארבעה, והשירות
       * דוחה מפתח שאינו בו — אבל הבדיקה הזו עוברת על כל המפתחות
       * שהתקבלו, ואובייקט עם עשרות אלפי מפתחות היה עבודה שנעשית לפני
       * שהיא נדחית. הסינון כאן זול והוא לפני העבודה.
       */
      .refine((value) => {
        const keys = Object.keys(value).length;
        return keys > 0 && keys <= 10;
      }, "יש לדרג לפחות ממד אחד"),
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
    private readonly dealRooms: DealRoomService,
  ) {}

  /* ============================================================
     הכיוון השני של הרשת: נכס שמתפרסם, וקונה שמביע בו עניין.
     אותם שערי הרשאה כמו בכיוון הקיים — `collaboration.share`
     לפרסום מה ששלי, `collaboration.offer` לפנייה למה שאחרים
     פרסמו. הרשאה חדשה הייתה אומרת שמשרד שכבר מורשה לשתף צריך
     הגדרה נוספת כדי לשתף בכיוון השני, וזו הפתעה ולא הגנה.
     ============================================================ */

  /** פרסום מרוכז מרשימת הנכסים. לפני `listings` — נתיב מדויק קודם. */
  @Post("listings/bulk")
  @RequireCapability("collaboration.share")
  @HttpCode(200)
  async publishListingsBulk(
    @Body(new ZodValidationPipe(BulkPublishSchema))
    body: z.infer<typeof BulkPublishSchema>,
  ): Promise<{ results: { id: string; ok: boolean; error?: string }[] }> {
    return { results: await this.listings.publishBulk(body.propertyIds) };
  }

  @Post("listings")
  @RequireCapability("collaboration.share")
  async publishListing(
    @Body(new ZodValidationPipe(PublishListingSchema))
    body: z.infer<typeof PublishListingSchema>,
  ): Promise<SharedListingDto> {
    return this.listings.publish(body.propertyId, termsFrom(body), body.note);
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
    return this.listings.updatePublication(propertyId, termsFrom(body), body.note);
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

  /* ------------------------------------------------------------------
     תמונות הרשת — נתיבים ב-API ולא כתובות אחסון חתומות.

     כל שאר המדיה במערכת כבר זורמת כך; שלושת המקומות האלה היו
     היוצאים מן הכלל, ובפרודקשן הם נשברו: חתימת SigV4 כוללת את
     ה-Host, ו-MinIO יושבת על רשת פנימית בלי כתובת ציבורית
     (`storage.service.ts`). ראו `network-media.ts`.

     השער זהה לזה של הפיד — מי שרשאי לראות את המודעה רשאי לראות
     את תמונותיה — וההרשאה נבדקת שוב בכל בקשה, בשירות.

     `Cross-Origin-Resource-Policy: same-site` נדרש כי `helmet()`
     מגדיר `same-origin` לכל התשובות, והדפדפן חוסם `<img>` ממקור
     אחר עוד לפני שה-CSP נשקל. בפיתוח ה-web על 3000 וה-API על 3001,
     כלומר בדיוק המצב הזה (ביקורת Codex). `same-site` ולא
     `cross-origin`: הוא מתיר פורט או תת-דומיין של אותו אתר, ואינו
     מתיר לאתר זר להטמיע תמונה של לקוח.
     ------------------------------------------------------------------ */

  @Get("listings/:id/photo/:index")
  @RequireCapability("collaboration.offer")
  @Header("Cache-Control", "private, max-age=300")
  @Header("Cross-Origin-Resource-Policy", "same-site")
  async listingPhoto(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Param("index", new ZodValidationPipe(PhotoIndexSchema)) index: number,
  ): Promise<StreamableFile> {
    return streamed(await this.listings.photo(id, index));
  }

  @Get("offers/:id/photo/:index")
  @RequireCapability("collaboration.offer")
  @Header("Cache-Control", "private, max-age=300")
  @Header("Cross-Origin-Resource-Policy", "same-site")
  async offerPhoto(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Param("index", new ZodValidationPipe(PhotoIndexSchema)) index: number,
  ): Promise<StreamableFile> {
    return streamed(await this.collaboration.offerPhoto(id, index));
  }

  /*
   * הלוגו רחב יותר משני האחרים בכוונה: הוא מופיע גם בעסקה
   * המשותפת וברשימת העסקאות, ואלה פתוחות לשתי היכולות. משרד
   * שמשתף אך אינו מציע היה רואה שם שם משרד בלי לוגו — 403 על
   * התמונה בלבד (ביקורת Codex).
   */
  @Get("office/:tenantId/logo")
  @RequireCapability("collaboration.share", "collaboration.offer")
  @Header("Cache-Control", "private, max-age=300")
  @Header("Cross-Origin-Resource-Policy", "same-site")
  async officeLogo(
    @Param("tenantId", new ZodValidationPipe(IdSchema)) tenantId: string,
  ): Promise<StreamableFile> {
    return streamed(await this.listings.officeLogo(tenantId));
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

  /**
   * תגובה לפניית קונה. „מעוניין” מחזיר את מזהה חדר העסקה שנפתח,
   * והמסך מנווט אליו מיד — התשובה 204 הקודמת השאירה את הסוכן על
   * אותו מסך בלי שום סימן שמשהו קרה.
   */
  @Patch("interests/:id/respond")
  @RequireCapability("collaboration.share")
  @HttpCode(200)
  async respondToInterest(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(RespondSchema))
    body: z.infer<typeof RespondSchema>,
  ): Promise<{ dealId: string | null }> {
    return this.listings.respondToInterest(id, body.response, body.note);
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
    return this.collaboration.shareBuyer(body.buyerId, termsFrom(body), body.note);
  }

  /** שיתוף מרוכז מרשימת הקונים — ראו BulkShareSchema. */
  @Post("share/bulk")
  @RequireCapability("collaboration.share")
  @HttpCode(200)
  async shareBulk(
    @Body(new ZodValidationPipe(BulkShareSchema))
    body: z.infer<typeof BulkShareSchema>,
  ): Promise<{ results: { id: string; ok: boolean; error?: string }[] }> {
    return { results: await this.collaboration.shareBuyersBulk(body.buyerIds) };
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
    return this.collaboration.updateSharedDemand(buyerId, termsFrom(body), body.note);
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
  ): Promise<{ ok: true; dealId: string | null }> {
    const { dealId } = await this.collaboration.respondToCoopOffer(
      id,
      body.response,
      body.note,
    );
    return { ok: true, dealId };
  }

  /* ============================================================
     חדר העסקה — סביבת העבודה המשותפת של שני המשרדים.

     שתי היכולות ולא אחת: לחדר מגיעים משני הכיוונים — מי שפרסם נכס
     וקיבל פנייה (`share`) ומי שהציע על ביקוש (`offer`) — והן ניתנות
     בנפרד במסך ההרשאות. שער אחד היה נועל מחצית מהשותפים מחוץ לחדר
     שהם עצמם צד בו.
     ============================================================ */

  @Get("deals")
  @RequireCapability("collaboration.share", "collaboration.offer")
  async deals(): Promise<DealSummaryDto[]> {
    return this.dealRooms.list();
  }

  @Get("deals/:id")
  @RequireCapability("collaboration.share", "collaboration.offer")
  async deal(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<DealDto> {
    return this.dealRooms.get(id);
  }

  @Post("deals/:id/messages")
  @RequireCapability("collaboration.share", "collaboration.offer")
  @HttpCode(204)
  async postDealMessage(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(DealMessageSchema))
    body: z.infer<typeof DealMessageSchema>,
  ): Promise<void> {
    await this.dealRooms.post(id, body.body);
  }

  @Patch("deals/:id/stage")
  @RequireCapability("collaboration.share", "collaboration.offer")
  @HttpCode(204)
  async moveDeal(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(DealStageSchema))
    body: z.infer<typeof DealStageSchema>,
  ): Promise<void> {
    await this.dealRooms.move(id, body.stage as CoopDealStage, body.note);
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
    return this.collaboration.shareLead({ ...body, clientScores: body.scores });
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

  /**
   * אישור המשרד הקולט על הצהרת המפנה.
   *
   * **נתיב אחד ולא שניים.** קודם היו שניים, אחד לכל צד, כי כל צד
   * דירג את משנהו והיכולות שונות. במודל הזה יש הצהרה אחת שנכתבת
   * בפרסום ואישור אחד שנכתב בקליטה — ולכן צד אחד שיכול לכתוב אותו,
   * והוא זה שמחזיק ב-`collaboration.offer`.
   */
  @Post("leads/:id/confirmation")
  @RequireCapability("collaboration.offer")
  @HttpCode(200)
  async confirmReferral(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(RateReferralSchema))
    body: z.infer<typeof RateReferralSchema>,
  ): Promise<{ ok: true }> {
    await this.collaboration.confirmReferral(id, body.scores, body.comment);
    return { ok: true };
  }
}
