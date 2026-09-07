import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isSharedTabuProperty, sharedTabuFit } from "@metavchim/shared";

/**
 * ‎**העובדה על הרישום המשותף חייבת לחצות את גבול המשרד**
 * ‏(ביקורת Codex, P1 ×2).
 *
 * ‏עד שהתכונה הפכה לדגל היא נשאה את עצמה דרך `propertyType`
 * ‏(`shared_tabu`), ולכן הגיעה לרשת בלי שאיש התכוון לכך. מרגע
 * ‏שהיא דגל — ובדיוק בגלל ה-PR הזה — היא נעצרה בגבול:
 *
 * ‏**בנכס:** מודעה של נכס שסומן בתיבה יצאה כרגילה. היא הוצעה
 * ‏לקונה שסירב למושאע, והמשרד המקבל לא ראה את מצב הרישום.
 *
 * ‏**בקונה:** `refuses` לא נסע כלל, והצד השני קרא „טרם נשאל” —
 * ‏כלומר ההתאמה הותרה על סירוב **מפורש**. זה הכיוון החמור, כי
 * ‏סירוב הוא הצהרה של הלקוח ולא העדפה.
 */

const SRC = join(import.meta.dirname);

describe("‏מה שנשמר בפרסום — ומה שמשוחזר ממנו", () => {
  const LISTINGS = readFileSync(join(SRC, "listings.service.ts"), "utf8");
  const COLLAB = readFileSync(join(SRC, "collaboration.service.ts"), "utf8");

  it("‏הפרסום שומר את הדגל — דרך הגזירה, לא דרך השדה הגולמי", () => {
    expect(LISTINGS).toContain("sharedTabu: isSharedTabuProperty(property)");
  });

  it("‏והשחזור מחזיר אותו — גם לניקוד וגם לכרטיס", () => {
    expect(LISTINGS.split("sharedTabu: row.sharedTabu").length - 1).toBe(2);
  });

  it("‏הביקוש שומר את העמדה — דרך הגזירה", () => {
    expect(COLLAB).toContain("sharedTabuStance: buyerSharedTabuStance(requirements) ?? null");
  });

  /*
   * ‏שני שחזורים ולא אחד: `collaboration.service` מנקד את הנכסים
   * ‏שלי מול ביקושי הרשת, ו-`listings.service` את המודעות שלי מול
   * ‏הביקושים. שכפול מודע — ולכן שניהם חייבים לשאת את השדה.
   */
  it("‏ושני השחזורים של הביקוש קוראים אותה", () => {
    for (const [name, source] of [
      ["collaboration.service", COLLAB],
      ["listings.service", LISTINGS],
    ] as const) {
      expect(source, name).toMatch(/demand\.sharedTabuStance === null/u);
    }
  });
});

/**
 * ‎**ומה זה עושה בפועל** — הטענה, ולא צורת הקוד.
 *
 * ‏שתי השורות האלה הן כל ההבדל: מה `sharedTabuFit` מחזיר כשהעמדה
 * ‏נסעה, ומה הוא מחזיר כשהיא אבדה בדרך.
 */
describe("‏סירוב שאבד בדרך מתיר את מה שהלקוח שלל", () => {
  it("‏סירוב שנסע — הנכס נפסל", () => {
    expect(sharedTabuFit(true, "refuses").excluded).toBe(true);
  });

  it("‏וסירוב שאבד — נקרא „טרם נשאל”, וההצעה עוברת", () => {
    expect(sharedTabuFit(true, undefined).excluded).toBe(false);
  });

  /*
   * ‏ובצד הנכס: דגל שאבד הופך אותו לנכס רגיל, ואז גם קונה שסירב
   * ‏מקבל אותו — כי אין מה לפסול.
   */
  it("‏ודגל שאבד — הנכס נראה רגיל", () => {
    expect(isSharedTabuProperty({ sharedTabu: true, propertyType: "apartment" })).toBe(true);
    expect(isSharedTabuProperty({ sharedTabu: false, propertyType: "apartment" })).toBe(false);
  });
});

/**
 * ‎**והסירוב נאכף גם בכתיבה, ולא רק בהתאמה** (ביקורת Codex, P1 ×2).
 *
 * ‏שני המסלולים האוטומטיים מכבדים את העמדה, ולכן קונה שסירב אינו
 * ‏מופיע בהתאמות ונכס בטאבו משותף אינו מוצע לביקוש שסירב. אבל לצד
 * ‏כל אחד מהם יש **בורר ידני** שמונה את הכול — „להציע קונה אחר”
 * ‏ו„בחר נכס להצעה” — ושני נתיבי הכתיבה שמאחוריהם בדקו רק בעלות
 * ‏ומצב שיווק. הכלל נאכף במסלול אחד ולא במקבילו: אותה תקלה, פעמיים.
 */
