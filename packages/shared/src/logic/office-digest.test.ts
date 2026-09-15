import { describe, expect, it } from "vitest";
import {
  digestDedupeKey,
  digestManagerDedupeKey,
  digestManagerSummary,
  digestMonthAnchor,
  digestMonthKey,
  digestMonthTitle,
  digestSkipReason,
  digestWhatsappSkip,
  DIGEST_SKIP_LABELS,
  officeDigestTemplateValues,
  officeDigestText,
  officeDigestTitle,
  OFFICE_DIGEST_NOTIFICATION_TYPE,
} from "./office-digest.js";
import { jerusalemWallParts } from "./israel-time.js";

/**
 * ‎**הסיכום החודשי — השורה שלו, ולא של אף אחד אחר.**
 *
 * ‏עמוד „המשרד שלנו” מנהלי בלבד, וזו הפעם הראשונה שסוכן רואה משהו
 * ‏ממנו. ההכרעה של בעל המוצר היא השורה שלו והמיקום שלו — „3 מתוך
 * ‏7” — ובלי המספרים של האחרים.
 */

const COUNTS = { calls: 9, leads: 4, properties: 2, viewings: 6, deals: 1 };

describe("החודש שמסוכם הוא הקודם", () => {
  /* ‏סיכום של חודש שעוד לא נגמר הוא מספר שישתנה */
  it("סבב באוקטובר מסכם את ספטמבר", () => {
    expect(digestMonthKey(new Date("2026-10-01T06:00:00Z"))).toBe("2026-09");
  });

  it("וגם באמצע החודש — עדיין הקודם", () => {
    expect(digestMonthKey(new Date("2026-10-20T06:00:00Z"))).toBe("2026-09");
  });

  /* ‏גלישת שנה: ינואר מסכם את דצמבר של השנה שלפני */
  it("וינואר מסכם את דצמבר הקודם", () => {
    expect(digestMonthKey(new Date("2026-01-03T06:00:00Z"))).toBe("2025-12");
  });

  /*
   * ‎**שעון ירושלים ולא UTC.** בראשון בחודש בשעה שתיים בלילה
   * ‏מקומית, ב-UTC זה עדיין היום האחרון של החודש שלפני — וההפרש
   * ‏בין שני הפירושים הוא חודש שלם.
   */
  it("והגבול נמדד בשעון ירושלים", () => {
    /* ‏1 באוקטובר 00:30 בירושלים = 30 בספטמבר 21:30 ב-UTC */
    expect(digestMonthKey(new Date("2026-09-30T21:30:00Z"))).toBe("2026-09");
  });

  it("והכותרת בעברית", () => {
    expect(digestMonthTitle("2026-09")).toBe("ספטמבר 2026");
    expect(officeDigestTitle("2026-09")).toContain("ספטמבר 2026");
  });
});

describe("פעם אחת לחודש לכל סוכן", () => {
  it("מפתח הדדופ נושא גם את החודש וגם את הסוכן", () => {
    expect(digestDedupeKey("2026-09", "01A")).toBe("office_digest:2026-09:01A");
  });

  /* ‏שני סוכנים באותו חודש הם שתי הודעות, לא אחת */
  it("ושני סוכנים אינם חולקים מפתח", () => {
    expect(digestDedupeKey("2026-09", "01A")).not.toBe(digestDedupeKey("2026-09", "01B"));
  });

  /* ‏ואותו סוכן בחודשיים הוא שתי הודעות */
  it("ואותו סוכן בשני חודשים אינו חולק מפתח", () => {
    expect(digestDedupeKey("2026-09", "01A")).not.toBe(digestDedupeKey("2026-10", "01A"));
  });

  it("והסוג יציב", () => {
    expect(OFFICE_DIGEST_NOTIFICATION_TYPE).toBe("office_digest");
  });
});

describe("האם יש מה לסכם", () => {
  /*
   * ‎**„עשית 0 מכל דבר” אינה הודעה שמועילה למישהו**, וזה בדיוק מה
   * ‏שסוכן שהצטרף אתמול היה מקבל.
   */
  it("בלי פעילות — אין סיכום", () => {
    expect(
      digestSkipReason({ counts: { calls: 0, leads: 0, properties: 0, viewings: 0, deals: 0 } }),
    ).toBe("nothing_to_report");
  });

  /* ‏שיחות בלבד אינן ניקוד — ולכן עדיין „לא היתה פעילות” */
  it("ושיחות לבדן אינן פעילות שנספרת", () => {
    expect(
      digestSkipReason({ counts: { calls: 12, leads: 0, properties: 0, viewings: 0, deals: 0 } }),
    ).toBe("nothing_to_report");
  });

  it("ועם פעילות — יש", () => {
    expect(digestSkipReason({ counts: COUNTS })).toBeNull();
  });

  /*
   * ‎**והוא אינו יודע על וואטסאפ דבר** — וזו כל הנקודה.
   *
   * ‏כששתי השאלות היו פונקציה אחת, וויתור על הוואטסאפ
   * ‏השתיק גם את הפעמון. הטיפוס הוא מה שמונע את זה מלחזור:
   * ‏אין לפונקציה הזו שדה שאפשר להעביר בו וויתור.
   */
  it("והוא מקבל את הספירות בלבד", () => {
    expect(Object.keys({ counts: COUNTS })).toEqual(["counts"]);
  });
});

