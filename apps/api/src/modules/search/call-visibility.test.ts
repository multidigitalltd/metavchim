import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TenantContext } from "../../common/tenant-context";
import { visibleCallsCondition } from "../../common/ownership";

/**
 * תקציר שיחה אינו יוצא ממי שאינו רשאי לה — **גם דרך החיפוש.**
 *
 * ## למה בדיקה מבנית ולא התנהגותית
 *
 * הכלל הזה חי בשאילתה, ושאילתה נבדקת מול מסד — כלומר בסוויטת
 * האינטגרציה, שרצה בנפרד. מה שנשבר כאן לא היה הכלל אלא **המקום**:
 * `CallsService.list` סינן לפי בעלות, והחיפוש הגלובלי שלף לפי
 * `tenantId` בלבד. פעולת `search` של הסוכן דורשת `properties.view`,
 * ולכן סוכן בלי גישה משרדית ללידים ולקונים יכול היה לחפש ביטוי
 * מתוך שיחה של סוכן אחר ולקבל את התקציר שלה — בפאנל ובוואטסאפ
 * (ביקורת Codex, P1).
 *
 * שני עותקים של תנאי בעלות נפרדים זה מזה פעם אחת, ולכן מה שנבדק
 * כאן הוא שאין עותק שני: כל שליפת שיחות בחיפוש עוברת דרך שער אחד,
 * והתנאי עצמו מיובא מהמקום שיומן השיחות משתמש בו.
 */

const read = (name: string): string =>
  readFileSync(new URL(name, import.meta.url), "utf8");

const search = read("./search.service.ts");
const calls = read("../calls/calls.service.ts");

describe("בעלות על שיחות — תנאי אחד, שני קוראים", () => {
  it("כל שליפת שיחות בחיפוש נמצאת אחרי השער, ולא לפניו", () => {
    const gate = search.indexOf("private async visibleCalls(");
    expect(gate).toBeGreaterThan(0);
    expect(search.slice(0, gate)).not.toContain("call.findMany");
  });

  it("והשער נשען על התנאי המשותף ולא על ניסוח משלו", () => {
    expect(search).toContain("visibleCallsCondition(");
    expect(search).not.toContain("NOT EXISTS (SELECT 1 FROM buyers");
  });

  it("גם יומן השיחות — ואין לו עותק מקומי", () => {
    expect(calls).toContain("visibleCallsCondition(");
    expect(calls).not.toContain("NOT EXISTS (SELECT 1 FROM buyers");
  });
});

describe("התנאי עצמו — שלושת הענפים", () => {
  const sql = TenantContext.run(
    { tenantId: "01TENANT", userId: "01USER", capabilities: new Set(), billingOnly: false },
    () => visibleCallsCondition("01TENANT", "01USER", ["01CONTACT"]),
  );

  it("לקוח שהמשתמש רשאי לו, יתומה שהוא רשם, ולקוח שאיבד את כרטיסיו", () => {
    expect(sql.sql).toContain("c.contact_id = ANY(");
    expect(sql.sql).toContain("c.contact_id IS NULL");
    expect(sql.sql).toContain("NOT EXISTS (SELECT 1 FROM leads l");
    expect(sql.sql).toContain("NOT EXISTS (SELECT 1 FROM properties p");
  });

  it("והמזהים עוברים כפרמטרים — לא כטקסט בתוך השאילתה", () => {
    expect(sql.sql).not.toContain("01TENANT");
    expect(sql.values).toContain("01TENANT");
    expect(sql.values).toContain("01USER");
  });
});
