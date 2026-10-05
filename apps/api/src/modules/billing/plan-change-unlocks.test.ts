import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { tenantCanOperate, tenantPeriodEnded } from "../auth/auth.service";

/**
 * ‎**בחירת מסלול חייבת לפתוח את המערכת מיד.**
 *
 * ## ‏הבאג
 *
 * ‏מסלול השת״פ חינמי, ולכן מעבר אליו מבטל את התפוגה **בשרת** —
 * ‏`planIsFree` גובר על `paidUntil` שפג. אבל המסך לא ידע: הבקשה
 * ‏הצליחה, כרטיס המנוי התעדכן, והמשתמש נשאר תקוע במעטפת „חיוב
 * ‏בלבד” בלי תפריט ובלי דרך לדשבורד (דיווח המשתמש: „אחרי שבוחרים
 * ‏מסלול לא עוברים מיד לדשבורד”).
 *
 * ‏זו אותה משפחה של תקלות שחוזרת כאן: **הכלל הוכרע במקום אחד
 * ‏ונאכף במקום אחר.** השרת כבר אמר „פתוח”, והלקוח המשיך לצייר
 * ‏„סגור” מתשובה שנשלפה פעם אחת.
 */

describe("השרת פותח מיד", () => {
  const past = new Date(Date.now() - 86_400_000);

  it("משרד שתקופתו נגמרה אינו יכול לעבוד", () => {
    expect(tenantCanOperate({ status: "active", paidUntil: past })).toBe(false);
  });

  /* ‏וזו בדיוק ההבטחה שהמסך היה צריך לכבד — ולא כיבד */
  it("ואותו משרד על מסלול חינמי — כן, בלי להמתין לשום סורק", () => {
    const tenant = { status: "active", paidUntil: past, planIsFree: true };
    expect(tenantPeriodEnded(tenant)).toBe(false);
    expect(tenantCanOperate(tenant)).toBe(true);
  });
});

/**
 * ‏החלק שנשבר היה בלקוח, ולכן הוא נבדק כאן על המקור: המעבר חייב
 * ‏להיות **טעינה מלאה** ולא ניווט רך.
 */
describe("המסך עובר מיד, ובטעינה מלאה", () => {
  const read = (relative: string): string =>
    readFileSync(new URL(relative, import.meta.url), "utf8");
  const WEB = "../../../../web/src/";
  const CACHE = read(`${WEB}lib/session-cache.ts`);
  const SECTION = read(`${WEB}app/settings/billing-section.tsx`);
  const RETURN = read(`${WEB}app/settings/billing/return/page.tsx`);

  /*
   * ‎**טעינה מלאה ולא `router.replace`**, וזו לא קפדנות: ה-`AppShell`
   * ‏שולף את הסשן ב-`useEffect` שתלוי ב-`isPublic` בלבד, ולכן ניווט
   * ‏פנימי אינו קורא אותו מחדש. מעבר רך היה מגיע לדשבורד ועדיין
   * ‏מצייר סביבו את המעטפת החסומה.
   */
  it("העוזר מנקה את המטמון וטוען מחדש", () => {
    expect(CACHE).toContain("export function reloadWithFreshSession");
    const body = CACHE.slice(CACHE.indexOf("export function reloadWithFreshSession"));
    expect(body).toContain("clearSessionCache()");
    expect(body).toContain("window.location.assign(path)");
  });

  it("מעבר למסלול חינמי עובר דרכו", () => {
    const fn = SECTION.slice(SECTION.indexOf("async function switchFree"));
    const body = fn.slice(0, fn.indexOf("async function cancel"));
    expect(body).toContain("reloadWithFreshSession");
    /* ‏רענון הכרטיס בלבד הוא בדיוק מה שתיקן את הכרטיס ולא את הכלוב */
    expect(body).not.toContain("setData(fresh)");
  });

  /*
   * ‎**מי שהיה חסום — לדשבורד; מי שלא — נשאר.** מעבר מסלול מתוך
   * ‏ההגדרות אינו סיבה לזרוק מנהל לדף הבית.
   */
  it("ולאן — נקבע לפי מה שהיה, לא לפי מה שיהיה", () => {
    expect(SECTION).toContain("user?.billingOnly === true");
  });

  /*
   * ‎**„נשאר איפה שהיה” כולל את המחרוזת** (ביקורת Codex): הרכיב
   * ‏מוצג גם כלשונית בתוך `‎/settings`, והלשונית הנבחרת חיה
   * ‏ב-`?tab=billing`. `pathname` לבדו החזיר את המנהל ללשונית
   * ‏„צוות” — בדיוק ההזזה שהסעיף נועד למנוע.
   */
  it("ומי שנשאר — נשאר גם באותה לשונית", () => {
    expect(SECTION).toContain(
      "`${window.location.pathname}${window.location.search}${window.location.hash}`",
    );
    /* ‏הלשונית נקראת משם, ולכן זו אינה קפדנות */
    expect(read(`${WEB}app/settings/page.tsx`)).toContain(
      'new URLSearchParams(window.location.search).get("tab")',
    );
  });

  /*
   * ‏אותו פער בדיוק בסוף תשלום: „אפשר להמשיך לעבוד” הייתה הבטחה
   * ‏ריקה כל עוד הקישור היה רך.
   */
  it("וגם סיום תשלום מוצלח מעביר דרכו", () => {
    const paid = RETURN.slice(RETURN.indexOf('status === "paid"'));
    const body = paid.slice(0, paid.indexOf('status === "failed"'));
    expect(body).toContain('reloadWithFreshSession("/")');
    expect(body).not.toMatch(/<Link href="\/settings\/billing"/u);
  });
});
