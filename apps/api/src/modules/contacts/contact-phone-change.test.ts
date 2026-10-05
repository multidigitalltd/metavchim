import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * ‎**החלפת המספר הראשי של הכרטיס.**
 *
 * ‏עד כה לא היה לזה נתיב בשום מסך: `ContactPeople` יודע להוסיף
 * מספרים נוספים ולהסיר אותם, והראשי יושב על `contacts` ומסומן שם
 * במפורש כ„אי אפשר להסירו לבד”. ספרה שגויה שהוקלדה בקליטה נשארה
 * על הכרטיס לתמיד.
 *
 * ‏מה שנשבר כאן אינו חישוב אלא **צמד שדות שאין ביניהם אכיפה** —
 * אותו מבנה בדיוק כמו בשינוי השם: `phoneEncrypted` הוא מה שמוצג
 * ומחייגים אליו, ו-`phoneHash` הוא מה שכל זיהוי נכנס עובד מולו בלי
 * לפענח. כתיבה של אחד בלבד אינה שוברת שום טיפוס, והכשל **שקט**:
 * הכרטיס מציג מספר חדש, והשיחות ממשיכות להתאים לישן.
 *
 * ‏ולכן הבדיקות כאן הן על **המבנה** של הפעולה, ולא על ערך שחוזר
 * ממנה.
 */

const read = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), "utf8");

const SERVICE = read("./contacts.service.ts");
const CONTROLLER = read("./contacts.controller.ts");

const setPrimaryPhone = SERVICE.slice(
  SERVICE.indexOf("async setPrimaryPhone("),
  SERVICE.indexOf("/* ---------- אנשים נוספים על הכרטיס ---------- */"),
);

const setPhoneRoute = CONTROLLER.slice(
  CONTROLLER.indexOf("async setPhone("),
  CONTROLLER.indexOf("async setMarketingConsent("),
);

