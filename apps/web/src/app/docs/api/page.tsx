import type { Metadata } from "next";
import { APP_URL } from "@/lib/legal";
import { Code, DocHeader, DocSection, inlineCode } from "../doc-ui";

/**
 * תיעוד הקליטה — **מסמך אחד, ארבעה קהלים.**
 *
 * ## למה זה קיים
 *
 * המערכת כבר קולטת לידים מכל מקור דרך נתיב ציבורי אחד, ומפתח נפרד
 * לכל ערוץ. מה שחסר מעולם לא היה קוד — אף אחד לא ידע שהנתיב קיים,
 * מה הצורה שלו, ואיפה משיגים מפתח.
 *
 * ## למה זה מחליף מסך מיפוי שדות
 *
 * השאלה "איך מחברים מקור ששולח שמות שדות אחרים" נראתה כמו בקשה
 * לבנות ממשק מיפוי. היא אינה: **Make ו-n8n הם כלי מיפוי שדות** —
 * זה כל המוצר שלהם, עם ממשק ויזואלי שחברות שלמות בנו במשך שנים.
 *
 * וההבדל המכריע: המיפוי קורה **אצלם**. מנהל משרד שיטעה יטעה
 * בסצנריו שלו, שם הוא רואה את הנתונים זורמים ומתקן בעצמו. מסך
 * מיפוי אצלנו היה מייצר מצב כשל חדש — "המשרד שבר את הקליטה של
 * עצמו" — שאי אפשר לתמוך בו בטלפון.
 *
 * ## הקהל הרביעי
 *
 * העמוד כתוב כך שאפשר להדביק את כתובתו ל-LLM ולבקש "חבר לי את
 * מודעות הפייסבוק לזה". דוגמאות מלאות, שמות שדות מדויקים ותשובות
 * שגיאה מפורשות — זה מה שהופך תיעוד לדבר שמודל יכול לעבוד מולו.
 * לכן גם `/docs/api.json`: מפרט OpenAPI שנקרא במכונה.
 */

export const metadata: Metadata = {
  title: "תיעוד קליטת לידים — מתווכים",
  description:
    "חיבור כל מקור לידים למערכת מתווכים: Make, n8n, טופס באתר או קוד. נתיב אחד, מפתח לכל ערוץ.",
  alternates: { canonical: `${APP_URL}/docs/api` },
  /*
   * **התיעוד כן נאנדקס** — בניגוד לשאר המערכת.
   *
   * ה-layout הראשי מכריז `index: false` כי אפליקציה פנימית אינה
   * אמורה להופיע בחיפוש. התיעוד הוא ההפך הגמור: הוא נכתב בשביל מי
   * שעדיין לא בפנים, ומי שמחפש "איך מחברים לידים למערכת מתווכים"
   * לא ימצא אותו אם המנוע מונחה לדלג. הצהרה קנונית אינה מבטלת
   * `noindex` — צריך לדרוס אותו במפורש (ביקורת Codex).
   */
  robots: { index: true, follow: true },
};

/** שדות הקליטה — טבלה אחת, שהיא גם מקור האמת לדוגמאות שמתחתיה. */
const FIELDS: { name: string; type: string; required: boolean; note: string }[] = [
  { name: "name", type: "string", required: true, note: "שם הלקוח. 2–120 תווים." },
  {
    name: "phone",
    type: "string",
    required: true,
    note: 'מספר ישראלי. כל צורה מקובלת — "050-1234567", "+972501234567".',
  },
  {
    name: "email",
    type: "string",
    required: false,
    note: "נשמר על הכרטיס, ומאפשר לזהות פניות עתידיות מאותה כתובת.",
  },
  {
    name: "message",
    type: "string",
    required: false,
    note: "מה הלקוח כתב. עד 2000 תווים, נכנס לציר הזמן של הליד.",
  },
  {
    name: "intent",
    type: "enum",
    required: false,
    note: "buy · sell · rent_in · rent_out · info. חסר ⇒ „לא ידוע”.",
  },
  {
    name: "propertyId",
    type: "string",
    required: false,
    note: "הנכס שהמודעה פרסמה. מזהה שאינו של המשרד — מתעלמים ממנו, הליד נקלט.",
  },
  {
    name: "pageUrl",
    type: "string",
    required: false,
    note: "העמוד שממנו הגיעה הפנייה. נשמר בסיכום.",
  },
];

