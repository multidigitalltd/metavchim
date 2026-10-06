import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { neighborhoodKey } from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { prismaAdapter } from "../../core/prisma-adapter";
import { PrismaService } from "../../core/prisma.service";
import { matchingPropertyNeighborhoods } from "../suggest/neighborhood-vocabulary";

/**
 * ‎**סינון הנכסים לפי שכונה — השאילתה הגולמית, מול מסד אמיתי.**
 *
 * ‏הכלל עצמו (קיפול, תחילית מגבול מילה) נבדק בחבילה המשותפת וב-
 * ‏`neighborhood-match.int.test.ts`. כאן נבדק מה שרק מסד יודע: שהקיפול
 * ‏רץ על העמודה הגולמית ומחזיר את הכתיבים כפי שנשמרו, ושהשאילתה —
 * ‏שאין בה `tenant_id` בכוונה — אינה רואה נכס של משרד אחר.
 *
 * ‎**כתפקיד האפליקציה ולא כבעלים**: הבעלים במסד הבדיקה הוא Superuser
 * ‏ועוקף RLS, ולכן בדיקת בידוד כבעלים הייתה עוברת גם על שאילתה פרוצה.
 */

const TENANT = "01NBHDFILTERTENANTAAAAAAAA";
const OTHER = "01NBHDFILTERTENANTBBBBBBBB";

let owner: PrismaClient;
let app: PrismaService;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} חסר — הבדיקה דורשת מסד אמיתי`);
  return value;
}

/** מה שהשירות עושה: הקשר דייר, טרנזקציה, והמפתח של מה שהוקלד. */
function matching(tenantId: string, typed: string): Promise<string[]> {
  return TenantContext.run(
    { tenantId, userId: "", capabilities: new Set(), billingOnly: false },
    () => app.withTenant((tx) => matchingPropertyNeighborhoods(tx, neighborhoodKey(typed))),
  ).then((names) => [...names].sort());
}

beforeAll(async () => {
  owner = new PrismaClient({ adapter: prismaAdapter(requiredEnv("DIRECT_DATABASE_URL")) });
  app = new PrismaService(requiredEnv("APP_DATABASE_URL"));

  for (const [id, name] of [
    [TENANT, "משרד הסינון"],
    [OTHER, "משרד אחר"],
  ] as const) {
    await owner.$executeRaw`
      INSERT INTO tenants (id, name, created_at, updated_at)
      VALUES (${id}, ${name}, now(), now())
      ON CONFLICT (id) DO NOTHING
    `;
  }

  const rows: [string, string, string | null, boolean][] = [
    /* שלוש צורות של אותה שכונה — כל מתווך הקליד אחרת */
    ["01NBHDFILTERPROPAAAAAAAAAA", TENANT, "שיכון ג'", false],
    ["01NBHDFILTERPROPBBBBBBBBBB", TENANT, "שכונת שיכון ג", false],
    ["01NBHDFILTERPROPCCCCCCCCCC", TENANT, "שיכון ג׳", false],
    ["01NBHDFILTERPROPDDDDDDDDDD", TENANT, "רמת אהרון", false],
    ["01NBHDFILTERPROPEEEEEEEEEE", TENANT, "שיכון ותיקים", true],
    ["01NBHDFILTERPROPFFFFFFFFFF", TENANT, null, false],
    /* ‏של המשרד השני — תואמת בדיוק את מה שהראשון יקליד */
    ["01NBHDFILTERPROPGGGGGGGGGG", OTHER, "שיכון גימל", false],
  ];
  for (const [id, tenantId, neighborhood, deleted] of rows) {
    await owner.$executeRaw`
      INSERT INTO properties (id, tenant_id, status, city, neighborhood, deal_type, deleted_at, created_at, updated_at)
      VALUES (${id}, ${tenantId}, 'draft', 'בני ברק', ${neighborhood}, 'sale',
              ${deleted ? new Date() : null}, now(), now())
      ON CONFLICT (id) DO NOTHING
    `;
  }
});

afterAll(async () => {
  if (owner === undefined) return;
  await owner.$executeRaw`DELETE FROM properties WHERE tenant_id IN (${TENANT}, ${OTHER})`;
  await owner.$executeRaw`DELETE FROM tenants WHERE id IN (${TENANT}, ${OTHER})`;
  await owner.$disconnect();
  await app?.$disconnect();
});

describe("סינון הנכסים לפי שכונה מול מסד אמיתי", () => {
  it("‏כל הכתיבים של אותה שכונה, כפי שנשמרו", async () => {
    expect(await matching(TENANT, "שיכון ג'")).toEqual(
      ["שיכון ג'", "שיכון ג׳", "שכונת שיכון ג"].sort(),
    );
  });

  it("‏מגבול מילה כן, מאמצע מילה לא", async () => {
    expect(await matching(TENANT, "אהרון")).toEqual(["רמת אהרון"]);
    expect(await matching(TENANT, "הרון")).toEqual([]);
  });

  it("‏נכס שנמחק אינו מציע את השכונה שלו", async () => {
    expect(await matching(TENANT, "שיכון ותיקים")).toEqual([]);
  });

  /*
   * ‏השאילתה אינה מסננת לפי משרד בעצמה — RLS עושה את זה. „שיכון”
   * ‏תואם גם את „שיכון גימל” של המשרד השני, ולכן היעדרה הוא ההוכחה.
   * ‏הבדיקה ההפוכה מוודאת שהשורה קיימת ונראית למשרד שלה, אחרת
   * ‏ההיעדר לא היה מוכיח דבר.
   */
  it("‏אינו רואה שכונות של משרד אחר", async () => {
    expect(await matching(TENANT, "שיכון")).not.toContain("שיכון גימל");
    expect(await matching(OTHER, "שיכון")).toEqual(["שיכון גימל"]);
  });
});
