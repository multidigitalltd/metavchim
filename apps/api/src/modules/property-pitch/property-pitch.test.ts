import { PITCH_MAX_BUYERS, PITCH_MAX_PROPERTIES } from "@metavchim/shared";
import { SendSchema } from "./property-pitch.controller";
import { beforeAll, describe, expect, it } from "vitest";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { EmailAmbiguousError, EmailRejectedError } from "../../core/email.service";
import type { Capability } from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { PropertyPitchService } from "./property-pitch.service";

/**
 * ‎**מה השליחה הזו אינה עוקפת.**
 *
 * ‏„שלח לכולם” הוא כפתור שמייצר עשרות מיילים ללקוחות אמיתיים
 * ‏בלחיצה אחת, ולכן שלוש השאלות שנשאלות כאן אינן על העיצוב:
 *
 * ‎1. **בעלות.** סוכן אינו שולח לקונים של עמית — גם כשהמזהה שלהם
 *    ‏הגיע מהדפדפן. הרשימה נשלפת **מחדש** בשרת, ולכן בחירה שהגיעה
 *    ‏מבחוץ אינה הרשאה.
 * ‎2. **הסכמה.** מי שהסיר את עצמו אינו מקבל, ומי שאין לו מייל אינו
 *    ‏נחשב „נשלח”.
 * ‎3. **דיווח כן.** מה שלא יצא נספר בנפרד ומוחזר. „נשלח ל-7” אחרי
 *    ‏שסומנו עשרה הוא בדיוק הדיווח שגורם להאמין ששלושה קיבלו.
 */

interface Sent {
  to: string;
  subject: string;
  body: string;
}

interface World {
  /** ‏מה `EmailService.send` יזרוק, אם בכלל — לפי כתובת הנמען. */
  throwFor?: (to: string) => unknown;
  /** ‏רץ אחרי כל שליחה — כך אפשר לדמות „הסיר את עצמו באמצע”. */
  afterSend?: (to: string) => void;
  /** ‏כל הקונים במשרד — כולל של סוכנים אחרים. */
  buyers: {
    id: string;
    contactId: string;
    ownerUserId: string;
    name: string;
    hasEmail: boolean;
    optedOut: boolean;
  }[];
  properties: { id: string; title: string }[];
  /** ‏הכתיבה שמאשרת „נשלח” נכשלת — אחרי שהספק כבר קיבל את ההודעה. */
  failConfirm?: boolean;
}

