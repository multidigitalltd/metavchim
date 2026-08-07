import { describe, expect, it } from "vitest";
import {
  describePeople,
  isContactRole,
  isPhoneLabel,
  normalizePhone,
  orderPeople,
  type ContactPerson,
} from "./contact-people.js";

const person = (name: string, role: ContactPerson["role"], id = name): ContactPerson => ({
  contactId: id,
  name,
  phone: "+972501234567",
  role,
});

describe("normalizePhone", () => {
  it("מקומי עם אפס מוביל", () => {
    expect(normalizePhone("050-1234567")).toBe("+972501234567");
  });

  it("מנקה רווחים, מקפים וסוגריים", () => {
    expect(normalizePhone(" (03) 123-4567 ")).toBe("+97231234567");
  });

  it("קידומת בינלאומית בלי פלוס", () => {
    expect(normalizePhone("972501234567")).toBe("+972501234567");
  });

  it("כבר תקין — נשאר כמו שהוא", () => {
    expect(normalizePhone("+972501234567")).toBe("+972501234567");
  });

  // הבדיקה שבגללה הפונקציה חולצה למקום אחד: שני כתיבים של אותו
  // מספר חייבים לייצר את אותה מחרוזת, אחרת ה-hash שונה והאדם נספר פעמיים
  it("שלושה כתיבים של אותו מספר מתלכדים", () => {
    const forms = ["050-123-4567", "+972 50 123 4567", "972501234567"];
    const normalized = new Set(forms.map(normalizePhone));
    expect(normalized.size).toBe(1);
  });

  // מנרמלת בלבד — הפסילה נשארת ב-PhoneSchema, כדי שקלט פגום ייפסל
  // בהודעה ברורה ולא יהפוך בשקט למחרוזת אחרת
  it("אינה מנסה לתקן קלט שאינו טלפון", () => {
    expect(normalizePhone("abc")).toBe("");
  });
});

describe("orderPeople", () => {
  it("הראשי ראשון גם כשהגיע אחרון", () => {
    const result = orderPeople([person("רות", "spouse"), person("דוד", null)]);
    expect(result.map((p) => p.name)).toEqual(["דוד", "רות"]);
  });

  it("שומר על סדר ההוספה של השאר", () => {
    const result = orderPeople([
      person("דוד", null),
      person("רות", "spouse"),
      person("יוסי", "attorney"),
    ]);
    expect(result.map((p) => p.name)).toEqual(["דוד", "רות", "יוסי"]);
  });

  it("רשימה ריקה", () => {
    expect(orderPeople([])).toEqual([]);
  });
});

describe("describePeople", () => {
  it("אדם אחד — שמו", () => {
    expect(describePeople([person("דוד כהן", null)])).toBe("דוד כהן");
  });

  it("שניים — שני השמות", () => {
    expect(describePeople([person("דוד", null), person("רות", "spouse")])).toBe("דוד ורות");
  });

  it("שלושה ומעלה — הראשי ומונה", () => {
    expect(
      describePeople([person("דוד", null), person("רות", "spouse"), person("יוסי", "attorney")]),
    ).toBe("דוד +2");
  });

  it("הראשי מוצג ראשון גם כשאינו ראשון ברשימה", () => {
    expect(describePeople([person("רות", "spouse"), person("דוד", null)])).toBe("דוד ורות");
  });

  it("ריק", () => {
    expect(describePeople([])).toBe("");
  });
});

describe("שערי ערכים", () => {
  it("תפקיד מוכר ולא מוכר", () => {
    expect(isContactRole("spouse")).toBe(true);
    expect(isContactRole("landlord")).toBe(false);
  });

  it("תווית טלפון מוכרת ולא מוכרת", () => {
    expect(isPhoneLabel("mobile")).toBe(true);
    expect(isPhoneLabel("fax")).toBe(false);
  });
});
