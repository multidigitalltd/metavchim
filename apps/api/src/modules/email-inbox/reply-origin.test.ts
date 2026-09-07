import { beforeAll, describe, expect, it } from "vitest";
import {
  contactOwnerCandidates,
  replyRecipient,
  type ContactOwnerSources,
} from "../../common/ownership";
import { EmailInboxService } from "./email-inbox.service";
import { actingUserId, TenantContext } from "../../common/tenant-context";

/**
 * ‎**לתשובה במייל יש הודעה קודמת, ולה יש שולח.**
 *
 * ‏כתובת ה-Reply-To זוהתה בלקוח בלבד, ולכן קליטת התשובה שאלה „מי
 * ‏אחראי על הלקוח הזה”. זו השאלה הנכונה לשיחה נכנסת שאיש לא יזם,
 * ‏והשגויה לתשובה: סוכן ב׳ שלח הסכם על נכס שלו ללקוח שגם לסוכן א׳
 * ‏יש עליו כרטיס קונה, „קונים” קודם ל„נכסים” בתור — וההתראה, ואיתה
 * ‏שם הלקוח ותמצית ההודעה, הגיעה לא׳.
 *
 * ‎**וזו העדפה ולא עקיפה:** המועמדות של השולח עוברת בדיוק את אותה
 * ‏בדיקת הרשאה. השער היחיד נשאר `notifiableContactOwnerSource`.
 */

const TENANT = "01TENANTAAAAAAAAAAAAAAAAAA";
const CONTACT = "01CONTACTAAAAAAAAAAAAAAAAA";
const AGENT_A = "01AGENTAAAAAAAAAAAAAAAAAAA";
const AGENT_B = "01AGENTBBBBBBBBBBBBBBBBBBB";
const BUYER_A = "01BUYERAAAAAAAAAAAAAAAAAAA";

/** ‏לקוח שיש עליו כרטיס קונה של א׳, ונכס שהסוכן שלו הוא ב׳. */
const SOURCES: ContactOwnerSources = {
  buyers: [{ id: BUYER_A, ownerUserId: AGENT_A }],
  leads: [],
  properties: [{ agentUserId: AGENT_B }],
};

describe("‏מי מקבל תשובה במייל", () => {
  it("בלי שולח — הסדר הרגיל, והקונה ראשון", () => {
    const [first] = contactOwnerCandidates(SOURCES);
    expect(first?.userId).toBe(AGENT_A);
    expect(first?.source).toBe("buyers");
  });

  it("‏עם שולח — הוא בראש התור, גם כשמקורו אחרון", () => {
    const [first] = contactOwnerCandidates(SOURCES, AGENT_B);
    expect(first?.userId).toBe(AGENT_B);
    expect(first?.source).toBe("properties");
  });

  /*
   * ‏העדפה אינה סינון: מי שנפסל בבדיקת ההרשאה חייב להוריש את התור
   * ‏לשאר, ולכן כולם נשארים ברשימה ובסדר היחסי שלהם.
   */
  it("‏והשאר נשארים אחריו, בסדר שלהם", () => {
    const ordered = contactOwnerCandidates(SOURCES, AGENT_B);
    expect(ordered.map((candidate) => candidate.userId)).toEqual([AGENT_B, AGENT_A]);
  });

  it("‏שולח שאינו מועמד כלל אינו משנה דבר", () => {
    const ordered = contactOwnerCandidates(SOURCES, "01STRANGERAAAAAAAAAAAAAAAA");
    expect(ordered.map((candidate) => candidate.userId)).toEqual([AGENT_A, AGENT_B]);
  });

  /* ‏טוקן ותיק מלפני השדה — `null`, וזה בדיוק הסדר הרגיל */
  it("‏טוקן בלי שולח מתנהג כמו קודם", () => {
    expect(contactOwnerCandidates(SOURCES, null)).toEqual(contactOwnerCandidates(SOURCES));
  });

  /*
   * ‏שולח שיש לו **שני** מקורות עולה בשניהם, ובסדר היחסי שלהם —
   * ‏אחרת „דרך איזה מקור” הייתה נענית אחרת מבלי שאיש ביקש.
   */
  it("‏שולח בשני מקורות עולה בשניהם, בסדר שלו", () => {
    const ordered = contactOwnerCandidates(
      {
        buyers: [{ id: "01BUYERBBBBBBBBBBBBBBBBBBB", ownerUserId: AGENT_A }],
        leads: [{ id: "01LEADBBBBBBBBBBBBBBBBBBBB", assignedToUserId: AGENT_B }],
        properties: [{ agentUserId: AGENT_B }],
      },
      AGENT_B,
    );
    expect(ordered.map((candidate) => candidate.source)).toEqual([
      "leads",
      "properties",
      "buyers",
    ]);
  });
});