describe("החלפת המספר הראשי — השירות", () => {
  it("הפעולה קיימת ונחתכה נכון לבדיקה", () => {
    expect(setPrimaryPhone).not.toBe("");
    expect(setPrimaryPhone).toContain("async setPrimaryPhone(");
  });

  /*
   * ‎**שני השדות, באותה כתיבה.** מספר שהשתנה וחתימה שנשארה מאחור
   * פירושם שיחה נכנסת מהמספר החדש שאינה מזוהה, ושיחה מהישן שכן.
   */
  it("המספר המוצפן והחתימה נכתבים יחד", () => {
    expect(setPrimaryPhone).toContain("phoneEncrypted: this.crypto.encrypt(phone),");
    expect(
      setPrimaryPhone,
      "בלי עדכון החתימה, זיהוי שיחה נכנסת עובד מול המספר הישן",
    ).toContain("phoneHash: nextHash,");
  });

  /*
   * ‎**אותה חתימה בדיוק כמו בהוספת מספר נוסף.** חתימה שחושבה אחרת
   * לא תתאים לזו שנוצרה במסלול הרגיל, והמספר לא יימצא כלל.
   */
  it("החתימה מחושבת באותו מנגנון כמו בכל מספר אחר", () => {
    expect(setPrimaryPhone).toContain("const nextHash = this.crypto.phoneHash(phone);");
    expect(SERVICE.slice(SERVICE.indexOf("async addPhone("))).toContain(
      "phoneHash: this.crypto.phoneHash(input.phone),",
    );
  });

  /*
   * ‎**מספר של אדם אחר נדחה.** בלי הבדיקה, שני כרטיסים היו נושאים
   * את אותו מספר — והודעה נכנסת ממנו לא הייתה יכולה להכריע לאיזה
   * כרטיס היא שייכת. האינדקס הייחודי היה מפיל את הכתיבה ממילא,
   * וזו נפילה של הבקשה כולה במקום הודעה שאפשר לפעול לפיה.
   */
  it("מספר ששייך לכרטיס אחר נדחה, ולא נכתב", () => {
    expect(setPrimaryPhone).toContain("const owner = await this.findByAnyPhone(tx, phone);");
    expect(setPrimaryPhone).toMatch(
      /if \(owner && owner\.id !== contactId\) return \{ changed: false, reason: "taken" \};/u,
    );
    /* הדחייה לפני הכתיבה — אחריה היא כבר לא דחייה */
    expect(setPrimaryPhone.indexOf("reason: \"taken\"")).toBeLessThan(
      setPrimaryPhone.indexOf("await tx.contact.updateMany("),
    );
  });

  /*
   * ‎**„בדוק ואז כתוב” בלי נעילה נופל על האינדקס** (ביקורת Codex).
   *
   * שתי בקשות מקבילות על אותו מספר פנוי — או פנייה נכנסת שתופסת
   * אותו בין הבדיקה לכתיבה — עוברות שתיהן את `findByAnyPhone`,
   * והאינדקס הייחודי מפיל את השנייה. בתוך טרנזקציה זו נפילה של
   * הבקשה כולה, ולא שגיאה שאפשר להחזיר במקומה „תפוס”.
   *
   * ‎**הנעילה חייבת לבוא לפני החיפוש**, אחרת היא מגנה על כלום:
   * החלון שהיא סוגרת הוא בדיוק זה שבין הבדיקה לכתיבה.
   */
  it("המספר ננעל לפני הבדיקה, כמו ביצירת כרטיס", () => {
    expect(setPrimaryPhone).toContain("await lockContactPhone(tx, tenantId, nextHash);");
    expect(
      setPrimaryPhone.indexOf("await lockContactPhone(tx, tenantId, nextHash);"),
      "נעילה אחרי החיפוש אינה סוגרת את החלון",
    ).toBeLessThan(setPrimaryPhone.indexOf("const owner = await this.findByAnyPhone(tx, phone);"));
  });

  /*
   * אותו רצף בדיוק יושב ב-`addPhone` — אותה בדיקה, אותה כתיבה,
   * אותו אינדקס. פונקציה נעולה לצד אחות שאינה נעולה היא הזמנה
   * לחזור על הבאג במקום השני.
   */
  it("גם הוספת מספר נוסף נועלת לפני הבדיקה", () => {
    const addPhone = SERVICE.slice(
      SERVICE.indexOf("async addPhone("),
      SERVICE.indexOf("async removePhone("),
    );
    expect(addPhone).toContain(
      "await lockContactPhone(tx, tenantId, this.crypto.phoneHash(input.phone));",
    );
    expect(addPhone.indexOf("lockContactPhone")).toBeLessThan(
      addPhone.indexOf("const owner = await this.findByAnyPhone(tx, input.phone);"),
    );
  });

  /*
   * ‎**מספר שכבר רשום על הכרטיס עצמו עולה לראשי ואינו נשאר גם
   * כמספר נוסף.** אותו מספר בשתי הטבלאות מופיע פעמיים במסך, ומייצר
   * שורה שאי אפשר להסביר — ולא ניתן להסירה, כי הראשי אינו נמחק.
   */
  it("מספר משני של אותו כרטיס מקודם ואינו נשאר כפול", () => {
    expect(setPrimaryPhone).toContain(
      "await tx.contactPhone.deleteMany({ where: { tenantId, contactId, phoneHash: nextHash } });",
    );
  });

  /* אותו מספר בדיוק אינו שינוי — ולכן גם אינו אירוע ביומן */
  it("שמירה חוזרת של אותו מספר אינה שינוי", () => {
    expect(setPrimaryPhone).toContain("if (row.phoneHash === nextHash) return { changed: false };");
  });

  /* ‎`tenantId` בכל תנאי — כרטיס של משרד אחר אינו נגיש גם בטעות */
  it("כל כתיבה מסויגת בשוכר", () => {
    for (const clause of [
      "where: { id: contactId, tenantId },",
      "where: { tenantId, contactId, phoneHash: nextHash }",
    ]) {
      expect(setPrimaryPhone, clause).toContain(clause);
    }
  });
});

