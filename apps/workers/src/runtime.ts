import "./env.js";
import { availableParallelism } from "node:os";
import IORedis from "ioredis";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@prisma/client";
import { databaseConnection } from "@metavchim/shared";

/** ‏החיבורים של התהליך — Redis אחד ו-Prisma אחד, משותפים לכל המשימות. */
export const connection = new IORedis(
  process.env["REDIS_URL"] ?? "redis://localhost:6379",
  {
    maxRetriesPerRequest: null,
  },
);
/* ‏הגדרות החיבור — אותן של ה-API (`databaseConnection`) */
const db = databaseConnection(process.env["DATABASE_URL"], availableParallelism());
export const prisma = new PrismaClient({ adapter: new PrismaPg(db.pool, { schema: db.schema }) });

/**
 * ‎**כל גישה לנתוני משרד — בתוך הקשר המשרד, במקום אחד.**
 *
 * ‏הטבלאות העסקיות תחת FORCE RLS: בלי `app.tenant_id` שאילתה מחזירה אפס
 * ‏שורות בשקט, ועם הקשר נקבע היא רואה את המשרד הזה בלבד. ארבעים ושתיים
 * ‏משימות כתבו את שתי השורות האלה בעצמן; עכשיו הן עוברות כאן — אותה
 * ‏צורה כמו `withExplicitTenant` ב-API — ובדיקה מבנית חוסמת עותק חדש.
 *
 * ‏ה-`tenantId` מגיע תמיד ממקור שרת (שורת משרד או שורה שנמצאה), לעולם
 * ‏לא מקלט חיצוני.
 */
export function withTenant<T>(
  tenantId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  });
}
