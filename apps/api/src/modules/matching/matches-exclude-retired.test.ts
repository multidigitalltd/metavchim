import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MATCHABLE_PROPERTY_STATUSES } from "@metavchim/shared";

/**
 * ‎**נכס שנמכר אינו מופיע בהתאמות — גם אם השורה קיימת.**
 *
 * ## ‏התקלה
 *
 * ‏הכלל נאכף **רק בכתיבה**: `retireMatches` מוריד את ההתאמות ברגע
 * שהסטטוס משתנה, ושני מסלולי החישוב מדלגים על נכס שיצא משיווק.
 * הקריאה סיננה `deletedAt` בלבד — כלומר היא הניחה שהניקוי רץ.
 *
 * ‏שורה שברחה מהניקוי (גרסה שקדמה לו, טרנזקציה שנקטעה) הופיעה
 * במסך **לתמיד**: הסבב היומי עובר על נכסים לשיווק בלבד, ולכן נכס
 * שנמכר אינו נבדק שוב לעולם. אומת חי — הסרת תנאי הסטטוס החזירה
 * את הנכס שנמכר לכרטיס הקונה ולמסך ההתאמות.
 *
 * ## ‏למה בדיקה מבנית
 *
 * ‏אין הרנס בדיקות ל-`MatchingService` — הוא דורש Prisma, RLS,
 * הקשר דייר וטרנזקציה. אותו נימוק ואותו דפוס של `recompute-purge`:
 * הבדיקה מונעת חזרה לתבנית השגויה בעריכה עתידית, ולא יותר מזה.
 * ההתנהגות עצמה אומתה מול מסד ו-API חיים.
 */

const SERVICE = readFileSync(join(import.meta.dirname, "matching.service.ts"), "utf8");
const REFRESH = readFileSync(join(import.meta.dirname, "match-refresh.service.ts"), "utf8");

/** גוף מתודה אחת, מהחתימה ועד המתודה הבאה. */
function methodOf(source: string, name: string): string {
  const re = new RegExp(`\\n  (?:private )?async ${name}\\([\\s\\S]*?\\n  \\}\\n`, "u");
  return re.exec(source)?.[0] ?? "";
}

describe("התנאי עצמו", () => {
  const predicate = /function matchablePropertyOf\([\s\S]*?\n\}/u.exec(SERVICE)?.[0] ?? "";

  it("קיים", () => {
    expect(predicate).not.toBe("");
  });

  /*
   * ‏שני התנאים באותו מקום ובכוונה: שניהם עונים על „האם מותר להציע
   * את הנכס הזה עכשיו”, ושני תנאים בשני מקומות היו מסכימים ביום
   * שנכתבו בלבד.
   */
  it("מסנן נכס מחוק **וגם** נכס שיצא משיווק", () => {
    expect(predicate).toContain("deletedAt: null");
    expect(predicate).toContain("MATCHABLE_PROPERTY_STATUSES");
  });

  it("„יצא משיווק” נגזר מהרשימה המשותפת ואינו כתוב כאן", () => {
    /* „נמכר” שנכתב בקוד הוא עותק שני שיסטה ביום שהרשימה תשתנה */
    expect(predicate).not.toMatch(/"sold"|"rented"|"archived"|"on_hold"/u);
  });

  it("הרשימה המשותפת אכן אינה כוללת נמכר", () => {
    /* ‏אם „נמכר” ייכנס לרשימה, כל השאר נכון וחסר משמעות */
    expect([...MATCHABLE_PROPERTY_STATUSES]).not.toContain("sold");
    expect([...MATCHABLE_PROPERTY_STATUSES]).toEqual(["draft", "active"]);
  });
});

