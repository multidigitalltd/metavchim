import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * ‎**שיחה אחת, שלושה כותבים, ליבה אחת.**
 *
 * צ'אט הוואטסאפ, צ'אט המסך וסורק ההתראות בוורקר כותבים כולם לעמודת
 * ‎`history` של אותה שורה — זה מה שעושה את השיחה רציפה בין הערוצים.
 * שלושת מרכיבי הליבה (מפתח המנעול, הפירוק, המיזוג) יושבים ב-shared,
 * וניסוח מקומי אצל כותב אחד הוא הכפילות שמפרידה את הערוצים — היא
 * כבר קרתה פעם אחת, עם שני חלונות היסטוריה שונים שמחקו זה את זה.
 */

const read = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^[ \t]*\/\/.*$/gmu, "");

const WA = read("../messaging/whatsapp-assistant.service.ts");
const WORKER = read("../../../../workers/src/main.ts");
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
});
