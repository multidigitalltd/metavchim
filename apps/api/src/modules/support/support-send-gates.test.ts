import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * ‎**תשובת תמיכה שנכשלה נראית ככישלון.**
 *
 * ## מה קרה
 *
 * שני מקורות הפניות נפגשים על שולחן אחד, ועד עכשיו הם התנהגו הפוך.
 * שרשור מייל נשלח עם `required: true` וסומן `sent` / `failed` /
 * ‏`unknown`. פנייה מהכפתור נשלחה בלי `required`, בתוך `catch`
 * שרשם אזהרה והמשיך — עם הערה שאמרה „המייל הוא תזכורת, לא הערוץ”.
 *
 * הנימוק ההוא היה סביר כשהמשרד ראה את התשובה גם במערכת. התוצאה
 * בפועל הייתה אחרת: ברגע שספק הדואר הפסיק לקבל את כתובת השולח, כל
 * התשובות הפסיקו לצאת — והמסך המשיך להציג „נענה”. שבוע כזה עובר
 * בלי שאיש יודע, כי אין שום מקום שבו זה נראה.
 *
 * ## למה שער על הקוד
 *
 * מה שצריך לשמור אינו ערך שאפשר לחשב, אלא **צורה**: שהשליחה נדרשת,
 * ושיש שורה שנושאת את מצבה. שתי המתודות דורשות מסד נתונים, ספק
 * דואר והקשר דייר כדי לרוץ — ולכן זה נבדק על המקור, כמו שאר השערים
 * המבניים בקוד הזה.
 */

const HERE = import.meta.dirname;
const INBOX = readFileSync(join(HERE, "support-inbox.service.ts"), "utf8");
const TICKETS = readFileSync(join(HERE, "support.service.ts"), "utf8");

/** גוף המתודה, מהחתימה ועד הסוגר שלה. */
function method(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start, `המתודה ${signature} לא נמצאה`).toBeGreaterThan(-1);
  const end = source.indexOf("\n  }\n", start);
  expect(end, `סוף המתודה ${signature} לא נמצא`).toBeGreaterThan(start);
  return source.slice(start, end);
}

const PATHS = [
  ["מענה לשרשור מייל", method(INBOX, "  async reply(")],
  ["מענה לפנייה מהכפתור", method(TICKETS, "  async respond(")],
] as const;

describe("שני מסלולי המענה מתנהגים אותו הדבר", () => {
  for (const [name, scope] of PATHS) {
    it(`${name}: השליחה נדרשת ואינה נבלעת`, () => {
      expect(scope, `${name}: השליחה אינה מסומנת required`).toContain("required: true");
    });

    it(`${name}: השורה נכתבת לפני השליחה ומסומנת אחריה`, () => {
      const pending = scope.indexOf('sendState: "pending"');
      const send = scope.indexOf("this.email.send(");
      expect(pending, `${name}: לא נמצאה שורה שנכתבת כ-pending`).toBeGreaterThan(-1);
      expect(send, `${name}: השליחה קודמת לכתיבת השורה`).toBeGreaterThan(pending);
      expect(scope, `${name}: אין סימון סופי`).toContain('sendState: "sent"');
    });

    /*
     * ‎`EmailRejectedError` היא הדחייה הוודאית. הבחנה בינה לבין
     * פסק זמן היא מה שמאפשר לזרוק אל המסך בלי להפחיד על שליחה
     * שאולי כן הגיעה — ובלעדיה חוזרים לאחת משתי הרעות: בליעה
     * שקטה, או „נכשל” על מייל שיצא.
     */
    it(`${name}: דחייה ודאית נזרקת, ותוצאה עמומה נשמרת כ-unknown`, () => {
      expect(scope).toContain("error instanceof EmailRejectedError");
      expect(scope).toContain("if (certainlyNotSent) throw error;");
      expect(scope).toContain('"unknown"');
    });
  }

  /*
   * שורת הלוג הישנה — `שליחת תשובת תמיכה נכשלה` — הייתה **כל** מה
   * שקרה כשמייל נדחה. היא נבדקת ולא הנוסח שבהערה: תיעוד מצטט את
   * התקלה שהוא מתאר, ושער שנופל על ההסבר של עצמו הוא שער שמוחקים.
   */
  it("שורת הלוג שהחליפה טיפול בשגיאה אינה חוזרת", () => {
    expect(TICKETS).not.toContain("`שליחת תשובת תמיכה נכשלה:");
  });
});

