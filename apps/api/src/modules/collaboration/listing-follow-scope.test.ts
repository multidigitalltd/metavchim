import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LISTING_MATCH_NOTIFICATION_TYPE,
  NOTIFICATION_CONTACT_ANCHORS,
  notifyCategory,
} from "@metavchim/shared";

/**
 * ‎**מעקב אחרי נכס ברשת — הכללים שקל לשבור בלי לשים לב.**
 *
 * ## ‏למה שער ולא בדיקת התנהגות
 *
 * ‏המסלול הזה נבנה כתמונת ראי של `DemandFollow`, וזו בדיוק הצורה
 * ‏שבה שני עותקים נפרדים בשקט: אחד מהם מקבל תיקון והשני נשאר.
 * ‏השער כאן נועל את ההכרעות ש**חייבות** להישאר זהות — ואת האחת
 * ‏שחייבת להיות שונה.
 *
 * ‏שלוש מהן כבר היו ממצאי ביקורת בכיוון הראשון, ואין סיבה לגלות
 * ‏אותן שוב: חלון קבוע שמדלג על מה שנכנס אחריו, שורות מתות
 * ‏שממשיכות להיספר בגבול, וסוג התראה שלא נרשם בקטגוריה ולכן אי
 * ‏אפשר לכבות אותו.
 */

const LISTINGS = readFileSync(
  join(import.meta.dirname, "listings.service.ts"),
  "utf8",
);
const SWEEP = readFileSync(
  join(import.meta.dirname, "demand-follow-sweep.service.ts"),
  "utf8",
);
const CONTROLLER = readFileSync(
  join(import.meta.dirname, "collaboration.controller.ts"),
  "utf8",
);

/**
 * ‏שלוש מתודות הסבב בלבד — עד `matchOwnBuyers`, שהיא כבר משותפת
 * ‏לסבב ולפיד ולכן אינה חלק ממה שנבדק כאן.
 */
const SWEEP_BODY = (() => {
  const from = LISTINGS.indexOf("async sweepFollowsForTenant(");
  const to = LISTINGS.indexOf("private matchOwnBuyers(");
  expect(from, "הסבב לא נמצא").toBeGreaterThan(-1);
  expect(to, "matchOwnBuyers לא נמצאה").toBeGreaterThan(from);
  return LISTINGS.slice(from, to);
})();

