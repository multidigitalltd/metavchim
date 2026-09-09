import { describe, expect, it } from "vitest";
import {
  parseCsvLine,
  parsePropertiesCsv,
  parseRecruitmentCsv,
  parseShekelsToAgorot,
  parseYesNo,
  PROPERTY_TYPE_MAP,
  propertyTypeFromCsv,
  propertyTypesForTerm,
} from "./csv-import.js";
import { decodeImportBytes } from "./import-encoding.js";

describe("parseShekelsToAgorot", () => {
  it("שומר על נקודה עשרונית ומפריד אלפים", () => {
    expect(parseShekelsToAgorot("6,000.00")).toBe(600_000); // 6,000₪
    expect(parseShekelsToAgorot("2,650,000")).toBe(265_000_000);
    expect(parseShekelsToAgorot("₪ 1,234.5")).toBe(123_450);
    expect(parseShekelsToAgorot("2650000")).toBe(265_000_000);
  });

  it("דוחה ערכים לא מספריים או אפס — עדיף לדלג מלייבא סכום שגוי", () => {
    expect(parseShekelsToAgorot("אין")).toBeUndefined();
    expect(parseShekelsToAgorot("0")).toBeUndefined();
    expect(parseShekelsToAgorot("1.234.567")).toBeUndefined();
  });
});

describe("parseCsvLine", () => {
  it("מפרק פסיקים פשוטים", () => {
    expect(parseCsvLine("בני ברק,רבי עקיבא,4")).toEqual(["בני ברק", "רבי עקיבא", "4"]);
  });

  it("תומך בגרשיים עם פסיק בתוך שדה", () => {
    expect(parseCsvLine('"דירה, משופצת",100')).toEqual(["דירה, משופצת", "100"]);
  });
});

describe("parsePropertiesCsv", () => {
  it("ממפה כותרות עבריות ומחלץ נכסים", () => {
    const csv = [
      "עיר,שכונה,רחוב,חדרים,מחיר,סוג",
      "בני ברק,פרדס כץ,רבי עקיבא,4,2650000,דירה",
      "ירושלים,רמות,הרב שך,3.5,3200000,דירת גן",
    ].join("\n");
    const { rows } = parsePropertiesCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.fields.city).toBe("בני ברק");
    expect(rows[0]?.fields.rooms).toBe(4);
    expect(rows[0]?.fields.priceAgorot).toBe(265_000_000); // ₪→אגורות
    expect(rows[0]?.fields.propertyType).toBe("apartment");
    expect(rows[0]?.fields.dealType).toBe("sale"); // נגזר מהמחיר
    expect(rows[1]?.fields.rooms).toBe(3.5);
    expect(rows[1]?.fields.propertyType).toBe("garden_apartment");
  });

  it("מדווח על כותרות לא מזוהות", () => {
    const { unmappedHeaders } = parsePropertiesCsv("עיר,בלגן,מחיר\nחיפה,x,100");
    expect(unmappedHeaders).toContain("בלגן");
  });

  it("CSV ריק ⇒ אפס שורות", () => {
    expect(parsePropertiesCsv("").rows).toHaveLength(0);
    expect(parsePropertiesCsv("עיר,מחיר").rows).toHaveLength(0); // רק כותרת
  });

  it("שדות ריקים בשורה מדולגים בלי קריסה", () => {
    const { rows } = parsePropertiesCsv("עיר,חדרים,מחיר\nחיפה,,");
    expect(rows[0]?.fields.city).toBe("חיפה");
    expect(rows[0]?.fields.rooms).toBeUndefined();
  });
});

/**
 * ההרחבה הגדולה של מפת הכותרות — הסיבה שהייבוא "לא עבד מספיק טוב":
 * גיליון אמיתי מדבר על כתובת, סוג עסקה, מעלית ובעל הנכס, והמפה
 * הישנה הכירה תשע כותרות בלבד. כל עמודה כזו נזרקה בשקט.
 */
