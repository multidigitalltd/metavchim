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
    /*
     * מה שהשער שומר הוא **הצמידות** — שהשעה מתרעננת עם הרשימה — ולא
     * הדרך שבה `messages` נקרא. אימות הרשימה (`apiList`) הוא שאלה
     * נפרדת ששער אחר אוכף (`verify:lists`), ולכן הביטוי כאן נעצר
     * בסוף השורה במקום למנות ניסוחים מותרים.
     */
    expect(INBOX_PAGE).toMatch(
      /setMessages\(.*thread\.messages.*\);\n\s*setNow\(Date\.now\(\)\);/u,
    );
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

/**
 * ‎**כל התראה שנוצרת כאן נושאת עוגן — והעוגן נקבע במקום אחד**
 * ‏(ביקורת Codex, P1).
 *
 * ‏השורה שנוצרה ללקוח שנראה דרך נכס יצאה בלי `entityType`, ושורה
 * ‏בלי עוגן פטורה מהצנזורה בקריאה: `notificationAnchor` מחזיר
 * ‎`null`, ולכן ה-API, הדחיפה לדפדפן והוואטסאפ כולם מחזירים אותה
 * ‏כמות שהיא. אחרי העברת הנכס לסוכן אחר, תמצית המייל של הלקוח
 * ‏המשיכה לזרום למי שכבר אינו רשאי.
 *
 * ‏השער נכתב על **התכונה** ולא על הניסוח: לא „הספרייד נראה כך”
 * ‏אלא „כל `notification.create` בקובץ הזה שואל את
 * ‎`inboundNotificationAnchor`”. התראה שנייה שתתווסף כאן מחר
 * ‏נופלת בו כל עוד היא לא עברה דרך אותה הכרעה.
 */
