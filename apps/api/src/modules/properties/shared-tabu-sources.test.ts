import { describe, expect, it } from "vitest";
import {
  buyerSharedTabuStance,
  BuyerRequirementsSchema,
  isSharedTabuProperty,
  SHARED_TABU_PROPERTY_TYPE,
  type BuyerRequirements,
} from "@metavchim/shared";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fieldsToColumns, rowToFields } from "./property.mapper";
import { sharedTabuWhere } from "./properties.service";
import { requirementColumns } from "../buyers/buyers.service";

/** ‏דרישות ריקות תקינות — הבסיס לכל מקרה בטבלה. */
const EMPTY_REQUIREMENTS: BuyerRequirements = BuyerRequirementsSchema.parse({ dealType: "sale" });

/**
 * ‎**עובדה אחת, שני מקורות — ושתי דליפות הפוכות** (ביקורת Codex, P1).
 *
 * ‏`shared_tabu` קיים ב-`PropertyTypeSchema` מלפני הדגל, והמסלולים
 * ‏שמזינים אותו חיים: מחלץ ההקלטה, ייבוא ה-CSV, וכל שורה שנרשמה כך.
 *
 * ‏דירה שסומן עליה הדגל נפסלה מקונה שביקש את הסוג; ונכס שנרשם בסוג
 * ‏נשאר עם דגל `false` — בלי האזהרה, בלי הסינון ובלי שידוך שותפים.
 * ‏דווקא הנכסים שהתכונה נבנתה בשבילם היו היחידים שלא מקבלים אותה.
 */

/**
 * ‎**טבלת המקרים שכל צורות השאלה נבדקות מולה — כולל `null`.**
 *
 * ‏שורת ה-`null` אינה השלמה: ב-SQL כל השוואה ל-`NULL` היא
 * ‏`UNKNOWN`, ולכן `property_type <> 'shared_tabu'` **מוציא** נכס
 * ‏בלי סוג. בלי השורה הזו שתי הצורות מסכימות על כל מה שנבדק,
 * ‏ונפרדות בדיוק על מה שלא — וטיוטה בלי סוג היא המקרה הנפוץ
 * ‏(ביקורת Codex, P1).
 */
const CASES: {
  sharedTabu: boolean;
  propertyType: string | null;
  expected: boolean;
  why: string;
}[] = [
  { sharedTabu: true, propertyType: "apartment", expected: true, why: "דגל על דירה רגילה" },
  { sharedTabu: false, propertyType: SHARED_TABU_PROPERTY_TYPE, expected: true, why: "הסוג הוותיק לבדו" },
  { sharedTabu: true, propertyType: SHARED_TABU_PROPERTY_TYPE, expected: true, why: "שניהם" },
  { sharedTabu: false, propertyType: "penthouse", expected: false, why: "אף אחד" },
  { sharedTabu: false, propertyType: null, expected: false, why: "טיוטה בלי סוג" },
  { sharedTabu: true, propertyType: null, expected: true, why: "טיוטה בלי סוג, עם הדגל" },
];

describe("isSharedTabuProperty — התשובה היחידה", () => {
  for (const testCase of CASES) {
    it(testCase.why, () => {
      expect(isSharedTabuProperty(testCase)).toBe(testCase.expected);
    });
  }
});

describe("‏הקריאה מהשורה גוזרת משני המקורות", () => {
  for (const testCase of CASES) {
    it(testCase.why, () => {
      expect(rowToFields({ ...testCase, attributes: null } as never).sharedTabu).toBe(
        testCase.expected,
      );
    });
  }
});

