import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PARTNER_CANDIDATE_MAX,
  PARTNER_CANDIDATE_SCAN,
  type Capability,
} from "@metavchim/shared";
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

function serviceFor(
  buyers: BuyerRow[],
  property = PROPERTY_ROW,
  durable: string[] = [],
): MatchingService {
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
        const excluded = (where["id"] as { notIn?: string[] } | undefined)?.notIn ?? [];
        return buyers.filter(
          (b) =>
            (owner === undefined || b.ownerUserId === owner) && !excluded.includes(b.id),
        );
      },
    },
    match: {
      findMany: async () => durable.map((buyerId) => ({ buyerId })),
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

describe("שידוך שותפים — שער מודול הקונים", () => {
  /*
   * ‎**`ownershipFilter` הוא צמצום ולא שער** (ביקורת Codex, P1).
   *
   * ‏בלי `view_all` הוא מחזיר „הקונים שלי”, וזה נראה בטוח — אבל
   * ‏למי שהמודול חסום אצלו לגמרי הוא עדיין מחזיר את הקונים שלו,
   * ‏על שם, תקציב וציון. הנתיב דורש `matches.view` בלבד.
   */
  it("מי שאין לו יכולת לראות קונים כלל נדחה — ולא מקבל רשימה ריקה", async () => {
    const service = serviceFor(BUYERS);
    await expect(
      asUser(["matches.view"], () => service.partnersForProperty("01PROP")),
    ).rejects.toThrow(/מודול הקונים חסום/u);
  });

  it("‏`view_own` לבדה מספיקה", async () => {
    const service = serviceFor(BUYERS);
    await expect(
      asUser(["matches.view", "buyers.view_own"], () => service.partnersForProperty("01PROP")),
    ).resolves.toHaveLength(1);
  });

  it("וגם `view_all` לבדה", async () => {
    const service = serviceFor(BUYERS);
    await expect(
      asUser(["matches.view", "buyers.view_all"], () => service.partnersForProperty("01PROP")),
    ).resolves.toHaveLength(3);
  });
});

describe("שידוך שותפים — אדם אחד אינו שותפות", () => {
  /*
   * ‎**שני כרטיסים על אותו איש קשר אינם שני אנשים** (ביקורת Codex, P1).
   * ‏שארית מיזוג, או שתי דרישות של אותו אדם — צמד כזה מכפיל את כוח
   * ‏הקנייה של אדם אחד, ונשמע מצוין עד השיחה הראשונה.
   */
  it("שני כרטיסים של אותו לקוח אינם מצטרפים לצמד", async () => {
    const sameContact: BuyerRow[] = [
      { id: "01CARD_A", contactId: "01SAME", ownerUserId: "01ME", requirements: REQUIREMENTS },
      { id: "01CARD_B", contactId: "01SAME", ownerUserId: "01ME", requirements: REQUIREMENTS },
    ];
    const service = serviceFor(sameContact);
    const pairs = await asUser(["matches.view", "buyers.view_own"], () =>
      service.partnersForProperty("01PROP"),
    );
    expect(pairs).toEqual([]);
  });

  it("אבל כל אחד מהם עדיין מצטרף לאדם אחר", async () => {
    const mixed: BuyerRow[] = [
      { id: "01CARD_A", contactId: "01SAME", ownerUserId: "01ME", requirements: REQUIREMENTS },
      { id: "01CARD_B", contactId: "01SAME", ownerUserId: "01ME", requirements: REQUIREMENTS },
      { id: "01OTHER_P", contactId: "01ELSE", ownerUserId: "01ME", requirements: REQUIREMENTS },
    ];
    const service = serviceFor(mixed);
    const pairs = await asUser(["matches.view", "buyers.view_own"], () =>
      service.partnersForProperty("01PROP"),
    );
    expect(pairs).toHaveLength(2);
    for (const pair of pairs) {
      expect(pair.partners.map((p) => p.buyerId)).toContain("01OTHER_P");
    }
  });
});

describe("שידוך שותפים — זרות מהרשימה הרגילה", () => {
  /*
   * ‎**התאמה שכבר הוצעה אינה נמחקת** (ביקורת Codex, P1).
   * ‏`upsertMatch` מוחק `suggested` בלבד, ולכן קונה שהתקציב שלו ירד
   * ‏נשאר עם שורת `offered` חיה — ובלי החרגה כאן היה מופיע גם כאן
   * ‏וגם שם, בשתי המלצות סותרות.
   */
  it("קונה עם התאמה שמורה על הנכס אינו מוצע כשותף", async () => {
    const service = serviceFor(BUYERS, PROPERTY_ROW, ["01MINE_A"]);
    const pairs = await asUser(["matches.view", "buyers.view_own"], () =>
      service.partnersForProperty("01PROP"),
    );
    expect(pairs).toEqual([]);
  });
});

describe("‏מה שנשלף לפני התקרה", () => {
  const source = readFileSync(join(__dirname, "matching.service.ts"), "utf8");
  const method = source.slice(source.indexOf("async partnersForProperty("));
  const where = method.slice(method.indexOf("tx.buyer.findMany"), method.indexOf("orderBy"));

  it("‏ההתאמות השמורות מוחרגות בשאילתה, לא אחריה", () => {
    expect(method).toContain('status: { notIn: ["suggested", "dismissed"] }');
    expect(where).toContain("id: { notIn: durable.map((row) => row.buyerId) }");
  });

  it("‏והסינון הגס לפי עיר קודם לתקרה", () => {
    /* ‏אחרת שישים קונים מעיר אחרת ממלאים אותה ומסתירים צמד תקין */
    expect(where).toContain("cities: { hasSome: cityVariants }");
    expect(where).toContain("cities: { isEmpty: true }");
    expect(where).toContain("hasSearchAreas: true");
    expect(where.indexOf("cities: { hasSome")).toBeLessThan(where.length);
    expect(method.indexOf("cityVariants")).toBeLessThan(method.indexOf("take: PARTNER_CANDIDATE_SCAN"));
  });

  /*
   * ‎**והשאילתה נסרקת, לא נחתכת בתקרת המועמדים** (ביקורת Codex,
   * ‏P2, סבב שני).
   *
   * ‏הסינון הגס ב-SQL מכסה עמדה, תקציב, סוג עסקה ועיר — אבל לא סוג
   * ‏נכס, לא חדרים ולא תכונות. כל עוד ה-`take` היה
   * ‏`PARTNER_CANDIDATE_MAX`, שישים קונים בעיר הנכונה שמחפשים בית
   * ‏פרטי מילאו אותו, נפלו כולם במנוע, והמסך אמר „אין שותפויות”.
   *
   * ‏התקרה על המועמדים **שהתקבלו** נאכפת בתוך `partnerPairs`, ולכן
   * ‏השאילתה כאן חייבת להביא יותר ממנה — אחרת יש רק חסם אחד, על
   * ‏שורות שאיש לא בדק.
   */
  it("‏התקרה בשאילתה היא סריקה, וגדולה מתקרת המועמדים", () => {
    expect(method).toContain("take: PARTNER_CANDIDATE_SCAN");
    expect(method).not.toContain("take: PARTNER_CANDIDATE_MAX");
    expect(PARTNER_CANDIDATE_SCAN).toBeGreaterThan(PARTNER_CANDIDATE_MAX);
  });
});
