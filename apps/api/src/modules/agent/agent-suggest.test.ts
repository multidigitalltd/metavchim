import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { AGENT_ACTIONS, InterpretResponseSchema, buildInterpretPrompt } from "@metavchim/shared";

/**
 * ‎**„לא הבנתי” עם דרך החוצה — ובלי שהיציאה תהפוך לניחוש.**
 *
 * ## התקלה שהבדיקה הזו נולדה ממנה
 *
 * המודל סורק שבעים ושתיים פעולות, מכריע שאף אחת אינה מספיק קרובה
 * כדי לפעול לפיה — הכרעה נכונה — ואז המתווך מקבל „נסו לנסח אחרת”.
 * הוא אינו יודע *איך* אחרת, ולרוב פשוט מפסיק. הידיעה מה **כן** היה
 * קרוב הייתה קיימת אצל המודל באותו רגע, ונזרקה.
 *
 * ## ומה מסוכן בתיקון
 *
 * „אולי התכוונת” הוא בדיוק המקום שבו ניחוש מתחפש לעזרה. שלושה
 * גבולות מפרידים בין השניים, וכולם נבדקים כאן:
 *
 * 1. ‎**הצעה אינה ביצוע.** הלחיצה מפרשת מחדש; פעולה שכותבת עדיין
 *    נעצרת על אישור, ופעולה יוצאת עדיין דורשת בחירת נמען.
 * 2. ‎**הטקסט מהקטלוג, המזהה מהמודל.** מה שהמתווך קורא נכתב ונבדק
 *    מראש; „אולי התכוונת” אינו משטח שדרכו טקסט של מודל מגיע למסך.
 * 3. ‎**הבחירה של המתווך גוברת.** נעיצה שמומשה בפרומפט בלבד היא
 *    בקשה מנומסת: מודל שיחזיר פעולה אחרת היה מבטל בשקט את הלחיצה,
 *    וזה בדיוק מה שהופך כפתור לניחוש. היא נאכפת בקוד.
 */

const source = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^[ \t]*\/\/.*$/gmu, "");

const INTERPRET = source("./interpret.service.ts");
const RESOLVE = source("./resolve.service.ts");
const WHATSAPP = source("../messaging/whatsapp-assistant.service.ts");

describe("‎„אולי התכוונת” — ניקוי התשובה", () => {
  it("מזהה שאינו בקטלוג יורד, והתקין נשאר", () => {
    const parsed = InterpretResponseSchema.safeParse({
      action: "unknown",
      suggest: ["show_schedule", "פעולה_שאינה_קיימת", "create_task"],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.suggest).toEqual(["show_schedule", "create_task"]);
  });

  /*
   * הצעה היא שדה עזר, ולכן סטייה בה מנוקה ואינה מפילה — בדיוק
   * כמו `unmapped` ו-`clarify`. פענוח תקין שנפל בגלל שורה שרק
   * מציעה היה הופך שיפור לנסיגה.
   */
  it.each([
    ["מחרוזת בודדת", "show_tasks", ["show_tasks"]],
    ["מספר", 7, []],
    ["אובייקט", { a: 1 }, []],
    ["רשימה עם זבל", ["show_tasks", 3, null], ["show_tasks"]],
  ])("%s אינו מפיל את הפענוח", (_label, suggest, expected) => {
    const parsed = InterpretResponseSchema.safeParse({ action: "unknown", suggest });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.suggest).toEqual(expected);
  });

  it("היעדר השדה הוא רשימה ריקה ולא undefined", () => {
    const parsed = InterpretResponseSchema.safeParse({ action: "unknown" });
    expect(parsed.success && parsed.data.suggest).toEqual([]);
  });

  /* שלוש הצעות הן תפריט; רשימה ארוכה מזו היא הקטלוג מחדש. */
  it("יותר משלוש נחתך", () => {
    const parsed = InterpretResponseSchema.safeParse({
      action: "unknown",
      suggest: ["show_tasks", "show_calls", "show_leads", "show_deals"],
    });
    expect(parsed.success && parsed.data.suggest).toHaveLength(3);
  });
});

