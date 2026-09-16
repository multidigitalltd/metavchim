import { describe, expect, it } from "vitest";
import type { Capability } from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { ListingsService } from "./listings.service";

/**
 * ‎**נכסים מהרשת שמתאימים לקונה — לשונית ההתאמות בכרטיס הקונה.**
 *
 * ‏עד כה הלשונית הראתה רק מה ש**מישהו אחר** טרח לשלוח על הקונה הזה.
 * ‏מאות נכסים שמתאימים לו ישבו בפיד ולא הגיעו למקום שבו שואלים „מה
 * ‏יש בשביל הקונה הזה” (בקשת המשתמש).
 *
 * ‏שלוש ההכרעות שנבדקות כאן הן אלה שאם יישברו — לא ייראו שבורות:
 * ‏הנכסים שלי חוזרים פעמיים, קונה של עמית נחשף למי שאינו רשאי, או
 * ‏שכפתור „יש לי קונה” כבה בגלל פנייה שנשלחה בשם קונה אחר.
 */

const REQUIREMENTS = {
  cities: ["חולון"],
  neighborhoods: [],
  searchAreas: [],
  dealType: "sale",
  propertyTypes: ["apartment"],
  budgetMaxAgorot: 250_000_000,
  roomsMin: 3,
  roomsMax: 5,
  features: {},
  sharedTabu: "accepts",
};

function listing(over: { id: string; tenantId: string } & Record<string, unknown>) {
  return {
    city: "חולון",
    neighborhood: null,
    propertyType: "apartment",
    sharedTabu: false,
    dealType: "sale",
    rooms: 4,
    areaSqm: 95,
    floor: null,
    totalFloors: null,
    condition: null,
    priceAgorot: BigInt(235_000_000),
    entryType: null,
    entryDate: null,
    features: [],
    title: null,
    notes: null,
    photoKeys: [],
    latitude: null,
    longitude: null,
    status: "active",
    commissionSplit: 50,
    buyerSplit: null,
    buyerSplitNote: null,
    sellerSplit: null,
    sellerSplitNote: null,
    createdBy: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    originPropertyId: "01PROP",
    ...over,
  };
}

const MINE = listing({ id: "01MINE", tenantId: "01TENANT" });
const THEIRS = listing({ id: "01THEIRS", tenantId: "01OTHERTENANT" });
/** ‏מחוץ לתקציב ⇒ המנוע פוסל, ולכן אינו אמור להופיע כלל. */
const TOO_DEAR = listing({
  id: "01DEAR",
  tenantId: "01OTHERTENANT",
  priceAgorot: BigInt(900_000_000),
});

interface BuyerRow {
  id: string;
  contactId: string;
  ownerUserId: string | null;
  requirements: unknown;
}

const MY_BUYER: BuyerRow = {
  id: "01BUYER",
  contactId: "01CONTACT",
  ownerUserId: "01ME",
  requirements: REQUIREMENTS,
};
const COLLEAGUE_BUYER: BuyerRow = { ...MY_BUYER, id: "01HERS", ownerUserId: "01OTHER" };

/**
 * ‏המסד המדומה **מכבד את ה-`where` שהקוד בונה**. פיקסצ׳ר שמחזיר את
 * ‏כל השורות בלי להסתכל על התנאי היה מחזיר אותה תשובה לסוכן ולמנהל,
 * ‏ולנכס שלי ולנכס זר — כלומר לא בודק דבר.
 */