/**
 * ‎**ומהמסד ועד הנמען — דרך בדיקת ההרשאה האמיתית.**
 *
 * ‏הבדיקות שמעל הן על התור בלבד. כאן נשאלת השאלה השלמה שהתיבה
 * ‏שואלת בפועל: שלושת המקורות נטענים, היכולות של המשרד נקראות,
 * ‏והמועמד הראשון שרשאי הוא הנמען. הפיקסצ׳ר מכבד את ה-`where`
 * ‏שהקוד בונה — פיקסצ׳ר שמחזיר אותה תשובה לכל שאילתה אינו בודק
 * ‏דבר.
 */
type Override = { capability: string; effect: string; expiresAt: Date | null };
type FakeUser = { id: string; role: string; overrides?: Override[] };

function txFor(users: FakeUser[], sources: ContactOwnerSources) {
  const rows = <T>(list: readonly T[], tenantId: string): T[] =>
    tenantId === TENANT ? [...list] : [];
  return {
    tenant: {
      findUnique: async (args: { where: { id: string } }) =>
        args.where.id === TENANT ? { blockedModules: [] } : null,
    },
    user: {
      findMany: async (args: { where: { tenantId: string; id?: { in: string[] } } }) =>
        users
          .filter(
            (user) =>
              args.where.tenantId === TENANT &&
              (args.where.id === undefined || args.where.id.in.includes(user.id)),
          )
          .map((user) => ({
            id: user.id,
            role: user.role,
            capabilityOverrides: user.overrides ?? [],
          })),
    },
    buyer: {
      findMany: async (args: { where: { tenantId: string; contactId: string } }) =>
        args.where.contactId === CONTACT ? rows(sources.buyers, args.where.tenantId) : [],
    },
    lead: {
      findMany: async (args: { where: { tenantId: string; contactId: string } }) =>
        args.where.contactId === CONTACT ? rows(sources.leads, args.where.tenantId) : [],
    },
    property: {
      findMany: async (args: { where: { tenantId: string } }) =>
        rows(sources.properties, args.where.tenantId),
    },
  } as never;
}

/* ‏שני סוכנים בתפקיד המובנה — כל אחד רואה את שלו בלבד */
const OFFICE: FakeUser[] = [
  { id: AGENT_A, role: "agent" },
  { id: AGENT_B, role: "agent" },
];

describe("‏השאלה השלמה: מהמסד עד הנמען", () => {
  it("‏תשובה להודעה של ב׳ מגיעה לב׳, ודרך הנכס שלו", async () => {
    const owner = await replyRecipient(txFor(OFFICE, SOURCES), TENANT, CONTACT, AGENT_B);
    expect(owner?.userId).toBe(AGENT_B);
    expect(owner?.source).toBe("properties");
  });

  /* ‏וזו בדיוק הדליפה שנסגרה: בלי השולח, א׳ היה מקבל אותה */
  it("‏ובלי השולח היא הייתה מגיעה לא׳", async () => {
    const owner = await replyRecipient(txFor(OFFICE, SOURCES), TENANT, CONTACT, null);
    expect(owner?.userId).toBe(AGENT_A);
  });

  /*
   * ‎**העדפה אינה עקיפה.** ב׳ בלי יכולת הנכסים נפסל בדיוק כמו כל
   * ‏מועמד אחר, והתור ממשיך לא׳ — אחרת „ראש התור” היה הופך לשער
   * ‏שני שאיש לא ביקש.
   */
  it("‏שולח שאינו רשאי לראות את הלקוח מוריש את התור", async () => {
    const blocked: FakeUser = {
      id: AGENT_B,
      role: "agent",
      overrides: [{ capability: "properties.view", effect: "deny", expiresAt: null }],
    };
    const owner = await replyRecipient(
      txFor([{ id: AGENT_A, role: "agent" }, blocked], SOURCES),
      TENANT,
      CONTACT,
      AGENT_B,
    );
    expect(owner?.userId).toBe(AGENT_A);
  });
});

/**
 * ‎**והשולח הוא חלק מזהות הטוקן, לא תיעוד לצדו.**
 *
 * ‏השימוש החוזר היה על הלקוח בלבד: טוקן שסוכן ב׳ הנפיק שימש גם
 * ‏לשליחה של סוכן א׳, ואז תשובה על ההודעה של א׳ נשאה את השולח של
 * ‏ב׳ — כלומר השדה היה מתאר את השליחה הראשונה בלבד.
 */
