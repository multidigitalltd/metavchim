import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Capability } from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { MatchingService } from "./matching.service";

/**
 * ‎**שידוך שותפים — מה שהוא מציע הוא היכרות, ולכן מי שאיני רשאי
 * לראות אינו נכנס בכלל.**
 *
 * ‏זו ההבחנה מול רשימת ההתאמות הרגילה, ששם קונה שאיני רשאי לראות
 * ‏נשאר בשורה בלי שם. כאן ההצעה היא „חבר בין שני האנשים האלה”, ואי
 * ‏אפשר לחבר בין אנשים בעילום שם — וגם אין להציע לסוכן לגשת ללקוח
 * ‏של עמיתו. הסינון לכן בשאילתה, ולא בעיטור התוצאה.
 */

const PRICE = 200_000_000;
/** ‏מיליון ₪ כל אחד: אף אחד לא מגיע לבד (הרצועה 400 אלף), יחד בדיוק. */
const HALF = 100_000_000;

const REQUIREMENTS = {
  cities: ["חולון"],
  neighborhoods: [],
  searchAreas: [],
  dealType: "sale",
  propertyTypes: ["apartment"],
  budgetMaxAgorot: HALF,
  roomsMin: 3.5,
  roomsMax: 4.5,
  features: {},
  sharedTabu: "accepts",
};

const PROPERTY_ROW = {
  id: "01PROP",
  tenantId: "01TENANT",
  city: "חולון",
  neighborhood: null,
  street: null,
  houseNumber: null,
  propertyType: "apartment",
  dealType: "sale",
  rooms: 4,
  areaSqm: 95,
  floor: null,
  totalFloors: null,
  hasElevator: null,
  hasParking: null,
  hasBalcony: null,
  hasSafeRoom: null,
  hasStorage: null,
  sharedTabu: true,
  condition: null,
  priceAgorot: BigInt(PRICE),
  priceFlexible: null,
  entryType: null,
  entryDate: null,
  entryNote: null,
  exclusive: null,
  exclusiveUntil: null,
  latitude: null,
  longitude: null,
  locationSource: null,
  attributes: null,
  status: "active",
  agentUserId: "01OTHER",
};

interface BuyerRow {
  id: string;
  contactId: string;
  ownerUserId: string | null;
  requirements: unknown;
}

const BUYERS: BuyerRow[] = [
  { id: "01MINE_A", contactId: "01C_A", ownerUserId: "01ME", requirements: REQUIREMENTS },
  { id: "01MINE_B", contactId: "01C_B", ownerUserId: "01ME", requirements: REQUIREMENTS },
  { id: "01THEIRS", contactId: "01C_T", ownerUserId: "01OTHER", requirements: REQUIREMENTS },
];

/**
 * ‏המסד המדומה **מכבד את ה-`where` שהקוד בונה**.
 *
 * ‏זו כל התוחלת של הבדיקה: פיקסצ׳ר שמחזיר את כל הקונים בלי להסתכל
 * ‏על התנאי היה מחזיר אותה תשובה לסוכן ולמנהל — כלומר לא בודק דבר.
 */
/** ‏השוואת תנאי בודד — `id: "x"` ו-`id: { in: [...] }` הן אותה שאלה. */
function conditionHolds(value: unknown, condition: unknown): boolean {
  if (condition !== null && typeof condition === "object" && "in" in condition) {
    return (condition as { in: unknown[] }).in.includes(value);
  }
  return value === condition;
}

function serviceFor(buyers: BuyerRow[], property = PROPERTY_ROW): MatchingService {
  const tx = {
    property: {
      /*
       * ‏שתי הקריאות בנתיב שואלות אחרת: הראשונה `id: "01PROP"`,
       * ‏השנייה `id: { in: [...] }` יחד עם רשימת הסטטוסים
       * ‏המשווקים. פיקסצ׳ר שמכיר רק את הצורה הראשונה היה מחזיר
       * ‏`null` בשנייה ומדווח „אין שותפויות” לכל נכס — כלומר עובר
       * ‏בירוק בלי לבדוק דבר.
       */
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const row = property as unknown as Record<string, unknown>;
        for (const [key, condition] of Object.entries(where)) {
          if (key === "deletedAt") continue;
          if (!conditionHolds(row[key], condition)) return null;
        }
        return property;
      },
    },
    buyer: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        const owner = where["ownerUserId"];
        return buyers.filter((b) => owner === undefined || b.ownerUserId === owner);
      },
    },
  };
  const prisma = { withTenant: async (fn: (t: unknown) => unknown) => fn(tx) };
  const contacts = {
    getByIds: async (_t: unknown, ids: string[]) =>
      new Map(ids.map((id) => [id, { id, name: `לקוח ${id}`, phone: "0500000000" }])),
  };
  return new MatchingService(
    prisma as never,
    { publish: async () => undefined } as never,
    contacts as never,
  );
}

