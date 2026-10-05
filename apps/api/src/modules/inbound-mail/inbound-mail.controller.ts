import { Controller, HttpCode, NotFoundException, Param, Post, Body } from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  EMAIL_IDEMPOTENCY_METADATA_KEY,
  InboundEmailPayloadSchema,
  funnelMessageIdFromIdempotencyKey,
} from "@metavchim/shared";
import { Public } from "../../common/auth.decorators";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { EmailInboxService } from "../email-inbox/email-inbox.service";
import { FunnelReportService } from "../funnel-send/funnel-report.service";
import { SupportInboxService } from "../support/support-inbox.service";
import { InboundMailService } from "./inbound-mail.service";

/**
 * שני הנתיבים הציבוריים שספק הדואר דוחף אליהם — **ואותה התנהגות**.
 *
 * ## למה שניים ולא אחד
 *
 * הם קיימים בשטח: אחד מהם כבר מוגדר אצל הספק. איחוד לכתובת אחת היה
 * דורש לשנות את ההגדרה שם ברגע הפריסה, וכל דואר שהגיע בין הפריסה
 * לשינוי היה נופל על 404 — כלומר נמסר שוב ושוב עד שהספק מוותר.
 * שני נתיבים שמתנהגים זהה עולים שורה אחת ומייתרים את התיאום.
 *
 * ## הסודות נשארים נפרדים
 *
 * לכל נתיב הסוד שלו, ולכן מי שהגדיר אחד מהם אינו צריך להחליף אותו.
 * סוד שגוי מקבל 404 ולא 403: תשובה שמבחינה בין „הנתיב לא קיים”
 * ל„הסוד שגוי” מסגירה שהנתיב קיים. ההשוואה בזמן קבוע.
 *
 * ## תמיד 200 על קלט חוקי
 *
 * הספק חוזר על הודעה שלא נענתה. שגיאה על גוף שאיננו מבינים פירושה
 * מסירה חוזרת לנצח של הודעה שלא תיקלט לעולם.
 */

const SecretSchema = z.string().min(16).max(200);

/**
 * ‏אירוע מסירה של Postmark — רק מה שנקרא. `Metadata` נושא את מפתח
 * ‏האידמפוטנטיות שנשלח עם המייל, ומשם נגזר למי האירוע שייך.
 */
const EmailEventSchema = z.object({
  RecordType: z.string(),
  Metadata: z.record(z.string(), z.string()).optional(),
  DeliveredAt: z.string().optional(),
  BouncedAt: z.string().optional(),
  Type: z.string().optional(),
  Description: z.string().optional(),
});

@Controller()
export class InboundMailController {
  constructor(
    private readonly router: InboundMailService,
    private readonly support: SupportInboxService,
    private readonly tenantInbox: EmailInboxService,
    private readonly funnelReport: FunnelReportService,
  ) {}

  /** הנתיב ההיסטורי של תיבת התמיכה. */
  @Public()
  @Post("public/support/inbound/:secret")
  @HttpCode(200)
  async support_(
    @Param("secret", new ZodValidationPipe(SecretSchema)) secret: string,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    await this.accept(secret, await this.support.webhookSecret(), body);
    return { ok: true };
  }

  /** הנתיב ההיסטורי של תיבות המשרדים. */
  @Public()
  @Post("public/email/inbound/:secret")
  @HttpCode(200)
  async tenant(
    @Param("secret", new ZodValidationPipe(SecretSchema)) secret: string,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    const config = await this.tenantInbox.inboundConfig();
    await this.accept(secret, config?.secret ?? null, body);
    return { ok: true };
  }

  /**
   * ‎**אירועי מסירה של המיילים היוצאים — Delivery ו-Bounce.**
   *
   * ‏אותו סוד של תיבות המשרדים: אותו ספק ואותו מפעיל, ושדה סוד נוסף
   * ‏היה עוד דבר להגדיר בלי להוסיף הגנה. כרגע רק הודעות מסלול ההמרה
   * ‏נקראות (המפתח `funnel:<id>`); כל אירוע אחר נענה ב-200 ונבלע, כדי
   * ‏שהספק לא ינסה שוב.
   */
  @Public()
  @Post("public/email/events/:secret")
  @HttpCode(200)
  async events(
    @Param("secret", new ZodValidationPipe(SecretSchema)) secret: string,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    this.verify(secret, await this.tenantInbox.webhookSecret());
    const parsed = EmailEventSchema.safeParse(body);
    if (!parsed.success) return { ok: true };
    const event = parsed.data;
    const messageId = funnelMessageIdFromIdempotencyKey(
      event.Metadata?.[EMAIL_IDEMPOTENCY_METADATA_KEY] ?? "",
    );
    if (messageId === null) return { ok: true };
    // ‏Postmark שולח ISO עם אזור זמן; ערך חסר או פגום — רגע הקליטה
    const at = (value: string | undefined): Date => {
      const parsedAt = new Date(value ?? "");
      return Number.isNaN(parsedAt.getTime()) ? new Date() : parsedAt;
    };
    if (event.RecordType === "Delivery") {
      await this.funnelReport.recordEmailEvent(messageId, {
        kind: "delivered",
        at: at(event.DeliveredAt),
      });
    } else if (event.RecordType === "Bounce") {
      await this.funnelReport.recordEmailEvent(messageId, {
        kind: "bounced",
        at: at(event.BouncedAt),
        detail: [event.Type, event.Description].filter(Boolean).join(" — "),
      });
    }
    return { ok: true };
  }

  /** אימות הסוד ואז ניתוב — משותף לשני הנתיבים. */
  private async accept(given: string, expected: string | null, body: unknown): Promise<void> {
    this.verify(given, expected);
    // גוף שאינו בצורה המוכרת נבלע — הספק ניסה, אין מה לנסות שוב
    const parsed = InboundEmailPayloadSchema.safeParse(body);
    if (parsed.success) await this.router.route(parsed.data);
  }

  /** ‏סוד שגוי או חסר — 404, כאילו הנתיב אינו קיים. */
  private verify(given: string, expected: string | null): void {
    const want = Buffer.from(expected ?? "");
    const got = Buffer.from(given);
    if (want.length === 0) throw new NotFoundException();
    if (want.length !== got.length || !timingSafeEqual(want, got)) {
      throw new NotFoundException();
    }
  }
}
