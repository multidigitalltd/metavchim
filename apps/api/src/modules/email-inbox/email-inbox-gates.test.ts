import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * שערים מבניים על תיבת המייל הפנימית.
 *
 * שלוש הערות ביקורת רצופות כאן נגעו באותו כלל אחד: **„לא ידוע” אינו
 * „לא”.** פעם בסיווג כשל השליחה, פעם בקבצים שנשמרים בתוצאה עמומה,
 * ופעם בניקוי מפתח שהעלאתו נגמרה בלי תשובה. הכלל כתוב בקוד בהערות
 * ארוכות; כאן הוא נאכף.
 *
 * הקריאה היא במקור לאחר **הסרת הערות** — בלעדיה טענה כמו „הקוד מזכיר
 * ‎`discardOrphan`” מתקיימת על ההסבר שמסביר למה הוא שם, ולא עליו.
 */

function strip(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^[ \t]*\/\/.*$/gmu, "");
}

function read(relative: string): string {
  return strip(readFileSync(new URL(relative, import.meta.url), "utf8"));
}

const SERVICE = read("./email-inbox.service.ts");
const INBOX_PAGE = read("../../../../web/src/app/inbox/page.tsx");
const DESK = read("../../../../web/src/app/platform/integration-desk-section.tsx");

/** גוף המתודה: מהחתימה ועד הסוגר הסוגר בהזחה של שתי רווחים. */
function method(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start, `המתודה ${signature} לא נמצאה`).toBeGreaterThan(-1);
  const end = source.indexOf("\n  }\n", start);
  expect(end, `סוף המתודה ${signature} לא נמצא`).toBeGreaterThan(start);
  return source.slice(start, end);
}

/**
 * ‎**השורה קודמת להעלאה, ואין מסלול הרסני.**
 *
 * הסדר ההפוך יצר אובייקט בלי שורה — בלתי נראה למחיקת לקוח ולמחיקת
 * משרד, ששתיהן עוברות על השורות. הפיצוי שנוסף בגללו הפך למסוכן
 * ברגע שהמפתח נעשה דטרמיניסטי ומשותף, ואחריו החכירה וההשתלטות
 * הוסיפו שתי תקלות נוספות (ביקורת Codex, שלושה סבבים).
 *
 * הצורה שנשארה היא הפשוטה: **שורה, העלאה, סימון — ובכישלון לא
 * מוחקים דבר.** כיוון שהשורה נכתבת ראשונה, אין מפתח בלי שורה
 * שתמצא אותו, ולכן אין מה לפצות; והעלאה חוזרת של אותם בתים לאותו
 * מפתח היא אידמפוטנטית, ולכן אין מה לתאם.
 */
