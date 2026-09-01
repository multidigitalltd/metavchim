import { describe, expect, it } from "vitest";
import {
  activeOfficeStatuses,
  buyerStatusChangeLine,
  addOfficeStatus,
  DEFAULT_OFFICE_STATUSES,
  MAX_OFFICE_STATUS_LABEL,
  MAX_OFFICE_STATUSES,
  maturityForStatus,
  nextOfficeStatusId,
  officeStatusById,
  officeStatusLabel,
  officeStatuses,
  removeOfficeStatus,
  statusAfterMaturityChange,
  updateOfficeStatus,
  type OfficeBuyerStatus,
} from "./buyer-status.js";

const LIST: OfficeBuyerStatus[] = [
  { id: "s1", label: "ליד חדש", maturity: "interested", archived: false },
  { id: "s2", label: "בסבב סיורים", maturity: "hot", archived: false },
  { id: "s3", label: "ישן", maturity: "not_ripe", archived: true },
];

describe("קריאת הרשימה מהגדרות המשרד", () => {
  /*
   * ‎**ההבחנה שקובעת אם הפיצ'ר מכבד את המשתמש.** משרד שמחק את כל
   * הסטטוסים ביקש לעבוד עם שכבה א' בלבד; החייאת ברירות המחדל בטעינה
   * הבאה הייתה מבטלת את הפעולה שלו בשקט, שוב ושוב.
   */
  it("חסר מוחלט מחזיר ברירות מחדל, ורשימה ריקה נשארת ריקה", () => {
    expect(officeStatuses(undefined)).toEqual([...DEFAULT_OFFICE_STATUSES]);
    expect(officeStatuses(null)).toEqual([...DEFAULT_OFFICE_STATUSES]);
    expect(officeStatuses([])).toEqual([]);
  });

  /* רשומה פגומה אחת — ייבוא, עריכה ידנית — לא מפילה את הרשימה. */
  it("ערך פגום יורד לבדו והשאר עובד", () => {
    const list = officeStatuses([
      { id: "s1", label: "תקין", maturity: "hot", archived: false },
      { id: "לא מזהה", label: "פגום", maturity: "hot" },
      { id: "s2", label: "א", maturity: "hot" },
      { id: "s3", label: "דרגה לא קיימת", maturity: "פושר" },
      { id: "s4", label: "גם תקין", maturity: "not_ripe" },
    ]);
    expect(list.map((entry) => entry.id)).toEqual(["s1", "s4"]);
  });

  it("מזהה כפול נשמר פעם אחת", () => {
    const list = officeStatuses([
      { id: "s1", label: "ראשון", maturity: "hot" },
      { id: "s1", label: "שני", maturity: "not_ripe" },
    ]);
    expect(list).toHaveLength(1);
    expect(list[0]!.label).toBe("ראשון");
  });

  it("לא יותר מהתקרה", () => {
    const many = Array.from({ length: MAX_OFFICE_STATUSES + 5 }, (_, i) => ({
      id: `s${i + 1}`,
      label: `שלב ${i + 1}`,
      maturity: "hot",
    }));
    expect(officeStatuses(many)).toHaveLength(MAX_OFFICE_STATUSES);
  });

  it("ערך שאינו מערך מחזיר ברירות מחדל", () => {
    expect(officeStatuses("לא מערך")).toEqual([...DEFAULT_OFFICE_STATUSES]);
    expect(officeStatuses({ s1: "ליד חדש" })).toEqual([...DEFAULT_OFFICE_STATUSES]);
  });

  it("ברירות המחדל עצמן עוברות את הסכימה", () => {
    expect(officeStatuses([...DEFAULT_OFFICE_STATUSES])).toEqual([
      ...DEFAULT_OFFICE_STATUSES,
    ]);
  });
});

describe("קריאת סטטוס", () => {
  /*
   * ‎**זו כל הנקודה של הסתרה במקום מחיקה:** כרטיס שנושא סטטוס ישן
   * ממשיך להציג את שמו, גם כשהוא כבר לא ניתן לבחירה.
   */
  it("מוסתר יוצא מהבוררים ונשאר קריא", () => {
    expect(activeOfficeStatuses(LIST).map((e) => e.id)).toEqual(["s1", "s2"]);
    expect(officeStatusLabel(LIST, "s3")).toBe("ישן");
    expect(officeStatusById(LIST, "s3")?.archived).toBe(true);
  });

  it("מזהה לא מוכר, ריק ו-null אינם מפילים כלום", () => {
    expect(officeStatusLabel(LIST, "s99")).toBe("");
    expect(officeStatusLabel(LIST, "")).toBe("");
    expect(officeStatusLabel(LIST, null)).toBe("");
    expect(maturityForStatus(LIST, undefined)).toBeNull();
  });

  it("הסטטוס גורר את הדרגה", () => {
    expect(maturityForStatus(LIST, "s2")).toBe("hot");
  });
});

