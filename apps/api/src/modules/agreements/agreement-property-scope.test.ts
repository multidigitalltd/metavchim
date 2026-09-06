import { beforeAll, describe, expect, it } from "vitest";
import type { Capability } from "@metavchim/shared";
import { assertPropertyRecordScope } from "../../common/ownership";
import { TenantContext } from "../../common/tenant-context";
import { AgreementsService } from "./agreements.service";
import { SignedDocumentsService } from "./signed-documents.service";

/**
 * ‎**הסכם על נכס — הלקוח *וגם* הנכס.**
 *
 * ‏`assertContactAccess` הוא איחוד מקורות, והוא נכון לשאלה שהוא
 * ‏נשאל: „מותר לי לראות את האדם הזה”. אבל הסכם וסריקה חתומה נושאים
 * ‏גם `propertyId`, ואת השאלה הזו הוא אינו נשאל.
 *
 * ‏התרחיש רגיל לגמרי: לקוח שקונה דרכי ומוכר דרך עמית. שער הלקוח
 * ‏נפתח דרך כרטיס הקונה **שלי**, ומשם יכולתי להפיק הסכם **בלעדיות
 * ‏על הנכס של העמית**, לשלוח אותו לחתימה, ולפתוח את המסמך החתום שלו
 * ‏— עם שם החותם, מספר הזהות, החתימה וה-IP (ביקורת Codex, P1).
 */

/*
 * ‏בניית הקישור הציבורי קוראת ל-`loadEnv()` ודורשת תצורה שלמה.
 * ‏הערכים מזויפים ובכוונה — הבדיקה אינה נוגעת ברשת ואינה נוגעת במסד.
 */
beforeAll(() => {
  process.env["WEB_ORIGIN"] ??= "https://test.invalid";
  process.env["DATABASE_URL"] ??= "postgresql://t:t@localhost:5432/t";
  process.env["DIRECT_DATABASE_URL"] ??= "postgresql://t:t@localhost:5432/t";
  process.env["REDIS_URL"] ??= "redis://localhost:6379";
  process.env["DATA_ENCRYPTION_KEY"] ??= "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  process.env["PHONE_HASH_KEY"] ??= "test-phone-hash-key-not-a-real-secret-0000";
});

const TENANT = "01TENANTAAAAAAAAAAAAAAAAAA";
const ME = "01MEAAAAAAAAAAAAAAAAAAAAAA";
const OTHER = "01OTHERAAAAAAAAAAAAAAAAAAA";
/** ‏הלקוח שקונה דרכי ומוכר דרך העמית — ולכן שער הלקוח נפתח עליו. */
const SHARED = "01SHAREDCONTACT0000000001";
const PROP = "01PROPAAAAAAAAAAAAAAAAAAAA";
const MINE = "01PROPMINEAAAAAAAAAAAAAAAA";

/** ‏סוכן מוגבל: מודול הנכסים פתוח, אבל לא כל נכסי המשרד. */
const SCOPED: Capability[] = ["properties.view", "buyers.view_own", "leads.view_own"];
/** ‏ברירת המחדל של כל תפקיד קיים — ולכן חייבת להישאר כשהייתה. */
const DEFAULT: Capability[] = [...SCOPED, "properties.view_all"];

const PROPERTIES: Record<string, { agentUserId: string | null }> = {
  [PROP]: { agentUserId: OTHER },
  [MINE]: { agentUserId: ME },
};

interface AgreementRow {
  id: string;
  kind: string;
  contactId: string | null;
  propertyId: string | null;
  status: string;
  publicToken: string;
}

