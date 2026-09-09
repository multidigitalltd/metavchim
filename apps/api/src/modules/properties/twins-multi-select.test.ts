import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * ‎**סימון כמה נכסים תואמים בבת אחת** (בקשת המשתמש).
 *
 * ‏מי שמסמן „עוד כמה כאלה” מתכוון לרוב ליותר מאחד, ופתיחת הבורר
 * ‏מחדש לכל נכס — עם החיפוש שמתאפס וההערה שנכתבת שוב — היא בדיוק
 * ‏העבודה הידנית שהלשונית נבנתה כדי לחסוך.
 *
 * ‏הבדיקה קוראת את הקוד ואינה מריצה אותו: אין כאן תשתית ריצה
 * ‏ל-React, ומה שנשמר הן הטענות שאפשר לאבד בשקט בעריכה הבאה —
 * ‏אותה גישה של שער ההמרה במסך השיחות.
 */

const PICKER = readFileSync(
  new URL("../../../../web/src/app/properties/[id]/property-twins.tsx", import.meta.url),
  "utf8",
);

/**
 * ‏גוף `add()` בלבד, **בלי הערות** — הטענות כאן הן על הקוד. ההערה
 * ‏שמסבירה למה לא להשתמש ב-`linkedIds` מזכירה אותו בשמו, וסריקה
 * ‏שכוללת הערות הייתה מוצאת אותו ומכשילה את הטענה ההפוכה.
 */
function addBody(): string {
  const start = PICKER.indexOf("async function add()");
  expect(start, "לא נמצאה `add` — הסריקה אינה קוראת").toBeGreaterThan(-1);
  const open = PICKER.indexOf("{", start);
  let depth = 0;
  let end = open;
  for (; end < PICKER.length; end += 1) {
    if (PICKER[end] === "{") depth += 1;
    else if (PICKER[end] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return PICKER.slice(open, end)
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^[ \t]*\/\/.*$/gmu, "");
}

describe("הבורר מסמן כמה נכסים", () => {
  /* ‏בחירה יחידה הייתה מחזירה את המסך לנכס אחד בכל פתיחה */
  it("הבחירה היא רשימה, והלחיצה מחליפה מצב", () => {
    expect(PICKER).toContain("useState<string[]>([])");
    expect(PICKER).toContain("chosen.includes(row.id)");
    expect(PICKER).toContain("prev.filter((id) => id !== row.id)");
  });

  /* ‏קורא מסך שאינו רואה „אפשר לבחור כמה” יבחר אחד ויסגור */
  it("והרשימה מצהירה על בחירה מרובה", () => {
    expect(PICKER).toContain('aria-multiselectable="true"');
  });

  /*
   * ‎**הכיתוב נוקב במספר.** לחיצה על „סימון כנכס תואם” אחרי בחירת
   * ‏חמישה הייתה מפתיעה בכמה נשמרו.
   */
  it("והכפתור אומר כמה ייסמנו", () => {
    expect(PICKER).toContain("chosen.length > 1 ? `סימון ${chosen.length} נכסים`");
  });
});

describe("השמירה", () => {
  /*
   * ‎**התקרה נבדקת לפני השליחה, ומהכלל המשותף.**
   *
   * ‏בלעדיה חמישה נבחרים כשיש מקום לשניים היו נשמרים חלקית,
   * ‏והמתווך היה מגלה זאת מהרשימה. `twinBatchRejectionReason` הוא
   * ‏אותו כלל שהשרת אוכף, ולא עותק שני לצידו.
   */
  it("נעצרת לפני השליחה כשאין מקום לכולם", () => {
    const body = addBody();
    expect(body).toContain("twinBatchRejectionReason(twins.length, chosen.length)");
    const guard = body.indexOf("twinBatchRejectionReason");
    const firstPost = body.indexOf("apiPost");
    expect(guard, "הבדיקה חייבת לקדום לשליחה").toBeLessThan(firstPost);
  });

  /*
   * ‎**„לא ידוע” אינו „אפס”** (ביקורת Codex, P2).
   *
   * ‏`twins` נשאר `null` כשהשליפה נכשלה או טרם חזרה. ‎`?? 0` בבדיקת
   * ‏התקרה הפך אותו ל„אין תואמים”: נכס עם אחד-עשר היה מקבל אישור
   * ‏לחמישה, והשרת היה מקבל את הראשון ודוחה את השאר — בדיוק
   * ‏השמירה החלקית שהבדיקה נועדה למנוע. אותה הבחנה שהקובץ הזה
   * ‏כבר עושה על הרשימה עצמה.
   */
  it("ואינה קוראת מספר לא ידוע כאפס", () => {
    const body = addBody();
    expect(body, "‎`?? 0` הופך „לא ידוע” ל„יש מקום”").not.toContain("twins?.length ?? 0");
    const unknown = body.indexOf("twins === null");
    const guard = body.indexOf("twinBatchRejectionReason");
    expect(unknown, "אין עצירה על מספר לא ידוע").toBeGreaterThan(-1);
    expect(unknown, "הבדיקה חייבת לקדום לתקרה").toBeLessThan(guard);
  });

  /* ‏וגם הכפתור עצמו אינו נפתח כל עוד המספר אינו ידוע */
  it("והכפתור אינו נפתח לפני שהמספר ידוע", () => {
    expect(PICKER).toContain("disabled={atLimit || !countKnown}");
    expect(PICKER).toContain("const countKnown = twins !== null");
  });

  /*
   * ‎**כישלון חלקי נאמר.** השרת בודק כל קשר בנפרד — גם לנכס השני
   * ‏יש תקרה משלו — ולכן „השמירה נכשלה” אחרי ששלושה מתוך חמישה
   * ‏נשמרו הוא שקר.
   */
  it("וסופרת מה נשמר ומה לא", () => {
    const body = addBody();
    expect(body).toContain("const failed: string[] = []");
    expect(body).toContain("const saved: string[] = []");
    expect(body).toContain("נשמרו.");
    /* ‏החלון נשאר פתוח כשנשאר מה לתקן */
    expect(body).toMatch(/if \(failed\.length === 0\) \{\s*setPickerOpen\(false\)/u);
  });

  /*
   * ‎**מה שנשמר יורד מהבחירה — לפי מה שנאסף בלולאה.**
   *
   * ‎`linkedIds` נגזר מ-`twins` שנתפס בסגירה של הרינדור, ולכן הוא
   * ‏עדיין הישן גם אחרי `load()`. סינון לפיו היה משאיר את הנשמרים
   * ‏מסומנים, והלחיצה הבאה הייתה מנסה לשמור אותם שוב.
   */
  it("ואינה מסתמכת על linkedIds שנתפס לפני הטעינה", () => {
    const body = addBody();
    expect(body).toContain("prev.filter((id) => !saved.includes(id))");
    expect(body, "linkedIds בסגירה הזו הוא הישן").not.toContain("linkedIds");
  });
});
