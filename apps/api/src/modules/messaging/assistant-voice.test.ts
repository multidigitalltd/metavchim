import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * ‎**התשובה הקולית — תוספת, לעולם לא תחליף.**
 *
 * שלושה גבולות שהפיצ'ר עומד עליהם ואף אחד מהם אינו נראה לקומפיילר:
 *
 * 1. **הטקסט והכפתורים נשלחים תמיד, לפני השמע.** כפתור אי אפשר
 *    לשמוע, וקישור אי אפשר ללחוץ מתוך הקלטה. שמע ששולח „במקום”
 *    היה מוחק בדיוק את מה שהכפתורים נבנו בשבילו.
 * 2. **מוקרא רק `speak`** — המסקנה והתובנה שכבר עברו את שומר
 *    העובדות — לא `text` המלא עם רשימות וקישורים (וטלפונים
 *    שבשורות התוצאה).
 * 3. **הקלטת שיחה גוברת על הקראה** — שתי הודעות שמע באותה תשובה
 *    הן רעש, וההקלטה היא מה שהמתווך ביקש.
 */

const read = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^[ \t]*\/\/.*$/gmu, "");

const WA = read("./whatsapp-assistant.service.ts");

describe("התשובה הקולית בוואטסאפ", () => {
  it("הטקסט והכפתורים נשלחים לפני השמע — לא במקומו", () => {
    const deliver = WA.slice(
      WA.indexOf("private async deliver("),
      WA.indexOf("private staleClick("),
    );
    const textAt = deliver.indexOf("sendButtons");
    const audioAt = deliver.indexOf("sendAudio");
    expect(textAt).toBeGreaterThan(-1);
    expect(audioAt).toBeGreaterThan(-1);
    expect(textAt).toBeLessThan(audioAt);
  });

  it("מוקרא רק speak — לא הטקסט המלא", () => {
    const spoken = WA.slice(
      WA.indexOf("private async withSpokenReply("),
      WA.indexOf("private async deliver("),
    );
    expect(spoken).toContain("this.gemini.speak(reply.speak)");
    expect(spoken).not.toMatch(/speak\(reply\.text\)/u);
  });

  it("גם שאלות הסוכן מדוברות — אישור ובחירה אינם שקטים (ביקורת Codex)", () => {
    const propose = WA.slice(
      WA.indexOf("private async propose("),
      WA.indexOf("private paramsOf("),
    );
    // כרטיס האישור — התשובה הנפוצה ביותר — נושא speak
    expect(propose).toContain("speak: `${this.spokenProposal(proposal)}");
    // רשימת מועמדים — מוקראת השאלה, לא האפשרויות
    const choice = propose.slice(
      propose.indexOf("candidates.options.length > 0"),
      propose.indexOf("const state: PendingState"),
    );
    expect(choice).toMatch(/speak: /u);
    expect(choice).not.toMatch(/speak:[^\n]*detail/u);
    // הניסוח המדובר לעולם אינו קורא פרטי מועמדים מהמאגר
    const spokenProposal = WA.slice(
      WA.indexOf("private spokenProposal("),
      WA.indexOf("private describeProposal("),
    );
    expect(spokenProposal).not.toContain("candidates");
    expect(spokenProposal).not.toContain("option");
  });

  it("הקלטת שיחה גוברת על הקראה, וכשל משאיר טקסט", () => {
    const spoken = WA.slice(
      WA.indexOf("private async withSpokenReply("),
      WA.indexOf("private async deliver("),
    );
    expect(spoken).toMatch(/if \(reply\.audio !== undefined\) return reply;/u);
    // כל כשל בדרך — TTS או המרה — מחזיר את התשובה כמות שהיא
    expect(spoken).toMatch(/if \(wav === null\) return reply;/u);
    expect(spoken).toMatch(/if \(audio === null\) return reply;/u);
  });
});
