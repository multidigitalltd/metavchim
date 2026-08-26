import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  NETWORK_DISCLOSURE,
  disclosureColumns,
  disclosureDtoFields,
  type DisclosureChip,
} from "@metavchim/shared";
import { describe, expect, it } from "vitest";

/**
 * ‎**„זה מה שנשלח” — נבדק מול הקוד, לא מול הזיכרון.**
 *
 * הפאנל בכרטיס הנכס ובכרטיס הקונה מציג שלוש רשימות: מה משרד אחר
 * מקבל, מה נשמר ואינו נשלח, ומה נשאר אצלכם. זו ההצהרה היחידה
 * במערכת על מידע שחוצה את גבול הדייר, והיא נקראת בדיוק ברגע שבו
 * מתווך מחליט אם ללחוץ.
 *
 * ‎**שני גבולות, ולא אחד — וזה תיקון לגרסה הראשונה של הבדיקה.**
 * היא בדקה עמודות בלבד, והכריזה „מיקום נחשף” על שדה שאינו קיים
 * ב-`SharedListingDto` כלל (ביקורת Codex). הטבלה היא אחסון; ה-DTO
 * הוא מה שיוצא בתשובה. בדיקה שמכירה רק אחד מהם תטעה בשני הכיוונים:
 * תבטיח חשיפה שאינה קורית, ותחמיץ שדה שנוסף לתשובה ולא לטבלה.
 *
 * ‎**למה בדיקה ולא הערה.** ‎`snapshot()` מחזיר
 * ‎`Omit<Prisma.SharedListingUncheckedCreateInput, …>`, שכל שדותיו
 * אופציונליים — עמודה חדשה אינה מפילה קומפילציה. ושדה חדש ב-DTO
 * מתווסף בלי שאיש ישאל אם הוא נחשף. פאנל שמבטיח „זה הכול” ואינו
 * יודע על תוספת גרוע ממסך בלי פאנל.
 *
 * ‎**מה הבדיקה אינה עושה.** היא אינה מריצה שאילתה ואינה בודקת איזה
 * **ערך** נכתב לתוך שדה. ‎`publishBulk` מעתיק את
 * ‎`marketingDescription` לתוך `notes`, וזה זרם שהיא אינה רואה —
 * הגבול הזה רשום גם בראש `network-disclosure.ts`.
 */

const API_SRC = join(import.meta.dirname, "..", "..");
const SCHEMA = readFileSync(join(API_SRC, "..", "prisma", "schema.prisma"), "utf8");

/** שמות העמודות של מודל אחד ב-`schema.prisma`. */
function columnsOf(model: string): string[] {
  const body = new RegExp(String.raw`^model ${model} \{([\s\S]*?)^\}`, "mu").exec(SCHEMA)?.[1];
  if (body === undefined) throw new Error(`מודל ${model} לא נמצא בסכימה`);
  const columns: string[] = [];
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    /* הערות, בלוקים ברמת המודל, ושורות ריקות אינן עמודות */
    if (line === "" || line.startsWith("//") || line.startsWith("@@") || line.startsWith("*")) {
      continue;
    }
    const name = line.split(/\s+/u)[0];
    if (name === undefined || name.startsWith("@") || name.startsWith("/")) continue;
    columns.push(name);
  }
  return columns;
}

/**
 * שמות השדות של הגדרת DTO אחת.
 *
 * ‎**רק שדות ברמה העליונה.** ‎`searchAreas` מוגדר כמערך של אובייקט
 * מוטבע (`{ lat; lon; radiusKm; label? }`), ו-`myMatches` כך גם —
 * והשדות שבתוכם אינם שדות של ה-DTO. הזחה של שני רווחים בדיוק היא
 * מה שמפריד ביניהם, ולכן היא בתבנית ולא ב-`trim`.
 */