describe("התשובה נושאת את הפנייה שעליה היא עונה", () => {
  it("הנוסח הקבוע הוחלף בבונה המשותף", () => {
    const scope = method(TICKETS, "  async respond(");
    expect(scope, "הנושא הקבוע חזר").not.toContain('"תשובה לפנייה שלך לתמיכה"');
    expect(scope).toContain("supportReplySubject(context)");
    expect(scope).toContain("supportReplyEmail(");
  });

  /*
   * מספר הפנייה בנושא הוא מה שמאפשר לפונה לחפש אותה בתיבה שלו,
   * ולנו לזהות תשובה שחוזרת. שני המסלולים חייבים לשאת אותו.
   */
  it("שני המסלולים שמים את מספר הפנייה בנושא", () => {
    expect(method(INBOX, "  async reply(")).toContain("subjectWithReference(");
    expect(method(TICKETS, "  async respond(")).toContain("supportReplySubject(");
  });
});

describe("הפנייה נושאת גם טלפון", () => {
  /*
   * תקלה חוסמת נסגרת בשיחה. בלי המספר על הפנייה התמיכה נאלצה
   * לחפש את המשתמש בנפרד, וזה החיכוך שגורם להסתפק במייל.
   */
  it("הטלפון נלקח מהפרופיל ונשמר על הפנייה", () => {
    const scope = method(TICKETS, "  async create(");
    expect(scope).toContain("phone: true");
    expect(scope).toContain("userPhone: phone");
  });

  it("והוא מגיע גם להתראה לשולחן", () => {
    expect(method(TICKETS, "  private async notifyDesk(")).toContain("phone === \"\"");
  });
});

describe("סגירה אינה מקדימה את השליחה", () => {
  /*
   * ‎„שליחה וסגירה” כתבה `closed` בטרנזקציה נפרדת **לפני** האחסון
   * והשליחה. דחייה של הספק הותירה פנייה סגורה שהלקוח לא קיבל עליה
   * דבר — היא נשרה מתור הממתינות, וזו אותה היעלמות שקטה שהקובץ הזה
   * בא לסגור, רק דרך אחרת (ביקורת Codex).
   */
  const RESPOND = method(TICKETS, "  async respond(");

  it("הסטטוס אינו נכתב לפני השליחה", () => {
    const send = RESPOND.indexOf("this.email.send(");
    const status = RESPOND.indexOf("status: promoted");
    expect(status, "כתיבת הסטטוס לא נמצאה").toBeGreaterThan(-1);
    expect(status, "הסטטוס נכתב לפני השליחה").toBeGreaterThan(send);
  });

  it("הצורה שכתבה סטטוס מראש אינה חוזרת", () => {
    expect(RESPOND).not.toContain("await tx.supportTicket.update({ where: { id: ticketId }, data: { status } });");
  });

  /*
   * הנתיב של „סמן: נסגרה” מהתור אינו נושא מענה, ואין בו שליחה
   * שאפשר להיכשל בה — הוא חייב להמשיך להחיל מיד.
   */
  it("סטטוס בלי מענה עדיין מוחל מיד", () => {
    expect(RESPOND).toContain("if (!replied) {");
    expect(RESPOND).toContain("data: { status: input.status! }");
  });
});

describe("תשובה במייל חוזרת לפנייה שעליה היא עונה", () => {
  /*
   * המייל אומר „אפשר להשיב על המייל הזה והתשובה תיכנס לאותה
   * פנייה”. עד התיקון החיפוש לפי מספר עבר על שרשורי המייל בלבד,
   * והתשובה פתחה שרשור נפרד — שתי כניסות בתור על אותה שיחה.
   */
  it("החיפוש לפי מספר מכסה גם פניות מהכפתור", () => {
    expect(INBOX).toContain("private async appendToTicket(");
    expect(method(INBOX, "  private async appendToTicket(")).toContain(
      "where: { reference, userEmail: senderEmail }",
    );
  });

  it("וזה נבדק לפני פתרון השרשור", () => {
    const scope = method(INBOX, "  async processInbound(");
    const ticket = scope.indexOf("this.appendToTicket(");
    const thread = scope.indexOf("this.resolveThread(");
    expect(ticket, "הבדיקה מול פניות הכפתור לא נמצאה").toBeGreaterThan(-1);
    expect(thread, "היא אינה קודמת לפתרון השרשור").toBeGreaterThan(ticket);
  });

  /*
   * הנושא הוא טקסט של שולח. בלי ההצמדה לכתובת, מי שמנחש מספר
   * נכנס לפנייה של אדם אחר — אותו כלל שכבר חל על השרשורים.
   */
  it("טוקן גובר על המספר", () => {
    expect(method(INBOX, "  async processInbound(")).toContain("supportThread === null &&");
  });
});

