import { describe, expect, it } from "vitest";
import { describeProviderResponse } from "./provider-response";

/**
 * שתי דרישות שמושכות לכיוונים הפוכים, ולכן שתיהן נבדקות כאן:
 *
 * 1. **התיאור חייב להועיל** — אחרת חזרנו ל„התשובה לא נקראה”, שהוא
 *    מה שגרם לכתוב את הקובץ הזה.
 * 2. **התיאור אסור שיישא סוד** — כתובת המשיכה נושאת שם משתמש
 *    וסיסמה, וגוף שגיאה של ספק מחזיר לא פעם את הבקשה שקיבל.
 */

const SECRETS = ["office42", "s3cr3t-pass"];

describe("describeProviderResponse — מה שמותר לשמור", () => {
  it("מעטפת שגיאה של הספק נקראת, וזה כל העניין", () => {
    const text = describeProviderResponse(
      { status: "error", message: "recording not found" },
      SECRETS,
    );
    expect(text).toContain("status=error");
    expect(text).toContain("recording not found");
  });

  it("כתובת נמחקת — גם כשהסוד בתוכה ולא מוכר לנו", () => {
    /*
     * זו ההגנה העיקרית: היא אינה תלויה בכך שנזהה את מחרוזת הסוד.
     * ספק שמחזיר את הבקשה שקיבל מחזיר איתה את הפרמטרים.
     */
    const text = describeProviderResponse(
      {
        status: "error",
        message: "bad request: https://www.015pbx.net/api/x?auth_username=office42&auth_password=s3cr3t-pass",
      },
      [],
    );
    expect(text).not.toContain("015pbx.net");
    expect(text).not.toContain("auth_password");
    expect(text).not.toContain("s3cr3t-pass");
    expect(text).toContain("[כתובת]");
  });

  it("הסוד מוחלף גם כשהוא מופיע בלי כתובת סביבו", () => {
    const text = describeProviderResponse(
      { status: "denied", message: "user office42 is not allowed" },
      SECRETS,
    );
    expect(text).not.toContain("office42");
    expect(text).toContain("***");
  });

  it("מפתח שאיננו מכירים מקבל שם וגודל — וזה מה שמבדיל בין השניים", () => {
    /*
     * ‎40 אלף תווים = ההקלטה עצמה תחת שם שלא ציפינו לו.
     * ‎12 תווים = קוד. שני תיקונים שונים לגמרי.
     */
    const big = describeProviderResponse({ audioBlob: "A".repeat(40_000) }, SECRETS);
    expect(big).toContain("audioBlob");
    expect(big).toContain("40000");
    expect(big).not.toContain("AAAA");
  });

  it("ערך של מפתח לא מוכר לעולם אינו מודפס", () => {
    const text = describeProviderResponse({ note: "0501234567 משה כהן" }, SECRETS);
    expect(text).not.toContain("0501234567");
    expect(text).not.toContain("משה");
  });

  it("גם מה שיושב תחת data נסרק", () => {
    const text = describeProviderResponse({ data: { status: "empty", format: "wav" } }, SECRETS);
    expect(text).toContain("data.status=empty");
    expect(text).toContain("data.format=wav");
  });

  it("תשובות שאינן אובייקט מתוארות ולא מושתקות", () => {
    expect(describeProviderResponse(null, SECRETS)).toBe("התשובה ריקה");
    expect(describeProviderResponse("<html>", SECRETS)).toContain("אינה אובייקט");
    expect(describeProviderResponse([1, 2], SECRETS)).toContain("רשימה");
    expect(describeProviderResponse({}, SECRETS)).toContain("ריק");
  });

  it("התיאור חסום ב-200 תווים — כאורך העמודה שבה הוא נשמר", () => {
    /*
     * ‎`provider_recording_detail` הוא `VARCHAR(200)`. תיאור באורך
     * 201 נדחה על ידי PostgreSQL יחד עם סטטוס הכשל שבאותו עדכון,
     * ואז דווקא התשובה הרחבה — זו שבשבילה נכתב האבחון — נשארת
     * בלי שום סימן.
     */
    const wide = Object.fromEntries(
      Array.from({ length: 60 }, (_, i) => [`field${i}`, "x".repeat(50)]),
    );
    expect(describeProviderResponse(wide, SECRETS).length).toBeLessThanOrEqual(200);
  });

  it("גם סוד בן תו אחד מוחלף — אבחון עקר עדיף על סוד שדלף", () => {
    /*
     * היה כאן חריג הפוך: סוד קצר משלושה תווים דולג, כדי שסיסמה בת
     * תו אחד לא תהפוך כל מילה לכוכביות. תצורת המרכזייה אינה כופה
     * אורך מזערי, ולכן החריג הזה היה מדפיס סיסמה אמיתית ליומן.
     */
    const text = describeProviderResponse({ status: "not-found" }, ["o"]);
    expect(text).not.toContain("not-found");
    expect(text).toContain("***");
  });

  it("מחרוזת ריקה ברשימת הסודות אינה מרסקת את הטקסט", () => {
    // split("") מפרק כל תו בנפרד — דילוג עליה הוא נכונות, לא הקלה
    expect(describeProviderResponse({ status: "error" }, [""])).toBe("status=error");
  });
});
