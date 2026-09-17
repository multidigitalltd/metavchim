import { describe, expect, it } from "vitest";
import {
  PLACEHOLDER_GROUPS,
  PLACEHOLDER_LABELS,
  PLACEHOLDER_NAMES,
  REQUIRED_PLACEHOLDERS,
  SAMPLE_AGREEMENT_VALUES,
  OPEN_SIGNER_PLACEHOLDERS,
  SIGNER_BLANK,
  SIGNER_PROVIDED_PLACEHOLDERS,
  agreementAllowsOpenLink,
  agreementDealLabel,
  defaultAgreementTemplate,
  fillSignerId,
  missingRequiredPlaceholders,
  openSignerBlanks,
  renderAgreement,
  type AgreementKind,
} from "./agreement-template.js";

const KINDS: AgreementKind[] = ["brokerage", "exclusivity"];

describe("נוסחי ברירת המחדל", () => {
  it("כוללים את כל פרטי החובה מתקנות המתווכים", () => {
    for (const kind of KINDS) {
      expect(missingRequiredPlaceholders(kind, defaultAgreementTemplate(kind))).toEqual([]);
    }
  });

  it("הבלעדיות דורשת תקופה, ההזמנה בכתב דורשת סוג עסקה", () => {
    expect(REQUIRED_PLACEHOLDERS.exclusivity).toContain("תקופת_בלעדיות");
    expect(REQUIRED_PLACEHOLDERS.brokerage).toContain("סוג_העסקה");
  });
});

describe("missingRequiredPlaceholders", () => {
  it("מזהה נוסח מותאם שהשמיט את דמי התיווך", () => {
    const missing = missingRequiredPlaceholders(
      "brokerage",
      "הסכם עם {{שם_הלקוח}} ת\"ז {{תעודת_זהות_הלקוח}} מאת {{שם_המשרד}}",
    );
    expect(missing).toContain("דמי_תיווך");
    expect(missing).toContain("מועד_תשלום");
  });

  it("נוסח ריק — כל פרטי החובה חסרים", () => {
    expect(missingRequiredPlaceholders("brokerage", "")).toEqual(
      REQUIRED_PLACEHOLDERS.brokerage,
    );
  });
});

describe("renderAgreement", () => {
  it("ממלא ערכים ומכבד רווחים בתוך הסוגריים", () => {
    const result = renderAgreement("שלום {{שם_הלקוח}} ו-{{ שם_המשרד }}", {
      שם_הלקוח: "יעקב כהן",
      שם_המשרד: "תיווך הבית",
    });
    expect(result.text).toBe("שלום יעקב כהן ו-תיווך הבית");
    expect(result.unfilled).toEqual([]);
  });

  it("שדה חסר מסומן בגלוי ולא נמחק בשקט", () => {
    const result = renderAgreement("דמי תיווך: {{דמי_תיווך}}", {});
    expect(result.text).toContain("[חסר: דמי תיווך]");
    expect(result.unfilled).toEqual(["דמי_תיווך"]);
  });

  it("מחרוזת ריקה נחשבת חסרה", () => {
    const result = renderAgreement("{{מחיר_משוער}}", { מחיר_משוער: "   " });
    expect(result.unfilled).toEqual(["מחיר_משוער"]);
  });

  it("שדה שחוזר פעמיים נספר פעם אחת", () => {
    const result = renderAgreement("{{דמי_תיווך}} ושוב {{דמי_תיווך}}", {});
    expect(result.unfilled).toEqual(["דמי_תיווך"]);
  });

  it("נוסח מלא לא משאיר סימני מילוי", () => {
    const values = {
      שם_המשרד: "תיווך הבית",
      מספר_רישיון_תיווך: "12345",
      כתובת_המשרד: "הרצל 1, בית שמש",
      טלפון_המשרד: "02-9999999",
      שם_הלקוח: "רחל לוי",
      תעודת_זהות_הלקוח: "011111111",
      כתובת_הלקוח: "הנרקיס 5",
      טלפון_הלקוח: "050-1234567",
      סוג_העסקה: "רכישה",
      תיאור_הנכס: "דירת 4 חדרים, הרצל 12, בית שמש",
      מחיר_משוער: "2,400,000 ₪",
      דמי_תיווך: "2% ממחיר העסקה",
      מועד_תשלום: "במועד חתימת חוזה מחייב",
      תקופת_בלעדיות: "6 חודשים",
      תאריך: "4.8.2026",
    };
    for (const kind of KINDS) {
      const result = renderAgreement(defaultAgreementTemplate(kind), values);
      expect(result.unfilled).toEqual([]);
      expect(result.text).not.toContain("{{");
      expect(result.text).not.toContain("[חסר");
    }
  });
});

