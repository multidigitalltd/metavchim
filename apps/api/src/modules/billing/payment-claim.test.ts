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

  it("רשימת הסטטוסים הניתנים לתפיסה כוללת את superseded ואינה כוללת paid", () => {
    const list = /const CLAIMABLE: string\[\] = \[([^\]]+)\]/u.exec(SERVICE)?.[1] ?? "";
    expect(list).toContain("pending");
    expect(list).toContain("SUPERSEDED");
    expect(list).not.toContain('"paid"');
  });
});
