/**
 * התשובה שמגישה קובץ Markdown — משותפת למסמך המלא ולנושא הבודד.
 *
 * `charset=utf-8` מפורש: בלעדיו דפדפן שמנחש קידוד מציג עברית
 * כג'יבריש, וזה בדיוק הפורמט שאמור להיות בר-הדבקה.
 *
 * `Content-Disposition: inline` ולא `attachment` — מי שלוחץ על
 * הקישור רוצה לקרוא ולסמן, לא למצוא קובץ בתיקיית ההורדות. שם
 * הקובץ נשמר בכל זאת, בשביל מי שכן בוחר לשמור.
 */
export function markdownResponse(body: string, filename: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `inline; filename="${filename}"`,
      /*
       * שעה במטמון, כמו המחירון הציבורי. התיעוד משתנה בגרסה ולא
       * בשעה, ואין בו נתון של אף משרד — הוא זהה לכל מי שמושך אותו.
       */
      "cache-control": "public, max-age=3600",
    },
  });
}
