import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NETWORK_DISCLOSURE, disclosureColumns } from "@metavchim/shared";
import { describe, expect, it } from "vitest";

/**
 * ‎**„זה מה שנחשף” — נבדק מול הסכימה, לא מול הזיכרון.**
 *
 * הפאנל בכרטיס הנכס ובכרטיס הקונה מציג שתי רשימות: מה משרד אחר
 * רואה, ומה נשאר. זו ההצהרה היחידה במערכת על מידע שחוצה את גבול
 * הדייר, והיא נקראת בדיוק ברגע שבו מתווך מחליט אם ללחוץ.
 *
 * ‎**למה בדיקה ולא הערה.** ‎`snapshot()` ב-`listings.service.ts`
 * מחזיר ‎`Omit<Prisma.SharedListingUncheckedCreateInput, …>`, וכל
 * שדותיו של הטיפוס הזה אופציונליים — כלומר עמודה חדשה בטבלה
 * המשותפת **אינה** מפילה את הקומפילציה. בלי הבדיקה הזו אפשר להוסיף
 * שדה, לפרסם אותו לרשת, והמסך ימשיך להציג את אותם צ'יפים בדיוק:
 * פאנל שמבטיח „זה הכול” ואינו יודע על שדה חדש גרוע ממסך בלי פאנל.
 *
 * שלוש טענות, וכל אחת מהן יכולה להיכשל לבדה:
 *
 * ‎**1 · כיסוי מלא, בשני הכיוונים.** כל עמודה בטבלה המשותפת מופיעה
 * או בצ'יפ ירוק או ברשימת התשתית — ואין ברשימות עמודה שאינה קיימת.
 * הכיוון השני חשוב לא פחות: עמודה שנמחקה מהסכימה משאירה צ'יפ
 * שמבטיח שדה שכבר אינו מתפרסם.
 *
 * ‎**2 · המוסתר באמת אינו שם.** „הכתובת נשארת אצלכם” שווה בדיוק כמה
 * שהיא נבדקת. אם `street` יופיע אי-פעם בטבלה המשותפת, זו הבדיקה
 * שתיפול.
 *
 * ‎**3 · המוסתר קיים במקור.** עמודה שנמחקה או שונתה בטבלת המקור
 * הופכת את ההבטחה לחסרת מובן — היא מבטיחה על שדה שאינו קיים, ולכן
 * לעולם לא תיפול על גילוי.
 *
 * ‎**מה הבדיקה הזו אינה עושה.** היא אינה מריצה שאילתה ואינה בודקת
 * שהערך שנכתב בפועל תואם לעמודה. היא בדיקה מבנית — באותו דפוס של
 * ‎`suggestion-identity` ו-`tenant-purge-coverage` — ומטרתה למנוע
 * סחיפה שקטה בין ההצהרה לסכימה.
 */

const SCHEMA = readFileSync(
  join(import.meta.dirname, "..", "..", "..", "prisma", "schema.prisma"),
  "utf8",
);

/** שמות העמודות של מודל אחד ב-`schema.prisma`. */
function columnsOf(model: string): string[] {
  const body = new RegExp(String.raw`^model ${model} \{([\s\S]*?)^\}`, "mu").exec(SCHEMA)?.[1];
  if (body === undefined) throw new Error(`מודל ${model} לא נמצא בסכימה`);
  const columns: string[] = [];
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    /* הערות, בלוקים ברמת המודל, ושורות ריקות אינן עמודות */
    if (line === "" || line.startsWith("//") || line.startsWith("@@") || line.startsWith("*")) {
      continue;
    }
    const name = line.split(/\s+/u)[0];
    if (name === undefined || name.startsWith("@") || name.startsWith("/")) continue;
    columns.push(name);
  }
  return columns;
}

/**
 * שדות יחס של Prisma — אינם עמודות במסד ואינם מידע שמתפרסם.
 *
 * ‎`Property` נושא `tenant` ו-`media`, שהם ניווט בין טבלאות. שער
 * שהיה דורש גם מהם סיווג היה מלמד להוסיף שמות לרשימה כדי להשתיק
 * אותו, וזה ההרגל שהורג שערים.
 */
