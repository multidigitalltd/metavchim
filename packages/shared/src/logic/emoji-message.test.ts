import { describe, expect, it } from "vitest";

import {
  emojiOnlyReply,
  emojiSentiment,
  isEmojiOnlyMessage,
} from "./emoji-message.js";

describe("isEmojiOnlyMessage — מה נחשב „הודעת אימוג'י”", () => {
  it("אימוג'י בודד, כמה ברצף, ועם רווחים", () => {
    expect(isEmojiOnlyMessage("👍")).toBe(true);
    expect(isEmojiOnlyMessage("👍👍👍")).toBe(true);
    expect(isEmojiOnlyMessage("  🙏 ❤️  ")).toBe(true);
    expect(isEmojiOnlyMessage("🎉🥳")).toBe(true);
  });

  /*
   * ‎**אימוג'י מורכב הוא אימוג'י אחד.** גוון עור, מחבר אפס-רוחב
   * ובורר וריאציה הם מה שמרכיב אותו — ולא „תווים אחרים” שפוסלים.
   */
  it("גוון עור, משפחה מחוברת ודגל", () => {
    expect(isEmojiOnlyMessage("👍🏽")).toBe(true);
    expect(isEmojiOnlyMessage("👨‍👩‍👧")).toBe(true);
    expect(isEmojiOnlyMessage("🇮🇱")).toBe(true);
    expect(isEmojiOnlyMessage("❤️")).toBe(true);
  });

  /*
   * ‎**הודעה עם מילים ממשיכה למנוע ההבנה.** „👍 תשלח לו את הנכס”
   * היא בקשה לכל דבר, והאגודל שבתחילתה אינו הופך אותה לאישור.
   */
  it("טקסט לצד אימוג'י אינו הודעת אימוג'י", () => {
    expect(isEmojiOnlyMessage("👍 תשלח לו את הנכס")).toBe(false);
    expect(isEmojiOnlyMessage("תודה 🙏")).toBe(false);
    expect(isEmojiOnlyMessage("ok")).toBe(false);
    expect(isEmojiOnlyMessage("")).toBe(false);
    expect(isEmojiOnlyMessage("   ")).toBe(false);
  });

  /*
   * ‎**מספר סידורי הוא איך שבוחרים רשומה מרשימה**, ולכן הוא חייב
   * להמשיך להגיע למנוע. ‎`3️⃣` בנוי מספרה ועוד סימני צירוף, ובלי
   * פסילה מפורשת הוא היה נראה „אימוג'י” והבחירה הייתה נבלעת.
   */
  it("ספרה ו„ספרה בתיבה” אינן הודעת אימוג'י", () => {
    expect(isEmojiOnlyMessage("3")).toBe(false);
    expect(isEmojiOnlyMessage("3️⃣")).toBe(false);
    expect(isEmojiOnlyMessage("#️⃣")).toBe(false);
  });
});

describe("emojiSentiment — שלוש קטגוריות, לא רשימה פתוחה", () => {
  it("חיובי, שלילי, וכל השאר ניטרלי", () => {
    expect(emojiSentiment("👍")).toBe("positive");
    expect(emojiSentiment("🙏")).toBe("positive");
    expect(emojiSentiment("❤️")).toBe("positive");
    expect(emojiSentiment("👎")).toBe("negative");
    expect(emojiSentiment("😡")).toBe("negative");
    expect(emojiSentiment("🚗")).toBe("neutral");
    expect(emojiSentiment("🤔")).toBe("neutral");
  });

  /* הראשון הוא מה שנאמר; מה שאחריו הדגשה */
  it("הסיווג לפי האימוג'י הראשון", () => {
    expect(emojiSentiment("👍🔥🔥")).toBe("positive");
    expect(emojiSentiment("👎😞")).toBe("negative");
  });

  /* ‏`❤️` ו-`❤` הם אותו לב — בורר הווריאציה אינו משנה את המשמעות */
  it("בורר וריאציה אינו משנה סיווג", () => {
    expect(emojiSentiment("❤")).toBe("positive");
    expect(emojiSentiment("✔️")).toBe("positive");
  });
});

describe("emojiOnlyReply — תשובה של אדם, לא רשימת יכולות", () => {
  /*
   * ‏זו כל הנקודה: מי שכתב 👍 קיבל „לא הבנתי, אולי התכוונת…” ורשימת
   * ‏הצעות. התשובה החדשה אינה מונה מה המערכת יודעת לעשות.
   */
  it("שלוש תשובות קצרות, ואף אחת אינה מונה יכולות", () => {
    for (const sentiment of ["positive", "negative", "neutral"] as const) {
      const reply = emojiOnlyReply(sentiment);
      expect(reply.length).toBeLessThan(80);
      expect(reply).not.toContain("אולי התכוונת");
      expect(reply).not.toContain("אקסל");
    }
    expect(emojiOnlyReply("positive")).not.toBe(emojiOnlyReply("negative"));
  });
});
