import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { z } from "zod";
import { IdSchema, LeadIntentSchema, PhoneInputSchema } from "@metavchim/shared";
import { Public } from "../../common/auth.decorators";
import { WebhookLogService } from "../webhook-log/webhook-log.service";
import { WebLeadService } from "./web-lead.service";

/**
 * קליטת ליד מטופס באתר של המשרד — ציבורי, מזוהה במפתח ייעודי בלבד.
 * שדה honeypot (website): בוטים ממלאים אותו — הבקשה "מצליחה" בלי לקלוט.
 */
/**
 * גוף הפנייה הציבורית.
 *
 * ‎`.strict()`‎ בכוונה: שדה שלא הכרנו נדחה ולא נבלע. מי שמחבר דרך
 * Make או n8n מגלה את הטעות בבנייה, לא שבועיים אחר כך כשמישהו שם
 * לב שהאימייל לא נשמר.
 *
 * מה שנוסף כאן — אימייל, עניין ונכס — הוא מה שמפריד בין ליד מלא
 * לליד חלקי. מודעת פייסבוק של נכס מסוימת יודעת את שלושתם, וקודם
 * כולם נשמטו בדרך.
 */
const WebLeadSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    phone: PhoneInputSchema,
    message: z.string().trim().max(2000).optional(),
    pageUrl: z.string().trim().max(300).optional(),
    /** נשמר על הכרטיס ומאפשר זיהוי של פניות עתידיות מאותה כתובת. */
    email: z.string().trim().email().max(200).optional(),
    /** מה הלקוח רוצה. חסר ⇒ "לא ידוע", כמו קודם. */
    intent: LeadIntentSchema.optional(),
    /** הנכס שהמודעה פרסמה. מאומת מול המשרד לפני שנשמר. */
    propertyId: IdSchema.optional(),
    website: z.string().max(200).optional(), // honeypot — אמור להישאר ריק
  })
  .strict();

const KeySchema = z.string().regex(/^[A-Za-z0-9_-]{20,64}$/u);

/**
 * ‎**מה היה פגום בגוף הבקשה — במונחים שאפשר לפעול לפיהם.**
 *
 * ‏הודעת Zod המלאה אינה נכנסת ליומן: היא ארוכה, והיא מכילה את
 * ‏הערך שנדחה — כלומר עלולה לשאת שם או טלפון של לקוח אל טבלה
 * ‏שנקראת בעיניים. שם התקלה בלבד, כמו בצד המרכזייה.
 */
function bodyIssue(error: z.ZodError, payload: Record<string, unknown>): string {
  if (Object.keys(payload).length === 0) return "no_fields";
  const paths = error.issues.map((issue) => issue.path.join("."));
  /* ‏טלפון שנדחה הוא התקלה השכיחה, ויש לה כבר שם משותף עם המרכזייה */
  if (paths.some((path) => path === "phone")) return "invalid_phone";
  if (paths.some((path) => path === "name")) return "no_name";
  return "bad_body";
}

/**
 * ‎**למה הבדיקה עברה אל תוך המתודה.**
 *
 * ‏שני ה-Pipes דחו את הבקשה **לפני** שהמתודה רצה, ולכן הכישלון
 * ‏הנפוץ ביותר של מי שמחבר טופס דרך Make או n8n — שדה בשם אחר,
 * ‏מפתח שהודבק עם רווח, טלפון בפורמט שאיננו מקבלים — לא הותיר שום
 * ‏עקבה בשום מקום. הלקוח אמר „שלחתי ולא קרה כלום”, וזו הייתה גם
 * ‏התשובה שלנו.
 *
 * ‏אותה בדיקה בדיוק רצה כאן, ומחזירה את אותה שגיאה — מה שהשתנה
 * ‏הוא שהיא **נרשמת קודם**.
 */
@Controller("public/leads")
export class WebLeadController {
  constructor(
    private readonly webLeads: WebLeadService,
    private readonly webhookLog: WebhookLogService,
  ) {}