describe("ההתראה אינה חושפת את מה שהרשת מסתירה", () => {
  /*
   * ‎**זו ההכרעה שנושאת את המשקל.** ההתראה נשלחת לעוקב, ונושאת
   * ‏את **הקונה שלו** ואת הנכס כפי שהפיד כבר מציג לו אותו. אם
   * ‏אי-פעם ייכנס לכאן פרט של המשרד המפרסם שאינו בכרטיס — כתובת,
   * ‏שם בעלים, טלפון — הוא ידלוף דרך התראה בטלפון, במקום שאיש
   * ‏אינו בודק.
   */
  it("הנכס מתואר רק בפרטים שהכרטיס כבר מציג", () => {
    const at = SWEEP_BODY.indexOf("listingLabel({");
    expect(at, "התווית לא נבנית מהחבילה המשותפת").toBeGreaterThan(-1);
    const args = SWEEP_BODY.slice(at, SWEEP_BODY.indexOf("})", at));
    for (const forbidden of ["street", "houseNumber", "address", "ownerName", "ownerPhone"]) {
      expect(args, `${forbidden} אינו נחשף ברשת`).not.toContain(forbidden);
    }
  });

  /*
   * ‎**והקונה הוא של העוקב — לפי אותו כלל שהפיד מפעיל.**
   *
   * ‏הכתיבה הראשונה כאן הייתה `ownerUserId === null || === userId`,
   * ‏והיא שגתה בשני הכיוונים (ביקורת Codex): מנהל עם `view_all`
   * ‏רואה בכרטיס התאמה לקונה של עמית ולא היה מקבל עליה התראה,
   * ‏וקונה בלי בעלים נשלח לסוכן ש-`view_own` לבדה אינה מספיקה לו
   * ‏כדי לראות אותו. `buyerCardIsVisibleWith` היא אותה פונקציה
   * ‏שהצנזורה בקריאה משתמשת בה.
   */
  it("וההתראה נשלחת רק על קונה שהעוקב רשאי לראות", () => {
    expect(SWEEP_BODY).toContain("buyerCardIsVisibleWith(");
    expect(SWEEP_BODY, "השוואת בעלות ידנית במקום הכלל המשותף").not.toContain(
      "buyer.ownerUserId === follow.userId",
    );
  });

  /*
   * ‎**והיכולות הן של האדם, לא של התפקיד.** „מותר לי לראות” הוא
   * ‏תפקיד, ועליו חריגי המנהל, ועליהם חסימת המודולים.
   * ‎`officeCapabilities` היא בדיוק הצירוף הזה — הנחה על התפקיד
   * ‏לבדו כבר הדליפה שם מפוענח בעבר.
   */
  it("והיכולות נפתרות בפועל לכל עוקב", () => {
    expect(SWEEP_BODY).toContain("officeCapabilities(");
    expect(SWEEP_BODY).toContain("caps.get(follow.userId)");
  });

  /*
   * ‎**העוגן הוא הקונה, כי הגוף נושא את שמו.**
   *
   * ‏שורת התראה נכתבת פעם אחת ונקראת לנצח, והצנזורה בקריאה מכירה
   * ‏רק `contact | lead | buyer | call`. עיגון על המודעה השאיר את
   * ‏השם חשוף גם אחרי שהכרטיס הועבר לעמית או שההרשאה נשללה —
   * ‏כלומר מחוץ לצנזורה לגמרי (ביקורת Codex).
   */
  it("וההתראה מעוגנת לקונה ולא למודעה", () => {
    expect(SWEEP_BODY).toContain('entityType: "buyer"');
    expect(SWEEP_BODY).toContain("entityId: match.buyerId");
    expect(SWEEP_BODY, "עוגן שהצנזורה אינה מכירה").not.toContain('entityType: "coop_listing"');
    /* ‏ומה שנכתב באמת נמצא ברשימת העוגנים המצונזרים */
    expect(NOTIFICATION_CONTACT_ANCHORS as readonly string[]).toContain("buyer");
  });
});

describe("מה שנלמד בכיוון הראשון אינו נלמד שוב", () => {
  /*
   * ‎**חלון קבוע פירושו התראה שלעולם לא תגיע.** ריצה שעתית שחוזרת
   * ‏על אותו `take` קבוע לא תראה לעולם קונה שנכנס אחריו — ומעקב
   * ‏הוא בדיוק ההבטחה ההפוכה. זו ביקורת P1 מהכיוון הראשון.
   */
  it("הקונים נסרקים בעמודים, ולא בחלון קבוע", () => {
    expect(SWEEP_BODY).toContain("id: { gt: cursor }");
    expect(SWEEP_BODY).toMatch(/orderBy:\s*\{\s*id:\s*"asc"\s*\}/u);
  });

  /*
   * ‎**מעקב אחרי פרסום שנסגר אינו יכול להתממש**, והוא ממשיך
   * ‏להיספר בגבול המעקבים של המשתמש — כלומר תופס מקום שאי אפשר
   * ‏לשחרר מהמסך, כי הכרטיס כבר אינו שם.
   */
  it("ומעקב מת נמחק בסבב", () => {
    expect(SWEEP_BODY).toContain("listingFollow.deleteMany");
    expect(SWEEP_BODY).toContain("stale");
  });

  /*
   * ‎**סוג שאינו בקטגוריה נופל ל-`system`** — כלומר מי שכיבה
   * ‏„רשת” ממשיך לקבל אותו כהודעה שאי אפשר לכבות.
   */
  it("וסוג ההתראה שייך לקטגוריה שאפשר לכבות", () => {
    expect(notifyCategory(LISTING_MATCH_NOTIFICATION_TYPE)).toBe("network");
  });

  /* ‏והכפילות נמנעת במסד, ולא בקריאה לפני כתיבה */
  it("והכתיבה מסתמכת על המפתח הייחודי", () => {
    expect(SWEEP_BODY).toContain("skipDuplicates: true");
    expect(SWEEP_BODY).toContain("listingMatchDedupeKey(follow.id");
  });
});

