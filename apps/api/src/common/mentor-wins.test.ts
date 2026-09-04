import { describe, expect, it } from "vitest";
import type { TenantTx } from "../core/prisma.service";
import { recordMentorWin } from "./mentor-wins";

const TENANT = "01TENANTAAAAAAAAAAAAAAAAAA";
const USER = "01USERAAAAAAAAAAAAAAAAAAAA";
const PROPERTY = "01PROPAAAAAAAAAAAAAAAAAAAA";

/** מדמה את ה-DB: השורה הראשונה נכנסת, השנייה נופלת על ON CONFLICT. */
function fakeTx(alreadyRecorded: boolean) {
  const statements: string[] = [];
  const tx = {
    $executeRaw: async (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => {
      const sql = strings.join("?");
      statements.push(sql + " :: " + values.map(String).join("|"));
      if (sql.includes("INSERT INTO mentor_wins"))
        return alreadyRecorded ? 0 : 1;
      return 1;
    },
    // השם הפרטי — החגיגה פונה אליו בשמו
    user: { findFirst: async () => ({ name: "דנה כהן" }) },
  };
  return { tx: tx as unknown as TenantTx, statements };
}

describe("recordMentorWin — הצלחה נרשמת פעם אחת, וההתראה איתה", () => {
  it("רישום ראשון: שורת הצלחה + התראה מיידית לאותו משתמש", async () => {
    const { tx, statements } = fakeTx(false);
    const recorded = await recordMentorWin(tx, {
      tenantId: TENANT,
      userId: USER,
      kind: "deal_closed",
      entityType: "property",
      entityId: PROPERTY,
      title: "הרצל 12, רעננה",
    });
    expect(recorded).toBe(true);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("INSERT INTO mentor_wins");
    expect(statements[1]).toContain("INSERT INTO notifications");
    expect(statements[1]).toContain("mentor_win");
    expect(statements[1]).toContain("סגרת עסקה");
    expect(statements[1]).toContain("דנה, ");
    expect(statements[1]).toContain(`mentor_win:deal_closed:${PROPERTY}`);
  });

  it("אותה עסקה שוב — לא נרשמת ולא נשלחת התראה שנייה", async () => {
    const { tx, statements } = fakeTx(true);
    const recorded = await recordMentorWin(tx, {
      tenantId: TENANT,
      userId: USER,
      kind: "deal_closed",
      entityType: "property",
      entityId: PROPERTY,
      title: "הרצל 12, רעננה",
    });
    expect(recorded).toBe(false);
    expect(statements).toHaveLength(1);
  });

  it("כותרת ריקה נעשית „נכס” — ההתראה לא אומרת „ — נסגר”", async () => {
    const { tx, statements } = fakeTx(false);
    await recordMentorWin(tx, {
      tenantId: TENANT,
      userId: USER,
      kind: "deal_closed",
      entityType: "property",
      entityId: PROPERTY,
      title: "   ",
    });
    expect(statements[1]).toContain("נכס — נסגר");
  });
});
