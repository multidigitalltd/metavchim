import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * ‎**„כמה הממוצע למ״ר בשכונה” — ומה יהפוך את התשובה לשקר.**
 *
 * ‏החישוב עצמו בדוק בצד המשותף (`price-per-sqm.test.ts`). מה שנבדק
 * ‏כאן הוא **מה נכנס לחישוב**, וזה החלק שאפשר לשבור בשורה אחת בלי
 * ‏שאף בדיקה תרגיש:
 *
 * 1. ‏מ״ר של שכירות ומ״ר של מכירה הם שני סדרי גודל. ממוצע שמערבב
 *    ‏אותם אינו שגוי במעט — הוא חסר משמעות.
 * 2. ‏„אותה שכונה” ו„אותה עיר” כבר מוכרעים במקום אחד. שוויון
 *    ‏מחרוזות כאן היה כלל **שני** לאותה שאלה, ו„קרית אונו” מול
 *    ‏„קריית אונו” היו שתי ערים — הצורה שכבר נפלה כאן ארבע פעמים.
 * 3. ‏נכס שמשווים אותו לעצמו מושך את הממוצע אליו.
 */

const service = readFileSync(new URL("./properties.service.ts", import.meta.url), "utf8");
const benchmark = service.slice(
  service.indexOf("async priceBenchmark("),
  service.indexOf("async list(query: {"),
);

describe("אמת המידה של המחיר למ״ר", () => {
  it("נשענת רק על נכסים באותו סוג עסקה", () => {
    expect(benchmark).toContain("dealType: subject.dealType");
  });

  it("ורק על מצבים שהמחיר בהם אומר משהו", () => {
    expect(benchmark).toContain("status: { in: [...PRICE_BENCHMARK_STATUSES] }");
  });

  it("ואינה סופרת את הנכס עצמו", () => {
    expect(benchmark).toContain("id: { not: subject.id }");
  });

  /*
   * ‎**הקיפול, ולא השוואת מחרוזות.** שתי הפונקציות האלה הן אותן
   * ‏שההתאמות רצות לפיהן — וזו כל הסיבה שהסינון נעשה ב-JS ולא
   * ‏ב-`where`.
   */
  it("„אותה שכונה” נקבע בקיפול המשותף ולא בהשוואת מחרוזות", () => {
    expect(benchmark).toContain("neighborhoodSame(row.neighborhood ?? \"\", wanted)");
  });

  it("ו„אותה עיר” באותו נרמול של שמות מקום", () => {
    expect(benchmark).toContain("normalizeLocationName(city) === cityKey");
  });

  /*
   * ‏נכס בלי שכונה אינו „שכונה ריקה” שאליה שייכים כל מי שגם להם
   * ‏אין — זו קבוצה שאין לה משמעות, והממוצע עליה נראה אמיתי.
   */
  it("נכס בלי שכונה אינו מקבל השוואת שכונה", () => {
    expect(benchmark).toContain('wanted === ""');
  });

  /*
   * ‎**התקרה חלה בתוך העיר, ולא על המשרד כולו.**
   *
   * ‏תקרה משרדית שסוננה לעיר אחריה נותנת לנכסים בערים אחרות לדחוק
   * ‏החוצה את בני ההשוואה של העיר הנדונה: אמת המידה נעלמת אף שיש
   * ‏מדגם, או משתנה כשמוסיפים מלאי שאינו קשור (ביקורת Codex).
   *
   * ‏הסדר הוא מה שנבדק: קיבוץ הערים **לפני** שליפת הנכסים, והתקרה
   * ‏על השנייה.
   */
  it("ויש תקרה לשליפה — בתוך העיר, ולא לפני הסינון אליה", () => {
    expect(benchmark).toContain('tx.property.groupBy({ by: ["city"], where: comparable })');
    expect(benchmark).toContain("where: { ...comparable, city: { in: sameCity } }");
    expect(benchmark).toContain("take: BENCHMARK_SCAN_LIMIT");
    expect(benchmark.indexOf("groupBy")).toBeLessThan(benchmark.indexOf("take: BENCHMARK_SCAN_LIMIT"));
  });

  /*
   * ‏עיר שאין בה ולו נכס השוואתי אחד חוסכת את השליפה השנייה —
   * ‏ו„אין מה להשוות” הוא `null`, לא ממוצע על רשימה ריקה.
   */
  it("ועיר בלי בני השוואה חוזרת מיד", () => {
    expect(benchmark).toContain("if (sameCity.length === 0) return");
  });
});