describe("parsePropertiesCsv — הכותרות המורחבות", () => {
  it("כתובת מלאה מתפצלת לרחוב ומספר בית", () => {
    const csv = ["כתובת,עיר,חדרים", "רבי עקיבא 10,בני ברק,4"].join("\n");
    const { rows, unmappedHeaders } = parsePropertiesCsv(csv);
    expect(unmappedHeaders).toEqual([]);
    expect(rows[0]?.fields).toMatchObject({
      street: "רבי עקיבא",
      houseNumber: "10",
      city: "בני ברק",
      rooms: 4,
    });
  });

  it("סוג עסקה, מצב ומאפיינים בכן/לא", () => {
    const csv = [
      "עיר,סוג עסקה,מצב,מעלית,חניה,ממד,מחסן",
      "רמת גן,השכרה,משופץ,כן,יש,לא,אין",
    ].join("\n");
    const { rows } = parsePropertiesCsv(csv);
    expect(rows[0]?.fields).toMatchObject({
      dealType: "rent",
      condition: "renovated",
      hasElevator: true,
      hasParking: true,
      hasSafeRoom: false,
      hasStorage: false,
    });
  });

  it("בעל הנכס, תיאור והערות פנימיות", () => {
    const csv = [
      "עיר,בעל הנכס,טלפון בעלים,תיאור,הערות",
      'חולון,ישראל ישראלי,050-1234567,"נוף פתוח","המפתח אצל השכן"',
    ].join("\n");
    const { rows } = parsePropertiesCsv(csv);
    expect(rows[0]).toMatchObject({
      ownerName: "ישראל ישראלי",
      ownerPhone: "+972501234567",
      marketingDescription: "נוף פתוח",
      internalNotes: "המפתח אצל השכן",
    });
  });

  it("כותרות באנגלית ועם רעש (כוכבית, מרכאות, אותיות גדולות)", () => {
    const csv = ['City,"*Rooms",PRICE', "חיפה,3.5,1200000"].join("\n");
    const { rows, unmappedHeaders } = parsePropertiesCsv(csv);
    expect(unmappedHeaders).toEqual([]);
    expect(rows[0]?.fields).toMatchObject({ city: "חיפה", rooms: 3.5, priceAgorot: 120_000_000 });
  });

  it("קומת קרקע ומתוך קומות", () => {
    const csv = ["עיר,קומה,מתוך קומות", "בת ים,קרקע,6"].join("\n");
    const { rows } = parsePropertiesCsv(csv);
    expect(rows[0]?.fields).toMatchObject({ floor: 0, totalFloors: 6 });
  });

  it("מיפוי ידני גובר על הזיהוי האוטומטי", () => {
    const csv = ["מקום,עלות", "נתניה,2000000"].join("\n");
    expect(parsePropertiesCsv(csv).unmappedHeaders).toHaveLength(2);
    const { rows, unmappedHeaders } = parsePropertiesCsv(csv, {
      מקום: "city",
      עלות: "priceAgorot",
    });
    expect(unmappedHeaders).toEqual([]);
    expect(rows[0]?.fields).toMatchObject({ city: "נתניה", priceAgorot: 200_000_000 });
  });
});

describe("parsePropertiesCsv — טלפון בעל הנכס", () => {
  it("מנורמל ל-E.164 כמו כל טלפון מיובא", () => {
    const csv = ["עיר,בעל הנכס,טלפון בעלים", "חולון,ישראל,050-1234567"].join("\n");
    const { rows } = parsePropertiesCsv(csv);
    expect(rows[0]?.ownerPhone).toBe("+972501234567");
  });

  it("ערך שאינו טלפון מועבר גולמי — ההכרעה בשרת", () => {
    const csv = ["עיר,טלפון בעלים", "חולון,אין"].join("\n");
    const { rows } = parsePropertiesCsv(csv);
    expect(rows[0]?.ownerPhone).toBe("אין");
  });
});

