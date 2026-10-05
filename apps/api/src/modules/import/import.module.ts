import { Module } from "@nestjs/common";
import { BuyersModule } from "../buyers/buyers.module";
import { LeadsModule } from "../leads/leads.module";
import { PropertiesModule } from "../properties/properties.module";
import { RecruitmentModule } from "../recruitment/recruitment.module";
import { ImportController } from "./import.controller";
import { ImportWriteService } from "./import-write.service";

@Module({
  imports: [PropertiesModule, BuyersModule, LeadsModule, RecruitmentModule],
  controllers: [ImportController],
  providers: [ImportWriteService],
  /* ‏מסלול הוואטסאפ כותב דרך אותו שירות — קובץ שנשלח בצ'אט */
  exports: [ImportWriteService],
})
export class ImportModule {}
