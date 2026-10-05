import { describe, expect, it } from "vitest";
import type { Capability } from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import type { CryptoService } from "../../core/crypto.service";
import type { PrismaService } from "../../core/prisma.service";
import { SearchService } from "./search.service";

/**
 * ‎**חיפוש טלפון מדויק — הדלת האחורית שנשארה פתוחה.**
 *
 * ‏`visibleContactIds` הוסתר, כרטיס הנכס הוסתר, התיבה הוסתרה — ואז
 * ‏אפשר היה להקליד את המספר בשורת החיפוש ולקבל **שם וטלפון
 * ‏מפוענחים**. ענף הנכסים כאן היה משרדי לחלוטין, והשער שמעליו
 * ‏(„יש לו ישות גלויה, או שיש לו ראייה משרדית”) נבנה מעותק מקומי
 * ‏שידע לשאול על קונים ולידים בלבד (ביקורת Codex, P1).
 *
 * ‏מכאן שתי הטענות שהבדיקה הזו מחזיקה, והן חייבות לחיות יחד:
 * ‏הסוכן החסום מקבל „אין תוצאות”, **והמנהל ממשיך לקבל את הזהות**.
 * ‏שער שחוסם גם את המנהל אינו הידוק אלא תקלה.
 */

const TENANT = "01TENANTAAAAAAAAAAAAAAAAAA";
const AGENT = "01AGENTAAAAAAAAAAAAAAAAAAA";
const COLLEAGUE = "01COLLEAGUEAAAAAAAAAAAAAAA";
const MANAGER = "01MANAGERAAAAAAAAAAAAAAAAA";

const PHONE = "+972501234567";
const NAME = "רותי בעלת הדירה";
const PROPERTY = "01PROPAAAAAAAAAAAAAAAAAAAA";

/** ‏כל התפקידים כאן רואים את מודול הנכסים; מה שמשתנה הוא הראייה המשרדית. */
const AGENT_CAPS: Capability[] = ["properties.view", "buyers.view_own", "leads.view_own"];
const MANAGER_CAPS: Capability[] = [
  "properties.view",
  "properties.view_all",
  "buyers.view_all",
  "leads.view_all",
];
/**
 * ‏הצירוף שהעותק המקומי החמיץ: ראייה משרדית מלאה בקונים ובלידים,
 * ‏**בלי** הנכסים. זה בדיוק המשתמש שמנהל בחר לחסום ממנו את בעלי
 * ‏הנכסים — ובדיוק זה שנחשב „משרדי” בתנאי הישן.
 */
const PARTIAL_CAPS: Capability[] = [
  "properties.view",
  "buyers.view_all",
  "leads.view_all",
];

interface Fixture {
  /** ‏למי משויך הנכס שהלקוח מחובר אליו. */
  propertyAgentUserId: string;
  /** ‏בעלים או דייר — שתי שאלות שונות בשתי שאילתות שונות. */
  role?: "owner" | "occupant";
  /** ‏כרטיס קונה לאותו לקוח, ולמי הוא שייך; `null` = אין כרטיס. */
  buyerOwnerUserId?: string | null;
}

/**
 * ‎**המסד המדומה מכבד את ה-`where` שהקוד בונה.**
 *
 * ‏`ownershipFilter` מוסיף `agentUserId`/`ownerUserId` רק כשחסרה
 * ‏ה-`view_all` המתאימה. פיקסצ׳ר שמתעלם מה-`where` היה מחזיר את
 * ‏אותה תשובה לסוכן ולמנהל — כלומר לא בודק דבר.
 */
function prismaFor(fx: Fixture): PrismaService {
  const role = fx.role ?? "owner";
  const buyerOwner = fx.buyerOwnerUserId ?? null;
  const ownsProperty = (where: { agentUserId?: string }): boolean =>
    where.agentUserId === undefined || where.agentUserId === fx.propertyAgentUserId;
  const ownsBuyer = (where: { ownerUserId?: string }): boolean =>
    buyerOwner !== null && (where.ownerUserId === undefined || where.ownerUserId === buyerOwner);

  const tx = {
    contact: {
      findUnique: async () => ({
        id: "01CONTACTAAAAAAAAAAAAAAAAA",
        nameEncrypted: Buffer.from(NAME),
        phoneEncrypted: Buffer.from(PHONE),
      }),
    },
    property: {
      /*
       * ‎`canSeeContact` שואל `OR: [ownerContactId, occupantContactId]`,
       * ‏והחיפוש שואל `ownerContactId` בלבד. ההבדל הזה הוא בדיוק מה
       * ‏שהופך „יש לו ישות גלויה” לשאלה שחייבת להישאל שם ולא כאן,
       * ‏ולכן הפיקסצ׳ר מבחין בין השתיים.
       */
      findFirst: async (args: { where: { agentUserId?: string } }) =>
        ownsProperty(args.where) ? { id: PROPERTY } : null,
      findMany: async (args: { where: { agentUserId?: string } }) =>
        ownsProperty(args.where) && role === "owner"
          ? [
              {
                id: PROPERTY,
                city: "חיפה",
                street: "הנביאים",
                neighborhood: null,
                marketingTitle: null,
                status: "active",
              },
            ]
          : [],
    },
    buyer: {
      findFirst: async (args: { where: { ownerUserId?: string } }) =>
        ownsBuyer(args.where) ? { id: "01BUYERAAAAAAAAAAAAAAAAAAA" } : null,
      findMany: async (args: { where: { ownerUserId?: string } }) =>
        ownsBuyer(args.where)
          ? [{ id: "01BUYERAAAAAAAAAAAAAAAAAAA", maturity: "warm", cities: ["חיפה"] }]
          : [],
    },
    lead: { findFirst: async () => null, findMany: async () => [] },
    call: { findMany: async () => [] },
    $queryRaw: async () => [],
  };

  return {
    withTenant: async <T>(fn: (t: typeof tx) => Promise<T>): Promise<T> => fn(tx),
  } as unknown as PrismaService;
}