describe("ייבוא נכסים לגיוס", () => {
  it("מפרק את העמודות של הגיוס, כולל מקור וקישור", () => {
    const csv = [
      "עיר,רחוב,חדרים,מחיר,מקור,קישור למודעה,שלב,בעל הנכס,הערות",
      'רעננה,אחוזה,4,2650000,יד2,https://www.yad2.co.il/item/1,קיבל שיחה,ישראל ישראלי,"אמר שיחזור"',
    ].join("\n");
    const { rows, unmappedHeaders } = parseRecruitmentCsv(csv);
    expect(unmappedHeaders).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      city: "רעננה",
      street: "אחוזה",
      rooms: 4,
      // ‏אגורות, לא שקלים — אחרת 2,650,000 היה מופיע ככרטיס של 26,500
      priceAgorot: 265_000_000,
      source: "yad2",
      sourceUrl: "https://www.yad2.co.il/item/1",
      status: "called",
      ownerName: "ישראל ישראלי",
      notes: "אמר שיחזור",
    });
  });

  /**
   * ‏סכימת הגיוס בשרת היא `.strict()`. עמודה שאינה שייכת חייבת
   * ‏להופיע כ„לא זוהתה” במסך — אחרת המתווך רואה „זוהתה”, השרת
   * ‏זורק את הערך, והוא מגלה רק מהכרטיס שמשהו חסר.
   */
  it("עמודה שאינה של גיוס מדווחת כלא-מזוהה ואינה נקלטת", () => {
    const csv = ["עיר,כותרת שיווקית,מעלית", "חיפה,דירה מרווחת,כן"].join("\n");
    const { rows, unmappedHeaders } = parseRecruitmentCsv(csv);
    expect(unmappedHeaders).toEqual(["כותרת שיווקית", "מעלית"]);
    expect(rows[0]).toEqual({ city: "חיפה" });
  });

  it("מקבל גם את הקוד עצמו, לא רק את התווית העברית", () => {
    const csv = ["עיר,מקור,שלב", "לוד,madlan,recruited"].join("\n");
    const { rows } = parseRecruitmentCsv(csv);
    expect(rows[0]?.source).toBe("madlan");
    expect(rows[0]?.status).toBe("recruited");
  });

  it("ערך מקור או שלב שאינו מוכר מושמט ואינו מפיל את השורה", () => {
    const csv = ["עיר,מקור,שלב", "אילת,מקור מומצא,שלב מומצא"].join("\n");
    const { rows } = parseRecruitmentCsv(csv);
    expect(rows[0]).toEqual({ city: "אילת" });
  });

  it("מיפוי ידני גובר על הזיהוי האוטומטי", () => {
    const csv = ["עמודה משונה", "נתניה"].join("\n");
    const { rows } = parseRecruitmentCsv(csv, { "עמודה משונה": "city" });
    expect(rows[0]?.city).toBe("נתניה");
  });

  it("קובץ בלי שורות נתונים מחזיר ריק", () => {
    expect(parseRecruitmentCsv("עיר,רחוב").rows).toEqual([]);
    expect(parseRecruitmentCsv("").rows).toEqual([]);
  });
});


describe("ייבוא גיוס — מספרים שנקראים נכון", () => {
  /*
   * ‏אותו תו, שני תפקידים: במחיר הוא מפריד אלפים, בחדרים הוא
   * ‏הנקודה העשרונית. ניקוי גורף הפך „3,5” ל-35, והסכימה חוסמת
   * ‏חדרים מעל 20 — כלומר השורה כולה נדחתה.
   */
  it("‏„3,5” חדרים הוא שלוש וחצי, ו„2,650,000” הוא מחיר מלא", () => {
    const { rows } = parseRecruitmentCsv(
      ['עיר,חדרים,מחיר', '"רעננה","3,5","2,650,000"'].join("\n"),
    );
    expect(rows[0]?.rooms).toBe(3.5);
    expect(rows[0]?.priceAgorot).toBe(265_000_000);
  });

  it("נקודה עשרונית עובדת גם היא", () => {
    const { rows } = parseRecruitmentCsv(["עיר,חדרים", "רעננה,3.5"].join("\n"));
    expect(rows[0]?.rooms).toBe(3.5);
  });

  it("‏„קומת קרקע” היא קומה 0 ולא ערך שנזרק", () => {
    const { rows } = parseRecruitmentCsv(["עיר,קומה", "רעננה,קומת קרקע"].join("\n"));
    expect(rows[0]?.floor).toBe(0);
  });
});

/**
 * ‎**המבנה של מערכת נדל"ן ותיקה — הקובץ שהלקוחות באמת מעלים.**
 *
 * ‏הכותרות כאן הן בדיוק אלה של ייצוא webtiv אמיתי (‎1,326‎ שורות):
 * ‏קיצורים בני שתי אותיות, עמודת קישוט בלי כותרת, ועמודה ששמה
 * ‎„*”‎. מתוך שמונה-עשרה עמודות זוהו שלוש — מחיר, עיר ורחוב —
 * ‏וכל השאר, כולל השם והטלפון של הבעלים, נזרק בשקט.
 *
 * ‏הערכים כאן מומצאים בכוונה: מבנה של קובץ לקוח הוא מה שנבדק,
 * ‏ולא הנתונים שבו.
 */