const RELATION_FIELDS = new Set(["tenant", "media"]);

describe("הצהרת החשיפה לרשת — מול הסכימה", () => {
  it("שליפת העמודות עובדת, אחרת כל השאר משווה רשימות ריקות", () => {
    /*
     * שער על הבדיקה עצמה. שינוי בפורמט הסכימה היה מרוקן את
     * ‎`columnsOf`, וכל ההשוואות למטה היו הופכות ל-`[] ⊆ []` —
     * בדיקה שעוברת תמיד. זה כבר קרה בבדיקה מבנית אחרת כאן.
     */
    expect(columnsOf("SharedListing")).toContain("photoKeys");
    expect(columnsOf("Property")).toContain("street");
    expect(columnsOf("Buyer")).toContain("contactId");
  });

  for (const [kind, disclosure] of Object.entries(NETWORK_DISCLOSURE)) {
    describe(kind, () => {
      const shared = columnsOf(disclosure.sharedTable).filter((c) => !RELATION_FIELDS.has(c));
      const origin = columnsOf(disclosure.originTable).filter((c) => !RELATION_FIELDS.has(c));
      const shown = disclosureColumns(disclosure.shown);

      it("כל עמודה בטבלה המשותפת מסווגת — או צ'יפ, או תשתית", () => {
        const classified = new Set([...shown, ...disclosure.nonFactColumns]);
        expect(shared.filter((c) => !classified.has(c))).toEqual([]);
      });

      it("ואין סיווג לעמודה שאינה קיימת", () => {
        const present = new Set(shared);
        const stale = [...shown, ...disclosure.nonFactColumns].filter((c) => !present.has(c));
        expect(stale).toEqual([]);
      });

      it("אותה עמודה אינה גם צ'יפ וגם תשתית", () => {
        const infra = new Set(disclosure.nonFactColumns);
        expect(shown.filter((c) => infra.has(c))).toEqual([]);
      });

      /*
       * ‎**זו הטענה שהמתווך מסתמך עליה.** כל השאר הוא שלמות; זו
       * ההבטחה עצמה.
       */
      it("מה שהוצהר כמוסתר באמת אינו בטבלה המשותפת", () => {
        const present = new Set(shared);
        const leaked = disclosureColumns(disclosure.hidden).filter((c) => present.has(c));
        expect(leaked).toEqual([]);
      });

      it("ומה שהוצהר כמוסתר קיים בטבלת המקור", () => {
        const present = new Set(origin);
        const phantom = disclosureColumns(disclosure.hidden).filter((c) => !present.has(c));
        expect(phantom).toEqual([]);
      });

      it("לכל צ'יפ יש תווית ולפחות עמודה אחת", () => {
        for (const chip of [...disclosure.shown, ...disclosure.hidden]) {
          expect(chip.label.trim()).not.toBe("");
          expect(chip.columns.length).toBeGreaterThan(0);
        }
      });

      /*
       * המסך ממפתח את הרשימות בתווית. תווית כפולה אינה רק אזהרת
       * ‎React — היא שתי שורות שנראות זהות ברשימה שכל תפקידה למנות
       * מה נחשף.
       */
      it("אין שתי תוויות זהות באותה רשימה", () => {
        for (const list of [disclosure.shown, disclosure.hidden]) {
          const labels = list.map((chip) => chip.label);
          expect(labels).toEqual([...new Set(labels)]);
        }
      });

      /*
       * ‎**אותה עמודה אינה נחשפת וגם מוסתרת.** שתי הרשימות מדברות על
       * טבלאות שונות, ולכן חפיפה כזו לא תיתפס באף אחת מהבדיקות
       * שלמעלה — היא פשוט תוצג כשתי הבטחות סותרות באותו פאנל.
       */
      it("אין עמודה שמופיעה גם כנחשפת וגם כמוסתרת", () => {
        const hidden = new Set(disclosureColumns(disclosure.hidden));
        expect(shown.filter((c) => hidden.has(c))).toEqual([]);
      });
    });
  }
});
