import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ‎**המנטור אישי — ומה שנספר בו הוא מה שהמתווך באמת עשה.**
 *
 * ## שתי הבטחות, ושתי דרכים לשבור אותן בשקט
 *
 * ‎**1. היעד הוא של האדם.** יעד הוא הדבר הפרטי ביותר שמתווך כותב
 * במערכת הזו — כולל „מה עצר אותי בשבוע שעבר”. ‏RLS מבודד משרד
 * ממשרד ו**אינו** מבודד סוכן מסוכן: שאילתה שתשכח `userId` תחזיר את
 * היעדים של כל המשרד, ותיראה עובדת מצוין אצל מתווך יחיד.
 *
 * ‎**2. הציון הוא על פעולות שהוא בחר לעשות.** שיחה נכנסת אינה
 * פעולה שהמתווך יזם, פגישה שבוטלה לא קרתה, והצעה שנוצרה ולא נשלחה
 * היא טיוטה. ספירה שמכניסה את שלושתן נותנת ציון גבוה למי שישב וענה
 * לטלפון — כלומר בדיוק ההפך ממדד מוביל.
 *
 * הבדיקות קוראות את הקוד עצמו, כמו שאר השערים המבניים כאן
 * (‎`rls-access`, `deal-room-privacy`). התשובה היא לא „הבדיקה
 * הנוכחית עוברת” אלא „השאילתה הבאה שתיכתב לא תוכל לשכוח”.
 */

const SERVICE = readFileSync(
  join(import.meta.dirname, "mentor.service.ts"),
  "utf8",
);
const CONTROLLER = readFileSync(
  join(import.meta.dirname, "mentor.controller.ts"),
  "utf8",
);

/**
 * ‎**כל קריאת `tx.<model>.<op>` בשירות, עם גוף ה-`where` שלה.**
 *
 * ‏ספירת סוגריים ולא רגקס על שורה אחת: ‏`where` נפרס על פני כמה
 * שורות, וביטוי שמסתפק בשורה הראשונה היה „מוצא” את `tenantId`
 * ומפספס בדיוק את החוסר שהוא נועד לתפוס.
 */
