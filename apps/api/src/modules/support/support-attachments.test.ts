import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * ‎**הקבצים בתיבת התמיכה — הצורה שתיבת הלקוחות התכנסה אליה בשישה
 * סבבים.**
 *
 * תיבת התמיכה נכתבה כהעתק של תיבת הלקוחות לפני שהסבבים האלה קרו,
 * ולכן נשאה את כל מה שהם פירקו:
 *
 * | מה שהיה כאן | מה שזה עשה |
 * |---|---|
 * | העלאה ואז שורה | אובייקט בלי שורה — קובץ ששורד כל מחיקה |
 * | ‎`if (uploaded)` וניקוי | ‎`put` שחורג מפסק זמן משאיר דגל שקרי |
 * | מזהה אקראי | אין זהות יציבה, ואין ממה להמשיך |
 * | הכשל נבלע ב-200 | לספק אין סיבה למסור שוב |
 * | מסירה חוזרת דילגה על הקבצים | ההזדמנות האחרונה נזרקת |
 *
 * ‎**זו אינה סדרת באגים אלא באג בתהליך** — אותו אבחון כמו בסבב
 * הקודם, על אותן שתי תיבות. השערים כאן אוכפים שהשתיים אינן נפרדות
 * שוב, והפעם על מסלול הקבצים.
 */

function read(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^[ \t]*\/\/.*$/gmu, "");
}

const SUPPORT = read("./support-inbox.service.ts");
const CUSTOMER = read("../email-inbox/email-inbox.service.ts");
const CONTROLLER = read("./support-inbox.controller.ts");
const SCHEMA = readFileSync(new URL("../../../prisma/schema.prisma", import.meta.url), "utf8");

/** גוף `storeAttachments`, מהחתימה ועד סוף המתודה. */
const STORE = (() => {
  const at = SUPPORT.indexOf("  private async storeAttachments(");
  expect(at, "storeAttachments לא נמצאה").toBeGreaterThan(-1);
  return SUPPORT.slice(at, SUPPORT.indexOf("\n  }\n", at));
})();

