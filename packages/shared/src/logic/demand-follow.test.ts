import { describe, expect, it } from "vitest";
import {
  demandLabel,
  demandMatchCopy,
  demandMatchDedupeKey,
  followLabel,
  FOLLOW_ACTIVE_NOTE,
  FOLLOW_EMPTY_NOTE,
  FOLLOW_EMPTY_TITLE,
  MAX_FOLLOWS_PER_USER,
} from "./demand-follow.js";
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
  it("אומרת מה המצב ולא מה תעשה הלחיצה", () => {
    expect(followLabel(true)).not.toMatch(/הפסק|ביטול|הסר/u);
    expect(followLabel(true)).toContain("עוקבים");
    expect(followLabel(false)).toContain("עקוב");
  });

  it("שתי התוויות נבדלות זו מזו", () => {
    expect(followLabel(true)).not.toBe(followLabel(false));
  });
});

describe("הנוסחים", () => {
  it("שורת המצב-הריק מסבירה מה יקרה, ולא רק שאין כלום", () => {
    expect(FOLLOW_EMPTY_TITLE.length).toBeGreaterThan(10);
    /* ‏„אין לכם נכס” לבדו הוא מבוי סתום; ההמשך הוא מה שהופך אותו לפעולה */
    expect(FOLLOW_EMPTY_NOTE).toMatch(/התראה|נעדכן/u);
  });

  it("האישור אחרי הלחיצה אינו חוזר על ההסבר", () => {
    expect(FOLLOW_ACTIVE_NOTE).not.toBe(FOLLOW_EMPTY_NOTE);
    expect(FOLLOW_ACTIVE_NOTE.length).toBeLessThan(FOLLOW_EMPTY_NOTE.length + 20);
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
