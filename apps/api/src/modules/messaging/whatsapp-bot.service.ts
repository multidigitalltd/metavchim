import { Injectable, Logger } from "@nestjs/common";
import { ulid } from "ulid";
import { GeminiService } from "../../core/gemini.service";
import { PrismaService } from "../../core/prisma.service";
import { WhatsAppConnectionService } from "./whatsapp-connection.service";
import { WhatsAppSendService } from "./whatsapp-send.service";
import {
  BOT_DEFAULTS,
  botReplySchema,
  buildBotPrompt,
  isOptOut,
  parseBotSettings,
  withinHours,
  type BotSettings,
} from "./bot-policy";

/**
 * ‎**הבוט שעונה ללקוחות על הקו של הסוכן** (docs/12 §6).
 *
 * ## מה הוא, ומה הוא לא
 *
 * הסוכן האישי (`whatsapp-assistant`) משרת את **המתווך** על קו
 * הפלטפורמה. הבוט הזה משרת את **הלקוח** על קו המתווך — תפקיד אחר,
 * קהל אחר, וכללים אחרים לגמרי.
 *
 * ## למה השלד קבוע בקוד ולא בהגדרה
 *
 * מה שניתן לעריכה הוא הטעם: נוסח הפתיחה, שעות, שאלות אפיון, משך
 * השתקה. מה שקבוע — הצגה עצמית כבוט, „הסר”, אסקלציה, ואיסור יזימה
 * — הוא מדיניות: Meta דורשת גילוי, opt-out הוא חובה, ואסקלציה היא
 * מה שמונע מהבוט להתעקש מול לקוח כועס. פרומפט חופשי היה מאפשר
 * לסוכן לבטל כל אחד מהם בטעות, **והנזק נוחת על דירוג האיכות של
 * המספר הפרטי שלו** — לא עלינו.
 *
 * ## למה כל שער נבדק בשירות ולא ב-Controller
 *
 * הבוט נובע מוובהוק ציבורי שאין בו מסלול ואין בו משתמש. `@Require…`
 * לא היה נוגע בו, וכל שער שהיה מוצב שם היה נעקף בשקט.
 */

/** תוצאה, לצורך בדיקות ולוג — לא נשלחת לשום מקום. */
export type BotOutcome =
  | "sent"
  | "escalated"
  | "opted_out"
  | "paused"
  | "off"
  | "outside_hours"
  | "not_in_plan"
  | "no_credentials"
  | "failed";

@Injectable()
export class WhatsAppBotService {
  private readonly logger = new Logger(WhatsAppBotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly connections: WhatsAppConnectionService,
    private readonly sender: WhatsAppSendService,
    private readonly gemini: GeminiService,
  ) {}

  /**
   * מענה להודעת לקוח. **לעולם אינו זורק** — הוא נקרא מהוובהוק.
   *
   * סדר השערים אינו שרירותי: „הסר” נבדק **לפני** הכול, כי לקוח
   * שביקש להפסיק ומקבל במקום זה שאלת אפיון הוא בדיוק התלונה
   * שמורידה דירוג איכות. אחריו ההשתקה, כי מתווך שכבר ענה בעצמו
   * גובר על כל הגדרה.
   */
  async maybeReply(input: {
    connectionId: string;
    tenantId: string;
    ownerUserId: string;
    contactId: string;
    leadId: string | null;
    customerPhone: string;
    customerName: string;
    text: string;
    messageId: string;
  }): Promise<BotOutcome> {
    try {
      return await this.run(input);
    } catch (error) {
      this.logger.error(`הבוט נכשל בשיחה ${input.contactId}: ${String(error)}`);
      return "failed";
    }
  }