function serviceFor(world: World): {
  service: PropertyPitchService;
  sent: Sent[];
  /** ‏מצבי השליחה שנכתבו על שורות התיבה, לפי סדר. */
  states: string[];
} {
  const sent: Sent[] = [];
  const messages: Record<string, unknown>[] = [];
  const states: string[] = [];

  const tx = {
    buyer: {
      findMany: (args: { where: Record<string, unknown> }) => {
        const owner = args.where["ownerUserId"];
        return Promise.resolve(
          world.buyers
            .filter((b) => owner === undefined || b.ownerUserId === owner)
            .map((b) => ({ id: b.id, contactId: b.contactId })),
        );
      },
    },
    contact: {
      findMany: (args: { where: { id: { in: string[] } } }) =>
        Promise.resolve(
          world.buyers
            .filter((b) => args.where.id.in.includes(b.contactId))
            .map((b) => ({
              id: b.contactId,
              optedOutAt: b.optedOut ? new Date() : null,
              emailHash: b.hasEmail ? "hash" : null,
            })),
        ),
      /* ‏קריאת ההסכמה **ברגע השליחה** — קוראת את העולם החי */
      findFirst: (args: { where: { id: string } }) => {
        const buyer = world.buyers.find((b) => b.contactId === args.where.id);
        return Promise.resolve({ optedOutAt: buyer?.optedOut === true ? new Date() : null });
      },
    },
    property: {
      findMany: (args: { where: { id: { in: string[] } } }) =>
        Promise.resolve(
          world.properties
            .filter((p) => args.where.id.in.includes(p.id))
            .map((p) => ({
              id: p.id,
              marketingTitle: p.title,
              city: "חיפה",
              neighborhood: null,
              rooms: null,
              areaSqm: null,
              priceAgorot: null,
              propertyType: null,
            })),
        ),
    },
    contactOptOutToken: {
      upsert: () => Promise.resolve({ token: "T".repeat(43) }),
    },
    emailMessage: {
      create: (args: { data: Record<string, unknown> }) => {
        messages.push(args.data);
        return Promise.resolve({});
      },
      updateMany: (args: { data: { sendState?: string } }) => {
        if (world.failConfirm === true && args.data.sendState === "sent") {
          return Promise.reject(new Error("could not serialize access"));
        }
        if (args.data.sendState !== undefined) states.push(args.data.sendState);
        return Promise.resolve({ count: 1 });
      },
    },
    $executeRaw: () => Promise.resolve(0),
  };

  const prisma = {
    withTenant: <T,>(fn: (t: typeof tx) => Promise<T>) => fn(tx),
    withPublicContactOptOut: <T,>(fn: (t: typeof tx) => Promise<T>) => fn(tx),
    tenant: { findUnique: () => Promise.resolve({ name: "משרד הבדיקה" }) },
  };

  const contacts = {
    getByIds: (_t: unknown, ids: readonly string[]) =>
      Promise.resolve(
        new Map(
          world.buyers
            .filter((b) => ids.includes(b.contactId))
            .map((b) => [b.contactId, { name: b.name }]),
        ),
      ),
    emailFor: (_t: unknown, contactId: string) => {
      const buyer = world.buyers.find((b) => b.contactId === contactId);
      return Promise.resolve(buyer?.hasEmail === true ? `${buyer.id}@example.test` : undefined);
    },
  };

  const email = {
    isConfigured: () => Promise.resolve(true),
    send: (
      to: string,
      subject: string,
      content: {
        paragraphs: string[];
        links?: { label: string; url: string }[];
        footnote?: string;
      },
    ) => {
      const boom = world.throwFor?.(to);
      if (boom !== undefined && boom !== null) return Promise.reject(boom);
      /* ‏המייל כולו — הקישורים אינם בפסקאות אלא בשדות משלהם */
      sent.push({
        to,
        subject,
        body: [
          ...content.paragraphs,
          ...(content.links ?? []).map((l) => `${l.label} ${l.url}`),
          content.footnote ?? "",
        ].join("\n"),
      });
      world.afterSend?.(to);
      return Promise.resolve();
    },
  };

  const service = new PropertyPitchService(
    prisma as never,
    contacts as never,
    email as never,
    { replyAddressFor: () => Promise.resolve(null) } as never,
    { ensure: (id: string) => Promise.resolve({ url: `https://app.test/p/${id}` }) } as never,
    { record: () => Promise.resolve() } as never,
  );
  return { service, sent, states };
}

function asUser<T>(userId: string, capabilities: Capability[], fn: () => T): T {
  return TenantContext.run(
    { tenantId: "01TENANT", userId, capabilities: new Set(capabilities), billingOnly: false },
    fn,
  );
}

const AGENT: Capability[] = ["buyers.view_own", "properties.view", "offers.send"];
const MANAGER: Capability[] = [...AGENT, "buyers.view_all"];

const WORLD: World = {
  buyers: [
    { id: "01MINE", contactId: "01CMINE", ownerUserId: "01ME", name: "דנה", hasEmail: true, optedOut: false },
    { id: "01NOMAIL", contactId: "01CNOMAIL", ownerUserId: "01ME", name: "רון", hasEmail: false, optedOut: false },
    { id: "01OUT", contactId: "01COUT", ownerUserId: "01ME", name: "יעל", hasEmail: true, optedOut: true },
    { id: "01THEIRS", contactId: "01CTHEIRS", ownerUserId: "01OTHER", name: "עמית", hasEmail: true, optedOut: false },
  ],
  properties: [{ id: "01PROP", title: "דירת גן" }],
};

