import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * ‎**ארכיון המשרד הוא המוצא האחרון — ולכן תנאי הכניסה אליו הוא
 * „איש אינו יכול להגיע”, לא „מישהו ניתק”.**
 *
 * ‎`assertContactAccess` דורשת אחד משלושה עוגנים: קונה חי, ליד, או
 * נכס חי שהכרטיס הוא בעליו או דיירו. מחיקת נכס לצמיתות מסירה את
 * השלישי, ואצל בעלים-בלבד — כרטיס שנוצר רק כדי להחזיק נכס, מצב רגיל
 * לחלוטין — היא מסירה את היחיד. הכרטיס מחזיר 404 לכל משתמש.
 *
 * הארכיון סינן `contactId: null` בלבד, כלומר את מה שמחיקת לקוח
 * ניתקה במפורש. הסכם או סריקה של כרטיס יתום אינם עומדים בתנאי הזה,
 * והתוצאה היא **ראיה שנשמרה מטעמים משפטיים שאיש אינו יכול להגיע
 * אליה, למחוק אותה, או לדעת שהיא שם** — כלומר PII ששריד לנצח בלי
 * שישרת דבר. רלוונטי ל-ISO-27001 ולבקשת מחיקה של אדם.
 *
 * ‎**ושתי הרשימות יחד.** הסכם דיגיטלי וסריקה שנחתמה על נייר מגיעים
 * לאותו מצב מאותה סיבה; תיקון של אחת מהן בלבד הוא בדיוק הפער שנפער
 * כאן מלכתחילה.
 */

function read(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8")
    // בלי הסרת הערות, טענה על „הכלל מוזכר” מתקיימת על ההסבר שלו
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^[ \t]*\/\/.*$/gmu, "");
}

const AGREEMENTS = read("./agreements.service.ts");
const DOCUMENTS = read("./signed-documents.service.ts");
const OWNERSHIP = read("../../common/ownership.ts");

/**
 * גוף הפונקציה: מהחתימה ועד הסוגר הסוגר בהזחה שלה.
 *
 * מתודה במחלקה נסגרת בשני רווחים, פונקציה ברמת המודול באפס. הניסוח
 * הראשון הכיר רק בראשונה, ולכן „לא נמצא” על שתיים מהטענות — נתפס
 * בהרצה הראשונה, לא באימות שבירה.
 */
