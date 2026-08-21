import { Injectable, Logger } from "@nestjs/common";
import { ulid } from "ulid";
import { Prisma } from "@prisma/client";
import type { GeminiUsage } from "../../core/gemini.service";
import { PrismaService } from "../../core/prisma.service";
import { TenantContext } from "../../common/tenant-context";

/**
 * יומן משימות הסוכן — הזיכרון הארוך של מה שהסוכן באמת עושה.
 *
 * ## למה לשמור את זה
 *
 * שתי סיבות, שתיהן בקשות מפורשות של בעל הפלטפורמה:
 *
 * 1. **עלות.** כל פקודה קולית עולה כסף אמיתי אצל Google. בלי רישום
 *    של צריכת האסימונים בפועל, "הסוכן יקר" נשאר תחושה שאי אפשר
 *    לא לאמת ולא לשפר. כאן כל קריאה נרשמת עם המספרים של Google
 *    עצמה — קלט, פלט, חשיבה, ומה הגיע מהמטמון.
 * 2. **אימון.** צמדי "מה המתווך אמר ⟵ מה הסוכן הבין ומה בוצע" הם
 *    בדיוק הדאטה שמאפשר בהמשך לאמן מודל ייעודי — חכם יותר בעברית
 *    של מתווכים וזול בהרבה מקריאה למודל כללי.
 *
 * ## למה best-effort
 *
 * הרישום לעולם אינו מפיל פקודה: כשל כתיבה ליומן נבלע ונרשם ללוג
 * השרת בלבד. פקודה שהובנה ובוצעה אך "נכשלה" כי שורת התיעוד שלה
 * לא נכתבה — הייתה הופכת את היומן ממדידה לסיכון.
 *
 * ## אבטחה
 *
 * הטבלה תחת RLS מלא והכתיבה בתוך `withTenant` — התמלולים מכילים
 * שמות ופרטי לקוחות קצה והם נתוני דייר לכל דבר, כולל מחיקה מלאה
 * במחיקת החשבון.
 */
@Injectable()
export class AgentEventsService {
  private readonly logger = new Logger(AgentEventsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(event: {
    channel: "web" | "whatsapp";
    kind: "interpret" | "execute";
    transcript?: string;
    actionId?: string;
    payload: Record<string, unknown>;
    source?: "llm" | "rules";
    model?: string;
    latencyMs?: number;
    usage?: GeminiUsage;
  }): Promise<void> {
    try {
      const ctx = TenantContext.maybeCurrent();
      if (ctx === undefined) return;
      await this.prisma.withTenant((tx) =>
        tx.agentEvent.create({
          data: {
            id: ulid(),
            tenantId: ctx.tenantId,
            userId: ctx.userId,
            channel: event.channel,
            kind: event.kind,
            // גבול העמודה — תמלול ארוך מהמותר נחתך ולא מפיל את הרישום
            transcript: event.transcript?.slice(0, 4000) ?? null,
            actionId: event.actionId ?? null,
            payload: event.payload as Prisma.InputJsonValue,
            source: event.source ?? null,
            model: event.model ?? null,
            latencyMs: event.latencyMs ?? null,
            usage:
              event.usage === undefined
                ? Prisma.JsonNull
                : (event.usage as unknown as Prisma.InputJsonValue),
          },
        }),
      );
    } catch (error) {
      // רישום ביומן לעולם אינו מפיל פקודה שכבר הובנה או בוצעה
      this.logger.warn(`רישום אירוע סוכן נכשל: ${String(error)}`);
    }
  }
}
