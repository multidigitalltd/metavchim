import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import {
  SIGNER_ADDRESS_BLANK,
  SIGNER_BLANK,
  type AgreementValues,
} from "@metavchim/shared";
import { officeContext, TenantContext } from "../../common/tenant-context";
import { AgreementsService } from "./agreements.service";

/**
 * ‎**כתובת הלקוח בהסכם רגיל — החותם ממלא אותה.**
 *
 * ‏לכתובת אין מקור במערכת, ולכן כל הסכם רגיל הודפס עם
 * ‏`[חסר: כתובת הלקוח]` באמצע המסמך. מעכשיו היא נשלחת כשורה למילוי,
 * ‏וטופס החתימה מבקש אותה — בדיוק כמו את מספר הזהות.
 */

const TENANT = "01TENANTAAAAAAAAAAAAAAAAAA";
const TOKEN = "token-of-the-agreement";

interface Row {
  id: string;
  tenantId: string;
  kind: string;
  status: string;
  tokenExpires: Date;
  renderedBody: string;
  bodyHash: string;
  signerTemplate: string | null;
  createdBy: string | null;
  propertyId: string | null;
}

function regularRow(body: string): Row {
  return {
    id: "01AGREEMENTAAAAAAAAAAAAAAA",
    tenantId: TENANT,
    kind: "brokerage",
    status: "viewed",
    tokenExpires: new Date(Date.now() + 86_400_000),
    renderedBody: body,
    bodyHash: AgreementsService.hashBody(body),
    signerTemplate: null,
    createdBy: null,
    propertyId: null,
  };
}

function harness(row: Row) {
  const writes: Record<string, unknown>[] = [];
  const tx = {
    agreement: {
      findFirst: async () => row,
      updateMany: async (args: { data: Record<string, unknown> }) => {
        writes.push(args.data);
        return { count: 1 };
      },
    },
  };
  const prisma = {
    withPublicAgreement: async <T>(_token: string, fn: (t: typeof tx) => Promise<T>) => fn(tx),
    withExplicitTenant: async <T>(_tenantId: string, fn: (t: typeof tx) => Promise<T>) => fn(tx),
    tenant: { findUnique: async () => ({ name: "משרד הבדיקה", settings: {} }) },
  };
  const service = new AgreementsService(
    prisma as never,
    {} as never, // contacts
    {} as never, // buyers
    { record: async () => undefined } as never, // audit
    {} as never, // messaging
    {} as never, // email
    {} as never, // emailInbox
    { has: async () => false } as never, // logo
  );
  return { service, writes };
}

const BODY = `הלקוח: דנה · ת"ז ${SIGNER_BLANK}\nכתובת: ${SIGNER_ADDRESS_BLANK}`;

describe("‏טופס החתימה מבקש כתובת רק כשיש לה מקום", () => {
  it("‏הסכם רגיל עם שורת כתובת — מבקש", async () => {
    const { service } = harness(regularRow(BODY));
    expect((await service.publicView(TOKEN)).asksAddress).toBe(true);
  });

  it("‏הסכם שנשלח לפני השינוי, בלי שורה — אינו מבקש", async () => {
    const { service } = harness(regularRow(`ת"ז ${SIGNER_BLANK}\nכתובת: [חסר: כתובת הלקוח]`));
    expect((await service.publicView(TOKEN)).asksAddress).toBe(false);
  });

  it("‏קישור פתוח — אינו מבקש בנפרד, כי הכתובת כבר בפרטים שלו", async () => {
    const { service } = harness({ ...regularRow(BODY), signerTemplate: "{{כתובת_הלקוח}}" });
    const view = await service.publicView(TOKEN);
    expect(view.asksAddress).toBe(false);
    expect(view.openLink).toBe(true);
  });
});

describe("‏החתימה ממלאת את הכתובת בגוף המסמך", () => {
  it("‏הכתובת והזהות נכנסות למקומן, והגיבוב מעיד על מה שנחתם", async () => {
    const { service, writes } = harness(regularRow(BODY));
    await service.sign(TOKEN, {
      signerName: "דנה כהן",
      signerIdNumber: "123456789",
      signerAddress: " הדקל 5, רמת גן ",
    });
    const final = 'הלקוח: דנה · ת"ז 123456789\nכתובת: הדקל 5, רמת גן';
    expect(writes[0]?.["renderedBody"]).toBe(final);
    expect(writes[0]?.["bodyHash"]).toBe(AgreementsService.hashBody(final));
    expect(writes[0]?.["presentedHash"]).toBe(AgreementsService.hashBody(BODY));
  });

  it("‏בלי כתובת כשהמסמך מבקש אותה — נדחה, ולא נחתם עם שורה ריקה", async () => {
    const { service, writes } = harness(regularRow(BODY));
    await expect(
      service.sign(TOKEN, { signerName: "דנה כהן", signerIdNumber: "123456789", signerAddress: "  " }),
    ).rejects.toThrow(BadRequestException);
    expect(writes).toEqual([]);
  });

  it("‏הסכם ישן בלי שורת כתובת — נחתם כמו קודם, בלי לבקש", async () => {
    const old = `ת"ז ${SIGNER_BLANK}`;
    const { service, writes } = harness(regularRow(old));
    await service.sign(TOKEN, { signerName: "דנה כהן", signerIdNumber: "123456789" });
    expect(writes[0]?.["renderedBody"]).toBe('ת"ז 123456789');
  });
});

describe("‏השליחה משאירה את הכתובת לחותם", () => {
  async function collected(values: Partial<AgreementValues>): Promise<Partial<AgreementValues>> {
    const { service } = harness(regularRow(BODY));
    const collect = (
      service as unknown as {
        collectValues: (
          tx: unknown,
          contact: { name: string; phone: string },
          input: { values?: Partial<AgreementValues> },
        ) => Promise<Partial<AgreementValues>>;
      }
    ).collectValues.bind(service);
    return TenantContext.run(officeContext(TENANT), () =>
      collect({}, { name: "דנה כהן", phone: "+972501234567" }, { values }),
    );
  }

  it("‏בלי כתובת מהשולח — שורה לחותם", async () => {
    expect((await collected({})).כתובת_הלקוח).toBe(SIGNER_ADDRESS_BLANK);
    expect((await collected({ כתובת_הלקוח: "   " })).כתובת_הלקוח).toBe(SIGNER_ADDRESS_BLANK);
  });

  it("‏כתובת שהשולח מסר נשארת, ומספר זהות שנשלח — לא", async () => {
    const values = await collected({ כתובת_הלקוח: "הדקל 5", תעודת_זהות_הלקוח: "000000000" });
    expect(values.כתובת_הלקוח).toBe("הדקל 5");
    expect(values.תעודת_זהות_הלקוח).toBe(SIGNER_BLANK);
  });
});
