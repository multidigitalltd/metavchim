import { describe, expect, it } from "vitest";
import {
  buildPropertyPitchEmail,
  pitchDeliverable,
  pitchPropertyLine,
  pitchRecipientState,
  type PitchProperty,
} from "./property-pitch.js";

const PROPERTY: PitchProperty = {
  title: "דירת 4 חדרים מרווחת",
  city: "רעננה",
  neighborhood: "לב הפארק",
  rooms: 4,
  areaSqm: 105,
  priceAgorot: 285_000_000,
  landingUrl: "https://app.example/p/tok123",
};

describe("‏שורת הנכס — רק מה שידוע", () => {
  it("‏מרכיבה את כל הפרטים כשיש", () => {
    const line = pitchPropertyLine(PROPERTY);
    expect(line).toContain("דירת 4 חדרים מרווחת");
    expect(line).toContain("4 חדרים");
    expect(line).toContain("105 מ״ר");
    expect(line).toContain("לב הפארק, רעננה");
  });

  /* ‏המחיר באגורות במאגר, ובמייל בשקלים — לקוח אינו קורא אגורות */
  it("‏המחיר מוצג בשקלים ולא באגורות", () => {
    expect(pitchPropertyLine(PROPERTY)).toContain("2,850,000 ₪");
    expect(pitchPropertyLine(PROPERTY)).not.toContain("285000000");
  });

  /*
   * ‏שדה חסר אינו הופך למפריד ריק: „4 חדרים · · רעננה” נראה
   * ‏כמו תקלה, ולקוח שרואה אותו לא סומך על השאר.
   */
  it("‏שדה חסר נעלם, ואינו משאיר מפריד", () => {
    const line = pitchPropertyLine({
      title: "פנטהאוז",
      city: "חיפה",
      landingUrl: "https://app.example/p/x",
    });
    expect(line).toBe("פנטהאוז — חיפה");
    expect(line).not.toContain("··");
  });

  /* ‏נכס בלי שום פרט — הכותרת לבדה, בלי מקף תלוי */
  it("‏בלי שום פרט נשארת הכותרת בלבד", () => {
    expect(pitchPropertyLine({ title: "נכס", landingUrl: "u" })).toBe("נכס");
  });
});

describe("‏המייל", () => {
  const base = { officeName: "תיווך הכרמל", buyerName: "דנה", optOutUrl: "https://app.example/optout/t" };

  it("‏מפנה לדף הנחיתה של הנכס", () => {
    const { content } = buildPropertyPitchEmail({ ...base, properties: [PROPERTY] });
    expect(content.links?.[0]?.url).toBe("https://app.example/p/tok123");
  });

  /*
   * ‎**זו ההבחנה מהסבב האוטומטי.** „נשלחה אוטומטית כי ביקשתם
   * ‏מאיתנו לחפש” היא אמירה לא נכונה על מייל שסוכן בחר לשלוח,
   * ‏ודווקא בשדה שמסביר ללקוח למה הוא קיבל אותו.
   */
  it("‏אינו טוען שנשלח אוטומטית", () => {
    const { content } = buildPropertyPitchEmail({ ...base, properties: [PROPERTY] });
    expect(content.footnote).not.toContain("אוטומטית");
    expect(content.footnote).toContain("תיווך הכרמל");
  });

  /* ‏חובה חוקית בכל דיוור שיווקי (§30א) */
  it("‏נושא קישור הסרה", () => {
    const { content } = buildPropertyPitchEmail({ ...base, properties: [PROPERTY] });
    expect(content.footnote).toContain("https://app.example/optout/t");
  });

  it("‏בלי שם — בלי שורת ברכה", () => {
    const { content } = buildPropertyPitchEmail({ ...base, buyerName: "", properties: [PROPERTY] });
    expect(content.greeting).toBeUndefined();
  });

  it("‏נכס אחד — הנושא הוא הנכס עצמו", () => {
    const { subject } = buildPropertyPitchEmail({ ...base, properties: [PROPERTY] });
    expect(subject).toContain("דירת 4 חדרים מרווחת");
  });

  it("‏כמה נכסים — הנושא סופר אותם", () => {
    const { subject, content } = buildPropertyPitchEmail({
      ...base,
      properties: [PROPERTY, { ...PROPERTY, title: "אחר" }],
    });
    expect(subject).toContain("2 נכסים");
    expect(content.links).toHaveLength(2);
  });
});

describe("‏מי יקבל, ולמה לא", () => {
  it("‏עם מייל ובלי הסרה — מקבל", () => {
    expect(pitchRecipientState({ hasEmail: true, optedOut: false })).toBe("ready");
  });

  it("‏בלי מייל — מסומן, ולא נשלח", () => {
    expect(pitchRecipientState({ hasEmail: false, optedOut: false })).toBe("no_email");
  });

  /*
   * ‏ההסרה קודמת למייל החסר: היא הסיבה החזקה יותר, ולקוח שהסיר
   * ‏את עצמו לא יקבל גם אם מחר יתווסף לו מייל.
   */
  it("‏מי שהסיר את עצמו — גם כשיש לו מייל", () => {
    expect(pitchRecipientState({ hasEmail: true, optedOut: true })).toBe("opted_out");
    expect(pitchRecipientState({ hasEmail: false, optedOut: true })).toBe("opted_out");
  });

  it("‏הסינון מחזיר רק את מי שבאמת יקבל", () => {
    const rows = [
      { id: "a", hasEmail: true, optedOut: false },
      { id: "b", hasEmail: false, optedOut: false },
      { id: "c", hasEmail: true, optedOut: true },
    ];
    expect(pitchDeliverable(rows).map((r) => r.id)).toEqual(["a"]);
  });
});
