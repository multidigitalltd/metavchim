import { Injectable, Logger } from "@nestjs/common";
import { ulid } from "ulid";
import { z } from "zod";
import { rolesWithCapability } from "@metavchim/shared";
import { CryptoService } from "../../core/crypto.service";
import { PrismaService } from "../../core/prisma.service";
import { ViewingReplyService } from "../calendar/viewing-reply.service";
import { WhatsAppAssistantService } from "./whatsapp-assistant.service";
import { WhatsAppBotService } from "./whatsapp-bot.service";
import { WhatsAppConnectionService } from "./whatsapp-connection.service";
import { WhatsAppSendService } from "./whatsapp-send.service";

/**
 * קליטת הודעות וואטסאפ נכנסות (docs/05 §1) — פורמט Meta Cloud API.
 *
 * ניתוב לדייר: לפי מספר הוואטסאפ העסקי שקיבל את ההודעה
 * (metadata.display_phone_number), שמוגדר בהגדרות הדייר. הודעה למספר
 * לא-מוכר נזרקת בשקט (נרשמת ללוג בלבד).
 *
 * Idempotency: מזהה ההודעה של Meta נבדק מול interactions שכבר נקלטו.
 */

/**
 * כמה זמן הבוט שותק אחרי שהמתווך ענה ידנית.
 *
 * שש שעות ולא „עד ההודעה הבאה של הלקוח”: מתווך שענה בעצמו ממשיך
 * בדרך כלל לנהל את השיחה, והבוט שקופץ אחרי תשובה אחת שלו נראה
 * כמו שני נציגים שמדברים זה על זה. ההודעה הנכנסת הבאה **אינה**
 * מבטלת את ההשתקה — רק חלוף הזמן.
 */
const BOT_PAUSE_MS = 6 * 60 * 60 * 1000;

const WebhookSchema = z.object({
  entry: z.array(
    z.object({
      changes: z.array(
        z.object({
          /**
           * ‎**שם השדה — מה שמבדיל בין ארבעת סוגי המטען.**
           *
           * עד היום הגיע `messages` בלבד, ולכן השדה לא נקרא. חיבור
           * של משרד מוסיף שלושה: `account_update` (ניתוק ושינוי
           * דירוג), `smb_message_echoes` (המתווך ענה מהטלפון)
           * ו-`history` (סנכרון ראשוני). מטען שאינו מוכר מדולג
           * בשקט ולא נבלע כאילו היה הודעה.
           */
          field: z.string().optional(),
          value: z.object({
            metadata: z
              .object({
                display_phone_number: z.string().optional(),
                /** מזהה הקו אצל Meta — כך מזוהה קו הסוכן האישי */
                phone_number_id: z.string().optional(),
              })
              .optional(),
            contacts: z
              .array(z.object({ profile: z.object({ name: z.string() }).optional(), wa_id: z.string() }))
              .optional(),
            messages: z
              .array(
                z.object({
                  id: z.string(),
                  from: z.string(),
                  type: z.string(),
                  text: z.object({ body: z.string() }).optional(),
                  /** הודעה קולית לסוכן — יורדת ומתומללת */
                  audio: z.object({ id: z.string() }).optional(),
                  /**
                   * לחיצה על כפתור או בחירה מרשימה. המזהה הוא מה
                   * ששלחנו בכפתור, ולכן הוא נושא את הפעולה; הכותרת
                   * נשמרת כדי שיהיה מה להציג ביומן השיחה.
                   */
                  interactive: z
                    .object({
                      type: z.string().optional(),
                      button_reply: z
                        .object({ id: z.string(), title: z.string().optional() })
                        .optional(),
                      list_reply: z
                        .object({ id: z.string(), title: z.string().optional() })
                        .optional(),
                    })
                    .optional(),
                  /**
                   * ‎**לחיצה על כפתור של תבנית — וזה שדה אחר לגמרי.**
                   *
                   * ‏כפתור בהודעה אינטראקטיבית חוזר כ-`interactive`
                   * עם מזהה; כפתור של **תבנית** חוזר כ-`type: "button"`
                   * עם `payload` — המטען ששלחנו לאותה הודעה. השדה לא
                   * היה בסכימה, ולכן לחיצה על תזכורת נזרקה בשקט.
                   */
                  button: z
                    .object({ payload: z.string(), text: z.string().optional() })
                    .optional(),
                }),
              )
              .optional(),
            /**
             * ‎**הד של הודעה שהמתווך שלח מהאפליקציה בטלפון.**
             *
             * זה מה שהופך את דו-הקיום לאמיתי: התשובה הידנית שלו
             * נרשמת בציר הזמן, ומשתיקה את הבוט באותה שיחה — אדם
             * לקח פיקוד. `to` הוא הלקוח שאליו נשלחה.
             */
            message_echoes: z
              .array(
                z.object({
                  id: z.string(),
                  to: z.string().optional(),
                  from: z.string().optional(),
                  type: z.string(),
                  text: z.object({ body: z.string() }).optional(),
                  timestamp: z.string().optional(),
                }),
              )
              .optional(),
            /**
             * ‎**סנכרון ההיסטוריה מהטלפון** — עד חצי שנה אחורה, אם
             * המתווך אישר. מגיע בנתחים (`chunk_order`) ובשלושה
             * שלבים (`phase`), עם `progress` באחוזים.
             *
             * ‏סירוב לשתף מגיע באותו שדה כ-`errors` ולא כהיעדר
             * מטען — ולכן „לא הגיעה היסטוריה” ו„המתווך בחר לא
             * לשתף” נראים כאן שונה, וזה בדיוק ההבדל בין תקלה
             * להחלטה.
             */
            history: z
              .array(
                z.object({
                  metadata: z
                    .object({
                      phase: z.number().optional(),
                      chunk_order: z.number().optional(),
                      progress: z.number().optional(),
                    })
                    .optional(),
                  errors: z
                    .array(z.object({ code: z.number(), title: z.string().optional() }))
                    .optional(),
                  threads: z
                    .array(
                      z.object({
                        id: z.string(),
                        messages: z
                          .array(
                            z.object({
                              id: z.string(),
                              from: z.string().optional(),
                              /** קיים רק בהד של המתווך — ולכן הוא שמכריע כיוון */
                              to: z.string().optional(),
                              type: z.string(),
                              timestamp: z.string().optional(),
                              text: z.object({ body: z.string() }).optional(),
                            }),
                          )
                          .optional(),
                      }),
                    )
                    .optional(),
                }),
              )
              .optional(),
            /**
             * אנשי הקשר שבטלפון של המתווך. `add` מכסה גם הוספה וגם
             * עריכה; `remove` הוא מחיקה מפנקס הכתובות שלו — **ולא**
             * מהמערכת (ראו `handleStateSync`).
             */
            state_sync: z
              .array(
                z.object({
                  type: z.string().optional(),
                  action: z.string().optional(),
                  contact: z
                    .object({
                      full_name: z.string().optional(),
                      first_name: z.string().optional(),
                      phone_number: z.string().optional(),
                    })
                    .optional(),
                }),
              )
              .optional(),
            /**
             * עדכון חשבון מ-Meta: ניתוק מהטלפון, שינוי דירוג איכות,
             * חסימה. `event` נושא את הסוג ו-`ban_info`/`current_limit`
             * את הפרטים — נקראים רק כשהם שם.
             */
            event: z.string().optional(),
            current_limit: z.string().optional(),
          }),
        }),
      ),
    }),
  ),
});

