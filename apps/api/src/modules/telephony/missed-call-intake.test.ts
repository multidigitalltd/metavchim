import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ‎**„הצע טופס אחרי שיחה שלא נענתה” חייב להיות מסוגל לשלוח.**
 *
 * ## הכשל שהשער הזה מונע
 *
 * ‏הפיצ'ר מעולם לא שלח דבר, מהיום שנכתב. הסיבה היא שרשרת של שלושה
 * תנאים שאיש לא הצליב:
 *
 * 1. הקריאה יושבת בענף `event.type === "missed"`.
 * 2. ‏`callAction.createLead` דורש `event.type === "ended"` — שקרי
 *    בהגדרה שם — ולכן `leadId` תמיד `null`.
 * 3. איש הקשר נוצר **רק** בתוך `openLeadForUnknownCaller`, שרץ רק
 *    כש-`createLead`, ולכן גם `contactId` תמיד `null`.
 *
 * והשומר הישן — „בלי ליד או בלי איש קשר, צא” — הפיל את הפונקציה
 * בשורתה הראשונה בכל שיחה שלא נענתה. בייצור זה נראה כהתראה עם גוף
 * ריק: `body: pending ?? (leadId ? … : null)` כששניהם `null`.
 *
 * ‎**זו תקלה שאף בדיקה התנהגותית לא תופסת** בלי מרכזייה, מסד ו-Meta.
 * מה שכן ניתן לקבע הוא הצורה: שהפונקציה אינה תלויה בליד, שהיא
 * יוצרת איש קשר כשאין, ושהקורא מוסר לה את מה שנדרש לכך.
 */

const MODULE = join(import.meta.dirname);

