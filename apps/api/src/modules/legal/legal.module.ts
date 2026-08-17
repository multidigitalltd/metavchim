import { Module } from "@nestjs/common";
import { LegalController } from "./legal.controller";

/** `PlatformSettingsService` מגיע מ-CoreModule הגלובלי. */
@Module({ controllers: [LegalController] })
export class LegalModule {}
