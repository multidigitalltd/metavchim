import { Controller, Get, Param, Post } from "@nestjs/common";
import { z } from "zod";
import { AnyAuthenticated } from "../../common/auth.decorators";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import {
  FeatureSignupsService,
  SIGNUP_FEATURES,
  type SignupFeature,
} from "./feature-signups.service";

/**
 * `AnyAuthenticated` ולא יכולת: אין כאן נתוני משרד.
 *
 * כל קריאה נכתבת ונקראת לפי `tenantId` ו-`userId` מההקשר, כלומר
 * המשתמש נוגע ברישום **שלו** בלבד. יכולת הייתה חוסמת דווקא את
 * הסוכן הרגיל — הקהל שהמסך נכתב בשבילו.
 */
const FeatureSchema = z.enum(SIGNUP_FEATURES);

@Controller("feature-signups")
export class FeatureSignupsController {
  constructor(private readonly signups: FeatureSignupsService) {}

  @Get(":feature")
  @AnyAuthenticated()
  async status(
    @Param("feature", new ZodValidationPipe(FeatureSchema)) feature: SignupFeature,
  ): Promise<{ signed: boolean }> {
    return this.signups.status(feature);
  }

  @Post(":feature")
  @AnyAuthenticated()
  async signUp(
    @Param("feature", new ZodValidationPipe(FeatureSchema)) feature: SignupFeature,
  ): Promise<{ signed: true }> {
    return this.signups.signUp(feature);
  }
}
