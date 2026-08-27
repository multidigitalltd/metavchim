import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * ‎**„יתום” פירושו שאיש במשרד אינו יכול להגיע אליו — וזו רשימת
 * הדרכים להגיע.**
 *
 * ‎`isOrphanContact` תיאר שלוש: כרטיס קונה חי, ליד, ונכס חי שהוא
 * בעליו או דיירו. **הרביעית חסרה** — ‎`peopleFor` מציגה על כרטיס
 * חי את השם, הטלפון והאימייל של כל מי שמקושר אליו, ולכן אדם שכל
 * קשרו למשרד הוא היותו בן/בת זוג בכרטיס פעיל **נראה, נקרא ונגיש**.
 *
 * כל עוד הכלל הכריע רק אם שיחה שאני רשמתי נשארת גלויה, החסר היה
 * בלתי מזיק. מרגע שהוא מכריע **מה נמחק**, הוא הופך למחיקת בן/בת זוג
 * מכרטיס לקוח פעיל — בשקט, בתוך מחיקת נכס של אדם אחר.
 *
 * ‎**והכלל הזה כבר היה ידוע במערכת.** `deleteContactIfOrphan` במחיקת
 * ליד ספרה את `contact_links.related_contact_id` מאז ומתמיד. שני
 * ניסוחים של „מי יתום”, ואחד מהם ידע משהו שהשני לא — הצורה שחוזרת
 * בקוד הזה שוב ושוב. עכשיו יש אחד.
 */

function read(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^[ \t]*\/\/.*$/gmu, "");
}

const OWNERSHIP = read("./ownership.ts");
const LEADS = read("../modules/leads/leads.service.ts");
const BUYERS = read("../modules/buyers/buyers.service.ts");
const PROPERTIES = read("../modules/properties/properties.service.ts");
const ERASURE = read("../modules/contacts/contact-erasure.service.ts");

/** ארבעת העוגנים, כפי ששני הניסוחים חייבים לבטא. */
const ANCHORS = ["buyer", "lead", "property", "contactLink"] as const;

