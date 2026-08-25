import { AGENT_RESULT_ROWS, agentResultList } from "@metavchim/shared";

/**
 * שתי קריאות של אותן תוצאות — אחת למתווך, אחת לזיכרון השיחה.
 *
 * ## למה שתיים, ולמה מאותו מקום
 *
 * מה שהמתווך רואה ומה שנשמר בזיכרון אינם אותו דבר, ואסור שיהיו:
 * התשובה נשלחת אליו בלבד, והזיכרון נשלח בתור הבא לפרומפט של מודל
 * חיצוני. לכן התשובה כוללת טלפונים והזיכרון לא.
 *
 * מה שכן חייב להיות זהה הוא **הסדר והשמות**: „תקבע לראשון מהם”
 * עובד רק אם הרשימה שהמודל זוכר היא בדיוק הרשימה שהמתווך ראה. שני
 * מנסחים נפרדים היו נפרדים ברגע שאחד מהם משתנה — ולכן שניהם
 * נגזרים כאן מ-`resultRows` אחת.
 *
 * ## מה לעולם אינו נכנס לזיכרון
 *
 * שם וסדר בלבד. לא טלפון, לא אימייל, לא הערות ולא תקצירי שיחות.
 * זה אינו סינון של השדות הידועים אלא ההפך — רשימת השדות שנאספים
 * היא סגורה, ולכן שדה חדש שיתווסף לתשובה בעתיד אינו יכול לזלוג
 * לזיכרון בלי שמישהו יוסיף אותו לכאן במפורש.
 */

interface ResultRow {
  label: string;
  phone?: string;
}

/**
 * שורות התוצאה לפי הסדר שהוחזר.
 *
 * **קודם הרשימה המשותפת, ורק אחר כך הסריקה הכללית.**
 *
 * זו לא אופטימיזציה אלא מה שמחזיק את ההמשך הרב-תורי: התשובה
 * שנשלחה למתווך נבנית מ-`agentResultList`, וכשהזיכרון נבנה מסריקה
 * אחרת — עם תקרה אחרת ועם שמות משדות אחרים — נוצר פער שהמתווך
 * נופל לתוכו. אחרי `show_calls` אפילו „הראשון מהם” לא היה מוכר,
 * כי שורת שיחה נושאת `contactName` ולא `name` (ביקורת Codex).
 *
 * הסריקה הכללית נשארת לצורות שהרשימה המשותפת אינה מכירה — כרטיס
 * יחיד, ותוצאות של פעולות שאינן קריאה.
 *
 * `data` מגיע כמערך או כאובייקט של מערכים (`{buyers: [...]}`),
 * ושתי הצורות נסרקות באותו אופן.
 */
function resultRows(data: unknown): ResultRow[] {
  const shared = agentResultList(data);
  if (shared !== null) {
    return shared.rows
      .slice(0, AGENT_RESULT_ROWS)
      .map((row) => (row.phone === undefined ? { label: row.label } : { label: row.label, phone: row.phone }));
  }

  const rows: ResultRow[] = [];
  const collect = (items: unknown): void => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (rows.length >= AGENT_RESULT_ROWS) return;
      if (typeof item !== "object" || item === null) continue;
      const record = item as Record<string, unknown>;
      const label = record["name"] ?? record["title"] ?? record["marketingTitle"];
      if (typeof label !== "string" || label === "") continue;
      /* `contactPhone` הוא השם שפעולות השיחה משתמשות בו. */
      const phone = record["phone"] ?? record["contactPhone"];
      rows.push(
        typeof phone === "string" && phone !== "" ? { label, phone } : { label },
      );
    }
  };
  if (Array.isArray(data)) collect(data);
  else if (typeof data === "object" && data !== null) {
    for (const value of Object.values(data as Record<string, unknown>)) collect(value);
  }
  return rows;
}

/**
 * מה שהמתווך קורא — שם וטלפון, שורה לכל תוצאה.
 *
 * הטלפון נאמר לצד השם ולא נבלע: קודם נאספה רק התווית, ולכן „מה
 * הטלפון של משה כהן?” נענה ב„בין התוצאות: משה כהן” — בלי מספר,
 * תמיד. הסוכן נבנה כדי לחסוך כניסה לדשבורד, ורשימת שמות בלי
 * מספרים מחייבת בדיוק אותה.
 *
 * שורה לכל תוצאה ולא משפט רץ: מספר טלפון בתוך משפט אי אפשר להעתיק
 * בנוחות בטלפון.
 */
export function summarizeData(data: unknown): string {
  const rows = resultRows(data);
  if (rows.length === 0) return "";
  const lines = rows.map((row) =>
    row.phone === undefined ? `• ${row.label}` : `• ${row.label} · ${row.phone}`,
  );
  return `בין התוצאות, לפי הסדר:\n${lines.join("\n")}`;
}

/** תקרת הזיכרון — מוסכמת עם `resultSummary` בסכימת הנתיב. */
const MAX_SUMMARY = 600;

/**
 * מה שנשמר לתור הבא — שורת המצב, ואחריה השמות לפי הסדר.
 *
 * שורת המצב („נמצאו 3 קונים”) לבדה אינה מספיקה: `buildInterpretPrompt`
 * מסתמך על השמות כדי לתרגם „הראשון מהם” לרשומה, וזיכרון בלי שמות
 * שובר את ההמשך הרב-תורי (ביקורת Codex). התשובה המלאה, לעומת זאת,
 * כוללת מאז הכרטיס המלא גם טלפונים והערות — ושמירתה כמות שהיא
 * הייתה מעקפת את `redactForInsight` בדלת האחורית.
 *
 * לכן: הסדר והשמות נשמרים, כל השאר נשאר בתשובה שנשלחה למתווך
 * בלבד.
 */
export function historySummary(message: string, data: unknown): string {
  const labels = resultRows(data).map((row) => row.label);
  const head = message.replaceAll("\n", " ").trim();
  const full = labels.length === 0 ? head : `${head} | לפי הסדר: ${labels.join(", ")}`;
  return full.slice(0, MAX_SUMMARY);
}