describe("‏הכתיבה — הסוג מדליק ולעולם לא מכבה", () => {
  it("סוג „טאבו משותף” מדליק את הדגל גם כשלא נשלח", () => {
    expect(fieldsToColumns({ propertyType: SHARED_TABU_PROPERTY_TYPE }).sharedTabu).toBe(true);
  });

  /*
   * ‏זה החלק שקל לטעות בו: גזירה סימטרית הייתה **מוחקת** סימון
   * ‏מפורש ברגע ששינו „דירה” ל„פנטהאוז”, בלי שאיש ביקש.
   */
  it("שינוי סוג בלבד אינו מכבה סימון קיים", () => {
    expect("sharedTabu" in fieldsToColumns({ propertyType: "penthouse" })).toBe(false);
  });

  it("הדגל ששולח מפורשות שולט", () => {
    expect(fieldsToColumns({ sharedTabu: false, propertyType: "apartment" }).sharedTabu).toBe(false);
    expect(fieldsToColumns({ sharedTabu: true, propertyType: "apartment" }).sharedTabu).toBe(true);
  });

  it("ומה שלא נשלח כלל אינו נכתב", () => {
    expect("sharedTabu" in fieldsToColumns({ city: "רעננה" })).toBe(false);
  });

  /*
   * ‎**וכיבוי מפורש על שורה מהדור הישן פורש גם את הסוג** (ביקורת
   * ‏Codex, P2).
   *
   * ‏זה הענף שהאיחוד יצר: טופס העריכה שולח את הסוג שלא נגעו בו יחד
   * ‏עם התיבה שכובתה, ו-`isSharedTabuProperty` — שמסתכל על שניהם —
   * ‏החזיר `true`. התיבה חזרה מסומנת אחרי כל שמירה, ולא הייתה שום
   * ‏דרך לכבות מלבד לדעת לשנות בורר סוג שאין לו קשר גלוי לתיבה.
   */
  it("כיבוי מפורש על סוג „טאבו משותף” מכבה, ומנקה את הסוג הישן", () => {
    const out = fieldsToColumns({
      sharedTabu: false,
      propertyType: SHARED_TABU_PROPERTY_TYPE,
    });
    expect(out.sharedTabu).toBe(false);
    expect(out.propertyType, "הסוג הישן נשאר וסותר את הכיבוי").toBeNull();
  });

  /*
   * ‏והגבול: כיבוי על סוג רגיל אינו נוגע בסוג. בלי זה „מנקה תמיד”
   * ‏היה עובר, ומחיקת סוג הנכס בכל הסרת סימון היא אובדן נתון.
   */
  it("כיבוי על סוג רגיל אינו מוחק את הסוג", () => {
    const out = fieldsToColumns({ sharedTabu: false, propertyType: "penthouse" });
    expect(out.sharedTabu).toBe(false);
    expect(out.propertyType).toBe("penthouse");
  });

  /*
   * ‎**וגם כש-ה-Patch אינו נושא את הסוג כלל** (ביקורת Codex, P2).
   *
   * ‏זה הצד שהתיקון הראשון פספס: הוא עבד רק בגלל שטופס העריכה
   * ‏שולח את השדות כולם. ‎`PATCH /properties/:id` עם `{ sharedTabu:
   * ‏false }` לבדו — בקשה תקפה לגמרי — כתב `false` והשאיר את הסוג,
   * ‏ואז `rowToFields` גזר `true` בחזרה. דרך ה-API לא הייתה שום
   * ‏דרך לכבות את הסיווג.
   */
  it("כיבוי בלי סוג ב-Patch פורש את הסוג השמור", () => {
    const out = fieldsToColumns(
      { sharedTabu: false },
      { propertyType: SHARED_TABU_PROPERTY_TYPE },
    );
    expect(out.sharedTabu).toBe(false);
    expect(out.propertyType, "הסוג השמור נשאר וסותר את הכיבוי").toBeNull();
  });

  /* ‏והגבול מהצד הזה: סוג שמור רגיל אינו נמחק */
  it("כיבוי בלי סוג ב-Patch על שורה רגילה אינו נוגע בסוג", () => {
    const out = fieldsToColumns({ sharedTabu: false }, { propertyType: "penthouse" });
    expect(out.sharedTabu).toBe(false);
    expect("propertyType" in out, "סוג שלא נגעו בו נכתב מחדש").toBe(false);
  });

  /*
   * ‏ומה שנשלח גובר על מה ששמור: מי ששינה את הסוג באותה בקשה אמר
   * ‏משהו מפורש, וההחלטה היא על **המצב שאחרי**.
   */
  it("סוג שנשלח גובר על השמור", () => {
    const out = fieldsToColumns(
      { sharedTabu: false, propertyType: "apartment" },
      { propertyType: SHARED_TABU_PROPERTY_TYPE },
    );
    expect(out.propertyType).toBe("apartment");
  });

  /* ‏והדלקה מפורשת לצד הסוג הישן אינה מוחקת אותו */
  it("הדלקה מפורשת משאירה את הסוג כפי שהוא", () => {
    const out = fieldsToColumns({
      sharedTabu: true,
      propertyType: SHARED_TABU_PROPERTY_TYPE,
    });
    expect(out.sharedTabu).toBe(true);
    expect(out.propertyType).toBe(SHARED_TABU_PROPERTY_TYPE);
  });
});

/**
 * ‏ה-SQL הוא הצורה השנייה והאחרונה של אותה שאלה, ולכן הוא נבדק
 * ‏**מול הפונקציה** ולא מול ציפייה שנכתבה ביד: שתי רשימות שנכתבות
 * ‏בנפרד מסכימות ביום שנכתבו ולא ביום שאחריו.
 */
