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

/** הסכימה של פעולה כפי ש-Gemini מקבל אותה. */
export function actionJsonSchema(action: AgentActionDef): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const field of action.fields) {
    properties[field.key] = fieldJsonSchema(field);
  }
  return { type: "object", properties };
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

/** הצורה שהשרת מקבל — לפני הצמצום לפעולה שנבחרה. */
export const InterpretResponseSchema = z.object({
  action: z.enum([...AGENT_ACTION_IDS, "unknown"] as [string, ...string[]]),
  params: z.record(z.string(), z.unknown()).default({}),
  evidence: z.record(z.string(), z.string()).default({}),
  unmapped: z.array(z.string().max(300)).max(10).default([]),
  clarify: z.string().max(300).optional(),
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
});

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
