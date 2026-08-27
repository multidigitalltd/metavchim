import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * ‎**כתיבה שמתחרה במחיקת משרד** (#258, חלק 2).
 *
 * מחיקת משרד אספה את מפתחות ה-S3 ואז מחקה את השורות שמכירות אותם.
 * בין שני השלבים לא היה דבר שחוסם כתיבה, והעלאה שרצה במקביל
 * הסתיימה באחד משני סידורים — **ושניהם משאירים קובץ של לקוח אחרי
 * שהמשרד ביקש להימחק:**
 *
 * | הסידור | התוצאה |
 * |---|---|
 * | ה-COMMIT לפני האיסוף | השורה נמחקת, המפתח לא נאסף, הקובץ נשאר |
 * | ה-COMMIT אחרי האיסוף | גם השורה וגם הקובץ שורדים את המחיקה |
 *
 * שני חלקים לתיקון, ושניהם נדרשים: דגל שנסגר לפני הכול ונבדק
 * ב-`StorageService.put`, **ואיסוף שיושב בתוך טרנזקציית המחיקה**.
 * הדגל לבדו מצמצם את החלון; רק צירוף השניים סוגר אותו.
 */

function read(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^[ \t]*\/\/.*$/gmu, "");
}

const STORAGE = read("./storage.service.ts");
const DELETION = read("../modules/settings/account-deletion.service.ts");
const SCHEMA = readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");

/** כל קובץ מקור ב-api, בלי בדיקות. */
function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sources(full, found);
    } else if (full.endsWith(".ts") && !full.includes(".test.")) {
      found.push(full);
    }
  }
  return found;
}

