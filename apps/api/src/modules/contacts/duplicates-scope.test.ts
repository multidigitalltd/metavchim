import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type { Capability } from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { DuplicatesService } from "./duplicates.service";

/**
 * ‎**מסך הכפילויות — הדלת שסורקת את כולם.**
 *
 * ‏שאר הדלתות בסבב הזה נפתחות על לקוח אחד שמזההו ידוע. זו נפתחת על
 * ‏**כל** אנשי הקשר של המשרד בבת אחת: היא מקבצת לפי גיבוב שם,
 * ‏מפענחת שם וטלפון של כל התאמה, ומציעה למזג — כלומר לכתוב מחדש
 * ‏ולמחוק (ביקורת Codex, P1).
 *
 * ‎**ולמה סינון היה תשובה גרועה כאן.** ההערה על הנתיב קובעת זאת
 * ‏מראש: „הצעת מיזוג על סמך חצי תמונה היא הצעה למחוק כרטיס שהוא לא
 * ‏רואה”. רשימה מסוננת הייתה בדיוק חצי התמונה הזו. מה שהשתנה הוא
 * ‏ש„ראייה רוחבית על הלקוחות” כבר אינה `buyers.view_all` לבדה.
 */

const TENANT = "01TENANTAAAAAAAAAAAAAAAAAA";
const USER = "01USERAAAAAAAAAAAAAAAAAAAA";

/** ‏מנהל כברירת מחדל: כל היכולות שקובעות ראייה על אנשים. */
const MANAGER: Capability[] = [
  "properties.view",
  "properties.view_all",
  "buyers.view_own",
  "buyers.view_all",
  "leads.view_own",
  "leads.view_all",
];
/** ‏אותו מנהל, אחרי שנחסמו ממנו בעלי הנכסים. */
const WITHOUT_PROPERTY_OWNERS: Capability[] = MANAGER.filter(
  (cap) => cap !== "properties.view_all",
);

function serviceFor(scanned: string[]): DuplicatesService {
  const tx = {
    contact: {
      // ‏כל קריאה כאן היא סריקה משרדית — אם הגענו לכאן, השער נפרץ
      groupBy: async () => {
        scanned.push("groupBy");
        return [];
      },
      findMany: async () => {
        scanned.push("findMany");
        return [];
      },
      count: async () => 2,
      updateMany: async () => ({ count: 0 }),
    },
    $executeRaw: async () => 0,
    duplicateDismissal: { findMany: async () => [], upsert: async () => ({}) },
  };
  const prisma = {
    withTenant: async <T>(fn: (t: typeof tx) => Promise<T>): Promise<T> => fn(tx),
  };
  return new DuplicatesService(prisma as never, {} as never, {} as never);
}

function asUser<T>(capabilities: Capability[], fn: () => T): T {
  return TenantContext.run(
    { tenantId: TENANT, userId: USER, capabilities: new Set(capabilities), billingOnly: false },
    fn,
  );
}

describe("כפילויות — ראייה משרדית מלאה או כלום", () => {
  it("מי שנחסמו ממנו בעלי הנכסים אינו מקבל את הרשימה", async () => {
    const scanned: string[] = [];
    await expect(
      asUser(WITHOUT_PROPERTY_OWNERS, () => serviceFor(scanned).findDuplicates()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    // ‏והחשוב מכך: הסריקה עצמה לא רצה, כלומר שום דבר לא פוענח
    expect(scanned).toEqual([]);
  });

  it("המיזוג — הפעולה ההרסנית — נחסם גם הוא", async () => {
    await expect(
      asUser(WITHOUT_PROPERTY_OWNERS, () =>
        serviceFor([]).merge("01SURVIVORAAAAAAAAAAAAAAAA", "01DUPAAAAAAAAAAAAAAAAAAAAA"),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("וגם „אלה לא אותו אדם”", async () => {
    await expect(
      asUser(WITHOUT_PROPERTY_OWNERS, () => serviceFor([]).dismiss("hash")),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  /*
   * ‏החצי השני: ברירת המחדל אינה משנה דבר. כל תפקיד שיש לו
   * ‎`buyers.view_all` — owner, admin, מנהל סניף — מחזיק גם את
   * ‎`properties.view_all` כברירת מחדל, ולכן המסך ממשיך לעבוד עד
   * ‏שמנהל בוחר אחרת.
   */
  it("מנהל כברירת מחדל ממשיך לקבל את המסך", async () => {
    const scanned: string[] = [];
    const groups = await asUser(MANAGER, () => serviceFor(scanned).findDuplicates());
    expect(groups).toEqual([]);
    expect(scanned).toContain("groupBy");
  });
});
