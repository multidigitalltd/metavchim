import { describe, expect, it } from "vitest";
import type { Capability } from "@metavchim/shared";
import {
  actionablePropertyIds,
  actionablePropertyWhere,
  assertPropertyScope,
  ownershipFilter,
  propertyRecordInScope,
} from "./ownership";
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
 * ‏שני סוגי רשומה: אחד שההיקף שלו נגזר מנכס **חובה**, ואחד שאינו
 * ‏חייב אחד. ‏מחרוזות ולא סוגים אמיתיים — כאן נבדק **הכלל**, ואת
 * ‏המדיניות („איזה סוג חייב נכס”) כל קורא מוסר בעצמו.
 */
const KINDS_ON_PROPERTY = ["needs"];

/**
 * ‏האם שורה עוברת את תנאי ה-`where` שנבנה.
 *
 * ‎**גם `kind`, ולא רק `propertyId`.** „בלי נכס ⇒ ברמת המשרד” היה
 * ‏ההנחה, והיא שקרית: ה-API הישן אִפשר בלעדיות בלי נכס, ומחיקת
 * ‏נכס מאפסת את השדה על סריקה חתומה. עוזר שמתעלם מ-`kind` היה
 * ‏מאשר את התנאי החדש בלי לבדוק את מה שהוא בא לתקן.
 */
function passes(
  where: {
    propertyId?: string | null | { in: string[] };
    kind?: { notIn: string[] };
    OR?: { propertyId: string | null | { in: string[] }; kind?: { notIn: string[] } }[];
  },
  row: { propertyId: string | null; kind: string },
): boolean {
  const clause = (branch: {
    propertyId?: string | null | { in: string[] };
    kind?: { notIn: string[] };
  }): boolean => {
    const value = branch.propertyId;
    const byProperty =
      value === undefined
        ? true
        : value === null
          ? row.propertyId === null
          : typeof value === "string"
            ? row.propertyId === value
            : row.propertyId !== null && value.in.includes(row.propertyId);
    const byKind = branch.kind === undefined || !branch.kind.notIn.includes(row.kind);
    return byProperty && byKind;
  };
  if (where.OR !== undefined) return where.OR.some(clause);
  return clause(where);
}

/**
 * ‏ארבע צורות של רשומה, ולא שתיים. השתיים הראשונות הן השאלה
 * ‏המקורית; השתיים האחרונות הן ההנחה שהתגלתה כשקרית —
 * ‎**„בלי `propertyId` ⇒ ברמת המשרד”**. היא נכונה להזמנה בכתב
 * ‏ושקרית לבלעדיות, ולכן היא נשאלת פעמיים כאן.
 */
const ROWS: { key: string; propertyId: string | null; kind: string; label: string }[] = [
  { key: "mine", propertyId: MINE.id, kind: "free", label: "רשומה על הנכס שלי" },
  { key: "theirs", propertyId: THEIRS.id, kind: "free", label: "רשומה על הנכס של עמית" },
  { key: "detached", propertyId: null, kind: "free", label: "רשומה שאינה חייבת נכס" },
  {
    key: "orphan",
    propertyId: null,
    kind: "needs",
    label: "רשומה שחייבת נכס — ואין לה",
  },
];

const CASES: { caps: Capability[]; label: string; allows: Record<string, boolean> }[] = [
  {
    caps: ["properties.view", "properties.view_all"],
    label: "רואה את כל נכסי המשרד",
    allows: { mine: true, theirs: true, detached: true, orphan: true },
  },
  {
    caps: ["properties.view"],
    label: "רואה את הנכסים שלו בלבד",
    /*
     * ‎`orphan: false` הוא התיקון עצמו: בלעדיות ישנה בלי `propertyId`
     * ‏נקראת כמו **נכס לא משויך**, כלומר רק מי שמחזיק
     * ‏`properties.view_all`. אין מאיפה להשלים את הנכס — הוא מעולם
     * ‏לא נשמר.
     */
    allows: { mine: true, theirs: false, detached: true, orphan: false },
  },
  {
    caps: ["buyers.view_own"],
    label: "מודול הנכסים חסום",
    allows: { mine: false, theirs: false, detached: true, orphan: false },
  },
];

