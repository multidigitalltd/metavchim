import { Module } from "@nestjs/common";
import { HealthModule } from "./modules/health/health.module";

/**
 * מודול-העל. מודולי הדומיין (Identity, Leads, Properties, Buyers, Matching,
 * Offers, Calendar, Collaboration) ומודולי הפלטפורמה (Messaging, AI, Voice,
 * Billing, Audit, Notifications) יירשמו כאן — כל אחד כמודול Nest עצמאי,
 * בהתאם לגבולות שהוגדרו ב-docs/02-architecture.md.
 */
@Module({
  imports: [HealthModule],
})
export class AppModule {}
