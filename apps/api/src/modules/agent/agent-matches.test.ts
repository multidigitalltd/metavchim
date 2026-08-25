import { describe, expect, it } from "vitest";
import type { Capability } from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { AgentExecuteService } from "./execute.service";

/**
 * „יש עוד” בהתאמות המשרד — **נספר במסד, לא נמדד באורך הרשימה.**
 *
 * שירות ההתאמות מסנן שורות מיושנות (קונה או נכס שנמחקו) בזיכרון,
 * אחרי ה-`take`. לכן שורה עודפת שנשלפה עלולה להיעלם בסינון,
 * והרשימה חוזרת בדיוק בגודל התקרה גם כשיש עוד — „ועוד 50
 * התאמות” נקרא אז כסך הכול (ביקורת Codex).
 */

const OFFICE_MATCHES = 50;

/** ההרצה נעצרת בשירות ההתאמות — שאר התלויות אינן נוגעות למסלול. */
function serviceWith(matching: {
  listAll: (query: { minScore: number; limit: number }) => Promise<unknown[]>;
  countAll: (query: { minScore: number }) => Promise<number>;
}): AgentExecuteService {
  const deps = Array.from({ length: 14 }, () => ({}) as unknown);
  deps[6] = matching;
  deps[11] = { resolveForExecution: async () => ({ ok: true as const }) };
  deps[13] = { record: async () => undefined };
  return new AgentExecuteService(
    ...(deps as unknown as ConstructorParameters<typeof AgentExecuteService>),
  );
}

function withCapabilities<T>(capabilities: Capability[], fn: () => T): T {
  return TenantContext.run(
    {
      tenantId: "01TENANT",
      userId: "01USER",
      capabilities: new Set(capabilities),
      billingOnly: false,
    },
    fn,
  );
}

/** רשימה בגודל התקרה, כמו שהשירות מחזיר אחרי הסינון והחיתוך. */
const full = Array.from({ length: OFFICE_MATCHES }, (_, i) => ({ id: `m${i}`, score: 90 }));

describe("התאמות המשרד — הקיטום נגזר מהספירה", () => {
  it("רשימה מלאה וספירה גדולה ממנה — „יש עוד”", async () => {
    const service = serviceWith({
      listAll: async () => full,
      countAll: async () => 137,
    });
    const result = await withCapabilities(["matches.view"], () =>
      service.execute("show_matches", {}),
    );
    expect(result.data).toMatchObject({ hasMore: true });
    expect((result.data as { matches: unknown[] }).matches).toHaveLength(OFFICE_MATCHES);
  });

  /*
   * הצורה שהשורה העודפת פספסה: הספירה בדיוק בתקרה, כלומר זה הכול.
   * שליפה של 51 שורות שאחת מהן מסוננת הייתה נותנת כאן 50 ו„אין
   * עוד” — התשובה הנכונה במקרה, ומהסיבה הלא נכונה.
   */
  it("ספירה בגודל התקרה — „זה הכול”", async () => {
    const service = serviceWith({
      listAll: async () => full,
      countAll: async () => OFFICE_MATCHES,
    });
    const result = await withCapabilities(["matches.view"], () =>
      service.execute("show_matches", {}),
    );
    expect(result.data).toMatchObject({ hasMore: false });
  });

  it("הרשימה והספירה נשאלות על אותו סף", async () => {
    const asked: { list?: number; count?: number } = {};
    const service = serviceWith({
      listAll: async (query) => {
        asked.list = query.minScore;
        expect(query.limit).toBe(OFFICE_MATCHES);
        return [];
      },
      countAll: async (query) => {
        asked.count = query.minScore;
        return 0;
      },
    });
    await withCapabilities(["matches.view"], () => service.execute("show_matches", {}));
    expect(asked.count).toBe(asked.list);
  });
});
