import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RECRUITMENT_STATUSES, canConvertToProperty } from "@metavchim/shared";
import { RecruitmentBodySchema } from "./recruitment.controller";

/**
 * ‎**נכס לגיוס אינו נכס — וההפרדה מבנית, לא משמעתית.**
 *
 * ## ‏מה זה מגן עליו
 *
 * ‏נכס לגיוס הוא מודעה שהמשרד **אינו מייצג**. אם שורה כזו תדלוף
 * למנוע ההתאמות, לרשת שיתופי הפעולה או להצעות — קונה יקבל הצעה על
 * נכס שאיש לא הסמיך את המשרד להציע, ובעל הנכס יגלה שמישהו משווק
 * את הדירה שלו בלי רשות. זה חמור יותר מהבאג של „נמכר”, שרק הציג
 * נכס ישן.
 *
 * ## ‏למה בדיקה מבנית
 *
 * ‏ההגנה האמיתית היא שהנתונים יושבים בטבלה נפרדת: שאילתה על
 * ‎`properties` אינה יכולה להחזיר שורת `recruitment_targets`.
 * הבדיקה כאן שומרת על **התנאי** להגנה הזאת — שאף מסלול של נכס לא
 * יתחיל לקרוא מהטבלה השנייה, ושהמודול לא יזלוג לכיוון ההפוך.
 *
 * ‏אין הרנס בדיקות ל-API (Prisma, RLS, הקשר דייר), וההתנהגות אומתה
 * חי: חמש המרות במקביל יצרו נכס אחד, ושורה בשלב „קיבל שיחה” החזירה
 * אפס שורות ב-`properties` ואפס התאמות.
 */

const MODULES = join(import.meta.dirname, "..");
const SERVICE = readFileSync(join(import.meta.dirname, "recruitment.service.ts"), "utf8");
const MODULE_FILE = readFileSync(join(import.meta.dirname, "recruitment.module.ts"), "utf8");

/** כל קובצי ה-TS של מודול, בלי בדיקות. */
function sourcesOf(moduleName: string): { name: string; text: string }[] {
  const dir = join(MODULES, moduleName);
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => ({ name, text: readFileSync(join(dir, name), "utf8") }));
}

describe("שורת גיוס אינה מגיעה למסלולי הנכס", () => {
  /*
   * ‎**הכיוון היחיד המותר.** הגיוס מכיר את הנכסים כדי ליצור אחד
   * בהמרה; הנכסים אינם יודעים שהגיוס קיים. תלות הפוכה הייתה
   * הפתח שדרכו שורת גיוס נכנסת לחישוב, לרשת או להצעה.
   */
  it.each(["properties", "matching", "collaboration", "offers"])(
    "מודול %s אינו נוגע ב-recruitmentTarget",
    (moduleName) => {
      const files = sourcesOf(moduleName);
      expect(files.length).toBeGreaterThan(0);
      for (const file of files) {
        /*
         * ‏חסר רישיות בכוונה: `tx.recruitmentTarget` הוא הגישה
         * דרך Prisma, `RecruitmentTarget` הוא הטיפוס,
         * ו-`RecruitmentService` הוא הזרקה — שלושתם דליפה.
         */
        expect(
          file.text,
          `${moduleName}/${file.name} קורא לטבלת הגיוס — ההפרדה נשברה`,
        ).not.toMatch(/recruitment[_-]?target|recruitmentservice/iu);
      }
    },
  );

  it("גם הסורקים והעבודות ברקע אינם נוגעים בה", () => {
    for (const moduleName of ["matching", "collaboration"]) {
      for (const file of sourcesOf(moduleName)) {
        expect(file.text).not.toContain("RecruitmentService");
      }
    }
  });

  /* ‏התלות היחידה, ובכיוון הזה בלבד */
  it("מודול הגיוס תלוי בנכסים — ולא להפך", () => {
    /*
     * ‏על **מערך ה-`imports`** ולא על הקובץ: שורת ה-`import` בראש
     * הקובץ מכילה את השם גם כשהמערך רוקן, ובדיקה על הקובץ כולו
     * הייתה עוברת על מודול שאיבד את התלות ואינו יכול להמיר.
     */
    const imports = /imports:\s*\[[\s\S]*?\]/u.exec(MODULE_FILE)?.[0] ?? "";
    expect(imports).toContain("PropertiesModule");
    const propsModule = readFileSync(
      join(MODULES, "properties", "properties.module.ts"),
      "utf8",
    );
    expect(propsModule).not.toContain("Recruitment");
  });
});

