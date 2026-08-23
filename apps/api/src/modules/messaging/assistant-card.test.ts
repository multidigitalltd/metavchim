import { describe, expect, it } from "vitest";
import { formatCard } from "./assistant-card";

describe("formatCard", () => {
  it("מה שאינו כרטיס נופל חזרה לסיכום הרגיל", () => {
    expect(formatCard(undefined)).toBeNull();
    expect(formatCard({ buyers: [{ name: "משה" }] })).toBeNull();
  });

  it("כרטיס קונה — טלפון, דרישות והערות", () => {
    const text = formatCard({
      card: {
        kind: "buyer",
        contact: { name: "משה כהן", phone: "050-1234567" },
        requirements: {
          cities: ["גבעתיים", "רמת גן"],
          roomsMin: 3,
          roomsMax: 4,
          budgetMaxAgorot: 250_000_000,
        },
        maturity: "very_hot",
        agentNotes: "גמיש בקומה",
        calls: [],
      },
    });
    expect(text).toContain("050-1234567");
    expect(text).toContain("גבעתיים, רמת גן");
    expect(text).toContain("3–4");
    expect(text).toContain("חם מאוד");
    expect(text).toContain("גמיש בקומה");
  });

  /*
   * התוויות באות מהסכימה. טבלה מקומית שהמציאה ערכים („פושר”, „קר”)
   * הציגה `very_hot` גולמי על רוב הכרטיסים האמיתיים.
   */
  it("כל ערכי הבשלות שבסכימה מתורגמים לעברית", () => {
    for (const [value, label] of [
      ["very_hot", "חם מאוד"],
      ["hot", "חם"],
      ["interested", "מתעניין"],
      ["not_ripe", "לא בשל"],
    ]) {
      const text = formatCard({
        card: {
          kind: "buyer",
          contact: { name: "משה", phone: "050-1234567" },
          requirements: { cities: [] },
          maturity: value,
          calls: [],
        },
      });
      expect(text, value).toContain(`🌡️ בשלות: ${label}`);
    }
  });

  /*
   * אותה בדיקה, לשאר הערכים הסגורים: הבשלות תוקנה והליד נשאר גולמי
   * באותה פונקציה — המתווך קיבל `in_progress` ו-`rent_in` בוואטסאפ
   * (ביקורת Codex). הטבלאות מגיעות מהסכימה, וכאן נבדק שהן בשימוש.
   */
  it("כל ערכי הליד שבסכימה מתורגמים לעברית", () => {
    const cases: [string, string, string][] = [
      ["status", "📊 סטטוס", "in_progress"],
      ["intent", "🎯 עניין", "rent_in"],
      ["source", "📍 מקור", "voice_call"],
    ];
    const expected: Record<string, string> = {
      in_progress: "בטיפול",
      rent_in: "שוכר",
      voice_call: "שיחה",
    };
    for (const [field, label, value] of cases) {
      const text = formatCard({
        card: { kind: "lead", contact: { phone: "050-1234567" }, [field]: value, calls: [] },
      });
      expect(text, value).toContain(`${label}: ${expected[value]}`);
      expect(text, value).not.toContain(value);
    }
  });

  it("מימון הקונה מתורגם ואינו מוצג כערך פנימי", () => {
    const text = formatCard({
      card: {
        kind: "buyer",
        contact: { phone: "050-1234567" },
        requirements: { cities: [] },
        financing: "pre_approved",
        calls: [],
      },
    });
    expect(text).toContain("🏦 מימון: אישור עקרוני ביד");
    expect(text).not.toContain("pre_approved");
  });

  /*
   * מקור הקונה ותוצאת השיחה — שני השדות שנשארו גולמיים אחרי הסבב
   * הקודם, באותה פונקציה (ביקורת Codex).
   */
  it("מקור הקונה מתורגם, כולל קונה שהומר מליד", () => {
    for (const [source, expected] of [
      ["voice", "סוכן קולי"],
      ["whatsapp", "וואטסאפ"],
      ["lead:landing", "ליד (דף נחיתה)"],
      ["lead:web_form", "ליד (אתר)"],
    ]) {
      const text = formatCard({
        card: {
          kind: "buyer",
          contact: { phone: "050-1234567" },
          requirements: { cities: [] },
          source,
          calls: [],
        },
      });
      expect(text, source).toContain(`📍 מקור: ${expected}`);
    }
  });

  it("תוצאת השיחה מתורגמת בשורות ההיסטוריה", () => {
    const text = formatCard({
      card: {
        kind: "lead",
        contact: { phone: "050-1234567" },
        calls: [{ direction: "inbound", occurredAt: "2026-01-01T10:00:00Z", outcome: "no_answer" }],
      },
    });
    expect(text).toContain("אין מענה");
    expect(text).not.toContain("no_answer");
  });
  /* ערך שאינו בטבלה — שורה ישנה במסד — מוצג כמות שהוא ולא נעלם. */
  it("ערך לא מוכר מוצג כמות שהוא", () => {
    const text = formatCard({
      card: { kind: "lead", contact: { phone: "050-1234567" }, status: "legacy_value", calls: [] },
    });
    expect(text).toContain("📊 סטטוס: legacy_value");
  });

  it("שדה חסר פשוט אינו מוצג — בלי „לא צוין” שממלא את המסך", () => {
    const text = formatCard({
      card: {
        kind: "buyer",
        contact: { name: "דנה", phone: "050-0000000" },
        requirements: { cities: [] },
        calls: [],
      },
    });
    expect(text).toContain("050-0000000");
    expect(text).not.toContain("ערים");
    expect(text).not.toContain("תקציב");
  });

  it("שיחה מוקלטת מסומנת, ונאמר איך לבקש אותה", () => {
    const text = formatCard({
      card: {
        kind: "lead",
        contact: { name: "שרה", phone: "050-1111111" },
        status: "new",
        calls: [
          {
            id: "c1",
            direction: "inbound",
            occurredAt: new Date("2026-08-20T09:00:00Z"),
            outcome: "answered",
            hasRecording: true,
          },
        ],
      },
    });
    expect(text).toContain("🎧");
    expect(text).toContain("תשמיע לי את השיחה איתו");
  });

  it("שיחה בלי הקלטה אינה מזמינה לבקש אחת", () => {
    const text = formatCard({
      card: {
        kind: "lead",
        contact: { name: "שרה", phone: "050-1111111" },
        status: "new",
        calls: [
          {
            id: "c1",
            direction: "outbound",
            occurredAt: new Date("2026-08-20T09:00:00Z"),
            outcome: "no_answer",
            hasRecording: false,
          },
        ],
      },
    });
    expect(text).toContain("שיחות אחרונות");
    expect(text).not.toContain("תשמיע לי");
  });

  it("ליד שדורש טיפול אנושי מסומן במפורש", () => {
    const text = formatCard({
      card: {
        kind: "lead",
        contact: { name: "שרה", phone: "050-1111111" },
        status: "new",
        requiresHuman: true,
        calls: [],
      },
    });
    expect(text).toContain("דורש טיפול אנושי");
  });
});
