import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { agentResultText, type AgentHistoryRef, type Capability } from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { AgentExecuteService } from "./execute.service";
import { AgentResolveService } from "./resolve.service";

/**
 * ‎**מו״מ ושיווק על נכס מהסוכן** — הצעות מחיר, בית פתוח, מחיר למ״ר מול
 * ‏השכונה, ולמי להציע שוב אחרי הורדה.
 *
 * ‏השירותים עצמם (הסתרת שמות, נעילה, חפיפה) נבדקים במקומם; כאן נבדק מה
 * ‏שהסוכן מוסיף: ברירות המחדל, הבחירה בהצעה הפתוחה, המרת השקלים, ושהמשפט
 * ‏שהמתווך מקבל אומר את מה שקרה.
 */

const PROPERTY = "01J0000000000000000000PROP";
const BUYER = "01J000000000000000000BUYER";
const OTHER = "01J000000000000000000OTHER";

const ALL: Capability[] = ["properties.view", "properties.edit", "buyers.view_own"];

/** ‏אותו בדל בכל מקום — הסדר בבנאי אינו מידע שהבדיקה מחזיקה. */
function serviceWith(stub: Record<string, unknown>): AgentExecuteService {
  const shared = {
    resolveForExecution: async () => ({ ok: true as const }),
    record: async () => undefined,
    generateStructured: async () => null,
    ...stub,
  };
  const deps = Array.from({ length: 80 }, () => shared as unknown);
  return new AgentExecuteService(
    ...(deps as unknown as ConstructorParameters<typeof AgentExecuteService>),
  );
}

function run<T>(fn: () => Promise<T>, capabilities: Capability[] = ALL): Promise<T> {
  return TenantContext.run(
    { tenantId: "01TENANT", userId: "01USER", capabilities: new Set(capabilities), billingOnly: false },
    fn,
  );
}

function thread(buyerId: string, name: string, open: { id: string; amountAgorot: number } | null) {
  const event = {
    id: open?.id ?? `${buyerId}-closed`,
    buyerId,
    side: "buyer" as const,
    amountAgorot: open?.amountAgorot ?? 200_000_000,
    status: open === null ? ("rejected" as const) : ("open" as const),
    note: null,
    createdAt: "2026-10-01T10:00:00.000Z",
  };
  return {
    buyer: { id: buyerId, name, visible: true },
    events: [event],
    open: open === null ? null : event,
    outcome: open === null ? ("rejected" as const) : null,
    lastAt: event.createdAt,
  };
}

const bidsDto = (threads: ReturnType<typeof thread>[]) => ({
  threads,
  summary: {},
  sentences: ["קונה אחד במו״מ על הנכס."],
  buyerOptions: [],
});

describe("רישום הצעת מחיר", () => {
  it("הצעת נגד של המוכר — בשקלים מהדיבור, באגורות לשירות", async () => {
    const create = vi.fn(async () => bidsDto([thread(BUYER, "משה כהן", { id: "b1", amountAgorot: 235_000_000 })]));
    const result = await run(() =>
      serviceWith({ create }).execute("log_bid", {
        buyerId: BUYER,
        propertyId: PROPERTY,
        bidSide: "seller",
        bidShekels: 2_350_000,
      }),
    );
    expect(create).toHaveBeenCalledWith(PROPERTY, { buyerId: BUYER, side: "seller", amountAgorot: 235_000_000 });
    expect(result.message).toContain("הצעת נגד של המוכר — משה כהן: 2,350,000 ₪");
    expect(result.ref).toEqual({ label: "משה כהן", entityType: "buyer", entityId: BUYER });
  });

  it("בלי צד — הצעת הקונה; בלי סכום — נעצר ואומר מה לומר", async () => {
    const create = vi.fn(async () => bidsDto([thread(BUYER, "משה כהן", { id: "b1", amountAgorot: 1 })]));
    const service = serviceWith({ create });
    await run(() => service.execute("log_bid", { buyerId: BUYER, propertyId: PROPERTY, bidShekels: 1_900_000 }));
    expect(create).toHaveBeenCalledWith(PROPERTY, expect.objectContaining({ side: "buyer" }));
    await expect(
      run(() => service.execute("log_bid", { buyerId: BUYER, propertyId: PROPERTY })),
    ).rejects.toThrow("סכום ההצעה");
  });
});