describe("שליחת הצעת נכס", () => {
  /*
   * ‎`send` קורא ל-`loadEnv` בשביל `WEB_ORIGIN` — הבסיס של קישור
   * ‏דף הנחיתה וקישור ההסרה — ו-`loadEnv` מאמת את **כל** הסביבה.
   * ‏ערכים מזויפים בכוונה: הבדיקה אינה נוגעת ברשת ואינה נוגעת
   * ‏במסד. אותו דפוס בדיוק כמו `reply-origin.test.ts`.
   */
  beforeAll(() => {
    process.env["WEB_ORIGIN"] ??= "https://test.invalid";
    process.env["DATABASE_URL"] ??= "postgresql://t:t@localhost:5432/t";
    process.env["DIRECT_DATABASE_URL"] ??= "postgresql://t:t@localhost:5432/t";
    process.env["REDIS_URL"] ??= "redis://localhost:6379";
    process.env["DATA_ENCRYPTION_KEY"] ??= "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    process.env["PHONE_HASH_KEY"] ??= "test-phone-hash-key-not-a-real-secret-0000";
  });

  it("סוכן רואה את הקונים שלו בלבד", async () => {
    const rows = await asUser("01ME", AGENT, () =>
      serviceFor(WORLD).service.buyers({ limit: 100 }),
    );
    expect(rows.map((r) => r.buyerId)).not.toContain("01THEIRS");
    expect(rows).toHaveLength(3);
  });

  it("מנהל רואה גם את הקונים של עמיתיו", async () => {
    const rows = await asUser("01ME", MANAGER, () =>
      serviceFor(WORLD).service.buyers({ limit: 100 }),
    );
    expect(rows.map((r) => r.buyerId)).toContain("01THEIRS");
  });

  it("המצב נאמר ליד השם — לפני הבחירה, לא אחריה", async () => {
    const rows = await asUser("01ME", AGENT, () =>
      serviceFor(WORLD).service.buyers({ limit: 100 }),
    );
    const byId = new Map(rows.map((r) => [r.buyerId, r]));
    expect(byId.get("01MINE")?.state).toBe("ready");
    expect(byId.get("01NOMAIL")?.state).toBe("no_email");
    expect(byId.get("01NOMAIL")?.hasEmail).toBe(false);
    expect(byId.get("01OUT")?.state).toBe("opted_out");
  });

  it("החיפוש מסנן לפי השם המפוענח", async () => {
    const rows = await asUser("01ME", AGENT, () =>
      serviceFor(WORLD).service.buyers({ q: "דנה", limit: 100 }),
    );
    expect(rows.map((r) => r.name)).toEqual(["דנה"]);
  });

  it("בלי הרשאת צפייה בקונים — אין רשימה, גם עם הרשאת שליחה", async () => {
    await expect(
      asUser("01ME", ["offers.send", "properties.view"], () =>
        serviceFor(WORLD).service.buyers({ limit: 100 }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it("בלי הרשאת צפייה בנכסים — אין שליחה", async () => {
    await expect(
      asUser("01ME", ["offers.send", "buyers.view_own"], () =>
        serviceFor(WORLD).service.send({ propertyIds: ["01PROP"], buyerIds: ["01MINE"] }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  /**
   * ‎**הטענה המרכזית של הקובץ.**
   *
   * ‏המזהה של קונה של עמית נשלח מהדפדפן — כלומר בדיוק מה שתוקף
   * ‏או באג בממשק היו עושים — והשליחה מתעלמת ממנו, כי הרשימה
   * ‏נשלפת מחדש בשרת ולא מתקבלת מהבקשה.
   */
  it("מזהה של קונה של עמית שנשלח מהדפדפן אינו מקבל דבר", async () => {
    const { service, sent } = serviceFor(WORLD);
    const result = await asUser("01ME", AGENT, () =>
      service.send({ propertyIds: ["01PROP"], buyerIds: ["01MINE", "01THEIRS"] }),
    );
    expect(result.sent).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("01MINE@example.test");
  });

  it("מי שהסיר את עצמו ומי שאין לו מייל נספרים בנפרד ואינם מקבלים", async () => {
    const { service, sent } = serviceFor(WORLD);
    const result = await asUser("01ME", AGENT, () =>
      service.send({
        propertyIds: ["01PROP"],
        buyerIds: ["01MINE", "01NOMAIL", "01OUT"],
      }),
    );
    expect(result).toEqual({ sent: 1, skippedNoEmail: 1, skippedOptedOut: 1, failed: 0, unknown: 0 });
    expect(sent.map((s) => s.to)).toEqual(["01MINE@example.test"]);
  });

  it("המייל נושא את קישור דף הנחיתה ואת קישור ההסרה", async () => {
    const { service, sent } = serviceFor(WORLD);
    await asUser("01ME", AGENT, () =>
      service.send({ propertyIds: ["01PROP"], buyerIds: ["01MINE"] }),
    );
    const body = sent[0]?.body ?? "";
    expect(body).toContain("/p/01PROP");
    expect(body).toContain("/contact-optout/");
  });

  /**
   * ‎**ארבע הטענות מסבב הביקורת השני** — כולן על אותה לולאה.
   */

  it("אדם עם שני כרטיסי קונה מקבל מייל אחד", async () => {
    const world: World = {
      ...WORLD,
      buyers: [
        ...WORLD.buyers,
        {
          id: "01MINE2",
          contactId: "01CMINE",
          ownerUserId: "01ME",
          name: "דנה",
          hasEmail: true,
          optedOut: false,
        },
      ],
    };
    const { service, sent } = serviceFor(world);
    const result = await asUser("01ME", AGENT, () =>
      service.send({ propertyIds: ["01PROP"], buyerIds: ["01MINE", "01MINE2"] }),
    );
    expect(result.sent).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it("מי שהסיר את עצמו באמצע הלולאה אינו מקבל", async () => {
    const world: World = {
      ...WORLD,
      buyers: WORLD.buyers.map((b) => ({ ...b })),
    };
    /* ‏השליחה הראשונה מסירה את השני — כמו לחיצה על הקישור באותו רגע */
    world.afterSend = () => {
      const later = world.buyers.find((b) => b.id === "01SECOND");
      if (later !== undefined) later.optedOut = true;
    };
    world.buyers.push({
      id: "01SECOND",
      contactId: "01CSECOND",
      ownerUserId: "01ME",
      name: "אורי",
      hasEmail: true,
      optedOut: false,
    });
    const { service, sent } = serviceFor(world);
    const result = await asUser("01ME", AGENT, () =>
      service.send({ propertyIds: ["01PROP"], buyerIds: ["01MINE", "01SECOND"] }),
    );
    expect(sent.map((row) => row.to)).toEqual(["01MINE@example.test"]);
    expect(result.skippedOptedOut).toBe(1);
  });

  it("דחייה ודאית נספרת כנכשלה", async () => {
    const { service, states } = serviceFor({
      ...WORLD,
      throwFor: () => new EmailRejectedError("הספק דחה"),
    });
    const result = await asUser("01ME", AGENT, () =>
      service.send({ propertyIds: ["01PROP"], buyerIds: ["01MINE"] }),
    );
    expect(result).toMatchObject({ sent: 0, failed: 1, unknown: 0 });
    /* ‏ולא רק המונה — גם השורה בתיבה אומרת „נכשלה” */
    expect(states).toEqual(["failed"]);
  });

  /**
   * ‎„איננו יודעים” אינו „לא” — וזה מה שמונע שליחה כפולה.
   *
   * ‎**והבדיקה הזו זרקה קודם `Error` סתם.** `EmailService` לעולם
   * ‏אינו זורק כזה על פסק זמן — הוא זורק `EmailAmbiguousError`,
   * ‏שנוצר בדיוק בשביל המצב הזה. הבדיקה עברה מפני שהכלל הישן ספר
   * ‏**כל** מה שאינו דחייה כ„לא ידוע”, כלומר היא אישרה את הבאג
   * ‏במקום לתפוס אותו. עכשיו היא זורקת את מה שנזרק באמת.
   */
  it("פסק זמן נספר כ„לא ידוע” ולא ככישלון", async () => {
    const { service, states } = serviceFor({
      ...WORLD,
      throwFor: () => new EmailAmbiguousError("socket hang up", "pitch:x"),
    });
    const result = await asUser("01ME", AGENT, () =>
      service.send({ propertyIds: ["01PROP"], buyerIds: ["01MINE"] }),
    );
    expect(result).toMatchObject({ sent: 0, failed: 0, unknown: 1 });
    /*
     * ‎**השורה בתיבה אינה נשארת „ממתינה” ואינה נעשית „נכשלה”.**
     * ‏זו החצי השני של הממצא: מונה נכון מעל שורה שקרית עדיין
     * ‏משאיר את הסוכן בלי לדעת מה קרה.
     */
    expect(states).toEqual(["unknown"]);
  });

  /*
   * ‎**באג אצלנו אינו „ייתכן שהגיע”.**
   *
   * ‏הכלל הישן — „כל מה שאינו `EmailRejectedError`” — סיווג גם
   * ‏`TypeError` שנזרק לפני שהבקשה יצאה כ„לא ידוע”. הסוכן ראה
   * ‏„ייתכן שנשלח”, הלקוח לא קיבל דבר, ואיש לא שלח שוב.
   */
  it("‏באג לפני השליחה נספר ככישלון, לא כ„לא ידוע”", async () => {
    const { service, states } = serviceFor({
      ...WORLD,
      throwFor: () => new TypeError("cannot read properties of undefined"),
    });
    const result = await asUser("01ME", AGENT, () =>
      service.send({ propertyIds: ["01PROP"], buyerIds: ["01MINE"] }),
    );
    expect(result).toMatchObject({ sent: 0, failed: 1, unknown: 0 });
    expect(states).toEqual(["failed"]);
  });

  /*
   * ‎**כשל בתיעוד אחרי שהמייל יצא אינו „נכשלה”** (ביקורת Codex, P1).
   *
   * ‏הכתיבה שמאשרת „נשלח” הייתה חשופה: חריגה שלה יצאה מ-`sendOne`
   * ‏אל הלולאה, ושם סווגה כשגיאת שליחה. הלקוח **קיבל** את ההודעה,
   * ‏המסך אמר לסוכן שנכשלה, והסוכן שלח שוב — מזהה חדש, מפתח
   * ‏ייחודיות חדש, ועותק שני אצל הלקוח.
   */
  it("‏כשל בכתיבת האישור אינו הופך שליחה שהצליחה לכישלון", async () => {
    const { service, sent } = serviceFor({ ...WORLD, failConfirm: true });
    const result = await asUser("01ME", AGENT, () =>
      service.send({ propertyIds: ["01PROP"], buyerIds: ["01MINE"] }),
    );
    /* ‏המייל אכן יצא */
    expect(sent).toHaveLength(1);
    /* ‏והתוצאה אומרת את זה — לא „נכשל” ולא „לא ידוע” */
    expect(result).toMatchObject({ sent: 1, failed: 0, unknown: 0 });
  });

  it("בחירה ריקה נדחית לפני שנוגעים במסד", async () => {
    const { service } = serviceFor(WORLD);
    await expect(
      asUser("01ME", AGENT, () => service.send({ propertyIds: [], buyerIds: ["01MINE"] })),
    ).rejects.toThrow(BadRequestException);
    await expect(
      asUser("01ME", AGENT, () => service.send({ propertyIds: ["01PROP"], buyerIds: [] })),
    ).rejects.toThrow(BadRequestException);
  });
});

/**
 * ‎**החוזה שהבורר במסך נכתב מולו.**
 *
 * ‏הסכימה חסמה עשרים נכסים, והבורר טען מאה ואפשר „סמן הכל”:
 * ‏הסוכן סימן, לחץ, וקיבל 400 — ולא נשלח דבר (ביקורת Codex).
 * ‏שני המספרים מגיעים עכשיו מאותו קבוע משותף, והבדיקה הזו מקבעת
 * ‏שהם באמת אותו מספר ולא שניים שנראים דומים.
 */
describe("שער: תקרת השליחה היא הקבוע המשותף", () => {
  const ids = (count: number): string[] =>
    Array.from({ length: count }, (_, index) => String(index).padStart(26, "0"));

  it("‏בדיוק התקרה מתקבלת, ואחד מעליה נדחה", () => {
    const at = SendSchema.safeParse({
      propertyIds: ids(PITCH_MAX_PROPERTIES),
      buyerIds: ids(1),
    });
    const over = SendSchema.safeParse({
      propertyIds: ids(PITCH_MAX_PROPERTIES + 1),
      buyerIds: ids(1),
    });
    expect(at.success, "התקרה עצמה נדחתה").toBe(true);
    expect(over.success, "מעל התקרה התקבל").toBe(false);
  });

  it("‏וגם בצד הקונים", () => {
    expect(
      SendSchema.safeParse({ propertyIds: ids(1), buyerIds: ids(PITCH_MAX_BUYERS) }).success,
    ).toBe(true);
    expect(
      SendSchema.safeParse({ propertyIds: ids(1), buyerIds: ids(PITCH_MAX_BUYERS + 1) }).success,
    ).toBe(false);
  });
});
