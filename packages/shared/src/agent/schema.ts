/**
 * מהקטלוג אל שני הצרכנים: הסכימה שהמודל מקבל, והוולידציה שהשרת אוכף.
 *
 * ## למה `responseSchema` ולא בקשה יפה בפרוזה
 *
 * הגרסה הקודמת ביקשה מהמודל „החזר JSON עם השדות האלה” וקיוותה. זה
 * עובד סביר לתשעה שמות פעולה וקורס כשצריך למלא עשרים וחמישה שדות
 * מודפסים: המודל ממציא מפתחות, מחזיר מחרוזת במקום מספר, וממציא ערך
 * ל-enum. `responseSchema` הופך את זה מבקשה למגבלה — ה-API עצמו
 * אוכף את המבנה, והמודל אינו יכול לחרוג ממנו.
 *
 * ה-zod נשאר מעליו ואינו מיותר: הסכימה של Gemini היא תת-קבוצה של
 * OpenAPI ואינה יודעת לבטא כפולות של חצי, אורך מחרוזת או יחסי
 * טווח. **הסכימה מצמצמת, ה-zod מכריע.**
 */

import { z } from "zod";
import { AGENT_ACTION_IDS, AGENT_ACTIONS, type AgentActionDef } from "./actions.js";
import { fieldDescription, fieldJsonSchema, type AgentFieldSpec } from "./field-spec.js";

/** ולידציית שדה בודד — כולל מה שסכימת Gemini אינה יודעת לבטא. */
export function fieldZod(spec: AgentFieldSpec): z.ZodTypeAny {
  switch (spec.type) {
    case "string":
      return z.string().trim().min(1).max(spec.maxLength);
    case "number": {
      let schema = z.number().min(spec.min).max(spec.max);
      if (spec.multipleOf !== undefined) schema = schema.multipleOf(spec.multipleOf);
      return schema;
    }
    case "integer":
      return z.number().int().min(spec.min).max(spec.max);
    case "boolean":
      return z.boolean();
    case "enum":
      return z.enum(spec.values as [string, ...string[]]);
    case "stringList":
      return z.array(z.string().trim().min(1).max(120)).max(spec.maxItems);
    case "enumList":
      return z.array(z.enum(spec.values as [string, ...string[]])).max(spec.maxItems);
  }
}

/**
 * סכימת הפרמטרים של פעולה. **הכול אופציונלי בכוונה.**
 *
 * שדה חסר הוא המצב הרגיל ולא שגיאה: מתווך אומר משפט אחד ולא ממלא
 * טופס. סכימה שדורשת שדה הייתה מכריחה את המודל להמציא אותו — וזה
 * בדיוק הכשל שהמערכת הזאת באה למנוע. מה שחסר מסומן למתווך בכרטיס
 * ההצעה, והוא משלים במקום.
 */
export function actionParamsZod(action: AgentActionDef): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of action.fields) {
    shape[field.key] = fieldZod(field).optional();
  }
  /*
   * `strip` ולא `strict`: מפתח שהמודל המציא נזרק בשקט במקום להפיל
   * את כל ההצעה. שדה מיותר אחד אינו סיבה לאבד משפט שלם שהובן נכון.
   */
  return z.object(shape);
}

/**
 * התשובה המלאה שהמודל מחזיר.
 *
 * ## למה `params` הוא אובייקט אחד ולא אחד לכל פעולה
 *
 * סכימת Gemini אינה תומכת ב-`oneOf`, ולכן אי אפשר לבטא „params לפי
 * הפעולה שנבחרה”. איחוד כל השדות של כל הפעולות לאובייקט אחד עובד:
 * המודל בוחר `action` וממלא רק את מה ששייך לה, והוולידציה בשרת
 * מצמצמת לסכימה של אותה פעולה בלבד — כלומר שדה ששייך לפעולה אחרת
 * נזרק ולא נשמר.
 *
 * מפתח שמופיע בכמה פעולות (‏`cities`, `roomsMin`) חייב להיות מוצהר
 * זהה בכולן, אחרת אחת מהן תקבל תיאור של אחרת. בדיקה מבנית אוכפת
 * את זה.
 */
