import { describe, expect, it } from "vitest";
import {
  demandLabel,
  demandMatchCopy,
  demandMatchDedupeKey,
  followLabel,
  FOLLOW_KINDS,
  FOLLOW_ACTIVE_NOTE,
  FOLLOW_EMPTY_NOTE,
  FOLLOW_EMPTY_TITLE,
  listingLabel,
  listingMatchCopy,
  listingMatchDedupeKey,
  LISTING_MATCH_NOTIFICATION_TYPE,
  MAX_FOLLOWS_PER_USER,
  DEMAND_MATCH_NOTIFICATION_TYPE,
} from "./network-follow.js";
import { NETWORK_MATCH_MIN_SCORE } from "../schemas/match.js";

describe("מפתח הייחודיות של ההתראה", () => {
  /**
   * ‏שני סוכנים באותו משרד יכולים לעקוב אחרי אותו ביקוש, וכל אחד
   * מהם אמור לקבל את ההודעה שלו. מפתח שנשען על הביקוש היה נותן
   * לראשון בלבד.
   */
  it("מפריד בין עוקבים, ולא רק בין ביקושים", () => {
    const a = demandMatchDedupeKey("FOLLOW1", "PROP1");
    expect(a).not.toBe(demandMatchDedupeKey("FOLLOW2", "PROP1"));
    expect(a).not.toBe(demandMatchDedupeKey("FOLLOW1", "PROP2"));
    expect(a).toBe(demandMatchDedupeKey("FOLLOW1", "PROP1"));
  });

  it("נכנס בעמודה של 120 תווים גם עם שני ULIDים", () => {
    const key = demandMatchDedupeKey("0".repeat(26), "1".repeat(26));
    expect(key.length).toBeLessThanOrEqual(120);
  });
});

describe("ההודעה לעוקב", () => {
  /**
   * ‎**שני הצדדים בגוף ההודעה.** „נמצאה התאמה” מחייב לפתוח את המסך
   * כדי לדעת על מה מדובר; הנכס והביקוש יחד הם משהו שאפשר להחליט
   * עליו מהטלפון.
   */
  it("נושאת את הנכס, את הביקוש ואת הציון", () => {
    const copy = demandMatchCopy({
      demandLabel: "קונה שמחפש 4 חדרים בחולון",
      propertyTitle: "כצנלסון 44",
      score: 92,
    });
    expect(copy.body).toContain("כצנלסון 44");
    expect(copy.body).toContain("חולון");
    expect(copy.body).toContain("92");
  });

  it("הכותרת אומרת מה קרה גם בלי הגוף", () => {
    const copy = demandMatchCopy({
      demandLabel: "קונה",
      propertyTitle: "נכס",
      score: 71,
    });
    expect(copy.title.length).toBeGreaterThan(10);
    expect(copy.title).toContain("עוקב");
  });
});

describe("תווית הכפתור", () => {
  /**
   * ‎**הכפתור אומר את המצב, לא את פעולת הביטול.** „הפסק לעקוב”
   * מאלץ לקרוא כדי לדעת מה קורה עכשיו; „עוקבים” נקרא בעין אחת.
   */
  it.each(FOLLOW_KINDS)("אומרת מה המצב ולא מה תעשה הלחיצה — %s", (kind) => {
    expect(followLabel(true, kind)).not.toMatch(/הפסק|ביטול|הסר/u);
    expect(followLabel(true, kind)).toContain("עוקבים");
    expect(followLabel(false, kind)).toContain("עקוב");
  });

  it.each(FOLLOW_KINDS)("שתי התוויות נבדלות זו מזו — %s", (kind) => {
    expect(followLabel(true, kind)).not.toBe(followLabel(false, kind));
  });

  /*
   * ‎**וכל כיוון אומר על מה עוקבים.** „עקוב” לבדו על כרטיס נכס
   * ‏ועל כרטיס ביקוש הוא אותו כפתור על שתי פעולות שונות.
   */
  it("וכל כיוון נוקב בשם שלו", () => {
    expect(followLabel(false, "demand")).toContain("ביקוש");
    expect(followLabel(false, "listing")).toContain("נכס");
    expect(followLabel(false, "demand")).not.toBe(followLabel(false, "listing"));
  });
});