  /*
   * מגבלה הדוקה משלה: הנתיב ציבורי ו*כותב* שורות (איש קשר + ליד).
   * המגבלה הגלובלית (300/דקה) נועדה לקריאות, ומאפשרת הצפת המאגר
   * בלידים מזויפים מכתובת אחת. טופס אמיתי נשלח פעם-פעמיים.
   */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post(":key")
  @HttpCode(200)
  async ingest(@Param("key") key: string, @Body() raw: unknown): Promise<{ ok: true }> {
    const payload = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const log = (
      outcome: "unparsed" | "unknown_key" | "failed",
      /** ‏המשרד — `null` כל עוד המפתח לא נפתר, וזו עובדה ולא חוסר. */
      tenantId: string | null,
      issue?: string,
    ) =>
      this.webhookLog.record({
        source: "lead",
        outcome,
        ...(issue === undefined ? {} : { issue }),
        tenantId,
        key,
        method: "POST",
        payload,
      });

    /*
     * ‎**המפתח נפתר לפני שהגוף נשפט** (ביקורת Codex, P2).
     *
     * ‏הסדר ההפוך יצר שתי שורות שגויות. הראשונה חמורה: גוף שנפסל
     * ‏אצל **מפתח מוכר** — כלומר בדיוק תקלת ה-Make/n8n שהתכונה
     * ‏הזו נבנתה בשבילה — נרשם בלי משרד, ולכן נעלם מהסינון הראשון
     * ‏שנשאל עליו. השנייה: גוף פסול אצל מפתח שאינו קיים נרשם
     * ‏כ„נדחתה בבדיקה”, בזמן שהבעיה האמיתית היא הכתובת.
     *
     * ‏שאילתה אחת נוספת על נתיב ציבורי — אינדקס ייחודי, ומוגבל
     * ‏ממילא בעשר בקשות לדקה.
     */
    const webhook = KeySchema.safeParse(key).success
      ? await this.webLeads.resolveKey(key)
      : null;
    if (webhook === null) {
      /* ‏מפתח משובש ומפתח שאינו קיים — אותה מסקנה: הכתובת אינה מזוהה */
      await log("unknown_key", null);
      throw new NotFoundException("לא נמצא");
    }

    const parsed = WebLeadSchema.safeParse(raw);
    if (!parsed.success) {
      await log("unparsed", webhook.tenantId, bodyIssue(parsed.error, payload));
      throw new BadRequestException(parsed.error.issues[0]?.message ?? "בקשה לא תקינה");
    }
    const body = parsed.data;

    /*
     * ‎**גם מלכודת הבוטים נרשמת.** בוט אינו השאלה שהיומן עונה
     * ‏עליה — אבל טופס אמיתי שבמקרה יש בו שדה בשם `website` נבלע
     * ‏כאן בשקט מוחלט, לנצח, וזה בדיוק המקרה שאין לו שום דרך
     * ‏אחרת להתגלות. השורה זולה, והתקרה של היומן כבר מגינה מפני
     * ‏הצפה.
     */
    if (body.website?.trim()) {
      await log("unparsed", webhook.tenantId, "honeypot");
      return { ok: true };
    }

    try {
      await this.webLeads.ingestForTenant(
        webhook.tenantId,
        {
          name: body.name,
          phone: body.phone,
          message: body.message,
          pageUrl: body.pageUrl,
          email: body.email,
          intent: body.intent,
          propertyId: body.propertyId,
        },
        webhook.sourceLabel,
      );
      /* ‏המספר נחתם ואינו נשמר — ראו `peerPhone` ביומן */
      await this.webhookLog.record({
        source: "lead",
        outcome: "accepted",
        tenantId: webhook.tenantId,
        key,
        method: "POST",
        payload,
        peerPhone: body.phone,
      });
    } catch (error) {
      /* ‏המפתח כבר נפתר, ולכן כישלון כאן הוא שלנו ולא של הכתובת */
      await log("failed", webhook.tenantId);
      throw error;
    }
    return { ok: true };
  }
}