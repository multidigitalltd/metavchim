import { describe, expect, it } from "vitest";
import { AGENT_ACTIONS } from "@metavchim/shared";
import { lookupPhraseKeys } from "./resolve.service";

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
});
