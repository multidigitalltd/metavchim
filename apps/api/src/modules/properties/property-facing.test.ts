import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PROPERTY_FACING_LABELS,
  PropertyFacingSchema,
  PropertyFieldsSchema,
} from "@metavchim/shared";
import { fieldsToColumns } from "./property.mapper";
import {
  CreatePropertySchema,
  PropertiesController,
  UpdatePropertySchema,
} from "./properties.controller";

/**
 * ‎**חזית או עורף — אחת השאלות הראשונות בטלפון.**
 *
 * ‏עד עכשיו לא היה לה שדה: מי ששאל רשם בהערות הפנימיות, ומשם זה
 * ‏לא חוזר לאף מסך (בקשת המשתמש). מה שנבדק כאן הוא מה שמחזיק את
 * ‏השדה — הערכים המותרים, הדרך חזרה ל„לא צוין”, והמעבר לעמודה.
 */

describe("שלושת הערכים", () => {
  /*
   * ‎**שלושה ולא שניים.** דירה שפונה לשני הכיוונים היא מצב נפוץ,
   * ‏ובבחירה של „חזית או עורף” בלבד היא נרשמת בשקר — אותה תקלה
   * ‏שבגללה למועד הכניסה יש מצב ולא רק תאריך.
   */
  it("חזית, עורף, ושניהם", () => {
    expect(PropertyFacingSchema.options).toEqual(["front", "rear", "both"]);
  });

  /* ‏ערך בלי תווית מוצג גולמי למתווך — הטיפוס מונע את זה, וזה מקבע */
  it("ולכל אחד יש תווית", () => {
    for (const value of PropertyFacingSchema.options) {
      expect(PROPERTY_FACING_LABELS[value], value).toBeTruthy();
    }
  });

  it("ומה שאינו אחד מהם נדחה", () => {
    expect(PropertyFieldsSchema.safeParse({ facing: "north" }).success).toBe(false);
    /* ‏„לא צוין” הוא חוסר ולא ערך רביעי */
    expect(PropertyFieldsSchema.safeParse({}).success).toBe(true);
  });
});

describe("סכימות ה-API", () => {
  it("היצירה מקבלת ערך, ולא null", () => {
    expect(CreatePropertySchema.safeParse({ facing: "front" }).success).toBe(true);
    /* ‏בקליטה „ריק” פשוט אינו נשלח; `null` היה ריקון של מה שאין */
    expect(CreatePropertySchema.safeParse({ facing: null }).success).toBe(false);
  });

  /*
   * ‎**והעדכון מקבל `null`.** מי שסימן בטעות חייב דרך חזרה ל„לא
   * ‏צוין”, ובלעדיה הערך היחיד שאי אפשר להגיע אליו הוא האמת.
   */
  it("והעדכון מקבל גם null — זו הדרך חזרה ל„לא צוין”", () => {
    expect(UpdatePropertySchema.safeParse({ facing: "both" }).success).toBe(true);
    expect(UpdatePropertySchema.safeParse({ facing: null }).success).toBe(true);
    expect(UpdatePropertySchema.safeParse({ facing: "north" }).success).toBe(false);
  });
});

/**
 * ‎`PropertyFieldsSchema` אינו מקבל `null`, ולכן הריקון נוסע
 * ‏ב-`clearFields` — הערוץ שכבר קיים למספר הבית.
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
    await controllerFor(seen).update("01PROP", { facing: null });
    expect(seen[0]?.["clearFields"]).toEqual(["facing"]);
    expect(seen[0]).not.toHaveProperty("facing");
  });

  it("ערך ⇐ השדה, בלי ריקון", async () => {
    const seen: Record<string, unknown>[] = [];
    await controllerFor(seen).update("01PROP", { facing: "rear" });
    expect(seen[0]?.["facing"]).toBe("rear");
    expect(seen[0]).not.toHaveProperty("clearFields");
  });

  /*
   * ‎**שני ריקונים באותה שמירה — ורשימה אחת.**
   *
   * ‏הניסוח המתבקש הוא שני ספרדים מותנים, `{...{clearFields}}`
   * ‏פעמיים — והשני **מוחק את הראשון בשקט**. כלומר מתווך שמחק
   * ‏באותה שמירה גם את מספר הבית וגם את הכיוון היה מקבל „נשמר”
   * ‏ואחד מהם היה שורד.
   */
  it("ושני ריקונים באותה שמירה נכנסים יחד", async () => {
    const seen: Record<string, unknown>[] = [];
    await controllerFor(seen).update("01PROP", { houseNumber: null, facing: null });
    expect(seen[0]?.["clearFields"]).toEqual(["houseNumber", "facing"]);
  });
});

describe("המעבר לעמודה", () => {
  it("ערך נכתב, וריקון נכתב כ-NULL", () => {
    expect(fieldsToColumns({ facing: "front" }).facing).toBe("front");
    expect(fieldsToColumns({ facing: undefined }).facing).toBeNull();
  });

  /* ‏„לא נגעו” אינו „רוקן” — אחרת כל שמירה של מחיר הייתה מוחקת כיוון */
  it("ומה שלא נשלח אינו נוגע בעמודה", () => {
    expect(fieldsToColumns({ city: "רעננה" })).not.toHaveProperty("facing");
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
      expect(source, name).toContain("<FacingField");
      expect(source, name).toContain('facing: String(f.get("facing")');
    }
  });

  /*
   * ‏ההבדל היחיד ביניהם, והוא מכוון: בקליטה „ריק” הוא פשוט חוסר,
   * ‏ובעריכה הוא בקשה למחוק ערך שנרשם — ולכן `null` מפורש.
   */
  it("וההבדל היחיד הוא מה „ריק” אומר", () => {
    expect(NEW).toContain('facing: String(f.get("facing") ?? "") || undefined');
    expect(EDIT).toContain('facing: String(f.get("facing") ?? "") || null');
  });
});