describe("כל קריאה מסננת", () => {
  /*
   * ‏הרשימות שולפות את הנכס ממילא (כתובת, מחיר), ולכן הן מסננות
   * באותה שאילתה. שינוי שיחזיר אותן ל-`deletedAt` לבדו יפיל כאן.
   */
  it.each([
    ["listAll", "מסך ההתאמות"],
    ["listForBuyer", "כרטיס הקונה"],
  ])("%s (%s) שולפת נכסים דרך התנאי", (name) => {
    const body = methodOf(SERVICE, name);
    expect(body).not.toBe("");
    expect(body).toContain("matchablePropertyOf");
  });

  /*
   * ‏כרטיס הנכס הוא נכס יחיד: אין רשימת נכסים לסנן, ולכן הבדיקה
   * היא על הנכס עצמו — ולפני שנשלפות שורות בכלל.
   */
  it.each([
    ["listForProperty", "רשימת הקונים בכרטיס הנכס"],
    ["countForProperty", "המונה שליד הרשימה"],
  ])("%s (%s) יוצאת מוקדם על נכס שיצא משיווק", (name) => {
    const body = methodOf(SERVICE, name);
    expect(body).not.toBe("");
    expect(body).toContain("isMatchable");
    /* ‏היציאה לפני השליפה — אחרת נשלפו שורות שלא יוצגו */
    const guard = body.indexOf("isMatchable");
    const query = body.indexOf("tx.match.");
    expect(query).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(query);
  });

  /*
   * ‎**המונה חייב להתיישר עם הרשימה.** „12 התאמות” מעל רשימה של
   * שמונה שולח את המתווך לחפש ארבע שאינן קיימות.
   */
  it.each([
    ["countAll", "מסך ההתאמות"],
    ["countForBuyer", "כרטיס הקונה"],
  ])("%s (%s) סופרת דרך התנאי", (name) => {
    const body = methodOf(SERVICE, name);
    expect(body).not.toBe("");
    expect(body).toContain("countMatchable");
  });
});

describe("הספירה המשותפת", () => {
  const count = methodOf(SERVICE, "countMatchable");

  it("נמצאה", () => {
    expect(count).not.toBe("");
  });

  /*
   * ‎**בלי שליפת מזהים.** הגרסה הראשונה שלי שלפה את כל הנכסים
   * שיצאו משיווק והחריגה אותם ב-`notIn`, בנימוק שהם הצד הקטן —
   * ומשרד שפועל שנים מכר יותר נכסים משיש לו פעילים, ולכן הרשימה
   * גדלה בלי חסם. `dropOrphanMatches` כבר הזהיר מזה.
   */
  it("מסננת ב-NOT EXISTS ולא ברשימת מזהים", () => {
    expect(count).toContain("EXISTS");
    expect(count).not.toContain("notIn");
    expect(count).not.toContain("retiredPropertyIds");
  });

  it("רשימת הסטטוסים נגזרת מהרשימה המשותפת", () => {
    expect(count).toContain("MATCHABLE_PROPERTY_STATUSES");
    expect(count).not.toMatch(/'draft',\s*'active'/u);
  });

  /*
   * ‏ה-SQL הוא עותק שני של תנאי ההתאמה, וזה המחיר של הימנעות
   * מרשימת המזהים. הבדיקה כאן היא מה שמונע מהעותקים לסטות.
   */
  it("תנאי ההתאמה ב-SQL תואם את זה של הרשימות", () => {
    const predicate = /function openMatchesOf\([\s\S]*?\n\}/u.exec(SERVICE)?.[0] ?? "";
    expect(predicate).toContain('status: { not: "dismissed" }');
    expect(count).toContain("m.status <> 'dismissed'");
  });

  it("מוגבלת לדייר — גם ב-SQL וגם דרך RLS", () => {
    expect(count).toContain("m.tenant_id = ${tenantId}");
    expect(count).toContain("p.tenant_id = m.tenant_id");
  });
});

describe("הסבב שמונע הצטברות", () => {
  const drop = methodOf(REFRESH, "dropOrphanMatches");

  it("נמצא", () => {
    expect(drop).not.toBe("");
  });

  /*
   * ‏ה-SQL הכיל `IN ('draft', 'active')` כתוב ביד — עותק שני של
   * הרשימה המשותפת, שהיה מסכים איתה עד היום שבו אחת מהן משתנה.
   */
  it("רשימת הסטטוסים ב-SQL נגזרת מהרשימה המשותפת", () => {
    expect(drop).toContain("MATCHABLE_PROPERTY_STATUSES");
    expect(drop).not.toMatch(/'draft',\s*'active'/u);
  });
});