describe("‏עוגן ההרשאה של ההתראות בתיבה", () => {
  /** ‏גוף הקריאה, מהסוגר הפותח ועד הסוגר שסוגר אותו. */
  function callsIn(source: string, needle: string): string[] {
    const calls: string[] = [];
    let from = 0;
    for (;;) {
      const at = source.indexOf(needle, from);
      if (at === -1) return calls;
      const open = source.indexOf("(", at);
      let depth = 0;
      let end = open;
      for (let i = open; i < source.length; i += 1) {
        if (source[i] === "(") depth += 1;
        else if (source[i] === ")") {
          depth -= 1;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      calls.push(source.slice(open, end + 1));
      from = end + 1;
    }
  }

  it("כל יצירת התראה עוברת דרך ההכרעה האחת", () => {
    const creates = callsIn(SERVICE, "notification.create");
    expect(creates.length).toBeGreaterThan(0);
    for (const create of creates) {
      expect(create).toContain("inboundNotificationAnchor(");
    }
  });

  /*
   * ‏ושההתראה אינה מרכיבה עוגן משלה לצד ההכרעה: שני ניסוחים לאותה
   * ‏שאלה הם בדיוק המצב שבו אחד מהם מתעדכן והשני לא.
   *
   * ‏הבדיקה על **יצירת ההתראה** ולא על הקובץ: `entityType` היא גם
   * ‏אוצר המילים של יומן הביקורת (`audit.record`), שם היא נכתבת
   * ‏במפורש ובצדק — הניסוח הרחב נפל עליה מיד.
   */
  it("ההתראה אינה מרכיבה עוגן משלה", () => {
    for (const create of callsIn(SERVICE, "notification.create")) {
      expect(create).not.toMatch(/entityType:/u);
    }
  });
});

/**
 * ‎**תג הכרטיס — „ידוע” ולא „סביר”.**
 *
 * ‏התכונה הזאת מסוכנת דווקא כשהיא עובדת כמעט תמיד: תג שגוי נראה
 * ‏בדיוק כמו תג נכון, והסוכן פועל לפיו. לכן הכלל היחיד הוא שהתג
 * ‏נכתב **רק** משתי עובדות שנשמרו — הכרטיס ששלח, והטוקן שהתשובה
 * ‏חזרה דרכו — ולעולם לא מחיפוש בדיעבד.
 *
 * ‏השערים כאן שומרים על הצד שאין לו בדיקה התנהגותית זולה: שקליטת
 * ‏הנכנס יורשת מהטוקן, ושאין בקובץ שום מסלול שגוזר כרטיס אחרת.
 */
describe("‏תג הכרטיס בתיבה", () => {
  const INBOUND = method(SERVICE, "async processInbound(");

  it("‏הטוקן נקרא עם עמודות הכרטיס", () => {
    expect(INBOUND).toContain("cardKind: true");
    expect(INBOUND).toContain("cardId: true");
  });

  /* ‏זו כל התכונה: ההודעה שהסוכן קורא היא זו שאין בה רמז */
  it("‏וההודעה הנכנסת יורשת אותן מהטוקן", () => {
    expect(INBOUND).toContain("cardKind: mapping.cardKind");
    expect(INBOUND).toContain("cardId: mapping.cardId");
  });

  /*
   * ‎**ואין מסלול שני שממציא כרטיס.** הפיתוי הברור הוא „מצא את
   * ‏הקונה של הלקוח הזה” — נכון לרוב הלקוחות, ושגוי בדיוק אצל מי
   * ‏שיש לו שניים. `contactOwner` ו-`inboundInteractionParent` הם
   * ‏הכרעת **הבעלות** (למי להתריע), לא „על מה ההודעה”, ואסור
   * ‏שהתג יישאב מהם.
   */
  it("‏התג אינו נגזר מהכרעת הבעלות", () => {
    /*
     * ‏השורה הנכתבת בלבד, ולא כל שארית המתודה: ההתראה שאחריה כן
     * ‏נשענת על הכרעת הבעלות — וזה נכון, כי „למי להתריע” היא
     * ‏באמת שאלה של בעלות. הטענה היא על **מה שנכתב בשורה**.
     */
    const at = INBOUND.indexOf("emailMessage.createMany");
    expect(at, "‏הכתיבה לא נמצאה").toBeGreaterThan(-1);
    const row = INBOUND.slice(at, INBOUND.indexOf("skipDuplicates", at));
    expect(row).not.toContain("owner");
    expect(row).not.toContain("buyerId");
    /* ‏ומה שכן — הטוקן */
    expect(row).toContain("mapping.cardKind");
  });

  /*
   * ‏ותשובה מהתיבה יוצאת **בלי** כרטיס במפורש. הסוכן משיב לשיחה
   * ‏ולא מכרטיס, וירושה מהטוקן האחרון הייתה מחזירה את הניחוש
   * ‏מהדלת האחורית.
   */
  it("‏תשובת התיבה נשלחת בלי כרטיס, במפורש", () => {
    expect(SERVICE).toContain("this.replyAddressFor(tenantId, contactId, actingUserId(), null)");
  });

  /* ‏והמסך קורא את שתי העמודות דרך העוזר המשותף בלבד */
  it("‏המיפוי לתשובה עובר דרך `emailCardTag`", () => {
    expect(SERVICE).toContain("emailCardTag(row.cardKind, row.cardId)");
  });

  it("‏והמסך מציג את התג כקישור לכרטיס", () => {
    expect(INBOX_PAGE).toContain("emailCardHref(message.card)");
    expect(INBOX_PAGE).toContain("emailCardLabel(message.card.kind)");
  });

  /**
   * ‎**וכל שלושת סוגי הכרטיס נבדקים בבעלות — לא רק במשרד.**
   *
   * ‏זו בדיוק הביקורת שכבר תוקנה כאן על הקישור לכרטיס הקונה
   * ‏(P2): שער הלקוח הוא איחוד, ולכן שיחה שנפתחה דרך הליד שלי
   * ‏יכולה להיות עם לקוח שיש עליו גם כרטיס של עמית. תג משרדי היה
   * ‏מגלה את קיומו ומוביל ל-404 — אותה תקלה, שלוש פעמים.
   */
  const THREAD = method(SERVICE, "async thread(");

  /*
   * ‎**קונה וליד — בעלות; נכס — היכולת** (ביקורת Codex, P2).
   *
   * ‏רשימות הקונים והלידים מסוננות בבעלות, ולכן תג משרדי עליהן
   * ‏היה מגלה כרטיס של עמית. רשימת הנכסים **משרדית בכוונה**,
   * ‏ו-`getById` מסנן לפי דייר ומחיקה בלבד — ולכן מסנן בעלות
   * ‏כאן היה מסתיר תג לנכס שהסוכן יכול לפתוח, ובכיוון ההפוך
   * ‏מציג תג למי שמודול הנכסים כבוי אצלו.
   */
  it("‏קונה וליד נשלפים עם מסנן בעלות", () => {
    expect(THREAD).toContain('ownershipFilter("buyers.view_all", "ownerUserId")');
    expect(THREAD).toContain("leadOwnershipFilter()");
  });

  it("‏והנכס נבדק ביכולת, כמו מסך הנכס עצמו", () => {
    expect(THREAD).toContain('capabilities.has("properties.view")');
    expect(THREAD).toContain("!canSeeProperties");
    /* ‏ולא במסנן בעלות, שהיה מחמיר מהמסך */
    expect(THREAD).not.toContain('ownershipFilter("properties.view_all"');
  });

  /* ‏ומחוק אינו „נראה”: תג אל כרטיס שנמחק הוא קישור שבור */
  it("‏והמחוקים יוצאים מהשליפה", () => {
    const buyers = THREAD.slice(THREAD.indexOf("tx.buyer.findMany"));
    expect(buyers.slice(0, 300)).toContain("deletedAt: null");
    const properties = THREAD.slice(THREAD.indexOf("tx.property.findMany"));
    expect(properties.slice(0, 300)).toContain("deletedAt: null");
  });

  /*
   * ‎**והתצוגה מותנית בתוצאה, לא רק בקיום התג.** בלי זה השליפה
   * ‏רצה ואיש אינו קורא אותה — הצורה הכי שקטה שבה בדיקת הרשאה
   * ‏מפסיקה להגן.
   */
  it("‏והמיפוי מסנן לפי מה שנראה", () => {
    expect(THREAD).toContain("!visible[card.kind].has(card.id)");
  });

  /* ‏ובלי תגים אין שאילתה נוספת — התיבה נפתחת באותו מחיר */
  it("‏שיחה בלי תגים אינה משלמת בשאילתות", () => {
    expect(THREAD).toContain("buyerIds.length === 0");
    expect(THREAD).toContain("leadIds.length === 0");
    expect(THREAD).toContain("propertyIds.length === 0");
  });
});

/**
 * ‎**מנה עם שני קונים אינה מתויגת.**
 *
 * ‏שלושת הקוראים של `deliver` מקבצים לפי קונה, ולכן „הקונה של
 * ‏השורה הראשונה” נכון היום. „נכון היום” אינו כלל: זו מוסכמה בין
 * ‏שלושה מקומות, ומספיק שאחד ישתנה כדי שהתג יהיה שגוי בשקט.
 * ‏הבדיקה היא שהקוד **בודק** ולא **מניח**.
 */
describe("‏תג הקונה במייל ההצעות", () => {
  const OFFERS = read("../offers/offer-email.service.ts");

  it("‏הקונה נגזר מכל השורות, לא מהראשונה", () => {
    expect(OFFERS).toContain("new Set(rows.map((row) => row.buyerId))");
  });

  it("‏ומנה שאינה מסכימה על קונה אחד יוצאת בלי תג", () => {
    expect(OFFERS).toContain("buyerIds.size === 1");
    expect(OFFERS).toContain("onlyBuyer === undefined ? null :");
  });
});