function method(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start, `${signature} לא נמצאה`).toBeGreaterThan(-1);
  const close = signature.startsWith("  ") ? "\n  }\n" : "\n}\n";
  const end = source.indexOf(close, start);
  expect(end, `סוף ${signature} לא נמצא`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("ארכיון המסמכים שנשמרו", () => {
  const lists = [
    ["הסכמים", method(AGREEMENTS, "  async listRetained(")],
    ["סריקות", method(DOCUMENTS, "  async listRetained(")],
  ] as const;

  for (const [name, body] of lists) {
    it(`${name}: כרטיס יתום נכנס לארכיון, לא רק כרטיס שנותק`, () => {
      expect(body).toContain("orphanContactCondition(");
      // המנותק בענף אחד והיתום באחר; הניסוח נפרס לשורות בסריקות
      expect(body).toMatch(/contact_id IS NULL\s*(?:OR |\n\s*OR \()/u);
    });

    /*
     * סינון אחרי השליפה מחזיר עמוד חסר: 500 השורות האחרונות נבחרות
     * לפני שנשאלה השאלה מי מהן שייכת לכרטיס נגיש.
     */
    it(`${name}: היתמות מוכרעת באותה שאילתה עם ה-LIMIT`, () => {
      const condition = body.indexOf("orphanContactCondition(");
      const limit = body.indexOf("LIMIT 500");
      expect(limit, "ה-LIMIT לא נמצא בשאילתה").toBeGreaterThan(condition);
      expect(body).not.toMatch(/contactId: null/u);
    });
  }

  /*
   * ‎**ניסוח אחד, שלושה קוראים.** הכלל ישב פעמיים באותו קובץ — פעם
   * ב-`isOrphanContact` ופעם בגוף `visibleCallsCondition` — והארכיון
   * היה העותק הרביעי. הקובץ עצמו מתעד מה קרה בפעם הקודמת שהעותקים
   * נפרדו: תיקון עדכן שניים והשאיר את השלישי, ובעל נכס נחשף למי
   * שמודול הנכסים חסום אצלו.
   */
  it("שלושת העוגנים מנוסחים ב-SQL פעם אחת בלבד", () => {
    expect((OWNERSHIP.match(/NOT EXISTS \(SELECT 1 FROM buyers/gu) ?? []).length).toBe(1);
    expect((OWNERSHIP.match(/NOT EXISTS \(SELECT 1 FROM leads/gu) ?? []).length).toBe(1);
    expect((OWNERSHIP.match(/NOT EXISTS \(SELECT 1 FROM properties/gu) ?? []).length).toBe(1);
    expect(AGREEMENTS).not.toContain("NOT EXISTS");
    expect(DOCUMENTS).not.toContain("NOT EXISTS");
  });

  it("ושער השיחות משתמש באותו ניסוח ולא בעותק משלו", () => {
    expect(method(OWNERSHIP, "export function visibleCallsCondition(")).toContain(
      'orphanContactCondition("c")',
    );
  });

  /*
   * ‎**בלי סינון בעלות, במכוון.** „יתום” כאן הוא „איש במשרד אינו
   * יכול להגיע”, לא „המשתמש הזה אינו יכול". סינון לפי `view_own`
   * היה מכניס לארכיון לקוחות חיים של עמיתים.
   */
  it("תנאי היתמות אינו מסנן לפי בעלות", () => {
    const condition = method(OWNERSHIP, "export function orphanContactCondition(");
    expect(condition).not.toContain("ownershipFilter");
    expect(condition).not.toContain("owner_user_id");
    expect(condition).not.toContain("assigned_to_user_id");
  });

  /*
   * הכינוי נכנס דרך `Prisma.raw` — בלי פרמטר ובלי בריחה. הטיפוס הוא
   * מה שמונע ערך אחר, ולא משמעת הקורא.
   */
  /*
   * ‎**הרשימה והשער חייבים להסכים.** הרשימה הורחבה ליתומים והשער
   * נשאר על „נותק” בלבד — ארכיון שמציג שורות שמנהל המשרד אינו יכול
   * לפתוח, כי `assertContactAccess` נכשלת עליהן בהגדרה (ביקורת
   * Codex). שני תנאים שאמורים להסכים, בשני מקומות, הם הצורה
   * שנפרדת מעצמה; לכן הכרעה אחת לשניהם.
   */
  it("שער ההורדה מכריע באותו כלל כמו הרשימה", () => {
    for (const [name, source, fn] of [
      ["הסכמים", AGREEMENTS, "  async document("],
      ["סריקות", DOCUMENTS, "  async getRaw("],
    ] as const) {
      const body = method(source, fn);
      expect(body, `${name}: השער אינו עובר דרך ההכרעה המשותפת`).toContain(
        "await contactGateFor(tx, tenantId,",
      );
      expect(body, `${name}: נשאר תנאי „נותק” ישיר`).not.toMatch(
        /if \((?:row|found)\.contactId === null\)/u,
      );
    }
  });

  /*
   * ‎**גם המחיקה.** אין נתיב מחיקה לשורת ארכיון — היא נשמרת מטעמים
   * משפטיים — אבל הענף בדק „נותק” בלבד, ולכן סריקה של כרטיס יתום
   * נפלה על `assertContactAccess` וקיבלה „איש קשר לא נמצא”: אותה
   * דחייה, בהודעה שאינה נכונה. אותה הכרעה, ובלי „הלקוח נמחק” על
   * לקוח שלא נמחק.
   */
  it("גם מסלול המחיקה מכריע באותו כלל, ואומר אמת", () => {
    const body = method(DOCUMENTS, "  async remove(");
    expect(body).toContain("await contactGateFor(tx, tenantId,");
    expect(body).not.toMatch(/if \(row\.contactId === null\)/u);
    expect(DOCUMENTS).not.toContain("הלקוח נמחק מהמערכת");
  });

  /*
   * הענף „לקוח” מחזיר את המזהה, ולכן אין `!` אצל הקורא: „יש כרטיס
   * לבדוק מולו” הוא בדיוק המידע שהמזהה קיים.
   */
  it("ההכרעה מחזירה את המזהה ולא דורשת אימות-לא-null מהקורא", () => {
    const gate = method(OWNERSHIP, "export async function contactGateFor(");
    expect(gate).toContain('{ mode: "contact"; contactId: string }');
    expect(AGREEMENTS).not.toMatch(/assertContactAccess\(tx, tenantId, row\.contactId!\)/u);
    expect(DOCUMENTS).not.toMatch(/assertContactAccess\(tx, tenantId, found\.contactId!\)/u);
  });

  /*
   * ‎**הסיווג נוסע עם השורה.** היומן גזר `retained` מ-`contactId
   * === null`, ולכן הורדה של מסמך **יתום** מהארכיון נרשמה כהורדה
   * רגילה עם `retained: false` — בדיוק המסמכים שהשינוי הזה הכניס
   * לארכיון. דחיתי את ההערה הזו בסבב הקודם בנימוק שהתיוג נכון;
   * הוא נכון רק כשהכרטיס באמת נמחק (ביקורת Codex).
   */
  it("יומן ההורדה מסווג לפי ההכרעה ולא לפי contactId", () => {
    expect(DOCUMENTS).toContain("archived: gate.mode === \"archive\"");
    expect(DOCUMENTS).toMatch(/retained: row\.archived/u);
    expect(DOCUMENTS).not.toMatch(/retained: row\.contactId === null/u);
    expect(DOCUMENTS).not.toMatch(/entityType: row\.contactId === null/u);
  });

  /*
   * הרשימה גדורה ב-`settings.manage` ומפנה לנתיב המסמך; מנהל
   * שמודול הקונים חסום אצלו קיבל 403 בלחיצה, לפני שהשער שבשירות
   * הספיק לרוץ.
   */
  it("נתיב המסמך פתוח גם ליכולת שהארכיון גדור בה", () => {
    const controller = readFileSync(
      new URL("./agreements.controller.ts", import.meta.url),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//gu, "");
    expect(controller).toMatch(
      /@Get\("agreements\/:id\/document"\)\n\s*@RequireCapability\("buyers\.view_own", "settings\.manage"\)/u,
    );
  });

  /*
   * ‎**הרחבת נגישות אינה המקום להרחיב מה נגיש.**
   *
   * מחיקת לקוח משמרת רק הזמנה בכתב חתומה — `kind` מהרשימה
   * ו-`signedOn` שאינו ריק — ו**מוחקת** את השאר: תעודת זהות,
   * אישור זכויות, נספח. לכן שורה מנותקת היא ראיה משפטית בהגדרה.
   *
   * לכרטיס יתום הניקוי מעולם לא רץ, ולכן בלי המבחן הזה הארכיון היה
   * חושף את מסמכי הלקוח עצמם — ומציג אותם כהסכמים שנשמרו (ביקורת
   * Codex).
   */
  it("ענף היתום מסנן לפי אותו מבחן שימור של מחיקת הלקוח", () => {
    const body = method(DOCUMENTS, "  async listRetained(");
    expect(body).toContain("OFFER_DOCUMENT_KINDS");
    expect(body).toContain("d.signed_on IS NOT NULL");
    // המבחן חל על ענף היתום, לא על המנותק — שם הוא כבר הוחל במחיקה
    expect(body).toMatch(/d\.contact_id IS NULL\s*\n\s*OR \(d\.kind = ANY/u);
  });

  /*
   * הרשימה מגיעה מ-shared, מאותו מקום שמכריע גם במחיקת הלקוח.
   * רשימה שנכתבת כאן שוב היא בדיוק הפער.
   */
  it("רשימת הסוגים אינה משוכפלת בשאילתה", () => {
    const body = method(DOCUMENTS, "  async listRetained(");
    expect(body).not.toMatch(/'brokerage'|"brokerage"/u);
  });

  it("הכינוי מוגבל באיחוד סגור ולא ב-string", () => {
    expect(OWNERSHIP).toMatch(/type OrphanAlias = "a" \| "c" \| "d";/u);
    expect(OWNERSHIP).toMatch(/function orphanContactCondition\(alias: OrphanAlias\)/u);
  });
});
