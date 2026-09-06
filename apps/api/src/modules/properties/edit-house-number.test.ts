import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PropertiesController, UpdatePropertySchema } from "./properties.controller";

/**
 * ‎**מספר בית שנמחק במסך — נמחק גם במסד.**
 *
 * ## ‏התקלה
 *
 * ‏טופס העריכה מתרגם שדה ריק ל-`undefined` ואז מוחק מה-Patch כל
 * ‏מפתח `undefined`, כי „לא נשלח” פירושו „בלי שינוי” בכל שאר הטופס.
 * ‏על מספר הבית זה הפך למלכודת: מי שמחק אותו קיבל „נשמר”, והערך
 * ‏הישן שרד. נכס שיובא עם מספר שגוי לא היה ניתן לתיקון **מהמסך
 * ‏שנועד בדיוק לזה** (דיווח המשתמש).
 *
 * ## ‏ורק מספר הבית
 *
 * ‏רחוב ועיר אינם מקבלים `null` כאן, וזו החלטה ולא השמטה: כתובת
 * ‏בלי עיר אינה כתובת, ומי שרוצה לשנות רחוב מחליף אותו. „בית בלי
 * ‏מספר” לעומת זאת הוא מצב אמיתי בשטח — מגרש, בית פרטי בלי מספור,
 * ‏או מספר שהוזן בטעות.
 */

const FORM = readFileSync(
  new URL("../../../../web/src/app/properties/[id]/edit/page.tsx", import.meta.url),
  "utf8",
);

/**
 * ‏גוף ה-PATCH שהטופס בונה, בלי הערות — אותה גישה כמו בשער
 * ‏„הגוף שהטופס שולח” של היצירה: הסכימה `.strict()`, ולכן מפתח
 * ‏שאינו מוצהר בה חוסם את השמירה כולה.
 */
function patchBody(): string {
  const start = FORM.indexOf("const patch: Record<string, unknown> = {");
  expect(start, "לא נמצא גוף ה-Patch בטופס — הסריקה אינה קוראת").toBeGreaterThan(-1);
  const open = FORM.indexOf("{", start);
  let depth = 0;
  let end = open;
  for (; end < FORM.length; end += 1) {
    if (FORM[end] === "{") depth += 1;
    else if (FORM[end] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return FORM.slice(open, end)
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^[ \t]*\/\/.*$/gmu, "");
}

describe("טופס עריכת נכס — הגוף שהוא שולח", () => {
  it("כל מפתח שהטופס שולח מוצהר בסכימת העדכון", () => {
    const body = patchBody();
    const sent = [...new Set([...body.matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:/gmu)].map((m) => m[1]!))];
    expect(sent.length, "לא נמצאו מפתחות — הסריקה נשברה").toBeGreaterThan(15);
    const declared = new Set(Object.keys(UpdatePropertySchema.shape));
    expect(sent.filter((key) => !declared.has(key))).toEqual([]);
  });

  /*
   * ‏המלכודת עצמה: `str()` מחזיר `undefined` על ריק, ולולאת הניקוי
   * ‏מוחקת אותו. מספר הבית חייב לצאת מהכלל הזה במפורש.
   */
  it("ומספר בית ריק אינו נבלע — הוא נשלח כ-null", () => {
    const line = patchBody()
      .split("\n")
      .find((row) => /^\s*houseNumber\s*:/u.test(row));
    expect(line, "אין שורת houseNumber בגוף").toBeDefined();
    expect(line, "מספר בית ריק חוזר ל-undefined ונמחק מה-Patch").toContain("null");
  });
});

describe("סכימת העדכון — מה מותר לרוקן", () => {
  it("מספר בית מקבל null", () => {
    expect(UpdatePropertySchema.safeParse({ houseNumber: null }).success).toBe(true);
  });

  /* ‏וגם ערך רגיל, כדי שהריקון לא יבוא במקום העדכון */
  it("וגם ערך רגיל", () => {
    expect(UpdatePropertySchema.safeParse({ houseNumber: "12ב" }).success).toBe(true);
  });

  it("רחוב ועיר אינם מקבלים null", () => {
    expect(UpdatePropertySchema.safeParse({ street: null }).success).toBe(false);
    expect(UpdatePropertySchema.safeParse({ city: null }).success).toBe(false);
  });
});

/**
 * ‎`PropertyFieldsSchema` אינו מקבל `null`, ולכן הריקון נוסע בערוץ
 * ‏שכבר קיים — `clearFields` — ולא כערך של השדה. התרגום הזה הוא
 * ‏המקום היחיד שבו הוא נעשה, ולכן הוא נבדק בהתנהגות.
 */
describe("הבקר מתרגם null לריקון", () => {
  function controllerFor(seen: Record<string, unknown>[]): PropertiesController {
    const properties = {
      update: async (_id: string, patch: Record<string, unknown>) => {
        seen.push(patch);
        return {} as never;
      },
    };
    return new PropertiesController(
      properties as never,
      {} as never,
      {} as never,
      {} as never,
    );
  }

  it("null ⇐ clearFields, והשדה עצמו אינו נשלח", async () => {
    const seen: Record<string, unknown>[] = [];
    await controllerFor(seen).update("01PROP", { houseNumber: null });
    expect(seen[0]?.["clearFields"]).toEqual(["houseNumber"]);
    expect(seen[0]).not.toHaveProperty("houseNumber");
  });

  it("ערך ⇐ השדה, בלי ריקון", async () => {
    const seen: Record<string, unknown>[] = [];
    await controllerFor(seen).update("01PROP", { houseNumber: "12" });
    expect(seen[0]?.["houseNumber"]).toBe("12");
    expect(seen[0]).not.toHaveProperty("clearFields");
  });

  /* ‏„לא נגעו” נשאר „לא נגעו” — אחרת כל שמירה הייתה מוחקת מספר */
  it("חסר ⇐ לא זה ולא זה", async () => {
    const seen: Record<string, unknown>[] = [];
    await controllerFor(seen).update("01PROP", { city: "רעננה" });
    expect(seen[0]).not.toHaveProperty("houseNumber");
    expect(seen[0]).not.toHaveProperty("clearFields");
  });
});