const WEBTIV_HEADER =
  "נקה מסומנים,שיוך,*,,סדורי,שם,טלפון1,נכס,חדר,מחיר,עיר,אז,רחוב,מס,קו,מע,פתיחה,עדכון";

function webtiv(...rows: string[]): string {
  return [WEBTIV_HEADER, ...rows].join("\n");
}

describe("ייבוא גיוס — המבנה של ייצוא webtiv", () => {
  it("קורא את כל העמודות שיש להן מקום, מקיצורים בני שתי אותיות", () => {
    const { rows } = parseRecruitmentCsv(
      webtiv(
        ',מאגר,*,עם תמונה במודעה,2790335,ישראלה,055-0000001,פנטהאוס,5,"3,500,000",בני ברק,10,הרצל,18,4,כן,7/9/2026,7/9/2026',
      ),
    );
    expect(rows[0]).toEqual({
      ownerName: "ישראלה",
      ownerPhone: "+972550000001",
      propertyType: "penthouse",
      rooms: 5,
      priceAgorot: 350_000_000,
      city: "בני ברק",
      street: "הרצל",
      houseNumber: "18",
      floor: 4,
    });
  });

  /*
   * ‏עמודה בלי כותרת ועמודה ששמה „*” אינן ניתנות למיפוי ידני —
   * המפתח הוא הכותרת עצמה, ושתי כותרות ריקות מתנגשות. הצגתן
   * כ„לא זוהתה” היא רעש שמסתיר את מה שבאמת דורש החלטה.
   */
  it("אינו מדווח על עמודות קישוט כאילו הן כותרות שלא זוהו", () => {
    const { unmappedHeaders } = parseRecruitmentCsv(webtiv(",,,,,,,,,,,,,,,,,"));
    expect(unmappedHeaders).toEqual(["נקה מסומנים", "סדורי", "אז", "מע", "פתיחה", "עדכון"]);
  });

  /*
   * ‎**„שיוך” הוא שלב.** בלי התרגום, רשימה שיש בה גיוסים פעילים
   * ובלעדיות נכנסה כולה כ„חדש” — כלומר הייבוא איבד בדיוק את
   * ההבחנה שבגללה מנהלים רשימת גיוס.
   */
  it("מתרגם את „שיוך” לשלב בגיוס, ומשאיר את השאר בברירת המחדל", () => {
    const { rows } = parseRecruitmentCsv(
      webtiv(
        ",בלעדי,*,,1,א,050-0000001,דירה,3,,תל אביב,,הרצל,1,1,,1/1/2026,1/1/2026",
        ",בטיפול,*,,2,ב,050-0000002,דירה,3,,תל אביב,,הרצל,2,1,,1/1/2026,1/1/2026",
        ",מאגר,*,,3,ג,050-0000003,דירה,3,,תל אביב,,הרצל,3,1,,1/1/2026,1/1/2026",
      ),
    );
    expect(rows.map((row) => row.status)).toEqual(["recruited", "called", undefined]);
  });

  /* ‏שורה שיש בה רק מספר סידורי ותאריכים אינה שורה */
  it("מדלג על שורה שאין בה שום שדה שנקלט", () => {
    const { rows } = parseRecruitmentCsv(webtiv(",משרד,*,אין מודעה,18099,,,,,,,,,,,,1/7/2025,2/7/2025"));
    expect(rows).toEqual([]);
  });
});

