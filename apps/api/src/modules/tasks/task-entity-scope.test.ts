import { NotFoundException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type { Capability } from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import type { PrismaService } from "../../core/prisma.service";
import type { ContactsService } from "../contacts/contacts.service";
import { TasksService } from "./tasks.service";

/**
 * ‎**המשימה שלי, הכרטיס של עמיתי.**
 *
 * ‏המשימות מסוננות בבעלות — `scopeFilter` — ולכן הקובץ הזה נראה
 * ‏מוגן. הוא לא היה: הקישור `entityType`/`entityId` מגיע **מהמסך**,
 * ‏והנתיבים דורשים `calendar.manage` שיש לכל סוכן. מי שיודע מזהה
 * ‏של קונה או ליד של עמית יכול היה ליצור משימה על עצמו ולקשור
 * ‏אותה אליו — והתשובה החזירה מיד את שם הלקוח המפוענח. גם
 * ‎`GET /tasks/for/:entityType/:entityId` היה פתוח (ביקורת Codex,
 * ‏P1).
 *
 * ‏זו הייתה ההצהרה שסימנתי בעצמי כ„זו שאני הכי פחות בטוח בה”
 * ‏בשער המנייה, וביקשתי שתיבדק. היא נבדקה, והייתה שגויה.
 */

const TENANT = "01TENANTAAAAAAAAAAAAAAAAAA";
const ME = "01MEAAAAAAAAAAAAAAAAAAAAAA";
const OTHER = "01OTHERAAAAAAAAAAAAAAAAAAA";
const BUYER = "01BUYERAAAAAAAAAAAAAAAAAAA";
const LEAD = "01LEADAAAAAAAAAAAAAAAAAAAA";
const CONTACT = "01CONTACTAAAAAAAAAAAAAAAAA";

/** ‏סוכן רגיל: מנהל יומן ורואה את הכרטיסים שלו בלבד. */
const AGENT: Capability[] = ["calendar.manage", "buyers.view_own", "leads.view_own"];
const MANAGER: Capability[] = [...AGENT, "buyers.view_all", "leads.view_all"];

/** ‏המסד המדומה מכבד את ה-`where`: בלי `view_all` נוסף `ownerUserId`. */
function serviceFor(
  ownerUserId: string,
  created: unknown[],
  existingTasks: Record<string, unknown>[] = [],
): TasksService {
  const mine = (where: { ownerUserId?: string }): boolean =>
    where.ownerUserId === undefined || where.ownerUserId === ownerUserId;
  /*
   * ‎**הליד אינו כמו הקונה, בשני דברים.**
   *
   * ‏העמודה היא `assignedToUserId` ולא `ownerUserId` — וזו הסיבה
   * ‏ש-`leadOwnershipFilter` קיים בנפרד. וחשוב מכך: הוא מחזיר
   * ‎`OR` ולא שדה שטוח, כי **ליד ללא שיוך שייך לבריכה** ונראה לכל
   * ‏המשרד. פיקסצ׳ר שמשווה שדה שטוח היה מפספס את שניהם.
   */
  const mineLead = (where: {
    OR?: { assignedToUserId: string | null }[];
  }): boolean =>
    where.OR === undefined ||
    where.OR.some((clause) => clause.assignedToUserId === ownerUserId);

  const tx = {
    buyer: {
      findFirst: async (args: { where: { ownerUserId?: string } }) =>
        mine(args.where) ? { id: BUYER } : null,
      findMany: async (args: { where: { ownerUserId?: string } }) =>
        mine(args.where) ? [{ id: BUYER, contactId: CONTACT }] : [],
    },
    lead: {
      findFirst: async (args: {
        where: { OR?: { assignedToUserId: string | null }[] };
      }) => (mineLead(args.where) ? { id: LEAD } : null),
      findMany: async (args: {
        where: { OR?: { assignedToUserId: string | null }[] };
      }) => (mineLead(args.where) ? [{ id: LEAD, contactId: CONTACT }] : []),
    },
    property: { findMany: async () => [] },
    task: {
      findFirst: async () => null,
      findMany: async () => existingTasks,
      create: async (args: { data: Record<string, unknown> }) => {
        created.push(args.data);
        return {
          ...args.data,
          status: "open",
          createdAt: new Date(),
          updatedAt: new Date(),
          dueAt: null,
          notes: null,
          priority: "normal",
          deletedAfterSync: false,
        };
      },
    },
    suggestionState: { findMany: async () => [] },
    user: { findMany: async () => [], findFirst: async () => null },
  };
  const prisma = {
    withTenant: async <T>(fn: (t: typeof tx) => Promise<T>): Promise<T> => fn(tx),
    // ‏שמות האחראים נשלפים מהלקוח הגלובלי, מחוץ לטרנזקציה
    user: { findMany: async () => [] },
  };
  const contacts = {
    getByIds: async () => new Map([[CONTACT, { id: CONTACT, name: "לקוח של עמית" }]]),
  } as unknown as ContactsService;
  return new TasksService(
    prisma as unknown as PrismaService,
    { record: async () => undefined } as never,
    { enqueue: async () => undefined } as never,
    contacts,
  );
}

function asUser<T>(capabilities: Capability[], fn: () => T): T {
  return TenantContext.run(
    { tenantId: TENANT, userId: ME, capabilities: new Set(capabilities), billingOnly: false },
    fn,
  );
}

describe("משימה שמצביעה על כרטיס", () => {
  it("יצירה עם כרטיס של עמית נדחית — ושום שורה לא נכתבת", async () => {
    const created: unknown[] = [];
    await expect(
      asUser(AGENT, () =>
        serviceFor(OTHER, created).create({
          title: "לחזור ללקוח",
          entityType: "buyer",
          entityId: BUYER,
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(created).toEqual([]);
  });

  it("הכרטיס שלי — היצירה עוברת כרגיל", async () => {
    const created: unknown[] = [];
    await asUser(AGENT, () =>
      serviceFor(ME, created).create({
        title: "לחזור ללקוח",
        entityType: "buyer",
        entityId: BUYER,
      }),
    );
    expect(created).toHaveLength(1);
  });

  it("המנהל יוצר על כל כרטיס במשרד", async () => {
    const created: unknown[] = [];
    await asUser(MANAGER, () =>
      serviceFor(OTHER, created).create({
        title: "לחזור ללקוח",
        entityType: "buyer",
        entityId: BUYER,
      }),
    );
    expect(created).toHaveLength(1);
  });

  /*
   * ‏נכס אינו נבדק: הנכסים משרדיים בכוונה, והתווית שלהם היא הכתובת
   * ‏ולא אדם. שער שהיה חוסם גם אותם היה משנה התנהגות קיימת בלי
   * ‏שיש מה להגן עליו.
   */
  it("נכס אינו נחסם — הוא משרדי, והתווית שלו אינה אדם", async () => {
    const created: unknown[] = [];
    await asUser(AGENT, () =>
      serviceFor(OTHER, created).create({
        title: "לצלם את הנכס",
        entityType: "property",
        entityId: "01PROPAAAAAAAAAAAAAAAAAAAA",
      }),
    );
    expect(created).toHaveLength(1);
  });

  it("צפייה במשימות של כרטיס של עמית נדחית", async () => {
    await expect(
      asUser(AGENT, () => serviceFor(OTHER, []).listForEntity("buyer", BUYER)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("ובכרטיס שלי — נפתחת כרגיל", async () => {
    const result = await asUser(AGENT, () => serviceFor(ME, []).listForEntity("buyer", BUYER));
    expect(result.tasks).toEqual([]);
  });

  /*
   * ‎**ומה שכבר נכתב.**
   *
   * ‏השערים ביצירה ובצפייה סוגרים את הדרך קדימה. משימות שכבר נושאות
   * ‏קישור כזה — מלפני התיקון, או מנתיב מערכת — עדיין קיימות, ולכן
   * ‏גם שליפת התוויות מסננת בבעלות. השם פשוט אינו מופיע; המשימה
   * ‏נשארת ברשימה של מי שהיא מוטלת עליו.
   */
  it("משימה קיימת שמצביעה על כרטיס של עמית — בלי שם הלקוח", async () => {
    const row = {
      id: "01TASKAAAAAAAAAAAAAAAAAAAA",
      tenantId: TENANT,
      title: "לחזור ללקוח",
      notes: null,
      status: "open",
      priority: "normal",
      dueAt: null,
      entityType: "buyer",
      entityId: BUYER,
      assignedToUserId: ME,
      createdByUserId: ME,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAfterSync: false,
    };
    const tasks = await asUser(AGENT, () => serviceFor(OTHER, [], [row]).list({}));
    expect(tasks[0]?.entityLabel).toBeUndefined();
  });

  /*
   * ‏אותו כלל על ליד, ולא רק על קונה: העמודה שם היא
   * ‎`assignedToUserId`, וסינון שמכיר רק את `ownerUserId` משאיר את
   * ‏ענף הליד פרוץ.
   */
  it("משימה שמצביעה על ליד של עמית — בלי שם הלקוח", async () => {
    const row = {
      id: "01TASKBBBBBBBBBBBBBBBBBBBB",
      tenantId: TENANT,
      title: "לחזור לליד",
      notes: null,
      status: "open",
      priority: "normal",
      dueAt: null,
      entityType: "lead",
      entityId: LEAD,
      assignedToUserId: ME,
      createdByUserId: ME,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAfterSync: false,
    };
    const tasks = await asUser(AGENT, () => serviceFor(OTHER, [], [row]).list({}));
    expect(tasks[0]?.entityLabel).toBeUndefined();
  });

  it("ואותו ליד כשהוא שלי — עם השם", async () => {
    const row = {
      id: "01TASKBBBBBBBBBBBBBBBBBBBB",
      tenantId: TENANT,
      title: "לחזור לליד",
      notes: null,
      status: "open",
      priority: "normal",
      dueAt: null,
      entityType: "lead",
      entityId: LEAD,
      assignedToUserId: ME,
      createdByUserId: ME,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAfterSync: false,
    };
    const tasks = await asUser(AGENT, () => serviceFor(ME, [], [row]).list({}));
    expect(tasks[0]?.entityLabel).toBe("לקוח של עמית");
  });

  it("ואותה משימה על הכרטיס שלי — עם השם", async () => {
    const row = {
      id: "01TASKAAAAAAAAAAAAAAAAAAAA",
      tenantId: TENANT,
      title: "לחזור ללקוח",
      notes: null,
      status: "open",
      priority: "normal",
      dueAt: null,
      entityType: "buyer",
      entityId: BUYER,
      assignedToUserId: ME,
      createdByUserId: ME,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAfterSync: false,
    };
    const tasks = await asUser(AGENT, () => serviceFor(ME, [], [row]).list({}));
    expect(tasks[0]?.entityLabel).toBe("לקוח של עמית");
  });
});
