import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * כל הגדרת פלטפורמה שהקוד קורא חייבת להיות ניתנת לכתיבה.
 *
 * `PlatformSettingsService.get` מקבל מפתח מטיפוס `PlatformSettingKey`,
 * ולכן מפתח חדש **מתקמפל ועובר את כל הבדיקות** גם כשאין שום דרך
 * להגדיר אותו: הוא פשוט תמיד `undefined`. הקוד שקורא אותו כתוב
 * להתמודד עם ריק ("אין תבנית ⟵ לא שולחים"), וזו התנהגות תקינה
 * ולגיטימית — ולכן שום דבר אינו נשבר, ואף אחד אינו מגלה.
 *
 * כך נולד `whatsappIntakeTemplate`: נקרא ב-`TelephonyService`, מתועד
 * במסך כתכונה, ומעולם לא היה בסכימת הכתיבה. התוצאה הייתה שהקישור
 * לטופס הדרישות לא נשלח ללקוח **אף פעם**, ובמקומו חזרה הודעה
 * לסוכן — בדיוק המצב שהתכונה נועדה לחסוך.
 *
 * הבדיקה קוראת את שני המקורות ב-AST (לא ברג'קס): את איחוד המפתחות
 * בשירות, ואת שדות `UpdateSettingsSchema` בבקר. מפתח שאינו בשניהם
 * מפיל את ה-CI ברגע שהוא נוסף, ולא חודשיים אחר כך.
 *
 * ‎**קריאוּת אינה נבדקת כאן בכוונה.** רוב המפתחות הם סודות ספקים,
 * והתשובה מחזירה עליהם "מוגדר/לא" ולא את הערך — החזרת ערך של כל
 * מפתח הייתה הופכת את הבדיקה הזאת לדרישה להדליף אותם.
 *
 * ## ומה שהבדיקה הזאת פספסה עד עכשיו
 *
 * הודעת הכישלון כאן אמרה מאז ומתמיד „הוסיפו אותם ל-UpdateSettingsSchema
 * ‎(ושדה במסך)” — והסוגריים לא נאכפו. כך נולד `partnerPlanCode`: הוא
 * היה בטיפוס, בסכימת הכתיבה ובתשובת ה-GET, ועבר את הבדיקה הזאת
 * במלואה — אבל **שדה במסך לא היה**. מפעיל הפלטפורמה לא יכול היה
 * להגדיר אותו בשום דרך, ולכן ההעברה למסלול השותפים לא קרתה מעולם.
 *
 * הבדיקה השלישית סוגרת את זה: כל מפתח חייב להופיע גם במסך הפלטפורמה.
 */

const SERVICE = join(import.meta.dirname, "..", "core", "platform-settings.service.ts");
const CONTROLLER = join(
  import.meta.dirname,
  "..",
  "modules",
  "platform",
  "platform.controller.ts",
);

/**
 * מפתחות שנכתבים בקוד בלבד ולא מהמסך.
 *
 * ריק כרגע — וזה המצב הנכון: כל הגדרה כאן היא ערך שמפעיל הפלטפורמה
 * קובע. חותמת שהקוד כותב לעצמו (למשל "מתי רץ הסבב לאחרונה") היא
 * המקרה שבשבילו הרשימה קיימת; מי שמוסיף כזו מנמק אותה כאן, בדיוק
 * כמו ב-`RLS_EXEMPT`, במקום למחוק את הבדיקה.
 */
const WRITE_EXEMPT: Record<string, string> = {};

const WEB_PLATFORM_DIR = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "..",
  "apps",
  "web",
  "src",
  "app",
  "platform",
);

/**
 * מפתחות שנכתבים מהמסך אבל לא דרך מסך הפלטפורמה.
 *
 * ריק, וזה המצב הנכון: כל הגדרה כאן היא ערך שמפעיל הפלטפורמה קובע,
 * ומסך הפלטפורמה הוא המקום היחיד שבו הוא קובע אותו.
 */
const SCREEN_EXEMPT: Record<string, string> = {};

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.ES2023,
    /* setParentNodes */ true,
  );
}

/** המפתחות שבאיחוד `PlatformSettingKey`. */
function settingKeys(): string[] {
  const source = parse(SERVICE);
  for (const statement of source.statements) {
    if (!ts.isTypeAliasDeclaration(statement)) continue;
    if (statement.name.text !== "PlatformSettingKey") continue;
    const union = statement.type;
    if (!ts.isUnionTypeNode(union)) return [];
    return union.types
      .filter(ts.isLiteralTypeNode)
      .map((node) => node.literal)
      .filter(ts.isStringLiteral)
      .map((literal) => literal.text);
  }
  return [];
}

