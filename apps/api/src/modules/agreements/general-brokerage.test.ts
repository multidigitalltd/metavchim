import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  defaultAgreementTemplate,
  GENERAL_BROKERAGE_LABEL,
  GENERAL_BROKERAGE_VALUES,
  renderAgreement,
  REQUIRED_PLACEHOLDERS,
  SIGNER_PROVIDED_PLACEHOLDERS,
  type AgreementValues,
} from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { AgreementsService } from "./agreements.service";

/**
 * ‎**הזמנה בכתב כללית — על כל הנכסים שהמשרד יציע ללקוח** (בקשת המשתמש).
 *
 * ‏הזמנה על נכס פותחת הצעות על הנכס שלה בלבד, והזמנה בלי נכס אינה
 * ‏פותחת אף אחד. הזמנה כללית פותחת הצעות על כל נכס של אותו לקוח —
 * ‏בשער היחיד (`hasSigned`) ובשער הקבוצתי (`signedPairs`) כאחד.
 */

const TENANT = "01TENANTAAAAAAAAAAAAAAAAAA";
const CLIENT = "01CLIENTAAAAAAAAAAAAAAAAAA";
const OTHER_CLIENT = "01CLIENTBBBBBBBBBBBBBBBBBB";
const PROP_A = "01PROPAAAAAAAAAAAAAAAAAAAA";
const PROP_B = "01PROPBBBBBBBBBBBBBBBBBBBB";

interface Row {
  tenantId: string;
  contactId: string;
  kind: string;
  propertyId: string | null;
  allProperties?: boolean;
  status?: string;
  signedOn?: Date | null;
}

/** ‏התאמה של `where` של Prisma — רק הצורות ש-`hasSigned` ו-`signedPairs` שולחות. */
function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === "OR") return (condition as Record<string, unknown>[]).some((part) => matches(row, part));
    const value = (row as unknown as Record<string, unknown>)[key] ?? (key === "allProperties" ? false : null);
    if (condition !== null && typeof condition === "object" && !(condition instanceof Date)) {
      const op = condition as { in?: unknown[]; not?: unknown };
      if (op.in) return op.in.includes(value);
      if ("not" in op) return value !== op.not;
    }
    return value === condition;
  });
}

function table(rows: Row[]) {
  return {
    findFirst: async ({ where }: { where: Record<string, unknown> }) => rows.find((row) => matches(row, where)) ?? null,
    findMany: async ({ where }: { where: Record<string, unknown> }) => rows.filter((row) => matches(row, where)),
  };
}

function setup(agreements: Row[], documents: Row[] = []) {
  const tx = { agreement: table(agreements), signedDocument: table(documents) };
  const service = new AgreementsService(
    {} as never, // prisma
    {} as never, // contacts
    {} as never, // buyers
    { record: async () => undefined } as never, // audit
    {} as never, // messaging
    {} as never, // email
    {} as never, // emailInbox
    {} as never, // logo
  );
  return { tx: tx as never, service };
}

const general = (status: string): Row => ({
  tenantId: TENANT,
  contactId: CLIENT,
  kind: "brokerage",
  propertyId: null,
  allProperties: true,
  status,
});

