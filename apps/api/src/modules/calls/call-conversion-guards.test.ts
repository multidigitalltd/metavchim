import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * ‎**מסך השיחות מציע להמיר ליד — ושתי דרכים להגיע שם למבוי סתום.**
 *
 * שתיהן נתפסו בביקורת ולא בבדיקה, ושתיהן נראות תקינות בקריאה
 * ראשונה. לכן הן נשמרות כאן, כטענות על הקוד עצמו:
 *
 * 1. ‎**בעלות.** ראות שיחה וראות ליד אינן אותו דבר — סוכן יכול
 *    לראות שיחה דרך נכס גלוי לכולם בזמן שהליד שייך לסוכן אחר.
 *    שירותי ההמרה מפעילים `leadOwnershipFilter()` ומחזירים 404,
 *    ולכן השליפה שמזינה את המסך חייבת לסנן באותו פילטר. בלעדיו
 *    המתווך ממלא טופס שלם ואז נתקע.
 * 2. ‎**מפתח לכל שיחה.** טפסי ההמרה משתמשים ב-`defaultValue`, כלומר
 *    שדות שאינם מבוקרים. מפתח קבוע השאיר אותם מחוברים במעבר בין
 *    שיחות, ומה שמולא לשיחה א׳ נשמר **על הכרטיס של ב׳** בשקט.
 *
 * הבדיקה קוראת את הקוד ולא מריצה אותו: שתיהן נוגעות בשילוב של
 * הרשאות, מסד ומחזור חיים של React שאין לו כאן תשתית ריצה.
 */

const read = (url: URL): string =>
  readFileSync(url, "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^[ \t]*\/\/.*$/gmu, "");

const CALLS = read(new URL("./calls.service.ts", import.meta.url));
const PAGE = read(
  new URL("../../../../web/src/app/calls/page.tsx", import.meta.url),
);

describe("ההמרה מתוך השיחה אינה מובילה למבוי סתום", () => {
  it("שליפת סטטוס הליד מסננת בעלות", () => {
    const lookup = CALLS.slice(CALLS.indexOf("tx.lead.findMany"));
    expect(lookup.slice(0, lookup.indexOf("select:"))).toMatch(
      /\.\.\.leadOwnershipFilter\(\)/u,
    );
  });

  /*
   * הסינון חסר ערך אם המסך מסתפק ב„הסטטוס אינו converted”: ליד של
   * סוכן אחר פשוט אינו במפה, וחסר הוא בדיוק מה שצריך לחסום.
   */
  it("המסך דורש נוכחות של הסטטוס ולא רק ערך שאינו converted", () => {
    expect(PAGE).toMatch(/selected\.leadStatus === undefined\) return null;/u);
    expect(PAGE).toMatch(/selected\.leadStatus === "converted"\) return null;/u);
  });

  it("שני טפסי ההמרה ממופתחים לפי מזהה השיחה", () => {
    expect(PAGE).toMatch(/key=\{`buyer-\$\{selected\.id\}`\}/u);
    expect(PAGE).toMatch(/key=\{`property-\$\{selected\.id\}`\}/u);
  });
});