describe("עוגני הגישה לכרטיס לקוח", () => {
  /*
   * הצורה הפרוצדורלית והצורה ה-SQL הן אותו כלל בשתי שפות. ניסוח
   * אחד שמכיר עוגן שהשני אינו מכיר הוא בדיוק ההפרש שגורם לרשימה
   * ולשער לא להסכים — וזה כבר קרה כאן פעמיים.
   */
  it("שני הניסוחים מונים את אותם ארבעה עוגנים", () => {
    const fn = OWNERSHIP.slice(
      OWNERSHIP.indexOf("export async function isOrphanContact("),
      OWNERSHIP.indexOf("export async function contactGateFor("),
    );
    for (const anchor of ANCHORS) {
      expect(fn, `הצורה הפרוצדורלית אינה מונה ${anchor}`).toContain(`tx.${anchor}.findFirst(`);
    }
    const sql = OWNERSHIP.slice(
      OWNERSHIP.indexOf("export function orphanContactCondition("),
      OWNERSHIP.indexOf("export async function isOrphanContact("),
    );
    for (const table of ["buyers", "leads", "properties", "contact_links"]) {
      expect(sql, `הצורה ה-SQL אינה מונה ${table}`).toContain(`FROM ${table} `);
    }
    // ארבעה ענפים, לא שלושה ולא חמישה
    expect((sql.match(/NOT EXISTS \(SELECT 1 FROM/gu) ?? []).length).toBe(4);
  });

  /*
   * ‎**הקישור נמנה בכיוון אחד.** הוא הופך את ה**מקושר** לנגיש, לא
   * את הראשי; ומחיקת הראשי ממילא מסירה אותו. הבדיקה גם אינה
   * רקורסיבית — כרטיס ראשי שהוא עצמו יתום עדיין נספר. שמרנות
   * מכוונת: המחיר הוא כרטיס יתום שנשאר, מול מחיקה של נתונים חיים.
   */
  it("הקישור נמנה מצד המקושר בלבד", () => {
    expect(OWNERSHIP).toContain("where: { tenantId, relatedContactId: contactId },");
    expect(OWNERSHIP).toContain("AND k.related_contact_id = ${t}.contact_id");
    expect(OWNERSHIP).not.toMatch(/k\.contact_id = \$\{t\}\.contact_id/u);
  });

  /*
   * ‎**ניסוח שלישי אינו קיים עוד.** הוא ספר כל טבלה שמצביעה על
   * ‎`contacts` — שיחות, הודעות, הסכמים — ולכן תיאר שאלה אחרת:
   * „האם בטוח למחוק בלי להשאיר הפניות שבורות”. התשובה הייתה „לא”
   * בכל פעם שהייתה שיחה אחת, והכרטיס נשאר בלי אף מסך שמציג אותו.
   */
  it("מחיקת הליד משתמשת בכלל המשותף ולא בספירה משלה", () => {
    const fn = LEADS.slice(
      LEADS.indexOf("private async deleteContactIfOrphan("),
      LEADS.indexOf("async addNote("),
    );
    expect(fn).toContain(
      "this.erasure.eraseUnreachableWithoutHistory(tx, tenantId, lock, \"lead.delete\")",
    );
    for (const gone of ["tx.agreement.count(", "tx.call.count(", "tx.emailMessage.count("]) {
      expect(fn, `הספירה הישנה נשארה: ${gone}`).not.toContain(gone);
    }
    // והכרטיס אינו נמחק כאן ביד — `eraseUnreachable` מוחק גם את התלוי בו
    expect(fn).not.toContain("tx.contact.delete(");
  });

  /*
   * שלושת מסלולי המחיקה מכריעים באותו כלל ומוחקים באותה מחיקה.
   * מסלול שמטפל בכרטיס יתום בדרכו שלו הוא הניסוח הרביעי.
   */
  it("שלושת מסלולי המחיקה קוראים לאותה מחיקה", () => {
    for (const [name, source, cause] of [
      ["נכס", PROPERTIES, "property.purge"],
      ["קונה", BUYERS, "buyer.delete"],
      ["ליד", LEADS, "lead.delete"],
    ] as const) {
      expect(source, `${name}: אינו קורא למחיקה המשותפת`).toMatch(
        /erasure\.eraseUnreachable(?:WithoutHistory)?\(/u,
      );
      expect(source, `${name}: אינו מציין את הסיבה`).toContain(`"${cause}"`);
    }
  });

  /*
   * ‎**המחיקה אחרי מחיקת השורה, בשלושתם.** כל עוד השורה קיימת,
   * מבחן היתמות מוצא אותה כעוגן ומחזיר „לא יתום” — כלומר בדיקה
   * שקודמת למחיקה עוברת בשקט ואינה מוצאת דבר לעולם.
   */
  it("היתמות נבדקת אחרי שהעוגן ירד — בקונה כמו בנכס", () => {
    const purge = BUYERS.slice(BUYERS.indexOf("async purge(id: string): Promise<void> {"));
    const removed = purge.indexOf("await tx.buyer.delete({ where: { id } });");
    const erase = purge.search(/erasure\.eraseUnreachable(?:WithoutHistory)?\(/u);
    expect(removed, "מחיקת השורה לא נמצאה").toBeGreaterThan(-1);
    expect(erase, "מחיקת הכרטיס לא נמצאה").toBeGreaterThan(removed);
  });

  /*
   * ‎**הנעילה לפני הכתיבה הראשונה, ולא „מתישהו לפני המחיקה”.**
   *
   * ‎`eraseUnreachable` מנתק את שורות הנכסים שהכרטיס היה בעליהן,
   * והסדר הקבוע במערכת הוא כרטיס איש קשר ואז שורת נכס. היום אין
   * בגוף המחיקה דבר שנוגע בשורת נכס לפני כן, ולכן „לפני `erase`”
   * בלבד הוא נכון־במקרה: המשפט הבא שמישהו יוסיף באמצע יפר את הסדר
   * בלי שאף שער יבחין.
   *
   * לכן הדרישה היא מיקום ולא נכונות רגעית — אותה משמעת בדיוק
   * שהובילה ל„נעילת הנכס לפני כל נגזרת שלו”: כשהיא ראשונה, אין מה
   * שיקדם לה, ואין צורך לדעת מראש איזו טבלה מתנגשת עם מי.
   */
  it("הכרטיס ננעל לפני הכתיבה הראשונה במחיקת הקונה", () => {
    const purge = BUYERS.slice(BUYERS.indexOf("async purge(id: string): Promise<void> {"));
    const lock = purge.indexOf("await lockContact(tx, buyer.contactId)");
    const firstWrite = purge.indexOf("await tx.offer.deleteMany(");
    expect(lock, "הנעילה לא נמצאה").toBeGreaterThan(-1);
    expect(firstWrite, "הכתיבה הראשונה לא נמצאה").toBeGreaterThan(-1);
    expect(lock, "הנעילה אחרי שהמחיקה כבר החלה לכתוב").toBeLessThan(firstWrite);
  });

  /*
   * ‎**המסלול לא ימחק יותר ממה שהמסך שלו הבטיח.**
   *
   * שני הדיאלוגים מפרטים מה נשאר — „הלידים של הלקוח יישארו”,
   * „שיחות מוקלטות שכבר נרשמו נשארות”. הרחבתי את שניהם למחיקת
   * כרטיס יתום ולא נגעתי בטקסט, כלומר הפכתי מחיקה מוגבלת לרחבה בלי
   * הסכמה (ביקורת Codex, שני ממצאי P1). ההערה במחיקת ליד מזהירה
   * מזה במילים האלה בדיוק: „הפעולה היחידה במערכת שמחקה יותר ממה
   * שביקשו”.
   *
   * מחיקת נכס לצמיתות **מגלה** בדיאלוג שלה שכרטיס והתקשורת יורדים,
   * ולכן דווקא היא רשאית לרחבה. ההבדל הוא הגילוי, והשמות נושאים
   * אותו.
   */
  it("מסלול בלי גילוי מוחק רק כרטיס בלי היסטוריה", () => {
    for (const [name, source] of [
      ["קונה", BUYERS],
      ["ליד", LEADS],
    ] as const) {
      expect(source, `${name}: קורא לווריאנט הרחב`).toContain(
        "eraseUnreachableWithoutHistory(",
      );
      expect(
        /(?<!WithoutHistory)\berasure\.eraseUnreachable\(/u.test(source),
        `${name}: קורא לווריאנט הרחב`,
      ).toBe(false);
    }
    // ומחיקת נכס — שמגלה — נשארת על הרחב
    expect(PROPERTIES).toMatch(/erasure\.eraseUnreachable\(/u);
  });

  /*
   * ‎**וההגבלה מונה את מה שהמסכים באמת מבטיחים.** רשימה חלקית היא
   * הבטחה חלקית: הדיאלוג של הליד מנה קונה, נכס, הסכם וליד — ופסח על
   * שיחות והודעות, שההבטחה שמעליו שומרת עליהן.
   */
  it("ההגבלה מונה את כל מה שהובטח", () => {
    const fn = ERASURE.slice(
      ERASURE.indexOf("private async hasPromisedHistory("),
      ERASURE.indexOf("private async collectStorageKeys("),
    );
    for (const table of ["call", "message", "emailMessage", "agreement", "signedDocument"]) {
      expect(fn, `${table} אינו נספר`).toContain(`tx.${table}.findFirst(`);
    }
    // והבדיקה קודמת למחיקה, לא אחריה
    const guard = ERASURE.indexOf("if (await this.hasPromisedHistory(");
    const call = ERASURE.indexOf("return this.eraseUnreachable(tx, tenantId, lock, cause);");
    expect(guard, "ההגבלה לא נמצאה").toBeGreaterThan(-1);
    expect(guard).toBeLessThan(call);
  });

  /*
   * ‎**וכל מי ששואל „האם יתום” שואל דרך הכלל המשותף.** ספירה
   * מקומית של אותן טבלאות היא הניסוח הבא שייפרד — וזה כבר קרה
   * שלוש פעמים בקוד הזה.
   */
  it("אין ניסוח נוסף של אותה שאלה", () => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (full.endsWith(".ts") && !full.includes(".test.")) files.push(full);
      }
    };
    walk(new URL("..", import.meta.url).pathname);
    const offenders = files
      .filter((file) => !file.endsWith("common/ownership.ts"))
      /*
       * ‎**הסימן הוא הצורה, לא הטבלה.**
       *
       * ניסיתי קודם „כל שאילתת `contact_links` לפי `relatedContactId`”,
       * והשער תפס שלושה שימושים תמימים לגמרי — הצגת האנשים על
       * הכרטיס, ניתוק קישור, ומיזוג כפילויות. שער שנופל על קוד תקין
       * הוא שער שמישהו יכבה.
       *
       * מה שמזהה ניסוח של „מי יתום” הוא **ספירת שתי טבלאות עוגן
       * לפי אותו `contactId` באותו קובץ**. זו בדיוק הצורה שנמחקה
       * כאן, וזו הצורה שתיכתב שוב.
       */
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return (
          /tx\.buyer\.count\(\{\s*where:\s*\{\s*tenantId,\s*contactId/u.test(source) &&
          /tx\.lead\.count\(\{\s*where:\s*\{\s*tenantId,\s*contactId/u.test(source)
        );
      });
    expect(offenders).toEqual([]);
  });
});