const crypto = {
  phoneHash: () => "hash",
  decrypt: (value: Buffer) => value.toString(),
} as unknown as CryptoService;

async function searchAs(
  userId: string,
  caps: Capability[],
  fx: Fixture,
): Promise<{
  contact?: { name: string; phone: string } | null;
  properties: unknown[];
  buyers: unknown[];
}> {
  const service = new SearchService(prismaFor(fx), crypto);
  return TenantContext.run(
    { tenantId: TENANT, userId, capabilities: new Set(caps), billingOnly: false },
    () => service.search(PHONE),
  );
}

describe("חיפוש לפי טלפון — בעל נכס של סוכן אחר", () => {
  it("הסוכן החסום מקבל אין-תוצאות, בלי שם ובלי טלפון", async () => {
    const result = await searchAs(AGENT, AGENT_CAPS, { propertyAgentUserId: COLLEAGUE });
    expect(result.contact ?? null).toBeNull();
    expect(result.properties).toEqual([]);
  });

  /*
   * ‏החצי השני של הדרישה — „וגם המנהל שלו”. בלעדיו כל שער שסוגר
   * ‏הכול היה עובר את הבדיקה הראשונה.
   */
  it("המנהל מקבל את הזהות ואת הנכס", async () => {
    const result = await searchAs(MANAGER, MANAGER_CAPS, { propertyAgentUserId: COLLEAGUE });
    expect(result.contact).toMatchObject({ name: NAME, phone: PHONE });
    expect(result.properties).toHaveLength(1);
  });

  /*
   * ‏וברירת המחדל אינה משנה דבר: `properties.view_all` ניתנת לכל
   * ‏תפקיד שיש לו `properties.view`, ולכן משרד שלא בחר לחסום ממשיך
   * ‏לעבוד כשעבד.
   */
  it("סוכן עם היכולת כברירת מחדל ממשיך לראות", async () => {
    const result = await searchAs(AGENT, [...AGENT_CAPS, "properties.view_all"], {
      propertyAgentUserId: COLLEAGUE,
    });
    expect(result.contact).toMatchObject({ name: NAME });
  });

  it("הנכס שלי נשאר שלי גם כשהיכולת חסומה", async () => {
    const result = await searchAs(AGENT, AGENT_CAPS, { propertyAgentUserId: AGENT });
    expect(result.contact).toMatchObject({ name: NAME });
    expect(result.properties).toHaveLength(1);
  });

  /*
   * ‎**„ראייה משרדית” כוללת גם את הנכסים — ארבע יכולות, לא שתיים.**
   *
   * ‏זה המשתמש שהתנאי הישן פספס: כל הקונים וכל הלידים, אבל המנהל
   * ‏חסם ממנו את בעלי הנכסים. „יש לו ראייה משרדית” היה נכון עליו,
   * ‏ולכן הוא קיבל את הזהות של בעל נכס שאינו שלו — בלי שאף ישות
   * ‏גלויה הצדיקה זאת.
   */
  it("ראייה משרדית חלקית אינה פותחת את הזהות", async () => {
    const result = await searchAs(MANAGER, PARTIAL_CAPS, { propertyAgentUserId: COLLEAGUE });
    expect(result.contact ?? null).toBeNull();
  });

  /*
   * ‎**דייר בנכס שלי — ולמה „יש לו ישות גלויה” אינו נספר מהרשימות.**
   *
   * ‏השאלה הזו נענתה קודם בספירת הקבוצות שכבר נשלפו, והשאילתה
   * ‏שלהן מחפשת `ownerContactId` בלבד. כלומר דייר בנכס **שלי** לא
   * ‏נספר, וחיפוש המספר שלו היה מחזיר לי „אין תוצאות” על מישהו
   * ‏שמותר לי לחלוטין. `canSeeContact` שואל את שני התפקידים.
   */
  it("דייר בנכס שלי מזוהה — גם כשהוא אינו הבעלים", async () => {
    const result = await searchAs(AGENT, AGENT_CAPS, {
      propertyAgentUserId: AGENT,
      role: "occupant",
    });
    expect(result.contact).toMatchObject({ name: NAME, phone: PHONE });
    expect(result.properties).toEqual([]);
  });

  it("ודייר בנכס של עמית נשאר חסום", async () => {
    const result = await searchAs(AGENT, AGENT_CAPS, {
      propertyAgentUserId: COLLEAGUE,
      role: "occupant",
    });
    expect(result.contact ?? null).toBeNull();
  });

  /*
   * ‎**הקבוצה עצמה מסוננת, ולא רק השער שמעליה.**
   *
   * ‏הלקוח הזה הוא הקונה **שלי**, ולכן הזהות שלו מותרת לי לחלוטין —
   * ‏השער נפתח, וכל מה שנשאר לשמור הוא הקישור בינו לבין הנכס של
   * ‏עמיתי. בלי הסינון על הקבוצה, הנכס ההוא היה מוצג כאן כ„הנכס
   * ‏שלו”, וזה בדיוק הקישור שהיכולת מגנה עליו בכרטיס הנכס.
   */
  it("לקוח שמותר לי דרך כרטיס קונה אינו גורר את הנכס של עמיתי", async () => {
    const result = await searchAs(AGENT, AGENT_CAPS, {
      propertyAgentUserId: COLLEAGUE,
      buyerOwnerUserId: AGENT,
    });
    expect(result.contact).toMatchObject({ name: NAME });
    expect(result.buyers).toHaveLength(1);
    expect(result.properties).toEqual([]);
  });
});
