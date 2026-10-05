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
    const write = SERVICE.indexOf("this.notify({");
    const guard = SERVICE.indexOf("if (!written) continue;");
    const send = SERVICE.indexOf("this.push(");
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
    expect(skip).toBeGreaterThan(0);
    expect(skip).toBeLessThan(SERVICE.indexOf("this.notify({"));
    expect(skip).toBeLessThan(SERVICE.indexOf("this.push("));
  });

  /*
   * ‎**וויתור על וואטסאפ אינו משתיק את הפעמון** (ביקורת Codex).
   *
   * ‏זו הטענה שהמסך מבטיח במפורש („גם בלי זה הסיכום ימשיך
   * ‏להופיע בהתראות”) ושתיעוד העמודה חוזר עליה. הסדר
   * ‏במקור הוא מה שהופך אותה לנכונה: הבדיקה יושבת **אחרי**
   * ‏הכתיבה, ולכן אינה יכולה למנוע אותה.
   */
  it("ובדיקת הוואטסאפ יושבת אחרי הכתיבה, לא לפניה", () => {
    const whatsappSkip = SERVICE.indexOf("digestWhatsappSkip({");
    expect(whatsappSkip).toBeGreaterThan(SERVICE.indexOf("if (!written) continue;"));
    expect(whatsappSkip).toBeLessThan(SERVICE.indexOf("this.push("));
  });

  /*
   * ‎**והגוף הוא הסיכום עצמו.** עמוד ההתראות מציג פרטים
   * ‏מ-`body` בלבד, ואין להתראה הזו עוגן לנווט אליו — כלומר
   * ‏גוף ריק הוא „סיכום” שאין בו שום סיכום.
   */
  it("וההתראה נושאת את הטקסט ולא רק כותרת", () => {
    const from = SERVICE.indexOf("const written = await this.notify({");
    const block = SERVICE.slice(from, SERVICE.indexOf("});", from));
    expect(block).toContain("body: text");
    expect(block).not.toContain("body: null");
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
    const from = SERVICE.indexOf("if (await this.push(");
    const block = SERVICE.slice(from, from + 900);
    expect(block).toContain("this.logger.warn(");
  });
});

/**
 * ‎**הקו שעליו נשלח — ולמה הוא השאלה הראשונה.**
 *
 * ‏העוזר האישי עונה לסוכן על קו **הפלטפורמה**, ושם גם
 * ‏נוצר הקישור. שליחה על חיבור המשרד היא מספר אחר לגמרי,
 * ‏שרוב הסוכנים מעולם לא כתבו אליו — והרוב המכריע של
 * ‏המשרדים אפילו אינם מחוברים (ביקורת Codex, P1).
 */
describe("הקו והתבנית", () => {
  it("נשלח על קו הפלטפורמה, ולא על חיבור המשרד", () => {
    expect(SERVICE).toContain("this.whatsapp.sendText(");
    expect(SERVICE).not.toContain("sendAsTenant(");
  });

  /*
   * ‏גם על הקו הנכון, טקסט חופשי עובד רק בתוך חלון 24 השעות,
   * וסיכום חודשי הוא פנייה יזומה מובהקת — אותו סדר של
   * התראת „לקוח ענה במייל”: חופשי קודם, תבנית כשהוא נדחה.
   */
  it("ויש נפילה לתבנית מאושרת", () => {
    const text = SERVICE.indexOf("this.whatsapp.sendText(");
    const template = SERVICE.indexOf("this.whatsapp.sendTemplate(");
    expect(template).toBeGreaterThan(text);
    expect(SERVICE).toContain('whatsappTemplateParams("officeDigest"');
  });

  /*
   * ‎**והעוגן נגזר מהמפתח** (ביקורת Codex, P1).
   *
   * ‏חישוב UTC נפרד נחת בחודש הקודם בשעות הראשונות של
   * ‏חודש ישראלי — מספרים של חודש אחד תחת כותרת של אחר,
   * ‏נעול לצמיתות במפתח הדדופ.
   */
  it("והחודש שנמדד נגזר מאותה מחרוזת שמכתירה אותו", () => {
    expect(SERVICE).toContain('this.analytics.board("month", digestMonthAnchor(monthKey))');
    expect(SERVICE).not.toContain("Date.UTC(");
  });
});

/**
 * ‎**הדיווח למנהל מגיע למנהל** (ביקורת Codex).
 *
 * ‏ללוג השרת אין למנהל משרד גישה, ולכן הסבר שנכתב רק
 * ‏שם אינו קיים מבחינתו.
 */
describe("דיווח המנהל", () => {
  it("נכתב כהתראה ולא רק ללוג", () => {
    const from = SERVICE.indexOf("private async reportToManagers(");
    expect(from).toBeGreaterThan(0);
    const block = SERVICE.slice(from);
    expect(block).toContain("this.notify({");
    expect(block).toContain("digestManagerDedupeKey(monthKey, member.id)");
  });

  /*
   * ‎**למנהלים בלבד.** הדיווח נוקב בשמות סוכנים ובסיבה
   * ‏— „ביקש לא לקבל” הוא נתון על עמית, והתראה לכל המשרד
   * ‏(`userId: null`) היתה חושפת אותו לכולם.
   */
  it("ולפי היכולת בפועל, לא לכל המשרד", () => {
    const block = SERVICE.slice(SERVICE.indexOf("private async reportToManagers("));
    expect(block).toContain('capabilities.has("users.manage")');
    expect(block).toContain("userId: member.id");
    expect(block).not.toContain("userId: null");
  });

  /* ‏והחריגים נקראים בהקשר דייר — אחרת RLS מחזיר אפס בשקט */
  it("והחריגים נקראים בהקשר הדייר", () => {
    const block = SERVICE.slice(SERVICE.indexOf("private async reportToManagers("));
    expect(block).toContain("withExplicitTenant(tenantId,");
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
