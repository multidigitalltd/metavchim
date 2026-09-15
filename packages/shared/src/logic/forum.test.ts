import { describe, expect, it } from "vitest";
import {
  commissionBreakdown,
  forumActivityEmail,
  forumPseudonyms,
  forumReplyNotice,
  forumSearchTsquery,
  forumSnippet,
  monthlyPayment,
  parseAnonymousPrefix,
  parseForumPrefs,
  purchaseTax,
  PURCHASE_TAX_ADDITIONAL_HOME,
  PURCHASE_TAX_SINGLE_HOME,
  ratingAverage,
  rentalYieldPercent,
} from "./forum.js";

describe("כינויי האנונימיות — מחושבים מסדר ההופעה", () => {
  it("מחבר השרשור האנונימי הוא „השואל/ת”, והשאר ממוספרים לפי הופעה ראשונה", () => {
    const names = forumPseudonyms("asker", true, [
      { authorKey: "b", anonymous: true },
      { authorKey: "asker", anonymous: true },
      { authorKey: "named", anonymous: false },
      { authorKey: "c", anonymous: true },
      { authorKey: "b", anonymous: true },
    ]);
    expect(names.get("asker")).toBe("השואל/ת");
    expect(names.get("b")).toBe("אנונימי 1");
    expect(names.get("c")).toBe("אנונימי 2");
    // מחבר מזוהה אינו מקבל כינוי — שמו מוצג כפי שהוא
    expect(names.has("named")).toBe(false);
  });

  it("שרשור מזוהה — מחברו אינו „השואל/ת” גם כשהוא עונה", () => {
    const names = forumPseudonyms("asker", false, [{ authorKey: "asker", anonymous: false }]);
    expect(names.size).toBe(0);
  });
});

describe("תחילית „אנונימי:” בוואטסאפ", () => {
  it("מזהה את התחילית ומסירה אותה", () => {
    expect(parseAnonymousPrefix("אנונימי: לדעתי כדאי לבדוק בטאבו")).toEqual({
      anonymous: true,
      text: "לדעתי כדאי לבדוק בטאבו",
    });
    expect(parseAnonymousPrefix("בעילום שם - זה קרה גם לי")).toEqual({
      anonymous: true,
      text: "זה קרה גם לי",
    });
  });
  it("בלי תחילית — טקסט כפי שהוא, מזוהה", () => {
    expect(parseAnonymousPrefix("  זה קרה גם לי ")).toEqual({ anonymous: false, text: "זה קרה גם לי" });
  });
});

describe("קטע פתיחה", () => {
  it("קצר — חוזר שלם; ארוך — נחתך במילה עם שלוש נקודות", () => {
    expect(forumSnippet("שאלה   קצרה\nבשתי שורות")).toBe("שאלה קצרה בשתי שורות");
    const long = "מילה ".repeat(60).trim();
    const cut = forumSnippet(long, 50);
    expect(cut.length).toBeLessThanOrEqual(51);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut).not.toMatch(/מיל…$/u);
  });
});

describe("ניסוחי התראות", () => {
  it("כותרת התגובה נושאת את המשיב ואת השרשור, ונשארת בגבול העמודה", () => {
    const notice = forumReplyNotice({
      threadTitle: "ש".repeat(300),
      authorLabel: "אנונימי 1",
      reply: "ת".repeat(900),
    });
    expect(notice.title.startsWith("אנונימי 1 בפורום: ")).toBe(true);
    expect(notice.title.length).toBeLessThanOrEqual(200);
    expect(notice.body.length).toBeLessThanOrEqual(500);
  });
});

describe("העדפות הפורום", () => {
  it("ברירת מחדל: מייל דלוק ומיידי, בלי מעקב אחרי הכול", () => {
    expect(parseForumPrefs(undefined)).toEqual({ followAll: false, email: true, digest: "instant" });
    expect(parseForumPrefs({ forum: { digest: "weekly", email: false } })).toEqual({
      followAll: false,
      email: false,
      digest: "instant",
    });
    expect(parseForumPrefs({ forum: { followAll: true, digest: "daily" } }).digest).toBe("daily");
  });
});

