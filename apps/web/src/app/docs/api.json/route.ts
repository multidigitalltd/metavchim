/**
 * מפרט OpenAPI של נתיב הקליטה הציבורי.
 *
 * ## למה מפרט ולא רק עמוד תיעוד
 *
 * עמוד ה-HTML נועד לאדם. המפרט נועד ל**כלים**: Postman ו-Insomnia
 * מייבאים אותו ישירות, מחוללי קוד בונים ממנו לקוח, ומודל שפה מקבל
 * ממנו את שמות השדות והטיפוסים בלי לנחש מתוך פרוזה.
 *
 * זה מה שהופך "חבר לי את מודעות הפייסבוק למערכת" מבקשה שדורשת
 * ממני לכתוב מחבר, לבקשה שהמשרד פותר לבד מול הכלי שכבר יש לו.
 *
 * ## למה route ולא קובץ סטטי
 *
 * ה-`servers` נגזר מהכתובת שממנה המפרט נמשך בפועל. בייצור זו תמיד
 * `APP_URL` — המערכת היא ענן, ואין התקנות בדומיין של לקוח — ולכן
 * במסלול הרגיל אין הבדל בין השניים.
 *
 * ההבדל הוא בסביבות שאינן ייצור. מפרט עם כתובת קבועה שנמשך משרת
 * מקומי או מסביבת בדיקות היה מפנה כלי שמייבא אותו **לייצור**,
 * כלומר בדיקה של מפתח הייתה מזרימה לידים אמיתיים למאגר אמיתי.
 * גזירה מהמקור נותנת בכל סביבה את הכתובת של אותה סביבה.
 *
 * הפרוזה בעמוד התיעוד נוקבת דווקא ב-`APP_URL` הקבוע: היא נקראת
 * בעיניים ומועתקת ל-Make או ל-n8n, ושם צריכה להופיע הכתובת
 * האמיתית ולא הכתובת שממנה במקרה נפתח העמוד.
 */
export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  const origin = new URL(request.url).origin;

  const spec = {
    openapi: "3.1.0",
    info: {
      title: "מתווכים — קליטת לידים",
      version: "1.0.0",
      description:
        "קליטת לידים ממקור חיצוני. מפתח נפרד לכל ערוץ, ושם הערוץ נשמר על כל ליד. " +
        "תיעוד מלא עם דוגמאות ל-Make ול-n8n: " +
        `${origin}/docs/api`,
    },
    servers: [{ url: origin }],
    paths: {
      "/api/v1/public/leads/{key}": {
        post: {
          summary: "קליטת ליד חדש",
          description:
            "הלקוח מזוהה לפי הטלפון. פנייה נוספת מאותו מספר מצטרפת לליד הפתוח " +
            "במקום לפתוח כפילות. שליחה כפולה של אותו טופס אינה יוצרת שני לידים.",
          operationId: "ingestLead",
          parameters: [
            {
              name: "key",
              in: "path",
              required: true,
              description:
                "מפתח המקור, מתוך ניהול משרד ← אינטגרציות ← מקורות לידים. " +
                "שווה ערך לסיסמה — אין להטמיע בקוד של דף גלוי.",
              schema: { type: "string", pattern: "^[A-Za-z0-9_-]{20,64}$" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/LeadInput" },
                examples: {
                  minimal: {
                    summary: "המינימום",
                    value: { name: "ישראל ישראלי", phone: "050-1234567" },
                  },
                  full: {
                    summary: "ליד מלא ממודעה של נכס",
                    value: {
                      name: "ישראל ישראלי",
                      phone: "050-1234567",
                      email: "israel@example.com",
                      message: "מעוניין בדירת 4 חדרים",
                      intent: "buy",
                      pageUrl: "https://example.com/apartment-4-rooms",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "הפנייה נקלטה",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { ok: { type: "boolean", const: true } },
                    required: ["ok"],
                  },
                },
              },
            },
            "400": {
              description: "שדה חסר, שגוי, או שם שדה שאינו מוכר",
            },
            "404": {
              description: "המפתח אינו מוכר",
            },
            "429": {
              description: "יותר מ-10 פניות בדקה מאותה כתובת",
            },
          },
        },
      },
    },
    components: {
      schemas: {
        LeadInput: {
          type: "object",
          /*
           * `additionalProperties: false` משקף את `.strict()` בשרת.
           * מחולל קוד שמייצר שדה נוסף היה יוצר לקוח שנדחה תמיד —
           * עדיף שהוא יידע את זה מהמפרט.
           */
          additionalProperties: false,
          required: ["name", "phone"],
          properties: {
            name: {
              type: "string",
              minLength: 2,
              maxLength: 120,
              description: "שם הלקוח",
            },
            phone: {
              type: "string",
              maxLength: 25,
              description:
                'מספר ישראלי בכל צורה מקובלת — "050-1234567", "+972501234567", "0501234567"',
            },
            email: {
              type: "string",
              format: "email",
              maxLength: 200,
              description: "נשמר על הכרטיס ומאפשר זיהוי פניות עתידיות מאותה כתובת",
            },
            message: {
              type: "string",
              maxLength: 2000,
              description: "מה שהלקוח כתב — נכנס לציר הזמן של הליד",
            },
            intent: {
              type: "string",
              enum: ["buy", "sell", "rent_in", "rent_out", "info"],
              description: "מה הלקוח רוצה. חסר ⇒ „לא ידוע”",
            },
            propertyId: {
              type: "string",
              minLength: 26,
              maxLength: 26,
              description:
                "הנכס שהמודעה פרסמה. מזהה שאינו של המשרד — מתעלמים ממנו והליד עדיין נקלט",
            },
            pageUrl: {
              type: "string",
              maxLength: 300,
              description: "העמוד שממנו הגיעה הפנייה",
            },
            website: {
              type: "string",
              maxLength: 200,
              description:
                "מלכודת בוטים. יש להשאיר ריק — בקשה שממלאת אותו מוחזרת כהצלחה ואינה נקלטת",
            },
          },
        },
      },
    },
  };

  return new Response(JSON.stringify(spec, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      // המפרט נגזר מהכתובת בלבד ואינו משתנה בין בקשות
      "cache-control": "public, max-age=3600",
    },
  });
}
