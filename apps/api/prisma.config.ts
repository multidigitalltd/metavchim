import { defineConfig } from "prisma/config";

/**
 * ‏הגדרות ה-CLI של Prisma — מיגרציות, ייצור הקליינט וה-seed.
 *
 * ‏המיגרציות רצות עם תפקיד הבעלים (`DIRECT_DATABASE_URL`), לא עם תפקיד
 * ‏האפליקציה שהשרת מתחבר בו — הפרדת הרשאות (docs/04 §2). הכתובת נקראת
 * ‏מהסביבה ואינה חובה כאן: ייצור הקליינט בבנייה אינו צריך מסד, ו-`migrate`
 * ‏בלעדיה נעצר בשגיאה מפורשת.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env["DIRECT_DATABASE_URL"],
  },
});
