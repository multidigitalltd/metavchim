import { describe, expect, it } from "vitest";
import { databaseConnection } from "./database-connection.js";

describe("databaseConnection", () => {
  it("כל חיבור ב-UTC, עם המתנה תחומה", () => {
    const { pool } = databaseConnection("postgresql://u:p@db:5432/metavchim?schema=public");
    expect(pool.options).toBe("-c TimeZone=UTC");
    expect(pool.connectionTimeoutMillis).toBe(10_000);
    expect(pool.connectionString).toBe("postgresql://u:p@db:5432/metavchim?schema=public");
  });

  it("הסכימה מהכתובת, ו-public כשאין", () => {
    expect(databaseConnection("postgresql://u:p@db:5432/x?schema=probe").schema).toBe("probe");
    expect(databaseConnection("postgresql://u:p%40ss@db:5432/x").schema).toBe("public");
  });

  it("כתובת חסרה — שגיאה שאומרת מה חסר", () => {
    expect(() => databaseConnection(undefined)).toThrow("DATABASE_URL");
    expect(() => databaseConnection("")).toThrow("DATABASE_URL");
  });
});
