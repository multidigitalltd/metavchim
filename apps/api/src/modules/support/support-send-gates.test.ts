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

/**
 * ‎**השער קורא קוד, לא הערות.**
 *
 * הוא נכתב תחילה על המקור כמות שהוא, וההרחבה „ההתראה אינה נושאת
 * ‎`replyTo`” נפלה מיד — על **ההערה** שמסבירה למה הוא ירד. שער
 * שמוצא את מה שהוא אוסר בתוך הסבר על איסורו הוא שער שמדווח שקר
 * לשני הכיוונים: כאן על שלילה, ובמקום אחר היה מאשר קוד חסר בזכות
 * הערה שמזכירה אותו.
 */
function code(name: string): string {
  return readFileSync(join(HERE, name), "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^[ \t]*\/\/.*$/gmu, "");
}

const INBOX = code("support-inbox.service.ts");
const TICKETS = code("support.service.ts");

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


/**
 * ‎**כל דרך שבה פנייה נכנסת — מודיעה למנהלים.**
 *
 * ## התקלה שהשער הזה נולד ממנה
 *
 * היו שלוש דרכים להיכנס לשולחן, ורק אחת מהן הודיעה למישהו:
 *
 * ‎1. הכפתור שבמערכת — מייל ל-`supportEmail` בלבד, וכשהיא לא
 *    מוגדרת: לאיש.
 * ‎2. מייל לכתובת התמיכה — **שקט מוחלט**. נכתב לשולחן וחיכה שמישהו
 *    יפתח את המסך מיוזמתו.
 * ‎3. תשובה במייל על פנייה מהכפתור — שקט מוחלט גם כן.
 *
 * ## למה שער ולא הנחיה
 *
 * זה בדיוק סוג הכשל שאינו נראה: המערכת עובדת, הפנייה נשמרה, המסך
 * מציג אותה — ואיש אינו יודע שהיא שם. הדרך הרביעית שתיוולד תיוולד
 * באותה צורה, כי שום דבר בקוד לא יזכיר שצריך להודיע. השער אוכף
 * שכל מסלול קליטה עובר דרך `notifyDesk`, ושהיא פונה למנהלים ולא
 * לכתובת בודדת.
 */
describe("כל פנייה שנכנסת מודיעה למנהלי הפלטפורמה", () => {
  const INTAKE = [
    ["הכפתור שבמערכת", method(TICKETS, "  async create(")],
    ["מייל לכתובת התמיכה", method(INBOX, "  async processInbound(")],
    ["תשובה במייל על פנייה מהכפתור", method(INBOX, "  private async appendToTicket(")],
  ] as const;

  for (const [name, scope] of INTAKE) {
    it(`${name}: קורא ל-notifyDesk`, () => {
      expect(scope, `${name}: אין קריאה ל-notifyDesk`).toMatch(/this\.notifyDesk\(/u);
    });
  }

  /*
   * ‎`supportEmail` הייתה הנמענת **היחידה**, ולכן חוסר הגדרה שלה
   * השתיק את ההתראה לגמרי. עכשיו היא נמענת נוספת בלבד: רשימת
   * המנהלים היא זו שאין דרך לשכוח למלא — בלעדיה גם מסך הפלטפורמה
   * עצמו סגור.
   */
  for (const [name, source] of [
    ["פניות מהכפתור", TICKETS],
    ["פניות במייל", INBOX],
  ] as const) {
    it(`${name}: ההתראה עוברת דרך רשימת המנהלים`, () => {
      const scope = method(source, "  private async notifyDesk(");
      expect(scope, `${name}: ההתראה אינה פונה למנהלים`).toContain("this.admins.notify(");
      expect(scope, `${name}: כתובת התמיכה אינה נמענת נוספת`).toMatch(/also: \[to\]/u);
      expect(scope, `${name}: השליחה עוקפת את המודיע`).not.toContain("this.email.send(");
    });

    /*
     * ההתראה נשלחת אחרי שהפנייה כבר נשמרה, ולכן חריגה ממנה הייתה
     * מפילה את הקליטה עצמה — כלומר ספק הדואר קובע אם פנייה נקלטת.
     */
    it(`${name}: כישלון התראה אינו מפיל את הקליטה`, () => {
      const scope = method(source, "  private async notifyDesk(");
      expect(scope, `${name}: אין catch סביב ההתראה`).toMatch(/catch \(error\)/u);
      expect(scope, `${name}: הכישלון אינו נרשם ביומן`).toMatch(/this\.logger\.warn\(/u);
    });
  }

  /*
   * ‎**מסירה חוזרת אינה פנייה חדשה.** הספק מוסר שוב על כל 5xx, ומייל
   * לכל מסירה הוא בדיוק מה שגורם לאנשים לכבות התראות.
   */
  for (const [name, signature] of [
    ["שרשור מייל", "  async processInbound("],
    ["פנייה מהכפתור", "  private async appendToTicket("],
  ] as const) {
    it(`${name}: מסירה חוזרת של אותה הודעה אינה מייצרת התראה שנייה`, () => {
      const scope = method(INBOX, signature);
      const guard = scope.indexOf("if (!duplicate)");
      const notify = scope.indexOf("this.notifyDesk(");
      expect(guard, `${name}: אין תנאי שמונע התראה על מסירה חוזרת`).toBeGreaterThan(-1);
      expect(notify, `${name}: ההתראה אינה בתוך התנאי`).toBeGreaterThan(guard);
      /*
       * ‎**ושהדגל באמת נדלק, מהאילוץ.** הניסוח הראשון בדק סדר טקסטואלי
       * בלבד — „‏`if (!duplicate)` מופיע לפני `notifyDesk`” — ולכן היה
       * מאשר גם תנאי שאיש אינו מדליק. שתי השורות האלה דורשות שהדגל
       * נכתב ושהכפילות נתפסת מ-P2002 ולא מבדיקה מקדימה, ששתי מסירות
       * בו-זמנית עוברות יחד.
       *
       * גבול השער נשאר: הוא קורא טקסט, ולכן אינו מבחין בין קוד חי
       * לקוד מת. קוד מת כזה אינו מתקמפל, וזה מה שתופס אותו.
       */
      expect(scope, `${name}: הדגל לעולם אינו נדלק`).toContain("duplicate = true");
      expect(scope, `${name}: הכפילות אינה נתפסת מהאילוץ`).toContain('.code !== "P2002"');
    });
  }

  /*
   * ‎**וההגנה עצמה היא האילוץ במסד, לא בדיקה מקדימה.**
   *
   * מסלול הפניות מהכפתור לא היה מוגן בכלל: `appendToTicket` כתב את
   * ההודעה בלי מזהה ספק, ולכן כל מסירה חוזרת כפלה אותה על הפנייה
   * (ביקורת Codex). `findFirst` לפני `create` אינו תחליף — שתי
   * מסירות בו-זמנית עוברות אותו יחד.
   */
  it("תשובה בפנייה מהכפתור נכתבת עם מזהה הספק, וכפילות נתפסת ב-P2002", () => {
    const scope = method(INBOX, "  private async appendToTicket(");
    expect(scope, "ההודעה נכתבת בלי מזהה ספק").toContain("providerMessageId,");
    expect(scope, "אין תפיסת כפילות").toContain('.code !== "P2002"');
  });

  /*
   * ‎**ההתראה אינה ערוץ תשובה.**
   *
   * עם `replyTo` של כתובת התמיכה הכללית היא נראתה כמו הודעה שאפשר
   * להשיב עליה — ותשובה של מנהל פתחה שרשור חדש על שמו במקום להגיע
   * לפנייה, כי הצמדה לפי מספר דורשת את כתובת הפונה המקורי (ביקורת
   * Codex). המסקנה: לא לשתול כתובת תשובה, ולומר לאן כותבים.
   */
  for (const [name, source] of [
    ["פניות מהכפתור", TICKETS],
    ["פניות במייל", INBOX],
  ] as const) {
    it(`${name}: ההתראה אינה מתחזה לערוץ תשובה`, () => {
      const scope = method(source, "  private async notifyDesk(");
      expect(scope, `${name}: ההתראה נושאת replyTo`).not.toMatch(/replyTo/u);
      expect(scope, `${name}: אין הערה שאומרת לאן כותבים`).toContain(
        "ADMIN_NOTICE_FOOTNOTE",
      );
    });
  }
});
