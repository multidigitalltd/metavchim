/**
 * תבנית האימייל של המערכת — עברית, מימין לשמאל, ורספונסיבית.
 *
 * שלוש מגבלות שקובעות את כל מה שכאן, וכולן של לקוחות הדואר ולא
 * שלנו:
 *
 * 1. **טבלאות ולא CSS מודרני.** Outlook מרנדר ב-Word, ו-flex/grid
 *    פשוט אינם קיימים שם. `<table>` נראה ארכאי ועובד בכל לקוח.
 * 2. **סגנון בשורה ולא בגיליון.** חלק מהלקוחות מסירים `<style>`
 *    לגמרי, ו-Gmail מסיר אותו בתצוגת "הודעה מקוצצת". כל כלל שחייב
 *    לעבוד יושב על האלמנט.
 * 3. **גופן מערכת.** הגופן של המותג מוגש מהשרת שלנו; לקוח דואר לא
 *    יטען אותו, ורוב הלקוחות חוסמים `@font-face` ממילא.
 *
 * **גרסת הטקסט נגזרת מאותו תוכן ולא נכתבת בנפרד.** שתי גרסאות שנכתבות
 * ביד נפרדות ביום שמישהו מעדכן אחת מהן — ואת גרסת הטקסט אף אחד לא
 * רואה בבדיקה, כי היא מוצגת רק ללקוחות שחוסמים HTML.
 */

/** צבעי המותג, כפי שהם ב-globals.css. משוכפלים כי אין CSS באימייל. */
const BRAND = {
  text: "#212722",
  muted: "#68716a",
  primary: "#0C6E34",
  action: "#70EE91",
  onAction: "#0B1F12",
  border: "#e2e6e0",
  surface: "#ffffff",
  background: "#f4f6f3",
  danger: "#b0512c",
} as const;

const FONT_STACK =
  "'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans Hebrew', sans-serif";

export interface EmailButton {
  label: string;
  url: string;
}

export interface EmailContent {
  /** כותרת בגוף ההודעה. לרוב זהה לנושא, ולא חייבת. */
  heading?: string;
  /** "שלום דנה," — שורה ראשונה נפרדת, כי היא נושאת שם. */
  greeting?: string;
  /** פסקאות הגוף, לפי הסדר. */
  paragraphs: readonly string[];
  button?: EmailButton;
  /**
   * הערת שוליים — "אם לא ביקשת, התעלם", "אין צורך להשיב".
   * מוצגת קטנה ומעומעמת, מתחת לקו.
   */
  footnote?: string;
  /**
   * ערך בולט שצריך להיקרא ולהיות מועתק — קוד אימות.
   * מוצג גדול, במרווח אותיות, ולא כקישור.
   */
  code?: string;
}

/**
 * בריחת HTML.
 *
 * הכרחית ולא הידור: לתוך הפסקאות נכנסים שמות משתמשים ושמות משרדים,
 * כלומר קלט של אדם. שם שמכיל `<` היה שובר את המבנה, ותוכן ממוקד
 * יותר היה יכול להזריק קישור לגוף ההודעה.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

/**
 * כתובת בטוחה לשימוש ב-href.
 *
 * `javascript:` ו-`data:` בקישור באימייל הם וקטור פישינג קלאסי, וכל
 * הכתובות שלנו הן שלנו — אין סיבה לאפשר סכימה אחרת.
 */
function safeUrl(url: string): string | null {
  return /^https?:\/\//iu.test(url) ? escapeHtml(url) : null;
}

/** הגוף כטקסט — נגזר מאותו תוכן, לא נכתב בנפרד. */
export function renderEmailText(content: EmailContent): string {
  const lines: string[] = [];
  if (content.greeting) lines.push(content.greeting, "");
  for (const paragraph of content.paragraphs) lines.push(paragraph, "");
  if (content.code) lines.push(content.code, "");
  if (content.button) lines.push(`${content.button.label}: ${content.button.url}`, "");
  if (content.footnote) lines.push(content.footnote);
  return lines.join("\n").trimEnd();
}

