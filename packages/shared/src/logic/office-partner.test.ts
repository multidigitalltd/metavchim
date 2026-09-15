import { describe, expect, it } from "vitest";
import {
  DEAL_STATUSES,
  DEAL_STATUS_LABELS,
  PARTNER_LIMIT,
  PARTNER_REJECTION_MESSAGES,
  partnerDealLine,
  partnerRejection,
  partnerSectionNote,
  partnerShare,
} from "./office-partner.js";
import { BOARD_WEIGHTS, boardScore } from "./office-board.js";

/**
 * ‎**שת״פ בתוך המשרד — תיעוד, ולא חישוב.**
 *
 * ‏ההכרעה של בעל המוצר היא שהסימון **אינו נוגע בניקוד**, וזו לא
 * ‏החלטה טכנית: ברגע שסימון משנה דירוג, כל סימון הוא ויכוח וסוכן
 * ‏שמפסיד נקודות פשוט לא מסמן — כלומר השדה שנועד לתעד שיתוף היה
 * ‏מייצר בדיוק את ההפך.
 */

describe("הכלל שמכריע סימון", () => {
  const OFFICE = ["01A", "01B", "01C"];

  it("סוכן מהמשרד, שאינו המטפל — מתקבל", () => {
    expect(
      partnerRejection({ agentUserId: "01A", partnerUserId: "01B", officeUserIds: OFFICE }),
    ).toBeNull();
  });

  /* ‏„שת״פ” של אדם עם עצמו אינו שת״פ, והוא שורה שקרית בסיכום */
  it("והמטפל עצמו נדחה", () => {
    expect(
      partnerRejection({ agentUserId: "01A", partnerUserId: "01A", officeUserIds: OFFICE }),
    ).toBe("same_agent");
  });

  /* ‏שם של אדם ממשרד אחר על עסקה שלנו הוא בדיוק מה שאסור לחצות */
  it("ומי שאינו במשרד נדחה", () => {
    expect(
      partnerRejection({ agentUserId: "01A", partnerUserId: "01Z", officeUserIds: OFFICE }),
    ).toBe("not_in_office");
  });

  /* ‏בלי „צד ראשון” אין למי לצרף שני */
  it("ונכס בלי סוכן מטפל אינו יכול לקבל שותף", () => {
    expect(
      partnerRejection({ agentUserId: null, partnerUserId: "01B", officeUserIds: OFFICE }),
    ).toBe("no_agent");
  });

  /*
   * ‎**ניקוי מותר תמיד** — גם על נכס בלי סוכן מטפל. הוא חזרה למצב
   * ‏שהיה ואינו טוען דבר; חסימתו הייתה כולאת סימון שגוי בנכס שבדיוק
   * ‏נותק ממנו הסוכן.
   */
  it("וניקוי מותר בכל מצב", () => {
    expect(
      partnerRejection({ agentUserId: null, partnerUserId: "", officeUserIds: [] }),
    ).toBeNull();
    expect(
      partnerRejection({ agentUserId: "01A", partnerUserId: "", officeUserIds: OFFICE }),
    ).toBeNull();
  });

  it("ולכל דחייה יש הודעה קריאה", () => {
    for (const key of ["same_agent", "not_in_office", "no_agent"] as const) {
      expect(PARTNER_REJECTION_MESSAGES[key], key).toBeTruthy();
    }
  });
});

/**
 * ‎**השער המרכזי: הניקוד אינו יודע על שותף.**
 *
 * ‏אם מישהו יוסיף אי פעם משקל לשת״פ, הבדיקה הזו תיפול — וזו בדיוק
 * ‏המטרה. ההכרעה היא מוצרית ולא נסתרת בקוד.
 */
describe("הניקוד אינו מושפע", () => {
  it("המשקלים הם ארבעת המדדים בלבד", () => {
    expect(Object.keys(BOARD_WEIGHTS).sort()).toEqual([
      "deals",
      "leads",
      "properties",
      "viewings",
    ]);
  });

  it("ואין בהם שת״פ בשום צורה", () => {
    for (const key of Object.keys(BOARD_WEIGHTS)) {
      expect(key.toLowerCase()).not.toContain("partner");
    }
  });

  /* ‏אותה עסקה, עם שותף ובלי — אותו ציון. אין דרך אחרת לומר את זה */
  it("ושתי עסקאות זהות מקבלות אותו ציון בלי קשר לשת״פ", () => {
    const counts = { calls: 4, leads: 3, properties: 2, viewings: 1, deals: 1 };
    expect(boardScore(counts)).toBe(boardScore({ ...counts }));
    expect(boardScore(counts)).toBe(
      BOARD_WEIGHTS.leads * 3 +
        BOARD_WEIGHTS.properties * 2 +
        BOARD_WEIGHTS.viewings * 1 +
        BOARD_WEIGHTS.deals * 1,
    );
  });
});

describe("„עסקה” היא אותה הגדרה כמו בניקוד", () => {
  it("נמכר והושכר, ולא יותר", () => {
    expect([...DEAL_STATUSES]).toEqual(["sold", "rented"]);
  });

  it("ולכל אחד תווית עברית", () => {
    for (const status of DEAL_STATUSES) {
      expect(DEAL_STATUS_LABELS[status], status).toBeTruthy();
    }
  });

  /* ‏שניים ולא רשימה — הכרעת בעל המוצר, ומכאן שזו עמודה ולא טבלה */
  it("ושני משתתפים, לא יותר", () => {
    expect(PARTNER_LIMIT).toBe(2);
  });
});

describe("מה שנקרא במסך", () => {
  const deal = {
    propertyId: "01P",
    address: "אחוזה 12, רעננה",
    status: "sold" as const,
    closedAt: new Date("2026-09-01T00:00:00Z"),
    agentName: "דנה",
    partnerName: "יוסי",
  };

  /*
   * ‎**הסדר הוא המידע**: הראשון הוא הסוכן המטפל — מי שהעסקה רשומה
   * ‏עליו ומי שהניקוד הלך אליו. „X ו-Y” היה מוחק את ההבחנה.
   */
  it("„המטפל עם השותף” — ובסדר הזה", () => {
    expect(partnerDealLine(deal)).toBe("דנה עם יוסי — אחוזה 12, רעננה (נמכר)");
  });

  it("והתווית נגזרת מהסטטוס ולא נכתבת ביד", () => {
    expect(partnerDealLine({ ...deal, status: "rented" })).toContain(
      DEAL_STATUS_LABELS.rented,
    );
  });

  it("וההסבר אומר במפורש שהניקוד אינו מושפע", () => {
    expect(partnerSectionNote()).toContain("הניקוד");
  });
});

describe("„3 מתוך 12”", () => {
  it("אחוז מעוגל", () => {
    expect(partnerShare(3, 12)).toEqual({ partnered: 3, deals: 12, percent: 25 });
  });

  /*
   * ‎`null` ולא 0: „0%” על מכנה אפס הוא מספר שהומצא, ולא עובדה —
   * ‏אותו כלל בדיוק שכבר קיים ב-`delta` של הלוח.
   */
  it("ובלי עסקאות — אין אחוז, לא אפס", () => {
    expect(partnerShare(0, 0).percent).toBeNull();
  });

  it("והכול משתתפים — 100%", () => {
    expect(partnerShare(4, 4).percent).toBe(100);
  });
});
