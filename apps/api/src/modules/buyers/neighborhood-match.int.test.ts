import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { neighborhoodKey, neighborhoodKeyMatches } from "@metavchim/shared";
import { neighborhoodKeyMatchSql } from "./buyers.service";

/**
 * ‎**הכלל שבמסד זהה לכלל שבקוד — מול Postgres אמיתי.**
 *
 * ## למה זה חייב להיות זהה
 *
 * סינון הקונים לפי שכונה מתרגם את מה שהוקלד למפתחות שקיימים, והתרגום
 * הזה קורה **בשאילתה**. כל עוד המסד רק הרחיב, ההכרעה נשארה בקוד
 * ואי-דיוק לא הזיק. מרגע שהמסד מחזיר בדיוק את התואמות — כדי שהתקרה
 * לא תחתוך התאמות אמיתיות (ביקורת Codex, P1) — כל פער בין השניים הוא
 * שכונה שנעלמת מהסינון, או אחת שנכנסת אליו שלא בצדק.
 *
 * ## למה מסד אמיתי ולא מודל
 *
 * ‎`neighborhood-filter-scope.test.ts` מחקה את `LIKE … ESCAPE` בקוד,
 * וזה תופס את רוב הטעויות — הוא אכן תפס אחת בזמן הכתיבה. אבל מודל
 * הוא ניחוש מלומד על סמנטיקה של מנוע אחר: סדר הבריחה, התנהגות על
 * מחרוזת ריקה, ותווים רב-בתיים. כאן רץ הביטוי עצמו.
 */

let owner: PrismaClient | undefined;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} חסר — הבדיקה דורשת מסד אמיתי`);
  return value;
}

beforeAll(() => {
  owner = new PrismaClient({
    datasources: { db: { url: requiredEnv("DIRECT_DATABASE_URL") } },
  });
});

afterAll(async () => {
  await owner?.$disconnect();
});

/*
 * ‏המפתחות והשאילתות שבאמת מבדילות: תחילית, גבול מילה, אמצע מילה,
 * ‏ותווי ה-LIKE עצמם — שמאז שהמסד מכריע הם הרחבה אמיתית של הכלל.
 */
const KEYS = [
  "רמת אהרון",
  "שיכון ג",
  "פרדס כץ",
  "נווה שאנן",
  "רמת גן הישנה",
  "א ב ג",
  "100% שכונה",
  "קו_תחתון",
  "שכונה!עם!סימן",
];
const QUERIES = ["", "רמת", "אהרון", "רמת א", "מת", "הרון", "ג", "כץ", "%", "_", "!", "100%", "קו_", "שכונה!"];

describe("הכלל ב-SQL זהה לכלל ב-JavaScript", () => {
  it.each(QUERIES)("‏עבור „%s”", async (query) => {
    const queryKey = neighborhoodKey(query);
    const rows = await owner!.$queryRaw<{ k: string; m: boolean }[]>`
      SELECT k, ${neighborhoodKeyMatchSql(queryKey)} AS m
        FROM unnest(${KEYS}::text[]) AS k
    `;
    expect(rows).toHaveLength(KEYS.length);
    for (const row of rows) {
      expect(`${row.k} ⟵ ${query}: ${String(row.m)}`).toBe(
        `${row.k} ⟵ ${query}: ${String(neighborhoodKeyMatches(row.k, queryKey))}`,
      );
    }
  });

  /*
   * ‎**והתקרה הוסרה, ולכן אין דרך שהתאמה אמיתית תיחתך.** הבדיקה כאן
   * היא על ההתנהגות ולא על המקור: מאתיים מפתחות שכולם תואמים חייבים
   * לחזור במלואם.
   */
  it("‏ומאתיים תואמות חוזרות כולן", async () => {
    const many = Array.from({ length: 200 }, (_, i) => `רמת מספר ${i}`);
    const rows = await owner!.$queryRaw<{ k: string }[]>`
      SELECT k FROM unnest(${many}::text[]) AS k WHERE ${neighborhoodKeyMatchSql("רמת")}
    `;
    expect(rows).toHaveLength(200);
  });
});