describe("מייל הפעילות — אחד לכל מה שהצטבר", () => {
  it("נושא לפי הכמות, קישור אחד לכל שרשור, ולא יותר משנים-עשר", () => {
    const items = Array.from({ length: 15 }, (_, i) => ({
      type: "forum_reply",
      title: `תגובה ${i}`,
      body: "גוף",
      threadId: i < 3 ? "SAME" : `T${i}`,
    }));
    const mail = forumActivityEmail("דנה", items, "https://app.example/", "instant");
    expect(mail.subject).toBe("הפורום המקצועי — 15 עדכונים חדשים");
    expect(mail.content.greeting).toBe("שלום דנה,");
    expect(mail.content.links?.length).toBe(12);
    expect(mail.content.links?.[0]?.url).toBe("https://app.example/forum/t/SAME");
    expect(mail.content.button?.url).toBe("https://app.example/forum");
  });
  it("עדכון יחיד — הנושא הוא הכותרת שלו", () => {
    const mail = forumActivityEmail("דנה", [{ type: "forum_reply", title: "מישהו ענה", body: null, threadId: "T" }], "https://x", "daily");
    expect(mail.subject).toBe("מישהו ענה");
  });
});

describe("חיפוש — תחיליות עבריות", () => {
  it("„הבלעדיות” מוצא „בלעדיות” וגם „בבלעדיות”; מילה קצרה אינה נגזרת", () => {
    const query = forumSearchTsquery("הבלעדיות");
    expect(query).toContain("(בלעדיות:* | הבלעדיות:* | ובלעדיות:* | בבלעדיות:*");
    expect(forumSearchTsquery("בית")).toContain("(בית:*");
    expect(forumSearchTsquery("מס שבח")).toMatch(/^\(.*\) & \(.*\)$/u);
    // תווים שאינם אותיות נעלמים — אין דרך להזריק אופרטור
    expect(forumSearchTsquery("!&|:'")).toBeNull();
    expect(forumSearchTsquery("שבח | x")).not.toContain("|  x");
  });
});

describe("דירוג", () => {
  it("ממוצע לעשירית, null בלי דירוגים", () => {
    expect(ratingAverage(0, 0)).toBeNull();
    expect(ratingAverage(13, 3)).toBe(4.3);
  });
});

describe("מחשבונים", () => {
  it("עמלה: 2% על 2,000,000 ₪ + מע\"מ 18%", () => {
    const split = commissionBreakdown(200_000_000, 2, 18);
    expect(split.netAgorot).toBe(4_000_000);
    expect(split.vatAgorot).toBe(720_000);
    expect(split.grossAgorot).toBe(4_720_000);
  });

  it("החזר חודשי: מיליון ₪ ל-25 שנה ב-5% ≈ 5,846 ₪", () => {
    expect(Math.round(monthlyPayment(100_000_000, 5, 25) / 100)).toBe(5846);
    expect(monthlyPayment(120_000, 0, 1)).toBe(10_000);
    expect(monthlyPayment(0, 5, 25)).toBe(0);
  });

  it("תשואה: 4,000 ₪ לחודש על 1,200,000 ₪ = 4%", () => {
    expect(rentalYieldPercent(120_000_000, 400_000)).toBe(4);
    expect(rentalYieldPercent(0, 400_000)).toBeNull();
  });

  it("מס רכישה מדורג — כל מדרגה על החלק שבתוכה", () => {
    expect(purchaseTax(1_500_000, PURCHASE_TAX_SINGLE_HOME)).toBe(0);
    // 2,000,000: 3.5% על 21,255 שמעל המדרגה הראשונה
    expect(purchaseTax(2_000_000, PURCHASE_TAX_SINGLE_HOME)).toBe(744);
    // דירה נוספת: 8% על הכול עד 6,055,070
    expect(purchaseTax(2_000_000, PURCHASE_TAX_ADDITIONAL_HOME)).toBe(160_000);
    expect(purchaseTax(0, PURCHASE_TAX_SINGLE_HOME)).toBe(0);
  });
});
