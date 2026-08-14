import { Module } from "@nestjs/common";
import { SupportController, SupportDeskController } from "./support.controller";
import { SupportService } from "./support.service";

@Module({
  controllers: [SupportController, SupportDeskController],
  providers: [SupportService],
})
export class SupportModule {}
