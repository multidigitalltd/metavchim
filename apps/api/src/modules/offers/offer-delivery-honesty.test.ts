import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * ‎**„נשלח” חייב להיות עובדה, לא כוונה.**
 *
 * ## התלונה
 *
 * „כששולחים ללקוח הצעה דרך המערכת זה כותב שזה נשלח אבל בפועל הלקוח
 * לא מקבל את זה.” והיא הייתה מדויקת: `POST /offers` יצר קישור
 * ציבורי, כתב `status: "sent"` עם `sentAt` של אותו רגע, ולא פנה
 * לשום ערוץ — לא מייל, לא וואטסאפ. מכאן והלאה כל מסך אמר „ההצעה
 * נשלחה”, ובמסך ההתאמות השורה אף הפכה לגלולה סופית בלי שום פעולת
 * המשך: המתווך סימן וי, והלקוח לא קיבל דבר.
 *
 * ## למה שער, ולא רק תיקון
 *
 * המסלול ה**אוטומטי** כבר עבר בדיוק את התיקון הזה בביקורת קודמת
 * („כל מה שטוען „נשלח” — באותה טרנזקציה של הסטטוס”), והידני נשאר
 * מאחור. זו חזרה, ולכן היא ראויה לשער ולא לתיקון נקודתי: כל טענת
 * מסירה חייבת לשבת על ערוץ שבאמת שימש.
 *
 * ## שלוש הטענות
 *
 * 1. ‎**היצירה אינה טוענת דבר** — לא סטטוס, לא `sentAt`, לא פעולת
 *    שיווק, לא `offer.sent`.
 * 2. ‎**הטענה נכתבת במקום אחד** — `markDelivered`, שרץ רק מערוץ.
 * 3. ‎**למייל יש כפתור, והוא חייב להיכשל בקול** — `required: true`
 *    ודחייה שמגיעה למסך.
 */

const strip = (path: string): string =>
  readFileSync(new URL(path, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^[ \t]*\/\/.*$/gmu, "");

const OFFERS = strip("./offers.service.ts");
const EMAIL = strip("./offer-email.service.ts");
const CONTROLLER = strip("./offers.controller.ts");
const MATCHES = strip("../../../../web/src/app/matches/page.tsx");

/**
 * גוף מתודה אחת, עד המתודה הבאה באותה רמת הזחה.
 *
 * ‎**הטענות כאן חייבות להיות על גוף ולא על הקובץ.** „הקובץ אינו
 * מכיל `status: "sent"`” היה נכשל על `markDelivered` — שזה בדיוק
 * המקום שבו הוא **צריך** להופיע.
 */
function methodBody(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start, `${signature} לא נמצאה`).toBeGreaterThan(-1);
  const rest = source.slice(start + signature.length);
  const end = rest.search(/\n {2}(?:private|public|async|\/\*\*)/u);
  return end === -1 ? rest : rest.slice(0, end);
}

