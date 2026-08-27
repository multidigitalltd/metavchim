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
 * ‎**מפתח שהעלאתו נגמרה בלי תשובה מנוקה גם הוא.**
 *
 * התנאי היה `if (uploaded)`, ו-`uploaded` נקבע רק אחרי ש-`put`
 * **חזר**. פסק זמן או תשובה שאבדה משאירים אותו `false` בזמן
 * שהאובייקט עשוי להיות מאוחסן — ואז אין לו שורה במסד, ומחיקת לקוח
 * או משרד לא תמצא אותו לעולם (ביקורת Codex).
 *
 * מחיקת מפתח שאינו קיים אינה עושה דבר, והמפתח נוצר זה עתה ואינו של
 * איש אחר. עלות ניקוי מיותר: אפס. עלות דילוג: קובץ לקוח לנצח.
 */
describe("ניקוי מפתחות אחרי העלאה שנכשלה", () => {
  it("אין דגל שמתנה את הפיצוי בהצלחת ההעלאה", () => {
    expect(SERVICE).not.toContain("uploaded");
  });

  it("שני מסלולי הקבצים מנקים ללא תנאי", () => {
    const calls = SERVICE.match(/await this\.discardOrphan\(s3Key\);/gu) ?? [];
    expect(calls.length, "קליטה ותשובה — שני מסלולים").toBe(2);
    expect(SERVICE).not.toMatch(/if \([^)]*\) await this\.discardOrphan/u);
  });

  it("הפיצוי עצמו אינו יכול להיכשל בקול", () => {
    const discard = method(SERVICE, "private async discardOrphan(");
    expect(discard).toContain("try {");
    expect(discard).toContain("this.logger.error");
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
