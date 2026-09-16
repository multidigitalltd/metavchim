import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import {
  IdSchema,
  PropertyBidCreateSchema,
  PropertyBidDecisionSchema,
  type PropertyBidCreate,
  type PropertyBidDecision,
} from "@metavchim/shared";
import { RequireCapability } from "../../common/auth.decorators";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { PropertyBidsService, type PropertyBidsDto } from "./property-bids.service";

/**
 * ‏הצעות מחיר על נכס — קריאה עם `properties.view`, רישום והכרעה עם
 * ‎`properties.edit`. שמות הקונים מסוננים בשירות לפי יכולת הקונים.
 */
const IdParam = new ZodValidationPipe(IdSchema);

@Controller("properties/:id/bids")
export class PropertyBidsController {
  constructor(private readonly bids: PropertyBidsService) {}

  @Get()
  @RequireCapability("properties.view")
  list(@Param("id", IdParam) propertyId: string): Promise<PropertyBidsDto> {
    return this.bids.list(propertyId);
  }

  @Post()
  @RequireCapability("properties.edit")
  create(
    @Param("id", IdParam) propertyId: string,
    @Body(new ZodValidationPipe(PropertyBidCreateSchema)) body: PropertyBidCreate,
  ): Promise<PropertyBidsDto> {
    return this.bids.create(propertyId, body);
  }

  @Patch(":bidId")
  @RequireCapability("properties.edit")
  decide(
    @Param("id", IdParam) propertyId: string,
    @Param("bidId", IdParam) bidId: string,
    @Body(new ZodValidationPipe(PropertyBidDecisionSchema)) body: PropertyBidDecision,
  ): Promise<PropertyBidsDto> {
    return this.bids.decide(propertyId, bidId, body.status);
  }
}