  private async run(input: {
    connectionId: string;
    tenantId: string;
    ownerUserId: string;
    contactId: string;
    leadId: string | null;
    customerPhone: string;
    customerName: string;
    text: string;
    messageId: string;
  }): Promise<BotOutcome> {
    const conversation = await this.conversation(input.tenantId, input.connectionId, input.contactId);

    /*
     * ‎**„הסר” גובר על הכול, כולל על בוט כבוי.**
     *
     * בקשת הסרה שמגיעה כשהבוט מכובה עדיין חייבת להירשם: היא נוגעת
     * גם לפניות יזומות עתידיות, ולא רק לתשובה הנוכחית.
     */
    if (isOptOut(input.text)) {
      await this.setOptOut(input.tenantId, conversation.id);
      const creds = await this.connections.credentialsFor(input.connectionId);
      if (creds) {
        await this.sender.sendTextAs(
          creds,
          input.customerPhone,
          BOT_DEFAULTS.optOutConfirmation,
        );
      }
      this.logger.log(`לקוח ביקש הסרה בשיחה ${conversation.id}`);
      return "opted_out";
    }
    if (conversation.optedOutAt) return "opted_out";

    /* מתווך שענה בעצמו — אדם לקח פיקוד, והבוט שותק עד שהחלון פג. */
    if (conversation.botPausedUntil && conversation.botPausedUntil > new Date()) return "paused";

    if (!(await this.connections.botAllowed(input.tenantId))) return "not_in_plan";

    const settings = parseBotSettings(await this.botSettings(input.connectionId));
    if (!settings.enabled) return "off";
    if (!withinHours(settings, new Date())) {
      /*
       * מחוץ לשעות: מענה קצר ואמיתי עדיף על שתיקה. הלקוח יודע
       * שנקלט, ולא כותב שוב שלוש פעמים כי „אולי לא הגיע”.
       */
      const creds = await this.connections.credentialsFor(input.connectionId);
      if (!creds) return "no_credentials";
      await this.sender.sendTextAs(creds, input.customerPhone, settings.afterHoursMessage);
      await this.record(input, settings.afterHoursMessage);
      return "outside_hours";
    }

    const creds = await this.connections.credentialsFor(input.connectionId);
    if (!creds) return "no_credentials";

    const history = Array.isArray(conversation.botState)
      ? (conversation.botState as { role: string; text: string }[])
      : [];
    const prompt = buildBotPrompt({
      settings,
      customerName: input.customerName,
      history,
      message: input.text,
    });

    const started = Date.now();
    const result = await this.gemini.generateStructuredDetailed(prompt, botReplySchema(), {
      maxOutputTokens: 700,
      timeoutMs: 15_000,
    });
    const parsed = this.parse(result.value);
    if (!parsed) {
      /*
       * המודל לא החזיר תשובה שמישה. **שתיקה ולא נוסח גנרי**: הלקוח
       * ממתין לאדם ממילא, והתראה למתווך שווה יותר מ„לא הבנתי”.
       */
      await this.escalate(input, "המודל לא החזיר תשובה");
      return "escalated";
    }

    await this.logUsage(input, result, parsed);

    if (parsed.escalate) {
      await this.escalate(input, parsed.escalationReason ?? "הבוט ביקש להעביר לאדם");
      /*
       * גם באסקלציה נשלחת תשובה: „מעביר אותך לסוכן” עדיף על ניתוק
       * שקט באמצע שיחה.
       */
      await this.sender.sendTextAs(creds, input.customerPhone, parsed.reply);
      await this.record(input, parsed.reply);
      return "escalated";
    }

    const sent = await this.sender.sendTextAs(creds, input.customerPhone, parsed.reply);
    if (!sent) return "failed";

    await this.record(input, parsed.reply);
    await this.remember(input.tenantId, conversation.id, history, input.text, parsed.reply);
    this.logger.log(
      `הבוט ענה בשיחה ${conversation.id} (${Date.now() - started}ms, כוונה: ${parsed.intent ?? "לא זוהתה"})`,
    );
    return "sent";
  }

