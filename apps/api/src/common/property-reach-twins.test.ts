import { describe, expect, it } from "vitest";
import type { Capability } from "@metavchim/shared";
import { actionablePropertyIds, actionablePropertyWhere } from "./ownership";
import { TenantContext } from "./tenant-context";

/**
 * ‎**שתי צורות לשאלה אחת — ולכן הן נבדקות זו מול זו.**
 *
 * ‏„אילו נכסים מותרים לי” נשאלת פעמיים: כסינון של רשימה שכבר
 * ‏בידי (`actionablePropertyIds`), וכתנאי `where` שרץ **לפני**
 * ‏התקרה (`actionablePropertyWhere`). שתי הצורות נחוצות — שאילתה
 * ‏אינה יכולה לקרוא לפונקציה, ורשימה שכבר נשלפה אינה צריכה
 * ‏שאילתה — אבל שני **כללים** אינם נחוצים, והשני שיתעדכן לבדו הוא
 * ‏הבאג.
 *
 * ‏זו אותה תבנית כמו `isSharedTabuProperty` מול `sharedTabuWhere`,
 * ‏ומאותה סיבה: טבלת מקרים אחת שמריצה את שתיהן.
 */

const TENANT = "01TENANTAAAAAAAAAAAAAAAAAA";
const ME = "01MEAAAAAAAAAAAAAAAAAAAAAA";
const OTHER = "01OTHERAAAAAAAAAAAAAAAAAAA";

/** ‏שני נכסים במשרד: אחד שלי, אחד של עמית. */
const PROPERTIES: { id: string; agentUserId: string }[] = [
  { id: "01PROPMINEAAAAAAAAAAAAAAAA", agentUserId: ME },
  { id: "01PROPTHEIRSAAAAAAAAAAAAAA", agentUserId: OTHER },
];
const [MINE, THEIRS] = PROPERTIES as [(typeof PROPERTIES)[0], (typeof PROPERTIES)[0]];

const tx = {
  property: {
    findMany: async ({
      where,
    }: {
      where: { id?: { in: string[] }; agentUserId?: string };
    }) =>
      PROPERTIES.filter(
        (row) =>
          (where.id === undefined || where.id.in.includes(row.id)) &&
          (where.agentUserId === undefined || row.agentUserId === where.agentUserId),
      ).map((row) => ({ id: row.id })),
  },
};

function asUser<T>(capabilities: Capability[], fn: () => T): T {
  return TenantContext.run(
    { tenantId: TENANT, userId: ME, capabilities: new Set(capabilities), billingOnly: false },
    fn,
  );
}

/**
 * ‏האם שורה עוברת את תנאי ה-`where` שנבנה. שורה בלי נכס
 * ‏(`propertyId: null`) חייבת לעבור תמיד — הבעלות עליה נגזרת
 * ‏מהלקוח, ששער אחר כבר בדק.
 */
function passes(
  where: {
    propertyId?: string | null | { in: string[] };
    OR?: { propertyId: string | null | { in: string[] } }[];
  },
  propertyId: string | null,
): boolean {
  const clause = (value: string | null | { in: string[] } | undefined): boolean => {
    if (value === undefined) return true;
    if (value === null) return propertyId === null;
    if (typeof value === "string") return propertyId === value;
    return propertyId !== null && value.in.includes(propertyId);
  };
  if (where.OR !== undefined) return where.OR.some((branch) => clause(branch.propertyId));
  return clause(where.propertyId);
}

const CASES: { caps: Capability[]; label: string; allows: Record<string, boolean> }[] = [
  {
    caps: ["properties.view", "properties.view_all"],
    label: "רואה את כל נכסי המשרד",
    allows: { [MINE.id]: true, [THEIRS.id]: true, none: true },
  },
  {
    caps: ["properties.view"],
    label: "רואה את הנכסים שלו בלבד",
    allows: { [MINE.id]: true, [THEIRS.id]: false, none: true },
  },
  {
    caps: ["buyers.view_own"],
    label: "מודול הנכסים חסום",
    allows: { [MINE.id]: false, [THEIRS.id]: false, none: true },
  },
];

describe("‏שתי הצורות של „אילו נכסים מותרים לי” מסכימות", () => {
  for (const { caps, label, allows } of CASES) {
    it(label, async () => {
      const ids = await asUser(caps, () =>
        actionablePropertyIds(tx as never, TENANT, [MINE.id, THEIRS.id]),
      );
      const where = await asUser(caps, () => actionablePropertyWhere(tx as never, TENANT));

      for (const property of PROPERTIES) {
        /* ‏צורת הרשימה: `null` = בלי הגבלה */
        const byIds = ids === null || ids.has(property.id);
        expect(byIds, `רשימה — ${property.id}`).toBe(allows[property.id]);
        expect(passes(where, property.id), `שאילתה — ${property.id}`).toBe(
          allows[property.id],
        );
      }
      /* ‏ושורה בלי נכס עוברת בשתי הצורות, תמיד */
      expect(passes(where, null), "שורה בלי נכס").toBe(allows["none"]);
    });
  }

  /*
   * ‏בלי זה הטבלה עלולה להיות ירוקה על „הכול מותר”: מקרה אחד לפחות
   * ‏חייב **לפסול** נכס, אחרת שתי הצורות מסכימות על כלום.
   */
  it("יש בטבלה מקרה שפוסל", () => {
    expect(CASES.some(({ allows }) => allows[THEIRS.id] === false)).toBe(true);
  });
});
