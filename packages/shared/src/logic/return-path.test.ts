import { describe, expect, it } from "vitest";
import { safeReturnPath, withQuery } from "./return-path.js";

describe("safeReturnPath", () => {
  it("מקבל את טופס הפגישה", () => {
    expect(safeReturnPath("/calendar/new")).toBe("/calendar/new");
  });

  it("שומר על המזהים שבשאילתה — שם יושב הצד השני של הפגישה", () => {
    const path = "/calendar/new?buyerId=01HZXK4RTM&propertyId=01J0ABCDEF";
    expect(safeReturnPath(path)).toBe(path);
  });

  it("דוחה טקסט חופשי בשאילתה", () => {
    /*
     * הטיוטה עוברת ב-`sessionStorage` ולא כאן. שאילתה מקודדת אינה
     * מזהה, והתרתה הייתה מחזירה בדיוק את הבעיה שהפיצול פתר:
     * הערה בעברית שמנפחת את הכתובת עד שהיא נדחית בשקט.
     */
    expect(safeReturnPath("/calendar/new?notes=%D7%A9%D7%9C%D7%95%D7%9D")).toBeNull();
    expect(safeReturnPath("/calendar/new?time=09%3A30")).toBeNull();
  });

  it("דוחה יעד חיצוני מפורש", () => {
    expect(safeReturnPath("https://evil.example/calendar/new")).toBeNull();
    expect(safeReturnPath("http://evil.example")).toBeNull();
  });

  it("דוחה כתובת ללא סכימה שהדפדפן קורא כדומיין", () => {
    /*
     * ‎`//evil.example` נראה כמו נתיב ואינו כזה: הדפדפן משלים אליו
     * את הפרוטוקול הנוכחי ויוצא מהאתר. זו העקיפה הראשונה שמנסים,
     * ולכן היא בדיקה ולא הערה.
     */
    expect(safeReturnPath("//evil.example/calendar/new")).toBeNull();
    expect(safeReturnPath("/\\evil.example/calendar/new")).toBeNull();
  });

  it("דוחה סכימות שאינן ניווט", () => {
    expect(safeReturnPath("javascript:alert(1)")).toBeNull();
    expect(safeReturnPath("data:text/html,x")).toBeNull();
  });

  it("דוחה מסך פנימי אחר", () => {
    /*
     * זה ההבדל בין רשימת היתר לבין "מתחיל בלוכסן": נתיב פנימי
     * שרירותי מאפשר להנחית מישהו אחרי שמירה על מסך שלא התכוון
     * אליו, עם פרמטרים שנראים כאילו הוא בחר אותם.
     */
    expect(safeReturnPath("/properties/abc/delete")).toBeNull();
    expect(safeReturnPath("/settings?tab=billing")).toBeNull();
    expect(safeReturnPath("/calendar")).toBeNull();
    expect(safeReturnPath("/calendar/new/../../x")).toBeNull();
  });

  it("דוחה תווי בקרה, רווח ועוגן בתוך השאילתה", () => {
    expect(safeReturnPath("/calendar/new?a=1\nSet-Cookie: x=1")).toBeNull();
    expect(safeReturnPath("/calendar/new?a=a b")).toBeNull();
    expect(safeReturnPath("/calendar/new?a=1\u007f")).toBeNull();
    expect(safeReturnPath("/calendar/new#top")).toBeNull();
  });

  it("דוחה ריק ולא-מחרוזת", () => {
    expect(safeReturnPath("")).toBeNull();
    expect(safeReturnPath(null)).toBeNull();
    expect(safeReturnPath(undefined)).toBeNull();
    // מהשאילתה בשרת אותו מפתח פעמיים מגיע כמערך
    expect(safeReturnPath(["/calendar/new", "/calendar/new"])).toBeNull();
  });

  it("דוחה שאילתה ארוכה מדי", () => {
    expect(safeReturnPath(`/calendar/new?buyerId=${"a".repeat(600)}`)).toBeNull();
  });
});

describe("withQuery", () => {
  it("מוסיף שאילתה ראשונה", () => {
    expect(withQuery("/calendar/new", "propertyId", "abc")).toBe(
      "/calendar/new?propertyId=abc",
    );
  });

  it("מצטרף לשאילתה קיימת", () => {
    expect(withQuery("/calendar/new?buyerId=b1", "propertyId", "p1")).toBe(
      "/calendar/new?buyerId=b1&propertyId=p1",
    );
  });

  it("מקודד את הערך", () => {
    expect(withQuery("/x", "q", "תל אביב&y")).toBe(
      "/x?q=%D7%AA%D7%9C%20%D7%90%D7%91%D7%99%D7%91%26y",
    );
  });

  it("משאיר את העוגן בסוף", () => {
    // פרמטר אחרי `#` הוא פרמטר שאיש אינו קורא
    expect(withQuery("/x?a=1#top", "b", "2")).toBe("/x?a=1&b=2#top");
    expect(withQuery("/x#top", "b", "2")).toBe("/x?b=2#top");
  });

  it("התוצאה שלו על טופס הפגישה עוברת את רשימת ההיתר", () => {
    // שתי הפונקציות עובדות בזוג — קישור שנבנה כאן ונדחה שם הוא
    // חזרה שנופלת בשקט לברירת המחדל
    const built = withQuery(
      withQuery("/calendar/new", "buyerId", "01HZXK4RTM"),
      "propertyId",
      "01J0ABCDEF",
    );
    expect(safeReturnPath(built)).toBe(built);
  });
});
