import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * ‎**הסיכום החודשי — מה השער שומר עליו.**
 *
 * ‏שלושה כללים, וכל אחד מהם נשבר בשקט אם מישהו יסדר מחדש את הקוד:
 * ‏הודעה אחת לחודש, הבחירה של הסוכן, ומה שנשלח אליו.
 */

const SERVICE = readFileSync(
  new URL("./office-digest.service.ts", import.meta.url),
  "utf8",
);

describe("פעם אחת לחודש", () => {
  /*
   * ‎**ההתראה היא המנעול.** אין טבלה חדשה: `notifyOnce` כותב עם
   * ‏מפתח דדופ, וה-`ON CONFLICT` הוא מה שמבטיח הודעה אחת — גם אם
   * ‏הסבב ירוץ עשר פעמים ביום.
   */
  it("הכתיבה עוברת ב-notifyOnce עם מפתח החודש", () => {
    expect(SERVICE).toContain("notifyOnce(");
    expect(SERVICE).toContain("digestDedupeKey(monthKey, row.userId)");
  });

  /*
   * ‎**נרשם קודם, נשלח אחר כך.** שליחה שקודמת לכתיבה פירושה
   * ‏שקריסה באמצע שולחת שוב בסבב הבא — כלומר שתי הודעות לאותו
   * ‏סוכן על אותו חודש.
   */
  it("והשליחה קורית רק אחרי שהכתיבה הצליחה", () => {
    const write = SERVICE.indexOf("notifyOnce(");
    const guard = SERVICE.indexOf("if (!written) continue;");
    const send = SERVICE.indexOf("this.whatsapp.sendAsTenant(");
    expect(write).toBeGreaterThan(0);
    expect(guard).toBeGreaterThan(write);
    expect(send).toBeGreaterThan(guard);
  });

  /*
   * ‎**ואין תנאי „היום הראשון בחודש”.** שרת שהיה למטה באותו יום
   * ‏היה מפספס את החודש כולו; הדדופ מטפל בזה בלי לאבד כלום.
   */
  it("ואין תנאי תאריך שמחליף את הדדופ", () => {
    expect(SERVICE).not.toMatch(/getDate\(\)\s*===\s*1/u);
  });
});

describe("הבחירה של הסוכן", () => {
  /* ‏כלל אחד — `digestSkipReason` — ולא שלושה תנאים מפוזרים */
  it("הדילוג נגזר מהכלל המשותף", () => {
    expect(SERVICE).toContain("digestSkipReason({");
  });

  it("והוא נקרא לפני כל כתיבה או שליחה", () => {
    const skip = SERVICE.indexOf("digestSkipReason({");
    expect(skip).toBeLessThan(SERVICE.indexOf("notifyOnce("));
    expect(skip).toBeLessThan(SERVICE.indexOf("this.whatsapp.sendAsTenant("));
  });

  /*
   * ‎**קישור מנותק אינו קישור.** `revokedAt` הוא „היה ונותק”, ושליפה
   * ‏בלעדיו הייתה שולחת למספר שהסוכן כבר ניתק.
   */
  it("וקישור וואטסאפ מנותק אינו נחשב", () => {
    expect(SERVICE).toContain("revokedAt: null");
  });
});

describe("מה נשלח, ולמי", () => {
  /* ‏הטקסט נבנה בשיתופי ולא נכתב כאן — עותק שני היה סוטה */
  it("הטקסט נבנה ב-officeDigestText ולא בשירות", () => {
    expect(SERVICE).toContain("officeDigestText({");
    expect(SERVICE).not.toMatch(/`.*לידים:\s*\$\{/u);
  });

  /*
   * ‎**וכל סוכן מקבל את השורה שלו.** `row` הוא השורה של הנמען
   * ‏עצמו בלולאה, ומה שנשלח בנוי ממנה בלבד — לא מהטבלה.
   */
  it("והנתונים בהודעה הם של הנמען עצמו", () => {
    const from = SERVICE.indexOf("officeDigestText({");
    const block = SERVICE.slice(from, SERVICE.indexOf("});", from));
    expect(block).toContain("counts: row.counts");
    expect(block).toContain("rank: row.rank");
    /* ‏הכולל הוא מספר הסוכנים — לא הנתונים שלהם */
    expect(block).toContain("total: board.agents");
    expect(block).not.toContain("board.rows");
  });

  /*
   * ‎**כישלון שליחה אינו נבלע.** זה אותו כלל שכבר קיים על כל
   * ‏שליחה במערכת: ערוץ שנפל נרשם, ולא נעלם.
   */
  it("וכישלון שליחה נרשם", () => {
    const from = SERVICE.indexOf("this.whatsapp.sendAsTenant(");
    const block = SERVICE.slice(from, from + 900);
    expect(block).toContain("this.logger.warn(");
  });
});

describe("ביטול ההצטרפות הוא של הסוכן", () => {
  const SETTINGS = readFileSync(
    new URL("../settings/settings.controller.ts", import.meta.url),
    "utf8",
  );

  /*
   * ‎**ולא של המנהל.** `settings.manage` על הנתיב הזה היה נותן
   * ‏למנהל לכבות בשם סוכן — בדיוק ההפרדה שביטול הצטרפות קיים
   * ‏כדי לשמור.
   */
  it("הנתיב אינו דורש settings.manage", () => {
    const from = SETTINGS.indexOf('@Get("office-digest")');
    expect(from).toBeGreaterThan(0);
    const block = SETTINGS.slice(from, SETTINGS.indexOf('@Get("automations")', from));
    expect(block).not.toContain("@RequireCapability");
  });

  /* ‏והוא כותב את עצמו בלבד — מזהה מההקשר, לא מהבקשה */
  it("והוא כותב רק את המשתמש המחובר", () => {
    const from = SETTINGS.indexOf('@Patch("office-digest")');
    const block = SETTINGS.slice(from, SETTINGS.indexOf('@Get("automations")', from));
    expect(block).toContain("TenantContext.current()");
    expect(block).toContain("where: { id: userId }");
  });
});
