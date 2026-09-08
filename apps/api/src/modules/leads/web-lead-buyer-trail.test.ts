import { describe, expect, it } from "vitest";
import { WebLeadService } from "./web-lead.service";

/**
 * ‎**מה שהלקוח מילא — גם בכרטיס הקונה, ועם הנכס שעליו הגיב.**
 *
 * ‏ציר הזמן בכרטיס הקונה קורא `interaction` לפי `buyerId`, והמילוי
 * ‏בדף הנחיתה נרשם עם `leadId` בלבד. התוצאה: לקוח שקיבל הצעת נכס,
 * ‏נכנס לדף הנחיתה ומילא פרטים — לא הותיר שום סימן בכרטיס שממנו
 * ‏נשלחה אליו ההצעה (בקשת המשתמש).
 *
 * ‏הנתיב הזה לא היה מכוסה בבדיקה, ולכן שני הענפים שלו הספיקו
 * ‏להיפרד: אחד שומר את כתובת הדף ואחד לא. חוסר כיסוי הוא איך זה
 * ‏קרה, ולכן הבדיקה כאן.
 */

const TENANT = "01TENANTAAAAAAAAAAAAAAAAAA";
const CONTACT = "01CONTACTAAAAAAAAAAAAAAAAA";
const PAGE = "https://app.test/p/xyz";

interface Row {
  leadId?: string;
  buyerId?: string;
  content?: string;
  direction?: string;
}

/**
 * ‏עולם מדומה: כרטיס איש קשר קיים, ורשימת כרטיסי הקונה שלו.
 *
 * ‎`openLead` קובע באיזה משני הענפים הקליטה תיפול — פנייה חוזרת
 * ‏לליד פתוח, או ליד חדש.
 */
function serviceFor(world: {
  buyers: { id: string; deleted?: boolean }[];
  openLead?: boolean;
}): { service: WebLeadService; timeline: Row[] } {
  const timeline: Row[] = [];

  const tx = {
    $executeRaw: () => Promise.resolve(0),
    contact: {
      findUnique: () => Promise.resolve({ id: CONTACT, emailHash: "hash" }),
      create: () => Promise.resolve({ id: CONTACT, emailHash: "hash" }),
      updateMany: () => Promise.resolve({ count: 1 }),
    },
    property: { findFirst: () => Promise.resolve(null) },
    lead: {
      findFirst: (args: { where: { status: { in: string[] } } }) =>
        Promise.resolve(
          world.openLead === true && args.where.status.in.includes("new")
            ? { id: "01LEADOPEN", intent: "unknown", propertyId: null }
            : null,
        ),
      create: () => Promise.resolve({}),
      updateMany: () => Promise.resolve({ count: 1 }),
    },
    interaction: {
      create: (args: { data: Row }) => {
        timeline.push(args.data);
        return Promise.resolve({});
      },
    },
    buyer: {
      findMany: (args: { where: { deletedAt: null } }) => {
        /* ‏הכפיל מכבד את התנאי, אחרת „רק כרטיסים חיים” אינו נבדק */
        expect(args.where.deletedAt).toBeNull();
        return Promise.resolve(
          world.buyers.filter((b) => b.deleted !== true).map((b) => ({ id: b.id })),
        );
      },
    },
    outboxEvent: { create: () => Promise.resolve({}) },
  };

  const prisma = { $transaction: <T,>(fn: (t: typeof tx) => Promise<T>) => fn(tx) };
  const crypto = {
    phoneHash: () => "phone-hash",
    emailHash: () => "email-hash",
    encrypt: (value: string) => value,
  };

  return {
    service: new WebLeadService(prisma as never, crypto as never),
    timeline,
  };
}

const INPUT = { name: "ישראל ישראלי", phone: "0501234567", pageUrl: PAGE };

/** ‏שורות הציר של כרטיס קונה מסוים. */
function forBuyer(timeline: Row[], buyerId: string): Row[] {
  return timeline.filter((row) => row.buyerId === buyerId);
}

describe("‏מילוי דף נחיתה על כרטיס הקונה", () => {
  it("‏ליד חדש — הכרטיס מקבל שורה עם הנכס שעליו הלקוח הגיב", async () => {
    const { service, timeline } = serviceFor({ buyers: [{ id: "01BUYER" }] });
    await service.ingestForTenant(TENANT, INPUT, "landing");

    const rows = forBuyer(timeline, "01BUYER");
    expect(rows).toHaveLength(1);
    /* ‏הלקוח יזם — זו ההבחנה בציר בין „שלחנו לו” לבין „הוא פנה” */
    expect(rows[0]?.direction).toBe("in");
    /*
     * ‎**זו הטענה**: את הנכס שנלחץ `publicLead` מוסר רק דרך
     * ‏`pageUrl`. שורה בלעדיו אומרת „מילא טופס” בלי לומר על מה,
     * ‏בדיוק על הכרטיס שאליו נשלחה ההצעה (ביקורת Codex, P2).
     */
    expect(rows[0]?.content).toContain(PAGE);
  });

  it("‏פנייה חוזרת — אותה שורה בדיוק, על אותו כרטיס", async () => {
    const { service, timeline } = serviceFor({ buyers: [{ id: "01BUYER" }], openLead: true });
    await service.ingestForTenant(TENANT, INPUT, "landing");

    const rows = forBuyer(timeline, "01BUYER");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.direction).toBe("in");
    expect(rows[0]?.content).toContain(PAGE);
  });

  /*
   * ‎**כל הכרטיסים החיים, ולא אחד.** למערכת מותר במפורש שיהיו
   * ‏לאיש קשר שני כרטיסי קונה — שתי דרישות של אותו אדם, או שארית
   * ‏של מיזוג. בחירה שרירותית באחד הייתה מסתירה את המילוי מהסוכן
   * ‏שעובד על השני.
   */
  it("‏שני כרטיסי קונה לאותו אדם — שניהם מקבלים", async () => {
    const { service, timeline } = serviceFor({
      buyers: [{ id: "01BUYERA" }, { id: "01BUYERB" }, { id: "01GONE", deleted: true }],
    });
    await service.ingestForTenant(TENANT, INPUT, "landing");

    expect(forBuyer(timeline, "01BUYERA")).toHaveLength(1);
    expect(forBuyer(timeline, "01BUYERB")).toHaveLength(1);
    /* ‏כרטיס שנמחק אינו מקבל */
    expect(forBuyer(timeline, "01GONE")).toEqual([]);
  });

  /* ‏שורת הליד עצמה נשארת — הכרטיס הוא תוספת, לא החלפה */
  it("‏שורת הליד נכתבת גם היא", async () => {
    const { service, timeline } = serviceFor({ buyers: [{ id: "01BUYER" }] });
    await service.ingestForTenant(TENANT, INPUT, "landing");

    const lead = timeline.filter((row) => row.leadId !== undefined);
    expect(lead).toHaveLength(1);
    expect(lead[0]?.content).toContain(PAGE);
  });
});
