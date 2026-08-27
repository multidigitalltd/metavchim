import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";

import { rule } from "./israel-time.mjs";

/*
 * ‎**המנתח נלקח מ-`typescript-eslint` ולא מ-`@typescript-eslint/parser`.**
 *
 * הצורה השנייה עבדה כאן ונפלה ב-CI: היא אינה תלות מוצהרת של השורש,
 * ופתרון שמצליח בעץ אחד ונכשל באחר הוא **בדיוק** המחלקה שהפילה את
 * הפרודקשן ב-#279. ‎`typescript-eslint` כן מוצהרת, והיא מייצאת את
 * אותו מנתח בעצמה — כלומר אין כאן ויתור אלא הסרת תלות מיותרת.
 */

/**
 * ‎**מה שהשער הקודם לא יכול היה לתפוס, ומה שהוא כן.**
 *
 * ‎`verify:timezone` תפס 24 באגים אמיתיים, ובכל זאת **ארבעה סבבי
 * ביקורת רצופים ב-#242 היו אותו דבר בדיוק** — איות חוקי של אותו API
 * שהתבניות לא מנו. כל האיותים האלה יושבים כאן כמקרים, ולא כדי לתעד
 * היסטוריה: הם הצורה שתיכתב שוב.
 *
 * ‎**וגם הקוד התקין יושב כאן.** כלל שמסמן קוד נכון מלמד למחוק
 * סימונים, וזה הורג שערים מהר יותר מכל חור — לכן `valid` ארוך כמו
 * ‎`invalid`.
 */

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaVersion: 2022, sourceType: "module", ecmaFeatures: { jsx: true } },
  },
});

ruleTester.run("device-clock", rule, {
  valid: [
    // אזור זמן מפורש — הדרך הנכונה, ואסור שתסומן
    `d.toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" });`,
    `new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem" }).format(d);`,
    `Intl.DateTimeFormat("he-IL", { timeZone: TZ }).format(d);`,
    // וריאנטי UTC הם הדרך, ואינם ברשימה מעצם היותה מפורשת
    `d.getUTCHours();`,
    `d.setUTCDate(1);`,
    `new Date(Date.UTC(2026, 1, 1));`,
    // מחרוזת עם Z היא רגע מוחלט
    `new Date("2026-03-27T02:30:00Z");`,
    // ארגומנט יחיד — לא בנאי רב-ארגומנטי
    `new Date(iso);`,
    `new Date(Date.now() - ms);`,
    // חיתוך באורך חותמת מלאה אינו תווית של „היום”
    `new Date().toISOString().slice(0, 24);`,
    // מתודה בשם דומה על אובייקט אחר אינה שלנו
    `router.parse("x");`,
    // הסימונים — כל אחד בתחומו
    `d.getHours(); // נושא-שעת-קיר`,
    `new Date(2026, 1, 1); // נושא-שעת-קיר`,
    `Intl.DateTimeFormat("he-IL").format(d); // שעון-המכשיר-במכוון`,
    // שדה עם ההמרה שלו
    {
      code: `const v = resolveJerusalemLocalInput(s, null); const el = <input type="datetime-local" />;`,
    },
  ],

  invalid: [
    /* ‎**ארבעת האיותים שחמקו מהשער הקודם, אחד-אחד.** */
    { code: `Intl.DateTimeFormat("he-IL").format(d);`, errors: [{ messageId: "intl" }] },
    { code: `Date();`, errors: [{ messageId: "callable" }] },
    { code: `globalThis.Date();`, errors: [{ messageId: "callable" }] },
    { code: `new globalThis.Date(2026, 1, 1);`, errors: [{ messageId: "ctorArgs" }] },

    /*
     * ‎**והכינוי — הגבול שהשער הקודם תיעד כבלתי-פתיר בטקסט.**
     * שתי צורות: השמה מקומית, וייבוא בשם אחר.
     */
    {
      code: `const F = Intl.DateTimeFormat; F("he-IL").format(d);`,
      errors: [{ messageId: "intl" }],
    },
    {
      code: `const G = globalThis.Intl.DateTimeFormat; new G("he-IL").format(d);`,
      errors: [{ messageId: "intl" }],
    },

    /* שאר המשפחה */
    { code: `new Intl.DateTimeFormat("he-IL").format(d);`, errors: [{ messageId: "intl" }] },
    { code: `window.Date();`, errors: [{ messageId: "callable" }] },
    { code: `new Date(2026, 1, 1);`, errors: [{ messageId: "ctorArgs" }] },
    { code: `new Date("2026-03-27T02:30");`, errors: [{ messageId: "ctorWall" }] },
    { code: 'new Date(`${day}T23:59:59`);', errors: [{ messageId: "ctorWall" }] },
    { code: `d.toLocaleString("he-IL");`, errors: [{ messageId: "locale" }] },
    { code: `d.toDateString();`, errors: [{ messageId: "locale" }] },
    { code: `d.getHours();`, errors: [{ messageId: "read" }] },
    { code: `d.getTimezoneOffset();`, errors: [{ messageId: "read" }] },
    { code: `d.setHours(1);`, errors: [{ messageId: "write" }] },
    { code: `Date.parse("2026-01-01");`, errors: [{ messageId: "parse" }] },
    { code: `new Date().toISOString().slice(0, 10);`, errors: [{ messageId: "utcToday" }] },
    { code: `new Date().toISOString().split("T")[0];`, errors: [{ messageId: "utcToday" }] },

    /*
     * ‎**„נושא שעת קיר” אינו פטור גורף.** הוא מצהיר שה-`Date` הזה
     * הוא מכל של שעת קיר — לא שהעיצוב מותר להיות בשעון המכשיר.
     */
    {
      code: `Intl.DateTimeFormat("he-IL").format(d); // נושא-שעת-קיר`,
      errors: [{ messageId: "intl" }],
    },

    /*
     * ‎**סופרים ולא שואלים „האם קיים”.** קובץ עם שני מסלולים — יצירה
     * ועריכה — נתן לאחד מהם לחזור לבנייה ידנית בזמן שהאזכור של השני
     * מחזיק את השער ירוק.
     */
    {
      code: `const el = <><input type="datetime-local" /><input type="datetime-local" /></>; resolveJerusalemLocalInput(a, null);`,
      errors: [{ messageId: "field" }],
    },
  ],
});

// ‏RuleTester זורק בכישלון; הגעה לכאן היא ההצלחה.
console.log("israel-time/device-clock — כל המקרים עברו");
