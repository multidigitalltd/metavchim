import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { shekels } from "@metavchim/shared";

/**
 * ‎**סכום שנאמר ללקוח הוא הסכום שיירד — עד האגורה.**
 *
 * ## מה נשבר
 *
 * מרגע שהמחירון נטו, כמעט כל חיוב נושא אגורות: 149 ₪ נטו הם
 * 175.82 ₪ בפועל. שני מקומות עיגלו את זה לשקל שלם לפני שהציגו
 * אותו — תזכורת החידוש, שכל תכליתה לומר מה בדיוק יירד מהכרטיס,
 * ויומן התשלומים של הפלטפורמה, שמולו עושים התאמת ספרים (ביקורת
 * Codex).
 *
 * הפער הוא אגורות, ולכן הוא לא מפיל שום בדיקה ולא נראה במסך אחד.
 * הוא נראה כשמצליבים: המייל אמר „176 ₪”, בכרטיס ירדו 175.82, וב-
 * ‏12 חודשים זה 2.16 ₪ שאיש אינו יודע מאיפה.
 *
 * ## למה שער על הקוד ולא בדיקת יחידה
 *
 * שתי הפונקציות בונות מחרוזת בתוך שירות ובתוך רכיב React, ושתיהן
 * דורשות הקשר שלם כדי להריץ. מה שצריך לשמור הוא **שאף אחת מהן לא
 * תחזור לעגל**, וזה נבדק על המקור.
 */

const API = join(import.meta.dirname, "..", "..");
const WEB = join(API, "..", "..", "web", "src");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("shekels המשותפת שומרת אגורות", () => {
  it("מחזירה את המספר המדויק, ולא מעוגל לשקל", () => {
    // 149 ₪ נטו ב-18% — המקרה שהוליד את הממצא
    expect(shekels(17_582)).toBe("175.82");
    expect(shekels(35_282)).toBe("352.82");
  });

  it("סכום עגול נשאר עגול — בלי אפסים מיותרים", () => {
    expect(shekels(14_900)).toBe("149");
    expect(shekels(0)).toBe("0");
  });

  it("אגורה בודדת אינה נבלעת", () => {
    expect(shekels(1)).toBe("0.01");
    expect(shekels(17_501)).toBe("175.01");
  });
});

describe("אין עיגול לשקל במקום שבו נאמר סכום", () => {
  /*
   * ‎`Math.round(x / 100)` הוא הניסוח שיצר את הפער.
   *
   * ‎`[\w.]` ולא `\w`: הגרסה הראשונה של השער תפסה רק מזהה עירום,
   * ולכן `Math.round(row.amountAgorot / 100)` בתיבת הזיכוי חמק
   * ממנה — שער שנותן ביטחון ומחמיץ הוא גרוע משער שאינו קיים
   * (ביקורת Codex).
   */
  const ROUNDED = /Math\.round\(\s*[\w.]*[Aa]gorot\b\s*\/\s*100\s*\)/u;

  for (const [name, path] of [
    ["תזכורת החידוש", join(API, "modules/billing/renewal.service.ts")],
    ["יומן התשלומים", join(WEB, "app/platform/payments-section.tsx")],
  ] as const) {
    it(`${name} אינה מעגלת לשקל`, () => {
      expect(read(path), `${name}: חזר עיגול לשקל על סכום שמוצג ללקוח`).not.toMatch(ROUNDED);
    });
  }

  it("שתיהן נשענות על אותה פונקציה משותפת", () => {
    /*
     * איות רביעי של „אגורות לשקלים” הוא בדיוק איך שנוצר הפער
     * הראשון. שתיהן קוראות ל-`shekels` מ-`packages/shared`.
     */
    expect(read(join(API, "modules/billing/renewal.service.ts"))).toContain(
      "shekels(amountAgorot)",
    );
    expect(read(join(WEB, "app/platform/payments-section.tsx"))).toContain(
      'shekels as formatAgorot } from "@metavchim/shared"',
    );
  });

  /*
   * ‎**הודעת הזיכוי נוקבת במה שזוכה, לא במה שהוקלד.**
   *
   * זיכוי מלא נשלח בלי `amountAgorot`, והשרת מזכה את מלוא התשלום.
   * הודעה שמנסחת את הקלט מדווחת מספר שלא זוכה מעולם.
   */
  it("הודעת הזיכוי נגזרת מהסכום שזוכה", () => {
    const source = read(join(WEB, "app/platform/payments-section.tsx"));
    expect(source).toContain("const full = agorot >= row.amountAgorot;");
    expect(source).toContain("const refunded = full ? row.amountAgorot : agorot;");
    expect(source).toContain("shekels(refunded)");
  });

  /*
   * מקלדת `numeric` אינה מציגה נקודה עשרונית, ולכן זיכוי חלקי
   * באגורות אינו ניתן להקלדה בנייד כלל.
   */
  it("תיבת הזיכוי מאפשרת להקליד אגורות", () => {
    const source = read(join(WEB, "app/platform/payments-section.tsx"));
    expect(source).toContain('inputMode="decimal"');
    expect(source).not.toContain('inputMode="numeric"');
  });
});
