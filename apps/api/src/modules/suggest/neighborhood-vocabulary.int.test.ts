import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { suggestNeighborhoods } from "@metavchim/shared";
import { neighborhoodVocabulary } from "./neighborhood-vocabulary";

/**
 * ‎**אוצר השכונות — מול מסד אמיתי, כי זו שאילתה גולמית.**
 *
 * ## למה זו בדיקת אינטגרציה ולא בדיקת יחידה
 *
 * הקיפול והדירוג נבדקים כבדיקת יחידה בחבילה המשותפת ואינם צריכים
 * מסד. מה שכן צריך מסד הוא **ה-SQL עצמו**: שם עמודה שגוי, טיפוס לא
 * תואם, או `jsonb` שאינו מערך אינם נתפסים על ידי הקומפיילר ואינם
 * נתפסים על ידי אף בדיקת יחידה — הם נתפסים בזמן ריצה, אצל המשתמש.
 *
 * ‎**הבדיקה קוראת לפונקציה עצמה** ולא מעתיקה את הטקסט שלה. בדיקה
 * שמעתיקה SQL בודקת עותק, ומתיישנת בשקט ברגע שמישהו עורך את המקור.
 *
 * ## מה נבדק בפועל
 *
 * 1. השאילתה רצה ומחזירה את מה ששני המקורות מכילים.
 * 2. שכונה של קונה שאצלו `neighborhoods` אינו מערך אינה מפילה אותה.
 * 3. נמחקים, ריקים ו-NULL אינם נספרים.
 * 4. סינון העיר מצמצם את שני המקורות.
 * 5. וכשמחברים לקיפול — שלוש צורות הופכות להצעה אחת.
 */

const TENANT = "01SUGGESTTENANTAAAAAAAAAAA";
let owner: PrismaClient | undefined;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} חסר — הבדיקה דורשת מסד אמיתי`);
  return value;
}

/** השאילתה חייבת הקשר דייר; כאן הוא נקבע במפורש, כמו ב-`withTenant`. */
async function vocabulary(city: string): Promise<{ name: string; count: number }[]> {
  return owner!.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return neighborhoodVocabulary(tx, city);
  });
}

beforeAll(async () => {
  owner = new PrismaClient({
    datasources: { db: { url: requiredEnv("DIRECT_DATABASE_URL") } },
  });

  await owner.$executeRaw`
    INSERT INTO tenants (id, name, created_at, updated_at)
    VALUES (${TENANT}, 'משרד שכונות', now(), now())
    ON CONFLICT (id) DO NOTHING
  `;

  /*
   * שלוש צורות של אותה שכונה, בשני המקורות — בדיוק המצב שהפיצ'ר
   * נולד בשבילו: כל מתווך הקליד אחרת, ואיש לא ידע.
   */
  const properties: [string, string, string | null, boolean][] = [
    ["01SUGGESTPROPAAAAAAAAAAAAA", "בני ברק", "שיכון ג'", false],
    ["01SUGGESTPROPBBBBBBBBBBBBB", "בני ברק", "שיכון ג'", false],
    ["01SUGGESTPROPCCCCCCCCCCCCC", "בני ברק", "שיכון ג", false],
    ["01SUGGESTPROPDDDDDDDDDDDDD", "בני ברק", "   ", false],
    ["01SUGGESTPROPEEEEEEEEEEEEE", "בני ברק", null, false],
    ["01SUGGESTPROPFFFFFFFFFFFFF", "בני ברק", "שכונה שנמחקה", true],
    ["01SUGGESTPROPGGGGGGGGGGGGG", "חיפה", "נווה שאנן", false],
  ];
  for (const [id, city, neighborhood, deleted] of properties) {
    await owner.$executeRaw`
      INSERT INTO properties (id, tenant_id, status, city, neighborhood, deal_type, deleted_at, created_at, updated_at)
      VALUES (${id}, ${TENANT}, 'draft', ${city}, ${neighborhood}, 'sale',
              ${deleted ? new Date() : null}, now(), now())
      ON CONFLICT (id) DO NOTHING
    `;
  }

  const contactId = "01SUGGESTCONTACTAAAAAAAAAA";
  await owner.$executeRaw`
    INSERT INTO contacts (id, tenant_id, name_encrypted, phone_encrypted, phone_hash, created_at, updated_at)
    VALUES (${contactId}, ${TENANT}, 'x', 'y', 'suggest-hash', now(), now())
    ON CONFLICT (id) DO NOTHING
  `;

  const buyers: [string, string][] = [
    /* צורה שלישית של אותה שכונה, ועוד אחת שקיימת רק אצל קונים */
    [
      "01SUGGESTBUYERAAAAAAAAAAAA",
      JSON.stringify({ cities: ["בני ברק"], neighborhoods: ["שכונת שיכון ג׳", "פרדס כץ"] }),
    ],
    /* בלי המפתח כלל */
    ["01SUGGESTBUYERBBBBBBBBBBBB", JSON.stringify({ cities: ["בני ברק"] })],
    /*
     * ‎**המקרה שמפיל את הכול בלי השמירה:** `neighborhoods` שאינו
     * מערך. `jsonb_array_elements_text` על סקלר זורק, וקונה בודד
     * כזה היה משבית את ההצעות לכל המשרד.
     */
    [
      "01SUGGESTBUYERCCCCCCCCCCCC",
      JSON.stringify({ cities: ["בני ברק"], neighborhoods: "לא מערך" }),
    ],
  ];
  for (const [id, requirements] of buyers) {
    await owner.$executeRaw`
      INSERT INTO buyers (id, tenant_id, contact_id, requirements, deal_type, source, created_at, updated_at)
      VALUES (${id}, ${TENANT}, ${contactId}, ${requirements}::jsonb, 'sale', 'manual', now(), now())
      ON CONFLICT (id) DO NOTHING
    `;
  }
});

afterAll(async () => {
  /*
   * ‎`owner?.$executeRaw\`…\`` אינו חוקי — אי אפשר לתייג תבנית
   * בשרשור אופציונלי. שער אחד למעלה, ולא ניסיון להתחכם בכל שורה.
   */
  if (owner === undefined) return;
  await owner.$executeRaw`DELETE FROM buyers WHERE tenant_id = ${TENANT}`;
  await owner.$executeRaw`DELETE FROM contacts WHERE tenant_id = ${TENANT}`;
  await owner.$executeRaw`DELETE FROM properties WHERE tenant_id = ${TENANT}`;
  await owner.$executeRaw`DELETE FROM tenants WHERE id = ${TENANT}`;
  await owner.$disconnect();
});

