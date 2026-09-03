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
/** המקור השני לערכי הכיוון — מה שנכתב למסד בפועל. */
const CALLS_SERVICE = readFileSync(
  join(import.meta.dirname, "../calls/calls.service.ts"),
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
    expect(byCall.get("appointment.count")).toContain("ownerUserId: userId");
    // ‏פגישה שהתקיימה בלבד — לא `scheduled` שחלפה ולא `no_show`
    expect(byCall.get("appointment.count")).toContain('status: "completed"');
    expect(byCall.get("property.count")).toContain("agentUserId: userId");
    /*
     * ‏לשיחה ולהצעה אין בעלים ישיר: השיחה מגיעה דרך הליד שהיא נוגעת
     * בו, וההצעה דרך ההתאמה והקונה. שתיהן נבדקות בשאילתת ההצלבה.
     */
    expect(byCall.get("lead.findMany")).toContain("assignedToUserId: scope.userId");
    expect(byCall.get("buyer.findMany")).toContain("ownerUserId: scope.userId");
  });
});

describe("המנטור — מה נחשב פעולה", () => {
  it("רק שיחות יוצאות נספרות, בערך שהמערכת באמת שומרת", () => {
    /*
     * ‎**הבדיקה הזו נכשלה בתפקידה פעם אחת, ולכן היא נכתבה מחדש.**
     *
     * ‏הניסוח הראשון היה `toContain('direction: "out"')` — כלומר הוא
     * אישר את המחרוזת שאני עצמי כתבתי, ולא בדק דבר. המערכת שומרת
     * ‎`"outbound"`, ולכן הסינון התאים לאפס שורות תמיד: המדד המרכזי
     * של המנטור החזיר 0 לכל סוכן, והשער היה ירוק (ביקורת Codex, P1).
     *
     * ‏עכשיו הערך **נגזר מהמקור השני** — הטיפוס ב-`CallsService`,
     * שהוא מה שנכתב למסד — ולכן שני הצדדים חייבים להסכים. שער
     * שמצטט את עצמו אינו שער.
     */
    const declared = [
      ...CALLS_SERVICE.matchAll(/direction:\s*"(inbound)"\s*\|\s*"(outbound)"/gu),
    ];
    expect(declared.length).toBeGreaterThan(0);
    const outbound = declared[0]![2]!;

    const calls = tenantQueries().find((q) => q.call === "call.findMany");
    expect(calls?.body).toContain(`direction: "${outbound}"`);
    // ומה שאסור: הערך המקוצר שלא קיים בשום מקום במסד
    expect(calls?.body).not.toContain('direction: "out"');
  });

  it("נספרות רק פגישות שהתקיימו", () => {
    /*
     * ‏הניסוח הראשון היה „לא מבוטלת”, והוא השאיר בפנים `scheduled`
     * שחלפה בלי אישור ו-`no_show` — כלומר פגישה שהלקוח לא הגיע
     * אליה נספרה כפגישה שנעשתה (ביקורת Codex, P2).
     */
    const appointments = tenantQueries().find((q) => q.call === "appointment.count");
    expect(appointments?.body).toContain('status: "completed"');
    expect(appointments?.body).not.toContain('not: "cancelled"');
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

describe("המנטור — מה שנספר כבר קרה", () => {
  it("הטווח של התקופה הנוכחית נגמר עכשיו, ולא בסוף השבוע", () => {
    /*
     * ‎**„מה עשיתי” אינו „מה מתוכנן”** (ביקורת Codex, P2). ‏הגבול
     * העליון היה יום ראשון הבא, ולכן פגישה שנקבעה ליום חמישי נספרה
     * כבר ביום ראשון — והציון היה יכול להגיע ל-100% לפני שהתקיימה
     * ולו פגישה אחת.
     */
    expect(SERVICE).toContain("countMeasures(tx, scope, thisWeek, now)");
    expect(SERVICE).not.toMatch(/countMeasures\([^)]*jerusalemDayStart\(thisWeek, 7\)/u);
  });

  it("שבוע שהסתיים מחושב, ואינו נשלף מארכיון שנכתב בפתיחת מסך", () => {
    /*
     * ‎**התיקון בשורש** (ביקורת Codex, P2 ×2). ‏„היסטוריה” שנכתבה
     * בכל פתיחת מסך היא היסטוריה של מתי הסתכלו: מי שפתח ביום שני
     * ב-0% ואז עבד בלי לפתוח שוב נשאר עם 0% בארכיון. הציון של שבוע
     * שהסתיים מחושב מהמחויבות השמורה ומהפעילות שנספרה — שניהם כבר
     * במסד.
     */
    expect(SERVICE).toContain("completedWeekScore");
    expect(SERVICE).not.toContain("mentorWeeklyScore.upsert");
    expect(SERVICE).not.toContain("mentorWeeklyScore.findMany");
  });

  it("שבוע בלי מחויבות אינו נחשב לשבוע חלש", () => {
    /*
     * ‏מי שנכנס למסך פעמיים לפני שקבע יעד ראשון היה מקבל „שבוע שני
     * שלא נסגר” על שני שבועות שלא הבטיח בהם דבר (ביקורת Codex, P2).
     */
    expect(SERVICE).toMatch(
      /if \(Object\.keys\(committed\)\.length === 0\) return null;/u,
    );
  });

  it("שיחות שאי אפשר לשייך נספרות ומדווחות, ולא נבלעות", () => {
    /*
     * ‏המרכזייה אינה אומרת מי חייג, ושיחה בלי ליד נשארת בלי עוגן
     * לאדם. בלי המספר הזה המסך היה מציג „3 / 40” לסוכן שהתקשר
     * ארבעים פעם, והוא היה מסיק שלא עבד (ביקורת Codex, P1).
     */
    /*
     * ‏הערך **המחושב** מוחזר, ולא מספר קבוע: `toContain` לבדו עבר גם
     * על `unattributedCalls: 0`, כלומר על מסך שלעולם לא יזהיר. זו
     * בדיוק אותה חולשה שהפילה את בדיקת כיוון השיחה.
     */
    expect(SERVICE).toMatch(/^\s+unattributedCalls,$/mu);
    const q = tenantQueries().find((x) => x.call === "call.count");
    expect(q?.body).toContain("createdBy: null");
    expect(q?.body).toContain("leadId: null");
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
