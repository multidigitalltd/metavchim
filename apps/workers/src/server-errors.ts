import { jerusalemWallParts, serverErrorSignature } from "@metavchim/shared";
import { prisma } from "./runtime.js";

/**
 * ‏משימה שנכשלה סופית — לאותה טבלה שה-API סופר בה, ומשם לסיכום השגיאות
 * ‏היומי למנהלי הפלטפורמה (apps/api/src/core/server-errors.ts). אותה
 * ‏חתימה ואותו יום ישראלי, כך ששני התהליכים נספרים באותן שורות.
 *
 * ‏לעולם אינו זורק: מסד שנפל אינו סיבה להפיל את ה-Worker, והכישלון נרשם
 * ‏ביומן כמו קודם.
 */
export async function recordJobFailure(source: string, message: string, at = new Date()): Promise<void> {
  const day = jerusalemWallParts(at).date;
  const signature = serverErrorSignature(message);
  try {
    await prisma.$executeRaw`
      INSERT INTO server_errors (day, source, signature, count, first_at, last_at)
      VALUES (${day}::date, ${source.slice(0, 120)}, ${signature}, 1, ${at}, ${at})
      ON CONFLICT (day, source, signature) DO UPDATE SET
        count = server_errors.count + 1,
        last_at = GREATEST(server_errors.last_at, EXCLUDED.last_at)`;
  } catch (error: unknown) {
    console.warn(`[server-errors] הרישום נכשל: ${String(error)}`);
  }
}
