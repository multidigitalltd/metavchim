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
/* ‎`read` מסיר הערות, ולכן מה שנבדק כאן הוא קוד בלבד. */
const FORMS = read(
  new URL("../../../../web/src/app/leads/convert-sections.tsx", import.meta.url),
);

/** גוף הרכיב, מההצהרה ועד ההצהרה הבאה. */
const component = (name: string): string => {
  const start = FORMS.indexOf(`export function ${name}(`);
  expect(start, `${name} אינו בקובץ`).toBeGreaterThan(-1);
  const next = FORMS.indexOf("\nexport function ", start + 1);
  return FORMS.slice(start, next === -1 ? undefined : next);
};

/**
 * מה שרץ בשליחה בלבד — מראש הרכיב ועד ה-JSX.
 *
 * ‎**החיתוך הוא מה שנותן לבדיקה שיניים:** בתוך ה-JSX השם מופיע ממילא
 * כ-`name="roomsMin"`, ולכן חיפוש על הרכיב כולו היה מסתפק בקיום
 * השדה ומאשר בדיוק את הבאג — שדה שמצויר ואינו נשלח.
 */
const submitBody = (name: string): string => {
  const body = component(name);
  const jsx = body.indexOf("if (!open)");
  expect(jsx, `${name}: לא נמצא הגבול בין השליחה ל-JSX`).toBeGreaterThan(-1);
  return body.slice(0, jsx);
};

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

  /*
   * ‎**שדה שמולא מראש ואינו נשלח — איבוד נתונים שקט** (ביקורת Codex).
   *
   * ‎`prefill.rooms` הועבר לשני הטפסים, אבל טופס הקונה לא הציג אותו
   * ולא שלח `roomsMin`/`roomsMax`. שיחה של „מחפש 4 חדרים” יצרה
   * כרטיס בלי דרישת חדרים — והמסך הראה „הומר” בלי לרמוז שמשהו נפל.
   *
   * הטענה כאן היא על **המחלקה** ולא על השדה: כל שדה שמצויר מ-
   * ‎`prefill` חייב להיקרא בשליחה של אותו טופס. שדה חדש שיצויר ולא
   * יישלח ייפול כאן בלי שאיש יזכור את הבאג הזה.
   */
  for (const name of ["ConvertSection", "ConvertToPropertySection"] as const) {
    it(`${name} — כל שדה שמולא מראש נשלח`, () => {
      const body = component(name);
      const fields = body
        .split(/<(?:input|select)\b/u)
        .slice(1)
        .filter((element) => element.includes("prefill?."))
        .map((element) => /name="([^"]+)"/u.exec(element)?.[1]);
      expect(fields.length, "אין שדות שמולאו מראש").toBeGreaterThan(0);
      /*
       * השם ולא `f.get(...)` מילולי: שדה יכול להיקרא גם דרך עוזר
       * (`optionalNumber(f, "roomsMin")`), וזו קריאה לכל דבר.
       */
      const submit = submitBody(name);
      for (const field of fields) {
        expect(field, "שדה שמולא מראש בלי name").toBeDefined();
        expect(submit, `${field}: מצויר מ-prefill ואינו נקרא בשליחה`).toContain(
          `"${field}"`,
        );
      }
    });
  }

  /*
   * ‎**מספר אחד, שני גבולות.** קטלוג הפעולות של הסוכן הקולי כבר קבע
   * ש„4 חדרים” הם גם המינימום וגם המקסימום. אותו משפט חייב לייצר את
   * אותו כרטיס בין אם הגיע מהסוכן ובין אם מהמרה במסך.
   */
  it("החדרים שנשמעו בשיחה ממלאים את שני הגבולות", () => {
    const body = component("ConvertSection");
    for (const bound of ["roomsMin", "roomsMax"]) {
      expect(body, `${bound} אינו ממולא מהשיחה`).toMatch(
        new RegExp(`name="${bound}"[\\s\\S]{0,120}?defaultValue=\\{prefill\\?\\.rooms`, "u"),
      );
    }
  });
});
