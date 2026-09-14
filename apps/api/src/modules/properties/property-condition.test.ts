import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROPERTY_CONDITIONS } from "@metavchim/shared";
import { fieldsToColumns } from "./property.mapper";
import {
  CreatePropertySchema,
  PropertiesController,
  UpdatePropertySchema,
} from "./properties.controller";

/**
 * ‎**מצב הנכס — שדה של המתווך, לא של המערכת.**
 *
 * ‏הקטלוג עצמו (חמשת הערכים, התוויות, והגזירה של הסוכן, הרשת
 * ‏והייבוא ממנו) נבדק ב-`schemas/property-condition.test.ts`. כאן
 * ‏נבדק מה שמחזיק אותו **בצד ה-API**: הדרך חזרה ל„לא צוין”,
 * ‏המעבר לעמודה, ושני הטפסים ששואלים את אותה שאלה.
 */

describe("סכימות ה-API", () => {
  it("היצירה מקבלת ערך, ולא null", () => {
    expect(CreatePropertySchema.safeParse({ condition: "renovated_full" }).success).toBe(true);
    /* ‏בקליטה „ריק” פשוט אינו נשלח; `null` היה ריקון של מה שאין */
    expect(CreatePropertySchema.safeParse({ condition: null }).success).toBe(false);
  });

  /*
   * ‎**והעדכון מקבל `null`.** בלעדיו טופס העריכה — ששולח „לא צוין”
   * ‏כ-`null`, בדיוק כמו חזית/עורף — היה נדחה ב-400, כלומר הערך
   * ‏היחיד שאי אפשר לחזור אליו היה „לא ידוע”.
   */
  it("והעדכון מקבל גם null — זו הדרך חזרה ל„לא צוין”", () => {
    expect(UpdatePropertySchema.safeParse({ condition: "good" }).success).toBe(true);
    expect(UpdatePropertySchema.safeParse({ condition: null }).success).toBe(true);
    expect(UpdatePropertySchema.safeParse({ condition: "preserved" }).success).toBe(false);
  });

  /* ‏מה שבקטלוג עובר בשתי הסכימות — אחרת ערך שהטופס מציג נדחה בשרת */
  it("וכל ערך בקטלוג מתקבל בשתיהן", () => {
    for (const value of PROPERTY_CONDITIONS) {
      expect(CreatePropertySchema.safeParse({ condition: value }).success, value).toBe(true);
      expect(UpdatePropertySchema.safeParse({ condition: value }).success, value).toBe(true);
    }
  });
});

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
    await controllerFor(seen).update("01PROP", { condition: null });
    expect(seen[0]?.["clearFields"]).toEqual(["condition"]);
    expect(seen[0]).not.toHaveProperty("condition");
  });

  it("ערך ⇐ השדה, בלי ריקון", async () => {
    const seen: Record<string, unknown>[] = [];
    await controllerFor(seen).update("01PROP", { condition: "needs_renovation" });
    expect(seen[0]?.["condition"]).toBe("needs_renovation");
    expect(seen[0]).not.toHaveProperty("clearFields");
  });

  /*
   * ‎**שלושה ריקונים באותה שמירה — ורשימה אחת.** זו בדיוק התקלה
   * ‏שהערה בבקר מזהירה מפניה: ספרד מותנה לכל שדה כותב את אותו
   * ‏מפתח שוב, והאחרון מוחק את הקודמים בשקט.
   */
  it("ושלושה ריקונים באותה שמירה נכנסים יחד", async () => {
    const seen: Record<string, unknown>[] = [];
    await controllerFor(seen).update("01PROP", {
      houseNumber: null,
      facing: null,
      condition: null,
    });
    expect(seen[0]?.["clearFields"]).toEqual(["houseNumber", "facing", "condition"]);
  });
});

describe("המעבר לעמודה", () => {
  it("ערך נכתב, וריקון נכתב כ-NULL", () => {
    expect(fieldsToColumns({ condition: "new" }).condition).toBe("new");
    expect(fieldsToColumns({ condition: undefined }).condition).toBeNull();
  });

  /* ‏„לא נגעו” אינו „רוקן” — אחרת כל שמירה של מחיר הייתה מוחקת מצב */
  it("ומה שלא נשלח אינו נוגע בעמודה", () => {
    expect(fieldsToColumns({ city: "רעננה" })).not.toHaveProperty("condition");
  });

  /*
   * ‏העמודה היא `VARCHAR(20)` ואין עליה `CHECK` (בשונה מ-`facing`),
   * ‏ולכן הסכימה היא השער היחיד — והאורך הוא הגבול היחיד שהמסד
   * ‏אוכף. ערך שגדל מעבר לו היה נחתך או נדחה בכתיבה בלבד.
   */
  it("וכל ערך נכנס באורך העמודה", () => {
    for (const value of PROPERTY_CONDITIONS) {
      expect(value.length, value).toBeLessThanOrEqual(20);
    }
  });
});

/**
 * ‏שני הטפסים שואלים את אותה שאלה, ולכן הם חולקים פקד אחד. שני
 * ‏עותקים היו נפרדים בשקט ביום שהניסוח או הערכים משתנים.
 */
describe("שני הטפסים", () => {
  const read = (relative: string): string =>
    readFileSync(new URL(relative, import.meta.url), "utf8");
  const NEW = read("../../../../web/src/app/properties/new/page.tsx");
  const EDIT = read("../../../../web/src/app/properties/[id]/edit/page.tsx");

  it("מציגים את אותו פקד", () => {
    for (const [name, source] of [
      ["קליטה", NEW],
      ["עריכה", EDIT],
    ] as const) {
      expect(source, name).toContain("<ConditionField");
      expect(source, name).toContain('condition: String(f.get("condition")');
    }
  });

  /*
   * ‏ההבדל היחיד ביניהם, והוא מכוון: בקליטה „ריק” הוא פשוט חוסר,
   * ‏ובעריכה הוא בקשה למחוק ערך שנרשם — ולכן `null` מפורש.
   */
  it("וההבדל היחיד הוא מה „ריק” אומר", () => {
    expect(NEW).toContain('condition: String(f.get("condition") ?? "") || undefined');
    expect(EDIT).toContain('condition: String(f.get("condition") ?? "") || null');
  });
});
