import { describe, expect, it } from "vitest";
import {
  formatPropertyAddress,
  normalizeHouseNumber,
  propertyAddressOr,
} from "./property-address";

describe("כתובת נכס", () => {
  it("מספר הבית נצמד לרחוב, והשאר בפסיקים", () => {
    expect(
      formatPropertyAddress({
        street: "אחוזה",
        houseNumber: "5",
        neighborhood: "נווה זמר",
        city: "רעננה",
      }),
    ).toBe("אחוזה 5, נווה זמר, רעננה");
  });

  /*
   * ‏זה המקרה שהמשתמש דיווח עליו: המספר קיים במסד ולא הופיע בשום
   * ‏מקום, כי כל מסך הרכיב `street` ו-`city` בלבד.
   */
  it("בלי מספר — הכתובת כמו שהייתה", () => {
    expect(formatPropertyAddress({ street: "אחוזה", city: "רעננה" })).toBe("אחוזה, רעננה");
  });

  /*
   * ‏מספר בלי רחוב נראה כאילו הוא אומר משהו, ואינו אומר דבר.
   * ‏„5, רעננה” גרוע מ„רעננה”.
   */
  it("מספר בלי רחוב מושמט", () => {
    expect(formatPropertyAddress({ houseNumber: "5", city: "רעננה" })).toBe("רעננה");
  });

  it("רווחים בלבד נחשבים כריק", () => {
    expect(formatPropertyAddress({ street: "  ", houseNumber: " ", city: "רעננה" })).toBe(
      "רעננה",
    );
  });

  it("null ו-undefined מטופלים כמו ריק", () => {
    expect(formatPropertyAddress({ street: null, houseNumber: undefined, city: "חיפה" })).toBe(
      "חיפה",
    );
  });

  it("נכס בלי כתובת כלל — מחרוזת ריקה, והחלופה נבחרת במסך", () => {
    expect(formatPropertyAddress({})).toBe("");
    expect(propertyAddressOr({}, "ללא כתובת")).toBe("ללא כתובת");
    expect(propertyAddressOr({ city: "אילת" }, "ללא כתובת")).toBe("אילת");
  });
});

describe("normalizeHouseNumber — שלם, בלי שארית אפס", () => {
  /*
   * ‏בניין מספר 5 הוצג „5.0” בשדה, בכרטיס ובפירורי הלחם (דיווח
   * ‏מהשטח). `houseNumber` הוא מחרוזת, ולכן זה מה שבאמת נשמר —
   * ‏לא בעיית תצוגה. המקור הוא ייבוא מגיליון שמחזיק את העמודה
   * ‏כמספר.
   */
  it("שארית אפס יורדת", () => {
    expect(normalizeHouseNumber("5.0")).toBe("5");
    expect(normalizeHouseNumber("12.00")).toBe("12");
    expect(normalizeHouseNumber(" 7.0 ")).toBe("7");
  });

  /*
   * ‎**כל רווח לבן, ולא רק תו הרווח.**
   *
   * ‏המיגרציה שמנקה את השורות הקיימות חייבת לתפוס בדיוק
   * ‏את מה שהכלל כאן תופס, אחרת נותרות שורות שממשיכות
   * ‏להציג „9.0” עד השמירה הבאה. טאב ושבירת שורה היו המקרה
   * ‏שבו `btrim` של Postgres ו-`trim` של JavaScript נפרדו.
   */
  it("טאב ושבירת שורה נגזרים כמו רווח", () => {
    expect(normalizeHouseNumber("\t9.0")).toBe("9");
    expect(normalizeHouseNumber("3.0\n")).toBe("3");
    expect(normalizeHouseNumber("\r 21.000 \t")).toBe("21");
  });

  /*
   * ‎**וכל השאר אינו נגוע.** מספרי בית בישראל אינם מספרים, וזה
   * ‏בדיוק מה שנרמול גס הורס: „5א” הוא כניסה אחרת מ„5”.
   */
  it("שארית שאינה אפס, ואות או מפריד — נשארים כמו שהם", () => {
    expect(normalizeHouseNumber("5.5")).toBe("5.5");
    expect(normalizeHouseNumber("5א")).toBe("5א");
    expect(normalizeHouseNumber("12/2")).toBe("12/2");
    expect(normalizeHouseNumber("7-9")).toBe("7-9");
    expect(normalizeHouseNumber("ב׳")).toBe("ב׳");
    expect(normalizeHouseNumber("")).toBe("");
  });

  /* הכתובת שנבנית ממנו היא מה שהמתווך והלקוח רואים בפועל */
  it("הכתובת המלאה נקייה מהשארית", () => {
    expect(
      formatPropertyAddress({
        street: "אליעזר",
        houseNumber: normalizeHouseNumber("5.0"),
        neighborhood: "מרכז",
        city: "בני ברק",
      }),
    ).toBe("אליעזר 5, מרכז, בני ברק");
  });
});