/**
 * מי חתם על הבקשה — אפליקציית קו הסוכן, אפליקציית החיבור, או
 * אפליקציה אחת שממלאת את שני התפקידים.
 */
export type InboundSource = "agent" | "connect" | "any";

@Injectable()
export class WhatsAppInboundService {
  private readonly logger = new Logger(WhatsAppInboundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly assistant: WhatsAppAssistantService,
    private readonly bot: WhatsAppBotService,
    private readonly sender: WhatsAppSendService,
    private readonly viewingReplies: ViewingReplyService,
    private readonly connections: WhatsAppConnectionService,
  ) {}

  /**
   * ‎`source` = **בשם מי** נחתמה הבקשה, לא לאיזו כתובת היא נשלחה.
   *
   * ברירת המחדל `any` היא בשביל קריאה ישירה בבדיקות; מהוובהוק היא
   * תמיד מגיעה מפורשת, ונגזרת מה-App Secret שהתאים.
   */
  async handle(payload: Record<string, unknown>, source: InboundSource = "any"): Promise<void> {
    const parsed = WebhookSchema.safeParse(payload);
    if (!parsed.success) {
      this.logger.warn("Webhook payload לא בפורמט צפוי — נזרק");
      return;
    }

    /*
     * שני קווים על אותו Webhook: קו הסוכן האישי של הפלטפורמה (מזוהה
     * לפי phone_number_id שבהגדרות) וקווי המשרדים לקליטת לידים.
     * הבדיקה לפי המזהה של Meta ולא לפי המספר המוצג — הוא יציב ואינו
     * תלוי בפורמט.
     */
    const assistantCreds = await this.sender.credentials();

    for (const entry of parsed.data.entry) {
      for (const change of entry.changes) {
        const value = change.value;
        /*
         * הניתוב עצמו נרשם. הודעה שמגיעה לקו שאינו הקו המוגדר נבלעת
         * כאן בשקט מוחלט — היא אינה של הסוכן ואינה של שום משרד — וזה
         * נראה למתווך בדיוק כמו מערכת שלא עובדת. השורה הזו אומרת
         * לאיזה קו ההודעה הגיעה ולאיזה קו אנחנו מאזינים.
         */
        const incomingLine = value.metadata?.phone_number_id ?? "חסר";

        /*
         * ‎**עדכוני חשבון והדים — לפני ניתוב ההודעות.**
         *
         * שניהם מגיעים על אותו Webhook ואינם הודעות של לקוח; לולאת
         * ההודעות שמתחת הייתה מדלגת עליהם בשקט, וניתוק שהמתווך עשה
         * מהטלפון היה נשאר „מחובר” אצלנו לנצח.
         */
        if (change.field === "account_update") {
          const lineId = value.metadata?.phone_number_id;
          if (lineId) {
            await this.connections.applyAccountUpdate(lineId, {
              ...(value.event ? { event: value.event } : {}),
              ...(value.current_limit ? { qualityRating: value.current_limit } : {}),
            });
          }
          continue;
        }

        if (value.message_echoes?.length) {
          await this.handleEchoes(incomingLine, value.message_echoes);
          continue;
        }

        /*
         * ‎**היסטוריה — בלי await, ומאותו נימוק כמו הסוכן.**
         *
         * נתח יכול לשאת מאות הודעות, ו-Meta ששוב אינה מקבלת 200
         * תוך שניות שולחת אותו שוב — כלומר ייבוא כפול. העיבוד
         * ממשיך ברקע ו-`handle` לעולם אינו זורק.
         */
        if (change.field === "history" && value.history?.length) {
          const chunks = value.history;
          void this.handleHistory(incomingLine, chunks);
          continue;
        }

        if (change.field === "smb_app_state_sync" && value.state_sync?.length) {
          await this.handleStateSync(incomingLine, value.state_sync);
          continue;
        }

        /*
         * ‎**תשובה לתזכורת סיור — לפני ניתוב הקווים, ולא אחריו.**
         *
         * ‏התזכורת יוצאת דרך `WhatsAppSendService`, שמחזיק זוג
         * אישורים **אחד** — הקו של הפלטפורמה. כלומר הלחיצה חוזרת
         * לאותו קו בדיוק שבו יושב הסוכן האישי, וענף הסוכן שמתחת
         * בולע כל הודעה שמגיעה לשם ומסיים ב-`continue`. הטיפול
         * שהיה בענף המשרדים לא נקרא לעולם, והלחיצה הייתה מגיעה
         * לסוכן כאילו מתווך כתב לו (ביקורת Codex, P1).
         *
         * ‎**הדייר מגיע מהמטען** ולא מהקו: אין ב-Webhook שום דבר
         * אחר שקושר את הלחיצה למשרד. זו אינה סמכות — `record`
         * מאמת שהסיור שייך לדייר ושהשולח הוא נמען שלו.
         */
        /*
         * ‎**המקור לבדו — בלי להשוות את הקו שבמטען.**
         *
         * ‏השומר הקודם בדק `incomingLine === assistantCreds.phoneNumberId`,
         * וזה היה שגוי מיסודו: `metadata.phone_number_id` מגיע
         * **מהגוף**, ומי שמחזיק בסוד שולט בו. השמטת השדה או נקיבת
         * קו של משרד עקפה את ההשוואה והגיעה הישר לטיפול הלחיצות,
         * שאינו תלוי-קו כלל (ביקורת Codex).
         *
         * תזכורות הסיור יוצאות מקו הפלטפורמה, ולכן תשובה עליהן היא
         * פיצ'ר של אפליקציית הסוכן — נקודה. אפליקציית החיבור לעולם
         * אינה מקור לגיטימי לזה, בלי קשר למה שכתוב במטען.
         */
        const replies =
          source === "connect"
            ? []
            : (value.messages ?? []).filter((m) => m.type === "button" && m.button !== undefined);
        if (replies.length > 0) {
          for (const message of replies) {
            if (!message.button) continue;
            await this.viewingReplies.record(
              message.button.payload,
              normalizeWaPhone(message.from),
            );
          }
          /*
           * ‎**רק אם *כל* ההודעות היו לחיצות.** אצווה מעורבת קיימת,
           * ולא נכון לזרוק בגללה הודעת טקסט שממתינה לצידה.
           */
          if (replies.length === (value.messages ?? []).length) continue;
        }
        if (assistantCreds === null) {
          this.logger.warn(
            `הודעה הגיעה לקו ${incomingLine} אך הסוכן אינו מוגדר (חסר טוקן או מזהה מספר במסך הפלטפורמה)`,
          );
        } else if (incomingLine !== assistantCreds.phoneNumberId) {
          this.logger.log(
            `הודעה לקו ${incomingLine} — אינו קו הסוכן (${assistantCreds.phoneNumberId}); ממשיכים לניתוב לפי משרד`,
          );
        }
        /*
         * ‏כאן ההשוואה כן לגיטימית: `assistantCreds.phoneNumberId`
         * הוא ערך שהמערכת הגדירה, והמטען רק צריך להתאים לו. אבל
         * ‎`source` נבדק **לפניו** — מטען חתום בסוד של אפליקציית
         * החיבור לא יפעיל את הסוכן גם אם הוא נוקב בקו הנכון.
         */
        if (
          source !== "connect" &&
          assistantCreds !== null &&
          value.metadata?.phone_number_id === assistantCreds.phoneNumberId
        ) {
          this.logger.log(
            `הודעה לקו הסוכן — ${(value.messages ?? []).length} הודעות לעיבוד`,
          );
          /*
           * בלי await בכוונה: סבב מלא של הסוכן (הבנה + ביצוע) אורך
           * עשרות שניות, ו-Meta שמחכה ל-200 מעבר לכמה שניות שולח את
           * ההודעה שוב — כלומר ביצוע כפול. העיבוד ממשיך ברקע, בסדר
           * ההודעות, ו-handle לעולם אינו זורק.
           */
          const messages = value.messages ?? [];
          void (async () => {
            for (const message of messages) {
              await this.assistant.handle({
                externalId: message.id,
                fromWaId: message.from,
                type: message.type,
                ...(message.text ? { text: message.text.body } : {}),
                ...(message.audio ? { mediaId: message.audio.id } : {}),
                ...(() => {
                  const reply =
                    message.interactive?.button_reply ?? message.interactive?.list_reply;
                  return reply
                    ? { buttonId: reply.id, ...(reply.title ? { buttonTitle: reply.title } : {}) }
                    : {};
                })(),
              });
            }
          })();
          continue;
        }
        if (!value.messages?.length) continue;

        /*
         * ‎**הניתוב לפי `phone_number_id` קודם למספר המוצג.**
         *
         * המזהה הוא מפתח יציב של Meta ויושב על אינדקס ייחודי; המספר
         * המוצג חוזר בפורמטים שונים ומושווה כספרות אחרי ניקוי. משרד
         * שחיבר את הקו שלו דרך Embedded Signup מזוהה מיד, ומשרד
         * שהוגדר ידנית לפני כן ממשיך לעבוד דרך ה-Fallback — שני
         * המנגנונים חיים זה לצד זה, בלי מיגרציה של נתונים.
         */
        const businessNumber = value.metadata?.display_phone_number;
        const connection = value.metadata?.phone_number_id
          ? await this.connections.byPhoneNumberId(value.metadata.phone_number_id)
          : null;
        const tenantId =
          connection?.tenantId ?? (businessNumber ? await this.resolveTenant(businessNumber) : null);
        if (!tenantId) {
          this.logger.warn(
            `הודעה לקו ${incomingLine} (${businessNumber ?? "ללא מספר מוצג"}) — אינו מחובר לאף משרד; נזרקת`,
          );
          continue;
        }

        for (const message of value.messages) {
          /*
           * לחיצות כפתור כבר טופלו למעלה, לפני ניתוב הקווים — הן
           * חוזרות לקו של הפלטפורמה ולא לקו של המשרד.
           */
          if (message.type !== "text" || !message.text) continue;
          const senderName =
            value.contacts?.find((c) => c.wa_id === message.from)?.profile?.name ?? "לקוח וואטסאפ";
          const ingested = await this.ingestMessage(tenantId, {
            externalId: message.id,
            fromPhone: normalizeWaPhone(message.from),
            senderName,
            text: message.text.body,
            ...(connection ? { connectionId: connection.id, ownerUserId: connection.userId } : {}),
          });

          /*
           * ‎**הבוט — בלי await, ורק על קו מחובר.**
           *
           * תשובה שלמה היא קריאת LLM של שניות; Meta שאינה מקבלת
           * 200 בזמן שולחת את ההודעה שוב, כלומר תשובה כפולה ללקוח.
           * במסלול הישן (מספר שהוקלד ידנית) אין `connection` ולכן
           * גם אין קו לענות ממנו — הקליטה עובדת, הבוט פשוט לא רץ.
           */
          if (ingested && connection) {
            const line = connection;
            void this.bot.maybeReply({
              connectionId: line.id,
              tenantId,
              ownerUserId: line.userId,
              contactId: ingested.contactId,
              leadId: ingested.leadId,
              customerPhone: normalizeWaPhone(message.from),
              customerName: senderName,
              text: message.text.body,
              messageId: message.id,
            });
          }
        }
      }
    }
  }

