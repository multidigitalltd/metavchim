import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * ‎**כפתורי צעדי ההמשך — קשורים לתוכן, ובשני הערוצים מאותו מקור.**
 *
 * הבקשה: „שהכפתורים שהוא שולח עם ההודעות שלו יהיו קשורים לתוכן”.
 * המימוש: `agentNextSteps` נגזר מהתוצאה שחזרה (שם שקיים בה, פעולה
 * שמותרת), וכל צעד הופך לכפתור שנושא את **המשפט עצמו** — לחיצה
 * שולחת אותו למנוע כאילו הוקלד.
 *
 * הצורה הזו עומדת על שלוש נקודות תפר שהקומפיילר אינו רואה:
 *
 * 1. **מקור אחד** — הוואטסאפ והמסך גוזרים את הצעדים מאותו
 *    ‎`nextSteps`. שני מקורות היו נפרדים זה מזה בשינוי הראשון,
 *    והמתווך היה מקבל כפתורים שונים לאותה שאלה בשני הערוצים.
 * 2. **מסלול ביצוע אחד** — הלחיצה שולחת טקסט, לא פקודה. כפתור
 *    שמבצע ישירות היה עוקף את עצירת ה„אשר” של פעולה כותבת.
 * 3. **תקרה סימטרית** — מזהה כפתור ב-Meta מוגבל, ולכן משפט ארוך
 *    מסונן בבנייה **ונדחה** גם בלחיצה, באותו קבוע. צד אחד בלי
 *    השני שולח כפתור שהלחיצה עליו שקטה — או מקבל מזהה קטום
 *    שמתפרש אחרת ממה שהוצג.
 */

const read = (url: URL): string =>
  readFileSync(url, "utf8")
    // בלי הסרת הערות, טענה על „הקוד עושה X” מתקיימת על ההסבר של X
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^[ \t]*\/\/.*$/gmu, "")
    .replace(/^[ \t]*\{\/\*[\s\S]*?\*\/\}/gmu, "");

const WA = read(new URL("./whatsapp-assistant.service.ts", import.meta.url));
const EXECUTE = read(new URL("../agent/execute.service.ts", import.meta.url));
const BUTTONS = read(new URL("./assistant-buttons.ts", import.meta.url));
const VOICE_PAGE = read(new URL("../../../../web/src/app/voice/page.tsx", import.meta.url));

describe("צעדי ההמשך הם כפתורים — מהתוכן, בשני הערוצים", () => {
  it("המקור הוא הצעדים הנגזרים, בתקרת הכפתורים של Meta", () => {
    // ההפקה: agentNextSteps על התוצאה, לא רשימה קבועה
    expect(EXECUTE).toMatch(/const derived = agentNextSteps\(/u);
    // כל הצעדים נחשפים — עד שלושה, תקרת „תשובה מהירה”
    expect(EXECUTE).toMatch(/final\.nextSteps = derived\.slice\(0, 3\)/u);
  });

  it("בוואטסאפ כל צעד הוא כפתור cmd שנושא את המשפט עצמו", () => {
    expect(WA).toMatch(
      /steps\.map\(\(step\) => \(\{\s*action: "cmd",\s*arg: step\.text,\s*title: step\.label,/u,
    );
    // והמשפטים נשארים גם בטקסט — הנפילה לטקסט אינה מאבדת אותם
    expect(WA).toMatch(/steps\.map\(\(step\) => `· „\$\{step\.text\}”`\)/u);
  });

  it("התקרה נאכפת בשני הצדדים — בבנייה ובלחיצה, מאותו קבוע", () => {
    // בנייה: משפט ארוך מהתקרה אינו הופך לכפתור
    expect(WA).toMatch(/filter\(\(step\) => step\.text\.length <= CMD_TEXT_MAX\)/u);
    // לחיצה: מזהה ארוך מהתקרה נדחה — קטום אינו הפקודה שהוצגה
    expect(BUTTONS).toMatch(/arg === undefined \|\| arg\.length > CMD_TEXT_MAX/u);
  });

  it("הלחיצה שולחת טקסט למנוע — אין מסלול ביצוע שני", () => {
    /*
     * ‎`buttonAsText` מחזיר את המשפט, והמשפט נכנס לאותו מסלול
     * הבנה⟵אישור כמו הודעה מוקלדת. כפתור cmd שמפעיל dispatch
     * ישירות היה עוקף את עצירת ה„אשר”.
     */
    expect(BUTTONS).toMatch(/if \(action === "cmd"\) \{[\s\S]*?return BUTTON_COMMANDS\[arg\] \?\?/u);
    expect(WA).toMatch(/buttonAsText\(button\.action, button\.arg\)/u);
  });

  it("המסך גוזר מאותם צעדים, והלחיצה שולחת את אותו משפט", () => {
    // הצעדים מגיעים דרך התוכנית המשותפת — מקטע steps, לא שליפה מקומית
    expect(VOICE_PAGE).toMatch(/segment\.steps\.map\(\(step\) =>/u);
    // בצ'אט הלחיצה שולחת את המשפט כתור חדש — אותו מסלול כמו הקלדה
    expect(VOICE_PAGE).toMatch(/void send\(step\.text\)/u);
  });

  it("suggestion הוא רשת ביטחון — הכלל בתוכנית המשותפת, ושני הערוצים צורכים אותה", () => {
    /*
     * „רק כשאין צעד נגזר” יושב עכשיו ב-`agentReplySegments` (עם
     * בדיקת יחידה משלו) — שני מקורות יחד היו אותה עצה פעמיים.
     * מה שנאכף כאן: שני הערוצים בונים את התשובה מהתוכנית, ואינם
     * שולפים `suggestion` ישירות מהתוצאה להצגה.
     */
    expect(WA).toMatch(/agentReplySegments\(\{/u);
    expect(VOICE_PAGE).toMatch(/agentReplySegments\(item\.result\)/u);
    expect(VOICE_PAGE).not.toMatch(/result\.suggestion/u);
  });

  it("הבדיקה אכן קוראת את ארבעת הקבצים", () => {
    for (const source of [WA, EXECUTE, BUTTONS, VOICE_PAGE]) {
      expect(source.length).toBeGreaterThan(500);
    }
  });

  /*
   * ‎**„שאילתה רצה מיד” — כלל אחד, לא שני ניסוחים.**
   *
   * הנחיית בעל המוצר: ליבת הסוכן אחידה לשני הערוצים, בלי כפילויות.
   * הכלל הזה בדיוק כבר נפרד פעם אחת — הוואטסאפ ענה מיד והמסך דרש
   * „הצג תשובה”. שני הערוצים קוראים ל-`proposalRunsImmediately`
   * המשותפת, ואף אחד מהם אינו גוזר את התנאי מחדש אצלו.
   */
  it("הכלל „רץ מיד” נקרא מהמשותף בשני הערוצים — ולא מנוסח מקומית", () => {
    expect(WA).toMatch(/proposalRunsImmediately\(proposal\)/u);
    expect(VOICE_PAGE).toMatch(/proposalRunsImmediately\(proposal\)/u);
    // ניסוח מקומי של אותו תנאי הוא הכפילות שהכלל המשותף בא למחוק
    for (const source of [WA, VOICE_PAGE]) {
      expect(source).not.toMatch(/risk === "read" &&[\s\S]{0,200}followUps/u);
    }
  });
});
