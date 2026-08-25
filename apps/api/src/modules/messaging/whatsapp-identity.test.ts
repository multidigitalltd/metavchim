import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  WHATSAPP_LINK_MAX_AGE_DAYS,
  linkNeedsReverification,
  normalizeWhatsappLinkCode,
} from "@metavchim/shared";

/**
 * הזהות בערוץ הוואטסאפ — **מי מדבר איתנו, ומי אמר את זה.**
 *
 * ## למה חלק מהבדיקות כאן מבניות
 *
 * ההכרעה עצמה נבדקת בהתנהגות (הלוגיקה המשותפת), אבל **מיקומה**
 * בזרימה הוא מה שנשבר בקלות: בדיקת הקוד חייבת לקרות לפני הזיהוי,
 * וההשוואה למספר חייבת לחדול מלהכריע בריבוי. שניהם שורות בודדות
 * שאפשר להזיז בלי שאף בדיקה תרגיש — ולכן הן נבדקות במפורש.
 */

const source = readFileSync(
  new URL("./whatsapp-assistant.service.ts", import.meta.url),
  "utf8",
);

describe("סדר ההכרעה בהודעה נכנסת", () => {
  it("קוד הקישור נבדק לפני זיהוי המשתמש", () => {
    const code = source.indexOf("isWhatsappLinkCodeMessage");
    const identify = source.indexOf("await this.identifyUser(");
    expect(code).toBeGreaterThan(0);
    expect(identify).toBeGreaterThan(0);
    /*
     * אחרת ניסיון קישור ממספר לא מוכר היה מתגלגל למסלול המתעניין,
     * ומקבל מענה שיווקי במקום להיקשר.
     */
    expect(code).toBeLessThan(identify);
  });

  it("והקישור נבדק לפני השוואת המספר", () => {
    const resolve = source.indexOf("this.links.resolve(");
    const byPhone = source.indexOf("this.identifyByPhone(");
    expect(resolve).toBeGreaterThan(0);
    expect(resolve).toBeLessThan(byPhone);
  });
});

/*
 * „הפעיל לאחרונה מנצח” היה ניחוש שקט ברשומות של מישהו אחר, והאזהרה
 * שנרשמה לצדו לא עצרה דבר. רק שני המשתמשים יודעים מי מהם מחזיק
 * במכשיר, ולכן ההכרעה חוזרת אליהם בדמות קוד.
 */
describe("ריבוי אינו מוכרע", () => {
  it("שני משתמשים עם אותו מספר אינם מזוהים לפי הטלפון", () => {
    const fn = source.slice(
      source.indexOf("private async identifyByPhone("),
      source.indexOf("private async loadUser("),
    );
    expect(fn).toContain("matched.length > 1");
    expect(fn).toContain("return null");
    // והבחירה השקטה שהייתה כאן נמחקה
    expect(fn).not.toContain("נבחר ");
  });

  it("וחשבון שהושבת אינו מזוהה גם כשהקישור שלו קיים", () => {
    const fn = source.slice(source.indexOf("private async loadUser("));
    expect(fn).toContain("isActive: true");
  });
});

describe("הקוד עצמו", () => {
  it("הודעה רגילה אינה נחשבת לניסיון קישור", () => {
    expect(normalizeWhatsappLinkCode("מה יש לי ביומן")).toBeNull();
  });

  it("וקישור ישן נדרש לאימות מחדש", () => {
    const now = new Date("2026-08-25T00:00:00Z");
    const old = new Date(now.getTime() - (WHATSAPP_LINK_MAX_AGE_DAYS + 1) * 86_400_000);
    expect(linkNeedsReverification(old, now)).toBe(true);
  });
});

/*
 * הקישור הוא מפתח למאגר שלם, ולכן שינוי מספר הטלפון מנתק אותו:
 * מי שמעדכן מספר עשה זאת בדרך כלל כי החליף קו או מכשיר, ומי
 * שמחזיק עכשיו במספר הישן אינו אמור להישאר עם גישה.
 */
describe("החלפת מספר מנתקת", () => {
  const auth = readFileSync(
    new URL("../auth/auth.service.ts", import.meta.url),
    "utf8",
  );

  it("עדכון הפרופיל מנתק את הקישור כשהמספר השתנה", () => {
    expect(auth).toContain("phoneChanging");
    expect(auth).toContain('this.whatsappLinks.revoke(userId, "phone_changed")');
  });

  it("והשוואה היא מול המספר הקודם, לא מול הקלט בלבד", () => {
    expect(auth).toContain("data.phone !== user.phone");
  });
});