function txFor(agreements: AgreementRow[]): Record<string, unknown> {
  return {
    /* ‏כרטיס הקונה שלי על אותו אדם — זה מה שפותח את שער הלקוח */
    buyer: {
      findFirst: async () => ({ id: "01MYBUYER" }),
      findMany: async () => [{ contactId: SHARED }],
    },
    lead: { findFirst: async () => null, findMany: async () => [] },
    contactLink: { findFirst: async () => null },
    property: {
      findFirst: async ({ where }: { where: { id?: string; agentUserId?: string } }) => {
        const row = where.id === undefined ? undefined : PROPERTIES[where.id];
        if (row === undefined) return null;
        if (where.agentUserId !== undefined && where.agentUserId !== row.agentUserId) return null;
        return { id: where.id, agentUserId: row.agentUserId, city: "רעננה", street: "אחוזה" };
      },
      findMany: async ({ where }: { where: { id?: { in: string[] }; agentUserId?: string } }) =>
        (where.id?.in ?? [])
          .filter((id) => PROPERTIES[id] !== undefined)
          .filter(
            (id) => where.agentUserId === undefined || PROPERTIES[id]?.agentUserId === where.agentUserId,
          )
          .map((id) => ({ id, city: "רעננה", street: "אחוזה", neighborhood: null })),
    },
    agreement: {
      findFirst: async ({ where }: { where: { id: string } }) =>
        agreements.find((row) => row.id === where.id) ?? null,
      findMany: async () => agreements,
      updateMany: async () => ({ count: 0 }),
    },
  };
}