/**
 * ‎**הייבוא — הנתיב הקל ביותר לשבור בו את ההפרדה.**
 *
 * ‏„זה בסך הכול נכסים, נשתמש באותו מסלול” הוא בדיוק השינוי שנראה
 * ‏כמו ניקוי כפילות ומכניס מודעות שהמשרד אינו מייצג להתאמות,
 * ‏לרשת שיתופי הפעולה ולהצעות. הבדיקה מעוגנת ב**גוף המתודה** ולא
 * ‏בקובץ: `import.controller.ts` מייבא גם נכסים, גם קונים וגם
 * ‏לידים, ולכן סריקה על הקובץ כולו הייתה חסרת משמעות.
 */
describe("ייבוא לגיוס כותב לגיוס בלבד", () => {
  const IMPORT = readFileSync(join(MODULES, "import", "import.controller.ts"), "utf8");

  /** ‏גוף `importRecruitment` — מהחתימה ועד הסוגר של המתודה. */
  const body = (): string => {
    const start = IMPORT.indexOf("async importRecruitment(");
    expect(start, "המתודה importRecruitment לא נמצאה").toBeGreaterThan(-1);
    const rest = IMPORT.slice(start);
    const end = rest.indexOf("\n  }\n");
    expect(end, "לא נמצא סוף המתודה").toBeGreaterThan(-1);
    return rest.slice(0, end);
  };

  it("קורא ליצירה בטבלת הגיוס", () => {
    expect(body()).toMatch(/this\.recruitment\.create\(/u);
  });

  it("אינו נוגע בשירות הנכסים", () => {
    expect(body()).not.toMatch(/this\.properties\./u);
  });

  it("מאמת מול אותה סכימה שהטופס שולח", () => {
    expect(body()).toContain("RecruitmentBodySchema");
  });
});

describe("ההמרה — פעם אחת בלבד", () => {
  const convert = /async convert\([\s\S]*?\n {2}\}\n/u.exec(SERVICE)?.[0] ?? "";

  it("נמצאה", () => {
    expect(convert).not.toBe("");
  });

  /*
   * ‎**תפיסה מותנית, ולא „קרא ואז צור”.** שתי לחיצות שקוראות שתיהן
   * ‎`null` יוצרות שני נכסים זהים, ואת השני איש לא מוחק כי איש לא
   * יודע עליו. אומת חי: חמש המרות במקביל, נכס אחד.
   */
  it("תופסת את השורה בעדכון מותנה לפני שהיא יוצרת", () => {
    expect(convert).toContain("updateMany");
    const claim = convert.indexOf("updateMany");
    const create = convert.indexOf("this.properties.create");
    expect(create).toBeGreaterThan(-1);
    expect(claim).toBeLessThan(create);
  });

  /*
   * ‎**המזהה נקבע לפני התפיסה ונרשם יחד איתה.**
   *
   * ‏אחרת יש חלון שבו קיים נכס שאין אליו הפניה: יצירה שנכשלת אחרי
   * ההתמדה שחררה את התפיסה, וניסיון חוזר יצר נכס שני בזמן שהראשון
   * נשאר יתום — ומזההו מעולם לא נרשם, ולכן גם האינדקס הייחודי לא
   * יכול היה לתפוס אותו (ביקורת Codex, P1).
   */
  it("המזהה נקבע לפני התפיסה ונרשם בתוכה", () => {
    const assigned = convert.indexOf("const propertyId = ulid()");
    const claim = convert.indexOf("updateMany");
    expect(assigned).toBeGreaterThan(-1);
    expect(assigned).toBeLessThan(claim);
    // ‏שני השדות באותו עדכון — לא „תפוס עכשיו, רשום אחר כך”
    expect(convert).toMatch(/data: \{ convertedAt: new Date\(\), convertedPropertyId: propertyId \}/u);
    /*
     * ‏בתוך קריאת היצירה דווקא: `id: propertyId` מופיע גם בבדיקת
     * הקיום שבשחרור, ולכן חיפוש על כל הפונקציה עבר גם כשהמזהה
     * הוסר מהיצירה — כלומר Prisma הייתה מגרילה מזהה אחר, וההפניה
     * שנרשמה בתפיסה מצביעה על נכס שאינו קיים.
     */
    const createCall =
      /this\.properties\.create\(\{[\s\S]*?\n {6}\}\);/u.exec(convert)?.[0] ?? "";
    expect(createCall).not.toBe("");
    expect(createCall).toContain("id: propertyId");
  });

  /*
   * ‏בין הקריאה לתפיסה השורה יכולה להימחק או לצאת מ„גויס”. תפיסה
   * שבודקת רק „טרם הומר” הייתה יוצרת נכס מצילום מיושן.
   */
  it("התפיסה בודקת מחדש את מצב השורה ולא רק שטרם הומרה", () => {
    const claimWhere = /updateMany\(\{[\s\S]*?where: \{[\s\S]*?\}/u.exec(convert)?.[0] ?? "";
    expect(claimWhere).toContain("deletedAt: null");
    expect(claimWhere).toContain('status: "recruited"');
    expect(claimWhere).toContain("convertedAt: null");
  });

  /*
   * ‎**שחרור עיוור הוא מה שיצר את היתום.** היצירה יכולה לזרוק אחרי
   * שהשורה כבר נשמרה — הפרסום לרשת מתבצע בסופה.
   */
  it("משחררת רק כשהנכס באמת אינו קיים", () => {
    expect(convert).toContain("catch");
    const release = convert.slice(convert.indexOf("} catch (error: unknown) {"));
    expect(release).toContain("tx.property.findFirst");
    expect(release).toContain("if (!exists)");
    const lookup = release.indexOf("tx.property.findFirst");
    const clear = release.indexOf("convertedPropertyId: null");
    expect(clear).toBeGreaterThan(lookup);
  });

  /*
   * ‏מי שהפסיד את המרוץ קורא את המזהה במקום לנחש כמה לחכות לו.
   * פענוח הכתובת לבדו יכול לקחת שש שניות, וסקירה קצרה מזה החזירה
   * שגיאה על פעולה שהצליחה (ביקורת Codex).
   */
  it("המפסיד קורא את המזהה ואינו סוקר אחריו", () => {
    expect(convert).toContain("again?.convertedPropertyId");
    expect(convert).not.toMatch(/attempt < \d+/u);
  });

  /*
   * ‎**מזהה רשום אינו „נכס קיים”.** הוא נכתב בתפיסה, והיצירה עשויה
   * עדיין לרוץ — החזרה מיידית שלחה את המסך לכרטיס שמחזיר „לא נמצא”
   * ואינו מנסה שוב (ביקורת Codex).
   */
  it("כל מסלול שמחזיר מזהה קיים מוודא קודם שהנכס באמת שם", () => {
    const returns = [...convert.matchAll(/return \{ propertyId: [^}]+\};/gu)].map((m) => m[0]);
    expect(returns.length).toBeGreaterThanOrEqual(2);
    // ‏כל החזרה של מזהה **שכבר היה רשום** קודמת לה המתנה מאמתת
    const guarded = convert.split("this.requireProperty");
    expect(guarded.length).toBeGreaterThanOrEqual(3);
  });

  /*
   * ‎**תוצאה לא ידועה אינה הצלחה.** ההמתנה חזרה בהצלחה גם כשהשורה
   * לא הופיעה, והמסך ניווט למזהה שלא יהיה קיים לעולם.
   */
  it("ההמתנה נכשלת כשהנכס לא הופיע", () => {
    const wait = /private async requireProperty\([\s\S]*?\n {2}\}\n/u.exec(SERVICE)?.[0] ?? "";
    expect(wait).not.toBe("");
    expect(wait).toContain("throw new ConflictException");
    expect(wait).not.toMatch(/if \(row \|\| Date\.now\(\) >= deadline\) return;/u);
  });

  /*
   * ‏עריכה שנכנסה בין הקריאה לתפיסה נשמרה בשורה אך לא בנכס שנוצר
   * ממנה — הנכס נשא את הערכים הישנים לתמיד.
   */
  it("הנכס נבנה מהשורה שנתפסה ולא מהצילום שלפניה", () => {
    /*
     * ‏על **הקריאה מחדש** ולא על שם המשתנה: `const claimedRow = target`
     * משאיר את השם ומחזיר בדיוק את הבאג, ובדיקה על השם בלבד עברה.
     */
    expect(convert).toMatch(
      /const claimedRow =[\s\S]*?tx\.recruitmentTarget\.findFirst/u,
    );
    const claimRead = convert.indexOf("const claimedRow");
    const claim = convert.indexOf("updateMany");
    expect(claimRead).toBeGreaterThan(claim);
    const createCall =
      /this\.properties\.create\(\{[\s\S]*?\n {6}\}\);/u.exec(convert)?.[0] ?? "";
    expect(createCall).toContain("this.fieldsOf(claimedRow)");
    expect(createCall).not.toMatch(/\btarget\./u);
  });

  /* ‏לחיצה שנייה מקבלת את הנכס, לא שגיאה */
  it("מחזירה את הנכס הקיים במקום להיכשל", () => {
    expect(convert).toContain("propertyId: target.convertedPropertyId");
  });

  it("רק „גויס” ניתן להמרה — ואותו תנאי כמו במסך", () => {
    expect(convert).toContain("canConvertToProperty");
    expect(canConvertToProperty("recruited")).toBe(true);
    expect(canConvertToProperty("called")).toBe(false);
  });

  /*
   * ‏הנכס נולד **פעיל**: הבעלים חתם, והמתווך רוצה לשווק אותו מיד.
   * טיוטה כאן הייתה מסתירה נכס שכבר גויס.
   */
  it("הנכס שנוצר פעיל ולא טיוטה", () => {
    expect(convert).toContain('status: "active"');
  });
});

describe("הקישור למודעה", () => {
  /*
   * ‎**הבדיקה בשרת ולא רק במסך.** הכתובת מרונדרת כ-`href`, ומסך
   * הוא בקשה ולא אכיפה: `javascript:` שנשמר היה מריץ קוד אצל כל מי
   * שלוחץ עליו במשרד. אומת חי — הנתיב החזיר 409.
   */
  it("נאכף בשירות", () => {
    expect(SERVICE).toContain("isValidSourceUrl");
    expect(SERVICE).toContain("assertSourceUrl");
  });

  it("כל מסלול כתיבה עובר דרך האכיפה", () => {
    const create = /async create\([\s\S]*?\n {2}\}\n/u.exec(SERVICE)?.[0] ?? "";
    const update = /async update\([\s\S]*?\n {2}\}\n/u.exec(SERVICE)?.[0] ?? "";
    expect(create).toContain("this.assertSourceUrl");
    expect(update).toContain("this.assertSourceUrl");
  });

  /* ‏המסך לא יכול לכתוב את מזהה הנכס — הוא נקבע בהמרה בלבד */
  it("המסך אינו יכול לכתוב את מזהה הנכס שנוצר", () => {
    const writable = /private writable\([\s\S]*?\n {2}\}\n/u.exec(SERVICE)?.[0] ?? "";
    expect(writable).not.toBe("");
    expect(writable).not.toContain("convertedPropertyId");
    expect(writable).not.toContain("convertedAt");
  });
});

describe("שלבי הגיוס נגזרים מהרשימה המשותפת", () => {
  it("הבקר אינו כותב את הרשימה ביד", () => {
    const controller = readFileSync(
      join(import.meta.dirname, "recruitment.controller.ts"),
      "utf8",
    );
    expect(controller).toContain("RECRUITMENT_STATUSES");
    expect(controller).not.toMatch(/"awaiting_reply"\s*,\s*"meeting_set"/u);
  });

  it("„גויס” קיים ברשימה — כל השאר תלוי בו", () => {
    expect(RECRUITMENT_STATUSES).toContain("recruited");
  });
});

describe("סכימת הגוף — מה שהטופס באמת שולח", () => {
  /*
   * ‎**בדיקה מתפעלת ולא גרפ.** הטופס שולח את מצבו המלא, ולכן שדה
   * ריק מגיע כ-`null`. סכימה שקיבלה רק מחרוזת או `""` דחתה **יצירה
   * בלי קישור למודעה** — המקרה השכיח — וזו הייתה רגרסיה שנוצרה
   * בתיקון של ניקוי השדות (ביקורת Codex, P1). הבדיקות שלי אז עברו
   * דרך `curl` בלי השדה בכלל, כלומר `undefined`, ולא דרך מה שהמסך
   * שולח.
   */
  it("מקבלת בדיוק את מה שהטופס שולח כשהכול ריק", () => {
    const result = RecruitmentBodySchema.safeParse({
      status: "new",
      source: "yad2",
      sourceUrl: null,
      city: null,
      neighborhood: null,
      street: null,
      houseNumber: null,
      propertyType: null,
      dealType: null,
      rooms: null,
      areaSqm: null,
      floor: null,
      totalFloors: null,
      priceAgorot: null,
      ownerName: null,
      ownerPhone: null,
      notes: null,
    });
    expect(result.success, JSON.stringify(result.error?.issues ?? [])).toBe(true);
  });

  it("עדיין דוחה קישור שאינו כתובת", () => {
    expect(RecruitmentBodySchema.safeParse({ sourceUrl: "not a url" }).success).toBe(false);
  });
});

/**
 * ‎**הרישום המשותף נוסע עם השורה, ומגיע לנכס** (ביקורת Codex, P1).
 *
 * ‏הסוג הוותיק `shared_tabu` ירד מבורר הסוגים, וטופס הגיוס הוא
 * ‏הרביעי שנבנה מאותו בורר — ולכן נשאר בלי שום דרך לרשום את
 * ‏העובדה. שורה חדשה לא יכלה לסמן, עריכה של שורה ותיקה מחקה את
 * ‏הסימון בשקט, וההמרה יצרה נכס רגיל שמוצע לקונים שסירבו במפורש.
 */
describe("‏הסימון על שורת הגיוס", () => {
  const HERE = join(import.meta.dirname);
  const SERVICE = readFileSync(join(HERE, "recruitment.service.ts"), "utf8");
  const CONTROLLER = readFileSync(join(HERE, "recruitment.controller.ts"), "utf8");

  it("‏העמודה קיימת בסכמה ובמיגרציה", () => {
    const schema = readFileSync(
      join(HERE, "..", "..", "..", "prisma", "schema.prisma"),
      "utf8",
    );
    const model = schema.slice(
      schema.indexOf("model RecruitmentTarget"),
      schema.indexOf("model Property "),
    );
    expect(model).toMatch(/sharedTabu\s+Boolean\s+@default\(false\)\s+@map\("shared_tabu"\)/u);
    const migration = readFileSync(
      join(
        HERE,
        "..",
        "..",
        "..",
        "prisma",
        "migrations",
        "20260907010000_recruitment_shared_tabu",
        "migration.sql",
      ),
      "utf8",
    );
    expect(migration).toContain('ALTER TABLE "recruitment_targets"');
    expect(migration).toContain('"shared_tabu" BOOLEAN NOT NULL DEFAULT false');
    /* ‏ומילוי לאחור מהצורה הישנה — אותו כלל כמו בנכסים ובפרסומים */
    expect(migration).toMatch(/SET "shared_tabu" = true[\s\S]{0,80}'shared_tabu'/u);
  });

  it("‏הבקר מקבל את השדה", () => {
    expect(CONTROLLER).toMatch(/sharedTabu: true,/u);
  });

  it("‏והכתיבה שומרת אותו", () => {
    expect(SERVICE).toContain('...set("sharedTabu", input.sharedTabu)');
  });

  /*
   * ‏זה החצי שהממצא נגמר בו: הנכס שנוצר בהמרה נושא את העובדה.
   * ‏`fieldsOf` הוא המיפוי היחיד להמרה, ולכן מספיק שהוא נושא אותה.
   */
  it("‏וההמרה מעבירה אותו לנכס", () => {
    const start = SERVICE.indexOf("private fieldsOf(");
    expect(start).toBeGreaterThan(-1);
    const rest = SERVICE.slice(start);
    const end = rest.search(/\n {2}(?:private |async |\/\*\*)/u);
    const method = end === -1 ? rest : rest.slice(0, end);
    expect(method).toContain("sharedTabu: row.sharedTabu");
  });

  /* ‏ובשורה שנקראת חזרה — אחרת המסך אינו יכול לסמן מראש */
  it("‏והקריאה מחזירה אותו תמיד, לא רק כשהוא דלוק", () => {
    expect(SERVICE).toContain("sharedTabu: row.sharedTabu,");
  });
});
