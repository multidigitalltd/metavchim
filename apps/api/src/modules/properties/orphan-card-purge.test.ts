import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * ‎**הכרטיס שנשאר בלי אף עוגן.**
 *
 * בעלים־בלבד מגיעים אליו דרך הנכס ותו לא. מחיקת נכס לצמיתות הסירה את
 * הקישור והשאירה את הכרטיס במסד — עם שם, טלפונים ואימייל — **בלי
 * שאיש במשרד יוכל לראות אותו, לתקן אותו או למחוק אותו לפי בקשה**.
 * בקשת מחיקה פרטנית לא הייתה מוצאת אותו כלל; רק מחיקת המשרד כולו.
 *
 * הארכיון שנבנה בסבבים הקודמים פתר את הצד השני של אותה מטבע — ראיה
 * משפטית שאיש אינו מגיע אליה — והשאיר את ה-PII עצמו. כאן נסגר גם
 * הצד הזה.
 *
 * השערים כאן מבניים בכוונה: המסלול דורש מסד וטרנזקציה, והדברים
 * שנשברים בו הם **סדר** (נעילה לפני נעילה, מחיקה לפני בדיקה) — בדיוק
 * מה שקריאה של הקובץ יכולה לאכוף ובדיקת יחידה על מוקים אינה יכולה.
 */

function read(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^[ \t]*\/\/.*$/gmu, "");
}

const PROPERTIES = read("./properties.service.ts");
const ERASURE = read("../contacts/contact-erasure.service.ts");
const LOCKS = read("../../common/locks.ts");
const OWNERSHIP = read("../../common/ownership.ts");
const MODULE = read("../contacts/contacts.module.ts");
const WEB = read("../../../../web/src/app/properties/[id]/page.tsx");

/** גוף `purge`, מהחתימה ועד סוף המתודה. */
const PURGE = (() => {
  const at = PROPERTIES.indexOf("async purge(id: string): Promise<void> {");
  expect(at, "purge לא נמצאה").toBeGreaterThan(-1);
  const end = PROPERTIES.indexOf("\n  }\n", at);
  return PROPERTIES.slice(at, end);
})();