describe("שינוי דרגה ידני מול סטטוס קיים", () => {
  /*
   * שתי השכבות גלויות שתיהן, ולכן הן יכולות לסתור. „במשא ומתן”
   * שמסומן „לא בשל” הוא כרטיס שקורא שני דברים הפוכים.
   */
  it("דרגה סותרת מורידה את הסטטוס", () => {
    expect(statusAfterMaturityChange(LIST, "s2", "not_ripe")).toBeNull();
  });

  it("אותה דרגה משאירה אותו — אין סתירה ואין מה למחוק", () => {
    expect(statusAfterMaturityChange(LIST, "s2", "hot")).toBe("s2");
  });

  it("בלי סטטוס אין מה להוריד", () => {
    expect(statusAfterMaturityChange(LIST, null, "very_hot")).toBeNull();
    expect(statusAfterMaturityChange(LIST, "s99", "very_hot")).toBeNull();
  });
});

describe("עריכת הרשימה", () => {
  it("הוספה מקבלת מזהה חדש", () => {
    const res = addOfficeStatus(LIST, { label: "ממתין למשכנתא", maturity: "hot" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.id).toBe("s4");
    expect(res.list).toHaveLength(4);
    expect(officeStatusLabel(res.list, "s4")).toBe("ממתין למשכנתא");
  });

  /*
   * ‎**המונה נגזר מהמקסימום ולא מהאורך.** אחרת מחיקה באמצע הרשימה
   * הייתה משחררת מזהה שכרטיס עדיין מצביע עליו, והסטטוס הבא שנוצר
   * היה יורש כרטיסים שלא שייכים לו.
   */
  it("מזהה שנמחק באמצע אינו ממוחזר", () => {
    const afterRemove = removeOfficeStatus(LIST, "s2", false);
    expect(afterRemove.ok).toBe(true);
    if (!afterRemove.ok) return;
    expect(nextOfficeStatusId(afterRemove.list)).toBe("s4");
  });

  it("מזהה שאינו במונה אינו מבלבל את המונה", () => {
    expect(nextOfficeStatusId([{ id: "abc", label: "ידני", maturity: "hot", archived: false }])).toBe(
      "s1",
    );
  });

  /* שתי גרסאות של אותו שם הן שני שלבים שאיש לא יבדיל ביניהם. */
  it("תווית כפולה בקיפול נדחית", () => {
    const res = addOfficeStatus(LIST, { label: "  ליד   חדש ", maturity: "hot" });
    expect(res).toEqual({ ok: false, error: "כבר קיים סטטוס בשם הזה" });
  });

  it("גם מול סטטוס מוסתר", () => {
    const res = addOfficeStatus(LIST, { label: "ישן", maturity: "hot" });
    expect(res).toEqual({ ok: false, error: "כבר קיים סטטוס בשם הזה" });
  });

  it("שם קצר מדי נדחה בהוספה ובעריכה", () => {
    expect(addOfficeStatus(LIST, { label: " א ", maturity: "hot" })).toEqual({
      ok: false,
      error: "שם הסטטוס קצר מדי",
    });
    expect(updateOfficeStatus(LIST, "s1", { label: "" })).toEqual({
      ok: false,
      error: "שם הסטטוס קצר מדי",
    });
  });

  it("תקרה מלאה נדחית", () => {
    const full = Array.from({ length: MAX_OFFICE_STATUSES }, (_, i) => ({
      id: `s${i + 1}`,
      label: `שלב ${i + 1}`,
      maturity: "hot" as const,
      archived: false,
    }));
    expect(addOfficeStatus(full, { label: "עוד אחד", maturity: "hot" })).toEqual({
      ok: false,
      error: "רשימת הסטטוסים מלאה",
    });
  });

  it("תווית ארוכה נחתכת ואינה נדחית", () => {
    const res = addOfficeStatus([], { label: "א".repeat(200), maturity: "hot" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.list[0]!.label).toHaveLength(MAX_OFFICE_STATUS_LABEL);
  });

  it("עריכה משנה תווית ודרגה ומשאירה מזהה", () => {
    const res = updateOfficeStatus(LIST, "s2", { label: "בסיורים", maturity: "very_hot" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(officeStatusById(res.list, "s2")).toEqual({
      id: "s2",
      label: "בסיורים",
      maturity: "very_hot",
      archived: false,
    });
  });

  it("עריכה לאותה תווית של עצמו מותרת", () => {
    const res = updateOfficeStatus(LIST, "s2", { label: "בסבב סיורים", maturity: "very_hot" });
    expect(res.ok).toBe(true);
  });

  it("סטטוס שלא נמצא", () => {
    expect(updateOfficeStatus(LIST, "s99", { label: "משהו" })).toEqual({
      ok: false,
      error: "הסטטוס לא נמצא",
    });
    expect(removeOfficeStatus(LIST, "s99", false)).toEqual({
      ok: false,
      error: "הסטטוס לא נמצא",
    });
  });

  /*
   * ‎**מחיקה של סטטוס בשימוש היא מחיקת מידע.** היא לא נחסמת „עד
   * שיתפנה” אלא מוחלפת בהסתרה — אותה תוצאה בתפריט, בלי לגעת
   * בכרטיסים שנושאים אותו.
   */
  it("מחיקה כשהסטטוס בשימוש הופכת להסתרה", () => {
    const res = removeOfficeStatus(LIST, "s2", true);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.list).toHaveLength(3);
    expect(officeStatusById(res.list, "s2")?.archived).toBe(true);
  });

  it("מחיקה כשאיש אינו נושא אותו מוציאה אותו מהרשימה", () => {
    const res = removeOfficeStatus(LIST, "s2", false);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.list.map((e) => e.id)).toEqual(["s1", "s3"]);
  });

  it("החזרה משימוש", () => {
    const res = updateOfficeStatus(LIST, "s3", { archived: false });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(activeOfficeStatuses(res.list).map((e) => e.id)).toEqual(["s1", "s2", "s3"]);
  });

  /* עריכה אינה רודפת אחורה: המקור אינו משתנה. */
  it("הפונקציות אינן משנות את הרשימה שקיבלו", () => {
    const before = JSON.stringify(LIST);
    addOfficeStatus(LIST, { label: "חדש לגמרי", maturity: "hot" });
    updateOfficeStatus(LIST, "s1", { label: "שונה" });
    removeOfficeStatus(LIST, "s1", false);
    expect(JSON.stringify(LIST)).toBe(before);
  });
});

describe("השורה שנרשמת בציר הזמן", () => {
  const line = (over: Partial<Parameters<typeof buyerStatusChangeLine>[0]>): string =>
    buyerStatusChangeLine({
      statuses: LIST,
      pickedStatus: false,
      statusMoved: false,
      maturityMoved: false,
      beforeStatus: null,
      afterStatus: null,
      beforeMaturity: "interested",
      afterMaturity: undefined,
      ...over,
    });

  /*
   * ‎**זו הטענה המרכזית:** בחירת סטטוס מזיזה גם את הדרגה, והציר
   * צריך לספר על **פעולה אחת**. שתי שורות היו נקראות כמו שני דברים
   * שקרו — כלומר היסטוריה שגויה במקום שבו מסבירים ללקוח מה קרה.
   */
  it("בחירת סטטוס נרשמת כשורה אחת, גם כשהדרגה זזה איתה", () => {
    expect(
      line({
        pickedStatus: true,
        statusMoved: true,
        maturityMoved: true,
        beforeStatus: "s1",
        afterStatus: "s2",
        afterMaturity: "hot",
      }),
    ).toBe("סטטוס: ליד חדש ← בסבב סיורים");
  });

  it("סטטוס ראשון וסטטוס שהוסר מקבלים מקף ולא ריק", () => {
    expect(line({ pickedStatus: true, statusMoved: true, afterStatus: "s1" })).toBe(
      "סטטוס: — ← ליד חדש",
    );
    expect(
      line({ pickedStatus: true, statusMoved: true, beforeStatus: "s1", afterStatus: null }),
    ).toBe("סטטוס: ליד חדש ← —");
  });

  it("שינוי דרגה בלבד נרשם כדרגה", () => {
    expect(line({ maturityMoved: true, afterMaturity: "very_hot" })).toBe(
      "בשלות: מתעניין ← חם מאוד",
    );
  });

  /*
   * הסטטוס לא „נעלם”: הוא ירד בגלל הדרגה החדשה, וזה מה שהמתווך
   * צריך לדעת כשיחפש אותו ולא ימצא.
   */
  it("דרגה שהפילה סטטוס סותר אומרת זאת באותה שורה", () => {
    expect(
      line({
        maturityMoved: true,
        statusMoved: true,
        beforeStatus: "s2",
        afterStatus: null,
        beforeMaturity: "hot",
        afterMaturity: "not_ripe",
      }),
    ).toBe("בשלות: חם ← לא בשל · הסטטוס „בסבב סיורים” הוסר");
  });

  it("קביעה חוזרת של אותו ערך אינה נרשמת", () => {
    expect(line({})).toBe("");
    expect(line({ pickedStatus: true, statusMoved: false })).toBe("");
  });
});
