import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * ‎**דיוור אוטומטי שאי אפשר לצאת ממנו הוא הפרת חוק, לא תקלת מוצר.**
 *
 * חוק התקשורת §30א דורש דרך פשוטה וסבירה להודיע על סירוב, ובדיוור
 * אוטומטי אין „רוב ההודעות”. שלוש הדרישות שנשמרות כאן הן בדיוק אלה
 * שאפשר להסיר בלי ששום בדיקה אחרת תבחין:
 *
 * ‎1. הקישור נבנה ונשלח בכל הודעה.
 * ‎2. מי שהסיר את עצמו יוצא מרשימת הנמענים — **לפני** השליחה.
 * ‎3. הסימון נתפס לפני השליחה, כדי ששני עותקים לא ישלחו פעמיים.
 *
 * הנוסח עצמו והשלבים נבדקים ביחידה
 * ‎(`packages/shared/src/logic/activation-nudge.test.ts`); כאן נבדק
 * החיווט, שדורש מסד וספק דואר כדי לרוץ.
 */

/** השער קורא קוד ולא הערות — הערה שמזכירה כלל אינה קיום שלו. */
function code(name: string): string {
  return readFileSync(join(import.meta.dirname, name), "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^[ \t]*\/\/.*$/gmu, "");
}

const SERVICE = code("activation-nudge.service.ts");

describe("תזכורות ההפעלה", () => {
  it("כל תזכורת נושאת קישור הסרה שנבנה מהטוקן של הנמען", () => {
    expect(SERVICE, "אין קישור הסרה").toContain("optOutUrl:");
    expect(SERVICE, "הקישור אינו מצביע לדף ההסרה").toMatch(/nudge-optout\/\$\{owner\.token\}/u);
  });

  /*
   * ‎**„מי שהסיר” נבדק בשליפת הנמענים.** בדיקה שיושבת אחרי בניית
   * ההודעה או אחרי השליחה אינה הסרה — היא רק תיעוד של מה שכבר יצא.
   */
  it("מי שהסיר את עצמו אינו ברשימת הנמענים", () => {
    const owners = SERVICE.slice(SERVICE.indexOf("private async owners("));
    expect(owners, "ההסרה אינה נשלפת").toContain("optedOutAt");
    expect(owners, "אין דילוג על מי שהסיר").toMatch(
      /optedOutAt !== null && optedOutAt !== undefined\) continue/u,
    );
  });

  /*
   * הטוקן חייב לשרוד בין הודעות: קישור הסרה ממייל בן חודש שנשמר
   * בתיבה חייב להמשיך לעבוד. טוקן שנוצר מחדש בכל שליחה שובר אותו.
   */
  it("הטוקן נשמר ואינו מוגרל מחדש בכל שליחה", () => {
    const owners = SERVICE.slice(SERVICE.indexOf("private async owners("));
    expect(owners, "הטוקן הקיים אינו מועדף").toMatch(/row\.nudgeOptOut\?\.token \?\?/u);
  });

  /*
   * ‎**תפיסה לפני שליחה.** שני עותקים של ה-API רצים במקביל; בלי
   * התפיסה המותנית שניהם קוראים „טרם נשלח” ושולחים. אותה מכניקה
   * כמו ב-`OnboardingOutreachService`, ומאותה סיבה.
   */
  it("הסימון נתפס לפני השליחה, ומשוחרר רק כשאיש לא קיבל", () => {
    const at = SERVICE.indexOf("private async nudgeTenant(");
    const scope = SERVICE.slice(at, SERVICE.indexOf("\n  }\n", at));
    const claim = scope.indexOf("this.claim(");
    const send = scope.indexOf("this.email.send(");
    expect(claim, "אין תפיסת סימון").toBeGreaterThan(-1);
    expect(send, "השליחה קודמת לתפיסה").toBeGreaterThan(claim);
    expect(scope, "אין שחרור כשאיש לא קיבל").toMatch(/delivered > 0/u);
    expect(scope, "השליחה אינה מסומנת required").toContain("required: true");
  });

  /*
   * ‎**שני התנאים שבלעדיהם התזכורת היא שקר.** מסלול חינמי אינו פוקע
   * ‏(`tenantPeriodEnded` מחזיר `false` עבורו), וכרטיס תקף פירושו
   * שאין על מה להזכיר. שניהם נבדקים לפני בחירת השלב.
   */
  it("מסלול חינמי וכרטיס תקף אינם מקבלים תזכורת", () => {
    const at = SERVICE.indexOf("private async nudgeTenant(");
    const scope = SERVICE.slice(at, SERVICE.indexOf("\n  }\n", at));
    const free = scope.indexOf("isFreeCode(");
    const card = scope.indexOf("hasValidCard(");
    const stage = scope.indexOf("dueActivationNudge(");
    expect(free, "מסלול חינמי אינו נבדק").toBeGreaterThan(-1);
    expect(card, "תוקף הכרטיס אינו נבדק").toBeGreaterThan(-1);
    expect(stage, "השלב נבחר לפני הסינון").toBeGreaterThan(Math.max(free, card));
  });

  /*
   * שם המסלול נקרא מהקטלוג ואינו כתוב בקוד: התזכורת מבטיחה ללקוח
   * לאן הוא עובר, ושם קבוע הופך את ההבטחה הזאת לניחוש.
   */
  it("שם מסלול השותפים מגיע מהקטלוג ולא מהקוד", () => {
    expect(SERVICE).toContain('this.settings.get("partnerPlanCode")');
    expect(SERVICE).toMatch(/this\.plans\.byCode\(code\)/u);
    expect(SERVICE, "שם מסלול כתוב בקוד").not.toMatch(/partnerPlanName = "/u);
  });
});
