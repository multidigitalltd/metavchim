import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../core/prisma.service";

/**
 * שימוש ועלות של הסוכן — הצד הקורא של `agent_events`.
 *
 * המפתח של Gemini הוא של הפלטפורמה, כלומר כל פקודה קולית של כל
 * משרד עולה כסף **לבעל הפלטפורמה** — ולכן הדוח יושב במסך הפלטפורמה
 * ולא בהגדרות המשרד. בלי המספרים כאן "הסוכן יקר" נשאר תחושה: הדוח
 * מראה כמה פקודות רצו, כמה אסימונים נצרכו לפי סוג (החשיבה היא
 * הרכיב היקר; המטמון הוא הזול), כמה פקודות נפלו לזיהוי הבסיסי,
 * ואיפה זה קורה — לכל משרד בנפרד.
 *
 * ## RLS
 *
 * הטבלה תחת FORCE RLS, ולכן אין "שאילתה אחת על הכול": שאילתה בלי
 * הקשר דייר מחזירה אפס שורות בלי שגיאה — דוח שמשקר בשקט. הצבירה
 * רצה משרד-משרד תחת `withExplicitTenant`, אותה תבנית כמו סורקי
 * ה-Workers ומאותה סיבה.
 */

export interface AgentUsageTotals {
  interpretCount: number;
  executeCount: number;
  /** פקודות שנפלו לזיהוי הבסיסי — מד הבריאות של המנוע */
  rulesCount: number;
  whatsappCount: number;
  promptTokens: number;
  outputTokens: number;
  /** אסימוני "חשיבה" — מחויבים כפלט; אמורים להיות נמוכים מאז ההגבלה */
  thoughtTokens: number;
  /** כמה מהקלט הגיע מהמטמון של Google — מוזל ברובו */
  cachedTokens: number;
  avgLatencyMs: number;
}

export interface AgentUsageReport {
  totals: AgentUsageTotals;
  perTenant: ({ tenantId: string; tenantName: string } & AgentUsageTotals)[];
  perDay: { day: string; interpretCount: number; tokens: number }[];
}

/** שורת צבירה כפי שהיא חוזרת מ-Postgres — מספרים גדולים כ-bigint. */
interface TotalsRow {
  interpret_count: number;
  execute_count: number;
  rules_count: number;
  whatsapp_count: number;
  prompt_tokens: bigint;
  output_tokens: bigint;
  thought_tokens: bigint;
  cached_tokens: bigint;
  avg_latency_ms: number;
}

const EMPTY: AgentUsageTotals = {
  interpretCount: 0,
  executeCount: 0,
  rulesCount: 0,
  whatsappCount: 0,
  promptTokens: 0,
  outputTokens: 0,
  thoughtTokens: 0,
  cachedTokens: 0,
  avgLatencyMs: 0,
};

@Injectable()
export class AgentUsageService {
  constructor(private readonly prisma: PrismaService) {}

  async report(days: number): Promise<AgentUsageReport> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const tenants = await this.prisma.tenant.findMany({
      select: { id: true, name: true },
      orderBy: { createdAt: "asc" },
    });

    const perTenant: AgentUsageReport["perTenant"] = [];
    const dayMap = new Map<string, { interpretCount: number; tokens: number }>();

    for (const tenant of tenants) {
      const { totals, days: tenantDays } = await this.prisma.withExplicitTenant(
        tenant.id,
        async (tx) => {
          const [row] = await tx.$queryRaw<TotalsRow[]>`
            SELECT
              COUNT(*) FILTER (WHERE kind = 'interpret')::int            AS interpret_count,
              COUNT(*) FILTER (WHERE kind = 'execute')::int              AS execute_count,
              COUNT(*) FILTER (WHERE kind = 'interpret'
                                 AND source = 'rules')::int              AS rules_count,
              COUNT(*) FILTER (WHERE channel = 'whatsapp')::int          AS whatsapp_count,
              COALESCE(SUM((usage->>'promptTokens')::bigint), 0)::bigint AS prompt_tokens,
              COALESCE(SUM((usage->>'outputTokens')::bigint), 0)::bigint AS output_tokens,
              COALESCE(SUM((usage->>'thoughtTokens')::bigint), 0)::bigint AS thought_tokens,
              COALESCE(SUM((usage->>'cachedTokens')::bigint), 0)::bigint AS cached_tokens,
              COALESCE(AVG(latency_ms), 0)::int                          AS avg_latency_ms
            FROM agent_events
            WHERE created_at >= ${since}`;
          const dayRows = await tx.$queryRaw<
            { day: string; interpret_count: number; tokens: bigint }[]
          >`
            SELECT
              to_char(created_at AT TIME ZONE 'Asia/Jerusalem', 'YYYY-MM-DD') AS day,
              COUNT(*) FILTER (WHERE kind = 'interpret')::int                 AS interpret_count,
              COALESCE(SUM(
                (usage->>'promptTokens')::bigint
                + (usage->>'outputTokens')::bigint
                + (usage->>'thoughtTokens')::bigint
              ), 0)::bigint                                                   AS tokens
            FROM agent_events
            WHERE created_at >= ${since}
            GROUP BY 1`;
          return { totals: row, days: dayRows };
        },
      );

      const mapped = totals === undefined ? EMPTY : mapTotals(totals);
      // משרד ששקט כל התקופה לא תופס שורה בטבלה
      if (mapped.interpretCount > 0 || mapped.executeCount > 0) {
        perTenant.push({ tenantId: tenant.id, tenantName: tenant.name, ...mapped });
      }
      for (const row of tenantDays) {
        const entry = dayMap.get(row.day) ?? { interpretCount: 0, tokens: 0 };
        entry.interpretCount += row.interpret_count;
        entry.tokens += Number(row.tokens);
        dayMap.set(row.day, entry);
      }
    }