function dtoFieldsOf(file: string, name: string): string[] {
  const source = readFileSync(join(API_SRC, file), "utf8");
  const body = new RegExp(String.raw`export interface ${name} \{([\s\S]*?)\n\}`, "u").exec(
    source,
  )?.[1];
  if (body === undefined) throw new Error(`${name} לא נמצא ב-${file}`);
  const withoutComments = body.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/.*/gu, "");
  return [...withoutComments.matchAll(/^ {2}([A-Za-z_]\w*)\??\s*:/gmu)].map((m) => m[1]!);
}

/**
 * שדות יחס של Prisma — אינם עמודות במסד ואינם מידע שמתפרסם.
 *
 * ‎`Property` נושא `tenant` ו-`media`, שהם ניווט בין טבלאות. שער
 * שהיה דורש גם מהם סיווג היה מלמד להוסיף שמות לרשימה כדי להשתיק
 * אותו, וזה ההרגל שהורג שערים.
 */
const RELATION_FIELDS = new Set(["tenant", "media"]);

const BUYER = NETWORK_DISCLOSURE.buyer;

/** מיון, כדי שכישלון יקרא כרשימה ולא כחידה על סדר. */
function missing(from: readonly string[], covered: Iterable<string>): string[] {
  const known = new Set(covered);
  return [...new Set(from.filter((n) => !known.has(n)))].sort();
}

