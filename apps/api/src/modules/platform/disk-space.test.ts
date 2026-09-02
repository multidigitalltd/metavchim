import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * ‎**ניטור הדיסק והתראותיו.**
 *
 * מה שנשבר כאן אינו חישוב אלא **החלטות**: על איזה נתיב מודדים, דרך
 * איזה ערוץ מתריעים, וכל כמה זמן. כל אחת מהן נראית תקינה בקוד
 * ונכשלת רק בייצור — מדידה על overlay שמדווחת „תקין” בזמן שהמארח
 * מלא, או התראה שנחסמת בגלל מסלול של דייר.
 */

const read = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), "utf8");

const SERVICE = read("./disk-space.service.ts");
const UPDATER = read("../../../../../infra/updater/server.mjs");

describe("ניקוי תמונות אחרי עדכון", () => {
  it("המעדכן מנקה תמונות יתומות בסוף העדכון", () => {
    expect(UPDATER).toContain('"image", "prune", "-f"');
  });

  /*
   * ‎**הבדיקה החשובה כאן.** על אותו מארח רצים שירותים נוספים,
   * ו-`-a` מוחק כל תמונה בלי קונטיינר קיים — כולל של שירות עצור
   * של מישהו אחר, שלא יעלה בלי משיכה מחדש.
   */
  it("בלי -a, כדי לא למחוק תמונות של שירותים אחרים על אותו מארח", () => {
    expect(UPDATER).not.toMatch(/"image",\s*"prune",\s*"-a"/u);
    expect(UPDATER).not.toContain('"system", "prune"');
  });

  it("כישלון ניקוי אינו מפיל עדכון תקין", () => {
    const idx = UPDATER.indexOf('"image", "prune", "-f"');
    const around = UPDATER.slice(Math.max(0, idx - 400), idx + 400);
    expect(around).toContain("try");
    expect(around).toContain("catch");
  });
});

describe("מדידת הדיסק", () => {
  /*
   * הנתיב חייב להיות מוצמד למארח. `statfs` על נתיב פנימי מחזיר את
   * שכבת ה-overlay — מספר שנראה תקין בזמן שהשרת מלא.
   */
  it("ברירת המחדל היא נתיב מוצמד למארח", () => {
    const ENV = read("../../config/env.ts");
    expect(ENV).toContain('DISK_MONITOR_PATH: z.string().default("/backups")');
  });

  it("סף 0 מכבה את הניטור לגמרי", () => {
    expect(SERVICE).toContain("DISK_MIN_FREE_GB === 0");
  });

  /*
   * נתיב שאינו נגיש הוא תקלת הגדרה, לא דיסק מלא. `low: true` שם
   * היה מייצר התראה יומית על בעיה שאינה קיימת.
   */
  it("נתיב שאינו נגיש אינו מדווח כדיסק מלא", () => {
    const fn = SERVICE.slice(SERVICE.indexOf("async status("));
    const body = fn.slice(0, 1400);
    expect(body).toContain("catch");
    expect(body).toMatch(/freeBytes: null[\s\S]*low: false/u);
  });
});

describe("ההתראה", () => {
  it("יוצאת בשלושת הערוצים", () => {
    expect(SERVICE).toContain("this.email.send(");
    expect(SERVICE).toContain("this.whatsapp.sendText(");
    expect(SERVICE).toContain("tx.notification.create");
  });

  /*
   * ערוץ שנכשל אינו מונע את השאר — זו הנקודה שבה מתריעים על תשתית
   * שבורה דרך תשתית שאולי שבורה בעצמה.
   */
  it("כל ערוץ עטוף בנפרד", () => {
    const fn = SERVICE.slice(SERVICE.indexOf("private async alert("));
    const body = fn.slice(0, 3000);
    expect(body.match(/try \{/gu)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  /*
   * בלי חלון שקט: בדיקה כל רבע שעה = 96 הודעות ביום, וזה נגמר
   * בהשתקת הערוץ ולא בפינוי דיסק.
   */
  it("חלון שקט מונע הצפה", () => {
    expect(SERVICE).toContain("REALERT_MS");
    expect(SERVICE).toMatch(/Date\.now\(\) - this\.lastAlertAt < REALERT_MS/u);
  });

  it("התאוששות מאפסת את חלון השקט", () => {
    const fn = SERVICE.slice(SERVICE.indexOf("private async tick("));
    expect(fn.slice(0, 900)).toContain("this.lastAlertAt = null");
  });

  /*
   * דיסק מלא הוא תקלת תשתית ולא פיצ'ר של משרד. שליחה דרך סריקת
   * הדחיפה של הדיירים הייתה נחסמת ע"י שער `voice_intake`.
   */
  it("הוואטסאפ נשלח ישירות ולא דרך שער פיצ'ר של דייר", () => {
    expect(SERVICE).toContain("whatsapp.sendText");
    /*
     * ‏`voice_intake` מוזכר בתיעוד כאן בכוונה — הוא מסביר *למה*
     * עוקפים את הסריקה. מה שאסור הוא **בדיקת** פיצ'ר בקוד: היא
     * שהייתה חוסמת התראת תשתית בגלל מסלול של משרד.
     */
    expect(SERVICE).not.toContain("tenantHasFeature");
    expect(SERVICE).not.toContain("hasFeature(");
    expect(SERVICE).not.toContain("botAllowed");
  });

  it("בלי מנהלי פלטפורמה מוגדרים ההתראה נרשמת ואינה מתפוצצת", () => {
    expect(SERVICE).toContain("admins.length === 0");
  });
});