describe("‎הנעיצה — הבחירה של המתווך", () => {
  const allowedActions = AGENT_ACTIONS.map((action) => action.id);

  it("הפרומפט אומר למודל שהפעולה כבר נבחרה", () => {
    const pinned = buildInterpretPrompt("משהו", {
      nowText: "היום",
      allowedActions,
      pin: "create_task",
    });
    expect(pinned).toContain("הפעולה כבר נבחרה");
    expect(pinned).toContain("create_task");
  });

  it("בלי נעיצה אין סעיף נעיצה", () => {
    const plain = buildInterpretPrompt("משהו", { nowText: "היום", allowedActions });
    expect(plain).not.toContain("הפעולה כבר נבחרה");
  });

  /*
   * מזהה שאינו בקטלוג אינו כותב סעיף — אחרת הפרומפט היה מצהיר על
   * „פעולה” שאינה קיימת, והמודל היה נדרש לבחור בין הוראה למציאות.
   */
  it("נעיצה למזהה שאינו קיים אינה כותבת דבר", () => {
    const bogus = buildInterpretPrompt("משהו", {
      nowText: "היום",
      allowedActions,
      pin: "אין_כזו",
    });
    expect(bogus).not.toContain("הפעולה כבר נבחרה");
  });

  /*
   * ‎**האכיפה בקוד ולא בפרומפט בלבד.**
   *
   * זו השורה שהופכת את הלחיצה להכרעה: הפעולה שנבחרה גוברת על מה
   * שהמודל החזיר. בלעדיה כל הבדיקות שמעליה עוברות — הפרומפט מנוסח
   * יפה — והלחיצה עדיין מתבטלת בשקט כשהמודל בוחר אחרת.
   */
  it("הפעולה הנעוצה גוברת על תשובת המודל", () => {
    expect(INTERPRET).toContain("const chosenId = pin ?? answer.action;");
    expect(INTERPRET).toContain("agentAction(chosenId)");
  });

  /*
   * ‎**נעיצה שאינה מותרת עוצרת — ואינה מושמטת.**
   *
   * ההרשאה יכולה להישלל בין הרגע שההצעה הוצגה לרגע שנלחצה. השמטת
   * הנעיצה נראית כמו הגנה והיא ההפך: המשפט נפרש מחדש וחופשי, נבחרת
   * פעולה מותרת **אחרת**, ופעולת קריאה רצה מיד בשני הערוצים — אותה
   * תקלה בדיוק, בדלת אחרת (ביקורת Codex, P1).
   *
   * הכלל מוחלט: לחיצה מניבה את הפעולה שנלחצה, או שום פעולה.
   */
  it("נעיצה שאינה מותרת עוצרת ואינה מושמטת", () => {
    expect(INTERPRET).toMatch(
      /if \(pin !== undefined && !allowed\.some\(\(a\) => a\.id === pin\)\) \{/u,
    );
    const guard = INTERPRET.slice(
      INTERPRET.indexOf("if (pin !== undefined && !allowed.some"),
      INTERPRET.indexOf("const attempt = await this.viaLlm("),
    );
    expect(guard).toContain('actionId: "unknown"');
    // לא נקראת קריאה, ולא נופלים לחוקים — שניהם היו בוחרים פעולה אחרת
    expect(guard).not.toContain("viaRules");
    expect(guard).not.toContain("viaLlm");
  });

  /*
   * גם החסימה נרשמת ביומן: יציאה מוקדמת שאינה עוברת ברישום היא
   * בדיוק המקרה שנעלם ממנו.
   */
  it("גם נעיצה שנחסמה נרשמת ביומן", () => {
    expect(INTERPRET).toContain("private recorded(");
    expect(INTERPRET).toMatch(/return this\.recorded\(\s*\{/u);
  });

  /*
   * ‎**חסימה אינה „פירוש של מודל”.**
   *
   * הגזירה `fallback ? "rules" : "llm"` הייתה נכונה כל עוד היו שני
   * מסלולים. נעיצה שנחסמה אינה אף אחד מהם — לא נקראה קריאה ולא רץ
   * מנוע החוקים — ובגזירה היא נרשמה כ„llm” בלי מודל ובלי זמן תגובה.
   * יצוא השימוש בפלטפורמה חושף את השדה כמו שהוא, ולכן זו הייתה שורה
   * שקרית בדיוק בנתון שנועד למדוד עלות (ביקורת Codex).
   */
  it("חסימה נרשמת כ-blocked ולא כפירוש של מודל", () => {
    expect(INTERPRET).toContain('source: "llm" | "rules" | "blocked"');
    expect(INTERPRET).toMatch(/null,\s*"blocked",/u);
    // המקור נמסר במפורש ואינו נגזר בתוך הרישום
    const journal = INTERPRET.slice(INTERPRET.indexOf("private recorded("));
    expect(journal).not.toContain('interpretation.fallback ? "rules" : "llm"');
  });

  /*
   * המתווך לחץ על פעולה **אחת**. צעד המשך שהמודל היה מוסיף כאן הוא
   * פעולה שאיש לא בחר, נגררת אחרי לחיצה על אחרת.
   */
  it("נעיצה אינה גוררת צעדי המשך", () => {
    expect(INTERPRET).toContain("pin !== undefined ? [] : answer.steps");
  });

  /*
   * ‎**הבחירה שורדת גם את נפילת המודל.**
   *
   * קריאה נעוצה שנכשלה — ספק שותק, תשובה פגומה — נופלת לרצפה
   * הדטרמיניסטית. בלי העברת הנעיצה לשם, מנוע החוקים בוחר **מחדש**:
   * הוא מתאים את המשפט המקורי לביטוי שהוא כן מכיר, ופעולת קריאה רצה
   * מיד בשני הערוצים. כלומר לחיצה על „קבע פגישה” הייתה יכולה להריץ
   * בשקט חיפוש קונים ולהציג את תוצאותיו — בדיוק ההתנהגות שכל
   * המנגנון הזה נועד למנוע (ביקורת Codex, P1).
   */
  it("הנעיצה עוברת גם לרצפה הדטרמיניסטית", () => {
    expect(INTERPRET).toContain("this.viaRules(transcript, allowed, pin)");
    expect(INTERPRET).toContain("const actionId = pin ?? RULE_ACTION_MAP[command.action];");
  });
});

describe("‎חסימה אינה נספרת כקריאה למודל", () => {
  const USAGE_SERVICE = source("../platform/agent-usage.service.ts");
  const USAGE_SECTION = readFileSync(
    new URL("../../../../web/src/app/platform/agent-usage-section.tsx", import.meta.url),
    "utf8",
  );

  /*
   * ‎**הצריכה נספרת בהפרש, ולכן קטגוריה שלישית חייבת להיספר בעצמה.**
   *
   * מסך השימוש גוזר „כמה הבין המודל” כ-`interpretCount - rulesCount`.
   * חסימה נכנסת ל-`interpretCount` ואינה `rules`, ולכן בלי ניכוי
   * מפורש כל לחיצה חסומה מוצגת כקריאה ששולמה — בדיוק בנתון שנועד
   * למדוד עלות (ביקורת Codex).
   */
  it("הצבירה סופרת חסימות בנפרד", () => {
    expect(USAGE_SERVICE).toContain("blockedCount");
    expect(USAGE_SERVICE).toMatch(/source = 'blocked'\)::int\s+AS blocked_count/u);
  });

  /*
   * ‎**והשכבה השלישית: דאטת האימון.**
   *
   * הייצוא הוא „מה נאמר ⟵ מה הובן”, ובחסימה לא הובן דבר. השורה
   * נושאת `unknown` מסיבה שאין לה קשר למשפט, ואימון עליה מלמד
   * שמשפטים תקינים אינם מובנים.
   *
   * שורה ותיקה בלי מקור נשארת בפנים — היא פירוש לכל דבר, ותנאי
   * ‎`not` לבדו היה מפיל אותה (השוואה מול NULL אינה אמת).
   */
  it("חסימה אינה נכנסת לדאטת האימון, ושורה בלי מקור כן", () => {
    expect(USAGE_SERVICE).toContain('OR: [{ source: null }, { source: { not: "blocked" } }]');
  });

  it("מסך השימוש מנכה אותן מהספירה של המודל", () => {
    expect(USAGE_SECTION).toContain("const attempted = t.interpretCount - t.blockedCount;");
    expect(USAGE_SECTION).toContain("const llmCount = attempted - t.rulesCount;");
    // אותו בסיס גם לשיעור הזיהוי הבסיסי, אחרת ההטיה נכנסת להתראה
    expect(USAGE_SECTION).not.toContain("t.rulesCount / t.interpretCount");
  });
});

describe("‎התפריט המלא — נגיש גם למי שהסתיר את הדוגמאות", () => {
  const VOICE_PAGE = readFileSync(
    new URL("../../../../web/src/app/voice/page.tsx", import.meta.url),
    "utf8",
  );

  /*
   * „אל תציג דוגמאות יותר” היא העדפה שנשמרת לכל המכשירים, ומי שסימן
   * אותה בעבר הסתיר בכך את שורת הפתיחה — לא את התפריט. כשהמפתח
   * לרשימה ישב **בתוך** התיבה, בדיוק המשתמשים הוותיקים ביותר איבדו
   * את הדרך היחידה לגלות את מלוא היכולות — והיא נועדה בראש ובראשונה
   * להם (ביקורת Codex).
   */
  it("המפתח לרשימה יושב מחוץ לתיבת הדוגמאות שניתן להסתיר", () => {
    const dismissible = VOICE_PAGE.indexOf("examplesBox.hidden");
    const trigger = VOICE_PAGE.indexOf("מה את יודעת לעשות?");
    const never = VOICE_PAGE.indexOf("examplesBox.never");
    expect(dismissible).toBeGreaterThan(-1);
    expect(trigger).toBeGreaterThan(-1);
    // המפתח בא אחרי כפתור ההסתרה, כלומר מחוץ לגוש שנסגר יחד איתו
    expect(trigger).toBeGreaterThan(never);
  });

  it("התפריט נטען מהנתיב המשותף ולא מרשימה מקומית", () => {
    expect(VOICE_PAGE).toContain('apiGet<AgentHelp>("/agent/help")');
    expect(VOICE_PAGE).not.toContain("const FEATURED");
  });
});

describe("‎ההצעות — מסוננות, מהקטלוג, ובשני הערוצים", () => {
  /*
   * הצעה שתיחסם בביצוע גרועה מהיעדר הצעה: היא נראית כמו דרך החוצה
   * ואינה. המודל רואה רק פעולות מותרות, אבל „רואה” אינו „מובטח”.
   */
  it("מסוננות למה שלמשתמש מותר", () => {
    expect(INTERPRET).toMatch(/suggest: \[\.\.\.new Set\(answer\.suggest\)\]\.filter/u);
    expect(INTERPRET).toContain("allowed.some((a) => a.id === id)");
  });

  it("הכותרת והדוגמה נגזרות מהקטלוג ולא מהמודל", () => {
    expect(RESOLVE).toMatch(/interpretation\.suggest\.flatMap/u);
    expect(RESOLVE).toContain("const suggested = agentAction(id);");
    expect(RESOLVE).toContain("title: suggested.title");
    expect(RESOLVE).toContain("suggested.examples[0]");
  });

  /*
   * ‎**שני הערוצים, אותה יציאה.** ליבה אחת משרתת את הוואטסאפ ואת
   * הצ'אט במסך, והנחיית בעל המוצר מפורשת: שיפור בסוכן אחד הוא
   * שיפור בשניהם. „לא הבנתי” שנשאר קיר בערוץ אחד הוא בדיוק חצי
   * התיקון שהיה נשכח.
   */
  it("הוואטסאפ מציע אותן, ושומר את הבחירה כמצב ממתין", () => {
    expect(WHATSAPP).toContain('awaiting: "suggest"');
    expect(WHATSAPP).toContain("proposal.suggestions ?? []");
    expect(WHATSAPP).toMatch(/suggestions: suggestions\.map\(\(s\) => s\.actionId\)/u);
  });

  /*
   * לחיצה מפרשת מחדש את **המשפט שנאמר** ולא את הדוגמה: הפרטים
   * שהמתווך כבר אמר — שם, עיר, מועד — חייבים לשרוד את הבחירה,
   * אחרת „אולי התכוונת” הוא בקשה להתחיל מהתחלה.
   */
  it("הלחיצה מפרשת מחדש את המשפט המקורי", () => {
    expect(WHATSAPP).toMatch(
      /this\.propose\(chat, pending\.transcript, null, speaker, ids\[picked\]!\)/u,
    );
  });

  /*
   * ‎**בחירת כוונה אינה נצרכת אטומית.** `takePending` קיים כדי
   * שאישור כפול לא יבצע פעמיים; כאן אין ביצוע, והתחרטות („בעצם
   * השנייה”) חייבת להישאר אפשרית.
   */
  it("בחירת הצעה אינה עוברת דרך הצריכה האטומית", () => {
    const branch = WHATSAPP.slice(
      WHATSAPP.indexOf('if (pending.awaiting === "suggest")'),
      WHATSAPP.indexOf('if (pending.awaiting === "choice")'),
    );
    expect(branch.length).toBeGreaterThan(0);
    expect(branch).not.toContain("takePending");
  });
});
