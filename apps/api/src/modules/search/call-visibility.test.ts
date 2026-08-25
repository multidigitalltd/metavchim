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

describe("התנאי עצמו — ארבעת הענפים", () => {
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

  /*
   * **שיחה שאיש אינו בעליה — הענף שחסר, וזה מה שהמתווך ראה.**
   *
   * שיחה ממרכזייה שלא נענתה ממספר לא מוכר נכתבת בלי `created_by`
   * (וובהוק, לא משתמש) ובלי `contact_id` (ליד נפתח רק על שיחה
   * שנענתה). שלושת הענפים הראשונים נשענים כולם על אחד מהשניים,
   * ולכן שורה תקינה נעלמה מכל עין — בזמן שהמערכת שלחה עליה התראת
   * „שיחה שלא נענתה”.
   */
  it("ושיחה בלי בעלים ובלי איש קשר נראית למשרד", () => {
    expect(sql.sql).toContain("c.created_by IS NULL AND c.contact_id IS NULL");
  });

  /*
   * הצירוף הוא השער: „בלי בעלים” לבדו היה חושף כל שיחה ממרכזייה
   * — גם כזו שנענתה ופתחה ליד ללקוח של סוכן אחר.
   */
  it("ובלי איש קשר אינו תנאי שאפשר לוותר עליו", () => {
    const branch = sql.sql.slice(sql.sql.indexOf("c.created_by IS NULL"));
    expect(branch.slice(0, 60)).toContain("AND c.contact_id IS NULL");
  });

  it("והמזהים עוברים כפרמטרים — לא כטקסט בתוך השאילתה", () => {
    expect(sql.sql).not.toContain("01TENANT");
    expect(sql.values).toContain("01TENANT");
    expect(sql.values).toContain("01USER");
  });
});

/**
 * הרשימה והרשומה הבודדת חייבות לומר את אותו דבר: ענף שנוסף בצד
 * אחד בלבד מייצר שיחה שרואים ברשימה ומקבלים עליה 404 בפתיחה — או
 * הפוך, שיחה שאפשר למחוק ואי אפשר לראות.
 */
describe("השער של הרשומה הבודדת נושא את אותם ענפים", () => {
  const gate = calls.slice(
    calls.indexOf("private async assertCallAccess("),
    calls.indexOf("async remove("),
  );

  it("„אני רשמתי” ו„אין בעלים” — שניהם", () => {
    expect(gate).toContain("row.createdBy === userId && row.contactId === null");
    expect(gate).toContain("row.createdBy === null && row.contactId === null");
  });

  it("ומחיקה עוברת דרכו ואינה מנסחת כלל משלה", () => {
    const remove = calls.slice(calls.indexOf("async remove("), calls.indexOf("attachRecording("));
    expect(remove).toContain("this.assertCallAccess(tx, id)");
  });
});
