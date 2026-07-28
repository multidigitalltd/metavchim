import { Body, Controller, Post } from "@nestjs/common";
import { z } from "zod";
import { RequireCapability } from "../../common/auth.decorators";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { VoiceIntakeService, type IntakeResult } from "./voice-intake.service";

const IntakeSchema = z
  .object({
    transcript: z.string().min(5).max(4000),
  })
  .strict();

@Controller("voice-intakes")
export class VoiceIntakeController {
  constructor(private readonly service: VoiceIntakeService) {}

  @Post()
  @RequireCapability("properties.create")
  async intake(
    @Body(new ZodValidationPipe(IntakeSchema)) body: z.infer<typeof IntakeSchema>,
  ): Promise<IntakeResult> {
    return this.service.intake(body.transcript);
  }
}