export default function ApiDocsPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <DocHeader
        current="api"
        title="חיבור מקורות לידים"
        lead="כל מקור שיודע לשלוח בקשת HTTP יכול להזרים לידים ישירות למערכת — אתר, מודעות פייסבוק, יד2, קמפיין ממומן או כל כלי אוטומציה. נתיב אחד, ומפתח נפרד לכל ערוץ כדי שתדעו מאיפה הגיע כל ליד."
      />

      <DocSection id="key" title="1. השגת מפתח">
        <p className="mb-2">
          במערכת: <b>ניהול משרד ← אינטגרציות ← מקורות לידים</b>. יוצרים מקור, נותנים לו שם
          (&quot;פייסבוק&quot;, &quot;יד2&quot;, &quot;האתר&quot;) ומקבלים כתובת ייעודית.
        </p>
        <p className="mb-2" style={{ color: "var(--color-text-muted)" }}>
          <b>מקור נפרד לכל ערוץ.</b> השם שבחרתם נשמר על כל ליד שנקלט דרכו, וכך רשימת
          הלידים מראה איזה ערוץ מביא לקוחות. מפתח אחד לכולם עובד — ומאבד בדיוק את המידע
          הזה.
        </p>
        <p style={{ color: "var(--color-danger)" }}>
          המפתח שווה ערך לסיסמה: מי שמחזיק בו יכול להזרים לידים למאגר שלכם. לא לפרסם
          בקוד של דף אינטרנט גלוי.
        </p>
      </DocSection>

      <DocSection id="request" title="2. הבקשה">
        <Code>{`POST ${APP_URL}/api/v1/public/leads/<המפתח>
Content-Type: application/json

{
  "name": "ישראל ישראלי",
  "phone": "050-1234567",
  "email": "israel@example.com",
  "message": "מעוניין בדירת 4 חדרים",
  "intent": "buy"
}`}</Code>
        <p style={{ color: "var(--color-text-muted)" }}>
          תשובה <code style={inlineCode}>200</code> עם{" "}
          <code style={inlineCode}>{`{"ok":true}`}</code> פירושה שהפנייה נקלטה.
        </p>
      </DocSection>

      <DocSection id="fields" title="3. השדות">
        <div className="overflow-x-auto">
          <table className="mv-table w-full text-sm">
            <thead>
              <tr>
                <th className="text-start">שדה</th>
                <th className="text-start">סוג</th>
                <th className="text-start">חובה</th>
                <th className="text-start">הערות</th>
              </tr>
            </thead>
            <tbody>
              {FIELDS.map((field) => (
                <tr key={field.name}>
                  <td dir="ltr">
                    <code style={inlineCode}>{field.name}</code>
                  </td>
                  <td dir="ltr">{field.type}</td>
                  <td>{field.required ? "כן" : "—"}</td>
                  <td>{field.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3" style={{ color: "var(--color-text-muted)" }}>
          {/*
            השדות הנוספים נדחים ולא נבלעים — מי שמחבר מגלה את הטעות
            בזמן הבנייה ולא שבועיים אחר כך.
          */}
          <b>שדה שאינו ברשימה יגרום לדחיית הבקשה.</b> זה מכוון: עדיף שתגלו טעות בשם שדה
          בזמן החיבור, מאשר שהאימייל פשוט לא יישמר ואיש לא ישים לב.
        </p>
      </DocSection>

      <DocSection id="dedup" title="4. מה קורה בצד שלנו">
        <ul className="list-disc space-y-1.5 ps-5">
          <li>
            הלקוח מזוהה לפי הטלפון. פנייה נוספת מאותו מספר <b>מצטרפת לליד הפתוח</b> במקום
            לפתוח כפילות.
          </li>
          <li>
            לקוח שכבר פנה בעבר ונסגר — הליד החדש נפתח מסומן ל<b>טיפול אנושי</b>.
          </li>
          <li>שליחה כפולה של אותו טופס לא יוצרת שני לידים.</li>
          <li>
            כל ליד מפעיל את שרשרת האוטומציות: התראה לסוכן, משימת מענה, והתאמות לנכסים.
          </li>
        </ul>
      </DocSection>

      <DocSection id="make" title="5. חיבור דרך Make">
        <p className="mb-2">
          אין צורך באפליקציה ייעודית — המודול הגנרי עובד:
        </p>
        <ol className="list-decimal space-y-1.5 ps-5">
          <li>
            מוסיפים מודול <b>HTTP ← Make a request</b> אחרי הטריגר (Facebook Lead Ads,
            Google Forms, Webhook…).
          </li>
          <li>
            <b>URL</b>: הכתובת שקיבלתם. <b>Method</b>: POST. <b>Body type</b>: Raw,{" "}
            <b>Content type</b>: JSON.
          </li>
          <li>
            ב-Request content מדביקים את ה-JSON וגוררים לתוכו את השדות מהטריגר.
          </li>
        </ol>
        <Code>{`{
  "name": "{{1.full_name}}",
  "phone": "{{1.phone_number}}",
  "email": "{{1.email}}",
  "message": "{{1.custom_answer}}",
  "intent": "buy"
}`}</Code>
      </DocSection>

      <DocSection id="n8n" title="6. חיבור דרך n8n">
        <p className="mb-2">
          צומת <b>HTTP Request</b>: Method <code style={inlineCode}>POST</code>, Body Content
          Type <code style={inlineCode}>JSON</code>, ו-Specify Body ← Using Fields Below.
          כל שדה מהטבלה למעלה הופך לשורה, והערך נלקח מהצומת הקודם:
        </p>
        <Code>{`name    →  {{ $json.full_name }}
phone   →  {{ $json.phone_number }}
email   →  {{ $json.email }}
message →  {{ $json.message }}`}</Code>
      </DocSection>

      <DocSection id="llm" title="7. חיבור בעזרת LLM">
        <p className="mb-2">
          אפשר להעביר את העמוד הזה למודל שפה ולבקש ממנו לבנות את החיבור. נוסח שעובד:
        </p>
        <Code>{`קרא את התיעוד בכתובת:
${APP_URL}/docs/api

בנה לי סצנריו ב-Make שלוקח לידים מ-Facebook Lead Ads
ושולח אותם לכתובת הקליטה. המפתח שלי הוא: <המפתח>`}</Code>
        <p style={{ color: "var(--color-text-muted)" }}>
          מפרט OpenAPI לקריאת מכונה זמין בכתובת{" "}
          <code style={inlineCode} dir="ltr">
            /docs/api.json
          </code>
          .
        </p>
      </DocSection>

      <DocSection id="errors" title="8. תשובות שגיאה">
        <div className="overflow-x-auto">
          <table className="mv-table w-full text-sm">
            <thead>
              <tr>
                <th className="text-start">קוד</th>
                <th className="text-start">מה קרה</th>
                <th className="text-start">מה לעשות</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td dir="ltr">400</td>
                <td>שדה חסר, שגוי, או שם שדה שאינו מוכר</td>
                <td>להשוות לטבלת השדות; גוף התשובה מפרט מה נדחה</td>
              </tr>
              <tr>
                <td dir="ltr">404</td>
                <td>המפתח אינו מוכר</td>
                <td>להעתיק מחדש את הכתובת ממסך מקורות הלידים</td>
              </tr>
              <tr>
                <td dir="ltr">429</td>
                <td>יותר מ-10 פניות בדקה מאותה כתובת</td>
                <td>להוסיף השהיה בין שליחות</td>
              </tr>
            </tbody>
          </table>
        </div>
      </DocSection>

      <DocSection id="telephony" title="9. מרכזיות טלפון">
        <p>
          חיבור מרכזייה אינו עובר דרך הנתיב הזה — הוא מוגדר ב<b>ניהול משרד ← אינטגרציות ←
          מרכזייה</b>, ומקבל כתובת משלו. המערכת מזהה את שמות השדות המקובלים (015, Asterisk
          וכל מרכזייה ששולחת Webhook) ללא הגדרה נוספת.
        </p>
      </DocSection>

      <p className="mt-10 text-sm" style={{ color: "var(--color-text-muted)" }}>
        נתקעתם? יש שדה שהמקור שלכם שולח ואינו ברשימה? כתבו לנו — ההוספה לרוב מהירה.
      </p>
    </main>
  );
}