describe("sharedTabuWhere מסכים עם isSharedTabuProperty", () => {
  /**
   * ‏הרצה של תנאי Prisma על שורה אחת.
   *
   * ‎`OR` הוא **מפתח לצד האחרים** ולא במקומם: הענף „רישום נפרד”
   * ‏הוא `sharedTabu: false` **וגם** אחד משני תנאי הסוג. גרסה
   * ‏קודמת של העזר החזירה על ה-`OR` והתעלמה מהשאר — כלומר הייתה
   * ‏מאשרת גם שורה שהדגל שלה דלוק.
   */
  function holds(
    where: Record<string, unknown>,
    row: { sharedTabu: boolean; propertyType: string | null },
  ): boolean {
    return Object.entries(where).every(([key, condition]) => {
      if (key === "OR") {
        return (condition as Record<string, unknown>[]).some((clause) => holds(clause, row));
      }
      const value = row[key as "sharedTabu" | "propertyType"];
      if (condition !== null && typeof condition === "object" && "not" in condition) {
        /* ‏`{ not: x }` ב-Prisma אינו תופס `NULL` — כמו ב-SQL */
        return value !== null && value !== (condition as { not: unknown }).not;
      }
      return value === condition;
    });
  }

  for (const testCase of CASES) {
    it(`„רק משותפים” — ${testCase.why}`, () => {
      expect(holds(sharedTabuWhere(true) as Record<string, unknown>, testCase)).toBe(
        testCase.expected,
      );
    });

    it(`„רק רישום נפרד” — ${testCase.why}`, () => {
      expect(holds(sharedTabuWhere(false) as Record<string, unknown>, testCase)).toBe(
        !testCase.expected,
      );
    });
  }

  it("בלי ערך — בלי תנאי", () => {
    expect(sharedTabuWhere(undefined)).toEqual({});
  });
});

/**
 * ‎**דגל על הכרטיס אינו שורה מקושרת** (ביקורת Codex, P1).
 *
 * ‏מיזוג כפילויות מעביר שורות שמצביעות על הכפיל — קונים, לידים,
 * ‏נכסים, הודעות — ואז מוחק אותו. „טאבו משותף” אינו כזה: הוא דגל
 * ‏על הכרטיס עצמו, ולכן הוא נמחק יחד עם הכפיל בשקט.
 *
 * ‏והנזק דחוי: הכרטיס הממוזג נראה תקין, ורק בהמרה לנכס מאוחר יותר
 * ‏האזהרה המשפטית פשוט לא מופיעה.
 *
 * ‏הבדיקה מבנית ולא התנהגותית, וזה נאמר: `merge` נוגע בשתים-עשרה
 * ‏טבלאות בטרנזקציה אחת, ופיקסצ׳ר לכולן היה בודק את עצמו.
 */
describe("מיזוג כפילויות משמר את „טאבו משותף”", () => {
  const SOURCE = readFileSync(
    join(__dirname, "../contacts/duplicates.service.ts"),
    "utf8",
  );

  it("שני הכרטיסים נקראים עם הדגל", () => {
    const survivor = SOURCE.indexOf("id: survivorId, tenantId");
    expect(survivor).toBeGreaterThan(0);
    expect(SOURCE.slice(survivor, survivor + 200)).toContain("sharedTabu: true");
    const duplicate = SOURCE.indexOf("id: duplicateId, tenantId");
    expect(duplicate).toBeGreaterThan(0);
    expect(SOURCE.slice(duplicate, duplicate + 200)).toContain("sharedTabu: true");
  });

  /*
   * ‎`||` ולא השמה: מיזוג אינו מקום להוריד סימון. מי מבין השניים
   * ‏שסומן — הסימון נשאר.
   */
  it("והשורד מסומן כשהכפיל היה מסומן — ולעולם לא להפך", () => {
    expect(SOURCE).toContain("if (duplicate.sharedTabu && !survivor.sharedTabu)");
    const at = SOURCE.indexOf("if (duplicate.sharedTabu && !survivor.sharedTabu)");
    expect(SOURCE.slice(at, at + 220)).toContain("data: { sharedTabu: true }");
  });

  it("והעדכון קודם למחיקת הכפיל", () => {
    /* ‏אחרי המחיקה אין ממי לקרוא — הסדר הוא התיקון עצמו */
    expect(SOURCE.indexOf("if (duplicate.sharedTabu")).toBeLessThan(
      SOURCE.indexOf("tx.contact.delete({ where: { id: duplicateId } })"),
    );
  });
});

/**
 * ‎**וגם בצד הקונה: העמודה היא ההתממשות של הכלל, לא מקור שני**
 * ‏(ביקורת Codex, P1).
 *
 * ‏`shared_tabu_stance` קיים כדי שהשאילתה תוכל לשאול עמודה אחת
 * ‏במקום לפרש JSON, אבל **מה** נכתב בה חייב להיות בדיוק מה
 * ‏ש-`buyerSharedTabuStance` אומר. הגרסה הראשונה כתבה
 * ‏`requirements.sharedTabu ?? null`, ולכן קונה מדור קודם — כזה
 * ‏שהאמירה היחידה שלו היא סוג הנכס הישן — נשמר כ„טרם נשאל”.
 */
