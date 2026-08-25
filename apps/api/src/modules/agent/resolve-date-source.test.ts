import { describe, expect, it } from "vitest";
import { AgentResolveService } from "./resolve.service";
import type { Interpretation } from "./interpret.service";

/**
 * מאיזה טקסט נגזר המועד — **מהמילים שהמודל שמע, לא מהמשפט כולו.**
 *
 * ## מה הייתה הבעיה
 *
 * הזיהוי של „מתי” היה מנוע חוקים שסורק את המשפט המלא ומחפש בו
 * תבניות. כלומר דווקא החלק שדורש הבנת שפה הוצא מידי המודל, וכל
 * ניסוח שהתבניות לא צפו נפל בשקט: „עוד שעה” בלי בי"ת, פיסוק
 * שנדבק למילה, „תתקשר עוד פעם בעוד שעה” שנעצר על המופע הראשון.
 * כל אחד מהם היה דיווח אמיתי, וכל תיקון הוסיף תבנית — מרוץ שאין
 * בו קו סיום, כי אין רשימה סופית של דרכים לומר „מחר”.
 *
 * המנגנון עצמו כבר היה קיים, אבל **לצעדי המשך בלבד**: לכל צעד
 * `dateText` משלו. הפעולה הראשית, השכיחה מכולן, נשארה עם הסריקה
 * החוזרת. כאן היא מקבלת את אותו טיפול.
 *
 * ## והרשת שהושארה מתחת
 *
 * בגרסה הראשונה כאן נשארה סריקת המשפט המלא כ„רשת ביטחון” מתחת
 * ל-`dateText`. זו הייתה סתירה בלב השינוי: הרשת היא בדיוק זיהוי
 * הכללים שהמעבר בא להחליף, והיא דרסה את הכרעת המודל. המשפט המלא
 * נסרק עכשיו רק כשהמודל לא רץ כלל.
 *
 * ## מה **לא** עבר למודל
 *
 * החישוב. „מחר בעשר” ⟵ חותם זמן הוא לוח שנה ואזור זמן, לא שפה,
 * והוא נשאר דטרמיניסטי ובדיק. המודל אומר אילו מילים הן המועד;
 * הקוד אומר איזה רגע הן.
 */

/** שום דבר כאן אינו נוגע במסד — הפתרון של מועד אינו שואל אותו דבר. */
function service(): AgentResolveService {
  return new AgentResolveService(
    { placeVocabulary: async () => [] } as never,
    {} as never,
    {} as never,
  );
}

function interpretation(over: Partial<Interpretation>): Interpretation {
  return {
    actionId: "create_task",
    params: { title: "להתקשר" },
    evidence: {},
    unmapped: [],
    rejected: [],
    fallback: false,
    steps: [],
    ...over,
  };
}

/** השדה שבו יושב המועד של `create_task`, כפי שהכרטיס מציג אותו. */
function dueAt(fields: { key: string; value: string }[]): string | undefined {
  return fields.find((field) => field.key === "dueAt")?.value;
}

describe("מקור המועד של הפעולה הראשית", () => {
  it("מילות המועד שהמודל שמע הן המקור", async () => {
    const proposal = await service().toProposal(
      "תזכיר לי להתקשר לדנה מחר בעשר",
      interpretation({ dateText: "מחר בעשר" }),
    );
    expect(dueAt(proposal.fields)).toBeDefined();
  });

  /*
   * הלב של השינוי: ניסוח שהתבניות אינן מכירות. „ביום שני שאחרי
   * החג” אינו נסרק בהצלחה מהמשפט המלא — אבל המודל יודע לצמצם אותו
   * למילות מועד שהמנוע כן קורא. כאן הוא מחזיר צורה פשוטה, וזה
   * בדיוק התפקיד שלו.
   */
  it("והן גוברות על המשפט, גם כשבמשפט יש מועד אחר", async () => {
    const withModel = await service().toProposal(
      "דיברנו אתמול, תזכיר לי מחר",
      interpretation({ dateText: "עוד שעתיים" }),
    );
    const withRules = await service().toProposal(
      "דיברנו אתמול, תזכיר לי מחר",
      interpretation({ fallback: true }),
    );
    expect(dueAt(withModel.fields)).toBeDefined();
    expect(dueAt(withRules.fields)).toBeDefined();
    expect(dueAt(withModel.fields)).not.toBe(dueAt(withRules.fields));
  });

  /*
   * **השמטה של המודל היא הכרעה, לא כישלון.**
   *
   * „תזכיר לי לשאול אם הפגישה ביום שלישי בוטלה” — „ביום שלישי”
   * מתאר את הפגישה, לא את התזכורת, והמודל צודק כשאינו מוסר מועד.
   * סריקת המשפט המלא כרשת ביטחון קבעה יום שלישי (ביקורת Codex).
   *
   * שתי הבדיקות שכאן החליפו כיוון: הן קיבעו את ההתנהגות ההיא, וזו
   * ההתנהגות שהתבררה כבאג — הרשת שהושארה תחת המודל היא בדיוק
   * זיהוי הכללים שהשינוי בא להחליף.
   */
  it("והשמטה של המודל אינה מזמינה סריקה של המשפט", async () => {
    const proposal = await service().toProposal(
      "תזכיר לי לשאול אם הפגישה ביום שלישי בוטלה",
      interpretation({}),
    );
    expect(dueAt(proposal.fields)).toBeUndefined();
  });

  /*
   * הרצפה הדטרמיניסטית: כשאין מפתח Gemini או שהקריאה נכשלה, מנוע
   * החוקים מכריע ו-`dateText` אינו קיים כלל. סריקת המשפט המלא
   * חייבת להמשיך לעבוד — אחרת השדרוג הזה היה מכבה את המועד בדיוק
   * כשהמודל אינו זמין.
   */
  it("ובלי מילות מועד — המשפט המלא, כמו קודם", async () => {
    const proposal = await service().toProposal(
      "תזכיר לי להתקשר לדנה מחר",
      interpretation({ fallback: true }),
    );
    expect(dueAt(proposal.fields)).toBeDefined();
  });

  /*
   * ואותו כלל גם כשמילות המועד אינן נפתרות. „בקרוב” היא הבנה
   * נכונה שאין ממנה תאריך — אבל המודל כבר אמר בה אילו מילים הן
   * המועד, וסריקת המשפט הייתה אוספת דווקא את אלה שהוציא.
   *
   * שדה ריק שהמתווך ממלא הוא הכישלון הבטוח; תאריך שגוי שנראה
   * כהחלטה הוא המסוכן.
   */
  it("ומילות מועד שאין מהן תאריך משאירות את השדה ריק", async () => {
    const proposal = await service().toProposal(
      "תזכיר לי להתקשר לדנה מחר",
      interpretation({ dateText: "בקרוב" }),
    );
    expect(dueAt(proposal.fields)).toBeUndefined();
  });

  /* ופעולה שאין לה שדה מועד אינה מקבלת אחד רק כי נאמרו מילות זמן */
  it("ופעולה בלי שדה מועד אינה מקבלת אחד", async () => {
    const proposal = await service().toProposal(
      "מה יש לי היום",
      interpretation({ actionId: "add_note", params: { text: "הערה" }, dateText: "מחר" }),
    );
    expect(dueAt(proposal.fields)).toBeUndefined();
  });
});
