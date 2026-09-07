import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BuyerRequirementsSchema } from "@metavchim/shared";
import { requirementColumns } from "./buyers.service";

/**
 * ‎**העמודות הנגזרות מ-`requirements` — ומה שקורה כשהן נכתבות
 * בשלושה ניסוחים.**
 *
 * ‏הדרישות נשמרות כ-JSONB, ולצדן עמודות שהמסד מסנן ומאנדקס עליהן.
 * ‏שתי הצורות חייבות להיכתב יחד: המנוע קורא את ה-JSON, הסינון הגס
 * ‏והרשימות קוראות את העמודה, ושורה שבה הן חלוקות מספרת שני
 * ‏סיפורים — ומועמד נעלם בלי שאיש רואה מדוע.
 *
 * ‏שלוש הכתיבות (יצירה מליד, יצירה ישירה, עדכון) היו שלושה עותקים
 * ‏של אותה השלכה. זה עבד כל עוד לא נוספה עמודה נגזרת חדשה.
 */

const BASE = BuyerRequirementsSchema.parse({ dealType: "sale" });

describe("requirementColumns", () => {
  it("עמדת הטאבו נגזרת אל העמודה", () => {
    expect(requirementColumns({ ...BASE, sharedTabu: "accepts" }).sharedTabuStance).toBe("accepts");
    expect(requirementColumns({ ...BASE, sharedTabu: "refuses" }).sharedTabuStance).toBe("refuses");
  });

  /*
   * ‎**„טרם נשאל” נכתב כ-`null` ולא נשמט.**
   *
   * ‏השמטה בעדכון פירושה „אל תיגע”, ולכן קונה שהעמדה שלו נמחקה
   * ‏בטופס היה נשאר עם הערך הישן בעמודה בזמן שה-JSON כבר ריק —
   * ‏בדיוק הפיצול שהעמודה נועדה למנוע.
   */
  it("‏„טרם נשאל” נכתב כ-null מפורש", () => {
    expect(requirementColumns(BASE).sharedTabuStance).toBe(null);
    expect("sharedTabuStance" in requirementColumns(BASE)).toBe(true);
  });

  it("אזורי חיפוש נגזרים לדגל", () => {
    expect(requirementColumns(BASE).hasSearchAreas).toBe(false);
    expect(
      requirementColumns({
        ...BASE,
        searchAreas: [{ lat: 32, lon: 34.8, radiusKm: 3 }],
      }).hasSearchAreas,
    ).toBe(true);
  });

  /* ‏חסר = הלקוח לא מסר תקציב, ולא „תקציב אפס” */
  it("תקציב חסר נכתב כ-null ולא כאפס", () => {
    const columns = requirementColumns(BASE);
    expect(columns.budgetMaxAgorot).toBe(null);
    expect(columns.budgetMinAgorot).toBe(null);
    expect(requirementColumns({ ...BASE, budgetMaxAgorot: 100 }).budgetMaxAgorot).toBe(BigInt(100));
  });
});

/**
 * ‏השער: אין דרך שנייה לכתוב את העמודות האלה.
 *
 * ‏בלעדיו, כתיבה רביעית שתיכתב בעתיד תעתיק את ההשלכה מחדש —
 * ‏ותשכח בדיוק את העמודה שנוספה אחרונה. זה מה שקרה כאן.
 */
describe("‏אין כתיבה שנייה של העמודות הנגזרות", () => {
  const source = readFileSync(join(__dirname, "buyers.service.ts"), "utf8");

  it("‏`hasSearchAreas` נכתב אך ורק בתוך `requirementColumns`", () => {
    const helper = source.slice(
      source.indexOf("export function requirementColumns("),
      source.indexOf("@Injectable"),
    );
    const everywhere = source.split("hasSearchAreas:").length - 1;
    const inHelper = helper.split("hasSearchAreas:").length - 1;
    expect(inHelper).toBe(1);
    expect(everywhere).toBe(1);
  });

  it("‏ושלוש הכתיבות עוברות דרכה", () => {
    expect(source.split("requirementColumns(").length - 1).toBe(
      /* ‏ההגדרה + שלוש הקריאות */
      4,
    );
  });
});