describe("אוצר השכונות מול מסד אמיתי", () => {
  it("קורא משני המקורות — עמודת הנכס ומערך הקונה", async () => {
    const names = (await vocabulary("")).map((u) => u.name);
    expect(names).toContain("שיכון ג'");
    expect(names).toContain("שכונת שיכון ג׳");
    expect(names).toContain("פרדס כץ");
  });

  /*
   * ‎**הטענה החשובה ביותר בקובץ.** בלי `jsonb_typeof` השאילתה זורקת
   * `cannot extract elements from a scalar`, וההצעות מתות לכל
   * המשרד בגלל שורה אחת פגומה.
   */
  it("קונה עם neighborhoods שאינו מערך אינו מפיל את השאילתה", async () => {
    await expect(vocabulary("")).resolves.toBeInstanceOf(Array);
  });

  it("נמחק, ריק ו-NULL אינם נספרים", async () => {
    const names = (await vocabulary("")).map((u) => u.name);
    expect(names).not.toContain("שכונה שנמחקה");
    expect(names.every((n) => n.trim() !== "")).toBe(true);
  });

  it("מונה נכון — שתי רשומות של אותה צורה", async () => {
    const found = (await vocabulary("")).find((u) => u.name === "שיכון ג'");
    expect(found?.count).toBe(2);
  });

  it("סינון עיר מצמצם את שני המקורות", async () => {
    const names = (await vocabulary("בני ברק")).map((u) => u.name);
    expect(names).not.toContain("נווה שאנן");
    expect(names).toContain("שיכון ג'");
    expect(names).toContain("פרדס כץ");
  });

  /*
   * המסד מחזיר שלוש צורות; מה שמגיע למתווך הוא הצעה **אחת** — זו
   * שהמשרד כבר מדבר בה. זו הבדיקה שסוגרת את המעגל מהשאילתה ועד
   * למה שנראה על המסך.
   */
  it("שלוש צורות במסד ⟵ הצעה אחת, הנפוצה", async () => {
    expect(suggestNeighborhoods(await vocabulary(""), "שיכון")).toEqual(["שיכון ג'"]);
  });
});
