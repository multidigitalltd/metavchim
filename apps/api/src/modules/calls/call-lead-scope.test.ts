import { describe, expect, it } from "vitest";
import { NotFoundException } from "@nestjs/common";
import type { Capability } from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { visibleCallsCondition } from "../../common/ownership";
import { CallsService } from "./calls.service";

/**
 * ‎**שיחה שקשורה לליד נשפטת לפי הליד — לא לפי הלקוח.**
 *
 * ‏שער הלקוח (`assertContactAccess`) הוא **איחוד** מקורות, וזה נכון
 * ‏לשאלה שהוא נשאל: „מותר לי לראות את האדם הזה”. אבל אותו אדם יכול
 * ‏להיות הקונה שלי **וגם** הליד של עמית — צירוף רגיל לגמרי במשרד —
 * ‏ואז שיחה שהעמית ניהל על **הליד שלו** נכנסה דרך כרטיס הקונה שלי.
 *
 * ‏והשער הזה אינו לצפייה בלבד: `remove`, `attachRecording` ושני
 * ‏הניסיונות החוזרים נשענים עליו. כלומר אפשר היה **למחוק את תיעוד
 * ‏השיחה של עמית** (ביקורת Codex, P1).
 */

const TENANT = "01TENANT";
const ME = "01ME";
const OTHER = "01OTHER";
/** ‏הלקוח שהוא גם הקונה שלי — ולכן שער הלקוח נפתח עליו. */
const SHARED_CONTACT = "01SHAREDCONTACT";
const LEAD = "01LEAD";

interface Lead {
  assignedToUserId: string | null;
}

/**
 * ‏המסד המדומה: שיחה אחת שקשורה לליד, ולקוח שהוא כרטיס קונה שלי.
 * ‏`lead` הוא `null` כשהליד כבר אינו קיים — מחיקת ליד מאפסת את
 * ‎`lead_id`, ולכן זה שריד ולא ליד של מישהו.
 */
function serviceFor(lead: Lead | null, deleted: string[]): CallsService {
  const tx = {
    call: {
      findFirst: async () => ({
        contactId: SHARED_CONTACT,
        createdBy: OTHER,
        leadId: LEAD,
        recordingKey: "calls/01TENANT/01CALL/01OBJ",
      }),
      deleteMany: async ({ where }: { where: { id: string } }) => {
        deleted.push(where.id);
        return { count: 1 };
      },
    },
    /* ‏כרטיס הקונה שלי על אותו אדם — זה מה שפתח את השער בטעות */
    buyer: {
      findFirst: async () => ({ id: "01MYBUYER" }),
      findMany: async () => [{ contactId: SHARED_CONTACT }],
    },
    lead: {
      findFirst: async () => lead,
      findMany: async () => [],
    },
    property: { findFirst: async () => null, findMany: async () => [] },
    contactLink: { findFirst: async () => null },
  };
  const prisma = {
    withTenant: async <T>(fn: (t: typeof tx) => Promise<T>): Promise<T> => fn(tx),
  };
  const audit = { record: async () => undefined };
  const storage = { getObject: async () => ({ body: null, contentType: "audio/wav" }) };
  return new CallsService(
    prisma as never,
    {} as never,
    {} as never,
    audit as never,
    storage as never,
    {} as never,
  );
}

function asUser<T>(capabilities: Capability[], fn: () => T): T {
  return TenantContext.run(
    { tenantId: TENANT, userId: ME, capabilities: new Set(capabilities), billingOnly: false },
    fn,
  );
}

/** ‏הקונים שלי בלבד, והלידים שלי בלבד — הסוכן הרגיל. */
const SCOPED: Capability[] = ["buyers.view_own", "leads.view_own"];