describe("סדר הכתיבה של קובץ מצורף", () => {
  it("השורה נכתבת לפני ההעלאה בשני המסלולים", () => {
    for (const fn of ["  async processInbound(", "  private async storeOutgoingCopies("]) {
      const scope = method(SERVICE, fn);
      const row = scope.indexOf("emailAttachment.createMany(");
      const put = scope.indexOf("this.storage.put(");
      const mark = scope.indexOf("this.markUploaded(");
      expect(row, `כתיבת השורה לא נמצאה ב-${fn}`).toBeGreaterThan(-1);
      expect(put, `ההעלאה לא נמצאה ב-${fn}`).toBeGreaterThan(row);
      expect(mark, `הסימון לא נמצא ב-${fn}`).toBeGreaterThan(put);
    }
  });

  /*
   * ‎**אין מסלול שמוחק.** זו התכונה שסוגרת שלוש תקלות רצופות בבת
   * אחת, וכל מחיקה שתחזור לכאן פותחת אותן מחדש.
   */
  it("אין מחיקה של מפתח או של שורה במסלול הכישלון", () => {
    expect(SERVICE).not.toContain("discardOrphan");
    expect(SERVICE).not.toContain("releaseClaim");
    expect(SERVICE).not.toContain("takeover");
    expect(SERVICE).not.toContain("this.storage.delete(");
    expect(SERVICE).not.toContain("emailAttachment.deleteMany(");
  });

  /*
   * שורה קיימת ולא-מושלמת היא בדיוק מה שבאנו להשלים — ולכן אין
   * ‎`continue` על כפילות, ואין חכירה שמחליטה למי מותר.
   */
  it("תביעה קיימת אינה עוצרת את ההשלמה", () => {
    // ‏`written.count` נשאר בדה-דופליקציה של **ההודעה**; לא בקבצים
    const loops = SERVICE.slice(SERVICE.indexOf("for (const [ordinal, attachment]"));
    expect(loops).not.toContain("written.count === 0");
    expect(SERVICE).not.toContain("ATTACHMENT_CLAIM_LEASE_MS");
    expect(method(SERVICE, "  async processInbound(")).toContain(
      "if (completed.has(ordinal)) continue;",
    );
  });

  it("הדילוג הוא על מה שהושלם בלבד", () => {
    const inbound = method(SERVICE, "  async processInbound(");
    expect(inbound).toMatch(/uploadedAt: \{ not: null \}/u);
    expect(inbound).toContain("const completed = new Set<number>();");
  });

  it("השיחה מציגה רק צירופים שהושלמו", () => {
    expect(method(SERVICE, "  async thread(")).toMatch(/uploadedAt: \{ not: null \}/u);
  });

  /*
   * ‎**סימון שנכשל מסתיר קובץ שנשמר** — התקלה שהמסננת הזו הכניסה.
   * בקליטה יש רשת ביטחון (מסירה חוזרת); בעותקים היוצאים אין, ולכן
   * הניסיונות החוזרים כאן הם היחידים.
   */
  it("הסימון מנסה שוב לפני שהוא מוותר", () => {
    const mark = method(SERVICE, "private async markUploaded(");
    expect(mark).toContain("MARK_UPLOADED_ATTEMPTS");
    expect(mark).toMatch(/for \(let attempt = 0;/u);
    expect(mark).toContain("return;");
    expect(mark).toContain("this.logger.error");
  });
});

/**
 * ‎**סימון „נשלחה” אינו רוכב על שורת הציר.**
 *
 * השתיים היו טרנזקציה אחת, וכשל בציר — הכתיבה הכבדה — הפיל איתו גם
 * את `sendState`. ההודעה נשארה `pending` אף שיצאה ללקוח, והמסך אמר
 * „בשליחה…” לנצח. `sendState` הוא עדכון עמודה אחת לפי מפתח ראשי,
 * והוא העובדה שקובעת אם מותר לשלוח שוב.
 */
describe("שתי הכתיבות שאחרי השליחה", () => {
  const reply = method(SERVICE, "  async reply(");

  it("סימון המצב וכתיבת הציר אינם באותה טרנזקציה", () => {
    const marks = reply.indexOf('data: { sendState: "sent" }');
    const timeline = reply.indexOf("recordReplyOnTimeline(");
    expect(marks, "סימון „נשלחה” לא נמצא").toBeGreaterThan(-1);
    expect(timeline, "כתיבת הציר לא נמצאה").toBeGreaterThan(marks);
    // בין השניים נפתחת טרנזקציה נוספת — כלומר הן נפרדות
    expect(reply.slice(marks, timeline)).toContain("withTenant(");
  });

  it("שתיהן נכשלות בשקט, כי הלקוח כבר קיבל", () => {
    const after = reply.slice(reply.indexOf('data: { sendState: "sent" }'));
    expect((after.match(/\.catch\(/gu) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(after).not.toContain("throw");
  });
});

/**
 * ‎**„בשליחה…” שאינו נגמר הוא שקר שקט.**
 *
 * השליחה היא בתוך בקשה אחת ואורכת שניות. שרת שנפל בין כתיבת השורה
 * לקריאה לספק — או סימון מצב שנכשל אחרי שליחה מוצלחת — משאיר
 * ‎`pending` שאין תהליך רקע שסוגר (ביקורת Codex). **זמן** הוא מה
 * שמבדיל בין „בדרך” ל„תקוע”, והמסך הוא מי שיודע אותו.
 */
describe("ההמתנה שאינה נגמרת", () => {
  it("התווית נגזרת גם מחותמת הזמן, לא מהמצב לבדו", () => {
    expect(INBOX_PAGE).toMatch(/function sendStateNote\([\s\S]{0,200}createdAt: string/u);
    expect(INBOX_PAGE).toContain("STALE_PENDING_MS");
  });

  it("מעבר לסף היא נקראת כמו „לא ידוע”, ובאותן מילים", () => {
    expect(INBOX_PAGE).toMatch(/deadline <= now\) return \{ \.\.\.UNKNOWN_NOTE \}/u);
    // אותה מחרוזת בדיוק לשני המצבים — הפעולה הנדרשת מהסוכן זהה
    expect((INBOX_PAGE.match(/UNKNOWN_NOTE/gu) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("חותמת שאינה נקראת אינה מסתירה את האזהרה", () => {
    expect(INBOX_PAGE).toContain("Number.isNaN(deadline)");
  });

  /*
   * ‎**זמן שעובר אינו מרנדר רכיב מחדש.** `Date.now()` ברינדור נקרא
   * פעם אחת, ולכן שורה שנטענה צעירה נשארה „בשליחה…” כל עוד השיחה
   * פתוחה — גם שעה אחרי שחצתה את הסף (ביקורת Codex). הסף שנוסף
   * בקומיט הקודם פשוט לא היה מתקיים במסך שנשאר פתוח.
   */
  it("השעה מגיעה מ-state ולא מקריאה ברינדור", () => {
    expect(INBOX_PAGE).toContain("const [now, setNow] = useState(() => Date.now());");
    // אתר הקריאה ב-JSX מקבל את ה-state; קריאה ברינדור לא הייתה מתקדמת לעולם
    expect(INBOX_PAGE).toMatch(
      /sendStateNote\(\s*message\.sendState,\s*message\.createdAt,\s*now,\s*\)/u,
    );
    /*
     * שלוש קריאות מותרות ל-`Date.now()`, וכולן **כותבות** את השעה:
     * האתחול, הרענון עם רשימה חדשה, וההערה בתום התזמון. רביעית
     * פירושה קריאה ברינדור, שהיא בדיוק התקלה.
     */
    expect((INBOX_PAGE.match(/Date\.now\(\)/gu) ?? []).length).toBe(3);
  });

  it("יש תזמון שמעיר את המסך במועד החצייה", () => {
    expect(INBOX_PAGE).toMatch(/setTimeout\(\(\) => setNow\(Date\.now\(\)\), Math\.min\(/u);
    // מותנה במועדים שטרם נחצו — אחרת התזמון חוזר על עצמו לנצח
    expect(INBOX_PAGE).toMatch(/deadline > now\)/u);
    expect(INBOX_PAGE).toContain("if (deadlines.length === 0) return;");
    expect(INBOX_PAGE).toContain("return () => clearTimeout(timer);");
  });

  it("רשימה חדשה מרעננת גם את השעה", () => {
    expect(INBOX_PAGE).toMatch(/setMessages\(thread\.messages\);\n\s*setNow\(Date\.now\(\)\);/u);
  });

  it("חישוב מועד החצייה נמצא במקום אחד", () => {
    expect((INBOX_PAGE.match(/Date\.parse\(/gu) ?? []).length).toBe(1);
    expect((INBOX_PAGE.match(/stalePendingDeadline\(/gu) ?? []).length).toBe(3);
  });
});

/**
 * ‎**המשך שרץ אחרי החלפת משרד אינו כותב למסך.**
 *
 * דגל ה-`live` של האפקט מכסה את הטעינה בלבד. `save` בודק התאמה לפני
 * ה-`await` הראשון ולא אחריו, ולכן תשובה שחוזרת אחרי שהמנהל עבר
 * למשרד אחר דרסה את מה שכבר נטען — והמשרד החדש נשאר **בלי טופס** עד
 * שייבחר מחדש, עם הודעת הצלחה שנושאת את השם הקודם (ביקורת Codex).
 */
describe("שולחן החיבורים והחלפת משרד באמצע שמירה", () => {
  const save = DESK.slice(DESK.indexOf("async function save("));

  it("הבחירה החיה נקראת מ-ref ולא מ-state", () => {
    expect(DESK).toContain("const selected = useRef(agencyId);");
    expect(DESK).toMatch(/useEffect\(\(\) => \{\n\s*selected\.current = agencyId;/u);
  });

  it("כל כתיבה למסך אחרי await מותנית בהתאמה", () => {
    const guards = save.match(/if \(selected\.current !== target\) return;/gu) ?? [];
    // אחרי השמירה, אחרי הטעינה מחדש, ובתפיסה
    expect(guards.length).toBeGreaterThanOrEqual(3);
    expect(save.indexOf("setLoaded({ agencyId: target")).toBeGreaterThan(
      save.indexOf("if (selected.current !== target) return;"),
    );
  });

  it("שחרור הנעילה נשאר ללא תנאי", () => {
    const tail = save.slice(save.indexOf("} finally {"));
    expect(tail).toContain("setBusy(false);");
    expect(tail).not.toContain("selected.current");
  });
});

/**
 * ‎**„לא ידוע” שורד את הטעינה מחדש.**
 *
 * הפעם השלישית שהתיקון של המצב הזה נעצר צעד לפני מי שצריך לדעת.
 * ‎1: השרת סימן הכול „נכשלה”. ‏2: הזריקה מנעה מהמסך לטעון את השורה.
 * ‏3, כאן: `openThread` מאפס את מצב השליחה כחלק מפתיחת שיחה, ולכן
 * ‎„לא ידוע” שנכתב **לפניו** נמחק לפני שהספיק להיראות (ביקורת
 * Codex). בדרך התקינה השורה שנטענה נושאת את האזהרה בעצמה — אבל אם
 * הטעינה עצמה נכשלה, הטיוטה כבר נמחקה ולסוכן לא נשאר דבר.
 */
describe("האזהרה ששורדת את פתיחת השיחה", () => {
  const send = method(INBOX_PAGE, "  async function sendReply(");

  it("המצב נקבע אחרי הטעינה מחדש ולא לפניה", () => {
    const reload = send.indexOf("await openThread(openContact);");
    const mark = send.indexOf('setSendState(okBody?.state === "unknown"');
    expect(reload, "הטעינה מחדש לא נמצאה").toBeGreaterThan(-1);
    expect(mark, "קביעת המצב לא נמצאה").toBeGreaterThan(reload);
  });

  it("והוא שייך לשיחה שממנה נשלח", () => {
    expect(send).toContain("if (openRef.current === openContact) {");
  });

  it("הפתיחה והסגירה שתיהן מעדכנות את ה-ref", () => {
    expect(INBOX_PAGE).toMatch(
      /async function openThread\(contactId: string\) \{\n\s*openRef\.current = contactId;/u,
    );
    expect(INBOX_PAGE).toMatch(/openRef\.current = null;\n\s*setOpenContact\(null\);/u);
  });
});

/**
 * ‎**מסירה חוזרת ממשיכה מהמקום שנעצר.**
 *
 * הקבצים נכתבים אחרי הטרנזקציה. תהליך שנפל באמצע משאיר שורת הודעה
 * קיימת וחלק מהקבצים לא שמורים — ואין להם מצב ממתין ואין תהליך רקע
 * שמשלים. חזרה בשקט מהכפילות זרקה את המסירה החוזרת, שהיא ההזדמנות
 * **היחידה** להשלים אותם, והקובץ של הלקוח נעלם לתמיד (ביקורת Codex).
 *
 * ההתראה והציר לא נכתבים שוב: הם כבר נכתבו במסירה הראשונה.
 */
describe("קליטה חוזרת שמשלימה קבצים", () => {
  const inbound = method(SERVICE, "  async processInbound(");

  it("הכפילות מחזירה את מזהה ההודעה הקיימת ולא null בלבד", () => {
    expect(inbound).toContain("tenantId_providerMessageId");
    expect(inbound).toMatch(/return \{ messageId: existing\.id, fresh: false/u);
  });

  it("לולאת הקבצים רצה גם במסירה חוזרת", () => {
    const dup = inbound.indexOf("if (written.count === 0)");
    const loop = inbound.indexOf("for (const [ordinal, attachment] of incoming.entries())");
    expect(dup, "ענף הכפילות לא נמצא").toBeGreaterThan(-1);
    expect(loop, "לולאת הקבצים לא נמצאה").toBeGreaterThan(dup);
    // אין יציאה מוקדמת שמדלגת על הלולאה בגלל כפילות
    expect(inbound.slice(dup, loop)).not.toMatch(/if \(!stored\.fresh\) return;/u);
  });

  /*
   * ‎**ההכרעה במסד, לא בזיכרון.** ההשוואה לפי שם וגודל נעשתה
   * **אחרי** הקריאה, ולכן שתי מסירות שרצות במקביל ראו את אותה
   * תמונת מצב חלקית והכניסו את אותם קבצים תחת מזהים שונים —
   * כפילות בתיבה ובאחסון (ביקורת Codex). `ordinal` הופך את הזהות
   * ליציבה: אותו מפתח אחסון לשני הכותבים, ואילוץ ייחודי שמכריע.
   */
  it("הזהות נגזרת מהמקום בהודעה ולא משם וגודל", () => {
    expect(inbound).toContain("const completed = new Set<number>();");
    expect(inbound).not.toContain("attachment.content.length}`");
  });

  it("המפתח באחסון נגזר מההודעה ומהמקום", () => {
    const keys =
      SERVICE.match(/`tenants\/\$\{tenantId\}\/email-attachments\/\$\{[\w.]+\}\/\$\{ordinal\}`/gu) ??
      [];
    expect(keys.length, "קליטה ותשובה — שני מסלולים").toBe(2);
    expect(SERVICE).not.toContain("${attachmentId}`");
  });

  /*
   * כותב מקביל שהקדים אותנו כבר רשם את השורה על אותו מפתח. זו אינה
   * שגיאה ואינה יתום — ולכן `ON CONFLICT DO NOTHING` ולא `create`.
   */
  it("ההכנסה עצמה סובלת כפילות", () => {
    expect(SERVICE).not.toMatch(/tx\.emailAttachment\.create\(\{/u);
    expect((SERVICE.match(/tx\.emailAttachment\.createMany\(\{/gu) ?? []).length).toBe(2);
  });

  it("הקריאה לרשימה הקיימת נעשית רק במסירה חוזרת", () => {
    expect(inbound).toMatch(/if \(!stored\.fresh\) \{[\s\S]{0,400}emailAttachment\.findMany\(/u);
  });

  /*
   * ‎**האילוץ הוא במסד, ולכן הוא נבדק במסד.** כל השאר כאן — מפתח
   * יציב, `skipDuplicates`, בדיקה לפי מקום — מסתמך על כך שהמסד
   * באמת דוחה את השני. בלי האינדקס הייחודי זו הסכמה בעל פה.
   */
  it("האילוץ הייחודי קיים בסכמה ובמיגרציה", () => {
    const schema = readFileSync(new URL("../../../prisma/schema.prisma", import.meta.url), "utf8");
    expect(schema).toContain("@@unique([tenantId, messageId, ordinal])");
    const migration = readFileSync(
      new URL(
        "../../../prisma/migrations/20260827100000_email_attachment_ordinal/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(migration).toMatch(/CREATE UNIQUE INDEX[\s\S]{0,200}"tenant_id", "message_id", "ordinal"/u);
    // NULL על שורות ותיקות — אין מילוי אחורה, ואין התנגשות
    expect(migration).toContain('ADD COLUMN "ordinal" INTEGER');
    expect(migration).not.toContain("NOT NULL");
    // ‏"נתבע" אינו "הועלה" — והשורות הקיימות נכתבו אחרי העלאה מוצלחת
    expect(migration).toContain('ADD COLUMN "uploaded_at" TIMESTAMP(3)');
    expect(migration).toMatch(
      /UPDATE "email_attachments" SET "uploaded_at" = "created_at";/u,
    );
  });

  it("התראה חוזרת אינה נשלחת", () => {
    expect(inbound).toMatch(/if \(stored\.fresh\) \{\n\s*await this\.notifyAgentOnWhatsApp\(/u);
  });
});