  /**
   * ‎**המתווך ענה ידנית מהאפליקציה — וזה מה שדו-קיום נועד לו.**
   *
   * שתי פעולות, ושתיהן נחוצות:
   * 1. ההודעה נרשמת בציר הזמן של הליד, כך שההיסטוריה במערכת שלמה גם
   *    כשהמתווך עובד רק מהטלפון ולא נוגע במסך.
   * 2. הבוט מושתק באותה שיחה. בלי זה שני צדדים עונים ללקוח במקביל —
   *    התקלה שהופכת את הפיצ'ר למביך במקום לשימושי.
   *
   * ‏אינו זורק לעולם: הוובהוק חייב להחזיר 200 גם כשהרישום נכשל,
   * אחרת Meta תשלח את ההד שוב ושוב.
   */
  private async handleEchoes(
    lineId: string,
    echoes: readonly { id: string; to?: string; type: string; text?: { body: string } }[],
  ): Promise<void> {
    const connection = await this.connections.byPhoneNumberId(lineId);
    if (!connection) {
      this.logger.warn(`הד הגיע מקו ${lineId} שאינו מחובר לאף משרד — נזרק`);
      return;
    }
    for (const echo of echoes) {
      // רק טקסט בשלב הזה; מדיה שנשלחה ידנית נוספת עם שכבת המדיה
      if (echo.type !== "text" || !echo.text || !echo.to) continue;
      /*
       * הערכים נלכדים כאן ולא נקראים מתוך הסגור: הצרה של הטיפוס
       * אובדת בתוך ה-callback של הטרנזקציה, והקומפיילר צודק — `echo`
       * הוא משתנה לולאה שאיש אינו מבטיח שלא ישתנה עד שהוא ייקרא.
       */
      const body = echo.text.body;
      const echoId = echo.id;
      const customerPhone = normalizeWaPhone(echo.to);
      try {
        await this.prisma.withExplicitTenant(connection.tenantId, async (tx) => {
          const phoneHash = this.crypto.phoneHash(customerPhone);
          const contact = await tx.contact.findUnique({
            where: { tenantId_phoneHash: { tenantId: connection.tenantId, phoneHash } },
            select: { id: true },
          });
          /*
           * אין איש קשר ⇒ המתווך פתח שיחה עם מישהו שאינו במערכת.
           * לא יוצרים כרטיס מהד: יצירת אנשי קשר מכל הודעה יוצאת
           * הייתה ממלאת את המאגר בכל מי שהמתווך אי פעם כתב לו.
           */
          if (!contact) return;

          const lead = await tx.lead.findFirst({
            where: {
              tenantId: connection.tenantId,
              contactId: contact.id,
              status: { in: ["new", "in_progress", "waiting_customer"] },
            },
            select: { id: true },
          });

          // Idempotency — Meta שולחת הדים כפולים כמו כל מטען אחר
          const dupe = await tx.message.findFirst({
            where: { tenantId: connection.tenantId, providerMessageId: echoId },
            select: { id: true },
          });
          if (dupe) return;

          await tx.message.create({
            data: {
              id: ulid(),
              tenantId: connection.tenantId,
              contactId: contact.id,
              direction: "out",
              channel: "whatsapp",
              provider: "coexistence_echo",
              body: body.slice(0, 4000),
              providerMessageId: echoId,
              status: "sent",
            },
          });

          if (lead) {
            await tx.interaction.create({
              data: {
                id: ulid(),
                tenantId: connection.tenantId,
                leadId: lead.id,
                kind: "whatsapp",
                direction: "out",
                content: `📱 נשלח מהוואטסאפ של המתווך: ${body}`.slice(0, 4000),
              },
            });
          }

          /*
           * ההשתקה על השיחה ולא על הליד: לקוח יכול להיות בלי ליד
           * פתוח, והבוט עדיין חייב לשתוק מולו.
           */
          const pausedUntil = new Date(Date.now() + BOT_PAUSE_MS);
          await tx.whatsAppConversation.upsert({
            where: {
              connectionId_contactId: { connectionId: connection.id, contactId: contact.id },
            },
            create: {
              id: ulid(),
              tenantId: connection.tenantId,
              connectionId: connection.id,
              contactId: contact.id,
              botPausedUntil: pausedUntil,
            },
            update: { botPausedUntil: pausedUntil },
          });
        });
      } catch (error) {
        this.logger.warn(`רישום הד ${echoId} נכשל: ${String(error)}`);
      }
    }
  }