function serviceFor(options: {
  buyers: BuyerRow[];
  listings?: ReturnType<typeof listing>[];
  /** ‏פניות שכבר נשלחו — זוגות `listingId:buyerId`, כמו המפתח הייחודי. */
  interests?: string[];
}) {
  const rows = options.listings ?? [MINE, THEIRS];
  const interests = options.interests ?? [];

  const tx = {
    buyer: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        options.buyers.find(
          (b) =>
            b.id === where["id"] &&
            (where["ownerUserId"] === undefined || b.ownerUserId === where["ownerUserId"]),
        ) ?? null,
    },
    sharedListing: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        const not = (where["tenantId"] as { not?: string } | undefined)?.not;
        return rows.filter(
          (l) => l.status === where["status"] && (not === undefined || l.tenantId !== not),
        );
      },
    },
    coopInterest: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        const ids = (where["listingId"] as { in: string[] }).in;
        return interests
          .map((pair) => pair.split(":"))
          .filter(
            ([listingId, buyerId]) =>
              ids.includes(listingId!) && buyerId === where["buyerId"],
          )
          .map(([listingId]) => ({ listingId }));
      },
    },
    listingFollow: { findMany: async () => [] },
  };

  const prisma = {
    withTenant: async (fn: (t: unknown) => unknown) => fn(tx),
    withNetworkRead: async (fn: (t: unknown) => unknown) => fn(tx),
    tenant: { findMany: async () => [] },
  };
  const contacts = {
    getByIds: async (_t: unknown, ids: string[]) =>
      new Map(ids.map((id) => [id, { id, name: "דנה כהן", phone: "0500000000" }])),
  };
  return new ListingsService(
    prisma as never,
    { log: async () => undefined } as never,
    contacts as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

function asUser<T>(capabilities: Capability[], fn: () => T): T {
  return TenantContext.run(
    {
      tenantId: "01TENANT",
      userId: "01ME",
      capabilities: new Set(capabilities),
      billingOnly: false,
    },
    fn,
  );
}

describe("מה נכנס לרשימה", () => {
  /*
   * ‎**הנכסים שלי כבר יושבים בעמודה הפנימית של אותו כרטיס.** בלי
   * ‏הסינון אותו נכס מופיע פעמיים באותו מסך, ועוד עם כפתור „יש לי
   * ‏קונה לנכס הזה” שמוביל להצעה של המשרד לעצמו.
   */
  it("נכס של המשרד שלי אינו חוזר בהתאמות מהרשת", async () => {
    const service = serviceFor({ buyers: [MY_BUYER] });
    const out = await asUser(["collaboration.offer", "buyers.view_all"], () =>
      service.matchesForBuyer("01BUYER"),
    );
    expect(out.map((l) => l.id)).toEqual(["01THEIRS"]);
  });

  it("נכס שהמנוע פוסל אינו מוצג — זו התאמה, לא קטלוג", async () => {
    const service = serviceFor({ buyers: [MY_BUYER], listings: [TOO_DEAR] });
    const out = await asUser(["collaboration.offer", "buyers.view_all"], () =>
      service.matchesForBuyer("01BUYER"),
    );
    expect(out).toEqual([]);
  });

  it("הניקוד וההסבר חוזרים על הקונה שנשאל עליו", async () => {
    const service = serviceFor({ buyers: [MY_BUYER] });
    const [row] = await asUser(["collaboration.offer", "buyers.view_all"], () =>
      service.matchesForBuyer("01BUYER"),
    );
    expect(row?.myMatches).toHaveLength(1);
    expect(row?.myMatches?.[0]?.buyerId).toBe("01BUYER");
    expect(row?.myMatches?.[0]?.score).toBeGreaterThan(0);
  });
});

describe("גבול הראייה בתוך המשרד", () => {
  /*
   * ‎**נתיב שמקבל מזהה בכתובת הוא בדיוק המקום שבו ההפרדה נשברת.**
   * ‏סוכן עם `buyers.view_own` אינו רואה קונה של עמיתו בשום מסך;
   * ‏בלי `ownBuyersWhere` כאן הוא היה מקבל את הדרישות שלו, ולחיצה
   * ‏על „יש לי קונה” הייתה שולחת אותן למשרד אחר.
   */
  it("קונה של עמית — נדחה, ולא מוחזר בלי שם", async () => {
    const service = serviceFor({ buyers: [MY_BUYER, COLLEAGUE_BUYER] });
    await expect(
      asUser(["collaboration.offer", "buyers.view_own"], () =>
        service.matchesForBuyer("01HERS"),
      ),
    ).rejects.toThrow("קונה לא נמצא");
  });

  it("מנהל שרואה את כל הקונים מקבל גם את הקונה של עמיתו", async () => {
    const service = serviceFor({ buyers: [MY_BUYER, COLLEAGUE_BUYER] });
    const out = await asUser(["collaboration.offer", "buyers.view_all"], () =>
      service.matchesForBuyer("01HERS"),
    );
    expect(out.map((l) => l.id)).toEqual(["01THEIRS"]);
  });
});

describe("„הפנייה נשלחה” נספר לפי הקונה", () => {
  it("פנייה שנשלחה בשם הקונה הזה מסמנת את השורה", async () => {
    const service = serviceFor({
      buyers: [MY_BUYER],
      interests: ["01THEIRS:01BUYER"],
    });
    const [row] = await asUser(["collaboration.offer", "buyers.view_all"], () =>
      service.matchesForBuyer("01BUYER"),
    );
    expect(row?.interestSent).toBe(true);
  });

  /*
   * ‎**המפתח הייחודי הוא `(listingId, buyerId)`**, ולכן אפשר להציע
   * ‏את אותו נכס לקונה אחר. תשובה ברמת המשרד הייתה מכבה כפתור
   * ‏שהשרת דווקא מקבל — ומונעת עסקה בלי שום סיבה.
   */
  it("פנייה שנשלחה בשם קונה אחר אינה מכבה את הכפתור כאן", async () => {
    const service = serviceFor({
      buyers: [MY_BUYER],
      interests: ["01THEIRS:01SOMEONEELSE"],
    });
    const [row] = await asUser(["collaboration.offer", "buyers.view_all"], () =>
      service.matchesForBuyer("01BUYER"),
    );
    expect(row?.interestSent).toBe(false);
  });
});
