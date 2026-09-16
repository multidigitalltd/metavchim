import { Controller, Get, Param, Post } from "@nestjs/common";
import { IdSchema } from "@metavchim/shared";
import { RequireCapability } from "../../common/auth.decorators";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { PropertyReofferService, type ReofferDto } from "./property-reoffer.service";

/**
 * ‏„ירד המחיר — להציע שוב”: הרשימה נקראת עם יכולת קונים (היא מציגה
 * ‏שמות וטלפונים; הסינון לפי בעלות בשירות), והסימון „פניתי” עם
 * ‎`offers.send` — אותה יכולת של שליחת הצעה לקונה.
 *
 * ‏שתי הדלתות דורשות **גם** `properties.view` וגם יכולת קונים — זה
 * ‏נבדק בשירות, כי הדקורטור מאחד ב„או”.
 */
const IdParam = new ZodValidationPipe(IdSchema);

@Controller("properties/:id/reoffer")
export class PropertyReofferController {
  constructor(private readonly reoffer: PropertyReofferService) {}

  @Get()
  @RequireCapability("buyers.view_own", "buyers.view_all")
  candidates(@Param("id", IdParam) propertyId: string): Promise<ReofferDto> {
    return this.reoffer.candidates(propertyId);
  }

  @Post(":buyerId")
  @RequireCapability("offers.send")
  contacted(
    @Param("id", IdParam) propertyId: string,
    @Param("buyerId", IdParam) buyerId: string,
  ): Promise<{ contactedAt: string }> {
    return this.reoffer.markContacted(propertyId, buyerId);
  }
}
