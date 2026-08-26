import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **דף תשלום שנפתח דף חדש במקומו נשאר חי אצל קארדקום.**
 *
 * פתיחת דף חדש היא פעולה שלנו; היא אינה מבטלת דבר אצל הסולק. לקוח
 * שחזר ללשונית הישנה ושילם בה חויב באמת. אם סימנו את השורה ההיא
 * „נכשל”, המעבר המותנה ב-`apply` אינו תופס אותה — והתוצאה היא חיוב
 * בלי מנוי, בלי הפעלת הצעה, ובלי מסלול התאוששות (ביקורת Codex).
 *
 * שתי הדרישות שהבדיקה הזו שומרת:
 *
 * 1. החלפת דף כותבת `superseded` ולא `failed` — לא נדחה, הוחלף.
 * 2. כל מעבר מצב ב-`apply` תופס מ-`CLAIMABLE` ולא מ-`"pending"`
 *    בלבד, כדי שאימות מול קארדקום יגבר על הניחוש שלנו.
 *
 * **מה הבדיקה הזו אינה עושה:** היא אינה מריצה תשלום. אין היום
 * הרנס בדיקות ל-`BillingService` (סולק, הצפנה, קטלוג וטרנזקציה),
 * ובדיקה התנהגותית אמיתית דורשת אותו. עד שיהיה — זו בדיקה מבנית,
 * באותו דפוס של `auth-coverage` ו-`tenant-purge-coverage`: היא
 * מונעת חזרה לתבנית השגויה בעריכה עתידית, ולא יותר מזה.
 */

const SERVICE = readFileSync(
  join(import.meta.dirname, "billing.service.ts"),
  "utf8",
);

describe("תפיסת תשלום מאומת", () => {
  it("החלפת דף תשלום מסמנת superseded, לא failed", () => {
    const supersedes = [...SERVICE.matchAll(/נפתח דף תשלום חדש במקומו/gu)];
    // שני מסלולי פתיחה: מסלול רגיל והצעה בלינק
    expect(supersedes).toHaveLength(2);

    const failing = [
      ...SERVICE.matchAll(
        /data:\s*\{\s*status:\s*"failed",\s*failureReason:\s*"נפתח דף תשלום חדש במקומו"/gu,
      ),
    ];
    expect(failing).toEqual([]);
  });

  /*
   * כל `updateMany` על `payment` שמשנה סטטוס בתוך `apply` חייב
   * לתפוס מהרשימה. חיפוש טקסטואלי על `status: "pending"` בתנאי
   * ה-`where` מספיק: זו התבנית שהייתה, וזו שאסור שתחזור.
   */
  it("שום מעבר מצב אינו תופס מ-pending בלבד", () => {
    const narrow = [...SERVICE.matchAll(/where:\s*\{[^}]*status:\s*"pending"[^}]*\}/gu)].map(
      (m) => m[0],
    );
    // `where` עם `status: "pending"` מותר רק בבחירת שורות להחלפה,
    // שם זה בדיוק מה שמחפשים — דף פתוח קודם
    const offending = narrow.filter((clause) => !clause.includes("tenantId"));
    expect(offending).toEqual([]);
  });

  /*
   * **הבדיקה הזו נולדה מפער בבדיקה שמעליה.**
   *
   * הבדיקה הקודמת סרקה תנאי `where` בלבד, ולכן לא ראתה השוואה
   * רגילה ב-JS. וכך `paymentStatus` נשארה עם `=== "pending"`: דף
   * החזרה המשיך לבדוק שורה `superseded`, אבל השרת לא פנה לקארדקום
   * עליה — סיבוב סרק בזמן שהלקוח כבר חויב (ביקורת Codex).
   *
   * „לא נשאר `where` צר” אינו „לא נשאר שער צר”.
   */
  it("שום השוואה בקוד אינה בודקת pending לבדו", () => {
    const comparisons = [...SERVICE.matchAll(/\w+\.status\s*===\s*"pending"/gu)].map((m) => m[0]);
    expect(comparisons).toEqual([]);
  });

  it("רשימת הסטטוסים הניתנים לתפיסה כוללת את superseded ואינה כוללת paid", () => {
    const list = /const CLAIMABLE: string\[\] = \[([^\]]+)\]/u.exec(SERVICE)?.[1] ?? "";
    expect(list).toContain("pending");
    expect(list).toContain("SUPERSEDED");
    expect(list).not.toContain('"paid"');
  });
});

/**
 * **מכסת המימושים של הצעה היא חלק מאותה תפיסה.**
 *
 * כל עוד דף שהוחלף היה „נכשל”, חצייה של המכסה דרשה שני תשלומים
 * שנפרעו במקביל — מרוץ נדיר, שהתועד ככזה והושאר בכוונה. מרגע ששורה
 * מוחלפת נשארת בת-תפיסה, שתי לשוניות מספיקות כדי ששני דפים יהיו
 * סליקים, והצעה חד-פעמית נפרעת פעמיים (ביקורת Codex).
 *
 * לכן ההגדלה חייבת להיות **מותנית וראשונה** — `updateMany` שמגדיל רק
 * כשנשאר מקום מתחת למכסה הוא הנעילה עצמה, ומי שקיבל `count === 0`
 * אינו מעניק דבר. הגדלה בסוף, או בלי תנאי, מחזירה את הפער.
 */
describe("מכסת מימושים נתפסת אטומית", () => {
  const APPLY = /private async applyOfferWithin\([\s\S]*?\n {2}\}\n/u.exec(SERVICE)?.[0] ?? "";

  it("הפונקציה נמצאה ומחזירה תשובה שאפשר לבדוק", () => {
    expect(APPLY).not.toBe("");
    expect(APPLY).toContain("Promise<boolean>");
  });

  it("כל הגדלת מימושים מותנית במקום שנשאר מתחת למכסה", () => {
    const increments = [
      ...SERVICE.matchAll(/updateMany\(\{[\s\S]*?redemptions:\s*\{\s*increment[\s\S]*?\}\);/gu),
    ].map((m) => m[0]);
    expect(increments).toHaveLength(1);
    expect(increments[0]).toContain("redemptions: { lt: offer.maxRedemptions }");
  });

  /*
   * „מותנה” בלי „ראשון” אינו שער: הגדלה בסוף הפונקציה משאירה את
   * ההטבות מוענקות לפני שנבדק אם נשאר מקום.
   */
  it("ההגדלה קודמת לכל הענקה, והכישלון עוצר לפניה", () => {
    const consume = APPLY.indexOf("redemptions: { increment: 1 }");
    const guard = APPLY.indexOf("count === 0");
    const grant = APPLY.indexOf("tx.tenant.update");
    expect(consume).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(consume);
    expect(grant).toBeGreaterThan(guard);
  });

  it("הקורא אינו מתעלם מהתשובה", () => {
    expect(SERVICE).toMatch(/!\(await this\.applyOfferWithin\(/u);
  });
});