describe("‏גבול הכתיבה שואל את אותה שאלה", () => {
  const LISTINGS = readFileSync(join(SRC, "listings.service.ts"), "utf8");
  const COLLAB = readFileSync(join(SRC, "collaboration.service.ts"), "utf8");

  /** ‏גוף המתודה: מהחתימה ועד המתודה הבאה באותה רמת הזחה. */
  function body(source: string, signature: string): string {
    const start = source.indexOf(signature);
    expect(start, `${signature} לא נמצאה`).toBeGreaterThan(-1);
    const rest = source.slice(start + signature.length);
    const next = rest.search(/\n {2}(?:async |private |public |\/\*\*)/u);
    return next === -1 ? rest : rest.slice(0, next);
  }

  it("‏פנייה על מודעה נדחית לקונה שסירב", () => {
    expect(body(LISTINGS, "async expressInterest(")).toContain("sharedTabuFit(");
  });

  it("‏הצעת נכס נדחית לביקוש שסירב", () => {
    expect(body(COLLAB, "async offerProperty(")).toContain("sharedTabuFit(");
  });

  /*
   * ‎**וזה החצי החשוב יותר בהצעה: לפני החיוב.**
   *
   * ‏הצעה לליד ממקור חיצוני עולה קרדיטים. שער שיושב אחרי `coopOfferCost`
   * ‏היה גובה על פעולה שנדחית — כלומר לא רק מתיר את מה שאסור, אלא
   * ‏גם מחייב עליו.
   */
  it("‏והשער קודם לחיוב, ולא אחריו", () => {
    const method = body(COLLAB, "async offerProperty(");
    const gate = method.indexOf("sharedTabuFit(");
    const charge = method.indexOf("coopOfferCost(");
    expect(gate).toBeGreaterThan(-1);
    expect(charge).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(charge);
  });

  /*
   * ‏ובביקוש — דרך `demandToRequirements` ולא דרך העמודה הגולמית.
   * ‏ביקוש שפורסם לפני העמודה נושא `sharedTabuStance: null`, והעמדה
   * ‏שלו נגזרת מסוג המבנה הישן; קריאה ישירה הייתה קוראת לו „טרם
   * ‏נשאל” ומתירה את ההצעה דווקא לוותיקים.
   */
  it("‏העמדה נגזרת באותו מסלול שהניקוד ניזון ממנו", () => {
    expect(body(COLLAB, "async offerProperty(")).toContain(
      "buyerSharedTabuStance(this.demandToRequirements(demand))",
    );
  });
});

/**
 * ‎**וההמרה מעמוד השיחות נושאת את הסימון** (ביקורת Codex, P2).
 *
 * ‏הטופס מסמן את התיבה מראש לפי הסימון על הלקוח, אבל רק כרטיס
 * ‏הליד העביר אותו. המרה מעמוד השיחות שלחה `sharedTabu: false`
 * ‏בשקט — כלומר הנכס נוצר בלי האזהרה המשפטית, ללקוח שסומן.
 */
describe("‏הסימון עובר גם במסלול השיחות", () => {
  const CALLS_DTO = readFileSync(
    join(SRC, "..", "calls", "calls.service.ts"),
    "utf8",
  );
  const CALLS_PAGE = readFileSync(
    join(SRC, "..", "..", "..", "..", "web", "src", "app", "calls", "page.tsx"),
    "utf8",
  );

  it("‏ה-DTO של השיחה נושא את הסימון", () => {
    expect(CALLS_DTO).toContain("contactSharedTabu: contact.sharedTabu");
  });

  /*
   * ‏שני מסכי ההמרה, ולא אחד: זו בדיוק הצורה של הממצא — שדה
   * ‏שהגיע לאחד ולא לשני.
   */
  it("‏ושני מסכי ההמרה מעבירים אותו", () => {
    const LEAD_PAGE = readFileSync(
      join(SRC, "..", "..", "..", "..", "web", "src", "app", "leads", "[id]", "page.tsx"),
      "utf8",
    );
    for (const [name, source] of [
      ["calls", CALLS_PAGE],
      ["lead", LEAD_PAGE],
    ] as const) {
      expect(source, name).toMatch(/contactSharedTabu=\{/u);
    }
  });
});
