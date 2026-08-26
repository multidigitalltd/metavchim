import { describe, expect, it } from "vitest";
import { PROPERTY_READINESS_FIELDS } from "../schemas/property.js";
import { suggestedPropertyTasks } from "./task-suggestions.js";

describe("suggestedPropertyTasks", () => {
  /*
   * ‎**הכלל היחיד שהאפיון נוקב בו, והבדיקה שקיימת בשבילו.**
   *
   * „Only ever suggest something the record actually lacks. If the
   * price exists, never suggest completing the price.” הצעה להשלים
   * שדה מלא שולחת את המתווך לפתוח כרטיס ולמצוא שם את מה שהמערכת
   * אמרה שחסר — ואחרי פעם אחת כזו כל ההצעות נקראות כרעש.
   */
  it("מציע רק את מה שחסר בפועל", () => {
    const tasks = suggestedPropertyTasks(["images", "owner"]);
    expect(tasks.map((t) => t.field)).toEqual(["images", "owner"]);
  });

  it("כרטיס מלא אינו מייצר הצעות", () => {
    expect(suggestedPropertyTasks([])).toEqual([]);
  });

  /*
   * מתווך שלחץ „הוסף” רואה את המשימה נכנסת לרשימה. אם ההצעה נשארת
   * גם למעלה הוא ילחץ שוב, ויקבל שתי משימות זהות.
   */
  it("הצעה שכבר נפתחה כמשימה אינה חוזרת", () => {
    const first = suggestedPropertyTasks(["images"]);
    expect(first).toHaveLength(1);
    expect(suggestedPropertyTasks(["images"], [first[0]!.title])).toEqual([]);
  });

  it("השוואת הכותרת מתעלמת מרווחים בקצוות", () => {
    const [only] = suggestedPropertyTasks(["rooms"]);
    expect(suggestedPropertyTasks(["rooms"], [`  ${only!.title}  `])).toEqual([]);
  });

  /*
   * הסדר הוא של הרשימה הקנונית ולא של מה שהשרת החזיר, כדי שאותו
   * נכס יציג את אותן הצעות באותו סדר בכל טעינה.
   */
  it("הסדר קבוע, ואינו תלוי בסדר שהגיע", () => {
    const forward = suggestedPropertyTasks(["owner", "priceAgorot", "images"]);
    const reversed = suggestedPropertyTasks(["images", "priceAgorot", "owner"]);
    expect(forward.map((t) => t.field)).toEqual(reversed.map((t) => t.field));
    expect(forward[0]?.field).toBe("priceAgorot");
  });

  /*
   * ‎**שער על השלמות.** שדה מוכנות שיתווסף ולא יקבל ניסוח היה נשמט
   * מההצעות בשקט — כלומר נראה כאילו הוא לעולם אינו חסר. הטיפוס
   * מפיל את הקומפילציה, והבדיקה הזו מוודאת שהמפה באמת מכסה את
   * כולם גם בזמן ריצה.
   */
  it("לכל שדה מוכנות יש הצעה — בלי יוצא מן הכלל", () => {
    const all = suggestedPropertyTasks([...PROPERTY_READINESS_FIELDS]);
    expect(all).toHaveLength(PROPERTY_READINESS_FIELDS.length);
    for (const task of all) {
      expect(task.title.trim()).not.toBe("");
      expect(task.reason.trim()).not.toBe("");
      /* פעולה ולא תווית — „מחיר” אינו משימה */
      expect(task.title).not.toBe(task.field);
    }
  });

  it("שדה שאינו שדה מוכנות מתעלמים ממנו ולא נופלים עליו", () => {
    expect(suggestedPropertyTasks(["somethingElse", "images"]).map((t) => t.field)).toEqual([
      "images",
    ]);
  });
});
