import { Body, Controller, Get, HttpCode, Post, UseGuards } from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { z } from "zod";
import {
  MAX_PAYOUT_NOTE,
  MAX_PAYOUT_REFERENCE,
  MAX_PAYOUT_REQUEST_AGOROT,
  PAYOUT_STATUSES,
  type PayoutStatus,
} from "@metavchim/shared";
import { BillingAllowed, PlatformAdmin, RequireCapability } from "../../common/auth.decorators";
import { PlatformAdminGuard } from "../../common/platform-admin.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import {
  PayoutsService,
  type PayoutBalanceDto,
  type PayoutRequestAdminDto,
  type PayoutRequestDto,
} from "./payouts.service";

const BankSchema = z.object({
  holderName: z.string().min(2).max(120),
  bankCode: z.string().min(1).max(3),
  branch: z.string().min(1).max(4),
  accountNumber: z.string().min(4).max(12),
  businessId: z.string().min(9).max(15),
});

const RequestSchema = z.object({
  amountAgorot: z.number().int().positive().max(MAX_PAYOUT_REQUEST_AGOROT),
  bank: BankSchema,
  note: z.string().max(MAX_PAYOUT_NOTE).optional(),
});

const DecisionSchema = z.object({
  id: z.string().length(26),
  status: z.enum(PAYOUT_STATUSES),
  note: z.string().max(MAX_PAYOUT_NOTE).optional(),
  reference: z.string().max(MAX_PAYOUT_REFERENCE).optional(),
});

/**
 * משיכת יתרה — צד המשרד.
 *
 * `billing.manage` ולא `collaboration.offer`: זה כסף שיוצא מהחשבון
 * של המשרד החוצה, ולא פעולה ברשת השת"פ. הסוכן שמפרסם הפניות אינו
 * בהכרח מי שמורשה לקבוע לאן מועבר הכסף.
 */
@Controller("payouts")
export class PayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  @Get("balance")
  @RequireCapability("billing.manage")
  @BillingAllowed()
  async balance(): Promise<PayoutBalanceDto> {
    return this.payouts.balance();
  }

  @Get("requests")
  @RequireCapability("billing.manage")
  @BillingAllowed()
  async listMine(): Promise<PayoutRequestDto[]> {
    return this.payouts.listMine();
  }

  /*
   * הגבלת קצב: בקשת משיכה היא פעולה כספית, ואין תרחיש לגיטימי של
   * יותר מכמה בשעה. הגבלה כאן חוסמת גם ניסיון לגשש אחר היתרה דרך
   * הודעות השגיאה.
   */
  @Post("requests")
  @HttpCode(201)
  @RequireCapability("billing.manage")
  @BillingAllowed()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async request(
    @Body(new ZodValidationPipe(RequestSchema)) body: z.infer<typeof RequestSchema>,
  ): Promise<PayoutRequestDto> {
    return this.payouts.request(body);
  }
}

/**
 * תור המשיכות — **בעל הפלטפורמה בלבד.**
 *
 * שער ברמת המחלקה ולא בכל נתיב: כאן יושבים פרטי חשבון בנק של משרדים,
 * וזו הטעות היקרה ביותר שאפשר לעשות בשכחה של דקורטור.
 */
@Controller("platform/payouts")
@UseGuards(PlatformAdminGuard)
@PlatformAdmin()
export class PayoutDeskController {
  constructor(private readonly payouts: PayoutsService) {}

  @Get()
  async list(): Promise<PayoutRequestAdminDto[]> {
    return this.payouts.listForDesk();
  }

  @Post("decide")
  @HttpCode(200)
  async decide(
    @Body(new ZodValidationPipe(DecisionSchema)) body: z.infer<typeof DecisionSchema>,
  ): Promise<PayoutRequestAdminDto> {
    return this.payouts.decide(body.id, body.status as PayoutStatus, {
      ...(body.note === undefined ? {} : { note: body.note }),
      ...(body.reference === undefined ? {} : { reference: body.reference }),
    });
  }
}
