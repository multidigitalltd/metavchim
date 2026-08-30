import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * ‎**החיוג בלחיצה מצלצל היכן שיש מי שיענה.**
 *
 * ## התקלה
 *
 * הגרסה הראשונה של המעבר לסופטפון בחרה את שלוחת ה-SIP בכל פעם
 * שהיא הוגדרה לסוכן:
 *
 * ```ts
 * const agentLine = sipLine || agent?.phone?.trim() || …;
 * ```
 *
 * זה נראה נכון וזה היה הפוך. `ClickToDial` מחייג ישירות ב-WebRTC
 * כשהסופטפון **רשום** ויש בידו את מספר הלקוח, ורק אחרת פונה לשרת —
 * כלומר הנתיב הזה נקרא בדיוק כשאין סופטפון רשום. שלוחה שאיש אינו
 * רשום אליה היא שיחה שמצלצלת בשום מקום, בעוד שהכפתור מבטיח
 * ‎„המרכזייה תצלצל לטלפון שלכם” (ביקורת Codex).
 *
 * ## מה נשמר
 *
 * השרת אינו יכול לדעת אם הדפדפן רשום — הרישום הוא בין הדפדפן
 * למרכזייה. לכן הלקוח מדווח, והשרת בוחר לפי הדיווח ולא לפי עצם
 * קיומה של שלוחה. השער נועל את שני הצדדים יחד, כי תיקון של אחד
 * בלי השני מחזיר את התקלה.
 */

const API = join(import.meta.dirname, "..", "..");
const SERVICE = readFileSync(join(API, "modules/telephony/telephony.service.ts"), "utf8");
const CONTROLLER = readFileSync(join(API, "modules/telephony/telephony.controller.ts"), "utf8");
const CLIENT = readFileSync(
  join(API, "..", "..", "web", "src", "app", "click-to-dial.tsx"),
  "utf8",
);

describe("היעד של החיוג בלחיצה", () => {
  it("השלוחה נבחרת רק כשהלקוח דיווח שהסופטפון רשום", () => {
    expect(SERVICE).toContain('const useSip = input.softphone === true && sipLine !== "";');
  });

  /*
   * זו הצורה השגויה עצמה. היא נבדקת כמחרוזת כי היא **נראית** נכונה,
   * ומי שיכתוב אותה מחדש יעשה זאת מאותו היגיון שהוליד אותה.
   */
  it("השלוחה אינה נבחרת רק מפני שהיא הוגדרה", () => {
    expect(SERVICE).not.toContain("const agentLine = sipLine ||");
  });

  it("‏answer1 נגזר מאותה הכרעה, ולא מקיום השלוחה", () => {
    expect(SERVICE).toContain("softphone: useSip,");
    expect(SERVICE).not.toContain('softphone: sipLine !== ""');
  });

  it("הנפילה-לאחור לנייד ואז לקו ברירת המחדל נשמרה", () => {
    expect(SERVICE).toContain('agent?.phone?.trim() || config["defaultLine"]?.trim() || ""');
  });

  it("הנתיב מקבל את הדגל, והלקוח שולח אותו", () => {
    expect(CONTROLLER).toContain("softphone: z.boolean().optional()");
    expect(CLIENT).toContain("const registered = softphone.call !== undefined;");
    expect(CLIENT).toContain("...(registered ? { softphone: true } : {})");
  });

  /*
   * ‎„הטלפון שלכם מצלצל” על שיחה שנפתחת בדפדפן שולחת את הסוכן
   * לחפש את הנייד. ההודעה נגזרת מאותו דגל.
   */
  it("ההודעה למשתמש אומרת היכן השיחה נפתחת", () => {
    expect(CLIENT).toContain("השיחה נפתחת בסופטפון");
    expect(CLIENT).toContain("הטלפון שלכם מצלצל");
  });
});