describe("שיחה על הליד של עמית, כשהלקוח הוא הקונה שלי", () => {
  it("מחיקה נדחית — ושום שורה לא נמחקה", async () => {
    const deleted: string[] = [];
    await expect(
      asUser(SCOPED, () => serviceFor({ assignedToUserId: OTHER }, deleted).remove("01CALL")),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(deleted).toEqual([]);
  });

  it("וגם ההקלטה אינה מושמעת", async () => {
    await expect(
      asUser(SCOPED, () => serviceFor({ assignedToUserId: OTHER }, []).recording("01CALL")),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  /*
   * ‏הצד השני, ובלעדיו הבדיקה מאשרת שער נעול ולא שער נכון: אותה
   * ‏שיחה בדיוק, כשהליד שלי — נמחקת כרגיל.
   */
  it("אבל כשהליד שלי — נמחקת כרגיל", async () => {
    const deleted: string[] = [];
    await asUser(SCOPED, () => serviceFor({ assignedToUserId: ME }, deleted).remove("01CALL"));
    expect(deleted).toEqual(["01CALL"]);
  });

  /* ‏ליד לא-משויך הוא הערימה המשותפת — אותו כלל של רשימת הלידים. */
  it("וליד שאיש לא לקח נשאר פתוח", async () => {
    const deleted: string[] = [];
    await asUser(SCOPED, () => serviceFor({ assignedToUserId: null }, deleted).remove("01CALL"));
    expect(deleted).toEqual(["01CALL"]);
  });

  it("ומנהל שרואה את כל הלידים מוחק גם את של העמית", async () => {
    const deleted: string[] = [];
    await asUser(["buyers.view_own", "leads.view_all"], () =>
      serviceFor({ assignedToUserId: OTHER }, deleted).remove("01CALL"),
    );
    expect(deleted).toEqual(["01CALL"]);
  });

  /*
   * ‎`lead_id` שמצביע לשורה שאינה קיימת אינו חוסם: `LeadsService.remove`
   * ‏מאפס את העמודה, ולכן שריד כזה הוא תיעוד ישן ולא ליד של מישהו.
   * ‏חסימה כאן הייתה מעלימה אותו מכל עין.
   */
  it("ושריד של ליד שנמחק אינו מעלים את התיעוד", async () => {
    const deleted: string[] = [];
    await asUser(SCOPED, () => serviceFor(null, deleted).remove("01CALL"));
    expect(deleted).toEqual(["01CALL"]);
  });
});

/**
 * ‎**ואותו כלל ברשימה — אחרת המסך מציג שיחה שאי אפשר לפתוח.**
 *
 * ‏הרשימה היא SQL גולמי ונבדקת מול מסד בסוויטת האינטגרציה; מה
 * ‏שנבדק כאן הוא שהתנאי **קיים** בשאילתה ושהוא נגזר מהיכולות — לא
 * ‏ניסוח מקומי שנפרד מהשער הבודד.
 */
describe("התנאי של הרשימה נושא את אותו כלל", () => {
  function sqlFor(capabilities: Capability[]): string {
    return TenantContext.run(
      { tenantId: TENANT, userId: ME, capabilities: new Set(capabilities), billingOnly: false },
      () => visibleCallsCondition(TENANT, ME, [SHARED_CONTACT]),
    ).sql;
  }

  it("סוכן: שיחה שקשורה לליד של מישהו אחר יוצאת מהרשימה", () => {
    const sql = sqlFor(SCOPED);
    expect(sql).toContain("c.lead_id IS NULL");
    expect(sql).toContain("l.assigned_to_user_id IS NOT NULL");
    expect(sql).toContain("l.assigned_to_user_id <>");
  });

  it("מי שמודול הלידים חסום אצלו אינו מקבל שיחות של לידים כלל", () => {
    const sql = sqlFor(["buyers.view_own"]);
    expect(sql).toContain("c.lead_id IS NULL");
    expect(sql).not.toContain("assigned_to_user_id");
  });

  it("ומי שרואה את כל הלידים אינו מסונן", () => {
    const sql = sqlFor(["buyers.view_own", "leads.view_all"]);
    expect(sql).not.toContain("c.lead_id");
  });

  /*
   * ‏התנאי מצמצם, ולכן הוא `AND` על האיחוד ולא ענף בתוכו. ענף
   * ‏בתוך ה-`OR` היה **מרחיב** — כלומר ההפך הגמור.
   */
  it("והוא מצמצם את האיחוד ולא נבלע בתוכו", () => {
    const sql = sqlFor(SCOPED);
    expect(sql.indexOf("c.lead_id IS NULL")).toBeLessThan(sql.indexOf("c.contact_id = ANY("));
  });
});