describe("fillSignerId", () => {
  it("ממלא את השורה הריקה במספר שהחותם הזין", () => {
    expect(fillSignerId(`הלקוח: דנה · ת"ז ${SIGNER_BLANK}`, "123456789")).toBe(
      'הלקוח: דנה · ת"ז 123456789',
    );
  });

  it("מחליף רק את ההופעה הראשונה", () => {
    const body = `ת"ז ${SIGNER_BLANK}\n\nושוב: ${SIGNER_BLANK}`;
    const filled = fillSignerId(body, "123456789");
    expect(filled).toBe(`ת"ז 123456789\n\nושוב: ${SIGNER_BLANK}`);
  });

  it("קו תחתון רגיל בנוסח מותאם לא נבלע — שורת חתימה נשארת ריקה", () => {
    // נוסח שמכיל שורת חתימה *לפני* מקום תעודת הזהות: בלי הסימון
    // הבלתי נראה, החיפוש היה ממלא את שורת החתימה במספר הזהות
    const body = `חתימת הלקוח: ____________\n\nת"ז ${SIGNER_BLANK}`;
    const filled = fillSignerId(body, "123456789");
    expect(filled).toBe('חתימת הלקוח: ____________\n\nת"ז 123456789');
  });

  it("הסימון בלתי נראה — השורה נראית כקווים תחתונים בלבד", () => {
    expect(SIGNER_BLANK.replace(/⁠/gu, "")).toBe("____________");
  });

  it("נוסח בלי שורה למילוי חוזר כמות שהוא", () => {
    expect(fillSignerId("בלי מקום למילוי", "123456789")).toBe("בלי מקום למילוי");
  });

  it("מספר ריק לא מוחק את השורה", () => {
    const body = `ת"ז ${SIGNER_BLANK}`;
    expect(fillSignerId(body, "   ")).toBe(body);
  });
});

describe("SIGNER_PROVIDED_PLACEHOLDERS", () => {
  it("כל פרט שהחותם ממלא הוא גם פרט חובה — אחרת אין סיבה לטפל בו בנפרד", () => {
    for (const name of SIGNER_PROVIDED_PLACEHOLDERS) {
      expect(REQUIRED_PLACEHOLDERS.brokerage).toContain(name);
    }
  });
});

describe("מטא-דאטה לעורך הנוסחים", () => {
  it("לכל שדה יש שם קריא — שדה חדש לא יופיע במסך כקוד גולמי", () => {
    for (const name of PLACEHOLDER_NAMES) {
      expect(PLACEHOLDER_LABELS[name]).toBeTruthy();
      expect(PLACEHOLDER_LABELS[name]).not.toContain("_");
    }
  });

  it("כל שדה שייך לקבוצה אחת בדיוק", () => {
    const grouped = PLACEHOLDER_GROUPS.flatMap((g) => g.names);
    expect([...grouped].sort()).toEqual([...PLACEHOLDER_NAMES].sort());
    expect(grouped.length).toBe(new Set(grouped).size);
  });

  it("לכל שדה יש ערך דוגמה — התצוגה המקדימה לא תציג [חסר]", () => {
    for (const kind of KINDS) {
      const result = renderAgreement(defaultAgreementTemplate(kind), SAMPLE_AGREEMENT_VALUES);
      expect(result.unfilled).toEqual([]);
      expect(result.text).not.toContain("[חסר");
    }
  });

  it("ערכי הדוגמה מסומנים כדוגמה ולא נראים כלקוח אמיתי", () => {
    expect(SAMPLE_AGREEMENT_VALUES.שם_הלקוח).toContain("לדוגמה");
  });
});

/**
 * ‏הקישור הפתוח — הנוסח מוקפא פעם אחת, ונחתם פעם אחת. שתי ההרצות
 * ‏האלה הן כל המנגנון, ולכן הן נבדקות כאן ולא בשירות.
 */
