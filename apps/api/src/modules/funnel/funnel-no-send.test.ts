import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ‎**שלב א׳ אינו שולח דבר — ושער, לא הבטחה.**
 *
 * ## ‏למה זה שווה בדיקה
 *
 * ‏המנוע הזה נוגע ב**כל** המשרדים במאגר. באג בו אינו מקלקל מסך
 * אחד — הוא מדוור לכל הקטלוג. ההגנה בשלב א׳ אינה „נזהרנו”, אלא
 * שאין במודול הזה בכלל דרך אל ערוץ יוצא: אין `EmailService`, אין
 * שליחת וואטסאפ, ואין `imports` במודול שיכולים להביא אותם.
 *
 * ‏הבדיקה בודקת את **הקוד**, לא את הכוונה. עריכה עתידית שתוסיף
 * שליחה לשלב הזה תיפול כאן, ומי שיוסיף אותה יידרש להזיז אותה
 * לשלב ב׳ — או למחוק את השער במפורש ולהסביר למה.
 *
 * ‏זו אותה תבנית של שער ההפרדה בנכסים לגיוס: מבנה שנאכף, לא
 * משמעת שנזכרים בה.
 */

const DIR = import.meta.dirname;

function sourceFiles(): { name: string; text: string }[] {
  return readdirSync(DIR)
    .filter((name) => name.endsWith(".ts"))
    .filter((name) => !name.endsWith(".test.ts"))
    .map((name) => ({ name, text: readFileSync(join(DIR, name), "utf8") }));
}

/**
 * ‏הקוד בלי ההערות.
 *
 * ‏בלי זה השער נפל על התיעוד של עצמו: ההסבר „אין כאן `EmailService`”
 * מכיל את המחרוזת שהוא אוסר. שער שאי אפשר להסביר בלי להפיל אותו
 * הוא שער שיימחק — ולכן הסריקה היא על מה שהקוד **עושה**.
 */
function codeOnly(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/.*$/gmu, "");
}

