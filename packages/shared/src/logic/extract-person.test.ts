import { describe, expect, it } from "vitest";
import { extractPersonFromTranscript } from "./extract-person.js";

describe("extractPersonFromTranscript", () => {
  it("מחלץ קונה מלא מתמלול טבעי", () => {
    const { person } = extractPersonFromTranscript(
      'דיברתי עם משה כהן, 050-1234567, מחפש 4 חדרים בבני ברק עד 2.3 מיליון, חייב מעלית וממ"ד, יש לו אישור עקרוני, דחוף',
    );
    expect(person.name).toBe("משה כהן");
    expect(person.phone).toBe("+972501234567");
    expect(person.intent).toBe("buy");
    expect(person.cities).toContain("בני ברק");
    expect(person.budgetMaxAgorot).toBe(230_000_000);
    expect(person.roomsMin).toBe(4);
    expect(person.features.hasElevator).toBe("must");
    expect(person.financing).toBe("pre_approved");
    expect(person.maturity).toBe("very_hot");
  });

  it("מזהה טווח חדרים וטווח תקציב", () => {
    const { person } = extractPersonFromTranscript(
      "לקוח מחפש 3-4 חדרים בפתח תקווה, בין 1.5 ל-2 מיליון",
    );
    expect(person.roomsMin).toBe(3);
    expect(person.roomsMax).toBe(4);
    expect(person.budgetMinAgorot).toBe(150_000_000);
    expect(person.budgetMaxAgorot).toBe(200_000_000);
  });

  it("מזהה מוכר ולא מבלבל עם קונה", () => {
    const { person } = extractPersonFromTranscript("שרה לוי רוצה למכור דירה בחיפה, 052-9876543");
    expect(person.intent).toBe("sell");
    expect(person.name).toBe("שרה לוי");
    expect(person.phone).toBe("+972529876543");
  });

  it("מזהה שוכר וסוג עסקה שכירות", () => {
    const { person } = extractPersonFromTranscript("בחור מחפש לשכור דירה באשדוד עד 5,000 שקל");
    expect(person.intent).toBe("rent_in");
    expect(person.dealType).toBe("rent");
    expect(person.budgetMaxAgorot).toBe(500_000);
  });

  it("מבחין בין 'חייב' ל'רוצה' במאפיינים", () => {
    const { person } = extractPersonFromTranscript("חייב חניה, רוצה מרפסת");
    expect(person.features.hasParking).toBe("must");
    expect(person.features.hasBalcony).toBe("nice");
  });

  it("מזהה מזומן ובשלות נמוכה", () => {
    const { person } = extractPersonFromTranscript("מתעניין, במזומן, רק בודק לא ממהר");
    expect(person.financing).toBe("cash");
    expect(person.maturity).toBe("not_ripe");
  });

  it("'מחפש דירה להשכרה' הוא ביקוש לשכירות ולא מכירה", () => {
    const { person } = extractPersonFromTranscript("לקוח מחפש דירה להשכרה בחיפה");
    expect(person.intent).toBe("rent_in");
    expect(person.dealType).toBe("rent");
  });

  it("מאפיין שנשלל אינו הופך לדרישה", () => {
    const { person } = extractPersonFromTranscript("מחפש דירה בלי מעלית, לא צריך חניה");
    expect(person.features.hasElevator).toBeUndefined();
    expect(person.features.hasParking).toBeUndefined();
  });

  it("תמלול ריק מחזיר כוונה לא ידועה בלי לזרוק", () => {
    const { person } = extractPersonFromTranscript("");
    expect(person.intent).toBe("unknown");
    expect(person.cities).toEqual([]);
  });

  it("לא לוכד מילת תפקיד כשם", () => {
    const { person } = extractPersonFromTranscript("דיברתי עם לקוח שמחפש דירה");
    expect(person.name).toBeUndefined();
  });
});