describe("הזמנה כללית פותחת הצעות על כל נכס", () => {
  it("חתומה — מכסה כל נכס של אותו לקוח", async () => {
    const { tx, service } = setup([general("signed")]);
    expect(await service.hasSigned(tx, TENANT, CLIENT, "brokerage", PROP_A)).toBe(true);
    expect(await service.hasSigned(tx, TENANT, CLIENT, "brokerage", PROP_B)).toBe(true);
  });

  it("ממתינה לחתימה — אינה מכסה דבר", async () => {
    const { tx, service } = setup([general("pending")]);
    expect(await service.hasSigned(tx, TENANT, CLIENT, "brokerage", PROP_A)).toBe(false);
  });

  it("של לקוח אחר — אינה מכסה את הלקוח הזה", async () => {
    const { tx, service } = setup([{ ...general("signed"), contactId: OTHER_CLIENT }]);
    expect(await service.hasSigned(tx, TENANT, CLIENT, "brokerage", PROP_A)).toBe(false);
  });

  it("הזמנה על נכס אחד — עדיין מכסה רק אותו", async () => {
    const { tx, service } = setup([
      { tenantId: TENANT, contactId: CLIENT, kind: "brokerage", propertyId: PROP_A, status: "signed" },
    ]);
    expect(await service.hasSigned(tx, TENANT, CLIENT, "brokerage", PROP_A)).toBe(true);
    expect(await service.hasSigned(tx, TENANT, CLIENT, "brokerage", PROP_B)).toBe(false);
  });

  it("הזמנה בלי נכס שתואר ביד — עדיין אינה פותחת הצעות", async () => {
    const { tx, service } = setup([
      { tenantId: TENANT, contactId: CLIENT, kind: "brokerage", propertyId: null, status: "signed" },
    ]);
    expect(await service.hasSigned(tx, TENANT, CLIENT, "brokerage", PROP_A)).toBe(false);
  });

  it("השער הקבוצתי מסכים עם השער היחיד", async () => {
    const { tx, service } = setup(
      [
        general("signed"),
        { tenantId: TENANT, contactId: OTHER_CLIENT, kind: "brokerage", propertyId: PROP_A, status: "signed" },
      ],
      [{ tenantId: TENANT, contactId: OTHER_CLIENT, kind: "brokerage", propertyId: PROP_B, signedOn: new Date() }],
    );
    const signed = await service.signedPairs(tx, TENANT, "brokerage", [CLIENT, OTHER_CLIENT]);
    expect(signed.covers(CLIENT, PROP_A)).toBe(true);
    expect(signed.covers(CLIENT, PROP_B)).toBe(true);
    expect(signed.covers(OTHER_CLIENT, PROP_A)).toBe(true);
    expect(signed.covers(OTHER_CLIENT, PROP_B)).toBe(true);
    expect(signed.covers(OTHER_CLIENT, "01PROPCCCCCCCCCCCCCCCCCCCC")).toBe(false);
  });
});

describe("הזמנה כללית — רק הזמנה בכתב, ובלי נכס", () => {
  const run = (input: Parameters<AgreementsService["create"]>[1]) => {
    const { tx, service } = setup([]);
    return TenantContext.run(
      { tenantId: TENANT, userId: "01USERAAAAAAAAAAAAAAAAAAAA", capabilities: new Set(), billingOnly: false },
      () => service.create(tx, input),
    );
  };

  it("נדחית על נכס מסוים", async () => {
    await expect(run({ kind: "brokerage", contactId: CLIENT, propertyId: PROP_A, allProperties: true })).rejects.toThrow(
      "בלי נכס מסוים",
    );
  });

  it("נדחית בבלעדיות", async () => {
    await expect(run({ kind: "exclusivity", contactId: CLIENT, allProperties: true })).rejects.toThrow();
  });
});

describe("הנוסח הכללי", () => {
  it("ממלא את שלושת פרטי הנכס — המסמך שלם בלי שהמתווך יקליד דבר", () => {
    const { unfilled } = renderAgreement(defaultAgreementTemplate("brokerage"), {
      שם_המשרד: "משרד",
      שם_הלקוח: "לקוח",
      דמי_תיווך: "2%",
      מועד_תשלום: "במעמד החתימה",
      ...GENERAL_BROKERAGE_VALUES,
    });
    const blocking = unfilled.filter(
      (name) =>
        REQUIRED_PLACEHOLDERS.brokerage.includes(name as keyof AgreementValues) &&
        !SIGNER_PROVIDED_PLACEHOLDERS.includes(name as keyof AgreementValues),
    );
    expect(blocking).toEqual([]);
  });

  it("השרת כותב אותו בעצמו, אחרי הערכים שנשלחו בבקשה", () => {
    const service = readFileSync(join(__dirname, "agreements.service.ts"), "utf8");
    const after = service.indexOf("...input.values");
    expect(service.slice(after)).toContain("...(input.allProperties === true ? GENERAL_BROKERAGE_VALUES : {})");
  });

  it("המסך מציע אותו בבורר הנכס", () => {
    const panel = readFileSync(join(__dirname, "../../../../../apps/web/src/app/agreements-panel.tsx"), "utf8");
    expect(panel).toContain("<option value={ALL_PROPERTIES}>{GENERAL_BROKERAGE_LABEL}</option>");
    expect(panel).toContain("allProperties: true");
    expect(GENERAL_BROKERAGE_LABEL).toBe("הסכם תיווך כללי — כל הנכסים שיוצעו על ידי המשרד");
  });
});
