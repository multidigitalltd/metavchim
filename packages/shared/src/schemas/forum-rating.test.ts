import { describe, expect, it } from "vitest";
import { ForumRatingInputSchema, ForumThreadInputSchema } from "./forum.js";
import {
  FORUM_PRO_CATEGORY_LABELS,
  FORUM_PRO_INTRO,
  forumProWhatsappLink,
} from "../logic/forum.js";

/**
 * ‎**המדריך המקצועי — דירוג, שם, ופנייה לבעל המקצוע.**
 *
 * ## עילום שם בדירוג
 *
 * הכלל היה „תמיד בשם”, ונימוקו נשאר נכון: חוות דעת היא אמירה על
 * **העסק של מישהו אחר**, והוא זה שנושא את המחיר שלה. מה שהתברר הוא
 * שהמחיר של הכלל גבוה יותר — מתווך שעבד עם עורך דין או שמאי שמופיע
 * גם אצל הקולגה ממול פשוט **אינו כותב** את חוות הדעת השלילית, ומדריך
 * שיש בו רק חמישה כוכבים אינו מדריך.
 *
 * מה שנבדק כאן הוא שהבחירה עוברת בסכימה, ושברירת המחדל היא **בשם** —
 * לקוח ישן שאינו שולח את השדה אינו הופך בשקט לאנונימי.
 */
describe("דירוג במדריך — בשם או בעילום שם", () => {
  it("בקשה תקינה עוברת: ציון, ואפשר גם משפט", () => {
    expect(ForumRatingInputSchema.safeParse({ score: 5 }).success).toBe(true);
    const withComment = ForumRatingInputSchema.safeParse({ score: 3, comment: "עבד יפה, ענה מהר" });
    expect(withComment.success).toBe(true);
  });

  it("אפשר לבקש עילום שם במפורש", () => {
    const parsed = ForumRatingInputSchema.parse({ score: 2, anonymous: true });
    expect(parsed.anonymous).toBe(true);
  });

  /*
   * ‎**הלב: ברירת המחדל היא בשם.** לקוח ישן, סקריפט, או מסך שלא
   * עודכן אינם שולחים את השדה — ושתיקה אינה בקשה לעילום שם.
   */
  it("בלי השדה — הדירוג בשם", () => {
    expect(ForumRatingInputSchema.parse({ score: 4 }).anonymous).toBe(false);
    expect(ForumRatingInputSchema.parse({ score: 4, anonymous: false }).anonymous).toBe(false);
  });

  it("שאלה בפורום עדיין יכולה להיות בעילום שם", () => {
    const parsed = ForumThreadInputSchema.parse({
      kind: "question",
      topic: "legal",
      title: "שאלה מביכה על סעיף בהסכם",
      body: "גוף השאלה, ארוך מספיק כדי לעבור את המינימום שהסכמה דורשת",
      anonymous: true,
    });
    expect(parsed.anonymous).toBe(true);
  });
});

/**
 * ‎**הפנייה לבעל המקצוע — רק כשיש למי, ועם משפט פתיחה.**
 *
 * ‎`contact` הוא שדה חופשי במדריך: יש בו טלפון, יש בו מייל, ויש בו
 * שילוב. כפתור שנפתח על מה שאינו נייד ישראלי שולח הודעה שאיש אינו
 * מקבל — „נשלח” מבחינת המסך, ושום דבר מבחינת הנמען.
 */
describe("הודעת וואטסאפ לבעל מקצוע", () => {
  it("נייד ישראלי — קישור עם ההודעה כבר כתובה", () => {
    const link = forumProWhatsappLink("050-1234567");
    expect(link).toBe(
      `https://wa.me/972501234567?text=${encodeURIComponent(FORUM_PRO_INTRO)}`,
    );
  });

  it("ההודעה אומרת מאיפה הגענו", () => {
    expect(FORUM_PRO_INTRO).toContain("מערכת מתווכים");
  });

  it("מייל, קו נייח, ריק או שדה מעורב — אין כפתור", () => {
    expect(forumProWhatsappLink("office@example.com")).toBeNull();
    expect(forumProWhatsappLink("03-5551234")).toBeNull();
    expect(forumProWhatsappLink("")).toBeNull();
    expect(forumProWhatsappLink(null)).toBeNull();
    expect(forumProWhatsappLink("050-1234567 / office@example.com")).toBeNull();
  });
});

/*
 * ‏שינוי תווית, ולא שינוי מפתח: `home_stager` שמור בשורות קיימות
 * במאגר, ושינוי שלו היה מותיר אותן בקטגוריה שאינה בקטלוג.
 */
describe("קטגוריות בעלי מקצוע", () => {
  it("‏„אדריכלות ועיצוב פנים” במקום „הום סטיילינג”", () => {
    expect(FORUM_PRO_CATEGORY_LABELS.home_stager).toBe("אדריכלות ועיצוב פנים");
  });
});
