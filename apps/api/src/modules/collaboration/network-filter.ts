import { z } from "zod";
import {
  freeTextTerms,
  normalizeRange,
  priceRangeAgorot,
  type NumberRange,
} from "@metavchim/shared";
import type { PrismaService } from "../../core/prisma.service";

/**
 * סינון פיד הרשת — אותם שדות בדיוק כמו במסכי הנכסים והקונים.
 *
 * **הסינון חייב לרוץ בשרת ולא במסך.** הפיד חתוך ל-100 מודעות, ולכן
 * סינון מקומי היה מחפש רק בתוך החלון הזה — ומכריז "אין תוצאות" על
 * מודעה שקיימת ברשת אך יושבת מחוצה לו. תשובה שגויה כזו גרועה מאין
 * סינון בכלל, כי המתווך מפסיק לחפש (ביקורת Codex).
 *
 * הקובץ הזה הוא הבית של החוזה: הקונטרולר מאמת לפיו, ושני השירותים
 * (ביקושים ונכסים) גוזרים ממנו את התנאים שלהם.
 */
export const NetworkFilterSchema = z
  .object({
    /** חיפוש חופשי — עיר, שכונה, תיאור, ושם המשרד המפרסם */
    q: z.string().max(120).optional(),
    /** בשקלים; ההמרה לאגורות בשרת, כמו במסכי הרשימה */
    minPrice: z.coerce.number().min(0).optional(),
    maxPrice: z.coerce.number().min(0).optional(),
    minRooms: z.coerce.number().min(0).max(30).optional(),
    maxRooms: z.coerce.number().min(0).max(30).optional(),
  })
  .strict();

export type NetworkFilter = z.infer<typeof NetworkFilterSchema>;

/** מונחי החיפוש; ריק = אין חיפוש טקסט. */
export function networkTerms(filter: NetworkFilter): string[] {
  return freeTextTerms(filter.q);
}

/** טווח המחיר באגורות — היחידה שבה הוא נשמר. */
export function networkPrice(filter: NetworkFilter): NumberRange {
  return priceRangeAgorot(filter.minPrice, filter.maxPrice);
}

export function networkRooms(filter: NetworkFilter): NumberRange {
  return normalizeRange(filter.minRooms, filter.maxRooms);
}

/**
 * המשרדים ששמם עונה על החיפוש.
 *
 * "תן לי הכל מרימקס" הוא חיפוש טבעי ברשת, ושם המשרד יושב בטבלה אחרת
 * מזו של המודעות. במקום JOIN — שאילתה אחת שמחזירה מזהי דיירים,
 * שנכנסים כתנאי `tenantId IN (…)` לצד תנאי הטקסט האחרים.
 *
 * `tenants` אינה תחת RLS (תשתית ולא תוכן עסקי), ולכן הקריאה ישירה.
 *
 * מוחזר `[]` כשאין התאמה — הקורא מוסיף את התנאי ל-OR, ולכן רשימה
 * ריקה פשוט לא תורמת התאמות, ואינה פוסלת את שאר התנאים.
 */
export async function officeIdsMatching(
  prisma: PrismaService,
  filter: NetworkFilter,
): Promise<string[]> {
  const query = filter.q?.trim() ?? "";
  if (query === "") return [];
  const rows = await prisma.tenant.findMany({
    where: { name: { contains: query, mode: "insensitive" } },
    select: { id: true },
    take: 50,
  });
  return rows.map((row) => row.id);
}