describe("כרטיס יתום במחיקת נכס לצמיתות", () => {
  /*
   * ‎**סדר הנעילות הוא הכלל, לא המקרה.** מחיקת לקוח נועלת כרטיס ואז
   * ממתינה לשורות הנכסים שהיא מנתקת. מחיקה לצמיתות שתנעל נכס ואז
   * תבקש כרטיס סוגרת מעגל — Postgres מפיל אחת מהשתיים, כלומר או
   * שהמחיקה נכשלת או ש**בקשת מחיקה של אדם** נכשלת.
   */
  it("הכרטיסים ננעלים לפני שורת הנכס", () => {
    const contact = PURGE.indexOf("await lockContact(tx, contactId)");
    const property = PURGE.indexOf("await lockProperty(tx, ctx.tenantId, id)");
    expect(contact, "נעילת הכרטיס לא נמצאה").toBeGreaterThan(-1);
    expect(property, "נעילת הנכס לא נמצאה").toBeGreaterThan(-1);
    expect(contact, "הנכס ננעל לפני הכרטיס — מעגל מול מחיקת לקוח").toBeLessThan(property);
  });

  /*
   * שתי מחיקות מקבילות שנוגעות באותם שני כרטיסים בסדר הפוך נועלות
   * זו את זו. המיון קובע סדר גלובלי — אבל רק אם הנעילות באמת נלקחות
   * בו, ולכן ברצף ולא ב-`Promise.all`.
   */
  it("שני הכרטיסים ננעלים בסדר יציב וברצף", () => {
    expect(PURGE).toMatch(/\]\.sort\(\);/u);
    expect(PURGE).toMatch(
      /for \(const contactId of candidates\) \{\s*locks\.set\(contactId, await lockContact\(tx, contactId\)\);/u,
    );
    expect(PURGE).not.toMatch(/Promise\.all\([\s\S]{0,200}lockContact/u);
  });

  /*
   * ‎**המחיקה לפני הבדיקה, ובהכרח.** כל עוד שורת הנכס קיימת, מבחן
   * היתמות מוצא אותה ומחזיר „יש עוגן” על כל כרטיס — כלומר בדיקה
   * שקודמת למחיקה אינה מוצאת אף יתום לעולם, ועוברת בשקט.
   */
  it("היתמות נבדקת אחרי שהנכס נמחק", () => {
    const deleted = PURGE.indexOf("await tx.property.delete({ where: { id } })");
    const erase = PURGE.indexOf("eraseUnreachable(");
    expect(deleted, "מחיקת השורה לא נמצאה").toBeGreaterThan(-1);
    expect(erase, "מחיקת הכרטיס לא נמצאה").toBeGreaterThan(-1);
    expect(erase, "הבדיקה לפני המחיקה — לא תמצא יתום לעולם").toBeGreaterThan(deleted);
  });

  /*
   * ‎**„הקורא ידאג לנעול קודם” הוא הערה, לא אכיפה.** ‎`ContactLock`
   * אינו ניתן לבנייה מחוץ ל-`lockContact`, ולכן חתימה שדורשת אותו
   * מקבלת את הדרישה מהמהדר. הבדיקה כאן היא שהדרישה **בחתימה** —
   * ‎`contactId: string` היה מחזיר את הכלל להערה.
   */
  it("מחיקת הכרטיס דורשת את הנעילה בחתימה ולא בהערה", () => {
    expect(LOCKS).toContain("declare const contactLockBrand: unique symbol;");
    expect(LOCKS).toMatch(/export type ContactLock = \{[^}]*readonly \[contactLockBrand\]: true/u);
    expect(LOCKS).toMatch(/export async function lockContact\([^)]*\): Promise<ContactLock>/u);
    expect(ERASURE).toMatch(/async eraseUnreachable\(\s*tx: TenantTx,\s*tenantId: string,\s*lock: ContactLock,/u);
  });

  /*
   * הכלל שממנו נגזרת ההחלטה הוא זה שהארכיון מכריע לפיו. שני ניסוחים
   * של „מי יתום” כבר נפרדו זה מזה בקוד הזה פעם אחת, ובפעם השנייה
   * ההפרש היה בין מה שמוצג למה שנפתח. כאן ההפרש היה בין מה שנשמר
   * למה שנמחק.
   */
  it("מבחן היתמות מיובא ואינו נכתב מחדש", () => {
    expect(ERASURE).toMatch(/import \{ isOrphanContact \} from "\.\.\/\.\.\/common\/ownership"/u);
    expect(ERASURE).toContain("await isOrphanContact(tx, tenantId, contactId)");
    // לא ניסוח שני של אותה שאלה בתוך שירות המחיקה
    expect(ERASURE).not.toMatch(/buyer === null && lead === null/u);
  });

  /*
   * ‎**„נמחק בעקבות” אינו „ביקש להימחק”.** יומן שמתאר את שתיהן באותה
   * מילה מוחק בדיוק את ההבדל שמבקר ירצה לראות, ו-`cause` אומר מי
   * גרם.
   */
  it("היומן מבדיל בין בקשת מחיקה לבין כרטיס שנשאר בלי עוגן", () => {
    expect(ERASURE).toContain('action: "contact.erase_unreachable"');
    expect(ERASURE).toContain('action: "contact.erase"');
    expect(PURGE).toContain('"property.purge")');
    expect(PURGE).toContain("erasedContacts: erasedContacts.length");
  });

  /*
   * ‎**המפתחות נאספים פעם אחת לשני המסלולים.** שתי המחיקות מוחקות
   * את אותן שורות; שני ניסוחים של „אילו קבצים היו שלו” היו משאירים
   * הקלטה באחסון באחד מהם — קובץ של אדם שנמחק, ששורד את מחיקתו.
   */
  it("שני מסלולי המחיקה אוספים את אותם מפתחות אחסון", () => {
    expect(ERASURE).toContain("private async collectStorageKeys(");
    expect((ERASURE.match(/this\.collectStorageKeys\(tx, tenantId, contactId\)/gu) ?? []).length).toBe(2);
    expect((ERASURE.match(/this\.queueStorageCleanup\(tx, tenantId, keys\)/gu) ?? []).length).toBe(2);
    expect(ERASURE).toContain("recordingKey: { not: null }");
  });

  /*
   * ‎**מראים לפני שמאשרים.** התמונות והרשומות של הנכס צפויות; כרטיס
   * של אדם אינו. מתווך שמנקה כפילות אינו מתכוון למחוק אדם.
   */
  it("התצוגה המקדימה שואלת מה יישאר אחרי המחיקה", () => {
    // ההחרגה הוכללה לשלושת סוגי העוגן — נכס, קונה, ליד — בכלל אחד
    expect(OWNERSHIP).toMatch(/except\?: \{ propertyId\?: string; buyerId\?: string; leadId\?: string \}/u);
    expect(OWNERSHIP).toContain(
      "...(except?.propertyId === undefined ? {} : { id: { not: except.propertyId } }),",
    );
    // בלי ההחרגה הנכס עצמו נספר כעוגן, והתשובה תמיד אפס
    expect(PROPERTIES).toContain("isOrphanContact(tx, tenantId, contactId, { propertyId: id })");
    expect(PROPERTIES).toContain("async purgePreview(id: string): Promise<{ contacts: number }>");
  });

  /*
   * ‎**שלושה מצבים ולא שניים.** „כל מה שאינו מספר = אפס” היה מבטיח
   * „לא יימחק אף כרטיס” בדיוק כשהבדיקה נכשלה — אותה טעות שהבאנר של
   * דף הנחיתה כבר למד, ושחזרה כאן על מידע חמור יותר.
   */
  it("המסך מבדיל בין אפס לבין „לא ידוע”", () => {
    expect(WEB).toMatch(/useState<number \| "loading" \| "unknown">/u);
    expect(WEB).toContain('setPurgeImpact("unknown")');
    expect(WEB).toContain("לא הצלחנו לבדוק אם יימחקו גם כרטיסי לקוח");
    expect(WEB).toMatch(/purgeConfirm && purgeImpact !== "loading" && purgeImpact !== 0/u);
  });

  /*
   * האזהרה נקראת בין שתי הלחיצות — כלומר לפני שהמחיקה בוצעה ובזמן
   * שעוד אפשר לבטל. „נמחק גם X” אחרי המעשה אינו אזהרה.
   */
  it("הבדיקה נעשית בלחיצה הראשונה, לא בשנייה", () => {
    const fn = WEB.slice(WEB.indexOf("async function purge()"));
    const preview = fn.indexOf("/permanent/preview");
    const remove = fn.indexOf("apiDelete(`/properties/${id}/permanent`)");
    expect(preview, "התצוגה המקדימה לא נמצאה").toBeGreaterThan(-1);
    expect(remove, "המחיקה לא נמצאה").toBeGreaterThan(-1);
    expect(preview, "הבדיקה אחרי המחיקה — מאוחר מדי").toBeLessThan(remove);
    // תשובה של בדיקה שבוטלה לא תכתוב על המסך
    expect(fn).toContain("const mine = ++purgeSeq.current;");
    expect((fn.match(/if \(purgeSeq\.current === mine\)/gu) ?? []).length).toBe(2);
  });

  /*
   * שירות המחיקה מיוצא מהמודול — בלי זה ההזרקה נופלת בעלייה, וזו
   * תקלה שמתגלה בפרודקשן ולא בהידור.
   */
  it("שירות המחיקה מיוצא ומוזרק", () => {
    expect(MODULE).toMatch(/exports: \[ContactsService, ContactErasureService\]/u);
    expect(PROPERTIES).toContain("private readonly erasure: ContactErasureService,");
  });

  /*
   * ‎**לא נוגעים בכרטיס שאיננו נעול.** נכס בארכיון קפוא — אין עריכה
   * ואין שחזור — ולכן הקריאה המקדימה והנעולה מסכימות תמיד. החיתוך
   * קיים כדי שהכלל יהיה מבני ולא נימוק שנכון היום.
   */
  it("רק כרטיס שננעל נמחק", () => {
    expect(PURGE).toContain(".filter((contactId) => locks.has(contactId));");
    expect(PURGE).toMatch(/const lock = locks\.get\(contactId\);\s*if \(lock === undefined\) continue;/u);
  });
});
