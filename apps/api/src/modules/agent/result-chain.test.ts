import { describe, expect, it } from "vitest";
import type { AgentHistoryRef } from "@metavchim/shared";
import { AgentResolveService } from "./resolve.service";
import type { Interpretation } from "./interpret.service";

/**
 * ‎**„תמצא… ותעשה לראשון מהם” — צעד שנקשר לתוצאה של הצעד שלפניו.**
 *
 * ‏הרשומה של הצעד השני אינה ידועה כשהכרטיס מוצג: היא תיוולד מהחיפוש.
 * ‏הסימון ⟪תוצאה N⟫ ממתין בשדה עד הביצוע ונקשר שם לשורה ה-N שחזרה —
 * ‏לא לחיפוש לפי טקסט, שהיה נכשל תמיד, ולא בכוח לשורה מסוג אחר.
 *
 * ‏פעולה שיוצאת ללקוח אינה נקשרת לתוצאה כלל: „תשלח לראשון מהם” היה
 * ‏מגיע לאדם שהמתווך לא ראה ולא בחר.
 */

/** ‏שום דבר כאן אינו נוגע במסד — הקשירה היא למזהים שכבר חזרו. */
function service(): AgentResolveService {
  return new AgentResolveService(
    { placeVocabulary: async () => [] } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

const TASKS: AgentHistoryRef[] = [
  { label: "להתקשר לדנה", entityType: "task", entityId: "01J00000000000000000000T01" },
  { label: "לשלוח חוזה", entityType: "task", entityId: "01J00000000000000000000T02" },
];
const PROPERTY: AgentHistoryRef[] = [
  { label: "הרצל 5", entityType: "property", entityId: "01J00000000000000000000P01" },
];

describe("קשירה לתוצאה בזמן הביצוע", () => {
  it("⟪תוצאה 2⟫ נקשר לשורה השנייה", async () => {
    const params: Record<string, unknown> = { taskPhrase: "⟪תוצאה 2⟫" };
    expect(await service().resolveForExecution("complete_task", params, TASKS)).toEqual({ ok: true });
    expect(params["taskId"]).toBe(TASKS[1]!.entityId);
  });

  it("שורה מסוג אחר אינה נקשרת בכוח", async () => {
    const params: Record<string, unknown> = { taskPhrase: "⟪תוצאה 1⟫" };
    const result = await service().resolveForExecution("complete_task", params, PROPERTY);
    expect(result).toEqual({ ok: false, message: expect.stringContaining("אינה מתאימה") });
    expect(params["taskId"]).toBeUndefined();
  });

  it("מקום שאין בתוצאה — נאמר, לא מנוחש", async () => {
    const result = await service().resolveForExecution(
      "complete_task",
      { taskPhrase: "⟪תוצאה 3⟫" },
      TASKS,
    );
    expect(result).toEqual({ ok: false, message: "בתוצאה של הצעד הקודם אין שורה 3" });
  });

  it("בלי צעד קודם — אין למה להיקשר", async () => {
    const result = await service().resolveForExecution("complete_task", {
      taskPhrase: "⟪תוצאה 1⟫",
    });
    expect(result).toEqual({ ok: false, message: "לא הייתה תוצאה קודמת לבחור ממנה" });
  });

  it("פעולה שיוצאת ללקוח — בחירה מפורשת גם כשיש תוצאה", async () => {
    const buyers: AgentHistoryRef[] = [
      { label: "משה כהן", entityType: "buyer", entityId: "01J00000000000000000000B01" },
    ];
    const params: Record<string, unknown> = { buyerPhrase: "⟪תוצאה 1⟫" };
    const result = await service().resolveForExecution("send_offer", params, buyers);
    expect(result.ok).toBe(false);
    expect(params["buyerId"]).toBeUndefined();
  });
});

describe("הכרטיס המשורשר — לפני הביצוע", () => {
  const chain = (step: { actionId: string; params: Record<string, unknown> }): Interpretation => ({
    actionId: "show_tasks",
    params: {},
    evidence: {},
    unmapped: [],
    rejected: [],
    suggest: [],
    fallback: false,
    steps: [{ ...step, rejected: [] }],
  });

  it("צעד שנקשר לתוצאה נשאר בשרשור, ומוצג בעברית ולא כסימון", async () => {
    const proposal = await service().toProposal(
      "תראה את המשימות של היום ותסגור את השנייה",
      chain({ actionId: "complete_task", params: { taskPhrase: "⟪תוצאה 2⟫" } }),
    );
    const step = proposal.followUps?.[0];
    expect(step?.actionId).toBe("complete_task");
    expect(step?.candidates).toBeUndefined();
    expect(step?.fields.find((field) => field.key === "taskPhrase")?.display).toBe(
      "מספר 2 בתוצאה של הצעד הקודם",
    );
  });

  it("שליחה ללקוח שנקשרה לתוצאה יורדת מהשרשור — עם אזהרה גלויה", async () => {
    const proposal = await service().toProposal(
      "תראה את המשימות ותשלח לראשון הצעה",
      chain({ actionId: "send_offer", params: { buyerPhrase: "⟪תוצאה 1⟫" } }),
    );
    expect(proposal.followUps ?? []).toHaveLength(0);
    expect(proposal.warnings.join(" ")).toContain("יוצאת ללקוח");
  });
});