describe("‏שתי הצורות של „אילו נכסים מותרים לי” מסכימות", () => {
  for (const { caps, label, allows } of CASES) {
    it(label, async () => {
      const allowed = await asUser(caps, () =>
        actionablePropertyIds(tx as never, TENANT, [MINE.id, THEIRS.id]),
      );
      const where = await asUser(caps, () =>
        actionablePropertyWhere(tx as never, TENANT, KINDS_ON_PROPERTY),
      );

      for (const row of ROWS) {
        const expected = allows[row.key];
        /*
         * ‎`propertyRecordInScope` היא צורת הרשימה של אותו כלל,
         * ‏ו-`actionablePropertyIds` הוא רק המקור שלה למזהים.
         */
        const byList = propertyRecordInScope(
          {
            propertyId: row.propertyId,
            requiresProperty: KINDS_ON_PROPERTY.includes(row.kind),
          },
          allowed,
        );
        expect(byList, `רשימה — ${row.label}`).toBe(expected);
        expect(passes(where, row), `שאילתה — ${row.label}`).toBe(expected);
      }
    });
  }

  /*
   * ‏בלי זה הטבלה עלולה להיות ירוקה על „הכול מותר”: מקרה אחד לפחות
   * ‏חייב **לפסול** נכס, אחרת שתי הצורות מסכימות על כלום.
   */
  it("יש בטבלה מקרה שפוסל", () => {
    expect(CASES.some(({ allows }) => allows["theirs"] === false)).toBe(true);
  });

  /*
   * ‏ובלי זה, השורה החדשה בטבלה יכולה להיוולד מתירנית: מי שרואה
   * ‏את הנכסים שלו בלבד חייב **להיחסם** על רשומה שחייבת נכס ואין
   * ‏לה, אחרת התיקון הזה נעלם בשקט ביום שמישהו ינרמל את הטבלה.
   */
  it("יש בטבלה מקרה שפוסל רשומה חסרת-נכס שחייבת אחד", () => {
    expect(
      CASES.some(({ allows }) => allows["orphan"] === false && allows["detached"] === true),
    ).toBe(true);
  });
});

/**
 * ‎**ואותה שאלה בדיוק, בזוג השני: „הנכס הזה בהיקף שלי?”**
 *
 * ‏גם לה שתי צורות, ושתיהן נחוצות: `assertPropertyScope` זורקת על
 * ‏שורה שכבר בידי, ו-`ownershipFilter("properties.view_all",
 * ‏"agentUserId")` מצמצם שאילתה לפני שהשורה נשלפה — הצורה שדרכה
 * ‏`canSeeContact` מחליט אם בעל הנכס ירד מהכרטיס.
 *
 * ‏השתיים נעשו תלויות זו בזו כשהחלפת הבעלים נשאלה על **היקף
 * ‏הנכס** ולא רק על האדם (ביקורת Codex, P1): המסך מחליט מה להציג
 * ‏לפי צורת השאילתה, והשרת מחליט מה לקבל לפי צורת הפונקציה. אם הן
 * ‏ייפרדו, המסך יציג בעלים לעריכה שהשרת ידחה — או, בכיוון המסוכן,
 * ‏יסתיר בעלים שהשרת בכל זאת ייתן להחליף.
 */
describe("‏שתי הצורות של „הנכס הזה בהיקף שלי” מסכימות", () => {
  /** ‏האם `ownershipFilter` היה משאיר את השורה בתוצאה. */
  function inScopeByFilter(agentUserId: string | null): boolean {
    const filter = ownershipFilter("properties.view_all", "agentUserId");
    const required = filter["agentUserId"];
    return required === undefined || required === agentUserId;
  }

  function inScopeByAssert(agentUserId: string | null): boolean {
    try {
      assertPropertyScope(agentUserId, "בדיקה");
      return true;
    } catch {
      return false;
    }
  }

  /*
   * ‏נכס בלי סוכן משויך נכלל בכוונה: הוא הצורה שבה `null` ב-SQL
   * ‏אינו שווה לכלום, וזו בדיוק הפרידה שכבר קרתה פעם בלידים.
   */
  const OWNERS: { agentUserId: string | null; label: string }[] = [
    { agentUserId: ME, label: "הנכס שלי" },
    { agentUserId: OTHER, label: "הנכס של עמית" },
    { agentUserId: null, label: "נכס בלי סוכן משויך" },
  ];

  for (const { caps, label } of CASES) {
    it(label, () => {
      for (const row of OWNERS) {
        /*
         * ‏מודול חסום הוא היוצא מן הכלל היחיד, והוא בכוונה: הפונקציה
         * ‏זורקת „המודול חסום”, ואילו צורת השאילתה אינה נשאלת כלל —
         * ‏הקורא בודק את היכולת לפני שהוא בונה את התנאי.
         */
        const blocked = !caps.includes("properties.view");
        const byFilter = asUser(caps, () => (blocked ? false : inScopeByFilter(row.agentUserId)));
        const byAssert = asUser(caps, () => inScopeByAssert(row.agentUserId));
        expect(byAssert, `${label} — ${row.label}`).toBe(byFilter);
      }
    });
  }

  it("יש בטבלה מקרה שפוסל", () => {
    expect(
      CASES.some(({ caps }) => !asUser(caps, () => inScopeByAssert(OTHER))),
    ).toBe(true);
  });
});
