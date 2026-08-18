import { describe, expect, it } from "vitest";
import { cleanVocabulary, resolvePlaces } from "./place-vocabulary.js";

const VOCAB = ["בני ברק", "גבעתיים", "תל אביב יפו", "רמת גן"];

describe("resolvePlaces", () => {
  /*
   * המקרה שבגללו המודול קיים: גבעתיים לא הייתה ברשימת הערים הקשיחה,
   * ולכן השאלה "מי מחפש 4 חדרים בגבעתיים" סיננה על חדרים בלבד
   * והחזירה קונים מבני ברק.
   */
  it("שם שקיים במאגר מותאם לערך השמור", () => {
    expect(resolvePlaces(["גבעתיים"], VOCAB)).toEqual({
      matched: ["גבעתיים"],
      unmatched: [],
    });
  });

  it("כתיב שונה מתאים — מקף, גרשיים ורווחים כפולים", () => {
    expect(resolvePlaces(["רמת-גן"], VOCAB).matched).toEqual(["רמת גן"]);
    expect(resolvePlaces(['ת"א'], VOCAB).matched).toEqual(["תל אביב יפו"]);
  });

  /*
   * ההבחנה שבלעדיה אין תשובה כנה: "אין קונים שם" מול "לא ידעתי
   * איפה זה". בלי `unmatched` שתי המצבים נראים כמו רשימה ריקה של
   * `matched`, והקורא היחיד שיכול לבחור בין השתיקה לבין ההודאה הוא
   * מי שיודע מה נאמר.
   */
  it("שם שאינו במאגר חוזר כלא-מותאם ולא כשקט", () => {
    const result = resolvePlaces(["חדרה"], VOCAB);
    expect(result.matched).toEqual([]);
    expect(result.unmatched).toEqual(["חדרה"]);
  });

  it("שמות מרובים — כל אחד נבחן לחוד", () => {
    const result = resolvePlaces(["גבעתיים", "חדרה"], VOCAB);
    expect(result.matched).toEqual(["גבעתיים"]);
    expect(result.unmatched).toEqual(["חדרה"]);
  });

  /*
   * אותה עיר נשמרה בשתי צורות בכרטיסים שונים — מצב רגיל במאגר
   * שהוזן ידנית לאורך זמן. סינון על אחת מהן היה מחמיץ את השנייה.
   */
  it("שם אחד מותאם לכל הצורות השמורות שלו", () => {
    const result = resolvePlaces(["תל אביב"], ["תל אביב", "תל אביב יפו", "תל אביב-יפו"]);
    expect(result.matched).toHaveLength(3);
  });

  it("הכלה מתאימה — שכונה בתוך שם ארוך יותר", () => {
    expect(resolvePlaces(["רמת השרון"], ["רמת השרון מערב"]).matched).toEqual([
      "רמת השרון מערב",
    ]);
  });

  it("קלט ריק אינו מייצר התאמה ואינו מייצר תלונה", () => {
    expect(resolvePlaces(["  "], VOCAB)).toEqual({ matched: [], unmatched: [] });
    expect(resolvePlaces([], VOCAB)).toEqual({ matched: [], unmatched: [] });
  });

  it("מאגר ריק — כל שם חוזר כלא-מותאם", () => {
    expect(resolvePlaces(["גבעתיים"], []).unmatched).toEqual(["גבעתיים"]);
  });
});

describe("cleanVocabulary", () => {
  /*
   * מחרוזת ריקה מתאימה לכל שם ב-`locationNameScore`? לא — אבל היא
   * מזהמת את רשימת המועמדים ומגיעה לשאילתה. הסינון כאן מונע את זה
   * במקום אחד במקום בכל קורא.
   */
  it("מסנן ריקים וכפילויות", () => {
    expect(cleanVocabulary(["בני ברק", "", "  ", "בני ברק"])).toEqual(["בני ברק"]);
  });

  it("שומר את הערך כפי שהוא שמור, בלי לנרמל", () => {
    expect(cleanVocabulary(["רמת-גן"])).toEqual(["רמת-גן"]);
  });
});