describe("הצעה — „נשלח” אומר שנשלח", () => {
  const create = methodBody(OFFERS, "async createFromMatch(");

  /*
   * ‎**ארבעה דברים שהיצירה אינה רשאית לומר.** הסטטוס והחותמת הם מה
   * שהמסך קורא; פעולת השיווק ו-`offer.sent` הם מה שהעולם קורא —
   * פעולת שיווק נספרת בכלל השליש שבסעיף 9(ב2) ו-`removeAction`
   * חוסמת מחיקה של רשומה אוטומטית, כלומר בלעדיות שנשמרת בזכות
   * הודעה שאיש לא קיבל, בלי דרך לתקן מהמסך.
   */
  it.each([
    ['status: "sent"', "היצירה מסמנת „נשלח”"],
    ["sentAt:", "היצירה כותבת מועד שליחה"],
    ["recordAuto(", "היצירה רושמת פעולת שיווק"],
    ['"offer.sent"', "היצירה משדרת שההצעה נשלחה"],
  ])("יצירת ההצעה אינה מכילה %s", (needle, why) => {
    expect(create, why).not.toContain(needle);
  });

  /*
   * ‎**וזה כן מה שהיא כותבת.** בלי הטענה הזו „לא כותבת סטטוס”
   * מסתפקת גם ביצירה שאינה כותבת דבר וחוזרת „נשלח” ללקוח ה-API.
   */
  it("והיא מחזירה „ממתינה לשליחה”", () => {
    expect(create).toContain('status: "pending_approval"');
  });

  /*
   * ‎**מקום אחד לטענה.** שני מקומות שכותבים `status: "sent"` הם שני
   * מקומות שיפסיקו להסכים — אחד ירשום פעולת שיווק והשני לא.
   */
  it("‎`status: \"sent\"` נכתב רק ב-markDelivered", () => {
    const sites = [...OFFERS.matchAll(/status: "sent"/gu)];
    expect(sites.length, "יותר ממקום אחד שטוען „נשלח”").toBe(1);
    const marked = methodBody(OFFERS, "private async markDelivered(");
    expect(marked).toContain('status: "sent"');
    expect(marked).toContain("recordAuto(");
    expect(marked).toContain('"offer.sent"');
  });

  /*
   * ‎**אטומי, ולכן נספר פעם אחת.** התנאי על `sentAt` במסד ולא
   * בקריאה שקדמה לו: שתי לחיצות במקביל היו רושמות שתי פעולות שיווק
   * ומשדרות `offer.sent` פעמיים.
   */
  it("והוא מותנה במסד, לא בקריאה שלפניו", () => {
    const marked = methodBody(OFFERS, "private async markDelivered(");
    expect(marked).toMatch(/updateMany\(\{[\s\S]{0,200}?sentAt: null/u);
    expect(marked).toMatch(/if \(first\.count === 0\) return false;/u);
  });

  /*
   * ‎**וואטסאפ הוא ערוץ, ולכן הוא מסמן.** בלי הקריאה הזו ההצעה
   * נשארת „ממתינה לשליחה” לנצח, וזה הכיוון ההפוך של אותו באג.
   */
  it("שליחה בוואטסאפ מסמנת מסירה", () => {
    expect(methodBody(OFFERS, "async prepareWhatsApp(")).toContain("this.markDelivered(");
  });

  /*
   * ‎**ושער ההחתמה חל על שני הערוצים.** הצעה ללקוח בלי הזמנה בכתב
   * היא הפרה של §9 בחוק המתווכים, ושער שיושב בערוץ אחד מתוך שניים
   * אינו שער.
   */
  it("שני הערוצים עוברים בשער ההחתמה", () => {
    expect(methodBody(OFFERS, "async prepareWhatsApp(")).toContain(
      "assertSignatureSatisfied(",
    );
    expect(methodBody(EMAIL, "async sendOne(")).toContain("assertSignatureSatisfied(");
  });
});

describe("שליחה ידנית במייל — הכפתור שלא היה", () => {
  const sendOne = methodBody(EMAIL, "async sendOne(");

  it("המסלול קיים ונשען על אותה שליחה שנבדקה בסבב האוטומטי", () => {
    expect(sendOne).toContain("this.deliver(");
  });

  /*
   * ‎**דחייה ודאית חייבת להגיע למסך.** בסבב האוטומטי `deliver`
   * מחזירה `"unsent"` בשקט — אין מי שמסתכל. בשליחה ידנית יש, ובלי
   * הזריקה הזו הכפתור היה מסמן הצלחה בדיוק על המקרה שבו המייל לא
   * יצא — כלומר אותו באג, בערוץ החדש.
   */
  it("ודחייה של הספק נזרקת ולא נבלעת", () => {
    expect(sendOne).toMatch(/if \(outcome === "unsent"\)/u);
    expect(sendOne.slice(sendOne.indexOf('outcome === "unsent"'))).toContain(
      "BadRequestException",
    );
  });

  /*
   * ‎**ושלושת המצבים שבהם אין למי לשלוח נאמרים.** לקוח בלי כתובת,
   * לקוח שהסיר את עצמו (§30א לחוק התקשורת), וספק שאינו מוגדר —
   * שלושתם כישלון שקט אם אינם נזרקים.
   */
  it.each([
    /* ‎**ה-`select` עצמו**, ולא רק ההשוואה שנשענת עליו */
    [/select: \{ optedOutAt: true \}/u, "הסרה מרשימת התפוצה"],
    [/optedOutAt !== null/u, "והיא נבדקת"],
    [/if \(!contact\?\.email\)/u, "כתובת אימייל בכרטיס"],
    [/isConfigured\(\)/u, "ספק דואר מוגדר"],
  ])("והוא בודק %s", (pattern) => {
    expect(sendOne).toMatch(pattern);
  });

  it("ויש לו נתיב", () => {
    expect(CONTROLLER).toContain('@Post("offers/:id/email")');
    expect(CONTROLLER).toContain("offerEmail.sendOne(");
  });
});

describe("מסך ההתאמות — יוצר, ואז שולח", () => {
  /*
   * ‎**המסך הזה הוא מקור התלונה.** הכפתור אמר „שלח הצעה”, ההודעה
   * אמרה „ההצעה נשלחה”, והשורה הפכה לגלולה סופית — הכול על פעולה
   * שיצרה קישור בלבד. הטענה היא שהמצב הזה מוצג בשמו ושיש ממנו
   * המשך.
   */
  it("„ממתינה לשליחה” הוא מצב מוצג, ולא „הצעה נשלחה”", () => {
    expect(MATCHES).toContain('offer.status === "pending_approval"');
    expect(MATCHES).toContain("ממתינה לשליחה");
  });

  it("ויש ממנו שני ערוצי המשך", () => {
    const branch = MATCHES.slice(MATCHES.indexOf('offer.status === "pending_approval"'));
    expect(branch).toContain("sendWhatsApp(");
    expect(branch).toContain("sendEmail(");
  });

  /*
   * ‎**וההודעה על היצירה אינה טוענת מסירה.** „ההצעה נשלחה” על
   * ‎`POST /offers` היא בדיוק המשפט שהמתווך האמין לו.
   */
  it("והודעת היצירה אינה אומרת „נשלחה”", () => {
    const create = methodBody(MATCHES, "async function createOffer(");
    expect(create).not.toContain("ההצעה נשלחה");
    expect(create).toContain("ההצעה מוכנה");
  });

  /*
   * ‎**וואטסאפ „נפתח” ואינו „נשלח”.** ההודעה מחכה בלשונית ודורשת
   * לחיצה אחרונה; ניסוח שאומר „נשלח” היה משקר, ומתווך שסומך עליו
   * לא היה חוזר ללשונית.
   */
  it("ווואטסאפ מנוסח כ„נפתח”", () => {
    const wa = methodBody(MATCHES, "async function sendWhatsApp(");
    expect(wa).toContain("וואטסאפ נפתח");
    expect(wa).not.toMatch(/setNotice\("ההצעה נשלחה/u);
  });
});