describe("החלפת המספר הראשי — הנתיב", () => {
  /* אותה יכולת כמו השם והאימייל: אלה אותו סוג של נתון על אותו כרטיס */
  it("הנתיב דורש `buyers.edit` ומאמת גישה לכרטיס", () => {
    expect(CONTROLLER).toMatch(
      /@RequireCapability\("buyers\.edit"\)\s*\n\s*@Patch\(":id\/phone"\)/u,
    );
    expect(setPhoneRoute).toContain("await assertContactAccess(tx, tenantId, id);");
  });

  /*
   * ‎**„תפוס” הופך להודעה שאפשר לפעול לפיה.** בלי זה הערך המוחזר
   * נבלע והמסך מציג „נשמר” על מספר שלא נכתב.
   */
  it("מספר תפוס מוחזר כשגיאה מפורשת ולא נבלע", () => {
    expect(setPhoneRoute).toContain('if (result.reason === "taken") {');
    expect(setPhoneRoute).toContain(
      'throw new BadRequestException("המספר כבר רשום אצל איש קשר אחר במשרד");',
    );
  });

  /*
   * ‎**נרשם ביומן — ורק כשבאמת השתנה.** רשומת ביקורת על שינוי שלא
   * היה היא בדיוק סוג הרעש שמרוקן את היומן ממשמעות.
   */
  it("החלפה נרשמת ביומן הביקורת, ושמירה חוזרת לא", () => {
    expect(setPhoneRoute).toContain("if (result.changed) {");
    expect(setPhoneRoute).toContain('action: "contact.phone_changed",');
    expect(setPhoneRoute.indexOf("if (result.changed) {")).toBeLessThan(
      setPhoneRoute.indexOf('action: "contact.phone_changed"'),
    );
  });

  /*
   * ‎**המספר המנורמל חוזר למסך.** הסכימה ממירה „054-777-1122”
   * ל-E.164, וזו הצורה שתיטען ברענון הבא. נתיב שהחזיר רק `ok` היה
   * מותיר את המסך עם מה שהוקלד — כרטיס שמשנה צורה מעצמו מאוחר
   * יותר, ונראה כאילו מישהו ערך אותו שוב.
   */
  it("המספר המנורמל חוזר בתשובה", () => {
    expect(setPhoneRoute).toContain("return { ok: true, changed, phone: body.phone };");
    expect(CONTROLLER).toContain(
      "): Promise<{ ok: true; changed: boolean; phone: string }> {",
    );
  });

  /*
   * ‎**המספר עצמו אינו נרשם ביומן.** הטלפון הוא PII מוצפן במנוחה,
   * ורישום שלו בטקסט גלוי במטא-דאטה של הביקורת מבטל בדיוק את
   * ההצפנה הזו — אותה מוסכמה כמו `contact.renamed`.
   */
  it("היומן שומר שהמספר הוחלף, ולא מהו", () => {
    expect(setPhoneRoute).not.toMatch(/metadata[^)]*phone/u);
    expect(setPhoneRoute).not.toContain("body.phone,");
  });
});

/*
 * ‎**פעולה שנרשמת ביומן וקוראת שם כקוד היא פעולה שאיש אינו יכול
 * לקרוא.** היומן במסך ההגדרות מתרגם `action` לעברית דרך טבלה, ומה
 * שאינו בטבלה מוצג כמחרוזת האנגלית הגולמית — בדיוק מה שקרה
 * ל-`contact.renamed` מאז שנוסף.
 */
describe("שתי הפעולות נקראות בעברית ביומן המשרד", () => {
  const SETTINGS = readFileSync(
    new URL("../../../../web/src/app/settings/page.tsx", import.meta.url),
    "utf8",
  );

  it("לכל פעולת לקוח שנרשמת יש תווית", () => {
    for (const action of ["contact.renamed", "contact.phone_changed", "contact.erase"]) {
      expect(SETTINGS, `${action} מוצג ביומן כקוד באנגלית`).toContain(`"${action}": "`);
    }
  });
});