describe("הכרעה על הצעת מחיר", () => {
  it("בלי שם קונה — ההצעה הפתוחה היחידה", async () => {
    const decide = vi.fn(async () => bidsDto([]));
    const list = async () =>
      bidsDto([thread(BUYER, "משה כהן", { id: "bid-open", amountAgorot: 230_000_000 }), thread(OTHER, "דנה", null)]);
    const result = await run(() =>
      serviceWith({ list, decide }).execute("decide_bid", { propertyId: PROPERTY, bidDecision: "accepted" }),
    );
    expect(decide).toHaveBeenCalledWith(PROPERTY, "bid-open", "accepted");
    expect(result.message).toContain("ההצעה של משה כהן (2,300,000 ₪) התקבלה");
  });

  it("כמה הצעות פתוחות ובלי שם — אינו בוחר בשביל המתווך", async () => {
    const decide = vi.fn();
    const list = async () =>
      bidsDto([
        thread(BUYER, "משה כהן", { id: "a", amountAgorot: 1 }),
        thread(OTHER, "דנה", { id: "b", amountAgorot: 2 }),
      ]);
    await expect(
      run(() => serviceWith({ list, decide }).execute("decide_bid", { propertyId: PROPERTY, bidDecision: "rejected" })),
    ).rejects.toThrow("יש 2 הצעות פתוחות על הנכס");
    expect(decide).not.toHaveBeenCalled();
  });
});