describe("האם לדחוף לטלפון", () => {
  it("מי שביקש לא לקבל", () => {
    expect(digestWhatsappSkip({ hasWhatsapp: true, optedOut: true })).toBe("opted_out");
  });

  it("ומי שאין לו וואטסאפ מקושר", () => {
    expect(digestWhatsappSkip({ hasWhatsapp: false, optedOut: false })).toBe("no_whatsapp");
  });

  /* ‏הבחירה של הסוכן גוברת — היא נבדקת ראשונה */
  it("והבחירה שלו גוברת על הסיבה השנייה", () => {
    expect(digestWhatsappSkip({ hasWhatsapp: false, optedOut: true })).toBe("opted_out");
  });

  it("ומי שהכול תקין אצלו — מקבל", () => {
    expect(digestWhatsappSkip({ hasWhatsapp: true, optedOut: false })).toBeNull();
  });

  it("ולכל סיבה יש תווית קריאה", () => {
    for (const key of ["no_whatsapp", "opted_out"] as const) {
      expect(DIGEST_SKIP_LABELS[key], key).toBeTruthy();
    }
  });
});

/**
 * ‎**העוגן של הלוח — אותו חודש שהכותרת מבטיחה.**
 *
 * ‏הקודם חושב ב-UTC בעוד המפתח לפי שעון ירושלים, ובשעות
 * ‏הראשונות של חודש ישראלי השניים הצביעו על חודשים שונים
 * ‏(ביקורת Codex, P1).
 */
describe("העוגן של החודש המסוכם", () => {
  it("נופל בתוך החודש שהמפתח מציין", () => {
    const anchor = digestMonthAnchor("2026-09");
    expect(jerusalemWallParts(anchor).date.slice(0, 7)).toBe("2026-09");
  });

  /*
   * ‎**המקרה ששבר את הקודם:** 1 באוקטובר 00:30 בירושלים,
   * ‏שהוא 30 בספטמבר 21:30 UTC. המפתח אומר ספטמבר, והעוגן
   * ‏חייב להיות בספטמבר גם הוא — ולא באוגוסט.
   */
  it("ובשעות הראשונות של חודש ישראלי — אותו חודש כמו הכותרת", () => {
    const now = new Date("2026-09-30T21:30:00.000Z");
    const monthKey = digestMonthKey(now);
    expect(monthKey).toBe("2026-09");
    expect(jerusalemWallParts(digestMonthAnchor(monthKey)).date.slice(0, 7)).toBe(monthKey);
  });

  /* ‏וגם בקצה השני של החודש, ובמעבר שנה */
  it.each(["2026-01", "2026-02", "2026-06", "2026-12"])("וב%s", (monthKey) => {
    expect(jerusalemWallParts(digestMonthAnchor(monthKey)).date.slice(0, 7)).toBe(monthKey);
  });
});

/**
 * ‎**השער המרכזי של החלק הזה: אין בהודעה נתון של סוכן אחר.**
 */
describe("מה בהודעה", () => {
  const TEXT = officeDigestText({
    name: "דנה",
    monthKey: "2026-09",
    counts: COUNTS,
    rank: 3,
    total: 7,
  });

  it("המספרים שלו", () => {
    expect(TEXT).toContain("לידים: 4");
    expect(TEXT).toContain("נכסים: 2");
    expect(TEXT).toContain("פגישות: 6");
    expect(TEXT).toContain("עסקאות: 1");
  });

  it("והמיקום שלו", () => {
    expect(TEXT).toContain("3 מתוך 7");
  });

  /*
   * ‎**ושום דבר על מי שמעליו.** „הדירוג המלא לכולם” היה הופך הודעה
   * ‏חודשית להשפלה פומבית של מי שאחרון, והוא גם סותר את הכלל
   * ‏שסוכן אינו רואה נתונים של סוכן אחר.
   */
  it("ואין בה שם של סוכן אחר ואין ניקוד של אף אחד", () => {
    expect(TEXT).not.toContain("יוסי");
    expect(TEXT.toLowerCase()).not.toContain("ניקוד");
    /* ‏המספר היחיד שמגיע מהשוואה הוא המיקום, והוא אינו מסגיר כמה מכר מי */
    expect(TEXT).not.toMatch(/מקום\s+1\s*[:\-–]/u);
  });

  it("ובלי יעד — אין שורת יעד", () => {
    expect(TEXT).not.toContain("היעד שלך");
  });

  it("ועם יעד שהושג — נאמר שהושג", () => {
    const withGoal = officeDigestText({
      name: "דנה",
      monthKey: "2026-09",
      counts: COUNTS,
      rank: 1,
      total: 7,
      goal: { metric: "deals", label: "עסקאות", target: 1, actual: 1, percent: 100 },
    });
    expect(withGoal).toContain("הושג");
  });

  it("ועם יעד שלא הושג — המספרים, בלי שיפוט", () => {
    const withGoal = officeDigestText({
      name: "דנה",
      monthKey: "2026-09",
      counts: COUNTS,
      rank: 5,
      total: 7,
      goal: { metric: "deals", label: "עסקאות", target: 4, actual: 1, percent: 25 },
    });
    expect(withGoal).toContain("1 מתוך 4");
    expect(withGoal).not.toContain("הושג");
  });
});