    const totals = perTenant.reduce<AgentUsageTotals>(
      (acc, row) => ({
        interpretCount: acc.interpretCount + row.interpretCount,
        executeCount: acc.executeCount + row.executeCount,
        rulesCount: acc.rulesCount + row.rulesCount,
        whatsappCount: acc.whatsappCount + row.whatsappCount,
        promptTokens: acc.promptTokens + row.promptTokens,
        outputTokens: acc.outputTokens + row.outputTokens,
        thoughtTokens: acc.thoughtTokens + row.thoughtTokens,
        cachedTokens: acc.cachedTokens + row.cachedTokens,
        // ממוצע משוקלל לפי מספר הפקודות, לא ממוצע של ממוצעים
        avgLatencyMs:
          acc.interpretCount + row.interpretCount === 0
            ? 0
            : Math.round(
                (acc.avgLatencyMs * acc.interpretCount +
                  row.avgLatencyMs * row.interpretCount) /
                  (acc.interpretCount + row.interpretCount),
              ),
      }),
      EMPTY,
    );

    // הימים ממוזגים מכל המשרדים — ממוינים כרונולוגית לציר במסך
    const perDay = [...dayMap.entries()]
      .map(([day, value]) => ({ day, ...value }))
      .sort((a, b) => a.day.localeCompare(b.day));

    return { totals, perTenant, perDay };
  }

  /**
   * ייצוא צמדי האימון — JSONL, שורה לכל פירוש.
   *
   * זה הפורמט שכלי כוונון (fine-tuning) מקבלים: מה נאמר ⟵ מה הובן,
   * עם המקור והערוץ. `payload` הוא הפירוש המלא (שדות, ראיות, צעדים).
   * מזהה המשרד מוחלף במספר רץ — הדאטה יוצא מהמערכת לכלי אימון,
   * ואין סיבה שמזהים פנימיים ייסעו איתו.
   */
  async exportJsonl(days: number, maxRows: number): Promise<string> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const tenants = await this.prisma.tenant.findMany({
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    const lines: string[] = [];
    let tenantIndex = 0;
    for (const tenant of tenants) {
      tenantIndex += 1;
      if (lines.length >= maxRows) break;
      const rows = await this.prisma.withExplicitTenant(tenant.id, (tx) =>
        tx.agentEvent.findMany({
          where: { tenantId: tenant.id, kind: "interpret", createdAt: { gte: since } },
          orderBy: { createdAt: "asc" },
          take: maxRows - lines.length,
          select: {
            transcript: true,
            actionId: true,
            payload: true,
            source: true,
            model: true,
            channel: true,
            latencyMs: true,
            createdAt: true,
          },
        }),
      );
      for (const row of rows) {
        lines.push(
          JSON.stringify({
            office: tenantIndex,
            channel: row.channel,
            transcript: row.transcript,
            action: row.actionId,
            interpretation: row.payload,
            source: row.source,
            model: row.model,
            latencyMs: row.latencyMs,
            at: row.createdAt.toISOString(),
          }),
        );
      }
    }
    return lines.join("\n");
  }
}

function mapTotals(row: TotalsRow): AgentUsageTotals {
  return {
    interpretCount: row.interpret_count,
    executeCount: row.execute_count,
    rulesCount: row.rules_count,
    whatsappCount: row.whatsapp_count,
    promptTokens: Number(row.prompt_tokens),
    outputTokens: Number(row.output_tokens),
    thoughtTokens: Number(row.thought_tokens),
    cachedTokens: Number(row.cached_tokens),
    avgLatencyMs: row.avg_latency_ms,
  };
}
