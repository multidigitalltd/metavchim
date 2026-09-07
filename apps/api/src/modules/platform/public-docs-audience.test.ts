import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * ‎**התיעוד הציבורי נכתב ללקוחות המערכת — ולא למי שמפעיל אותה**
 * ‏(docs/13 §1).
 *
 * ## למה זו בדיקה ולא כלל שזוכרים
 *
 * הכשל כאן שקט משני צדדים. מי שכותב עמוד הקמה חדש אינו חש שהוא חוצה
 * גבול — זה תיעוד, וזה נכון, פשוט לא לקהל הזה. ומי שקורא אותו הוא
 * מתווך שהגיע מחיפוש, קיבל הוראות שאין לו הרשאה לבצע (מסך
 * ‏`/platform`, System User, App Secret), והסיק שהמוצר דורש אותן
 * ממנו. אף אחד מהשניים אינו מדווח — הראשון לא ידע, השני פשוט הלך.
 *
 * זה קרה ב-`/docs/whatsapp`, ולכן הוא הועבר ל-`docs/14`.
 *
 * ## ולמה הבדיקה בודקת גם התנגשות שמות
 *
 * לאותו עמוד הייתה כתובת זהה להדרכה שמזהה שלה `whatsapp`, ובנתיבי
 * Next.js תיקייה סטטית גוברת על `[topic]`. כלומר ההדרכה למשתמשים לא
 * הייתה נגישה בכתובת שלה: `/docs/md/whatsapp` החזיר אותה,
 * ‏`/docs/whatsapp` החזיר את מסמך ההקמה. אותה כתובת, שני מסמכים,
 * ובלי שגיאה בשום מקום — ולכן זו בדיקה ולא הערה.
 */

const web = (relative: string): string =>
  fileURLToPath(new URL(`../../../../web/src/app/docs/${relative}`, import.meta.url));

const GUIDE_CONTENT = readFileSync(
  fileURLToPath(new URL("../../../../web/src/lib/guide-content.ts", import.meta.url)),
  "utf8",
);

/**
 * מזהי ההדרכות — נקראים מהמקור ולא משוכפלים כאן, כי רשימה מועתקת
 * מתיישנת בשקט וההגנה הייתה נעלמת בדיוק כשמוסיפים הדרכה חדשה.
 */
function guideIds(): string[] {
  const start = GUIDE_CONTENT.indexOf("export const GUIDES");
  const end = GUIDE_CONTENT.indexOf("export const DOC_TOPICS");
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return [...GUIDE_CONTENT.slice(start, end).matchAll(/^ {4}id: "([a-z0-9-]+)",$/gmu)].map(
    (match) => match[1]!,
  );
}

/** התיקיות הסטטיות תחת `/docs` שמגישות עמוד או נתיב. */
function staticSegments(): string[] {
  return readdirSync(web(""))
    .filter((name) => statSync(web(name)).isDirectory())
    /* ‎`[topic]` הוא הנתיב הדינמי עצמו, ו-`md` הוא פורמט ולא נושא */
    .filter((name) => !name.startsWith("[") && name !== "md");
}

describe("התיעוד הציבורי — הקהל", () => {
  /**
   * ‎**המילים שמסגירות מסמך שנכתב למפעיל ולא ללקוח.**
   *
   * לא „מטא” ולא „וואטסאפ” — אלה נושאים לגיטימיים בהדרכה למשרד. מה
   * שמסגיר הוא **מסך שאין למשרד גישה אליו** ו**סודות שאינם שלו**.
   */
  const OPERATOR_MARKERS = [
    "/platform",
    "App Secret",
    "Verify Token",
    "System user",
    "System User",
    "developers.facebook.com",
    "business.facebook.com",
  ];

  it("אין בעמודים הציבוריים הוראות שמיועדות למי שמפעיל את הפלטפורמה", () => {
    const offenders: string[] = [];
    for (const segment of staticSegments()) {
      for (const file of readdirSync(web(segment))) {
        if (!file.endsWith(".tsx") && !file.endsWith(".ts")) continue;
        const source = readFileSync(web(`${segment}/${file}`), "utf8");
        for (const marker of OPERATOR_MARKERS) {
          if (source.includes(marker)) offenders.push(`${segment}/${file} ← ${marker}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("אין בהדרכות עצמן הפניה למסך שאין למשרד גישה אליו", () => {
    /*
     * ‏„Webhook” מותר כאן במפורש: חיבור מרכזייה ואתר הם משימות של
     * המשרד עצמו, במסכים שלו. מה שאסור הוא `/platform`.
     */
    expect(GUIDE_CONTENT).not.toContain("/platform");
  });

  /*
   * ‎**כתובת אחת, מסמך אחד.** תיקייה סטטית ששמה כשם הדרכה גוברת
   * עליה בנתיבי Next.js, וההדרכה נעלמת מהכתובת שלה בלי שגיאה.
   */
  it("אין תיקייה סטטית ששמה כשם הדרכה, כדי שלא תסתיר אותה", () => {
    const ids = guideIds();
    expect(ids.length).toBeGreaterThan(20);
    expect(ids).toContain("whatsapp");
    expect(staticSegments().filter((segment) => ids.includes(segment))).toEqual([]);
  });
});