describe("הנוסחים", () => {
  it.each(FOLLOW_KINDS)("שורת המצב-הריק מסבירה מה יקרה — %s", (kind) => {
    expect(FOLLOW_EMPTY_TITLE[kind].length).toBeGreaterThan(10);
    /* ‏„אין לכם נכס” לבדו הוא מבוי סתום; ההמשך הוא מה שהופך אותו לפעולה */
    expect(FOLLOW_EMPTY_NOTE[kind]).toMatch(/התראה|נעדכן/u);
  });

  it.each(FOLLOW_KINDS)("האישור אחרי הלחיצה אינו חוזר על ההסבר — %s", (kind) => {
    expect(FOLLOW_ACTIVE_NOTE[kind]).not.toBe(FOLLOW_EMPTY_NOTE[kind]);
    expect(FOLLOW_ACTIVE_NOTE[kind].length).toBeLessThan(
      FOLLOW_EMPTY_NOTE[kind].length + 20,
    );
  });

  /*
   * ‎**שני הכיוונים אומרים דברים שונים.** נוסח זהה משני צדי הרשת
   * ‏פירושו שאחד מהם שגוי: „ייכנס נכס מתאים” על מעקב אחרי נכס
   * ‏הוא בדיוק ההפך ממה שיקרה.
   */
  it("והנוסח של כל כיוון מדבר על מה שייכנס בו", () => {
    expect(FOLLOW_EMPTY_NOTE.demand).toContain("נכס");
    expect(FOLLOW_EMPTY_NOTE.listing).toContain("קונה");
    expect(FOLLOW_ACTIVE_NOTE.demand).not.toBe(FOLLOW_ACTIVE_NOTE.listing);
    expect(FOLLOW_EMPTY_TITLE.demand).not.toBe(FOLLOW_EMPTY_TITLE.listing);
  });
});

describe("הכיוון השני — מעקב אחרי נכס", () => {
  /*
   * ‎**שני הצדדים בהתראה.** „נמצאה התאמה לנכס שאתה עוקב אחריו”
   * ‏מחייב לפתוח את המסך; שם הקונה והנכס הם מה שאפשר להחליט עליו
   * ‏מהטלפון.
   */
  it("ההתראה נושאת את הקונה, את הנכס ואת הציון", () => {
    const copy = listingMatchCopy({
      listingLabel: "דירה 4 חדרים בחולון",
      buyerName: "רונית לוי",
      score: 88,
    });
    expect(copy.body).toContain("רונית לוי");
    expect(copy.body).toContain("דירה 4 חדרים בחולון");
    expect(copy.body).toContain("88");
    expect(copy.title).toContain("קונה");
  });

  /*
   * ‎**המפתח הוא המעקב ולא הנכס.** שני סוכנים באותו משרד יכולים
   * ‏לעקוב אחרי אותו נכס, וכל אחד אמור לקבל את ההודעה שלו.
   */
  it("מפתח הייחודיות נגזר מהמעקב ומהקונה", () => {
    expect(listingMatchDedupeKey("F1", "B1")).toBe(listingMatchDedupeKey("F1", "B1"));
    expect(listingMatchDedupeKey("F1", "B1")).not.toBe(listingMatchDedupeKey("F2", "B1"));
    expect(listingMatchDedupeKey("F1", "B1")).not.toBe(listingMatchDedupeKey("F1", "B2"));
    /* ‏ואינו מתנגש עם הכיוון השני */
    expect(listingMatchDedupeKey("F1", "B1")).not.toBe(demandMatchDedupeKey("F1", "B1"));
  });

  it("ושני סוגי ההתראה נבדלים", () => {
    expect(LISTING_MATCH_NOTIFICATION_TYPE).not.toBe(DEMAND_MATCH_NOTIFICATION_TYPE);
  });

  /*
   * ‎**הסוג מגיע מהקטלוג המשותף.** מפה שנייה כאן הייתה מציגה
   * ‏„apartment” בהתראה בטלפון ביום שמישהו יוסיף סוג.
   */
  it("התווית נוקבת בסוג, בחדרים ובעיר", () => {
    expect(listingLabel({ propertyType: "apartment", rooms: 4, city: "חולון" })).toBe(
      "דירה 4 חדרים בחולון",
    );
    expect(listingLabel({ propertyType: "penthouse", rooms: 5, city: "רמת גן" })).toContain(
      "פנטהאוז",
    );
  });

  /* ‏שכירות היא הכיוון השני, ואסור לקרוא לה מכירה */
  it("ושכירות נאמרת", () => {
    const text = listingLabel({
      propertyType: "apartment",
      rooms: 3,
      city: "חולון",
      dealType: "rent",
    });
    expect(text).toContain("להשכרה");
  });

  /*
   * ‎**מפתח שאינו מוכר אינו מגיע כמחרוזת באנגלית.** גם `constructor`
   * ‏אינו סוג נכס, ואינדוקס רגיל היה מוצא אותו דרך ה-prototype.
   */
  it("סוג שאינו מוכר חוזר כ„נכס”", () => {
    expect(listingLabel({ propertyType: "no_such_type", rooms: 3 })).toContain("נכס");
    expect(listingLabel({ propertyType: "constructor", rooms: 3 })).toContain("נכס");
    expect(listingLabel({ propertyType: "constructor", rooms: 3 })).not.toContain("function");
  });

  /* ‏בלי חדרים ובלי עיר עדיין יוצא משפט, ולא מחרוזת ריקה */
  it("ובלי פרטים עדיין יש תווית", () => {
    expect(listingLabel({}).trim().length).toBeGreaterThan(0);
  });
});