  /**
   * ‎**ייבוא ההיסטוריה מהטלפון** (docs/12 §5.3).
   *
   * ## למה `Message` ולא `Interaction`
   *
   * האילוץ `interaction_exactly_one_parent` מחייב שכל אינטראקציה
   * תלויה בליד או בקונה. להיסטוריה מיובאת אין כזה — היא שייכת
   * לאיש הקשר — וכתיבה לשם הייתה נכשלת על כל שורה. לכן
   * ‎`Message` על `contactId`, וציר הזמן של תיק הלקוח קורא משני
   * המקורות.
   *
   * ## למה לא נפתחים לידים
   *
   * ייבוא אינו פנייה חדשה. משרד פעיל שמחבר קו היה מקבל מאות
   * „לידים חדשים” ביום החיבור, וכולם ישנים — כלומר רשימת העבודה
   * שלו נהרסת ברגע שהוא מצטרף. ההיסטוריה נקשרת ללידים רק כשלקוח
   * מיובא כותב שוב.
   *
   * ## מה קורה בכישלון
   *
   * ‏Meta אינה שולחת נתח שוב אחרי שקיבלה 200, ולכן אין למי לפנות
   * לניסיון חוזר: התרופה היחידה היא ניתוק וחיבור מחדש. במקום
   * לאבד את הנתח בשקט, הכישלון מסמן את החיבור כ-`error` — המסך
   * כבר אומר „החיבור לא הושלם” ומציע לחבר מחדש, וזו בדיוק
   * הפעולה הנכונה.
   */
  private async handleHistory(
    lineId: string,
    chunks: readonly {
      metadata?: { phase?: number; chunk_order?: number; progress?: number };
      errors?: readonly { code: number; title?: string }[];
      threads?: readonly {
        id: string;
        messages?: readonly {
          id: string;
          from?: string;
          to?: string;
          type: string;
          timestamp?: string;
          text?: { body: string };
        }[];
      }[];
    }[],
  ): Promise<void> {
    const connection = await this.connections.byPhoneNumberId(lineId);
    if (!connection) {
      this.logger.warn(`היסטוריה הגיעה לקו ${lineId} שאינו מחובר — נזרקת`);
      return;
    }

    for (const chunk of chunks) {
      /*
       * סירוב לשתף אינו תקלה. הוא נרשם כדי שהמסך יאמר „ללא
       * היסטוריה” במקום להיתקע על „מסתנכרן” לנצח.
       */
      if (chunk.errors?.length) {
        this.logger.log(
          `המתווך בחר לא לשתף היסטוריה בקו ${lineId} (${chunk.errors[0]?.code ?? "ללא קוד"})`,
        );
        await this.connections.markHistory(connection.id, { shared: false, done: true });
        continue;
      }

      let imported = 0;
      for (const thread of chunk.threads ?? []) {
        try {
          imported += await this.importThread(connection, thread);
        } catch (error) {
          /*
           * טרנזקציה פר שיחה: שיחה אחת שנכשלת אינה מפילה את שאר
           * הנתח, וההיסטוריה שכן נכנסה נשארת.
           */
          this.logger.error(`ייבוא שיחה ${thread.id} נכשל: ${String(error)}`);
          await this.connections.markHistory(connection.id, { failed: true });
        }
      }

      const progress = chunk.metadata?.progress ?? 0;
      this.logger.log(
        `היסטוריה: ${imported} הודעות מקו ${lineId} (שלב ${chunk.metadata?.phase ?? "?"}, ${progress}%)`,
      );
      if (progress >= 100) {
        await this.connections.markHistory(connection.id, { shared: true, done: true });
      }
    }
  }