/** שמות השדות ב-`UpdateSettingsSchema` — כלומר מה שאפשר לשלוח ב-PATCH. */
function writableKeys(): string[] {
  const source = parse(CONTROLLER);
  const found: string[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "UpdateSettingsSchema" &&
      node.initializer !== undefined
    ) {
      /*
       * הסכימה נבנית כשרשרת (`z.object({...}).strict()`), ולכן
       * מחפשים את ה-object literal הראשון שבתוכה במקום להניח צורה
       * מסוימת של הקריאה — שינוי בשרשרת לא יאלם את הבדיקה.
       */
      const collect = (inner: ts.Node): boolean => {
        if (ts.isObjectLiteralExpression(inner)) {
          for (const property of inner.properties) {
            if (!ts.isPropertyAssignment(property)) continue;
            if (ts.isIdentifier(property.name)) found.push(property.name.text);
            else if (ts.isStringLiteral(property.name)) found.push(property.name.text);
          }
          return true;
        }
        return inner.forEachChild(collect) ?? false;
      };
      collect(node.initializer);
    }
    node.forEachChild(visit);
  };

  visit(source);
  return found;
}

describe("כיסוי הגדרות הפלטפורמה", () => {
  const keys = settingKeys();
  const writable = new Set(writableKeys());

  it("נמצאו מפתחות לסריקה", () => {
    // רשת ביטחון לבדיקה עצמה: שינוי שם הטיפוס או מבנה הקובץ היה
    // מאפס את הסריקה והופך אותה ל"עוברת תמיד"
    expect(keys.length).toBeGreaterThan(40);
  });

  it("נמצאו שדות בסכימת הכתיבה", () => {
    expect(writable.size).toBeGreaterThan(40);
  });

  it("כל מפתח הגדרה ניתן לכתיבה מהמסך", () => {
    const unreachable = keys.filter(
      (key) => !writable.has(key) && WRITE_EXEMPT[key] === undefined,
    );

    expect(
      unreachable,
      `המפתחות הבאים נקראים בקוד אך אין דרך להגדיר אותם: הם יישארו ` +
        `ריקים לנצח, והתכונה שתלויה בהם פשוט לא תעבוד — בשקט. הוסיפו ` +
        `אותם ל-UpdateSettingsSchema בבקר הפלטפורמה (ושדה במסך), או ` +
        `ל-WRITE_EXEMPT עם נימוק אם הקוד הוא שכותב אותם:\n${unreachable.join("\n")}`,
    ).toEqual([]);
  });

  it("כל מפתח הגדרה מופיע גם במסך הפלטפורמה", () => {
    /*
     * ‎**התאמה על מילה שלמה בכל קובצי המסך, ולא על מחרוזת מצוטטת.**
     *
     * חלק מההגדרות נערכות בטופס מקובץ ונשלחות כמפתח באובייקט הגוף
     * (`legalOperator: legal.operator.trim()`) ולא כשם שדה במרכאות.
     * דרישה למחרוזת מצוטטת הייתה מייצרת שמונה־עשרה חריגות עם אותו
     * נימוק בדיוק — ורשימת חריגות שגדלה בשגרה מפסיקה להיקרא.
     *
     * המחיר: מפתח שמוזכר רק בהערה במסך יעבור. זה ויתור מודע — מה
     * שהבדיקה מונעת הוא הגדרה **בלי שום ממשק**, ולא הגדרה שמישהו
     * תיעד ושכח לחבר.
     */
    const screen = readdirSync(WEB_PLATFORM_DIR)
      .filter((name) => name.endsWith(".tsx"))
      .map((name) => readFileSync(join(WEB_PLATFORM_DIR, name), "utf8"))
      .join("\n");

    expect(screen.length).toBeGreaterThan(10_000); // רשת ביטחון: הנתיב נקרא

    const invisible = keys.filter(
      (key) =>
        SCREEN_EXEMPT[key] === undefined &&
        !new RegExp(`\\b${key}\\b`, "u").test(screen),
    );

    expect(
      invisible,
      `המפתחות הבאים ניתנים לכתיבה ב-API אבל אין להם זכר במסך ` +
        `הפלטפורמה — כלומר אין דרך להגדיר אותם בפועל, והתכונה שתלויה ` +
        `בהם לא תעבוד לעולם. הוסיפו שדה תחת apps/web/src/app/platform, ` +
        `או ל-SCREEN_EXEMPT עם נימוק:\n${invisible.join("\n")}`,
    ).toEqual([]);
  });

  it("אין בסכימת הכתיבה שדה שאינו מפתח הגדרה מוכר", () => {
    /*
     * הכיוון ההפוך: שדה בסכימה ששמו שגוי (שינוי שם שנעשה בצד אחד
     * בלבד) נשמר תחת מפתח שאיש אינו קורא — הגדרה ש"נשמרה" ואינה
     * משפיעה על דבר.
     */
    const known = new Set(keys);
    const orphans = [...writable].filter((key) => !known.has(key));

    expect(
      orphans,
      `שדות בסכימת העדכון שאינם מפתחות מוכרים — הערך יישמר ולא ייקרא ` +
        `לעולם:\n${orphans.join("\n")}`,
    ).toEqual([]);
  });

  it("אין ב-WRITE_EXEMPT מפתח שכבר אינו קיים", () => {
    // פטור שנשאר אחרי מחיקת המפתח מסתיר את המקרה הבא תחת אותו שם
    const known = new Set(keys);
    expect(Object.keys(WRITE_EXEMPT).filter((key) => !known.has(key))).toEqual([]);
  });
});