function agreementsService(rows: AgreementRow[]): AgreementsService {
  const prisma = {
    withTenant: async <T>(fn: (t: unknown) => Promise<T>): Promise<T> => fn(txFor(rows)),
    tenant: { findUnique: async () => ({ name: "משרד הבדיקה", settings: {} }) },
  };
  const contacts = {
    getById: async () => ({ id: SHARED, name: "בעל הנכס", phone: "+972501234567" }),
    getByIds: async () => new Map([[SHARED, { name: "בעל הנכס" }]]),
  };
  return new AgreementsService(
    prisma as never,
    contacts as never,
    { record: async () => undefined } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

function asUser<T>(capabilities: Capability[], fn: () => T): T {
  return TenantContext.run(
    { tenantId: TENANT, userId: ME, capabilities: new Set(capabilities), billingOnly: false },
    fn,
  );
}

const OTHERS: AgreementRow = {
  id: "01AGREEMENTOTHERS00000001",
  kind: "exclusivity",
  contactId: SHARED,
  propertyId: PROP,
  status: "pending",
  publicToken: "tok-others",
};
const OFFICE: AgreementRow = {
  id: "01AGREEMENTOFFICE00000001",
  kind: "brokerage",
  contactId: SHARED,
  propertyId: null,
  status: "pending",
  publicToken: "tok-office",
};

describe("הסכם על הנכס של עמית — הלקוח לבדו אינו מספיק", () => {
  it("הפקה נדחית", async () => {
    const service = agreementsService([]);
    await expect(
      asUser(SCOPED, () =>
        service.create(txFor([]) as never, {
          kind: "exclusivity",
          contactId: SHARED,
          propertyId: PROP,
        }),
      ),
    ).rejects.toThrow(/סוכן אחר/u);
  });

  it("שליחה לחתימה נדחית — והיא זו שמוציאה את הקישור", async () => {
    const service = agreementsService([OTHERS]);
    await expect(
      asUser(SCOPED, () => service.deliver(txFor([OTHERS]) as never, OTHERS.id, "whatsapp")),
    ).rejects.toThrow(/סוכן אחר/u);
  });

  /*
   * ‏הרשימה נושאת `url` נושא־טוקן לכל שורה. שער שחוסם את השליחה
   * ‏ומשאיר את הקישור ברשימה אינו חוסם דבר.
   */
  it("והרשימה אינה מחזירה את הקישור שלו", async () => {
    const service = agreementsService([OTHERS, OFFICE]);
    const rows = await asUser(SCOPED, () =>
      service.listForContact(txFor([OTHERS, OFFICE]) as never, SHARED),
    );
    expect(rows.map((row) => row.id)).toEqual([OFFICE.id]);
  });

  /*
   * ‏הצד השני של השער עצמו: הסכם ברמת המשרד — בלי נכס — נשאר על
   * ‏שער הלקוח בלבד, ונכס שנמחק מתחת לרשומה אינו חוסם. בלי שני
   * ‏אלה השער היה „חוסם הכול”, וזו אינה הפרדה אלא תקלה.
   */
  it("הסכם בלי נכס עובר, וגם רשומה שהנכס שלה נמחק", async () => {
    for (const propertyId of [null, "01PROPGONEAAAAAAAAAAAAAAAA"]) {
      await expect(
        asUser(SCOPED, () =>
          assertPropertyRecordScope(
            txFor([]) as never,
            TENANT,
            { contactId: SHARED, propertyId },
            "בדיקה",
          ),
        ),
      ).resolves.toBeUndefined();
    }
  });

  /*
   * ‏ומודול נכסים חסום אינו נפתח דרך כרטיס הקונה: זה הענף שהאיחוד
   * ‏הסתיר, כי הלקוח באמת נגיש לי — רק לא בהקשר הנכס.
   */
  it("ומודול נכסים חסום נדחה גם על הנכס שלי", async () => {
    await expect(
      asUser(["buyers.view_own", "leads.view_own"], () =>
        assertPropertyRecordScope(
          txFor([]) as never,
          TENANT,
          { contactId: SHARED, propertyId: MINE },
          "בדיקה",
        ),
      ),
    ).rejects.toThrow(/מודול הנכסים חסום/u);
  });

  it("והנכס שלי עובר", async () => {
    const mine: AgreementRow = { ...OTHERS, propertyId: MINE };
    const service = agreementsService([mine]);
    const rows = await asUser(SCOPED, () => service.listForContact(txFor([mine]) as never, SHARED));
    expect(rows.map((row) => row.id)).toEqual([mine.id]);
  });

  it("ברירת המחדל אינה משנה דבר", async () => {
    const service = agreementsService([OTHERS, OFFICE]);
    const rows = await asUser(DEFAULT, () =>
      service.listForContact(txFor([OTHERS, OFFICE]) as never, SHARED),
    );
    expect(rows.map((row) => row.id)).toEqual([OTHERS.id, OFFICE.id]);
  });
});

/**
 * ‎**ואותו כלל על הסריקות.** מסמך חתום שהוצמד לנכס נושא את שם
 * ‏החותם ואת הקובץ עצמו; הרשימה שלו נושאת גם כפתור מחיקה.
 */
describe("סריקה שהוצמדה לנכס של עמית", () => {
  interface DocRow {
    id: string;
    contactId: string | null;
    propertyId: string | null;
    kind: string;
    s3Key: string;
    fileHash: string;
    createdAt: Date;
    fileName: string;
    mimeType: string;
    byteSize: number;
    signedOn: Date | null;
    signerName: string | null;
    note: string | null;
    uploadedBy: string | null;
  }

  const base = {
    kind: "exclusivity",
    s3Key: "k",
    fileHash: "h",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    fileName: "scan.pdf",
    mimeType: "application/pdf",
    byteSize: 10,
    signedOn: null,
    signerName: null,
    note: null,
    uploadedBy: ME,
  };
  const others: DocRow = { ...base, id: "01DOCOTHERS", contactId: SHARED, propertyId: PROP };
  const office: DocRow = {
    ...base,
    id: "01DOCOFFICE",
    contactId: SHARED,
    propertyId: null,
    kind: "other",
  };

  function documentsService(rows: DocRow[]): SignedDocumentsService {
    const tx = {
      ...txFor([]),
      signedDocument: {
        findMany: async () => rows,
        findFirst: async ({ where }: { where: { id: string } }) =>
          rows.find((row) => row.id === where.id) ?? null,
        count: async () => 0,
        delete: async () => undefined,
      },
    };
    const prisma = { withTenant: async <T>(fn: (t: unknown) => Promise<T>): Promise<T> => fn(tx) };
    return new SignedDocumentsService(
      prisma as never,
      {} as never,
      { record: async () => undefined } as never,
      {} as never,
    );
  }

  it("אינה מופיעה ברשימה של הלקוח", async () => {
    const rows = await asUser(SCOPED, () =>
      documentsService([others, office]).listForContact(SHARED),
    );
    expect(rows.map((row) => row.id)).toEqual([office.id]);
  });

  it("ומחיקה במזהה ישיר נדחית", async () => {
    await expect(
      asUser(SCOPED, () => documentsService([others]).remove(others.id)),
    ).rejects.toThrow(/סוכן אחר/u);
  });

  it("ברירת המחדל רואה את שתיהן", async () => {
    const rows = await asUser(DEFAULT, () =>
      documentsService([others, office]).listForContact(SHARED),
    );
    expect(rows.map((row) => row.id)).toEqual([others.id, office.id]);
  });
});