describe("הצהרת החשיפה לרשת — מול הסכימה ומול ה-DTO", () => {
  it("שתי השליפות עובדות, אחרת כל השאר משווה רשימות ריקות", () => {
    /*
     * שער על הבדיקה עצמה. שינוי בפורמט הסכימה או בהגדרת ה-DTO היה
     * מרוקן את השולפים, וכל ההשוואות למטה היו הופכות ל-`[] ⊆ []` —
     * בדיקה שעוברת תמיד. זה כבר קרה בבדיקה מבנית אחרת כאן.
     */
    expect(columnsOf("SharedListing")).toContain("photoKeys");
    expect(columnsOf("Property")).toContain("street");
    expect(columnsOf("Buyer")).toContain("contactId");
    for (const d of Object.values(NETWORK_DISCLOSURE)) {
      expect(dtoFieldsOf(d.dtoFile, d.dtoName).length).toBeGreaterThan(10);
    }
    /* ‎`searchAreas` הוא מערך של אובייקט מוטבע — `lat` אינו שדה DTO */
    expect(dtoFieldsOf(BUYER.dtoFile, BUYER.dtoName)).toContain("searchAreas");
    expect(dtoFieldsOf(BUYER.dtoFile, BUYER.dtoName)).not.toContain("radiusKm");
  });

  for (const [kind, disclosure] of Object.entries(NETWORK_DISCLOSURE)) {
    describe(kind, () => {
      const shared = columnsOf(disclosure.sharedTable).filter((c) => !RELATION_FIELDS.has(c));
      const origin = columnsOf(disclosure.originTable).filter((c) => !RELATION_FIELDS.has(c));
      const dto = dtoFieldsOf(disclosure.dtoFile, disclosure.dtoName);
      const all: DisclosureChip[] = [
        ...disclosure.shown,
        ...disclosure.storedOnly,
        ...disclosure.hidden,
      ];

      /* ---------- גבול א׳: הטבלה המשותפת ---------- */

      it("כל עמודה בטבלה המשותפת מסווגת", () => {
        expect(
          missing(shared, [
            ...disclosureColumns(disclosure.shown),
            ...disclosureColumns(disclosure.storedOnly),
            ...disclosure.nonFactColumns,
          ]),
        ).toEqual([]);
      });

      it("ואין סיווג לעמודה שאינה קיימת בה", () => {
        expect(
          missing(
            [
              ...disclosureColumns(disclosure.shown),
              ...disclosureColumns(disclosure.storedOnly),
              ...disclosure.nonFactColumns,
            ],
            shared,
          ),
        ).toEqual([]);
      });

      /* ---------- גבול ב׳: התשובה שיוצאת ---------- */

      /*
       * ‎**זהו גבול החשיפה עצמו.** שדה חדש כאן הוא דבר חדש שמשרד אחר
       * מקבל, וזו בדיוק השאלה שהפאנל מתיימר לענות עליה.
       */
      it("כל שדה ב-DTO מסווג", () => {
        expect(
          missing(dto, [
            ...disclosureDtoFields(disclosure.shown),
            ...disclosure.nonFactDtoFields,
          ]),
        ).toEqual([]);
      });

      it("ואין סיווג לשדה שאינו קיים ב-DTO", () => {
        expect(
          missing(
            [...disclosureDtoFields(disclosure.shown), ...disclosure.nonFactDtoFields],
            dto,
          ),
        ).toEqual([]);
      });

      /*
       * ‎**הטענה שהגרסה הראשונה נכשלה בה.** צ'יפ ירוק אומר „משרד אחר
       * מקבל את זה”; בלי שדה ב-DTO הוא אומר את זה על שדה שאינו יוצא
       * מהשרת כלל.
       */
      it("כל צ'יפ ירוק באמת יוצא בתשובה", () => {
        for (const chip of disclosure.shown) {
          expect(chip.dtoFields.length).toBeGreaterThan(0);
        }
      });

      /*
       * ‎**והכיוון ההפוך.** „נשמר ואינו נשלח” חייב באמת לא להישלח,
       * אחרת זו הבטחה הפוכה בדיוק.
       */
      it("„נשמר ואינו נשלח” באמת אינו ב-DTO", () => {
        const present = new Set(dto);
        for (const chip of disclosure.storedOnly) {
          expect(chip.dtoFields).toEqual([]);
          expect(chip.columns.filter((c) => present.has(c))).toEqual([]);
        }
      });

      /* ---------- ההבטחה ---------- */

      it("מה שהוצהר כמוסתר אינו בטבלה המשותפת ואינו ב-DTO", () => {
        const sharedSet = new Set(shared);
        const dtoSet = new Set(dto);
        const columns = disclosureColumns(disclosure.hidden);
        expect(columns.filter((c) => sharedSet.has(c))).toEqual([]);
        expect(columns.filter((c) => dtoSet.has(c))).toEqual([]);
      });

      it("ומה שהוצהר כמוסתר קיים בטבלת המקור", () => {
        expect(missing(disclosureColumns(disclosure.hidden), origin)).toEqual([]);
      });

      /* ---------- שלמות הרשימות ---------- */

      it("לכל צ'יפ יש תווית ולפחות שם אחד", () => {
        for (const chip of all) {
          expect(chip.label.trim()).not.toBe("");
          expect(chip.columns.length + chip.dtoFields.length).toBeGreaterThan(0);
        }
      });

      /*
       * המסך ממפתח את הרשימות בתווית. תווית כפולה אינה רק אזהרת
       * ‎React — היא שתי שורות שנראות זהות ברשימה שכל תפקידה למנות
       * מה נשלח.
       */
      it("אין שתי תוויות זהות בפאנל", () => {
        const labels = all.map((chip) => chip.label);
        expect(labels).toEqual([...new Set(labels)]);
      });

      /*
       * ‎**אותה עמודה אינה בשתי קבוצות.** שלוש הרשימות מדברות על
       * טבלאות שונות בחלקן, ולכן חפיפה לא תיתפס באף בדיקה שלמעלה —
       * היא פשוט תוצג כשתי הבטחות סותרות באותו פאנל.
       */
      it("אין שם שמופיע בשתי קבוצות", () => {
        const shownCols = new Set(disclosureColumns(disclosure.shown));
        const stored = new Set(disclosureColumns(disclosure.storedOnly));
        const hidden = new Set(disclosureColumns(disclosure.hidden));
        expect([...stored].filter((c) => shownCols.has(c))).toEqual([]);
        expect([...hidden].filter((c) => shownCols.has(c) || stored.has(c))).toEqual([]);
      });

      it("שדה DTO אינו גם צ'יפ וגם תשתית", () => {
        const infra = new Set(disclosure.nonFactDtoFields);
        expect(disclosureDtoFields(disclosure.shown).filter((f) => infra.has(f))).toEqual([]);
      });
    });
  }
});
