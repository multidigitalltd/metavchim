import { Module } from "@nestjs/common";
import { MentorController } from "./mentor.controller";
import { MentorService } from "./mentor.service";

@Module({
  controllers: [MentorController],
  providers: [MentorService],
  /* ‏הסורק היומי (שלב ב׳) יישען על אותם חישובים בדיוק */
  exports: [MentorService],
})
export class MentorModule {}