function tenantQueries(): { call: string; body: string }[] {
  const out: { call: string; body: string }[] = [];
  const re = /tx\.(\w+)\.(count|findMany|findFirst|upsert|deleteMany|update)\(/gu;
  for (const match of SERVICE.matchAll(re)) {
    const open = SERVICE.indexOf("{", match.index + match[0].length - 1);
    if (open === -1) continue;
    let depth = 0;
    let end = open;
    for (; end < SERVICE.length; end += 1) {
      if (SERVICE[end] === "{") depth += 1;
      else if (SERVICE[end] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    out.push({ call: `${match[1]}.${match[2]}`, body: SERVICE.slice(open, end + 1) });
  }
  return out;
}

describe("המנטור — היקף אישי", () => {
  it("יש שאילתות לבדוק בכלל", () => {
    /*
     * ‏המשוכה שמונעת „ירוק על אפס”: סריקה שלא מצאה דבר עוברת את כל
     * הבדיקות שמתחתיה בלי לומר מילה.
     */
    expect(tenantQueries().length).toBeGreaterThan(6);
  });

  it("כל שאילתה מסננת לפי משרד", () => {
    const missing = tenantQueries()
      .filter((q) => !q.body.includes("tenantId") && !q.body.includes("...scope"))
      .map((q) => q.call);
    expect(missing).toEqual([]);
  });

  it("כל שאילתה על טבלאות המנטור מסננת גם לפי המשתמש", () => {
    /*
     * ‎`mentorGoal` ו-`mentorWeeklyScore` הן היחידות ששמורות פר-אדם.
     * שאר הטבלאות (שיחות, פגישות) מסוננות לפי העמודה שלהן, ולכן הן
     * נבדקות בבדיקה הבאה ולא כאן.
     */
    const mentorTables = tenantQueries().filter((q) => q.call.startsWith("mentor"));
    expect(mentorTables.length).toBeGreaterThan(2);
    const leaky = mentorTables
      .filter((q) => !q.body.includes("userId") && !q.body.includes("...scope"))
      .map((q) => q.call);
    expect(leaky).toEqual([]);
  });

  it("ספירת המדדים משויכת לאדם בכל אחת מארבע הטבלאות", () => {
    const byCall = new Map(tenantQueries().map((q) => [q.call, q.body]));
    expect(byCall.get("call.count")).toContain("createdBy: userId");
    expect(byCall.get("appointment.count")).toContain("ownerUserId: userId");
    expect(byCall.get("property.count")).toContain("agentUserId: userId");
    // להצעה אין בעלים — היא מגיעה דרך הקונה, ולכן נבדקת בנפרד
    expect(byCall.get("buyer.findMany")).toContain("ownerUserId: scope.userId");
  });
});

describe("המנטור — מה נחשב פעולה", () => {
  it("רק שיחות יוצאות נספרות", () => {
    /*
     * ‏שיחה נכנסת היא תוצאה של השיווק, לא פעולה שנבחרה. בלי התנאי
     * הזה מי שענה לעשרים שיחות מקבל ציון של מי שיזם עשרים.
     */
    const calls = tenantQueries().find((q) => q.call === "call.count");
    expect(calls?.body).toContain('direction: "out"');
  });

  it("פגישה שבוטלה אינה נספרת", () => {
    const appointments = tenantQueries().find((q) => q.call === "appointment.count");
    expect(appointments?.body).toContain('status: { not: "cancelled" }');
  });

  it("נספרות הצעות שנשלחו, ולא הצעות שנוצרו", () => {
    const offers = tenantQueries().find((q) => q.call === "offer.findMany");
    expect(offers?.body).toContain("sentAt");
    expect(offers?.body).not.toContain("createdAt");
  });

  it("נכס שנמחק אינו נספר במלאי", () => {
    const properties = tenantQueries().find((q) => q.call === "property.count");
    expect(properties?.body).toContain("deletedAt: null");
  });

  it("ספירת ההצעות מתחילה מהצעות השבוע, ולא מכל הקונים של המשרד", () => {
    /*
     * ‏שאילתה שמתחילה מהקונים גדלה עם כל קונה שאי פעם היה במשרד;
     * מההצעות היא חסומה בגודל השבוע. אותה תשובה, סדר גודל אחר.
     */
    const offersAt = SERVICE.indexOf("tx.offer.findMany");
    const buyersAt = SERVICE.indexOf("tx.buyer.findMany");
    expect(offersAt).toBeGreaterThan(-1);
    expect(buyersAt).toBeGreaterThan(offersAt);
  });
});

describe("המנטור — יחסי המרה", () => {
  it("שלב ריק מחזיר „אין מספיק” ולא יחס אפס", () => {
    /*
     * ‏יחס אפס אינו „0% ממירים”, הוא חוסר מידע — ותוכנית שנבנית עליו
     * דורשת אינסוף שיחות. `null` הוא מה שמאפשר למסך לומר „ממוצע
     * ענפי, עד שיהיו לך מספרים”.
     */
    expect(SERVICE).toMatch(
      /if \(calls === 0 \|\| appointments === 0 \|\| offers === 0\) return null;/u,
    );
  });

  it("המסך יודע מתי המספרים אינם שלו", () => {
    expect(SERVICE).toContain("usingDefaultRatios");
  });
});

describe("המנטור — הגבול מול העולם", () => {
  it("אין יכולת נפרדת שמישהו אחר יכול לקבל", () => {
    /*
     * ‏יכולת כמו „mentor.view_all” הייתה הופכת ליווי לפיקוח. ההגנה
     * היא ההיקף האישי בשירות, ולכן חשוב שלא תיווסף כאן דלת אחורית.
     *
     * ‏הבדיקה היא על **השימוש בדקורטור** ולא על הופעת המחרוזת: המילה
     * עצמה מופיעה בתיעוד שמסביר למה אין כאן יכולת, ובדיקת מחרוזת
     * הייתה בודקת את ההערה.
     */
    expect(CONTROLLER).not.toMatch(/@RequireCapability\(/u);
    expect(CONTROLLER).toMatch(/@AnyAuthenticated\(\)/u);
  });

  it("קביעה חוזרת מעדכנת ואינה מוסיפה יעד שני", () => {
    expect(SERVICE).toContain("tx.mentorGoal.upsert");
    expect(SERVICE).toContain("tenantId_userId_horizon_periodStart");
  });

  it("התקופה נגזרת בשרת ואינה מגיעה מהמסך", () => {
    /*
     * ‏שני מכשירים באזורי זמן שונים היו יוצרים שתי „אותה תקופה”,
     * והאילוץ הייחודי לא היה מונע זאת — הוא כולל את `period_start`.
     */
    expect(SERVICE).toContain("goalPeriod(horizon");
    expect(CONTROLLER).not.toContain("periodStart");
  });
});