  /** שיחה אחת מההיסטוריה — איש קשר + ההודעות שטרם נקלטו. */
  private async importThread(
    connection: { id: string; tenantId: string },
    thread: {
      id: string;
      messages?: readonly {
        id: string;
        from?: string;
        to?: string;
        type: string;
        timestamp?: string;
        text?: { body: string };
      }[];
    },
  ): Promise<number> {
    const texts = (thread.messages ?? []).filter((m) => m.type === "text" && m.text);
    if (texts.length === 0) return 0;

    const phone = normalizeWaPhone(thread.id);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${connection.tenantId}, true)`;

      const phoneHash = this.crypto.phoneHash(phone);
      let contact = await tx.contact.findUnique({
        where: { tenantId_phoneHash: { tenantId: connection.tenantId, phoneHash } },
        select: { id: true },
      });
      contact ??= await tx.contact.create({
        data: {
          id: ulid(),
          tenantId: connection.tenantId,
          nameEncrypted: this.crypto.encrypt("לקוח וואטסאפ"),
          phoneEncrypted: this.crypto.encrypt(phone),
          phoneHash,
        },
        select: { id: true },
      });

      /*
       * ‎**סינון בשאילתה אחת ולא בדיקה פר הודעה.**
       *
       * נתח נושא מאות הודעות, ו-`findFirst` לכל אחת היה מייצר
       * מאות הלוך-ושוב על שיחה אחת. Meta שולחת נתחים חוזרים
       * (`chunk_order` אינו ערובה לחד-פעמיות), ולכן הסינון נחוץ —
       * רק לא פעם אחת לכל שורה.
       */
      const ids = texts.map((m) => m.id);
      const existing = await tx.message.findMany({
        where: { tenantId: connection.tenantId, providerMessageId: { in: ids } },
        select: { providerMessageId: true },
      });
      const seen = new Set(existing.map((m) => m.providerMessageId));
      const fresh = texts.filter((m) => !seen.has(m.id));
      if (fresh.length === 0) return 0;

      await tx.message.createMany({
        data: fresh.map((m) => ({
          id: ulid(),
          tenantId: connection.tenantId,
          contactId: contact.id,
          /* `to` קיים רק כשהמתווך הוא ששלח — וזה מה שמכריע כיוון */
          direction: m.to ? "out" : "in",
          channel: "whatsapp",
          provider: "coexistence_history",
          body: (m.text?.body ?? "").slice(0, 4000),
          providerMessageId: m.id,
          status: "sent",
          /* החותמת המקורית ולא זמן הייבוא — אחרת כל ההיסטוריה נראית כאילו קרתה היום */
          createdAt: m.timestamp ? new Date(Number(m.timestamp) * 1000) : new Date(),
        })),
      });
      return fresh.length;
    });
  }

  /**
   * ‎**אנשי הקשר שבטלפון של המתווך** (docs/12 §5.4).
   *
   * ‎`add` מכסה הוספה ועריכה כאחת, ולכן זו כתיבה אידמפוטנטית.
   *
   * ‎**`remove` אינו מוחק אצלנו, וזו החלטה מפורשת.** מחיקה מפנקס
   * הכתובות בטלפון היא ניקוי אישי — לא הצהרה שהלקוח יצא מהמערכת.
   * מחיקה אוטומטית הייתה מוחקת איש קשר שתלויים בו לידים, הצעות
   * וציר זמן שלם, בגלל פעולה שהמתווך עשה במכשיר שלו ולא במערכת.
   * לכן היא נרשמת ביומן בלבד.
   */
  private async handleStateSync(
    lineId: string,
    entries: readonly {
      type?: string;
      action?: string;
      contact?: { full_name?: string; first_name?: string; phone_number?: string };
    }[],
  ): Promise<void> {
    const connection = await this.connections.byPhoneNumberId(lineId);
    if (!connection) return;

    for (const entry of entries) {
      if (entry.type !== undefined && entry.type !== "contact") continue;
      if (entry.action === "remove") {
        this.logger.log("איש קשר נמחק מפנקס הכתובות של המתווך — לא נמחק מהמערכת");
        continue;
      }
      const raw = entry.contact?.phone_number;
      if (!raw) continue;

      const phone = normalizeWaPhone(raw);
      const name = entry.contact?.full_name ?? entry.contact?.first_name;
      if (!name) continue;

      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.tenant_id', ${connection.tenantId}, true)`;
          const phoneHash = this.crypto.phoneHash(phone);
          const existing = await tx.contact.findUnique({
            where: { tenantId_phoneHash: { tenantId: connection.tenantId, phoneHash } },
            select: { id: true },
          });
          if (existing) {
            /*
             * השם מהטלפון גובר: המתווך שמר שם „דנה קונה בבלי”,
             * וזה שימושי יותר מ„לקוח וואטסאפ” שנוצר בקליטה.
             */
            await tx.contact.update({
              where: { id: existing.id },
              data: { nameEncrypted: this.crypto.encrypt(name) },
            });
            return;
          }
          await tx.contact.create({
            data: {
              id: ulid(),
              tenantId: connection.tenantId,
              nameEncrypted: this.crypto.encrypt(name),
              phoneEncrypted: this.crypto.encrypt(phone),
              phoneHash,
            },
          });
        });
      } catch (error) {
        this.logger.warn(`סנכרון איש קשר נכשל: ${String(error)}`);
      }
    }
  }

  private async resolveTenant(businessNumber: string): Promise<string | null> {
    const digits = businessNumber.replace(/\D/gu, "");
    const tenant = await this.prisma.tenant.findFirst({
      where: { settings: { path: ["whatsappNumber"], equals: digits } },
      select: { id: true },
    });
    return tenant?.id ?? null;
  }

  private async ingestMessage(
    tenantId: string,
    msg: {
      externalId: string;
      fromPhone: string;
      senderName: string;
      text: string;
      /**
       * הקו שדרכו נכנסה ההודעה. קיים כשהמשרד חיבר את המספר שלו
       * דרך Embedded Signup; חסר במסלול הישן (מספר שהוקלד בהגדרות),
       * ואז אין שיחה לעדכן — וזה תקין.
       */
      connectionId?: string;
      /**
       * ‎**הסוכן שהקו שלו — ואצלו הליד נוחת.**
       *
       * הלקוח כתב למספר הפרטי של סוכן מסוים, ולכן הפנייה שלו ולא
       * של המשרד. בלי השיוך הליד היה נופל למאגר לא-משויך, שרק בעלי
       * `leads.view_all` רואים — כלומר סוכן היה מחבר את הטלפון שלו
       * ומאבד את הלקוח שכתב אליו אישית.
       *
       * חסר במסלול הישן (מספר שהוקלד בהגדרות המשרד), ואז ההתנהגות
       * נשארת כשהייתה: ליד לא-משויך למאגר המשרד.
       */
      ownerUserId?: string;
    },
    /**
     * מה שהבוט צריך כדי לענות — או `null` כשההודעה כפולה ודולגה.
     * מוחזר ולא נשלף שוב: הליד נוצר *בתוך* הטרנזקציה, ושליפה חוזרת
     * אחריה הייתה מרוץ מול קליטה מקבילה.
     */
  ): Promise<{ contactId: string; leadId: string } | null> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      // Idempotency — הודעה שכבר נקלטה (Meta שולח כפולים) מדולגת.
      const dupe = await tx.interaction.findFirst({
        where: { tenantId, kind: "whatsapp", content: { startsWith: `[${msg.externalId}]` } },
        select: { id: true },
      });
      if (dupe) return null;

      // איש קשר: קיים לפי phone_hash או חדש
      const phoneHash = this.crypto.phoneHash(msg.fromPhone);
      let contact = await tx.contact.findUnique({
        where: { tenantId_phoneHash: { tenantId, phoneHash } },
        select: { id: true },
      });
      contact ??= await tx.contact.create({
        data: {
          id: ulid(),
          tenantId,
          nameEncrypted: this.crypto.encrypt(msg.senderName),
          phoneEncrypted: this.crypto.encrypt(msg.fromPhone),
          phoneHash,
        },
        select: { id: true },
      });

      /*
       * ‎**פתיחת חלון 24 השעות של Meta.**
       *
       * מהרגע הזה מותר לענות ללקוח בטקסט חופשי, ובחינם, למשך 24
       * שעות. בלי החותמת הזו כל תשובה של הבוט הייתה יוצאת אל דחייה
       * של Meta — או, גרוע מכך, אל חיוב מיותר על תבנית.
       */
      if (msg.connectionId !== undefined) {
        await tx.whatsAppConversation.upsert({
          where: {
            connectionId_contactId: { connectionId: msg.connectionId, contactId: contact.id },
          },
          create: {
            id: ulid(),
            tenantId,
            connectionId: msg.connectionId,
            contactId: contact.id,
            lastInboundAt: new Date(),
          },
          update: { lastInboundAt: new Date() },
        });
      }

      // נעילה פר איש-קשר: קליטה מקבילה (וובהוק + ידנית) לא תיצור ליד כפול
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`lead-intake:${tenantId}:${contact.id}`}, 0))`;
      // ליד פתוח קיים ⇒ ההודעה מצטרפת לציר הזמן; אחרת ⇒ ליד חדש
      let lead = await tx.lead.findFirst({
        where: { tenantId, contactId: contact.id, status: { in: ["new", "in_progress", "waiting_customer"] } },
        select: { id: true },
      });
      if (!lead) {
        // ליד חוזר: לאיש הקשר ליד קודם שנסגר — פנייה מחודשת היא איתות קנייה חזק
        const previous = await tx.lead.findFirst({
          where: { tenantId, contactId: contact.id, status: { in: ["converted", "closed"] } },
          select: { id: true },
        });
        lead = await tx.lead.create({
          data: {
            id: ulid(),
            tenantId,
            contactId: contact.id,
            source: "whatsapp",
            intent: "unknown",
            status: "new",
            summary: msg.text.slice(0, 500),
            ...(msg.ownerUserId ? { assignedToUserId: msg.ownerUserId } : {}),
          },
          select: { id: true },
        });
        await tx.outboxEvent.create({
          data: {
            id: ulid(),
            tenantId,
            name: "lead.created",
            payload: { leadId: lead.id, tenantId, source: "whatsapp", requiresHuman: false },
          },
        });
        if (previous) {
          const returnedLeadId = lead.id;
          await tx.interaction.create({
            data: {
              id: ulid(),
              tenantId,
              leadId: returnedLeadId,
              kind: "system",
              content: "🔁 ליד חוזר — לאיש הקשר ליד קודם שנסגר. ההיסטוריה המלאה בתיק הלקוח.",
            },
          });
          // הליד עדיין לא משויך — רק בעלי view_all רואים אותו, אז
          // ההתראה הולכת אליהם ולא לכל המשרד (ביקורת Codex: קישור
          // שמוביל סוכן רגיל ל-404). הרשימה נגזרת מהיכולת ולא כתובה
          // ביד: `["owner","admin"]` היה משאיר תפקיד חדש בעל אותה
          // יכולת בדיוק בלי ההתראה, בשקט.
          const managers = await tx.user.findMany({
            where: {
              tenantId,
              isActive: true,
              role: { in: rolesWithCapability("leads.view_all") },
            },
            select: { id: true },
          });
          await tx.notification.createMany({
            data: managers.map((m) => ({
              id: ulid(),
              tenantId,
              userId: m.id,
              type: "lead_returned",
              title: "🔁 ליד חוזר",
              body: `${msg.senderName} פנה שוב בוואטסאפ אחרי שהליד הקודם נסגר — שווה עדיפות.`,
              entityType: "lead",
              entityId: returnedLeadId,
            })),
          });
        }
      }

      await tx.interaction.create({
        data: {
          id: ulid(),
          tenantId,
          leadId: lead.id,
          kind: "whatsapp",
          direction: "in",
          content: `[${msg.externalId}] ${msg.text}`.slice(0, 4000),
        },
      });
      return { contactId: contact.id, leadId: lead.id };
    });
  }
}

/** wa_id של Meta הוא ספרות בלבד (9725...) — נורמליזציה ל-E.164. */
function normalizeWaPhone(waId: string): string {
  const digits = waId.replace(/\D/gu, "");
  return digits.startsWith("972") ? `+${digits}` : `+972${digits.replace(/^0/u, "")}`;
}