describe("המשרד מפסיק לקבל קבצים לפני שהוא נמחק", () => {
  /*
   * ‎**הבדיקה אחרי ההעלאה, ולא לפניה — וזה כל ההבדל.**
   *
   * בדיקה מקדימה יכולה לעבור שבריר שנייה לפני שהדגל נקבע, וההעלאה
   * שאחריה משאירה אובייקט שאיש לא יאסוף — כלומר היא מצמצמת את החלון
   * ואינה סוגרת אותו. בדיקה שאחרי ההעלאה הופכת את הכיוון: אם הדגל
   * נקבע עד אליה המעלה מוחק את מה שהעלה, ואם לא — האובייקט קיים
   * לפני שהדגל נקבע, כלומר לפני האיסוף שבא אחריו.
   */
  it("הבדיקה נעשית אחרי ההעלאה", () => {
    const put = STORAGE.slice(STORAGE.indexOf("  async put("));
    const upload = put.indexOf("new PutObjectCommand(");
    const check = put.indexOf("await this.acceptsFiles(tenantId)");
    expect(upload, "ההעלאה לא נמצאה").toBeGreaterThan(-1);
    expect(check, "הבדיקה לא נמצאה").toBeGreaterThan(-1);
    expect(check, "בדיקה מקדימה בלבד — מצמצמת ואינה סוגרת").toBeGreaterThan(upload);
  });

  /*
   * המעלה מוחק את מה שהעלה, ודוחה. „העלינו ולא סיפרנו” הוא בדיוק
   * הקובץ היתום שהשער בא למנוע.
   */
  it("מה שהועלה למשרד נעול נמחק, וההעלאה נדחית", () => {
    const put = STORAGE.slice(STORAGE.indexOf("  async put("));
    expect(put).toContain("await this.delete(key);");
    expect(put).toContain("throw new GoneException(");
  });

  /*
   * ‎**בלי מטמון.** ערך שנשמר לשנייה אחת פותח מחדש בדיוק את החלון
   * שהשער סוגר.
   */
  it("הבדיקה קוראת מהמסד בכל פעם", () => {
    expect(STORAGE).toMatch(
      /private async acceptsFiles\(tenantId: string\): Promise<boolean> \{\s*const tenant = await this\.prisma\.tenant\.findUnique\(/u,
    );
    expect(STORAGE).not.toMatch(/cache|Cache|ttl|TTL/u);
  });

  /*
   * משרד שאיננו אינו מקבל קבצים. `null` מהשאילתה הוא „נמחק כבר”,
   * ולא „לא ידוע” — אותה הבחנה שחזרה כאן שוב ושוב.
   */
  it("משרד שכבר נמחק אינו מקבל קבצים", () => {
    expect(STORAGE).toContain("return tenant !== null && tenant.filesLockedAt === null;");
  });

  /*
   * ‎**הפרמטר חובה, וזו כל הנקודה.** דגל שכל קורא „זוכר לבדוק” הוא
   * דגל שהקורא השמיני ישכח, והמשטח כבר גדל מחמש טבלאות לשבע מאז
   * שהנושא נכתב. פרמטר חובה מעביר את התזכורת מהמשמעת למהדר.
   */
  it("כל העלאה חייבת להצהיר של מי הקובץ", () => {
    expect(STORAGE).toMatch(/^\s*tenantId: string \| null,$/mu);
    // ‏`?` או ערך ברירת מחדל היו מחזירים את הכלל להערה
    expect(STORAGE).not.toMatch(/tenantId\?: string/u);
    expect(STORAGE).not.toMatch(/tenantId: string \| null = /u);
  });

  /*
   * ואין נתיב שעוקף את השער בקריאה ישירה ל-SDK. `StorageService`
   * הוא המקום היחיד שמעלה.
   */
  it("אין העלאה שעוקפת את השירות", () => {
    const offenders = sources(new URL("..", import.meta.url).pathname)
      .filter((file) => !file.endsWith("core/storage.service.ts"))
      .filter((file) => readFileSync(file, "utf8").includes("new PutObjectCommand("));
    expect(offenders).toEqual([]);
  });

  /*
   * ‎**הדגל בטרנזקציה משלו, לפני הכול.** דגל שנקבע בתוך טרנזקציית
   * המחיקה אינו גלוי לאיש עד ה-COMMIT שלה — כלומר בדיוק לאורך כל
   * החלון שהוא בא לסגור.
   */
  it("הדגל נסגר לפני טרנזקציית המחיקה", () => {
    const lock = DELETION.indexOf("data: { filesLockedAt: new Date() }");
    const tx = DELETION.indexOf("await this.prisma.$transaction(");
    expect(lock, "סגירת הדגל לא נמצאה").toBeGreaterThan(-1);
    expect(tx, "טרנזקציית המחיקה לא נמצאה").toBeGreaterThan(-1);
    expect(lock, "הדגל נסגר בתוך הטרנזקציה — אינו גלוי עד ה-COMMIT").toBeLessThan(tx);
  });

  /*
   * ‎**והאיסוף בתוכה.** שורה שנכתבה בין איסוף חיצוני לבין המחיקה
   * נמחקה בלי שהמפתח שלה נאסף. כשהשניים באותה טרנזקציה, כל שורה
   * שקיימת ברגע המחיקה נאספת בהגדרה.
   */
  it("איסוף המפתחות יושב בתוך טרנזקציית המחיקה", () => {
    const tx = DELETION.indexOf("await this.prisma.$transaction(");
    const collect = DELETION.indexOf("tx.propertyMedia.findMany({ where: { tenantId }, select: { s3Key: true } })");
    const firstDelete = DELETION.indexOf("await tx.contactLink.deleteMany(");
    expect(collect, "האיסוף לא נמצא").toBeGreaterThan(tx);
    expect(firstDelete, "המחיקה לא נמצאה").toBeGreaterThan(collect);
    // ואין איסוף שנשאר מחוץ לטרנזקציה
    expect(DELETION.slice(0, tx)).not.toContain("select: { s3Key: true }");
  });

  /*
   * שבע הטבלאות, ולא חמש: המשטח גדל מאז שהנושא נכתב, ושתיים
   * מהחדשות — קבצי תיבת המייל וקבצי תיבת התמיכה — נושאות PII בדיוק
   * כמו הסריקות.
   */
  it("שבעת מקורות הקבצים נאספים", () => {
    for (const source of [
      "tx.propertyMedia.findMany",
      "tx.signedDocument.findMany",
      "tx.call.findMany",
      "tx.supportTicket.findMany",
      "tx.emailAttachment.findMany",
      "tx.supportAttachment.findMany",
      'select: { settings: true }',
    ]) {
      expect(DELETION, `${source} אינו נאסף`).toContain(source);
    }
  });

  /*
   * הראיה והמחיקה עומדות או נופלות יחד. רישום שנכתב בטרנזקציה
   * נפרדת שלפניה תיעד מחיקה שאולי לא קרתה.
   */
  it("רישום היומן יושב באותה טרנזקציה", () => {
    const tx = DELETION.indexOf("await this.prisma.$transaction(");
    const audit = DELETION.indexOf("await tx.auditLog.create({");
    expect(audit, "רישום היומן לא נמצא").toBeGreaterThan(tx);
    expect(DELETION.slice(0, tx)).not.toContain("auditLog.create");
  });

  /* העמודה קיימת, ומשרד קיים אינו נעול. */
  it("העמודה קיימת בסכימה וברירת המחדל היא „מקבל”", () => {
    const model = SCHEMA.slice(SCHEMA.indexOf("model Tenant {"));
    expect(model.slice(0, model.indexOf("\n}"))).toMatch(
      /filesLockedAt\s+DateTime\?\s+@map\("files_locked_at"\)/u,
    );
  });
});
