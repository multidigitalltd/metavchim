import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PARTNER_CANDIDATE_MAX,
  PARTNER_CANDIDATE_ROW_CAP,
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
  /** ‏העמודה שהשאילתה ממיינת לפיה — לא רק השדה שב-`requirements`. */
  budgetMaxAgorot?: number;
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
      /*
       * ‎**הפיקסצ׳ר מכבד את ה-`where` שהקוד בונה** — שתי צורות:
       * ‏שליפת אנשי הקשר של הכרטיסים השמורים (`id: { in }`), ושליפת
       * ‏המועמדים עם ההוצאה לפי איש קשר (`contactId: { notIn }`).
       * ‏פיקסצ׳ר שמתעלם מאחת מהן היה ירוק על ההוצאה השבורה.
       */
      /*
       * ‎**וגם את הסדר, הסמן והתקרה** (ביקורת Codex, P2, סבב שלישי).
       *
       * ‏הסריקה מדפדפת עד שנבחנו מספיק **אנשים**, ופיקסצ׳ר שמתעלם
       * ‏מ-`take`/`cursor` היה מחזיר את כל הקונים בשאילתה הראשונה —
       * ‏כלומר עובר בירוק גם על המימוש הישן שהבאג היה בו.
       */
      findMany: async ({
        where,
        take,
        cursor,
        skip,
      }: {
        where: Record<string, unknown>;
        distinct?: string[];
        take?: number;
        cursor?: { id: string };
        skip?: number;
      }) => {
        const byIds = (where["id"] as { in?: string[] } | undefined)?.in;
        if (byIds !== undefined) return buyers.filter((b) => byIds.includes(b.id));
        const owner = where["ownerUserId"];
        const excludedContacts =
          (where["contactId"] as { notIn?: string[] } | undefined)?.notIn ?? [];
        const matched = buyers
          .filter(
            (b) =>
              (owner === undefined || b.ownerUserId === owner) &&
              !excludedContacts.includes(b.contactId),
          )
          /* ‏אותו סדר של השאילתה: תקציב יורד, ואז מזהה עולה */
          .sort(
            (a, b) =>
              (b.budgetMaxAgorot ?? HALF) - (a.budgetMaxAgorot ?? HALF) ||
              a.id.localeCompare(b.id),
          );
        const start =
          cursor === undefined
            ? 0
            : matched.findIndex((b) => b.id === cursor.id) + (skip ?? 0);
        const page = matched.slice(start);
        return take === undefined ? page : page.slice(0, take);
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
/**
 * ‏התנאי שנכנס לשליפת המועמדים — לפי שמו, `scanWhere`, ולא לפי
 * ‏„מה יושב בין שני ביטויים”.
 */
function scanWhereOf(method: string): string {
  const at = method.indexOf("const scanWhere = {");
  expect(at, "‏שליפת המועמדים כבר אינה נשענת על תנאי בשם `scanWhere`").toBeGreaterThan(0);
  const end = method.indexOf("\n      };", at);
  expect(end).toBeGreaterThan(at);
  return method.slice(at, end);
}

describe("שידוך שותפים — הסינון בשאילתה", () => {
  const source = readFileSync(join(__dirname, "matching.service.ts"), "utf8");
  const method = source.slice(source.indexOf("async partnersForProperty("));
  const scanWhere = scanWhereOf(method);

  /*
   * ‎**הפרוסה על התנאי בשמו, ולא על מיקומו.** הניסוח הקודם חתך
   * ‏מ-`tx.buyer.findMany` עד ה-`orderBy` הראשון — ובאותו מתודה יש
   * ‏שתי שליפות `buyer`, כך שהפרוסה הצביעה על השליפה של ההתאמות
   * ‏השמורות ועברה במקרה. שער שעובר במקרה אינו שער.
   */
  it("‏`ownershipFilter` יושב בתוך ה-`where` של שליפת הקונים", () => {
    expect(scanWhere).toContain('ownershipFilter("buyers.view_all", "ownerUserId")');
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

  /*
   * ‎**והוא מצטרף אליהם פעם אחת** (ביקורת Codex, P2, סבב מאוחר).
   *
   * ‏הניסוח הקודם ציפה לשתי שורות, אחת לכל כרטיס. אבל ההצעה כאן
   * ‏היא „חבר בין שני **האנשים** האלה”, ושתי שורות על אותם שני
   * ‏אנשים הן אותה הצעה פעמיים. וזה גם מה שהפך את תקרת המועמדים
   * ‏לבאג: כרטיסים כפולים נספרו אל תוכה לפני שהפסילה רצה.
   */
  it("אבל הוא מצטרף אליהם פעם אחת", async () => {
    const mixed: BuyerRow[] = [
      { id: "01CARD_A", contactId: "01SAME", ownerUserId: "01ME", requirements: REQUIREMENTS },
      { id: "01CARD_B", contactId: "01SAME", ownerUserId: "01ME", requirements: REQUIREMENTS },
      { id: "01OTHER_P", contactId: "01ELSE", ownerUserId: "01ME", requirements: REQUIREMENTS },
    ];
    const service = serviceFor(mixed);
    const pairs = await asUser(["matches.view", "buyers.view_own"], () =>
      service.partnersForProperty("01PROP"),
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.partners.map((p) => p.buyerId)).toContain("01OTHER_P");
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

  /*
   * ‎**וההוצאה נמדדת באדם, לא בכרטיס** (ביקורת Codex, P1, סבב שני).
   *
   * ‏שני התיקונים — „השורה השמורה גוברת” ו„שני כרטיסים אינם שני
   * ‏אנשים” — נכתבו במפתחות שונים. לאותו אדם עם שני כרטיסים,
   * ‏ההוצאה תפסה את הכרטיס שיש עליו התאמה שמורה, והשני נכנס
   * ‏לשידוך: אותו אדם בשתי המלצות סותרות על אותו מסך.
   */
  it("‏כרטיס שני של אותו אדם — גם הוא מוחרג", async () => {
    const twoCards: BuyerRow[] = [
      { id: "01CARD_A", contactId: "01SAME", ownerUserId: "01ME", requirements: REQUIREMENTS },
      { id: "01CARD_B", contactId: "01SAME", ownerUserId: "01ME", requirements: REQUIREMENTS },
      { id: "01PARTNER", contactId: "01ELSE", ownerUserId: "01ME", requirements: REQUIREMENTS },
    ];
    /* ‏ההתאמה השמורה יושבת על כרטיס א׳ בלבד */
    const service = serviceFor(twoCards, PROPERTY_ROW, ["01CARD_A"]);
    const pairs = await asUser(["matches.view", "buyers.view_own"], () =>
      service.partnersForProperty("01PROP"),
    );
    expect(pairs, "כרטיס ב׳ של אותו אדם נכנס לשידוך").toEqual([]);
  });

  /*
   * ‏והצד השני, שבלעדיו „להוציא את כולם” היה עובר: אדם אחר לגמרי
   * ‏עם שני כרטיסים משלו נשאר מועמד.
   */
  it("‏ואדם אחר עם שני כרטיסים נשאר מועמד", async () => {
    const twoCards: BuyerRow[] = [
      { id: "01CARD_A", contactId: "01SAME", ownerUserId: "01ME", requirements: REQUIREMENTS },
      { id: "01CARD_B", contactId: "01SAME", ownerUserId: "01ME", requirements: REQUIREMENTS },
      { id: "01PARTNER", contactId: "01ELSE", ownerUserId: "01ME", requirements: REQUIREMENTS },
    ];
    const service = serviceFor(twoCards, PROPERTY_ROW, []);
    const pairs = await asUser(["matches.view", "buyers.view_own"], () =>
      service.partnersForProperty("01PROP"),
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.partners.map((p) => p.buyerId)).toContain("01PARTNER");
  });
});

describe("‏מה שנשלף לפני התקרה", () => {
  const source = readFileSync(join(__dirname, "matching.service.ts"), "utf8");
  const method = source.slice(source.indexOf("async partnersForProperty("));
  const where = scanWhereOf(method);

  /*
   * ‏הטענה היא על **מפתח הזהות**, ולא על ביטוי מסוים: הניסוח
   * ‏הקודם נעץ `id: { notIn: durable.map(…) }`, וזה בדיוק החצי
   * ‏השבור — ההוצאה הייתה לפי כרטיס בזמן שהשידוך עובד על אנשים.
   * ‏שער שנעוץ בביטוי חוסם את התיקון של עצמו.
   */
  it("‏ההתאמות השמורות מוחרגות בשאילתה, ולפי איש הקשר", () => {
    expect(method).toContain('status: { notIn: ["suggested", "dismissed"] }');
    expect(where).toContain("contactId: { notIn:");
    expect(where, "ההוצאה עדיין לפי מזהה כרטיס").not.toContain("id: { notIn:");
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

/**
 * ‎**והסריקה סופרת אנשים, לא כרטיסים** (ביקורת Codex, P2, סבב שלישי).
 *
 * ‏`take` במסד סופר שורות, והניכוי לפי `contactId` רץ אחרי
 * ‏השאילתה. לקוח אחד עם `PARTNER_CANDIDATE_SCAN` כרטיסים כשירים
 * ‏ותקציב גבוה מילא את הסריקה בעצמו, ושני לקוחות שכן משלימים זה
 * ‏את זה נשארו מחוץ לחלון: „אין שותפויות” על משרד שיש לו.
 *
 * ‏זה בדיוק הבאג שכבר תוקן **בתוך** המנוע, שם `PARTNER_CANDIDATE_MAX`
 * ‏סופר זהויות — שכבה אחת למטה, במסד.
 */
describe("‏לקוח עם הרבה כרטיסים אינו ממלא את הסריקה", () => {
  const source = readFileSync(join(__dirname, "matching.service.ts"), "utf8");
  const method = source.slice(source.indexOf("async partnersForProperty("));

  /** ‏תקציב גבוה יותר — ולכן הכרטיסים שלו ראשונים בסדר. */
  const HOG_BUDGET = HALF + 1_000_000;
  const HOG: BuyerRow[] = Array.from({ length: PARTNER_CANDIDATE_SCAN }, (_, i) => ({
    id: `01HOG${String(i).padStart(4, "0")}`,
    contactId: "01C_HOG",
    ownerUserId: "01ME",
    budgetMaxAgorot: HOG_BUDGET,
    requirements: { ...REQUIREMENTS, budgetMaxAgorot: HOG_BUDGET },
  }));

  it("שני לקוחות מאוחרים יותר עדיין נמצאים", async () => {
    const service = serviceFor([...HOG, ...BUYERS]);
    const pairs = await asUser(["matches.view", "buyers.view_all"], () =>
      service.partnersForProperty("01PROP"),
    );
    const contactsInPairs = new Set(
      pairs.flatMap((pair) =>
        pair.partners.map((p) => (p.buyerId.startsWith("01HOG") ? "01C_HOG" : p.buyerId)),
      ),
    );
    /*
     * ‏עם `take` על שורות, הדף הראשון הוא כרטיסי הלקוח האחד בלבד —
     * ‏כל צירוף נפסל על אותה זהות, והתשובה הייתה רשימה ריקה.
     */
    expect(pairs.length).toBeGreaterThan(0);
    expect(contactsInPairs.has("01MINE_A"), "הלקוח שמעבר לדף הראשון נעדר").toBe(true);
    expect(contactsInPairs.has("01MINE_B")).toBe(true);
  });

  /*
   * ‏והצד השני: הדפדוף אינו אינסופי. `PARTNER_CANDIDATE_ROW_CAP`
   * ‏הוא הגבול העליון על העבודה, והוא כפולה של הסריקה — כלומר
   * ‏מספר דפים קבוע וקטן.
   */
  it("‏חסם השורות קיים, והוא כפולה של הסריקה", () => {
    expect(PARTNER_CANDIDATE_ROW_CAP).toBeGreaterThan(PARTNER_CANDIDATE_SCAN);
    expect(PARTNER_CANDIDATE_ROW_CAP % PARTNER_CANDIDATE_SCAN).toBe(0);
    expect(method).toContain("scanned < PARTNER_CANDIDATE_ROW_CAP");
    expect(method).toContain("seenContacts.size < PARTNER_CANDIDATE_SCAN");
  });
});
