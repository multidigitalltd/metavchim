import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * ‎**החיווט של ההעשרה בעובד** — מה שאין עליו קומפיילר.
 *
 * ## למה בדיקת קוד ולא בדיקת התנהגות
 *
 * הניסוח ושער ההרשאה נבדקים בהתנהגות ב-`notify-details.test.ts`,
 * בלי מסד ובלי Meta. מה שנשאר כאן הוא **הסדר בתוך לולאת השליחה**:
 * שהטעינה נעשית פעם אחת למשרד, שההרשאה נבדקת פר-נמען ולא פעם
 * אחת לכולם, ושכפתור כללי לא חוזר כברירת מחדל. שלושתם נשברים
 * בשקט — התראה שיצאה בלי פרטים אינה מתלוננת, והתראה שיצאה עם
 * פרטים של קונה של עמית לא תתגלה עד שמישהו יתלונן.
 */

const WORKERS = readFileSync(
  new URL("../../../../../apps/workers/src/main.ts", import.meta.url),
  "utf8",
);

/** גוף פונקציית ההעשרה עצמה — הטעינות, לא החיווט. */
const loader = (): string => {
  const start = WORKERS.indexOf("async function loadNotifyDetails(");
  const end = WORKERS.indexOf("interface WaRecipient", start);
  expect(start, "loadNotifyDetails נעלמה").toBeGreaterThan(0);
  return WORKERS.slice(start, end);
};

describe("העשרת ההתראות בעובד", () => {
  it("הפרטים נטענים פעם אחת למשרד, לא פעם לכל נמען", () => {
    const body = WORKERS.slice(
      WORKERS.indexOf("const notifyDetails = await loadNotifyDetails("),
      WORKERS.indexOf("const watermark = recipient.notifiedThrough"),
    );
    expect(body).toContain("loadNotifyDetails(tenant.id, pending)");
    /*
     * קריאה בתוך `for (const recipient ...)` הייתה מכפילה את אותן
     * שאילתות בכל סוכן במשרד — ובמשרד של עשרה סוכנים זה פי עשרה
     * בכל דקה.
     */
    expect(
      body.indexOf("loadNotifyDetails("),
      "הטעינה חייבת להקדים את לולאת הנמענים",
    ).toBeLessThan(body.indexOf("for (const recipient of recipients.values())"));
  });

  it("הצופה מוחלף פר-נמען — אחרת ההרשאה נבדקת פעם אחת לכולם", () => {
    const call = WORKERS.slice(
      WORKERS.indexOf("const message = formatNotifyMessage(items, webOrigin, {"),
      WORKERS.indexOf("if (fitsInteractive(message))"),
    );
    expect(call).toContain("userId: recipient.userId");
    expect(call).toContain("capabilities: recipient.capabilities");
  });

  it("היכולות של הכפתור והיכולות של הפרטים הן אותן יכולות", () => {
    const build = WORKERS.slice(
      WORKERS.indexOf("const capabilities = applyBlockedModules("),
      WORKERS.indexOf("if (recipients.size === 0) continue;"),
    );
    expect(build).toContain("allowedActionIds: allowedActionsFor(capabilities)");
    expect(build).toContain("capabilities: [...capabilities]");
  });

  it("„מה דחוף היום?” נשאר לתקציר בלבד ואינו ברירת מחדל", () => {
    const buttons = WORKERS.slice(
      WORKERS.indexOf("const buttons: WhatsAppButton[] = [];"),
      WORKERS.indexOf("replyButtonsPayload(recipient.phone, message, buttons)"),
    );
    expect(buttons).toContain('dominantNotifyCategory(items) === "digests"');
    /*
     * הצורה שהייתה כאן: שלישייה שמחזירה את הכפתור הכללי בכל פעם
     * ש-`notifyFollowUp` לא כיסה את הקטגוריה — כלומר שאלה כללית
     * מתחת להתראה על שיחה שלא נענתה.
     */
    expect(buttons, "כפתור כללי כברירת מחדל").not.toMatch(/follow === null\s*\n?\s*\?/u);
  });

  /*
   * ההשתקה נצמדה לכל הודעה כי היא הייתה פקד כפתור בלבד. מרגע
   * ש-`parseSnoozeRequest` מבין אותה כמשפט, כפתור קבוע מתחת לכל
   * עדכון הוא רעש. הבדיקה מקבעת גם את מה שמאפשר את ההסרה.
   */
  it("„שקט לשעתיים” ירד מההתראות — הוא משפט עכשיו", () => {
    const send = WORKERS.slice(
      WORKERS.indexOf("const buttons: WhatsAppButton[] = [];"),
      WORKERS.indexOf("} else {", WORKERS.indexOf("const buttons: WhatsAppButton[] = [];")),
    );
    expect(send, "כפתור השתקה על כל התראה").not.toContain('action: "snooze"');
  });

  it("הודעה בלי כפתורים נשלחת כטקסט — אינטראקטיבית ריקה נדחית ב-Meta", () => {
    const send = WORKERS.slice(
      WORKERS.indexOf("const buttons: WhatsAppButton[] = [];"),
      WORKERS.indexOf("} else {", WORKERS.indexOf("const buttons: WhatsAppButton[] = [];")),
    );
    expect(send).toContain("buttons.length === 0");
    expect(send).toContain('type: "text"');
  });

  it("כישלון בהעשרה מחזיר מפה ריקה ואינו מפיל את הסבב", () => {
    const fn = loader();
    expect(fn).toContain("catch (error)");
    expect(fn).toContain("return new Map()");
  });

  it("ההעשרה מסננת לפי המשרד בכל שאילתה", () => {
    const fn = loader();
    expect(fn).toContain("set_config('app.tenant_id'");
    /*
     * ‏`tenantId` על כל `where` ולא רק הישענות על RLS: השאילתות
     * רצות בטרנזקציה אחת, ושכחה של `set_config` הייתה הופכת את
     * כולן לחוצות-משרד בבת אחת.
     */
    const wheres = fn.match(/where: \{ tenantId/gu) ?? [];
    expect(wheres.length).toBeGreaterThanOrEqual(6);
  });
});