export function interpretJsonSchema(): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  const seen = new Map<string, string>();
  for (const action of AGENT_ACTIONS) {
    for (const field of action.fields) {
      const description = fieldDescription(field);
      const previous = seen.get(field.key);
      if (previous === undefined) {
        seen.set(field.key, description);
        params[field.key] = fieldJsonSchema(field);
      }
    }
  }
  return {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [...AGENT_ACTION_IDS, "unknown"],
        description: "הפעולה המבוקשת. unknown = לא ברור, אל תנחש.",
      },
      params: { type: "object", properties: params },
      evidence: {
        type: "object",
        description:
          "לכל שדה שמילאת — המילים המדויקות מהמשפט שממנו הבנת אותו. מפתח = שם השדה.",
        properties: Object.fromEntries(
          [...seen.keys()].map((key) => [key, { type: "string" }]),
        ),
      },
      unmapped: {
        type: "array",
        description: "דברים שנאמרו ולא הצלחת לשייך לשום שדה. אל תשמיט אותם בשקט.",
        items: { type: "string" },
      },
      clarify: {
        type: "string",
        description:
          "שאלה קצרה אחת, רק אם באמת אי אפשר להמשיך בלעדיה. השאר ריק כשאפשר להציע משהו.",
      },
      reply: {
        type: "string",
        description:
          "רק כש-action=unknown: אם המשפט הוא ברכה, תודה או שאלה כללית — תשובה קצרה, חמה ומועילה בעברית, שמסתיימת בהכוונה עדינה למה שאתה כן יודע לעשות. אחרת השאר ריק.",
      },
      suggest: {
        type: "array",
        description:
          "רק כש-action=unknown: עד שלוש פעולות מהרשימה שהיו הקרובות ביותר למה שנאמר, לפי סדר הקרבה. המתווך יראה אותן ויוכל לבחור — הן אינן מבוצעות מעצמן. רק פעולות שסביר שהתכוון אליהן; אין כזו — השאר ריק.",
        items: { type: "string", enum: [...AGENT_ACTION_IDS] },
      },
      dateText: {
        type: "string",
        description:
          "מילות המועד של הפעולה הראשית, כפי שנאמרו (\"מחר בעשר\", \"עוד שעה\", \"ביום שלישי הבא\"). השמט אם לא נאמר מועד. אל תחשב תאריך — רק המילים.",
      },
      steps: {
        type: "array",
        description:
          "פעולות המשך, כשהמשפט ביקש כמה פעולות. הראשונה נשארת ב-action/params; כאן הבאות, לפי הסדר. ריק כשיש פעולה אחת.",
        items: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: [...AGENT_ACTION_IDS],
            },
            params: { type: "object", properties: params },
            dateText: {
              type: "string",
              description:
                "מילות המועד של הצעד הזה בלבד, כפי שנאמרו (\"מחר בעשר\", \"ביום שישי\"). השמט אם לא נאמר מועד לצעד הזה. אל תחשב תאריך — רק המילים.",
            },
          },
          required: ["action"],
        },
      },
    },
    required: ["action"],
  };
}

/**
 * נרמול סלחני לפני הוולידציה — **למצב ה-JSON החופשי.**
 *
 * כשהמודל דוחה את `responseSchema` (‏HTTP 400‏, קרה בפרודקשן עם
 * gemini-3.6-flash) הקריאה רצה בלי אכיפת מבנה, ומודלים במצב חופשי
 * נוהגים לכתוב `null` בשדה ריק, להחזיר מחרוזת בודדת במקום רשימה,
 * ולהמציא צעד עם פעולה לא קיימת. כל אחת מהסטיות האלה הפילה את
 * הפענוח **כולו** ל"זיהוי בסיסי" — על משפט שהובן נכון (האבחון:
 * כפתור בדיקת המנוע).
 *
 * הכלל: סטייה בשדה עזר (evidence/unmapped/clarify/צעד בודד) מנוקה
 * או נזרקת — לא מפילה את ההצעה. `action` נשאר קשיח: בלעדיו אין מה
 * להציע, וניחוש שלו הוא בדיוק מה שאסור.
 */