describe("‏עמודת העמדה של הקונה מסכימה עם הגזירה", () => {
  const CASES: { label: string; requirements: Partial<BuyerRequirements> }[] = [
    { label: "דרישה ישנה בלבד", requirements: { propertyTypes: ["shared_tabu"] } },
    { label: "עמדה מפורשת „מקבל”", requirements: { sharedTabu: "accepts" } },
    {
      label: "סירוב לצד הדרישה הישנה",
      requirements: { sharedTabu: "refuses", propertyTypes: ["shared_tabu"] },
    },
    { label: "לא נאמר דבר", requirements: { propertyTypes: ["apartment"] } },
  ];

  for (const { label, requirements } of CASES) {
    it(label, () => {
      const full = { ...EMPTY_REQUIREMENTS, ...requirements } as BuyerRequirements;
      expect(requirementColumns(full).sharedTabuStance).toBe(
        buyerSharedTabuStance(full) ?? null,
      );
    });
  }

  /*
   * ‏בלי זה הטבלה יכולה להיות ירוקה על „תמיד null”: מקרה אחד לפחות
   * ‏חייב לכתוב ערך, ואחד לפחות לא.
   */
  it("יש בטבלה גם „מקבל” וגם „טרם נשאל”", () => {
    const written = CASES.map(
      ({ requirements }) =>
        requirementColumns({ ...EMPTY_REQUIREMENTS, ...requirements } as BuyerRequirements)
          .sharedTabuStance,
    );
    expect(written).toContain("accepts");
    expect(written).toContain(null);
  });

  /*
   * ‎**וההגירה אומרת את אותו דבר לשורות שכבר קיימות.** היא ממלאת
   * ‏רק `NULL`, ורק כשהדרישה הישנה נוכחת — בדיוק שני התנאים של
   * ‏הגזירה. שער טקסטואלי, כי SQL אינו נקרא מכאן.
   */
  it("ההגירה ממלאת רק „טרם נשאל” עם הדרישה הישנה", () => {
    const sql = readFileSync(
      join(
        __dirname,
        "../../../prisma/migrations/20260906220000_buyer_stance_from_legacy_type/migration.sql",
      ),
      "utf8",
    );
    expect(sql).toContain("shared_tabu_stance IS NULL");
    expect(sql).toContain("'accepts'");
    expect(sql).toContain("'[\"shared_tabu\"]'::jsonb");
  });
});

/**
 * ‎**ומי שקורא לה בעדכון חייב למסור את השורה השמורה.**
 *
 * ‏הבדיקות למעלה מוכיחות שהכלל **יודע** להסתכל על הסוג השמור.
 * ‏מוטציה שהסירה את הארגומנט השני ממסלול העדכון עברה בהן בשקט —
 * ‏כלומר הן מדדו את הפונקציה ולא את החיווט, וזו בדיוק הצורה שבה
 * ‏התיקון הזה יכול להיעלם בלי שאיש יראה.
 */
describe("‏מסלול העדכון מוסר ל-`fieldsToColumns` את השורה השמורה", () => {
  const SERVICE = readFileSync(join(__dirname, "properties.service.ts"), "utf8");

  it("‏יש מה לבדוק — שני מסלולי כתיבה", () => {
    expect(SERVICE.split("fieldsToColumns(").length - 1).toBe(2);
  });

  it("‏העדכון מוסר את `existing`", () => {
    expect(SERVICE).toContain("fieldsToColumns(fieldPatch, existing)");
  });

  /*
   * ‏והיצירה **אינה** מוסרת דבר, ובכוונה: אין שורה שמורה, ומסירת
   * ‏משהו שם הייתה ממציאה מצב קודם לנכס שנולד עכשיו.
   */
  it("‏והיצירה אינה", () => {
    /*
     * ‏הטענה היא על **מספר הארגומנטים**, ולא על הביטוי שבפנים:
     * ‏הניסוח הקודם נעץ את הביטוי המדויק, ולכן הוא נשבר כשהביטוי
     * ‏השתנה משיקול אחר לגמרי — שער שחוסם את התיקון של עצמו.
     */
    const calls = [...SERVICE.matchAll(/fieldsToColumns\(/gu)].map((match) => {
      const start = match.index + match[0].length;
      let depth = 1;
      for (let i = start; i < SERVICE.length; i += 1) {
        if (SERVICE[i] === "(") depth += 1;
        else if (SERVICE[i] === ")") {
          depth -= 1;
          if (depth === 0) return SERVICE.slice(start, i);
        }
      }
      return "";
    });
    const create = calls.filter((args) => !args.includes(", existing"));
    expect(create.length, "מסלול היצירה נעלם").toBe(1);
    expect(create[0], "היצירה מוסרת שורה שמורה שאינה קיימת").not.toContain(",");
  });
});
