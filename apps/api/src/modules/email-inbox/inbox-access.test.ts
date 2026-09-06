import { describe, expect, it } from "vitest";
import { NotFoundException } from "@nestjs/common";
import type { Capability } from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { EmailInboxService } from "./email-inbox.service";

/**
 * ‎**סוכן אינו רואה — ובעיקר אינו כותב — בהתכתבות של עמיתו.**
 *
 * ## ‏למה הבדיקה הזו קיימת
 *
 * ‎`FORCE ROW LEVEL SECURITY` מבודד משרד ממשרד, ולא סוכן מסוכן.
 * ‏יומן השיחות, ההסכמים והחיפוש כבר סיננו לפי בעלות
 * ‏(`visibleContactIds`), ותיבת הדואר — היחידה מבין הארבעה שנכתבה
 * ‏אחרי — פשוט לא קראה לו. היכולת שנדרשת בנתיב היא
 * ‎`buyers.view_own`, שיש לכל סוכן, ולכן לא הייתה שם שום הפרדה:
 * ‏רשימת השיחות, גוף ההודעות, הקבצים — ו**כפתור „השב”**.
 *
 * ‏השליחה היא החמורה מביניהן: היא אינה חושפת מידע אלא **יוצרת**
 * ‏אותו — מייל שיוצא בשם המשרד ללקוח של סוכן אחר, ונראה לו כהמשך
 * ‏השיחה שלו.
 */

interface Fixtures {
  /** ‏הלקוחות שהמשתמש הזה בעליהם. ריק = שום דבר אינו שלו. */
  ownedContactIds: readonly string[];
}