describe("סוג נכס מתא בקובץ", () => {
  /*
   * ‎**התא נושא כמה סוגים.** „דירה,יח. דיור” הוא דירה שיש בה
   * יחידת דיור — והחיפוש של המחרוזת השלמה לא מצא דבר, כלומר
   * דווקא הנכסים המעניינים נכנסו בלי סוג.
   */
  it("לוקח את הסוג הראשון שמזוהה בתא רב-ערכי", () => {
    expect(propertyTypeFromCsv("דירה,יח. דיור")).toBe("apartment");
    expect(propertyTypeFromCsv("פנטהאוס,יח. דיור")).toBe("penthouse");
    expect(propertyTypeFromCsv("בית,יח. דיור,דו משפחתי")).toBe("private_house");
    expect(propertyTypeFromCsv("דירת גן,יח. דיור,ד.מרתף")).toBe("garden_apartment");
  });

  /* ‏„פנטהאוס” בסמ"ך — כתיב נפוץ בדיוק כמו „פנטהאוז” */
  it("מכיר את שני כתיבי הפנטהאוס", () => {
    expect(propertyTypeFromCsv("פנטהאוס")).toBe("penthouse");
    expect(propertyTypeFromCsv("פנטהאוז")).toBe("penthouse");
  });

  it("מכיר את הסוגים שמערכות ותיקות כותבות", () => {
    expect(propertyTypeFromCsv("בית")).toBe("private_house");
    expect(propertyTypeFromCsv("וילה")).toBe("private_house");
    expect(propertyTypeFromCsv("קוטג׳")).toBe("private_house");
    expect(propertyTypeFromCsv("דו משפחתי")).toBe("two_family");
    expect(propertyTypeFromCsv("יח. דיור")).toBe("unit");
    expect(propertyTypeFromCsv("ד.גג")).toBe("penthouse");
  });

  /*
   * ‎„להשקעה” אינו סוג נכס אלא תיאור הזדמנות. ריק הוא התשובה
   * הנכונה — „אחר” היה מצהיר שיודעים מה זה.
   */
  it("אינו ממציא סוג למה שאינו סוג", () => {
    expect(propertyTypeFromCsv("להשקעה")).toBeUndefined();
    expect(propertyTypeFromCsv("")).toBeUndefined();
  });
});

describe("כן/לא — ערך שנושא איתו פירוט", () => {
  /*
   * ‎**„כן,שתיים” הוא כן.** ייצוא אמיתי כותב בעמודת המעלית „כן”
   * ועוד מה — כמה מעליות, ואם יש מעלית שבת. ההשוואה המדויקת
   * החזירה „לא ידוע”, והשדה נשאר ריק דווקא בנכסים שיש בהם שתי
   * מעליות.
   *
   * ‏גבול-מילה (`\b`) אינו עונה על זה: הוא נמדד מול `[A-Za-z0-9_]`,
   * ואות עברית אינה תו-מילה — כלומר התנאי היה `false` תמיד, גם
   * על „כן” לבדו (ביקורת Codex).
   */
  it("קורא את האסימון הראשון כשיש אחריו פירוט", () => {
    expect(parseYesNo("כן,שתיים")).toBe(true);
    expect(parseYesNo("כן,מ. שבת,שתיים")).toBe(true);
    expect(parseYesNo("לא, אין")).toBe(false);
  });

  it("ולא שבר את הצורות הפשוטות", () => {
    expect(parseYesNo("כן")).toBe(true);
    expect(parseYesNo("לא")).toBe(false);
    expect(parseYesNo("")).toBeUndefined();
    expect(parseYesNo("שתיים")).toBeUndefined();
  });
});

describe("חיפוש סוג נכס בעברית", () => {
  /*
   * ‎**שני הצדדים באותו נרמול.** מפתחות המפה נכתבים כפי שהם
   * מופיעים בקבצים („קוטג” בלי גרש, כי הגרש מוסר בנרמול בייבוא),
   * והמונח מגיע מהמקלדת — עם גרש. בלי נרמול סימטרי, מי שכתב
   * „קוטג׳” לא מצא את השורה שנכנסה מ„קוטג׳” בקובץ (ביקורת Codex).
   */
  it("מוצא גם כשהמונח נושא סימני פיסוק שהנרמול מסיר", () => {
    expect(propertyTypesForTerm("קוטג׳")).toContain("private_house");
    expect(propertyTypesForTerm("קוטג")).toContain("private_house");
    expect(propertyTypesForTerm('פנטהאוס')).toContain("penthouse");
    expect(propertyTypesForTerm("פנטהאוז")).toContain("penthouse");
  });

  /*
   * ‎**מה שאפשר לייבא, אפשר גם לחפש.** הכתיבים שנוספו למפה כדי
   * שקובץ ייקרא נכון הם גם מה שהמתווך מקליד בשדה החיפוש — ומפתח
   * שנוסף בצורה שהחיפוש אינו מוצא הוא בדיוק הפער שנפתח כאן.
   */
  it("כל סוג שאפשר לייבא — אפשר גם לחפש בכתיב שלו", () => {
    for (const [hebrew, value] of Object.entries(PROPERTY_TYPE_MAP)) {
      expect(propertyTypesForTerm(hebrew), hebrew).toContain(value);
    }
  });

  it("מונח ריק אינו מחזיר את כל הסוגים", () => {
    expect(propertyTypesForTerm("")).toEqual([]);
    expect(propertyTypesForTerm("   ")).toEqual([]);
  });
});

