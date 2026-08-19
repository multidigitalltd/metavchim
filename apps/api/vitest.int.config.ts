import { defineConfig } from "vitest/config";

/**
 * בדיקות האינטגרציה — מול Postgres אמיתי.
 *
 * רצות בקובץ אחד ובלי מקביליות: כולן חולקות מסד יחיד, ושתילה של
 * דייר בטבלה אחת בזמן שבדיקה אחרת קוראת ממנה הופכת כישלון אמיתי
 * למרוץ לא-דטרמיניסטי.
 */
export default defineConfig({
  test: {
    include: ["**/*.int.test.ts"],
    fileParallelism: false,
    // הרמת מסד, מיגרציות ושתילה של עשרות טבלאות
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
