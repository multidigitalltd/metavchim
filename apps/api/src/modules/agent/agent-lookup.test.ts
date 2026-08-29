import { describe, expect, it } from "vitest";
import { AGENT_ACTIONS, AGENT_ID_KEYS } from "@metavchim/shared";
import { lookupIdKeys, lookupPhraseKeys } from "./resolve.service";

/**
 * ‎**ביטוי מוצהר שאין מי שיפתור אותו — התקלה שחזרה שלוש פעמים.**
 *
 * קטלוג הפעולות מצהיר על שדות `…Phrase` („איזה לקוח”, „איזה נכס”),
 * והביצוע קורא `…Id`. מי שמתרגם ביניהם הוא `ENTITY_LOOKUP`, והוא
 * טבלה **נפרדת** שאיש אינו מחויב לעדכן. פעולה שנוספה בלי רשומה בה
 * לא נכשלת ואינה מתריעה: המודל ממלא את הביטוי, הכרטיס מציג אותו,
 * המתווך מאשר — והביצוע מוצא `undefined` וממשיך בלי הרשומה.
 *
 * ‎**התסמין הוא הגרוע מכולם: תשובה מלאה על שאלה אחרת.**
 *
 * - ‎`send_offer` ניווט תמיד לכרטיס הקונה גם כשנאמר נכס מפורש.
 * - ‎`schedule_appointment` יצרה כל פגישה בלי לקוח ובלי נכס.
 * - ‎`show_matches` החזירה את ההתאמות של כל המשרד על „מה מתאים
 *   למשה כהן”.
 *
 * שלושתן התגלו בקריאה ולא בבדיקה, ולכן הבדיקה הזו עוברת על **כל**
 * הקטלוג ואינה יכולה להתיישן.
 */
describe("ביטוי מזהה ⟵ רשומה", () => {
  const withPhrases = AGENT_ACTIONS.map((action) => ({
    id: action.id,
    phrases: action.fields.filter((f) => f.key.endsWith("Phrase")).map((f) => f.key),
  })).filter((a) => a.phrases.length > 0);

  it("יש בקטלוג פעולות עם ביטוי מזהה — אחרת הבדיקה ריקה", () => {
    expect(withPhrases.length).toBeGreaterThan(0);
  });

  it.each(withPhrases.map((a) => [a.id, a.phrases] as const))(
    "%s — כל ביטוי שהיא מצהירה עליו נפתר",
    (actionId, phrases) => {
      const resolved = lookupPhraseKeys(actionId);
      expect([...phrases].sort()).toEqual([...resolved].sort());
    },
  );

  /*
   * הצד השני: הטבלה אינה פותרת ביטוי שהפעולה אינה מצהירה עליו.
   * רשומה על מפתח שאינו בקטלוג לעולם לא תמצא ערך — היא נראית כמו
   * כיסוי ואינה עושה דבר.
   */
  it("אין רשומה לביטוי שאינו בקטלוג", () => {
    for (const action of AGENT_ACTIONS) {
      const declared = new Set(action.fields.map((f) => f.key));
      for (const key of lookupPhraseKeys(action.id)) {
        expect(declared.has(key), `${action.id}.${key}`).toBe(true);
      }
    }
  });

  it("פעולה בלי ביטוי מזהה אינה מקבלת רשומה", () => {
    expect(lookupPhraseKeys("office_report")).toEqual([]);
  });

  /*
   * ‎**והמזהה שנכתב — שורד עד הביצוע.**
   *
   * הביטוי נפתר, המזהה נכתב לפרמטרים, ואז צמצום הפרמטרים מוחק
   * אותו: הצמצום שומר שדות קטלוג ואת `AGENT_ID_KEYS` בלבד, ומזהה
   * שאינו באף אחד מהם נעלם בין הבחירה שהמתווך עשה לביצוע — בשני
   * הערוצים ובשקט. כך בדיוק `approachId` הפיל את „פתח חדר עסקה”
   * מיד אחרי הבחירה (ביקורת Codex): הבחירה נשמרה, האישור התקבל,
   * והביצוע קיבל רק את הביטוי.
   */
  it("כל מזהה שהטבלה כותבת שורד את צמצום הפרמטרים", () => {
    const allowed = new Set<string>(AGENT_ID_KEYS);
    for (const action of AGENT_ACTIONS) {
      const declared = new Set(action.fields.map((f) => f.key));
      for (const key of lookupIdKeys(action.id)) {
        expect(
          allowed.has(key) || declared.has(key),
          `${action.id}.${key} — לא בקטלוג ולא ב-AGENT_ID_KEYS`,
        ).toBe(true);
      }
    }
  });
});