/*
 * ‎**הקובץ כפי שהוא באמת יוצא, ולא כפי שהוקלד כאן.**
 *
 * ‏הבדיקות למעלה כתובות בפסיקים וב-UTF-8, ולכן עברו בזמן שהייצוא
 * ‏האמיתי של webtiv — **טאבים ו-Windows-1255** — נכשל לחלוטין:
 * ‏17 עמודות נדחסו לאחת, כל האותיות הפכו ל-`?`, ו„ייבא 0 נכסים”.
 * ‏זרע שאינו דומה למציאות מסתיר בדיוק את מה שהוא אמור לתפוס.
 *
 * ‏כאן נבדק המסלול המלא: בייטים ← פענוח ← זיהוי מפריד ← פירוק.
 * ‏הערכים מומצאים; מה שנבדק הוא הצורה.
 */
function toCp1255Bytes(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < 0x80) out.push(code);
    else if (code >= 0x05d0 && code <= 0x05ea) out.push(0xe0 + (code - 0x05d0));
    else throw new Error(`אין מיפוי ל-${ch}`);
  }
  return new Uint8Array(out);
}

describe("ייצוא webtiv כפי שהוא נשמר — טאבים ו-Windows-1255", () => {
  const COLUMNS = [
    "נקה מסומנים",
    "שיוך",
    "*",
    "",
    "סדורי",
    "שם",
    "טלפון1",
    "נכס",
    "חדר",
    "מחיר",
    "עיר",
    "אז",
    "רחוב",
    "מס",
    "קו",
    "מע",
    "פתיחה",
    "עדכון",
  ];
  const VALUES = [
    "",
    "מאגר",
    "*",
    "עם תמונה במודעה",
    "2790335",
    "ישראלה",
    "055-0000001",
    "פנטהאוס",
    "5",
    '"3,500,000"',
    "בני ברק",
    "10",
    "הרצל",
    "18",
    "4",
    "כן",
    "7/9/2026",
    "7/9/2026",
  ];
  /** ‏טאבים, CRLF ו-1255 — שלושתם כפי שהקובץ האמיתי נשמר */
  const bytes = toCp1255Bytes(
    [COLUMNS.join("\t"), VALUES.join("\t")].join("\r\n"),
  );

  it("מפוענח ל-1255 ולא נקרא כ-UTF-8", () => {
    expect(decodeImportBytes(bytes).encoding).toBe("windows-1255");
  });

  it("ונקרא לשורה מלאה — אותה תוצאה בדיוק כמו גרסת הפסיקים", () => {
    const { rows } = parseRecruitmentCsv(decodeImportBytes(bytes).text);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      ownerName: "ישראלה",
      ownerPhone: "+972550000001",
      propertyType: "penthouse",
      rooms: 5,
      priceAgorot: 350_000_000,
      city: "בני ברק",
      street: "הרצל",
      houseNumber: "18",
      floor: 4,
    });
  });

  /*
   * ‏„3,500,000” הוא תא אחד, ושלושת הפסיקים שבו אינם מפרידים.
   * ‏ספירה תמימה הייתה מוצאת יותר פסיקים מטאבים בשורת הכותרת של
   * ‏קבצים אמיתיים ובוחרת פסיק — כלומר משאירה את התקלה כפי שהיא.
   */
  it("והמחיר המצוטט לא הסיט את זיהוי המפריד", () => {
    const { rows } = parseRecruitmentCsv(decodeImportBytes(bytes).text);
    expect(rows[0]?.priceAgorot).toBe(350_000_000);
  });
});
