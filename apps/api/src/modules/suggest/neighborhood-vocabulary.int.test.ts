import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mergeNeighborhoodUses, neighborhoodKey, suggestNeighborhoods } from "@metavchim/shared";
import { foldedNeighborhood, neighborhoodVocabulary } from "./neighborhood-vocabulary";

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
 * 6. ‎**והקיפול שב-SQL זהה לזה שב-JavaScript** — נבדק תו-תו, כי
 *    שני הצדדים תלויים בזהות הזו לשני דברים מנוגדים.
 */

const TENANT = "01SUGGESTTENANTAAAAAAAAAAA";
let owner: PrismaClient | undefined;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} חסר — הבדיקה דורשת מסד אמיתי`);
  return value;
}

/** השאילתה חייבת הקשר דייר; כאן הוא נקבע במפורש, כמו ב-`withTenant`. */
async function vocabulary(
  city: string,
  queryKey = "",
): Promise<{ name: string; count: number }[]> {
  return owner!.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return neighborhoodVocabulary(tx, city, queryKey);
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
    /*
     * ‎**קונה רב-ערים.** `cities` ו-`neighborhoods` הם מערכים שטוחים
     * ובלתי תלויים, ולכן אין דרך לדעת איזו שכונה שייכת לאיזו עיר.
     * הקונה הזה מוודא שהשאילתה על „בני ברק” אינה גוררת את „נווה
     * שאנן” שלו — מה שהיה גורם לטופס הנכס בבני ברק להציע שכונה
     * מחיפה.
     */
    [
      "01SUGGESTBUYERDDDDDDDDDDDD",
      JSON.stringify({
        cities: ["בני ברק", "חיפה"],
        neighborhoods: ["רק אצל קונה רב ערים"],
      }),
    ],
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
  /*
   * ‎**התקרה חתכה לפני הסינון** (ביקורת Codex).
   *
   * במשרד עם יותר מ-400 כתיבים שונים, השכונה ה-401 לפי שכיחות
   * הייתה בלתי נראית לצמיתות — גם בהקלדה מדויקת שלה — כי הסינון
   * לפי מה שהוקלד קרה בקוד, על מה שכבר נחתך.
   */
  it("שכונה מעבר לתקרה נמצאת כשמקלידים אותה", async () => {
    const needle = "שכונה נדירה מאוד";
    await owner!.$executeRaw`
      INSERT INTO properties (id, tenant_id, status, city, neighborhood, deal_type, created_at, updated_at)
      SELECT 'RARE' || lpad(g::text, 22, '0'), ${TENANT}, 'draft', 'עיר עמוסה',
             'שכונה מספר ' || g, 'sale', now(), now()
        FROM generate_series(1, 450) AS g
      ON CONFLICT (id) DO NOTHING
    `;
    await owner!.$executeRaw`
      INSERT INTO properties (id, tenant_id, status, city, neighborhood, deal_type, created_at, updated_at)
      VALUES ('01SUGGESTRAREAAAAAAAAAAAAA', ${TENANT}, 'draft', 'עיר עמוסה', ${needle}, 'sale', now(), now())
      ON CONFLICT (id) DO NOTHING
    `;

    /* בלי סינון — היא נופלת מחוץ לתקרה, וזה בסדר. */
    const unfiltered = (await vocabulary("עיר עמוסה")).map((u) => u.name);
    expect(unfiltered).not.toContain(needle);

    /* עם המפתח שהוקלד — היא חייבת להימצא. */
    const filtered = (await vocabulary("עיר עמוסה", "שכונה נדירה")).map((u) => u.name);
    expect(filtered).toContain(needle);

    await owner!.$executeRaw`DELETE FROM properties WHERE tenant_id = ${TENANT} AND city = 'עיר עמוסה'`;
  });

  /*
   * ‎**קונה אחד עם אותה שכונה פעמיים ניפח כתיב לכולם.** הסכימה
   * מתירה זאת, וייבוא או כתיבה דרך ה-API מייצרים את זה בפועל.
   */
  it("כפילות אצל אותו קונה נספרת פעם אחת", async () => {
    const contactId = "01SUGGESTCONTACTAAAAAAAAAA";
    await owner!.$executeRaw`
      INSERT INTO buyers (id, tenant_id, contact_id, requirements, deal_type, source, created_at, updated_at)
      VALUES ('01SUGGESTBUYERDUPEAAAAAAAA', ${TENANT}, ${contactId},
              ${JSON.stringify({ cities: ["בני ברק"], neighborhoods: ["כפול כפול", "כפול כפול", "כפול כפול"] })}::jsonb,
              'sale', 'manual', now(), now())
      ON CONFLICT (id) DO NOTHING
    `;
    const found = (await vocabulary("")).find((u) => u.name === "כפול כפול");
    expect(found?.count).toBe(1);
    await owner!.$executeRaw`DELETE FROM buyers WHERE id = '01SUGGESTBUYERDUPEAAAAAAAA'`;
  });

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
   * ‎**קונה שמחפש בכמה ערים אינו תורם לשאילתה ממוקדת-עיר.** אין
   * בנתונים קשר בין שכונה לעיר, ולכן צירוף כזה היה מציע בבני ברק
   * שכונה שהקונה התכוון אליה בחיפה — כלומר הפיצ'ר היה מלמד להזין
   * שכונה שגויה, בדיוק ההפך ממטרתו.
   */
  it("שכונות של קונה רב-ערים אינן נכנסות לשאילתה על עיר אחת", async () => {
    const scoped = (await vocabulary("בני ברק")).map((u) => u.name);
    expect(scoped).not.toContain("רק אצל קונה רב ערים");
  });

  it("ובלי סינון עיר הן כן — הן עדיין אוצר מילים של המשרד", async () => {
    const all = (await vocabulary("")).map((u) => u.name);
    expect(all).toContain("רק אצל קונה רב ערים");
  });

  /*
   * המסד מחזיר שלוש צורות; מה שמגיע למתווך הוא הצעה **אחת** — זו
   * שהמשרד כבר מדבר בה. זו הבדיקה שסוגרת את המעגל מהשאילתה ועד
   * למה שנראה על המסך.
   */
  it("שלוש צורות במסד ⟵ הצעה אחת, הנפוצה", async () => {
    expect(suggestNeighborhoods(await vocabulary(""), "שיכון")).toEqual(["שיכון ג'"]);
  });

  /*
   * ‎**הבדיקה שמחזיקה את כל השאר.**
   *
   * ‎`foldedNeighborhood` הוא תרגום של `neighborhoodKey` לשפת המסד,
   * ושני מימושים שאמורים להיות זהים נפרדים בשקט. כאן הם מורצים זה
   * מול זה על הקלטים שבאמת מבדילים ביניהם: גרשיים בכל צורותיהם,
   * מקף עברי, קידומת „שכונת ”, רווח בלתי שביר שמגיע מהדבקה, ותווים
   * שאינם עבריים.
   *
   * ‎**למה זה לא פרט טכני.** ההפרה הקודמת הייתה בדיוק כאן: `translate`
   * הפך גרשיים לרווח במקום למחוק אותם, ולכן `רמת ח"ן` נשמר במסד
   * כ„רמת ח ן” בעוד המפתח שהוקלד הוא „רמת חן” — והשכונה לא הגיעה
   * לקוד מעולם. ובאותה שורה, המקף העברי נמחק במקום להפוך לרווח.
   */
  it("הקיפול ב-SQL זהה לקיפול ב-JavaScript", async () => {
    const inputs = [
      'רמת ח"ן',
      "רמת חן",
      "שיכון ג'",
      "שיכון ג׳",
      'שיכון ג״',
      "שכונת שיכון ג",
      "שכונת   שיכון   ג",
      "רמת־אהרון",
      "רמת-אהרון",
      "רמת–אהרון",
      "  כפול   רווח  ",
      "נווה\u00a0שאנן",
      "גן\u2009העיר",
      "בית\ufeffהכרם",
      "‘גבעה’ „חדשה”",
      "Ramat Gan",
      '"\'',
      "   ",
      "שכונתיים",
    ];
    for (const input of inputs) {
      const [row] = await owner!.$queryRaw<{ folded: string }[]>`
        SELECT ${foldedNeighborhood(Prisma.sql`${input}::text`)} AS folded
      `;
      expect(`${input} ⟵ ${row!.folded}`).toBe(`${input} ⟵ ${neighborhoodKey(input)}`);
    }
  });

  /*
   * ‎**הסינון במסד חייב להעביר את מה שהקוד היה מקבל** (ביקורת Codex).
   *
   * שני השמות האלה חיים בעיר משלהם כדי שהתקרה לא תסתיר את הכישלון:
   * אם הסינון פוסל אותם, הם פשוט אינם — בדיוק כפי שהמתווך חווה זאת,
   * הקלדה מדויקת של השם שהוא רואה בכרטיס אחר, ואפס הצעות.
   */
  it("שם עם גרשיים ושם עם מקף עברי נמצאים לפי המפתח שהוקלד", async () => {
    const quoted = 'רמת ח"ן';
    const dashed = "שיכון ד־ה";
    await owner!.$executeRaw`
      INSERT INTO properties (id, tenant_id, status, city, neighborhood, deal_type, created_at, updated_at)
      VALUES ('01SUGGESTQUOTEAAAAAAAAAAAA', ${TENANT}, 'draft', 'עיר פיסוק', ${quoted}, 'sale', now(), now()),
             ('01SUGGESTDASHAAAAAAAAAAAAA', ${TENANT}, 'draft', 'עיר פיסוק', ${dashed}, 'sale', now(), now())
      ON CONFLICT (id) DO NOTHING
    `;

    const byQuoted = (await vocabulary("עיר פיסוק", neighborhoodKey(quoted))).map((u) => u.name);
    expect(byQuoted).toContain(quoted);

    const byDashed = (await vocabulary("עיר פיסוק", neighborhoodKey(dashed))).map((u) => u.name);
    expect(byDashed).toContain(dashed);

    await owner!.$executeRaw`DELETE FROM properties WHERE tenant_id = ${TENANT} AND city = 'עיר פיסוק'`;
  });

  /*
   * ‎**קונה אחד ששמר שתי צורות של אותה שכונה** (ביקורת Codex).
   *
   * הצמצום היה על השם הגולמי, ולכן שלוש הצורות עברו כשלוש שורות;
   * הקיפול בקוד איחד אותן וסכם את המונים, וקונה **בודד** נראה
   * כשלושה כרטיסים. זה מנפח בדיוק את הצורה שהמשרד כתב הכי הרבה
   * פעמים בטעות — כלומר ההצעה מלמדת את הטעות.
   */
  it("שלוש צורות אצל אותו קונה נספרות כקונה אחד", async () => {
    const contactId = "01SUGGESTCONTACTAAAAAAAAAA";
    await owner!.$executeRaw`
      INSERT INTO buyers (id, tenant_id, contact_id, requirements, deal_type, source, created_at, updated_at)
      VALUES ('01SUGGESTBUYERFORMSAAAAAAA', ${TENANT}, ${contactId},
              ${JSON.stringify({
                cities: ["רחובות"],
                neighborhoods: ["בן גוריון", "בן־גוריון", "שכונת בן גוריון"],
              })}::jsonb,
              'sale', 'manual', now(), now())
      ON CONFLICT (id) DO NOTHING
    `;

    const merged = mergeNeighborhoodUses(await vocabulary("רחובות"));
    const found = merged.find((u) => neighborhoodKey(u.name) === "בן גוריון");
    expect(found?.count).toBe(1);

    await owner!.$executeRaw`DELETE FROM buyers WHERE id = '01SUGGESTBUYERFORMSAAAAAAA'`;
  });
});
