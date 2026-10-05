import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ‎**שיחת המנטור היא של המתווך, לא של המשרד.**
 *
 * ## ‏למה שער ולא בדיקה נקודתית
 *
 * ‏‎RLS עוצר משרד מלראות משרד אחר, וזה כל מה שהוא עושה: `tenant_id`
 * ‏הוא העמודה שהפוליסה מכירה. ההפרדה **בין סוכנים באותו משרד** אינה
 * ‏קיימת במסד כלל — היא נשענת על כך שכל שאילתה על `mentor_messages`
 * ‏מסננת גם על `userId`, ואם אחת תשכח, הפוליסה תאשר אותה.
 *
 * ‏מה שנחשף אינו „מטא-דאטה”: השיחה עם המנטור היא המקום שבו מתווך
 * ‏כותב שהוא נתקע, שהחודש חלש, שהוא שוקל לעזוב. עמית שקורא אותה
 * ‏קורא בדיוק את מה שאיש אינו כותב כשהוא יודע שקוראים.
 *
 * ‏שתי הפעולות שנוספו עכשיו — דירוג ונעיצה — הן **כתיבה** על שורה
 * ‏לפי מזהה שמגיע מבחוץ. בלי `userId` ב-`where` הן היו הופכות מזהה
 * ‏מנוחש לעריכה של הודעה של מישהו אחר. לכן הן, ובעיקר הן, נמנות כאן.
 *
 * ## ‏מה השער מבטיח — ומה לא
 *
 * ‎**מבטיח:** כל שאילתה על `mentorMessage` בקובץ השירות מסננת על
 * ‎`userId`. שאילתה חדשה שתישכח מפילה את ה-CI, וזו בדיוק הדרך שבה
 * ‏פער כזה נולד — לא כרגרסיה, אלא כשאילתה שנכתבה לפי הדפוס הלא נכון.
 *
 * ‎**אינו מבטיח:** שהערך ב-`userId` הוא של המשתמש המחובר. הוא מגיע
 * ‎מ-`TenantContext.current()` בכל אחד מהמקומות, וזו הנחה שהשער
 * ‏אינו בודק. תיל מתיחה לשאילתה חדשה, לא הוכחה לקיימות.
 */

const SERVICE = join(
  import.meta.dirname,
  "..",
  "modules",
  "mentor",
  "mentor.service.ts",
);

/**
 * ‏כל קריאה ל-`tx.mentorMessage.<פעולה>(...)` והארגומנט שלה, לפי
 * ‏ספירת סוגריים — ולא לפי מספר שורות קבוע, שהיה חותך שאילתה ארוכה
 * ‏באמצע ומכריז עליה כתקינה.
 */
function mentorMessageCalls(source: string): { op: string; body: string }[] {
  const calls: { op: string; body: string }[] = [];
  const re = /\bmentorMessage\.(\w+)\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (ch === "(") depth += 1;
      else if (ch === ")") depth -= 1;
      i += 1;
    }
    calls.push({ op: m[1]!, body: source.slice(re.lastIndex, i - 1) });
  }
  return calls;
}

describe("שיחת המנטור מסוננת למתווך שכתב אותה", () => {
  const source = readFileSync(SERVICE, "utf8");
  const calls = mentorMessageCalls(source);

  it("יש מה לבדוק — הסריקה מוצאת את השאילתות", () => {
    /*
     * ‏שער שסורק ואינו מוצא דבר עובר תמיד. שינוי שם המודל או מעבר
     * ‏ל-`$queryRaw` היה מרוקן את הרשימה בשקט, והשער היה ממשיך
     * ‏להכריז „ירוק” על קוד שאינו נבדק כלל.
     */
    expect(calls.length).toBeGreaterThanOrEqual(10);
  });

  it.each(["updateMany", "findMany", "findFirst", "groupBy", "count", "create"])(
    "כל %s על הודעות המנטור נושא userId",
    (op) => {
      const ofOp = calls.filter((c) => c.op === op);
      expect(ofOp.length).toBeGreaterThan(0);
      for (const call of ofOp) {
        expect(call.body).toContain("userId");
      }
    },
  );

  it("אין שאילתה שנשארה בלי userId", () => {
    const missing = calls.filter((c) => !c.body.includes("userId")).map((c) => c.op);
    expect(missing).toEqual([]);
  });

  /*
   * ‏שתי הכתיבות לפי מזהה חיצוני נבדקות בנפרד: הן היחידות שבהן
   * ‏מזהה שהגיע מהרשת נכנס ישירות ל-`where`, ולכן הן היחידות שבהן
   * ‏שכחה אינה „ראיית יותר מדי” אלא **עריכה** של הודעה של עמית.
   */
  it("דירוג ונעיצה מסננים על userId, ולא רק על מזהה ההודעה", () => {
    const writes = calls.filter(
      (c) => c.op === "updateMany" && c.body.includes("where: { id,"),
    );
    expect(writes).toHaveLength(2);
    for (const w of writes) {
      expect(w.body).toContain("tenantId");
      expect(w.body).toContain("userId");
    }
  });

  /* ‏רק תשובת המנטור ניתנת לדירוג — דירוג של השאלה שלך אינו אומר דבר */
  it("הדירוג חל על תשובת המנטור בלבד", () => {
    const rate = calls.find(
      (c) => c.op === "updateMany" && c.body.includes("feedback: verdict"),
    );
    expect(rate).toBeDefined();
    expect(rate!.body).toContain('role: "mentor"');
  });
});