describe("בית פתוח", () => {
  const startsAt = "2030-01-04T08:00:00.000Z";

  it("בלי משך ומשבצת — ברירות המחדל של הטופס, והקישור יוצא בנפרד", async () => {
    const create = vi.fn(async () => ({ registrationUrl: "https://example.test/l/abc", events: [] }));
    const result = await run(() =>
      serviceWith({ create }).execute("schedule_open_house", { propertyId: PROPERTY, startsAt }),
    );
    expect(create).toHaveBeenCalledWith(PROPERTY, {
      startsAt,
      endsAt: "2030-01-04T10:00:00.000Z",
      slotMinutes: 20,
      slotCapacity: null,
    });
    expect(result.link).toBe("https://example.test/l/abc");
    expect(result.message).not.toContain("https://");
    expect(result.message).toContain("כניסה כל 20 דקות");
  });

  it("אירוע קצר ממשבצת — נדחה בכלל של הטופס", async () => {
    const create = vi.fn();
    await expect(
      run(() =>
        serviceWith({ create }).execute("schedule_open_house", {
          propertyId: PROPERTY,
          startsAt,
          openHouseHours: 0.5,
          slotMinutes: "60",
        }),
      ),
    ).rejects.toThrow(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it("בלי מועד — שואל מתי", async () => {
    await expect(
      run(() => serviceWith({}).execute("schedule_open_house", { propertyId: PROPERTY })),
    ).rejects.toThrow("אמרו מתי");
  });
});

describe("מחיר למ״ר מול השכונה", () => {
  it("הפער נאמר במילים, ועל כמה נכסים הממוצע נשען", async () => {
    const priceBenchmark = async () => ({
      perSqmAgorot: 3_000_000,
      neighborhood: { avgPerSqmAgorot: 2_500_000, count: 7, label: "הבורסה", gapPercent: 20 },
      city: null,
    });
    const result = await run(() => serviceWith({ priceBenchmark }).execute("price_check", { propertyId: PROPERTY }));
    expect(result.message).toBe(
      "המחיר למ״ר בנכס: 30,000 ₪. בשכונה הבורסה: ממוצע 25,000 ₪ על 7 נכסים — הנכס יקר ב-20%.",
    );
  });

  it("בלי מחיר או שטח — אומר מה חסר, ולא „אין נתונים”", async () => {
    const priceBenchmark = async () => ({ perSqmAgorot: null, neighborhood: null, city: null });
    const result = await run(() => serviceWith({ priceBenchmark }).execute("price_check", { propertyId: PROPERTY }));
    expect(result.message).toContain("חסר מחיר או שטח");
  });
});

describe("ירד המחיר — למי להציע שוב", () => {
  it("בלי הורדה טרייה — אומר זאת על הנכס", async () => {
    const candidates = async () => ({ drop: null, propertyLabel: "הרצל 5", candidates: [], complete: true });
    const result = await run(() => serviceWith({ candidates }).execute("show_reoffer", { propertyId: PROPERTY }));
    expect(result.message).toBe("המחיר של הרצל 5 לא ירד ב-30 הימים האחרונים — אין למי להציע שוב");
  });

  it("הקונים מוצגים עם הסיבה והטלפון — והטלפון אינו בזיכרון", async () => {
    const candidates = async () => ({
      drop: { fromAgorot: 250_000_000, toAgorot: 230_000_000, changedAt: "2026-10-01T00:00:00.000Z" },
      propertyLabel: "הרצל 5",
      candidates: [
        {
          buyerId: BUYER,
          name: "משה כהן",
          phone: "050-1234567",
          reasons: ["said_price_high"],
          reasonLabels: ["אמר בסיור שהמחיר גבוה"],
          lastViewingAt: null,
          contactedAt: null,
        },
      ],
      complete: true,
    });
    const result = await run(() => serviceWith({ candidates }).execute("show_reoffer", { propertyId: PROPERTY }));
    expect(result.message).toContain("המחיר ירד מ-2,500,000 ₪ ל-2,300,000 ₪. קונה אחד אמר");
    expect(result.data).toEqual(expect.objectContaining({ total: 1 }));
    const text = agentResultText(result.data);
    expect(text).toContain("משה כהן");
    expect(text).toContain("050-1234567");
    expect(text).toContain("טרם פנית");
  });

  // ‏מקור שהגיע לתקרה — „לפחות”, ובלי סך מדויק (ביקורת Codex)
  it("סריקה שנחתכה — „לפחות”, ויש עוד", async () => {
    const candidates = async () => ({
      drop: { fromAgorot: 250_000_000, toAgorot: 230_000_000, changedAt: "2026-10-01T00:00:00.000Z" },
      propertyLabel: "הרצל 5",
      candidates: [
        {
          buyerId: BUYER,
          name: "משה כהן",
          reasons: ["said_price_high"],
          reasonLabels: ["אמר בסיור שהמחיר גבוה"],
          lastViewingAt: null,
          contactedAt: null,
        },
      ],
      complete: false,
    });
    const result = await run(() => serviceWith({ candidates }).execute("show_reoffer", { propertyId: PROPERTY }));
    expect(result.message).toContain("לפחות 1 קונים אמרו");
    expect(result.data).toEqual(expect.objectContaining({ hasMore: true }));
    expect(result.data).not.toHaveProperty("total");
  });
});

/*
 * ‏„משה הציע 2.3 על הדירה הזאת” — הנכס מגיע כסימון של הכרטיס שנפתח.
 * ‏הרשומה השנייה נפתרת מהשיחה כמו הראשונה; חיפוש של הסימון כטקסט לא
 * ‏היה מוצא דבר, והצעה הייתה נעצרת על „לא זוהה הנכס”.
 */
describe("הרשומה השנייה — גם מההפניה בשיחה", () => {
  it("הנכס של הכרטיס הפתוח נקשר, בלי חיפוש", async () => {
    const resolver = new AgentResolveService(
      { placeVocabulary: async () => [] } as never,
      { search: () => Promise.reject(new Error("אין לחפש")) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const refs: AgentHistoryRef[] = [
      { label: "משה כהן", entityType: "buyer", entityId: BUYER },
      { label: "הרצל 5", entityType: "property", entityId: PROPERTY },
    ];
    const proposal = await resolver.toProposal(
      "משה הציע 2.3 על הדירה הזאת",
      {
        actionId: "log_bid",
        params: { buyerPhrase: "⟪משה כהן⟫", propertyPhrase: "⟪הרצל 5⟫", bidShekels: 2_300_000 },
        evidence: {},
        unmapped: [],
        rejected: [],
        suggest: [],
        fallback: false,
        steps: [],
      },
      undefined,
      refs,
    );
    expect(proposal.candidates).toBeUndefined();
    expect(proposal.fields.find((field) => field.key === "propertyId")?.value).toBe(PROPERTY);
    expect(proposal.fields.find((field) => field.key === "buyerId")?.value).toBe(BUYER);
  });
});