function serviceFor(fx: Fixtures): EmailInboxService {
  const ALL_CONTACTS = ["01MINE", "01THEIRS"];
  const owns = (contactId: unknown): boolean =>
    typeof contactId === "string" && fx.ownedContactIds.includes(contactId);

  /*
   * ‎**הכרטיסים מכבדים את ה-`where` שהקוד בונה, ולא את הפיקסצ׳ר.**
   *
   * ‏זו הנקודה שהופכת את הבדיקה למשמעותית: `ownershipFilter` מוסיף
   * ‏`ownerUserId` ל-`where` רק כשלמשתמש **אין** `view_all`. מסד
   * ‏מדומה שמתעלם מה-`where` היה מחזיר את אותה תשובה לסוכן ולמנהל,
   * ‏כלומר לא היה בודק את הכלל בכלל.
   */
  const scoped = (where: { contactId?: string; ownerUserId?: string }): boolean => {
    const known = where.contactId === undefined || ALL_CONTACTS.includes(where.contactId);
    if (!known) return false;
    // ‏אין `ownerUserId` ב-`where` = `view_all`, ואז הכול נראה
    if (where.ownerUserId === undefined) return true;
    return owns(where.contactId);
  };

  const tx = {
    /*
     * ‏הבעלות נגזרת דרך כרטיס הקונה, כמו במציאות. הליד והנכס
     * ‏מחזירים ריק, ולכן „שלי” כאן פירושו „קונה שאני מטפל בו”.
     */
    buyer: {
      findFirst: async (args: { where: { contactId?: string; ownerUserId?: string } }) =>
        scoped(args.where) ? { id: "01BUYER" } : null,
      findMany: async (args: { where: { ownerUserId?: string } }) =>
        (args.where.ownerUserId === undefined ? ALL_CONTACTS : fx.ownedContactIds).map(
          (contactId) => ({ id: `buyer-${contactId}`, contactId }),
        ),
    },
    lead: { findFirst: async () => null, findMany: async () => [] },
    property: { findFirst: async () => null, findMany: async () => [] },
    contactLink: { findFirst: async () => null },
    emailMessage: {
      findMany: async (args: { where?: { contactId?: { in?: string[] } } }) => {
        const scope = args.where?.contactId?.in;
        const rows = [
          { contactId: "01MINE", subject: "s", body: "b", direction: "in", createdAt: new Date() },
          { contactId: "01THEIRS", subject: "s", body: "b", direction: "in", createdAt: new Date() },
        ];
        return scope === undefined ? rows : rows.filter((r) => scope.includes(r.contactId));
      },
      groupBy: async () => [],
      findFirst: async () => ({ contactId: "01THEIRS" }),
      updateMany: async () => ({ count: 0 }),
    },
    emailAttachment: {
      findMany: async () => [],
      findFirst: async () => ({
        s3Key: "k",
        contentType: "application/pdf",
        sizeBytes: 1,
        name: "חוזה.pdf",
        kind: "document",
        messageId: "01MSG",
      }),
    },
    contact: { findFirst: async () => ({ id: "01THEIRS", fullName: "לקוח" }) },
  };
  const prisma = {
    withTenant: async <T>(fn: (t: typeof tx) => Promise<T>): Promise<T> => fn(tx),
  };
  const contacts = {
    getByIds: async (_tx: unknown, ids: readonly string[]) =>
      new Map(ids.map((id) => [id, "לקוח"])),
    getById: async () => ({ id: "01THEIRS", fullName: "לקוח" }),
  };
  return new EmailInboxService(
    prisma as never,
    {} as never,
    contacts as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

function asAgent<T>(capabilities: Capability[], fn: () => T): T {
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

/** ‏סוכן רגיל: רואה את הקונים שלו בלבד. */
const AGENT: Capability[] = ["buyers.view_own", "leads.view_own", "properties.view"];
/** ‏מנהל: רואה הכול, ולכן אמור להמשיך לראות הכול. */
const MANAGER: Capability[] = [
  "buyers.view_all",
  "leads.view_all",
  "properties.view",
  "properties.view_all",
];

describe("תיבת הדואר — הפרדה בין סוכנים", () => {
  it("הרשימה מציגה רק את השיחות של הסוכן", async () => {
    const threads = await asAgent(AGENT, () =>
      serviceFor({ ownedContactIds: ["01MINE"] }).listThreads(),
    );
    expect(threads.map((t) => t.contactId)).toEqual(["01MINE"]);
  });

  /*
   * ‏הסתרה מהרשימה בלי שער על הפתיחה אינה הפרדה אלא ניחוש מזהה:
   * ‏המזהה מופיע בכתובת, בהתראות ובכרטיס הלקוח.
   */
  it("פתיחת שיחה של לקוח שאינו שלו נדחית", async () => {
    await expect(
      asAgent(AGENT, () => serviceFor({ ownedContactIds: ["01MINE"] }).thread("01THEIRS")),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("סימון כנקרא על שיחה שאינה שלו נדחה", async () => {
    await expect(
      asAgent(AGENT, () => serviceFor({ ownedContactIds: ["01MINE"] }).markRead("01THEIRS")),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  /** ‏החמורה: שליחה בשם המשרד ללקוח של סוכן אחר. */
  it("תשובה ללקוח שאינו שלו נדחית לפני כל שליחה", async () => {
    await expect(
      asAgent(AGENT, () => serviceFor({ ownedContactIds: ["01MINE"] }).reply("01THEIRS", "שלום")),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  /*
   * ‏הנתיב היחיד שאינו מקבל מזהה לקוח אלא מזהה קובץ — ולכן זה
   * ‏שנשאר פתוח אחרי שכל השאר נסגרו.
   */
  it("הורדת קובץ מתוך שיחה שאינה שלו נדחית", async () => {
    await expect(
      asAgent(AGENT, () => serviceFor({ ownedContactIds: ["01MINE"] }).attachmentRaw("01ATT")),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  /*
   * ‏הצד השני של הכלל. שער שחוסם גם את המנהל הוא תקלה, לא הידוק:
   * ‏„וגם המנהל שלו” הוא חלק מהדרישה עצמה.
   */
  it("מנהל ממשיך לראות את כל התיבה", async () => {
    const threads = await asAgent(MANAGER, () =>
      serviceFor({ ownedContactIds: [] }).listThreads(),
    );
    expect(threads.map((t) => t.contactId).sort()).toEqual(["01MINE", "01THEIRS"]);
  });

  it("מנהל פותח שיחה של כל סוכן", async () => {
    await expect(
      asAgent(MANAGER, () => serviceFor({ ownedContactIds: [] }).thread("01THEIRS")),
    ).resolves.toBeDefined();
  });
});
