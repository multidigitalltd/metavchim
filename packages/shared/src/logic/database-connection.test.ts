import { describe, expect, it } from "vitest";
import { databaseConnection } from "./database-connection.js";

describe("databaseConnection", () => {
  it("כל חיבור ב-UTC, עם המתנה תחומה", () => {
    const { pool } = databaseConnection("postgresql://u:p@db:5432/metavchim?schema=public", 4);
    expect(pool.options).toBe("-c TimeZone=UTC -c search_path=public");
    expect(pool.connectionTimeoutMillis).toBe(10_000);
    expect(pool.max, "כמו ב-Prisma 6: מעבדים × 2 + 1").toBe(9);
    expect(pool.connectionString).toBe("postgresql://u:p@db:5432/metavchim?schema=public");
  });

  it("הסכימה מהכתובת — למתאם וכ-search_path — ו-public כשאין", () => {
    const probe = databaseConnection("postgresql://u:p@db:5432/x?schema=probe", 4);
    expect(probe.schema).toBe("probe");
    expect(probe.pool.options).toContain("-c search_path=probe");
    expect(databaseConnection("postgresql://u:p%40ss@db:5432/x", 4).schema).toBe("public");
  });

  it("שם סכימה שאינו מזהה פשוט — נדחה, ולא נכנס לשורת האפשרויות", () => {
    expect(() => databaseConnection("postgresql://u:p@db:5432/x?schema=a%20-c%20x%3Dy", 4)).toThrow("סכימה");
  });

  it("כתובת חסרה — שגיאה שאומרת מה חסר", () => {
    expect(() => databaseConnection(undefined, 4)).toThrow("DATABASE_URL");
    expect(() => databaseConnection("", 4)).toThrow("DATABASE_URL");
  });
});
