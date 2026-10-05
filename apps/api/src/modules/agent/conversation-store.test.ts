import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { workersSource } from "../../common/workers-source.testkit";

/**
 * ‎**שיחה אחת, שלושה כותבים, ליבה אחת.**
 *
 * צ'אט הוואטסאפ, צ'אט המסך וסורק ההתראות בוורקר כותבים כולם לעמודת
 * ‎`history` של אותה שורה — זה מה שעושה את השיחה רציפה בין הערוצים.
 * שלושת מרכיבי הליבה (מפתח המנעול, הפירוק, המיזוג) יושבים ב-shared,
 * וניסוח מקומי אצל כותב אחד הוא הכפילות שמפרידה את הערוצים — היא
 * כבר קרתה פעם אחת, עם שני חלונות היסטוריה שונים שמחקו זה את זה.
 */

const strip = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^[ \t]*\/\/.*$/gmu, "");
const read = (relative: string): string =>
  strip(readFileSync(new URL(relative, import.meta.url), "utf8"));

const WA = read("../messaging/whatsapp-assistant.service.ts");
const WORKER = strip(workersSource());
const SCREEN = read("./agent-conversation.service.ts");

describe("ליבת אחסון השיחה", () => {
  it("אין מפתח מנעול מקומי — כולם עוברים דרך המשותף", () => {
    // תבנית `wa-chat:` שמורכבת מקומית היא ניסוח שני של המפתח
    for (const [name, source] of [
      ["whatsapp", WA],
      ["worker", WORKER],
      ["screen", SCREEN],
    ] as const) {
      expect(source, name).not.toMatch(/`wa-chat:\$\{/u);
    }
    expect(WA).toMatch(/lockConversation\(tx,/u);
    expect(SCREEN).toMatch(/lockConversation\(tx,/u);
    expect(WORKER).toMatch(/conversationLockKey\(/u);
  });

  it("הפירוק והמיזוג משותפים — לא Array.isArray ו-slice מקומיים", () => {
    expect(WA).toMatch(/mergeTurns\(parseTurns\(/u);
    expect(SCREEN).toMatch(/mergeTurns\(parseTurns\(/u);
    expect(WORKER).toMatch(/mergeStoredTurns\(/u);
    expect(WORKER).toMatch(/parseStoredTurns\(/u);
    /*
     * מיזוג מקומי — חיתוך לחלון ההיסטוריה מחוץ לפונקציה המשותפת —
     * הוא בדיוק מה שיצר בעבר שני חלונות שמחקו זה את זה.
     */
    for (const [name, source] of [
      ["worker", WORKER],
      ["screen", SCREEN],
    ] as const) {
      expect(source, name).not.toMatch(/slice\(-\(?AGENT_HISTORY_KEPT/u);
    }
  });

  it("המסך כותב היסטוריה בלבד — pending ו-handledIds הם של הוואטסאפ", () => {
    expect(SCREEN).not.toMatch(/pending|handledIds/u);
  });

  /*
   * ‎**תור התראה שנשמר חייב לעבור את סכימת ההקשר.** סורק ההתראות
   * כותב לשיחה תורות `action: "notify"` עם `origin: "assistant"`,
   * והמסך מחזיר את השיחה השמורה כ-history. סכימה שמכירה רק את
   * קטלוג הפעולות דחתה כל בקשה שתור כזה נכלל בה — 400 על השיחה
   * כולה, בדיוק במקום שההמשכיות הובטחה (ביקורת Codex, P1).
   */
  it("תור התראה עובר את הסכימה — לא 400 על השיחה כולה", () => {
    const controller = read("./agent.controller.ts");
    expect(controller).toMatch(/\[\.\.\.AGENT_ACTION_IDS, "notify", "unknown"\]/u);
    expect(controller).toMatch(/origin: z\.enum\(\["user", "assistant"\]\)\.optional\(\)/u);
  });

  /*
   * ‎**תשובה חופשית נזכרת — בשני הערוצים, באותה צורה.** אותה סיבה
   * כמו תור ההתראה: תור שנשמר ונדחה בסכימה מפיל את השיחה כולה.
   * והתור נבנה בפונקציה המשותפת, לא בניסוח מקומי שיסטה בערוץ אחד.
   */
  it("תור של תשובה חופשית נשמר ועובר את הסכימה", () => {
    const controller = read("./agent.controller.ts");
    expect(controller).toMatch(/reply: z\.string\(\)\.max\(AGENT_RESULT_SUMMARY_MAX\)\.optional\(\)/u);
    const branch = WA.slice(
      WA.indexOf('if (proposal.reply !== undefined && proposal.reply !== "")'),
      WA.indexOf("return { text: proposal.reply, speak: proposal.reply };"),
    );
    expect(branch).toContain("this.remember(chat, agentReplyTurn(text, proposal.reply));");
    const screen = read("../../../../web/src/app/voice/page.tsx");
    expect(screen).toContain("keep(agentReplyTurn(text, proposal.reply));");
  });
});
