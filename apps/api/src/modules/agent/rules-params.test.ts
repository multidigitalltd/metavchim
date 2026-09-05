import { describe, expect, it } from "vitest";
import { AgentInterpretService } from "./interpret.service";

/**
 * ‎**מה שהרצפה מחלצת, ולא רק לאן היא מנתבת.**
 *
 * ## התקלה שהבדיקות האלה נולדו ממנה
 *
 * הרחבת הרצפה מיפתה עשרים פעולות קריאה חדשות, והבדיקות בדקו
 * ‎**מזהה פעולה בלבד**. שלוש תקלות עברו מתחת לזה, וכולן אותו דבר:
 * הניתוב עבד והשדות לא מולאו.
 *
 * ‎`show_card` ו-`play_recording` דורשות `cardPhrase`, ואיש לא ייצר
 * אותו — הן נותבו יפה ואז נתקעו על „לא נאמר על מי מדובר”. „איפה
 * הכרטיס של יוסי” אף **נסוג**: קודם הוא נפל לחיפוש חופשי, שדווקא
 * עבד. ו„אילו לידים **חדשים**” החזיר את כל הלידים הפתוחים, כי
 * המסנן שנאמר במפורש נזרק בדרך (ביקורת Codex).
 *
 * ## למה קריאה ישירה למתודה
 *
 * ‎`rulesParams` אינה נוגעת בשום תלות — לא במודל ולא ביומן — ולכן
 * אפשר לבחון אותה כפונקציה. בדיקה שעוברת דרך `interpret` הייתה
 * דורשת הקשר דייר וספק מזויף, ומודדת בעיקר את הפיגומים.
 */

type WithRules = {
  rulesParams(actionId: string, transcript: string, query?: string): Record<string, unknown>;
};

const params = (actionId: string, transcript: string): Record<string, unknown> =>
  (
    new AgentInterpretService(null as never, null as never) as unknown as WithRules
  ).rulesParams(actionId, transcript);

describe("מה שהרצפה מחלצת", () => {
  /*
   * בלי `cardPhrase` הפעולה מנותבת ואז חסומה — קיר מנומס במקום
   * ההסבר על התקלה, ובמקרה של „איפה הכרטיס של” גם נסיגה מהתנהגות
   * שעבדה.
   */
  it("„הכרטיס של” ⟵ שם הלקוח", () => {
    expect(params("show_card", "איפה הכרטיס של יוסי")["cardPhrase"]).toBe("יוסי");
    expect(params("show_card", "תראה לי את הכרטיס של שרה לוי")["cardPhrase"]).toBe("שרה לוי");
  });

  it("„ההקלטה של” ⟵ שם הלקוח", () => {
    expect(params("play_recording", "תשמיע לי את ההקלטה של דנה")["cardPhrase"]).toBe("דנה");
  });

  /*
   * ‎**מסנן שנאמר במפורש אינו נזרק.** תשובה רחבה מהשאלה אינה
   * נראית שבורה — היא רק שגויה.
   */
  it("„לידים חדשים” ⟵ סטטוס חדש, ולא כל הלידים", () => {
    expect(params("show_leads", "אילו לידים חדשים יש")["leadStatus"]).toBe("new");
    expect(params("show_leads", "הלידים בטיפול")["leadStatus"]).toBe("in_progress");
    expect(params("show_leads", "לידים שממתינים ללקוח")["leadStatus"]).toBe("waiting_customer");
  });

  /* „הלידים שלי” בלי מסנן — רשימה מלאה, וזה נכון */
  it("בלי מסנן שנאמר — אין מסנן מומצא", () => {
    expect(params("show_leads", "הלידים שלי")["leadStatus"]).toBeUndefined();
    expect(params("show_offers", "ההצעות שלי")["offerFilter"]).toBeUndefined();
  });

  it("„ההצעות הממתינות” ⟵ מסנן ממתינות", () => {
    expect(params("show_offers", "ההצעות הממתינות")["offerFilter"]).toBe("waiting");
    expect(params("show_offers", "הצעות שנפתחו ולא נענו")["offerFilter"]).toBe("opened_no_reply");
    expect(params("show_offers", "הצעות שהשליחה שלהן נכשלה")["offerFilter"]).toBe("failed");
  });

  /*
   * שאלות קריאה בלי שדות אינן מקבלות את חילוץ האדם הכללי — ערך
   * מומצא בשדה שלא נאמר גרוע מריק.
   */
  it("שאלה בלי שדות אינה אוספת ערכים מהמשפט", () => {
    expect(params("show_tasks", "מה המשימות שלי להיום")).toEqual({});
  });
});

describe("מה שהרצפה מחלצת — המנטור", () => {
  it("שאלה למנטור: ‎`question` הוא המשפט בלי מילות הפנייה", () => {
    expect(params("mentor_ask", "מנטור, מה כדאי לי לשפר?")).toEqual({
      question: "מה כדאי לי לשפר?",
    });
    expect(params("mentor_ask", "תשאל את המנטור למה ההצעות נתקעות")).toEqual({
      question: "למה ההצעות נתקעות",
    });
  });
});
