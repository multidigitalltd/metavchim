import { describe, expect, it } from "vitest";
import * as z from "../zod.js";
import * as shared from "../index.js";

/**
 * ‎**עדכון חלקי מחזיר רק את מה שנשלח.**
 *
 * ‏ב-Zod 4 שדה רשות שעוטף `.default()` מקבל את ברירת המחדל כשלא נשלח, ולכן
 * ‏‎`.partial()`‎ על סכימת יצירה היה מאפס בכל עדכון את כל מה שלא נשלח. גוף ריק
 * ‏הוא הבדיקה הפשוטה ביותר: נדחה, או חוזר ריק — אף פעם לא מתמלא.
 */
const PATCHES = Object.entries(shared as Record<string, unknown>).filter(
  (entry): entry is [string, z.ZodObject] => /(Patch|Update|Edit)Schema$/u.test(entry[0]) && entry[1] instanceof z.ZodObject,
);

describe("סכימות עדכון חלקי", () => {
  it("נמצאו", () => {
    expect(PATCHES.map(([name]) => name)).toContain("MediaOutletPatchSchema");
  });

  it.each(PATCHES)("%s — גוף ריק אינו מתמלא בברירות מחדל", (_name, schema) => {
    const result = schema.safeParse({});
    if (result.success) expect(result.data).toEqual({});
  });

  it("עדכון מדיה בשם בלבד אינו נוגע בשאר השדות", () => {
    expect(shared.MediaOutletPatchSchema.parse({ name: "טאבו" })).toEqual({ name: "טאבו" });
  });
});