/** בלי הערות — טענה שמתקיימת בזכות הסבר בעברית אינה טענה. */
const code = (path: string): string =>
  readFileSync(join(MODULE, path), "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^[ \t]*\/\/.*$/gmu, "");

const TELEPHONY = code("telephony.service.ts");

/** גוף הפונקציה: מהחתימה עד הסוגר בהזחת המתודה. */
function method(source: string, signature: string): string {
  const from = source.indexOf(signature);
  expect(from, `לא נמצאה ${signature}`).toBeGreaterThan(-1);
  const end = source.indexOf("\n  }", from);
  return source.slice(from, end === -1 ? undefined : end);
}

describe("הקישור אחרי שיחה שלא נענתה", () => {
  /* הגוף עבר ל-`intakeForMissedCall`; העוטף רק פותח את הקשר הדייר */
  const body = () => method(TELEPHONY, "private async intakeForMissedCall(");

  it("שולף הגוף עובד, אחרת כל השאר בודק מחרוזת ריקה", () => {
    expect(body().length).toBeGreaterThan(400);
  });

  /*
   * ‎**הטענה המרכזית.** זה השומר שהרג את הפיצ'ר, והוא אינו יכול
   * לחזור: בענף של „לא נענתה” `leadId` שקרי בהגדרה.
   */
  it("אינה יוצאת מוקדם בגלל היעדר ליד", () => {
    expect(body()).not.toMatch(/if \(leadId === null/u);
  });

  /* בלי איש קשר אין למי לשלוח — ולכן היא יוצרת אותו כשאין. */
  it("יוצרת איש קשר כשאין, דרך המסלול שנועל את המספר", () => {
    expect(body()).toMatch(/findOrCreateByPhone/u);
  });

  /* ‏קישור פתוח כשאין ליד — אחרת אין עוגן ואין מה לשלוח. */
  it("נופלת לקישור פתוח כשאין ליד פתוח", () => {
    expect(body()).toMatch(/"open"/u);
    expect(body()).toMatch(/ensureForMissedCall\(/u);
  });

  /*
   * ‎**הבדיקה לפני היצירה, ולא אחריה.**
   *
   * ‏`ISRAELI_PHONE` מקבל גם קו נייח, והודעת וואטסאפ אליו „מצליחה”
   * בלי שאיש יקבל אותה. וכרטיס איש קשר נפתח רק כשהוא קונה משהו —
   * מספר שאי אפשר להגיע אליו אינו מייצר כרטיס, בקשה, או רעש
   * ברשימת אנשי הקשר (בקשת המשתמש).
   */
  it("מספר שאינו נייד ישראלי אינו מייצר כרטיס ואינו מקבל הודעה", () => {
    const text = body();
    expect(text).toMatch(/canReceiveWhatsapp\(phone\)/u);
    expect(text.indexOf("canReceiveWhatsapp")).toBeLessThan(
      text.indexOf("findOrCreateByPhone"),
    );
  });

  /*
   * ‎**ההתראה למתווך אומרת מה הלקוח קיבל.** „לא קיבל”, „כבר קיבל
   * אתמול” ו„לא ניתן לשלוח אליו” הן שלוש מסקנות שונות, ושתיקה
   * מאחדת אותן לאחת שגויה (בקשת המשתמש).
   */
  it("כל מסלול מחזיר משפט להתראה, ולא שתיקה", () => {
    const text = body();
    expect(text).toMatch(/pending: "✅ נשלחה/u);
    expect(text).toMatch(/pending: "הלקוח כבר קיבל/u);
    expect(text).toMatch(/pending: "לא נשלחה הודעה — המספר אינו נייד/u);
    expect(text).toMatch(/pending: `לא נשלח אוטומטית/u);
  });

  /*
   * ‎**והקורא מוסר את מה שנדרש ליצירת איש הקשר.** בלי הטלפון
   * הפונקציה אינה יכולה ליצור אותו, וחוזרת לשתוק — אותה תקלה
   * בדיוק, בצורה אחרת.
   */
  it("הקורא מוסר את הטלפון ואת שם המתקשר", () => {
    const call = /offerIntakeAfterMissedCall\(([\s\S]*?)\);/u.exec(TELEPHONY)?.[1] ?? "";
    expect(call).toMatch(/event\.peerPhone/u);
    expect(call).toMatch(/event\.callerName/u);
  });

  /*
   * ‎**והכפילות נמדדת לפי אדם.** ההבטחה היא „לקוח שהתקשר שלוש
   * פעמים אינו מקבל שלוש הודעות”; סינון לפי הכרטיס אינו מקיים
   * אותה כשהעוגן הוא קישור פתוח בלי כרטיס.
   */
  /*
   * ‎**הנתיב ציבורי, ולכן `TenantContext` ריק בו.**
   *
   * ‏`ingest` נכנס ל-`withExplicitTenant` בלבד — הוא מזריק את
   * ‎`app.tenant_id` ואוכף את ה-RLS, אבל אינו ממלא את ההקשר.
   * ‏`ContactsService` קורא `TenantContext.current()`, שזורק כשאין
   * הקשר, וה-`catch` שכאן היה בולע — כלומר הפיצ'ר חוזר לשתוק,
   * ואצל מתקשר מוכר גם משאיר בקשה שחוסמת ניסיונות עתידיים
   * (ביקורת Codex, P1).
   */
  it("נפתח הקשר דייר לפני הקריאה ל-ContactsService", () => {
    const outer = method(TELEPHONY, "private async offerIntakeAfterMissedCall(");
    expect(outer).toMatch(/TenantContext\.run\(/u);
    expect(outer).toMatch(/tenantId,/u);
  });

  /*
   * ‎**איש הקשר שנוצר נתפר לשיחה ולהתראה.** שורת השיחה נכתבת לפני
   * הענף הזה עם `contact_id` ריק; בלי התפירה נוצר כרטיס שהשיחה
   * שיצרה אותו אינה בהיסטוריה שלו (ביקורת Codex, P1).
   */
  it("השיחה וההתראה מקבלות את איש הקשר שנוצר", () => {
    expect(TELEPHONY).toMatch(/tx\.call\.updateMany\(\{[\s\S]{0,200}contactId: offered\.contactId/u);
    expect(TELEPHONY).toMatch(/entityId: leadId \?\? callContactId/u);
  });

  it("מניעת הכפילות היא לפי איש הקשר", () => {
    const intake = code("../intake/intake.service.ts");
    const ensure = method(intake, "  async ensureForMissedCall(");
    expect(ensure).toMatch(/where: \{\s*tenantId,\s*contactId,/u);
    expect(ensure).not.toMatch(/subject,\s*subjectId,\s*status:/u);
  });
});