describe("‏הטוקן נבחר לפי הלקוח **והשולח**", () => {
  /*
   * ‏`inboundConfig` קורא את הסביבה לפני שהוא פונה להגדרות
   * ‏הפלטפורמה. ערכים מזויפים בכוונה — הבדיקה אינה נוגעת ברשת
   * ‏ואינה נוגעת במסד.
   */
  beforeAll(() => {
    process.env["WEB_ORIGIN"] ??= "https://test.invalid";
    process.env["DATABASE_URL"] ??= "postgresql://t:t@localhost:5432/t";
    process.env["DIRECT_DATABASE_URL"] ??= "postgresql://t:t@localhost:5432/t";
    process.env["REDIS_URL"] ??= "redis://localhost:6379";
    process.env["DATA_ENCRYPTION_KEY"] ??= "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    process.env["PHONE_HASH_KEY"] ??= "test-phone-hash-key-not-a-real-secret-0000";
  });

  interface TokenRow {
    id: string;
    tenantId: string;
    contactId: string;
    sentByUserId: string | null;
  }

  /** ‏טבלת הטוקנים בזיכרון — עם ה-`where` שהקוד באמת בונה. */
  function serviceWithTokens(): { service: EmailInboxService; rows: TokenRow[] } {
    const rows: TokenRow[] = [];
    const prisma = {
      emailReplyToken: {
        findFirst: async (args: { where: Partial<TokenRow> }) =>
          rows.find((row) =>
            Object.entries(args.where).every(
              ([key, value]) => row[key as keyof TokenRow] === value,
            ),
          ) ?? null,
        create: async (args: { data: TokenRow }) => {
          rows.push(args.data);
          return args.data;
        },
      },
    };
    const platformSettings = {
      get: async (key: string) =>
        key === "emailInboundAddress"
          ? "reply@mail.example.com"
          : key === "emailInboundSecret"
            ? "s3cret"
            : undefined,
    };
    const service = new EmailInboxService(
      prisma as never,
      undefined as never,
      undefined as never,
      platformSettings as never,
      undefined as never,
      undefined as never,
      undefined as never,
    );
    return { service, rows };
  }

  it("‏כל שולח מקבל טוקן משלו על אותו לקוח", async () => {
    const { service, rows } = serviceWithTokens();
    const forB = await service.replyAddressFor(TENANT, CONTACT, AGENT_B);
    const forA = await service.replyAddressFor(TENANT, CONTACT, AGENT_A);
    expect(forB).not.toBe(forA);
    expect(rows.map((row) => row.sentByUserId)).toEqual([AGENT_B, AGENT_A]);
  });

  it("‏ואותו שולח מקבל את הטוקן שלו בחזרה", async () => {
    const { service, rows } = serviceWithTokens();
    const first = await service.replyAddressFor(TENANT, CONTACT, AGENT_B);
    await service.replyAddressFor(TENANT, CONTACT, AGENT_A);
    expect(await service.replyAddressFor(TENANT, CONTACT, AGENT_B)).toBe(first);
    expect(rows).toHaveLength(2);
  });

  /* ‏שליחה אוטומטית אין לה סוכן, ולכן גם לה טוקן משלה */
  it("‏ושליחה בלי סוכן אינה יורשת טוקן של אדם", async () => {
    const { service, rows } = serviceWithTokens();
    await service.replyAddressFor(TENANT, CONTACT, AGENT_B);
    const auto = await service.replyAddressFor(TENANT, CONTACT, null);
    expect(auto).not.toBe(await service.replyAddressFor(TENANT, CONTACT, AGENT_B));
    expect(rows.filter((row) => row.sentByUserId === null)).toHaveLength(1);
  });
});

/**
 * ‎**„מי שלח” אינו „איזה משתמש בהקשר”.**
 *
 * ‏`TenantContext.run` נקרא גם עם הקשר משרדי שאין לו אדם — טופס
 * ‏ציבורי, סבב רקע — ושם `userId` הוא **מחרוזת ריקה**. `?? null`
 * ‏אינו תופס אותה, ולכן היא הייתה נכתבת לעמודה כאילו היא מזהה:
 * ‏שורת טוקן לכל לקוח שאיש לעולם לא ימצא בחזרה.
 */
describe("‏מי מבצע את הפעולה", () => {
  const ctx = (userId: string) => ({
    tenantId: TENANT,
    userId,
    capabilities: new Set<never>(),
    billingOnly: false,
  });

  it("‏סוכן אמיתי — המזהה שלו", () => {
    expect(TenantContext.run(ctx(AGENT_B) as never, actingUserId)).toBe(AGENT_B);
  });

  it("‏הקשר משרדי בלי אדם — `null` ולא מחרוזת ריקה", () => {
    expect(TenantContext.run(ctx("") as never, actingUserId)).toBeNull();
  });

  /* ‏וובהוק של ספק הדואר אין לו הקשר כלל — תשובה, לא חריגה */
  it("‏בלי הקשר — `null` ולא חריגה", () => {
    expect(actingUserId()).toBeNull();
  });
});
