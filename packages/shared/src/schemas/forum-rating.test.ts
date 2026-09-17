import { describe, expect, it } from "vitest";
import { ForumRatingInputSchema, ForumThreadInputSchema } from "./forum.js";

/**
 * ‎**דירוג במדריך הוא היוצא מן הכלל של הפורום: תמיד בשם** (docs/16 §2א).
 *
 * ## למה דווקא כאן
 *
 * עילום שם מגן על מי שכותב, ובשאלה זה בדיוק הנכון — הסיכון שהיא
 * מביאה הוא על השואל בלבד. בדירוג הכיוון מתהפך: חוות דעת היא אמירה
 * על **העסק של מישהו אחר**, והוא זה שנושא את המחיר, בלי יכולת לענות
 * או אפילו לדעת על מה מדובר.
 *
 * ## ולמה בדיקה על הסכמה
 *
 * הסרת תיבת סימון מהמסך אינה אכיפה — לקוח אחר, סקריפט או גרסה ישנה
 * ממשיכים לשלוח את השדה. הסכמה `strict`, ולכן בקשה כזו **נדחית**
 * ולא נשמרת „כלא-אנונימית” בשקט. זה מה שנבדק כאן.
 */
describe("דירוג במדריך — תמיד בשם", () => {
  it("בקשה תקינה עוברת: ציון, ואפשר גם משפט", () => {
    expect(ForumRatingInputSchema.safeParse({ score: 5 }).success).toBe(true);
    const withComment = ForumRatingInputSchema.safeParse({ score: 3, comment: "עבד יפה, ענה מהר" });
    expect(withComment.success).toBe(true);
  });

  /* ‏הלב: אין דרך לבקש עילום שם, גם לא מפורשות וגם לא כברירת מחדל */
  it("‏`anonymous` נדחה — גם true וגם false", () => {
    expect(ForumRatingInputSchema.safeParse({ score: 5, anonymous: true }).success).toBe(false);
    expect(ForumRatingInputSchema.safeParse({ score: 5, anonymous: false }).success).toBe(false);
  });

  it("התוצאה אינה נושאת את השדה בכלל, גם לא כברירת מחדל", () => {
    const parsed = ForumRatingInputSchema.parse({ score: 4 });
    expect(Object.hasOwn(parsed, "anonymous")).toBe(false);
  });

  /*
   * ‎**והאנונימיות בפורום עצמו נשארת.** הכלל הוא צר בכוונה: דירוג
   * בלבד. שאלה בעילום שם היא הסיבה שהפורום קיים.
   */
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