  /** שורת השיחה — נוצרת בפעם הראשונה שלקוח כותב לקו. */
  private async conversation(
    tenantId: string,
    connectionId: string,
    contactId: string,
  ): Promise<{
    id: string;
    optedOutAt: Date | null;
    botPausedUntil: Date | null;
    botState: unknown;
  }> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return tx.whatsAppConversation.upsert({
        where: { connectionId_contactId: { connectionId, contactId } },
        create: { id: ulid(), tenantId, connectionId, contactId },
        update: {},
        select: { id: true, optedOutAt: true, botPausedUntil: true, botState: true },
      });
    });
  }

  private async botSettings(connectionId: string): Promise<unknown> {
    const row = await this.prisma.whatsAppBusinessConnection.findUnique({
      where: { id: connectionId },
      select: { botSettings: true },
    });
    return row?.botSettings ?? null;
  }

  private async setOptOut(tenantId: string, conversationId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      await tx.whatsAppConversation.update({
        where: { id: conversationId },
        data: { optedOutAt: new Date() },
      });
    });
  }

  /**
   * זיכרון השיחה — ארבעה תורות אחרונים בלבד.
   *
   * מספיק כדי לא לשאול פעמיים „באיזה אזור”, וקצר מספיק כדי שהעלות
   * לא תטפס עם אורך השיחה.
   */
  private async remember(
    tenantId: string,
    conversationId: string,
    history: { role: string; text: string }[],
    incoming: string,
    reply: string,
  ): Promise<void> {
    const next = [...history, { role: "customer", text: incoming }, { role: "bot", text: reply }]
      .slice(-8)
      .map((turn) => ({ role: turn.role, text: turn.text.slice(0, 500) }));
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      await tx.whatsAppConversation.update({
        where: { id: conversationId },
        data: { botState: next },
      });
    });
  }

  /** תשובת הבוט בציר הזמן — כדי שהמתווך יראה מה נאמר בשמו. */
  private async record(
    input: { tenantId: string; contactId: string; leadId: string | null },
    reply: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${input.tenantId}, true)`;
      await tx.message.create({
        data: {
          id: ulid(),
          tenantId: input.tenantId,
          contactId: input.contactId,
          direction: "out",
          channel: "whatsapp",
          provider: "coexistence_bot",
          body: reply.slice(0, 4000),
          status: "sent",
        },
      });
      if (input.leadId) {
        await tx.interaction.create({
          data: {
            id: ulid(),
            tenantId: input.tenantId,
            leadId: input.leadId,
            kind: "whatsapp",
            direction: "out",
            content: `🤖 ${reply}`.slice(0, 4000),
          },
        });
      }
    });
  }

  /**
   * אסקלציה — הבוט מפסיק, והמתווך מקבל התראה עם הקשר.
   *
   * ההשתקה כאן קריטית: בלעדיה הבוט היה ממשיך לענות בהודעה הבאה,
   * בדיוק כשהלקוח כבר ביקש אדם.
   */
  private async escalate(
    input: {
      tenantId: string;
      ownerUserId: string;
      contactId: string;
      leadId: string | null;
      customerName: string;
      connectionId: string;
    },
    reason: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${input.tenantId}, true)`;
      await tx.whatsAppConversation.updateMany({
        where: { connectionId: input.connectionId, contactId: input.contactId },
        data: { botPausedUntil: new Date(Date.now() + BOT_DEFAULTS.escalationPauseMs) },
      });
      await tx.notification.create({
        data: {
          id: ulid(),
          tenantId: input.tenantId,
          userId: input.ownerUserId,
          type: "whatsapp_bot_escalation",
          title: "🙋 לקוח ממתין לך בוואטסאפ",
          body: `${input.customerName}: ${reason}`.slice(0, 500),
          ...(input.leadId ? { entityType: "lead", entityId: input.leadId } : {}),
        },
      });
    });
    this.logger.log(`אסקלציה בשיחה עם ${input.contactId}: ${reason}`);
  }

  /**
   * רישום צריכה — כל תשובה היא קריאת LLM שאנחנו משלמים עליה, וזה
   * מה שמצדיק את התוסף בתשלום. בלי המדידה אין דרך לתמחר.
   */
  private async logUsage(
    input: { tenantId: string; ownerUserId: string; text: string },
    result: { model: string; latencyMs: number; usage?: unknown },
    parsed: { intent?: string; escalate: boolean },
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${input.tenantId}, true)`;
        await tx.agentEvent.create({
          data: {
            id: ulid(),
            tenantId: input.tenantId,
            userId: input.ownerUserId,
            channel: "whatsapp",
            kind: "execute",
            actionId: "bot.reply",
            transcript: input.text.slice(0, 4000),
            payload: { intent: parsed.intent ?? null, escalated: parsed.escalate },
            source: "llm",
            model: result.model,
            latencyMs: result.latencyMs,
            ...(result.usage === undefined ? {} : { usage: result.usage as object }),
          },
        });
      });
    } catch (error) {
      /* מדידה שנכשלה אינה סיבה למנוע תשובה מלקוח */
      this.logger.warn(`רישום צריכת הבוט נכשל: ${String(error)}`);
    }
  }

  private parse(
    value: unknown,
  ): { reply: string; intent?: string; escalate: boolean; escalationReason?: string } | null {
    if (typeof value !== "object" || value === null) return null;
    const raw = value as Record<string, unknown>;
    const reply = typeof raw["reply"] === "string" ? raw["reply"].trim() : "";
    if (reply === "") return null;
    return {
      reply,
      ...(typeof raw["intent"] === "string" ? { intent: raw["intent"] } : {}),
      escalate: raw["escalate"] === true,
      ...(typeof raw["escalationReason"] === "string"
        ? { escalationReason: raw["escalationReason"] }
        : {}),
    };
  }
}

export type { BotSettings };
