import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { propertyPhotoPhrase } from "../messaging/assistant-lang";

/**
 * ‎**תמונה שנשלחה בוואטסאפ זהה לתמונה שהועלתה מהמסך.**
 *
 * ‏הדרך הקצרה לכתוב את זה הייתה `tx.propertyMedia.create` ישירות
 * ‏מהשירות החדש. זה היה עובר typecheck ומייצר שורות שנראות תקינות
 * ‏ומתנהגות אחרת: בלי המכסה (עד N תמונות לנכס), בלי בדיקת הפורמט,
 * ‏בלי `sortOrder` תחת נעילה, בלי רענון המוכנות, בלי אירוע
 * ‎`property.ready` ובלי יומן.
 *
 * ‏ההבדל מתגלה כשמישהו שואל למה נכס עם שמונה תמונות מציג ציון
 * ‏מוכנות של נכס בלי תמונות.
 */

const FILE = new URL("./property-photo.service.ts", import.meta.url).pathname;
const source = readFileSync(FILE, "utf8");

/** ‏כל `X.<name>` שבו `X` הוא `tx`, `prisma` או `this.prisma`. */
function modelsTouched(): string[] {
  const file = ts.createSourceFile(FILE, source, ts.ScriptTarget.ES2023, true);
  const found: string[] = [];
  const isDbRoot = (node: ts.Expression): boolean => {
    if (ts.isIdentifier(node)) return node.text === "tx" || node.text === "prisma";
    if (ts.isPropertyAccessExpression(node)) {
      return node.expression.kind === ts.SyntaxKind.ThisKeyword && node.name.text === "prisma";
    }
    return false;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && isDbRoot(node.expression)) {
      found.push(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(file, visit);
  return found;
}

describe("תמונה לנכס — דרך הכתיבה", () => {
  it("אינו כותב למסד בעצמו", () => {
    expect(modelsTouched(), "מסלול העלאה שני לתמונות נכס").toEqual([]);
  });

  it("עובר במסלול היחיד שמעלה תמונה לנכס", () => {
    expect(source).toContain("this.media.upload(");
  });

  /*
   * ‎**היקף הראייה.** החיפוש הוא זה שקובע אילו נכסים בכלל
   * ‏נמצאים, ולכן הוא חייב להיות אותו חיפוש שכפוף להרשאות —
   * ‏ולא שאילתה חדשה שתמצא גם נכס של סוכן אחר.
   */
  it("מוצא נכס דרך החיפוש המשותף ולא בשאילתה משלו", () => {
    expect(source).toContain("this.search.search(");
  });

  /*
   * ‏שתי התאמות הן שאלה. בחירה אוטומטית הייתה מכניסה תמונה
   * ‏לכרטיס של דירה אחרת, והמתווך יגלה זאת רק דרך קונה.
   */
  it("שתי התאמות אינן נבחרות אוטומטית", () => {
    expect(source).toMatch(/if \(found\.length > 1\)/u);
    expect(source).toContain('outcome: "many"');
  });
});

describe("propertyPhotoPhrase — מה הכיתוב אומר", () => {
  /*
   * ‎**בלי כיתוב זו מודעה.** זה הרוב, וזה מה שהמתווך עושה ברחוב:
   * ‏רואה שלט, מצלם, שולח. `null` שולח למסלול הגיוס.
   */
  it("בלי כיתוב — לא בקשה לצרף לנכס", () => {
    expect(propertyPhotoPhrase("")).toBeNull();
    expect(propertyPhotoPhrase("   ")).toBeNull();
  });

  /*
   * ‏כיתוב שאינו מדבר על נכס קיים הוא עדיין מודעה — „דירה יפה
   * ‏ברוטשילד” הוא תיאור של מה שצולם, לא הוראה.
   */
  it("כיתוב שאינו מבקש לצרף — לא בקשה לצרף", () => {
    expect(propertyPhotoPhrase("שלט למכירה ברוטשילד")).toBeNull();
    expect(propertyPhotoPhrase("תראה מה מצאתי")).toBeNull();
  });

  /*
   * ‎**כל מילות ההוראה יורדות ולא רק זו שנתפסה.** „תוסיף לנכס
   * ‏בהרצל 12” נתפס ב„לנכס”, ובלי הסרת „תוסיף” הביטוי שיחפש
   * ‏נכס היה „תוסיף בהרצל 12” — שאינו מוצא דבר. „לנכס” הוא
   * ‏תת-מחרוזת של „תוסיף לנכס”, ולכן הארוכות יורדות קודם.
   */
  it("מחזיר את הכתובת בלבד", () => {
    expect(propertyPhotoPhrase("תוסיף לנכס בהרצל 12")).toBe("בהרצל 12");
    expect(propertyPhotoPhrase("תמונה של הנכס ברוטשילד 40")).toBe("ברוטשילד 40");
    expect(propertyPhotoPhrase("תוסיף לדירה ברמת גן")).toBe("ברמת גן");
  });

  /*
   * ‎**התחילית נשארת — בכוונה.** „ב” מחוברת למילה בעברית, והסרה
   * ‏עיוורת שלה הופכת „באר שבע” ל„אר שבע” ו„בני ברק” ל„ני ברק”.
   * ‏מי שמחפש מנסה את מה שנאמר קודם, ורק אז בלי התחילית —
   * ‏ולכן הנרמול אינו יושב כאן.
   */
  it("אינו מנרמל תחיליות עבריות", () => {
    expect(propertyPhotoPhrase("תוסיף לנכס בבאר שבע")).toBe("בבאר שבע");
    expect(propertyPhotoPhrase("תוסיף לנכס בבני ברק")).toBe("בבני ברק");
  });

  /*
   * ‏מחרוזת ריקה אינה `null`: „תוסיף לנכס” **כן** מבקש לצרף, רק
   * ‏לא אמר לאיזה. זו שאלה למתווך, לא פתיחת נכס לגיוס חדש —
   * ‏וההבחנה הזו היא כל ההבדל בין „לאיזה נכס?” לבין שורת גיוס
   * ‏מיותרת שמישהו ימחק.
   */
  it("„תוסיף לנכס” בלי כתובת — בקשה בלי יעד, ולא מודעה", () => {
    expect(propertyPhotoPhrase("תוסיף לנכס")).toBe("");
    expect(propertyPhotoPhrase("לנכס")).toBe("");
  });
});
