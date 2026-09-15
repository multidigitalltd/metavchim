import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cityForNeighborhood } from "./neighborhood-city";

/**
 * ‎**השלמת העיר מהשכונה — מול מסד אמיתי, כי זו שאילתה גולמית.**
 *
 * ‏מה שאין לו שגיאת קומפילציה ואין לו בדיקת יחידה: שם עמודה, סדר
 * ‏הדירוג, והקיפול ב-SQL. הבדיקה קוראת ל**פונקציה עצמה** ואינה
 * ‏מעתיקה את הטקסט שלה — עותק היה מתיישן ברגע שמישהו יערוך אותה.
 */

const TENANT = "01CITYFROMNBTENANTAAAAAAAA";
let owner: PrismaClient | undefined;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} חסר — הבדיקה דורשת מסד אמיתי`);
  return value;
}

async function resolve(neighborhood: string): Promise<string | null> {
  return owner!.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return cityForNeighborhood(tx, neighborhood);
  });
}

beforeAll(async () => {
  owner = new PrismaClient({
    datasources: { db: { url: requiredEnv("DIRECT_DATABASE_URL") } },
  });
  await owner.$executeRaw`
    INSERT INTO tenants (id, name, created_at, updated_at)
    VALUES (${TENANT}, 'משרד השלמת עיר', now(), now())
    ON CONFLICT (id) DO NOTHING
  `;

  /* [id, city, neighborhood, deleted] */
  const rows: [string, string | null, string | null, boolean][] = [
    /* „פרדס כץ” — רוב ברור בבני ברק, ובשלוש צורות כתיב */
    ["01CITYFROMNBAAAAAAAAAAAAAA", "בני ברק", "פרדס כץ", false],
    ["01CITYFROMNBBBBBBBBBBBBBBB", "בני ברק", "פרדס-כץ", false],
    ["01CITYFROMNBCCCCCCCCCCCCCC", "בני ברק", "שכונת פרדס כץ", false],
    /* ‏שורה שגויה יחידה — הרוב מנצח אותה */
    ["01CITYFROMNBDDDDDDDDDDDDDD", "חיפה", "פרדס כץ", false],
    /* ‏תיקו אמיתי: „שיכון ג'” אחת בכל עיר */
    ["01CITYFROMNBEEEEEEEEEEEEEE", "בני ברק", "שיכון ג'", false],
    ["01CITYFROMNBFFFFFFFFFFFFFF", "אשדוד", "שיכון ג", false],
    /* ‏נמחק — אינו נספר */
    ["01CITYFROMNBGGGGGGGGGGGGGG", "חיפה", "רק במחוק", true],
    /* ‏בלי עיר — אינו מקור */
    ["01CITYFROMNBHHHHHHHHHHHHHH", null, "בלי עיר", false],
  ];
  for (const [id, city, neighborhood, deleted] of rows) {
    await owner.$executeRaw`
      INSERT INTO properties (id, tenant_id, status, city, neighborhood, deal_type, deleted_at, created_at, updated_at)
      VALUES (${id}, ${TENANT}, 'draft', ${city}, ${neighborhood}, 'sale',
              ${deleted ? new Date() : null}, now(), now())
      ON CONFLICT (id) DO NOTHING
    `;
  }
});

afterAll(async () => {
  if (owner === undefined) return;
  const db = owner;
  await db.$executeRaw`DELETE FROM properties WHERE tenant_id = ${TENANT}`;
  await db.$executeRaw`DELETE FROM tenants WHERE id = ${TENANT}`;
  await db.$disconnect();
});

describe("cityForNeighborhood", () => {
  it("הרוב מנצח — „פרדס כץ” היא בני ברק למרות שורה אחת בחיפה", async () => {
    await expect(resolve("פרדס כץ")).resolves.toBe("בני ברק");
  });

  it("הקיפול חל — כתיבים שונים עונים על אותה שאלה", async () => {
    for (const written of ["פרדס-כץ", "שכונת פרדס כץ", "  פרדס   כץ  "]) {
      await expect(resolve(written)).resolves.toBe("בני ברק");
    }
  });

  it("תיקו אמיתי אינו תשובה — „שיכון ג'” קיימת בשתי ערים", async () => {
    await expect(resolve("שיכון ג'")).resolves.toBeNull();
  });

  it("שכונה שאינה מוכרת — אין תשובה, והשדה יישאר ריק", async () => {
    await expect(resolve("שכונה שמעולם לא הוקלדה")).resolves.toBeNull();
  });

  it("נמחקים ושורות בלי עיר אינם מקור", async () => {
    await expect(resolve("רק במחוק")).resolves.toBeNull();
    await expect(resolve("בלי עיר")).resolves.toBeNull();
  });

  it("שם שאין בו אות אינו שאלה, ואינו פונה למסד", async () => {
    for (const blank of ["", "   ", "-", "'"]) {
      await expect(resolve(blank)).resolves.toBeNull();
    }
  });
});