describe("קבצים מצורפים בתיבת התמיכה", () => {
  /*
   * ‎**השורה קודם, ולכן אין אובייקט בלי שורה.** זו התכונה שסוגרת את
   * חור המחיקה מהשורש: מחיקת לקוח ומחיקת משרד עוברות על **שורות**,
   * ומפתח שנכתב בלי שורה הוא קובץ של אדם ששורד כל מחיקה.
   */
  it("השורה נכתבת לפני ההעלאה, בשתי התיבות", () => {
    for (const [name, scope] of [
      ["תמיכה", STORE],
      ["לקוחות", CUSTOMER],
    ] as const) {
      const row = scope.indexOf("Attachment.createMany(");
      const put = scope.indexOf("this.storage.put(");
      expect(row, `${name}: כתיבת השורה לא נמצאה`).toBeGreaterThan(-1);
      expect(put, `${name}: ההעלאה לא נמצאה`).toBeGreaterThan(-1);
      expect(row, `${name}: ההעלאה לפני השורה`).toBeLessThan(put);
    }
  });

  /*
   * ‎**ולא מוחקים דבר.** ‎`if (uploaded)` היה משקר בדיוק כשחשוב:
   * ‎`put` שחורג מפסק זמן משאיר את הדגל שקרי בזמן שהאובייקט קיים.
   * מחיקה כאן היא ההזדמנות היחידה להשמיד קובץ של לקוח, ואין לה
   * תמורה — השורה נשארת לא-מושלמת והמסירה הבאה משלימה אותה.
   */
  it("כשל אינו מוחק דבר", () => {
    expect(STORE).not.toContain("this.storage.delete(");
    expect(STORE).not.toMatch(/let uploaded = false/u);
    expect(STORE).toContain("pending += 1;");
  });

  /*
   * המפתח דטרמיניסטי — `(הודעה, מקום)` ולא ULID אקראי — ולכן העלאה
   * חוזרת של אותם בתים לאותו מפתח היא אידמפוטנטית. זו הסיבה שאין
   * חכירה ואין השתלטות: אין מה לתאם ואין למי לתת בעלות זמנית.
   */
  it("המפתח נגזר מההודעה ומהמקום", () => {
    expect(STORE).toContain("`support/${threadId}/${messageId}/${ordinal}`");
    expect(STORE).not.toMatch(/attachmentId = ulid\(\)/u);
    // ‏`threadId` ולא `tenantId`: פנייה יכולה להגיע ממי שאינו לקוח
    expect(STORE).not.toMatch(/`support\/\$\{tenantId\}/u);
  });

  /*
   * ‎**„נתבע” אינו „הועלה”**, ולכן הדילוג הוא על מה שהושלם בלבד:
   * שורה קיימת ולא-מושלמת היא בדיוק מה שבאנו להשלים.
   */
  it("הדילוג הוא על מה שהושלם, לא על מה שנתבע", () => {
    expect(STORE).toContain("uploadedAt: { not: null }");
    expect(STORE).toContain("if (completed.has(ordinal)) continue;");
    expect(STORE).toContain("skipDuplicates: true,");
    expect(STORE).toContain("data: { uploadedAt: new Date() },");
  });

  /*
   * ‎**מסירה חוזרת משלימה, ולא מדלגת.** הדילוג היה על כל הקבצים,
   * וזו הייתה ההזדמנות האחרונה להשלים אותם.
   */
  it("מסירה חוזרת ממשיכה את הקבצים במקום לזרוק אותם", () => {
    expect(SUPPORT).not.toMatch(/if \(!duplicate\) \{\s*for \(const attachment of incoming\)/u);
    expect(SUPPORT).toMatch(/storeAttachments\(\s*thread\.id,\s*thread\.tenantId,\s*existingId,\s*incoming,\s*duplicate,/u);
  });

  /*
   * ‎**וקובץ שלא נשמר מבקש מסירה חוזרת.** 200 אומר לספק „התקבל”,
   * ואז אין לו סיבה למסור שוב — הפנייה נראית שלמה והצילום איננו.
   *
   * הזריקה **אחרי** עדכון השרשור: לפניו היא הייתה משאירה את הפנייה
   * בשרשור סגור־ונקרא, כלומר מנציחה את המצב שהמסירה החוזרת מתקנת.
   */
  it("כשל בשמירת קובץ נענה בשגיאה, אחרי שהשרשור עודכן", () => {
    const update = SUPPORT.indexOf("data: { lastMessageAt: new Date(), readAt: null, status: \"open\" }");
    const thrown = SUPPORT.indexOf("throw new ServiceUnavailableException(");
    expect(update, "עדכון השרשור לא נמצא").toBeGreaterThan(-1);
    expect(thrown, "הזריקה לא נמצאה").toBeGreaterThan(-1);
    expect(thrown, "זריקה לפני העדכון — הפנייה נשארת סגורה ונקראה").toBeGreaterThan(update);
    expect(SUPPORT).toContain("if (pending > 0) {");
    // והתיעוד אינו מבטיח „תמיד 200” אחרי שזה חדל להיות נכון
    expect(CONTROLLER).not.toContain("**תמיד 200**");
  });

  /*
   * ‎`providerMessageId` יכול להיות `null`, ואז חיפוש לפיו מוצא
   * **הודעה כלשהי** בלי מזהה — כלומר תולה את הקבצים בפנייה של אדם
   * אחר.
   */
  it("חיפוש הכפילות אינו מחפש לפי „אין מזהה”", () => {
    expect(SUPPORT).toContain("providerMessageId === null");
    expect(SUPPORT).not.toMatch(
      /where: \{ providerMessageId: inboundProviderMessageId\(payload\) \},\s*select: \{ id: true \}/u,
    );
  });

  /*
   * ‎**הרשימה והשער מכריעים באותו כלל.** צירוף שטרם הועלה הוא קישור
   * שבור; הרשימה סיננה אותו והשער לא — אותה צורה בדיוק שהארכיון
   * נשבר בה פעמיים באותו יום. **בשתי התיבות.**
   */
  it("ההורדה דורשת את מה שהרשימה דורשת, בשתי התיבות", () => {
    expect(SUPPORT).toMatch(
      /where: \{ id: attachmentId, uploadedAt: \{ not: null \} \}/u,
    );
    expect(CUSTOMER).toMatch(
      /where: \{ id: attachmentId, tenantId, uploadedAt: \{ not: null \} \}/u,
    );
    // וגם ברשימה עצמה, בשתיהן
    expect(SUPPORT).toMatch(/attachments: \{\s*where: \{ uploadedAt: \{ not: null \} \},/u);
  });

  /* העמודות והאילוץ שמכריע בין שני כותבים מקבילים. */
  it("הסכימה נושאת מקום, סימון השלמה, ואילוץ ייחודיות", () => {
    const model = SCHEMA.slice(SCHEMA.indexOf("model SupportAttachment {"));
    const body = model.slice(0, model.indexOf("\n}"));
    expect(body).toMatch(/ordinal\s+Int\?/u);
    expect(body).toMatch(/uploadedAt\s+DateTime\?\s+@map\("uploaded_at"\)/u);
    expect(body).toContain("@@unique([messageId, ordinal])");
  });

  /*
   * מחיקת משרד עוברת על השורות, ולכן קובץ תמיכה של משרד יורד איתו.
   * זה עובד **רק** מפני שהשורה נכתבת לפני האובייקט.
   */
  it("מחיקת המשרד מגיעה לקבצי התמיכה דרך השורות", () => {
    const deletion = read("../settings/account-deletion.service.ts");
    expect(deletion).toContain("tx.supportAttachment.findMany({");
    expect(deletion).toContain("where: { message: { thread: { tenantId } } },");
  });
});
