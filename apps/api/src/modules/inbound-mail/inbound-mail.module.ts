import { Module } from "@nestjs/common";
import { EmailInboxModule } from "../email-inbox/email-inbox.module";
import { SupportModule } from "../support/support.module";
import { InboundMailController } from "./inbound-mail.controller";
import { InboundMailService } from "./inbound-mail.service";

/**
 * הניתוב של הדואר הנכנס — מודול שלישי, ובכוונה.
 *
 * ההכרעה זקוקה לשני היעדים: תיבת התמיכה ותיבות המשרדים. אילו אחד
 * מהם היה מחזיק אותה, הוא היה צריך לייבא את השני — ומכיוון שהניתוב
 * הוא דו-כיווני, זה מעגל. מודול שמייבא את שניהם ואיש אינו מייבא
 * אותו פותר את זה בלי `forwardRef`, שהוא פתרון שמסתיר את המעגל
 * במקום להסיר אותו.
 */
@Module({
  imports: [SupportModule, EmailInboxModule],
  controllers: [InboundMailController],
  providers: [InboundMailService],
})
export class InboundMailModule {}
