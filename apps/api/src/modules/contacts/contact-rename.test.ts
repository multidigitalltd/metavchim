import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * ‎**תיקון שם הכרטיס, ומה שחייב להשתנות יחד איתו.**
 *
 * ‏שיחה נכנסת שבה לא זוהה שם יוצרת כרטיס ששמו הוא מספר הטלפון
 * (`callerName ?? phone`), ועד כה זה היה סופי.
 *
 * ‏מה שנשבר כאן אינו חישוב אלא **צמד שדות שאין ביניהם אכיפה**:
 * `nameEncrypted` הוא מה שהמסך מציג, ו-`nameHash` הוא מה שאיתור
 * הכפילויות והחיפוש עובדים מולו בלי לפענח. הם נכתבים בשתי שורות
 * נפרדות, ומחיקת אחת מהן אינה שוברת שום טיפוס: הכישלון הוא
 * **שקט** — מנוע הכפילויות ממשיך להשוות שם שכבר אינו קיים.
 */

const read = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), "utf8");

const SERVICE = read("./contacts.service.ts");
const CONTROLLER = read("./contacts.controller.ts");

const setName = SERVICE.slice(
  SERVICE.indexOf("async setName("),
  SERVICE.indexOf("async setEmail("),
);

describe("שינוי שם הכרטיס", () => {
  /*
   * ‎**שני השדות, באותה פעולה.** שם שהשתנה וחתימה שנשארה מאחור
   * פירושם איתור כפילויות שמצביע על שם שכבר אינו קיים, ומחמיץ את
   * הכפילות שנוצרה עכשיו.
   */
  it("חתימת השם נכתבת יחד עם השם", () => {
    expect(setName).toContain("nameEncrypted: this.crypto.encrypt(next)");
    expect(
      setName,
      "בלי עדכון החתימה, איתור הכפילויות עובד מול שם ישן",
    ).toContain("nameHash: this.crypto.nameHash(normalizeNameForMatch(next))");
  });

  /*
   * ‎**אותה נרמול בדיוק כמו ביצירה.** חתימה שחושבה על מחרוזת גולמית
   * לא תתאים לחתימה של אותו שם שנוצר דרך המסלול הרגיל, והשניים לא
   * יזוהו ככפילות אף שהם אותו אדם.
   */
  it("הנרמול זהה לזה של יצירת כרטיס", () => {
    const create = SERVICE.slice(0, SERVICE.indexOf("async getById("));
    expect(create).toContain("nameHash: this.crypto.nameHash(normalizeNameForMatch(input.name))");
  });

  /* קריאה שאינה משנה דבר אינה אירוע, ולכן אינה רשומת ביקורת */
  it("שם זהה אינו נחשב שינוי", () => {
    expect(setName).toContain('if (this.crypto.decrypt(row.nameEncrypted) === next) return false;');
  });

  /*
   * ‎**הרשומה אומרת שהשם שונה — ולא מה הוא היה.** השם הוא PII מוצפן
   * במנוחה, ורישום שלו בטקסט גלוי במטא-דאטה מבטל בדיוק את ההצפנה
   * הזו. אותה מוסכמה כמו `duplicate_dismiss`, ששומר חתימה ולא שם.
   */
  it("יומן הביקורת אינו נושא את השם עצמו", () => {
    const fn = CONTROLLER.slice(
      CONTROLLER.indexOf("async setName("),
      CONTROLLER.indexOf("async setEmail("),
    );
    expect(fn).toContain('action: "contact.renamed"');
    expect(fn, "PII מוצפן במנוחה לא נרשם בטקסט גלוי ביומן").not.toMatch(
      /metadata:[^}]*name/u,
    );
  });

  /*
   * ‎**היקף הגישה והיכולת — כמו בכל עריכת לקוח אחרת.** נתיב שמדלג
   * על `assertContactAccess` מאפשר לשנות שם של כרטיס שאינו בהיקף
   * של המשתמש.
   */
  it("הנתיב דורש יכולת עריכה ובודק את היקף הלקוח", () => {
    const guarded = CONTROLLER.slice(
      CONTROLLER.indexOf('@Patch(":id/name")') - 200,
      CONTROLLER.indexOf("async setEmail("),
    );
    expect(guarded).toContain('@RequireCapability("buyers.edit")');
    expect(guarded).toContain("await assertContactAccess(tx, tenantId, id);");
  });
});