function asUser<T>(capabilities: Capability[], fn: () => T): T {
  return TenantContext.run(
    { tenantId: "01TENANT", userId: "01ME", capabilities: new Set(capabilities), billingOnly: false },
    fn,
  );
}

describe("שידוך שותפים — גבול הראייה", () => {
  it("מנהל שרואה את כל הקונים מקבל גם צמד שחוצה שני סוכנים", async () => {
    const service = serviceFor(BUYERS);
    const pairs = await asUser(["matches.view", "buyers.view_all"], () =>
      service.partnersForProperty("01PROP"),
    );
    const ids = pairs.flatMap((p) => p.partners.map((x) => x.buyerId));
    expect(ids).toContain("01THEIRS");
    /* ‏שלושה קונים ⇒ שלושה צמדים */
    expect(pairs).toHaveLength(3);
  });

  it("סוכן בלי view_all אינו מקבל את הקונה של עמיתו — לא בשם ולא בשורה", async () => {
    const service = serviceFor(BUYERS);
    const pairs = await asUser(["matches.view", "buyers.view_own"], () =>
      service.partnersForProperty("01PROP"),
    );
    const ids = pairs.flatMap((p) => p.partners.map((x) => x.buyerId));
    expect(ids).not.toContain("01THEIRS");
    /* ‏רק שני הקונים שלו — צמד אחד */
    expect(pairs).toHaveLength(1);
    expect(ids.sort()).toEqual(["01MINE_A", "01MINE_B"]);
  });

  it("לסוכן עם קונה יחיד משלו אין למי לצרף אותו — ולא נשלף שותף זר", async () => {
    const service = serviceFor([BUYERS[0]!, BUYERS[2]!]);
    const pairs = await asUser(["matches.view", "buyers.view_own"], () =>
      service.partnersForProperty("01PROP"),
    );
    expect(pairs).toEqual([]);
  });

  it("נכס שנמכר אינו מזמין שותפויות — זו רשימת פעולות", async () => {
    const service = serviceFor(BUYERS, { ...PROPERTY_ROW, status: "sold" });
    const pairs = await asUser(["matches.view", "buyers.view_all"], () =>
      service.partnersForProperty("01PROP"),
    );
    expect(pairs).toEqual([]);
  });

  it("נכס שאינו בטאבו משותף אינו מזמין שותפויות", async () => {
    const service = serviceFor(BUYERS, { ...PROPERTY_ROW, sharedTabu: false });
    const pairs = await asUser(["matches.view", "buyers.view_all"], () =>
      service.partnersForProperty("01PROP"),
    );
    expect(pairs).toEqual([]);
  });

  it("נכס שאינו קיים אינו מפיל את הנתיב", async () => {
    const service = serviceFor(BUYERS);
    const pairs = await asUser(["matches.view", "buyers.view_all"], () =>
      service.partnersForProperty("01NOPE"),
    );
    expect(pairs).toEqual([]);
  });

  it("שני השותפים מוצגים בשמם, וחלקיהם מסתכמים במחיר", async () => {
    const service = serviceFor(BUYERS);
    const [pair] = await asUser(["matches.view", "buyers.view_own"], () =>
      service.partnersForProperty("01PROP"),
    );
    expect(pair).toBeDefined();
    for (const partner of pair!.partners) {
      expect(partner.buyerName).toMatch(/^לקוח /u);
    }
    const total = pair!.partners.reduce((sum, p) => sum + p.shareAgorot, 0);
    expect(total).toBe(PRICE);
  });
});

/**
 * ‏השאילתה עצמה — לא רק תוצאתה.
 *
 * ‏הבדיקות למעלה נופלות אם הסינון יוסר, אבל הן אינן אומרות **איפה**
 * ‏הוא צריך לשבת. סינון אחרי השליפה היה מספק אותן ובכל זאת היה
 * ‏מביא את הקונה של העמית אל תוך התהליך — ובתקרת המועמדים הוא היה
 * ‏גם דוחק החוצה קונים שכן מותר לראות.
 */
describe("שידוך שותפים — הסינון בשאילתה", () => {
  const source = readFileSync(join(__dirname, "matching.service.ts"), "utf8");
  const method = source.slice(source.indexOf("async partnersForProperty("));

  it("‏`ownershipFilter` יושב בתוך ה-`where` של שליפת הקונים", () => {
    const where = method.slice(method.indexOf("tx.buyer.findMany"), method.indexOf("orderBy"));
    expect(where).toContain('ownershipFilter("buyers.view_all", "ownerUserId")');
  });

  it("‏רק מי שאישר מראש נשלף — „טרם נשאל” אינו מועמד גם במסד", () => {
    expect(method).toContain('sharedTabuStance: "accepts"');
  });

  it("‏רצועת התקציב נגזרת מהמנוע ולא נכתבת כמספר", () => {
    expect(method).toContain('budgetBandAgorot(price, "sale")');
    expect(method).toContain("budgetMaxAgorot: { lt: BigInt(price - band) }");
  });
});
