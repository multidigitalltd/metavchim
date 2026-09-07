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
   * ‎**הסינון במסד, לא בזיכרון — וזה לא ניסוח.**
   *
   * ‏הרשימות שלפו `limit + LIVE_HEADROOM` וסיננו אחר כך. המרווח (20)
   * תועד כ„רשת ביטחון” לצד מחוק — מקרה נדיר. נכס שנמכר אינו נדיר,
   * ולכן קונה ש-21 ההתאמות החזקות שלו הן לנכסים שנמכרו היה מקבל
   * רשימה **ריקה** בזמן שיש לו התאמות תקינות שורה מתחת (ביקורת
   * Codex, P1). ה-`LIMIT` חייב לחול **אחרי** התנאי.
   */
  it.each([
    ["listAll", "מסך ההתאמות"],
    ["listForBuyer", "כרטיס הקונה"],
  ])("%s (%s) שולפת שורות שכבר עברו את התנאי", (name) => {
    const body = methodOf(SERVICE, name);
    expect(body).not.toBe("");
    expect(body).toContain("matchableRows");
  });

  it.each([
    ["listAll", "מסך ההתאמות"],
    ["listForBuyer", "כרטיס הקונה"],
  ])("%s (%s) אינה נשענת על מרווח שורות", (name) => {
    const body = methodOf(SERVICE, name);
    expect(body).not.toContain("LIVE_HEADROOM");
  });

  /* ‏הנכס עדיין נשלף לכתובת ולמחיר, ודרך אותו תנאי */
  it.each([
    ["listAll", "מסך ההתאמות"],
    ["listForBuyer", "כרטיס הקונה"],
  ])("%s (%s) שולפת את הנכס דרך התנאי", (name) => {
    const body = methodOf(SERVICE, name);
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
  it("אינה שולפת רשימת מזהים", () => {
    expect(count).not.toContain("notIn");
    expect(count).not.toContain("retiredPropertyIds");
  });

  /*
   * ‎**אותו תנאי בדיוק כמו הרשימה, כי זה אותו קוד.**
   *
   * ‏המונה קיים כדי לומר „יש עוד”. אילו הוא היה כותב את התנאי
   * בעצמו, „12 התאמות” היה מופיע מעל רשימה של שמונה ביום שאחד
   * משני העותקים משתנה — והמתווך היה מחפש ארבע שאינן קיימות.
   */
  it("סופרת דרך התנאי המשותף ולא דרך עותק שלו", () => {
    expect(count).toContain("matchableMatchesFrom");
    expect(count).not.toContain("FROM matches m");
  });
});

describe("התנאי המשותף ב-SQL", () => {
  const from = /function matchableMatchesFrom\([\s\S]*?\n\}/u.exec(SERVICE)?.[0] ?? "";
  const rows = methodOf(SERVICE, "matchableRows");

  it("נמצאו", () => {
    expect(from).not.toBe("");
    expect(rows).not.toBe("");
  });

  /* ‏התאמה היא בין שני צדדים, ושניהם חייבים להתקיים */
  it("דורש שהנכס **וגם** הקונה חיים", () => {
    expect(from).toContain("FROM properties p");
    expect(from).toContain("FROM buyers b");
    expect(from).toContain("p.deleted_at IS NULL");
    expect(from).toContain("b.deleted_at IS NULL");
  });

  /*
   * ‎**זו הטענה של ביקורת ה-P1.** `LIMIT` שחל לפני התנאי מחזיר
   * רשימה קצרה או ריקה כשהשורות העליונות מסוננות.
   */
  it("ה-LIMIT חל אחרי התנאי", () => {
    const where = rows.indexOf("matchableMatchesFrom");
    const limit = rows.indexOf("LIMIT");
    expect(where).toBeGreaterThan(-1);
    expect(limit).toBeGreaterThan(where);
  });

  it("המיון חוזר גם ב-findMany — `IN (...)` אינו משמר סדר", () => {
    expect(rows).toContain("ORDER BY m.score DESC");
    expect(rows).toContain('orderBy: { score: "desc" }');
  });

  it("רשימת הסטטוסים נגזרת מהרשימה המשותפת", () => {
    expect(from).toContain("MATCHABLE_PROPERTY_STATUSES");
    expect(from).not.toMatch(/'draft',\s*'active'/u);
  });

  /*
   * ‏התנאי חי גם ב-SQL וגם ב-`openMatchesOf` שנשאר לכרטיס הנכס.
   * זה המחיר של הימנעות מרשימת המזהים, והבדיקה כאן היא מה שמונע
   * משני העותקים לסטות.
   */
  it("„נדחתה” מסונן בשני הניסוחים", () => {
    const open = /function openMatchesOf\([\s\S]*?\n\}/u.exec(SERVICE)?.[0] ?? "";
    expect(open).toContain('status: { not: "dismissed" }');
    expect(from).toContain("m.status <> 'dismissed'");
  });

  /* ‏ה-RLS הוא השכבה השנייה, לא הראשונה — השאילתה מגדירה דייר בעצמה */
  it("מוגבל לדייר — גם ב-SQL וגם דרך RLS", () => {
    expect(from).toContain("m.tenant_id = ${tenantId}");
    expect(from).toContain("p.tenant_id = m.tenant_id");
    expect(from).toContain("b.tenant_id = m.tenant_id");
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