/**
 * הגוף כ-HTML.
 *
 * הרוחב 600px הוא המוסכמה של לקוחות דסקטופ, ו-`width: 100%` לצידו
 * הוא מה שהופך אותו לרספונסיבי בנייד — הטבלה מצטמצמת ולא נחתכת.
 * ‏`max-width` לבדו אינו נתמך בכל לקוח, ולכן שניהם.
 */
export function renderEmailHtml(content: EmailContent, productName = "מתווכים"): string {
  const parts: string[] = [];

  if (content.heading) {
    parts.push(
      `<h1 style="margin:0 0 16px;font-size:20px;line-height:1.4;font-weight:700;color:${BRAND.text};">${escapeHtml(content.heading)}</h1>`,
    );
  }
  if (content.greeting) {
    parts.push(
      `<p style="margin:0 0 12px;font-size:16px;line-height:1.6;color:${BRAND.text};">${escapeHtml(content.greeting)}</p>`,
    );
  }
  for (const paragraph of content.paragraphs) {
    parts.push(
      `<p style="margin:0 0 12px;font-size:16px;line-height:1.6;color:${BRAND.text};">${escapeHtml(paragraph)}</p>`,
    );
  }
  if (content.code) {
    // `direction:ltr` על הקוד עצמו: ספרות בתוך פסקה עברית מתהפכות
    parts.push(
      `<p style="margin:20px 0;text-align:center;"><span style="display:inline-block;direction:ltr;` +
        `font-family:${FONT_STACK};font-size:30px;font-weight:700;letter-spacing:6px;color:${BRAND.primary};` +
        `background:${BRAND.background};border:1px solid ${BRAND.border};border-radius:10px;padding:12px 22px;">` +
        `${escapeHtml(content.code)}</span></p>`,
    );
  }

  const url = content.button ? safeUrl(content.button.url) : null;
  if (content.button && url !== null) {
    /*
     * כפתור בטבלה ולא `<a>` עם ריפוד: ב-Outlook הריפוד על עוגן
     * נופל, והכפתור מתכווץ לטקסט. תא טבלה עם רקע עובד בכל מקום.
     */
    parts.push(
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0;">` +
        `<tr><td style="background:${BRAND.action};border-radius:10px;">` +
        `<a href="${url}" style="display:inline-block;padding:12px 26px;font-family:${FONT_STACK};` +
        `font-size:16px;font-weight:700;color:${BRAND.onAction};text-decoration:none;">` +
        `${escapeHtml(content.button.label)}</a></td></tr></table>` +
        // הכתובת גם כטקסט: לקוחות שחוסמים כפתורים, ומי שרוצה להעתיק
        `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:${BRAND.muted};word-break:break-all;">` +
        `<span dir="ltr">${url}</span></p>`,
    );
  }

  if (content.footnote) {
    parts.push(
      `<p style="margin:22px 0 0;padding-top:14px;border-top:1px solid ${BRAND.border};` +
        `font-size:14px;line-height:1.6;color:${BRAND.muted};">${escapeHtml(content.footnote)}</p>`,
    );
  }

  const body = parts.join("");
  const name = escapeHtml(productName);

  return `<!doctype html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name}</title>
</head>
<body dir="rtl" style="margin:0;padding:0;background:${BRAND.background};font-family:${FONT_STACK};">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${BRAND.background};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%;max-width:600px;background:${BRAND.surface};border:1px solid ${BRAND.border};border-radius:14px;">
<tr><td style="padding:22px 26px 0;">
<p style="margin:0;font-size:17px;font-weight:800;color:${BRAND.primary};">${name}</p>
</td></tr>
<tr><td dir="rtl" style="padding:16px 26px 26px;text-align:right;">${body}</td></tr>
</table>
<p style="margin:14px 0 0;font-size:14px;color:${BRAND.muted};text-align:center;">${name}</p>
</td></tr>
</table>
</body>
</html>`;
}
