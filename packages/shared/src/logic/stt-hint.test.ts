import { describe, expect, it } from "vitest";
import { STT_CALL_HINT, STT_DICTATION_HINT } from "./stt-hint.js";

/**
 * ‎**מה שנבדק כאן הוא מה ששובר את הרמז בפועל.**
 *
 * הרמז אינו לוגיקה — הוא טקסט שמוזן למודל — ולכן אין כאן „פלט
 * צפוי”. מה שכן אפשר לקבע: שאוצר המילים באמת נמצא בשניהם (הבאג
 * היה שמסלול אחד לא קיבל כלום), ושהצורה היא זו שהמודל מצפה לה.
 */
describe("רמזי אוצר המילים לתמלול", () => {
  /*
   * המונחים שבגללם הרמז קיים. „ממ״ד” חוזר „ממד” ו„בלעדיות” חוזרת
   * „בעלות” כשהם אינם בהקשר, ושתי הטעויות משנות את משמעות השיחה.
   */
  const MUST_CARRY = ['ממ"ד', "בלעדיות", "טאבו", 'מ"ר', "משכנתא", "עמלה"];

  it("שני המסלולים נושאים את אותו אוצר מילים", () => {
    for (const term of MUST_CARRY) {
      expect(STT_DICTATION_HINT).toContain(term);
      expect(STT_CALL_HINT).toContain(term);
    }
  });

  /*
   * ‎**זו הטענה שהבאג היה מפר.** תמלול השיחות לא שלח רמז כלל, ולכן
   * הבדיקה החשובה אינה „שני המחרוזות שונות” אלא ששתיהן קיימות ואף
   * אחת אינה ריקה — מחרוזת ריקה עוברת בשקט דרך `form.append`.
   */
  it("אף רמז אינו ריק", () => {
    expect(STT_DICTATION_HINT.trim().length).toBeGreaterThan(80);
    expect(STT_CALL_HINT.trim().length).toBeGreaterThan(80);
  });

  /*
   * ‎`initial_prompt` נקרא כהקשר שקדם להקלטה, ולכן משפט ולא רשימה.
   * המסגור נבדל בין השניים בכוונה: הכתבה היא מונולוג, שיחה היא שניים.
   */
  it("ההקשר הפותח מתאר את סוג ההקלטה", () => {
    expect(STT_CALL_HINT).toContain("שיחת טלפון");
    expect(STT_CALL_HINT).toContain("לקוח");
    expect(STT_DICTATION_HINT).not.toContain("שיחת טלפון");
  });

  it("שניהם מסתיימים כמשפט, לא כרשימה פתוחה", () => {
    expect(STT_DICTATION_HINT.endsWith(".")).toBe(true);
    expect(STT_CALL_HINT.endsWith(".")).toBe(true);
  });
});