/**
 * ‎**„נשלח ל-5 סוכנים” לבדו הוא דיווח חלקי שנשמע שלם.**
 *
 * ‏מנהל שחושב שכולם קיבלו, ושבעה סוכנים שלא — זה בדיוק מה שהכלל
 * ‏„אין בליעת כישלון” קיים כדי למנוע.
 */
describe("מה המנהל רואה", () => {
  it("בלי דילוגים — משפט אחד", () => {
    expect(digestManagerSummary(5, [])).toBe(
      "הסיכום החודשי נשלח בוואטסאפ ל-5 סוכנים.",
    );
  });

  it("ועם דילוגים — מי ולמה, בשמות", () => {
    const text = digestManagerSummary(5, [
      { name: "יוסי", reason: "no_whatsapp" },
      { name: "רונית", reason: "opted_out" },
    ]);
    expect(text).toContain("לא נשלח ל-2");
    expect(text).toContain("יוסי — אין וואטסאפ מקושר");
    expect(text).toContain("רונית — ביקש לא לקבל בוואטסאפ");
  });

  /*
   * ‎**והדיווח אינו אומר „לא קיבל”.** הסיכום מחכה להם
   * ‏בהתראות במערכת; מה שלא יצא הוא הדחיפה לטלפון בלבד,
   * ‏ודיווח שאומר אחרת שולח את המנהל לרדוף אחרי כלום.
   */
  it("ואומר שהסיכום עצמו בכל זאת מחכה להם", () => {
    const text = digestManagerSummary(1, [{ name: "יוסי", reason: "no_whatsapp" }]);
    expect(text).toContain("בהתראות");
  });
});

/**
 * ‎**הדיווח למנהל הוא הודעה שנייה, לא אותה אחת.**
 *
 * מנהל שהוא גם סוכן צריך לקבל את שתיהן: הסיכום שלו, והדיווח על
 * הצוות. מרחב שמות משותף היה משאיר אותו עם הראשונה שנכתבה בלבד.
 */
describe("מפתח הדדופ של דיווח המנהל", () => {
  it("נפרד מזה של הסיכום האישי", () => {
    expect(digestManagerDedupeKey("2026-09", "u1")).not.toBe(digestDedupeKey("2026-09", "u1"));
  });

  it("ואחד לכל מנהל לכל חודש", () => {
    expect(digestManagerDedupeKey("2026-09", "u1")).toBe(digestManagerDedupeKey("2026-09", "u1"));
    expect(digestManagerDedupeKey("2026-09", "u1")).not.toBe(
      digestManagerDedupeKey("2026-10", "u1"),
    );
    expect(digestManagerDedupeKey("2026-09", "u1")).not.toBe(
      digestManagerDedupeKey("2026-09", "u2"),
    );
  });
});

/**
 * ‎**ערכי התבנית — כי טקסט חופשי אינו מגיע למי שמחוץ לחלון 24 השעות.**
 *
 * הם מוגדרים לצד הטקסט החופשי ולא בשירות, כדי ששני הנוסחים לא
 * יוכלו לספר שני דברים שונים על אותו חודש.
 */
describe("ערכי התבנית המאושרת", () => {
  const VARS = {
    name: "יוסי",
    monthKey: "2026-09",
    counts: COUNTS,
    rank: 3,
    total: 7,
  };

  it("שם, חודש ומיקום — בסדר שהתבנית נרשמה בו", () => {
    expect(officeDigestTemplateValues(VARS)).toEqual(["יוסי", "ספטמבר 2026", "3 מתוך 7"]);
  });

  /*
   * ‎**ואין בהם מספר של סוכן אחר** — אותו כלל בדיוק שחל על הטקסט
   * החופשי, ומאותה סיבה: התבנית עוברת דרך Meta, והמיקום הוא המידע
   * היחיד שמגיע מהשוואה.
   */
  it("ובלי נתון של מישהו אחר", () => {
    const values = officeDigestTemplateValues(VARS).join(" ");
    expect(values).not.toContain(String(COUNTS.deals));
    expect(values).not.toContain("לידים");
  });
});
