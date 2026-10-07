import { describe, expect, it } from "vitest";
import { workersSource } from "../../common/workers-source.testkit";

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

const WORKERS = workersSource("jobs/whatsapp-notify.ts");
const DETAILS = workersSource("whatsapp/details.ts");

/** גוף פונקציית ההעשרה עצמה — הטעינות, לא החיווט. */
const loader = (): string => {
  const start = DETAILS.indexOf("async function loadNotifyDetails(");
  expect(start, "loadNotifyDetails נעלמה").toBeGreaterThan(0);
  return DETAILS.slice(start);
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
    /*
     * ‏הפרוסה על **הערך** ולא על הביטוי שמייצר אותו: החישוב עבר
     * ‏לשאילתה אחת למשרד (`capabilitiesByUser`), והשער היה נשבר על
     * ‏שינוי שאינו נוגע לטענה שלו.
     */
    const at = WORKERS.indexOf("      const capabilities = ");
    expect(at, "חישוב היכולות פר-נמען נעלם").toBeGreaterThan(0);
    const build = WORKERS.slice(at, WORKERS.indexOf("const delivered = new Map<string, Date>();"));
    expect(build).toContain("allowedActionIds: allowedActionsFor(capabilities, features)");
    expect(build).toContain("capabilities: [...capabilities]");
  });

  /*
   * ‏בקשת המשתמש: בעל משרד בלי מקום בסוכן אינו מקבל התראות בוואטסאפ.
   * ‏הכלל עצמו נבדק ב-`whatsapp-notify.test.ts` (`whatsappNotifyRecipient`);
   * ‏כאן — שהסבב משתמש בו, ושאינו מחזיר את החריג בשאילתה.
   */
  it("הנמענים הם מחזיקי מקום בלבד — לפי הכלל המשותף", () => {
    const pick = WORKERS.slice(
      WORKERS.indexOf("const candidates = await prisma.user.findMany("),
      WORKERS.indexOf("if (users.length === 0) {"),
    );
    expect(pick).toContain("whatsappAccess: true,");
    expect(pick, "החריג של בעל המשרד חזר").not.toContain('role: "owner"');
    expect(pick).toContain("whatsappNotifyRecipient(user)");
  });

  /*
   * ‏ביקורת Codex: משרד בלי נמענים השאיר את ההתראות פתוחות, והסבב טען
   * ‏אותן ואת הפרטים שלהן מחדש בכל דקה, עד יממה.
   */
  it("משרד בלי נמענים סוגר את מה שממתין, לפני טעינת הפרטים", () => {
    const empty = WORKERS.slice(
      WORKERS.indexOf("if (users.length === 0) {"),
      WORKERS.indexOf("continue;", WORKERS.indexOf("if (users.length === 0) {")),
    );
    expect(empty).toContain("closeNotifications(tenant.id, pending.map(");
    expect(WORKERS.indexOf("if (users.length === 0) {")).toBeLessThan(
      WORKERS.indexOf("const notifyDetails = await loadNotifyDetails("),
    );
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

  /*
   * ‎`presentation` הוא ה-Snapshot שנשלח לקונה, וזו כל הסיבה שהוא
   * נשמר. שימוש בשורת הנכס היה גורם להתראה לתאר הצעה במחיר שהלקוח
   * מעולם לא ראה — אחרי שהמחיר עודכן.
   */
  it("ההצעה מתוארת מה-Snapshot שנשלח לקונה, לא מהנכס של היום", () => {
    const fn = loader();
    expect(fn).toContain("presentation: true");
    expect(fn).toContain("OfferPresentationSchema.safeParse(offer.presentation)");
    expect(fn).toContain("snapshot?.title ?? headlineOf(match.propertyId)");
  });

  it("כל קונה מותאם נושא את הבעלים שלו — הסינון הוא פר-נמען", () => {
    const fn = loader();
    expect(fn).toContain("ownerUserId: buyerById.get(match.buyerId)?.ownerUserId ?? null");
  });

  it("כישלון בהעשרה מחזיר מפה ריקה ואינו מפיל את הסבב", () => {
    const fn = loader();
    expect(fn).toContain("catch (error)");
    expect(fn).toContain("return new Map()");
  });

  it("ההעשרה מסננת לפי המשרד בכל שאילתה", () => {
    const fn = loader();
    expect(fn).toContain("withTenant(tenantId, async (tx) =>");
    /*
     * ‏`tenantId` על כל `where` ולא רק הישענות על RLS: השאילתות
     * רצות בטרנזקציה אחת, ושכחה של הקשר המשרד הייתה הופכת את
     * כולן לחוצות-משרד בבת אחת.
     */
    const wheres = fn.match(/where: \{ tenantId/gu) ?? [];
    expect(wheres.length).toBeGreaterThanOrEqual(6);
  });
});
