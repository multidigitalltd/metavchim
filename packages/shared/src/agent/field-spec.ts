/**
 * מפרט שדה — **הצהרה אחת שממנה נגזר הכול.**
 *
 * ## הבעיה שזה פותר
 *
 * בסוכן הקולי הקודם רשימת הפעולות הופיעה בשלושה מקומות נפרדים:
 * בפרומפט שנשלח למודל (מחרוזת), בסכימת ה-zod שמאמתת את התשובה,
 * ובמסך שמציג את התוצאה. שלושה מקומות שצריך לזכור לעדכן יחד, וכל
 * שכחה מייצרת דריפט שקט: המודל מציע שדה שהשרת זורק, או השרת מקבל
 * שדה שהמסך לא יודע להציג.
 *
 * כאן שדה מוצהר **פעם אחת**, ומאותה הצהרה נגזרים:
 *
 * 1. `fieldZod` — הוולידציה בשרת.
 * 2. `fieldJsonSchema` — הסכימה ש-Gemini מקבל (‏responseSchema‏),
 *    כלומר המודל **מוגבל מבנית** ולא רק מתבקש יפה בפרוזה.
 * 3. `label` — מה שהמתווך רואה בכרטיס ההצעה.
 *
 * שלושתם אינם יכולים לחלוק, כי הם אותו אובייקט.
 *
 * ## מה שדה כאן אינו יכול להיות
 *
 * **תאריך ומיקום גאוגרפי אינם שדות שהמודל ממלא.** "יום שלישי הקרוב"
 * דורש לוח שנה ואזור זמן, לא שפה, ו"רחוב הרב שך" דורש geocoding מול
 * שירות מפות. מודל שמנחש אותם נשמע משכנע וטועה בשקט. לכן הם נפתרים
 * דטרמיניסטית מהתמלול **אחרי** התשובה של המודל — ולסוגי השדות כאן
 * אין בכלל טיפוס `date`.
 */

/** מה המודל רשאי למלא. אין כאן `date` ואין `id` — ראו ההסבר למעלה. */
export type AgentFieldSpec =
  | {
      key: string;
      label: string;
      type: "string";
      /** רמז למודל — נכנס לתיאור בסכימה, לא לפרוזה חופשית */
      hint?: string;
      maxLength: number;
    }
  | {
      key: string;
      label: string;
      type: "number" | "integer";
      hint?: string;
      min: number;
      max: number;
      /** חדרים הם כפולות של חצי; שאר המספרים שלמים */
      multipleOf?: number;
    }
  | { key: string; label: string; type: "boolean"; hint?: string }
  | {
      key: string;
      label: string;
      type: "enum";
      hint?: string;
      values: readonly string[];
      /** תווית עברית לכל ערך — למסך, ולתיאור שהמודל רואה */
      valueLabels: Readonly<Record<string, string>>;
    }
  | { key: string; label: string; type: "stringList"; hint?: string; maxItems: number }
  | {
      key: string;
      label: string;
      type: "enumList";
      hint?: string;
      values: readonly string[];
      valueLabels: Readonly<Record<string, string>>;
      maxItems: number;
    };

export type AgentFieldType = AgentFieldSpec["type"];

/** תיאור השדה כפי שהמודל רואה אותו: התווית, הרמז, ומשמעות הערכים. */
export function fieldDescription(spec: AgentFieldSpec): string {
  const parts = [spec.label];
  if (spec.hint !== undefined) parts.push(spec.hint);
  if (spec.type === "enum" || spec.type === "enumList") {
    parts.push(
      spec.values.map((value) => `${value}=${spec.valueLabels[value] ?? value}`).join(", "),
    );
  }
  return parts.join(" — ");
}

/**
 * סכימת JSON לשדה בודד, בתת-הקבוצה ש-Gemini מקבל ב-`responseSchema`.
 *
 * הוא תומך ב-OpenAPI 3.0 מצומצם: type/description/enum/items/‏
 * minimum/maximum. `multipleOf` **אינו** נתמך שם, ולכן הוא נאכף
 * ב-zod בלבד — הסכימה מצמצמת, ה-zod מכריע.
 */
export function fieldJsonSchema(spec: AgentFieldSpec): Record<string, unknown> {
  const description = fieldDescription(spec);
  switch (spec.type) {
    case "string":
      return { type: "string", description };
    case "number":
      return { type: "number", description, minimum: spec.min, maximum: spec.max };
    case "integer":
      return { type: "integer", description, minimum: spec.min, maximum: spec.max };
    case "boolean":
      return { type: "boolean", description };
    case "enum":
      return { type: "string", description, enum: [...spec.values] };
    case "stringList":
      return { type: "array", description, items: { type: "string" } };
    case "enumList":
      return {
        type: "array",
        description,
        items: { type: "string", enum: [...spec.values] },
      };
  }
}

/**
 * הערך כפי שהוא מוצג למתווך בכרטיס ההצעה.
 *
 * ‎`enum`‎ מוצג בתווית העברית ולא במפתח: מתווך שרואה `pre_approved`
 * אינו יודע אם לאשר, ומתווך שרואה „אישור עקרוני” יודע מיד.
 */
export function formatFieldValue(spec: AgentFieldSpec, value: unknown): string {
  if (value === undefined || value === null) return "";
  switch (spec.type) {
    case "boolean":
      return value === true ? "כן" : "לא";
    case "enum":
      return spec.valueLabels[String(value)] ?? String(value);
    case "enumList":
      return Array.isArray(value)
        ? value.map((v) => spec.valueLabels[String(v)] ?? String(v)).join(" · ")
        : String(value);
    case "stringList":
      return Array.isArray(value) ? value.join(" · ") : String(value);
    default:
      return String(value);
  }
}