function tolerantInterpretInput(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
  const value: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  for (const key of Object.keys(value)) {
    if (value[key] === null) delete value[key];
  }
  if (isPlainObject(value["evidence"])) {
    value["evidence"] = Object.fromEntries(
      Object.entries(value["evidence"] as Record<string, unknown>).filter(
        ([, v]) => typeof v === "string",
      ),
    );
  } else {
    delete value["evidence"];
  }
  if (typeof value["unmapped"] === "string") value["unmapped"] = [value["unmapped"]];
  if (Array.isArray(value["unmapped"])) {
    value["unmapped"] = (value["unmapped"] as unknown[])
      .filter((v): v is string => typeof v === "string")
      .slice(0, 10)
      .map((v) => v.slice(0, 300));
  } else {
    delete value["unmapped"];
  }
  if (typeof value["clarify"] === "string") value["clarify"] = value["clarify"].slice(0, 300);
  else delete value["clarify"];
  if (typeof value["reply"] === "string") value["reply"] = value["reply"].slice(0, 600);
  else delete value["reply"];
  /*
   * ‎`suggest` מנוקה ולא נאכף: מזהה שאינו בקטלוג יורד, וכל צורה אחרת
   * נמחקת. הצעה היא שדה עזר — אכיפה שלה הייתה מפילה פענוח תקין בגלל
   * מזהה שהמודל המציא בשורה שממילא רק מציעה.
   */
  if (typeof value["suggest"] === "string") value["suggest"] = [value["suggest"]];
  if (Array.isArray(value["suggest"])) {
    value["suggest"] = (value["suggest"] as unknown[])
      .filter(
        (v): v is string =>
          typeof v === "string" && (AGENT_ACTION_IDS as readonly string[]).includes(v),
      )
      .slice(0, 3);
  } else {
    delete value["suggest"];
  }
  if (typeof value["dateText"] === "string") value["dateText"] = value["dateText"].slice(0, 200);
  else delete value["dateText"];
  /*
   * `params` שגוי (מחרוזת/מערך) **נשאר** כדי שהוולידציה תיכשל והפירוש
   * ייפול לחוקים. מחיקה שלו הייתה הופכת אותו ל-`{}` תקין-למראה —
   * ו"קונים בגבעתיים עם 4 חדרים" היה מחזיר את כל המאגר בלי סינון,
   * תוצאה סבירה-למראה ושגויה (ביקורת Codex). רק null נחשב "ריק".
   */
  if (Array.isArray(value["steps"])) {
    value["steps"] = (value["steps"] as unknown[])
      .filter(
        (step): step is Record<string, unknown> =>
          isPlainObject(step) &&
          (AGENT_ACTION_IDS as readonly string[]).includes(String(step["action"])) &&
          // params שגוי פוסל את הצעד כולו — לא הופך אותו לצעד בלי פרמטרים
          (step["params"] === undefined ||
            step["params"] === null ||
            isPlainObject(step["params"])),
      )
      .slice(0, 4)
      .map((step) => {
        const clean: Record<string, unknown> = { ...step };
        for (const key of Object.keys(clean)) {
          if (clean[key] === null) delete clean[key];
        }
        if (typeof clean["dateText"] === "string") {
          clean["dateText"] = clean["dateText"].slice(0, 200);
        } else {
          delete clean["dateText"];
        }
        return clean;
      });
  } else {
    delete value["steps"];
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** הצורה שהשרת מקבל — לפני הצמצום לפעולה שנבחרה. */
export const InterpretResponseSchema = z.preprocess(
  tolerantInterpretInput,
  z.object({
    action: z.enum([...AGENT_ACTION_IDS, "unknown"] as [string, ...string[]]),
    params: z.record(z.string(), z.unknown()).default({}),
    evidence: z.record(z.string(), z.string()).default({}),
    unmapped: z.array(z.string().max(300)).max(10).default([]),
    clarify: z.string().max(300).optional(),
    /** תשובה שיחתית לברכה/תודה/שאלה כללית — מוצגת בלבד, לעולם לא מבוצעת */
    reply: z.string().max(600).optional(),
    /*
     * ‎**הפעולות הקרובות — כש`action` הוא `unknown`.**
     *
     * „לא הבנתי, נסו לנסח אחרת” היה קיר: המתווך אמר משפט סביר, קיבל
     * דחייה, ולא קיבל שום כיוון — בזמן שהקטלוג שהמודל בדיוק סרק
     * מכיל שבעים ושתיים פעולות עם דוגמאות ניסוח. המודל הוא היחיד
     * שיודע מה **כמעט** התאים, וזו ידיעה שנזרקה.
     *
     * הרשימה מוצעת ואינה מבוצעת: בחירה בה מריצה פירוש מחדש של אותו
     * משפט, נעוץ לפעולה שהמתווך בחר, וממשיכה משם במסלול הרגיל —
     * כולל אישור לפעולה שכותבת. מזהה לא מוכר מנוקה ב-
     * ‎`tolerantInterpretInput` ולא מפיל את הפענוח.
     */
    suggest: z.array(z.string()).max(3).default([]),
    /*
     * מילות המועד של הפעולה הראשית — **לא תאריך מחושב.**
     *
     * הצעדים נשאו את זה מלכתחילה; הפעולה הראשית לא, והמועד שלה נפתר
     * מסריקת המשפט **המלא** מחדש. כלומר בדיוק בחלק שדורש הבנת שפה
     * המודל הודר, וכל ניסוח שהתבניות לא צפו נפל — „עוד שעה” בלי
     * בי"ת, פיסוק שנדבק, „עוד פעם” שמסתיר „בעוד שעה”. כל אלה היו
     * ממצאים אמיתיים, וכל אחד מהם דרש תבנית נוספת.
     *
     * כאן המודל מסמן **אילו מילים** הן המועד, והקוד ממשיך לחשב את
     * התאריך מהן — לוח שנה ואזור זמן נשארים דטרמיניסטיים. הסריקה של
     * המשפט המלא נשארת כרשת ביטחון, לא כנתיב הראשי.
     */
    dateText: z.string().max(200).optional(),
    /*
     * עד ארבעה צעדי המשך: משפט אחד מבקש לכל היותר כמה פעולות ספורות,
     * ורשימה ארוכה מזה היא כמעט בוודאות הזיה — עדיף לקטוע אותה.
     */
    steps: z
      .array(
        z.object({
          action: z.enum(AGENT_ACTION_IDS as unknown as [string, ...string[]]),
          params: z.record(z.string(), z.unknown()).default({}),
          /*
           * מילות המועד של הצעד — לא תאריך מחושב. "תזכיר לי מחר ותקבע
           * פגישה ביום שישי": פענוח המשפט המלא לכל צעד היה נותן לשניהם
           * את אותו תאריך (ביקורת Codex); כל צעד נושא את הביטוי שלו,
           * והקוד מחשב אותו בלוח ירושלים כרגיל.
           */
          dateText: z.string().max(200).optional(),
        }),
      )
      .max(4)
      .default([]),
  }),
);

export type InterpretResponse = z.infer<typeof InterpretResponseSchema>;

/**
 * צמצום לפעולה שנבחרה: שדה ששייך לפעולה אחרת נזרק, ושדה שנכשל
 * בוולידציה מדווח ולא מתוקן.
 *
 * ## למה כשל בשדה אינו מפיל את ההצעה
 *
 * מודל שהחזיר `rooms: 3.7` טעה בשדה אחד, ולא בהבנת המשפט. זריקת
 * כל ההצעה בגללו הייתה מחזירה למתווך „לא הבנתי” על משפט שהובן
 * כמעט כולו. השדה הפגום יורד, שמו נרשם ב-`rejected`, והמתווך רואה
 * בדיוק מה לא נכנס — במקום לגלות זאת אחרי השמירה.
 */
export function narrowParams(
  action: AgentActionDef,
  raw: Record<string, unknown>,
): { params: Record<string, unknown>; rejected: string[] } {
  const params: Record<string, unknown> = {};
  const rejected: string[] = [];
  for (const field of action.fields) {
    const value = raw[field.key];
    if (value === undefined || value === null || value === "") continue;
    const parsed = fieldZod(field).safeParse(value);
    if (parsed.success) {
      // רשימה ריקה אינה ערך — היא רק רעש בכרטיס
      if (Array.isArray(parsed.data) && parsed.data.length === 0) continue;
      params[field.key] = parsed.data;
    } else {
      rejected.push(field.key);
    }
  }
  return { params, rejected };
}
