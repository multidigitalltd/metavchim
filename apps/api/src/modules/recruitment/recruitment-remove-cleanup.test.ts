import { describe, expect, it } from "vitest";
import { TenantContext } from "../../common/tenant-context";
import { RecruitmentService } from "./recruitment.service";
import type { PrismaService } from "../../core/prisma.service";
import type { PropertiesService } from "../properties/properties.service";

/**
 * ‎**מחיקת שורת גיוס לוקחת איתה את כל הפולואפים שלה** (ביקורת
 * ‏Codex, P2).
 *
 * ‏הניקוי סינן `status: "open"`, ולכן משימה שכבר בוצעה נשארה מחוץ
 * ‏לשתי השאילתות: היא המשיכה להופיע ברשימה בלי תווית שאפשר לפתור,
 * ‏ותיבת הסימון החזירה אותה למצב פתוח — `TasksService.update` אינו
 * ‏בודק מחדש את הישות שהמשימה תלויה עליה. משימה פתוחה על שורה
 * ‏שאיננה, ואיתה אירוע ביומן.
 *
 * ‏מה שמפריד בין שתי השאילתות אינו הסטטוס אלא **האם יש אירוע ביומן
 * ‏לנקות**: עם אירוע — סימון והמתנה לסבב; בלעדיו — מחיקה.
 */

const TENANT = "01TENANTAAAAAAAAAAAAAAAAAA";
const TARGET = "01RECRUITAAAAAAAAAAAAAAAAA";

type Where = Record<string, unknown>;

function serviceFor(seen: { marked: Where[]; deleted: Where[] }): RecruitmentService {
  const tx = {
    $queryRaw: async () => [],
    recruitmentTarget: { updateMany: async () => ({ count: 1 }) },
    task: {
      updateMany: async (args: { where: Where }) => {
        seen.marked.push(args.where);
        return { count: 0 };
      },
      deleteMany: async (args: { where: Where }) => {
        seen.deleted.push(args.where);
        return { count: 0 };
      },
    },
  };
  const prisma = {
    withTenant: async <T>(fn: (t: typeof tx) => Promise<T>): Promise<T> => fn(tx),
  } as unknown as PrismaService;
  return new RecruitmentService(prisma, {} as unknown as PropertiesService);
}

async function remove(seen: { marked: Where[]; deleted: Where[] }): Promise<void> {
  await TenantContext.run(
    {
      tenantId: TENANT,
      userId: "01USERAAAAAAAAAAAAAAAAAAAA",
      capabilities: new Set(),
      billingOnly: false,
    },
    () => serviceFor(seen).remove(TARGET),
  );
}

describe("‏מחיקת שורת גיוס — הניקוי אינו מסונן לפי סטטוס", () => {
  it("שתי השאילתות נוגעות בכל הפולואפים של השורה", async () => {
    const seen = { marked: [] as Where[], deleted: [] as Where[] };
    await remove(seen);

    expect(seen.marked).toHaveLength(1);
    expect(seen.deleted).toHaveLength(1);
    for (const where of [...seen.marked, ...seen.deleted]) {
      expect(where["entityType"]).toBe("recruitment");
      expect(where["entityId"]).toBe(TARGET);
      /* ‏משימה שבוצעה נשארה בחוץ, וניתן היה לפתוח אותה מחדש */
      expect("status" in where).toBe(false);
    }
  });

  it("‏וההפרדה ביניהן היא האירוע ביומן, לא הסטטוס", async () => {
    const seen = { marked: [] as Where[], deleted: [] as Where[] };
    await remove(seen);
    expect(seen.marked[0]?.["googleEventId"]).toEqual({ not: null });
    expect(seen.deleted[0]?.["googleEventId"]).toBeNull();
  });
});
