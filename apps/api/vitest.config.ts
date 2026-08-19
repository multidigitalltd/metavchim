import { configDefaults, defineConfig } from "vitest/config";

/**
 * בדיקות היחידה — **בלי תשתית, ולכן תמיד רצות.**
 *
 * `*.int.test.ts` מוחרג כאן ורץ ב-`pnpm test:rls` עם Postgres אמיתי.
 * ההפרדה אינה נוחות: בדיקה שדורשת מסד כדי לעבור היא בדיקה שנופלת
 * אצל מי שאין לו מסד מורם, ובדיקה שנופלת בלי סיבה אמיתית היא בדיקה
 * שמפסיקים להריץ — ואז גם כל השאר מפסיקות להגן.
 */
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "**/*.int.test.ts"],
  },
});
