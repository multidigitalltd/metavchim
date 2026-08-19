import { docsMarkdown } from "@/lib/guide-content";
import { markdownResponse } from "./markdown-response";

/**
 * כל התיעוד בקובץ Markdown אחד.
 *
 * ## למה נתיב ולא כפתור העתקה בלבד
 *
 * כפתור ההעתקה שבעמוד פותר את המקרה הנפוץ — אדם שמדביק לצ'אט.
 * הוא אינו פותר שני מקרים אחרים: כלי שמקבל **כתובת** של מסמך
 * ומושך אותו בעצמו, ומשרד שרוצה לשמור את התיעוד אצלו.
 *
 * שניהם מקבלים כאן טקסט נקי. עמוד ה-HTML של המערכת מגיע אליהם
 * עטוף בניווט, כפתורים וסקריפטים — כלומר רועש בדיוק במידה
 * שמקלקלת את התשובה.
 */
export const dynamic = "force-static";

export function GET(): Response {
  return markdownResponse(docsMarkdown(), "metavchim-docs.md");
}