describe("שני הכיוונים אינם נפרדים", () => {
  /*
   * ‎**סבב אחד לשניהם.** שני מתזמנים על אותו קצב ואותה רשימת
   * ‏דיירים הם שני מקומות שצריך לזכור לעדכן יחד.
   */
  it("שניהם רצים באותו סבב", () => {
    expect(SWEEP).toContain("this.collaboration.sweepFollowsForTenant(");
    expect(SWEEP).toContain("this.listings.sweepFollowsForTenant(");
  });

  /*
   * ‎**ובשתי הצלות נפרדות**: כיוון שנופל על נתון פגום אינו אמור
   * ‏לבטל את השני, בדיוק כפי שמשרד שנופל אינו מבטל את השאר.
   */
  it("וכישלון בכיוון אחד אינו מבטל את השני", () => {
    const body = SWEEP.slice(SWEEP.indexOf("async sweepAll("));
    expect((body.match(/catch \(error: unknown\)/gu) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  /*
   * ‎**והכפתור קיים בשתי התצוגות.** תצוגת „שורות” נשמרת בין
   * ‏ביקורים, ולכן מי שבחר בה פעם היה רואה את הכפתור נעלם: לא
   * ‏יכול להפסיק לעקוב, והמעקב הנסתר ממשיך לתפוס מקום במכסה.
   * ‏אותה ביקורת התקבלה כבר בצד הביקושים, ואין סיבה לגלות אותה
   * ‏שוב בצד הנכסים.
   */
  it("והמעקב נגיש גם בתצוגת שורות וגם בכרטיס", () => {
    const page = readFileSync(
      join(import.meta.dirname, "../../../../web/src/app/collaboration/page.tsx"),
      "utf8",
    );
    for (const kind of ["demand", "listing"]) {
      const uses = page.match(new RegExp(`kind="${kind}"`, "gu")) ?? [];
      expect(uses.length, `${kind}: הכפתור בתצוגה אחת בלבד`).toBeGreaterThanOrEqual(2);
    }
  });

  /*
   * ‎**ואותה יכולת.** יכולת נפרדת לשני כיווני אותה פעולה הייתה
   * ‏טבלת הרשאות שצריך להסביר — ומנהל שנתן „הצעה ברשת” ולא הבין
   * ‏למה חצי מהמסך עדיין חסום.
   */
  it("ושני הכיוונים דורשים את אותה יכולת", () => {
    for (const route of ["demands/:id/follow", "listings/:id/follow"]) {
      const at = CONTROLLER.indexOf(`@Post("${route}")`);
      expect(at, `${route} לא נמצא`).toBeGreaterThan(-1);
      expect(CONTROLLER.slice(at, at + 120)).toContain(
        '@RequireCapability("collaboration.offer")',
      );
    }
  });

  /*
   * ‎**וההתאמה מחושבת באותה פונקציה שמציירת את הכרטיס.** עותק שני
   * ‏של „מה נחשב התאמה” פירושו מתווך שרואה „92% התאמה” בכרטיס לצד
   * ‏התראה שלא הגיעה — הכשל שכבר קרה במנטור.
   */
  it("וההתאמה מגיעה מ-matchOwnBuyers ולא מחישוב שני", () => {
    expect(SWEEP_BODY).toContain("this.matchOwnBuyers(");
    expect(SWEEP_BODY, "סף מקומי").not.toContain("NETWORK_MATCH_MIN_SCORE");
  });
});
