import { describe, expect, it } from "vitest";
import {
  MENTOR_THREAD_GAP_MS,
  MENTOR_THREAD_TITLE_MAX,
  mentorStartsNewThread,
  mentorThreadTitle,
} from "./mentor-thread.js";

const at = (iso: string): Date => new Date(iso);

describe("mentorStartsNewThread — איפה שיחה נגמרת", () => {
  it("ההודעה הראשונה בחיים פותחת שיחה", () => {
    expect(mentorStartsNewThread(null, at("2026-09-09T08:00:00Z"))).toBe(true);
  });

  /*
   * המקרה שהמספר נבחר בשבילו: הפסקת צהריים אינה נושא חדש.
   */
  it("שעתיים אינן מפסיקות שיחה", () => {
    expect(
      mentorStartsNewThread(at("2026-09-09T08:00:00Z"), at("2026-09-09T10:00:00Z")),
    ).toBe(false);
  });

  it("לחזור בערב אל מה ששאלת בבוקר — שיחה חדשה", () => {
    expect(
      mentorStartsNewThread(at("2026-09-09T08:00:00Z"), at("2026-09-09T20:00:00Z")),
    ).toBe(true);
  });

  /* ‏הגבול עצמו: „יותר מ” ולא „לפחות” — שווה בדיוק אינו מפסיק */
  it("בדיוק על הגבול נשארים באותה שיחה", () => {
    const start = at("2026-09-09T08:00:00Z");
    const edge = new Date(start.getTime() + MENTOR_THREAD_GAP_MS);
    expect(mentorStartsNewThread(start, edge)).toBe(false);
    expect(mentorStartsNewThread(start, new Date(edge.getTime() + 1))).toBe(true);
  });

  it("מחר בבוקר זו תמיד שיחה חדשה", () => {
    expect(
      mentorStartsNewThread(at("2026-09-09T17:00:00Z"), at("2026-09-10T08:00:00Z")),
    ).toBe(true);
  });
});

describe("mentorThreadTitle — שם השיחה הוא מה ששאלו בה", () => {
  it("שאלה קצרה היא הכותרת עצמה", () => {
    expect(mentorThreadTitle("מה המצב ביעדים שלי?")).toBe("מה המצב ביעדים שלי?");
  });

  it("שורות חדשות מתקפלות — הכותרת היא שורה אחת", () => {
    expect(mentorThreadTitle("מה המצב\n\nביעדים   שלי?")).toBe("מה המצב ביעדים שלי?");
  });

  it("שיחה בלי שאלה מקבלת שם ולא נשארת ריקה", () => {
    expect(mentorThreadTitle(null)).toBe("שיחה ללא שאלה");
    expect(mentorThreadTitle("   ")).toBe("שיחה ללא שאלה");
  });

  /*
   * ‏החיתוך נעצר בגבול מילה כשיש אחד קרוב, כי „מה המצ…” קורא כמו
   * ‏תקלה ולא כמו קיצור.
   */
  it("שאלה ארוכה נחתכת בגבול מילה", () => {
    const long =
      "אני רוצה להבין למה השבוע היו לי פחות פגישות מהשבוע שעבר ומה כדאי לי לשנות";
    const title = mentorThreadTitle(long);
    expect(title.length).toBeLessThanOrEqual(MENTOR_THREAD_TITLE_MAX + 1);
    expect(title.endsWith("…")).toBe(true);
    expect(title).not.toMatch(/\s…$/u);
    /* ‏המילה האחרונה שלמה — הכותרת היא רישא של הטקסט המקורי */
    expect(long.startsWith(title.slice(0, -1))).toBe(true);
  });

  /*
   * ‏מילה אחת ארוכה מהגבול אינה משאירה כותרת ריקה: כשאין רווח קרוב
   * ‏החיתוך נעשה בתו, וזה עדיף על „…” לבד.
   */
  it("מילה אחת ארוכה נחתכת בתו ולא נעלמת", () => {
    const title = mentorThreadTitle("א".repeat(120));
    expect(title.length).toBe(MENTOR_THREAD_TITLE_MAX + 1);
    expect(title.startsWith("אאא")).toBe(true);
  });
});