describe("קישור החתמה פתוח", () => {
  const OFFICE = {
    שם_המשרד: "תיווך לדוגמה",
    מספר_רישיון_תיווך: "3001",
    כתובת_המשרד: "הרצל 1, תל אביב",
    טלפון_המשרד: "03-1111111",
    דמי_תיווך: "2%",
    מועד_תשלום: "במעמד החתימה",
    תאריך: "17.09.2026",
  };

  const frozen = (): string =>
    renderAgreement(defaultAgreementTemplate("brokerage"), OFFICE, {
      keep: OPEN_SIGNER_PLACEHOLDERS,
    }).text;

  it("ההקפאה ממלאת את פרטי המשרד ומשאירה את שדות החותם כשורטקוד", () => {
    const text = frozen();
    expect(text).toContain("תיווך לדוגמה");
    expect(text).toContain("{{שם_הלקוח}}");
    expect(text).toContain("{{תיאור_הנכס}}");
    expect(text).not.toContain("[חסר");
  });

  it("שדה ששמור להמשך אינו נספר כחסר", () => {
    const result = renderAgreement(defaultAgreementTemplate("brokerage"), OFFICE, {
      keep: OPEN_SIGNER_PLACEHOLDERS,
    });
    expect(result.unfilled).toEqual([]);
  });

  it("פרט משרד שלא הוזן עדיין נספר כחסר — ההקפאה אינה פוטרת ממנו", () => {
    const { unfilled } = renderAgreement(
      defaultAgreementTemplate("brokerage"),
      { ...OFFICE, דמי_תיווך: "" },
      { keep: OPEN_SIGNER_PLACEHOLDERS },
    );
    expect(unfilled).toEqual(["דמי_תיווך"]);
  });

  it("התצוגה שלפני החתימה מציגה שורה למילוי, לא [חסר]", () => {
    const preview = renderAgreement(frozen(), openSignerBlanks());
    expect(preview.unfilled).toEqual([]);
    expect(preview.text).not.toContain("[חסר");
    expect(preview.text).toContain(SIGNER_BLANK);
    expect(preview.text).not.toContain("{{");
  });

  it("החתימה ממלאת את אותו נוסח קפוא בערכים של החותם", () => {
    const signed = renderAgreement(frozen(), {
      שם_הלקוח: "דנה כהן",
      תעודת_זהות_הלקוח: "123456789",
      כתובת_הלקוח: "הדקל 5, רמת גן",
      טלפון_הלקוח: "0521234567",
      סוג_העסקה: "מכר",
      תיאור_הנכס: "דירת 4 חדרים, הרב שך 12, בני ברק",
      מחיר_משוער: "2,100,000 ₪",
    });
    expect(signed.unfilled).toEqual([]);
    expect(signed.text).toContain("דנה כהן");
    expect(signed.text).toContain("123456789");
    expect(signed.text).toContain("הרב שך 12");
    expect(signed.text).not.toContain(SIGNER_BLANK);
    expect(signed.text).not.toContain("{{");
  });

  it("שדות החותם מכסים את כל פרטי החובה שאינם של המשרד", () => {
    const officeSide: (keyof typeof OFFICE)[] = ["שם_המשרד", "דמי_תיווך", "מועד_תשלום"];
    for (const name of REQUIRED_PLACEHOLDERS.brokerage) {
      expect(
        OPEN_SIGNER_PLACEHOLDERS.includes(name) ||
          (officeSide as string[]).includes(name),
      ).toBe(true);
    }
  });

  it("בלעדיות אינה נִתנת בקישור פתוח — היא על נכס של המשרד", () => {
    expect(agreementAllowsOpenLink("brokerage")).toBe(true);
    expect(agreementAllowsOpenLink("exclusivity")).toBe(false);
  });
});

describe("agreementDealLabel", () => {
  it("מתרגם את שני סוגי העסקה, ושותק על מה שאינו מוכר", () => {
    expect(agreementDealLabel("sale")).toBe("מכר");
    expect(agreementDealLabel("rent")).toBe("שכירות");
    expect(agreementDealLabel(null)).toBe("");
    expect(agreementDealLabel(undefined)).toBe("");
    expect(agreementDealLabel("barter")).toBe("");
  });
});