describe("הגבולות", () => {
  it("מספר המעקבים מחייב לבחור, ואינו פתוח", () => {
    expect(MAX_FOLLOWS_PER_USER).toBeGreaterThan(5);
    expect(MAX_FOLLOWS_PER_USER).toBeLessThanOrEqual(100);
  });

  /**
   * ‎**סף אחד לכרטיס ולהתראה.** שני ספים היו יוצרים את הסתירה
   * הגרועה ביותר: כרטיס שאומר „מתאים” לצד התראה שלא הגיעה.
   */
  it("סף הרשת הוא מספר אחד, בתוך התחום הקביל", () => {
    expect(NETWORK_MATCH_MIN_SCORE).toBeGreaterThan(0);
    expect(NETWORK_MATCH_MIN_SCORE).toBeLessThanOrEqual(100);
  });
});

describe("הביקוש במילים", () => {
  it("חדרים ועיר, בסדר שנקרא", () => {
    expect(demandLabel({ cities: ["חולון"], roomsMin: 4, roomsMax: 4 })).toBe(
      "קונה שמחפש 4 חדרים בחולון",
    );
  });

  it("טווח חדרים נשמר כטווח", () => {
    expect(demandLabel({ cities: ["רמת גן"], roomsMin: 3, roomsMax: 4 })).toContain(
      "3–4 חדרים",
    );
  });

  /** ‏שכירות אינה קנייה, ו„קונה” על ביקוש להשכרה הוא פשוט שקר. */
  it("שכירות אינה נקראת „קונה”", () => {
    const label = demandLabel({ cities: ["חיפה"], roomsMin: 2, dealType: "rent" });
    expect(label).toContain("שוכר");
    expect(label).not.toContain("קונה");
  });

  it("בלי חדרים — עדיין משפט", () => {
    expect(demandLabel({ cities: ["אשדוד"] })).toBe("קונה שמחפש באשדוד");
  });

  /** ‏בלי כלום — „קונה שמחפש” לבדו נקטע באמצע ואינו אומר דבר. */
  it("בלי חדרים ובלי עיר — מילה אחת שלמה", () => {
    expect(demandLabel({ cities: [] })).toBe("קונה");
  });
});
