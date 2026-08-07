import { describe, expect, it } from "vitest";
import {
  groupDuplicates,
  normalizeNameForMatch,
  pickSurvivor,
  type DuplicateCandidate,
} from "./duplicate-contacts.js";

const at = (iso: string) => new Date(iso);

const candidate = (
  contactId: string,
  activity: number,
  createdAt: string,
  name = "דוד כהן",
): DuplicateCandidate => ({
  contactId,
  name,
  phone: "+972501234567",
  activity,
  createdAt: at(createdAt),
});

describe("normalizeNameForMatch", () => {
  it("רווח בקצה ורווחים כפולים", () => {
    expect(normalizeNameForMatch("  דוד   כהן ")).toBe(normalizeNameForMatch("דוד כהן"));
  });

  it("גרשיים וגרש", () => {
    expect(normalizeNameForMatch('דוד כ"ץ')).toBe(normalizeNameForMatch("דוד כץ"));
  });

  it("רישיות באנגלית", () => {
    expect(normalizeNameForMatch("David Cohen")).toBe(normalizeNameForMatch("david cohen"));
  });

  // מכוון: מיזוג שגוי של שני אנשים הוא נזק שקשה לתקן, החמצה היא
  // רק אי-נוחות. לכן אין ניחוש של ראשי תיבות.
  it("אינו מנחש ראשי תיבות", () => {
    expect(normalizeNameForMatch("ד. כהן")).not.toBe(normalizeNameForMatch("דוד כהן"));
  });

  it("שמות שונים נשארים שונים", () => {
    expect(normalizeNameForMatch("דוד כהן")).not.toBe(normalizeNameForMatch("דוד לוי"));
  });
});

describe("pickSurvivor", () => {
  it("הפעיל יותר שורד", () => {
    const result = pickSurvivor([candidate("a", 1, "2024-01-01"), candidate("b", 9, "2025-01-01")]);
    expect(result?.contactId).toBe("b");
  });

  // בתיקו הוותיק שורד: הוא זה שהמזהה שלו כבר נשלח החוצה בהצעות
  it("בתיקו — הוותיק שורד", () => {
    const result = pickSurvivor([candidate("new", 3, "2025-06-01"), candidate("old", 3, "2023-01-01")]);
    expect(result?.contactId).toBe("old");
  });

  it("רשימה ריקה", () => {
    expect(pickSurvivor([])).toBeNull();
  });

  it("מועמד יחיד", () => {
    expect(pickSurvivor([candidate("only", 0, "2025-01-01")])?.contactId).toBe("only");
  });
});

describe("groupDuplicates", () => {
  const withKey = (c: DuplicateCandidate, nameKey: string) => ({ ...c, nameKey });

  it("שני כרטיסים באותו שם — קבוצה אחת, השורד מחוץ לרשימת הכפילויות", () => {
    const groups = groupDuplicates([
      withKey(candidate("a", 5, "2024-01-01"), "k1"),
      withKey(candidate("b", 1, "2025-01-01"), "k1"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.survivor.contactId).toBe("a");
    expect(groups[0]?.duplicates.map((d) => d.contactId)).toEqual(["b"]);
  });

  // הדשבורד לא אמור להציע פעולה שאין בה טעם
  it("כרטיס בודד אינו כפילות", () => {
    expect(groupDuplicates([withKey(candidate("a", 1, "2024-01-01"), "k1")])).toEqual([]);
  });

  it("שמות שונים אינם מתקבצים יחד", () => {
    const groups = groupDuplicates([
      withKey(candidate("a", 1, "2024-01-01"), "k1"),
      withKey(candidate("b", 1, "2024-01-01"), "k2"),
    ]);
    expect(groups).toEqual([]);
  });

  it("שלושה עותקים — שניים למיזוג", () => {
    const groups = groupDuplicates([
      withKey(candidate("a", 9, "2024-01-01"), "k1"),
      withKey(candidate("b", 1, "2024-02-01"), "k1"),
      withKey(candidate("c", 0, "2024-03-01"), "k1"),
    ]);
    expect(groups[0]?.duplicates).toHaveLength(2);
  });

  it("הקבוצה הגדולה מוצגת ראשונה", () => {
    const groups = groupDuplicates([
      withKey(candidate("a", 1, "2024-01-01"), "small"),
      withKey(candidate("b", 1, "2024-02-01"), "small"),
      withKey(candidate("c", 1, "2024-01-01"), "big"),
      withKey(candidate("d", 1, "2024-02-01"), "big"),
      withKey(candidate("e", 1, "2024-03-01"), "big"),
    ]);
    expect(groups[0]?.key).toBe("big");
  });
});
