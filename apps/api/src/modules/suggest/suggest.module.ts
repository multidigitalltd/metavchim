import { Module } from "@nestjs/common";
import { SuggestController } from "./suggest.controller";

@Module({
  controllers: [SuggestController],
})
export class SuggestModule {}