describe("מנוע המסלולים — שלב א׳ אינו שולח", () => {
  it("יש קבצים לבדוק (אחרת הבדיקה ירוקה על כלום)", () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThanOrEqual(3);
    expect(files.map((f) => f.name)).toContain("funnel-enrollment.service.ts");
  });

  /**
   * ‏השמות מכסים את שלוש הדרכים החוצה שקיימות במערכת: שירות הדואר,
   * שירות השליחה בוואטסאפ, ותור ה-outbox שמוביל לשתיהן.
   */
  it("אף קובץ במודול אינו נוגע בערוץ יוצא", () => {
    const forbidden = [
      /EmailService/u,
      /WhatsAppSendService/u,
      /sendTemplate\s*\(/u,
      /sendText\s*\(/u,
      /\.send\s*\(/u,
      /OutboxService/u,
      /PlatformAdminNotifier/u,
    ];
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const code = codeOnly(file.text);
      for (const pattern of forbidden) {
        if (pattern.test(code)) offenders.push(`${file.name} ← ${String(pattern)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * ‎`imports: []` הוא חלק מההבטחה ולא סגנון: מודול שמייבא את
   * ‏`MessagingModule` מקבל את השליחה בהזרקה, וכל שאר הבדיקה כאן
   * הופכת לעקיפה של שורה אחת.
   */
  it("המודול אינו מייבא מודול אחר", () => {
    const module = readFileSync(join(DIR, "funnel.module.ts"), "utf8");
    expect(module).not.toMatch(/imports\s*:/u);
  });

  /**
   * ‏הטבלאות של הדיירים נקראות דרך `withFunnelAdmin` בלבד. קריאה
   * ישירה מ-`this.prisma.funnelMessage` הייתה עוקפת את RLS — וזה
   * בדיוק מה ש-`rls-access` אוסר, אבל כאן זה נבדק גם בהקשר של
   * המודול עצמו, שבו הפיתוי הזה חוזר בכל שאילתה.
   */
  it("טבלאות הדיירים נקראות רק דרך withFunnelAdmin", () => {
    for (const file of sourceFiles()) {
      const code = codeOnly(file.text);
      expect(code).not.toMatch(/this\.prisma\.funnelEnrollment\b/u);
      expect(code).not.toMatch(/this\.prisma\.funnelMessage\b/u);
    }
  });

  /**
   * ‎**ההוצאה של „כבר רשום” יושבת בשאילתה, לא אחרי השליפה.**
   *
   * ‏זה נראה כמו העדפת סגנון והוא כלל נכונות: סינון אחרי `take`
   * ‏עוצר את הקליטה לגמרי ברגע שדף שלם מתמלא במי שכבר נרשם, ואז
   * ‏גם הרשמה טרייה שאמורה לעקוף כל מכסה אינה נכנסת לעולם. חזרה
   * ‏לסינון-אחרי-שליפה נראית תמימה בקוד ולכן היא נבדקת.
   */
  it("מי שכבר רשום מוצא מהשאילתה עצמה", () => {
    const code = codeOnly(readFileSync(join(DIR, "funnel-enrollment.service.ts"), "utf8"));
    expect(code).toMatch(/funnelEnrollments:\s*\{\s*none:/u);
  });

  /**
   * ‎**סריקת הרישומים החיים עוברת על כולם, ולא על הדף הראשון.**
   *
   * ‏בלי סמן, `take` הופך לתקרת עבודה: אותם רישומים ישנים נקראים
   * ‏בכל סבב, וכל עוד הם פתוחים אף רישום מאוחר אינו נבדק — משרד
   * ‏שהזין כרטיס לא נסגר לעולם.
   *
   * ‏הבדיקה עוגנה ב-`cursor` של Prisma, וזה הפך למלכודת: היא
   * ‏**דרשה** בדיוק את המנגנון שנשבר כאן (העוגן יוצא מהתוצאה ברגע
   * ‏שהשורה נסגרת). היום היא שואלת מה שהתכוונה לשאול מלכתחילה —
   * ‏שיש דפדוף שמתקדם — והשער למטה אוסר את המנגנון השבור.
   */
  it("סגירת הרישומים משתמשת בסמן", () => {
    const code = codeOnly(readFileSync(join(DIR, "funnel-enrollment.service.ts"), "utf8"));
    expect(code).toMatch(/where:\s*\{\s*endedAt:\s*null,\s*\.\.\.afterId\(after\)\s*\}/u);
  });

  /**
   * ‎**`startedAt` הוא רגע הכניסה — לא `createdAt` של המשרד.**
   *
   * ‏זו ההחלטה של המשתמש בשורה אחת של קוד, והיא הדבר היחיד שמפריד
   * בין „כל משרד מיום 0 שלו” לבין „כניסה בנקודה” שנדחתה. עריכה
   * שתחליף אותה נראית תמימה לגמרי בקוד, ולכן היא נבדקת.
   */
  it("הכניסה למשפך מתחילה מהרגע, ולא מתאריך ההרשמה", () => {
    const code = codeOnly(readFileSync(join(DIR, "funnel-enrollment.service.ts"), "utf8"));
    /*
     * ‎**מעוגן ביצירה עצמה, ולא ב-`startedAt` הראשון בקובץ.**
     *
     * ‏הגרסה הקודמת חיפשה את ההתאמה הראשונה, ותפסה `startedAt: true`
     * ‏בתוך `select` של שאילתה אחרת — כלומר בדקה שורה שאינה קשורה
     * ‏להחלטה. שער שמסתמך על סדר השורות בקובץ נשבר בכל עריכה, ובלי
     * ‏מזל היה **עובר** על הערך הלא נכון.
     */
    /*
     * ‎**ואתר יצירה אחד בלבד.**
     *
     * ‏הבדיקה בוחנת את ההתאמה הראשונה. אתר יצירה שני — למשל אחד
     * ‏שנוסף בתוך טרנזקציה — היה **מחוץ לשער**, ובו אפשר לכתוב
     * ‏`startedAt: tenant.createdAt` בלי שאיש ישים לב. לכן שתי
     * ‏הדרכים לכתוב רישום עוברות דרך `open`, וזה נאכף כאן.
     */
    const creates = code.match(/funnelEnrollment\.create\(/gu) ?? [];
    expect(creates).toHaveLength(1);

    const create = /funnelEnrollment\.create\(\{[\s\S]*?\}\)/u.exec(code);
    expect(create).not.toBeNull();
    expect(create![0]).toMatch(/startedAt:\s*now\b/u);
    expect(code).not.toMatch(/startedAt:\s*\w*\.?createdAt/u);
  });

  /**
   * ‎**המכסה היומית נספרת ונשלפת בפעולה אחת, מתחת לנעילה.**
   *
   * ‏„ספור ואז קח” בשתי טרנזקציות נפרדות נותן לשני עותקים של
   * ‏ה-API להוציא כל אחד מכסה שלמה באותו יום (ביקורת Codex, P1).
   * ‏מה שמגן על זה אינו הספירה עצמה אלא **הגבול של הטרנזקציה**,
   * ‏והוא בדיוק הדבר שעריכה עתידית תפרק בלי כוונה — „נוציא את
   * ‏הספירה החוצה, כך יותר קריא”.
   */
  it("המכסה היומית מוצאת מתחת לנעילה, בטרנזקציה אחת", () => {
    const code = codeOnly(readFileSync(join(DIR, "funnel-enrollment.service.ts"), "utf8"));
    const body = /private async enrollBacklog\([\s\S]*?\n {2}\}\n/u.exec(code)?.[0] ?? "";
    expect(body, "enrollBacklog לא נמצאה").not.toBe("");

    expect(body).toMatch(/pg_try_advisory_xact_lock/u);
    // ‏הספירה על אותה טרנזקציה, ולא על חיבור נפרד
    expect(body).toMatch(/backlogEnrolledToday\(tx\b/u);
    // ‏שום יציאה מהטרנזקציה בתוך הקטע הנעול
    expect(body).not.toMatch(/this\.prisma\.(?!withFunnelAdmin)/u);
  });
});

/**
 * ‎**שער: הדפדוף בקובץ המשפך אינו נשען על `cursor` של Prisma**
 * ‏(ביקורת Codex, P2 — ארבע פעמים).
 *
 * ## ‏למה שער ולא תיקון רביעי
 *
 * ‏אותה תקלה נמצאה כאן ארבע פעמים: בסבב הטרי, בסבב הפיגור, בפתיחה
 * ‏מחדש ובסגירה. בכל אחת מהן העבודה שהצליחה היא זו שמוציאה את שורת
 * ‏העוגן מהתוצאה — משרד שנרשם יוצא מ-`funnelEnrollments: { none }`,
 * ‏רישום שנפתח מאבד את `endedAt`, רישום שנסגר מקבל אחד — ו-`cursor`
 * ‏של Prisma דורש ששורת העוגן תישאר. הדף הבא חוזר ריק, והסבב מטפל
 * ‏באחד במקום בכולם.
 *
 * ‏שלושה תיקונים נקודתיים הזמינו רביעי. הכלל הוא שבקובץ הזה
 * ‏**כל** דפדוף הוא סמן מפתח, ולכן `cursor` אסור בו.
 */
describe("שער: אין `cursor` של Prisma בדפדוף המשפך", () => {
  const SOURCE = readFileSync(
    join(__dirname, "funnel-enrollment.service.ts"),
    "utf8",
  );

  /** ‏הקוד בלי הערות — הערה שמזכירה `cursor` אינה משתמשת בו. */
  const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^[ \t]*\/\/.*$/gmu, "");

  it("‏יש מה לבדוק — הקובץ מדפדף", () => {
    expect(CODE).toContain("take: pageSize");
    expect(CODE.split("take: pageSize").length - 1).toBeGreaterThanOrEqual(4);
  });

  it("‏ואף דף אינו נלקח עם `cursor:`", () => {
    expect(CODE, "‏`cursor` של Prisma חזר — ראו `afterId` ו-`afterSignup`").not.toMatch(
      /cursor:\s*\{/u,
    );
  });

  it("‏ושני הסמנים בשימוש", () => {
    expect(CODE).toContain("afterId(");
    expect(CODE).toContain("afterSignup(");
  });
});

/**
 * ‎**שער: סריקת הפיגור חסומה בשאילתה, ולא בסינון אחריה** (ביקורת
 * ‏Codex, P2).
 *
 * ## ‏למה שער דווקא כאן
 *
 * ‏`reopenRows` הוא שמכריע — מוטציה שמסירה ממנו את בדיקת הניסיון
 * ‏מפילה בדיקת אינטגרציה. הסינון בשאילתה, לעומת זאת, אינו משנה
 * ‏**תוצאה** אלא **כמות עבודה**: בלעדיו הסבב מדפדף על כל רישום
 * ‏ששולם אי פעם, לנצח, ורק אז מגלה שאיש מהם אינו מועמד. מוטציה
 * ‏שמסירה אותו עוברת בשקט בכל בדיקה התנהגותית — ובצדק, כי אין לה
 * ‏השפעה התנהגותית.
 *
 * ‏מדידת תוכנית ריצה בטבלאות של בדיקה חסרת ערך (הַמְּתַכְנֵן סורק
 * ‏סדרתית בכל מקרה), ולכן הטענה נשמרת בצורה שאפשר באמת לבדוק:
 * ‏התנאי נמצא בשאילתה.
 */
describe("שער: הניסיון החי נמצא בשאילתת הפיגור", () => {
  const CODE = codeOnly(readFileSync(join(__dirname, "funnel-enrollment.service.ts"), "utf8"));
  const SCAN = CODE.slice(
    CODE.indexOf('endedReason: "paid"'),
    CODE.indexOf("take: pageSize", CODE.indexOf('endedReason: "paid"')),
  );

  /* ‏פיקוח: בלעדיו כל השער היה ירוק על מחרוזת ריקה. */
  it("‏יש מה לבדוק — סריקת הפיגור נמצאה", () => {
    expect(SCAN.length).toBeGreaterThan(0);
    expect(SCAN).toContain("afterId(after)");
  });

  it("‏והיא מסננת משרדים בניסיון חי", () => {
    expect(SCAN).toMatch(/tenant:\s*trialActiveWhere\(now\)/u);
  });

  /*
   * ‏ושהתנאי אינו עותק שני של הכלל: הוא נכתב דרך אותה פונקציה
   * ‏שהתאום שלה, `isTrialActive`, מכריע ב-`reopenRows`.
   */
  it("‏דרך התאום, ולא בניסוח משלה", () => {
    expect(SCAN).not.toMatch(/status:\s*"trial"/u);
    expect(SCAN).not.toMatch(/trialEndsAt/u);
  });
});
