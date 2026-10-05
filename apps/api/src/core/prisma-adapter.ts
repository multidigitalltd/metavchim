import { availableParallelism } from "node:os";
import { PrismaPg } from "@prisma/adapter-pg";
import { databaseConnection } from "@metavchim/shared";

/**
 * ‏המתאם של Prisma לכתובת נתונה — לשרת, לסקריפטים ולבדיקות המסד.
 * ‏ההגדרות עצמן ב-`databaseConnection`, משותפות עם ה-Workers.
 *
 * ‏קובץ נפרד ולא חלק מ-`PrismaService`: ה-seed וה-bootstrap רצים בלי
 * ‏Nest, ואינם צריכים לטעון את הדקורטורים שלו.
 */
export function prismaAdapter(url: string | undefined): PrismaPg {
  const { pool, schema } = databaseConnection(url, availableParallelism());
  return new PrismaPg(pool, { schema });
}
