import type { Metadata } from "next";
import { GUIDES } from "@/lib/guide-content";
import { APP_URL, LEGAL } from "@/lib/legal";
import { Code, DocHeader, DocNav, DocSection, inlineCode } from "./doc-ui";

/**
 * התיעוד הציבורי של המערכת — **מה שאפשר לקרוא בלי להתחבר.**
 *
 * ## למה עמוד ציבורי ולא רק ההדרכות שבמערכת
 *
 * ההדרכות ב-`/guides` מצוינות למי שכבר בפנים. שלושה קהלים אינם:
 * מי ששוקל להצטרף ורוצה לדעת מה המערכת עושה לפני שהוא נותן פרטים,
 * מי שמחבר מערכת אחרת ולא בהכרח יש לו חשבון, ומודל שפה שמתבקש
 * "תסביר לי איך עובדת מערכת מתווכים" — וקורא את מה שגלוי.
 *
 * שער התחברות על התיעוד הופך את שלושתם לפניות לתמיכה.
 *
 * ## למה אותו תוכן ולא כתיבה נפרדת
 *
 * התוכן מגיע מ-`@/lib/guide-content`, אותו מקור שההדרכות במערכת
 * קוראות. מסמך ציבורי שנכתב בנפרד מתיישן ביום שמישהו מתקן את
 * ההדרכה הפנימית בלבד — והפער הזה נראה כלפי חוץ דווקא.
 */

export const metadata: Metadata = {
  title: "תיעוד המערכת — מתווכים",
  description:
    "מה מערכת מתווכים עושה וכיצד: נכסים, קונים, לידים, התאמות, יומן, שיחות, שיתופי פעולה בין משרדים, הסכמים וניהול משרד.",
  alternates: { canonical: `${APP_URL}/docs` },
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

/** סעיפים שאינם הדרכה — הם מסגרת, ולכן נכתבים כאן ולא בתוכן. */
const INTRO_ID = "about";
const INTEGRATIONS_ID = "integrations";
const PRIVACY_ID = "privacy";

export default function DocsPage() {
  const navItems = [
    { id: INTRO_ID, title: "מה זו המערכת" },
    ...GUIDES.map((guide) => ({ id: guide.id, title: guide.title })),
    { id: INTEGRATIONS_ID, title: "חיבורים ואוטומציה" },
    { id: PRIVACY_ID, title: "נתונים ופרטיות" },
  ];

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <DocHeader
        current="product"
        title="תיעוד המערכת"
        lead="כל מה שהמערכת יודעת לעשות, לפי נושא. אותו תוכן שמוצג בהדרכות שבתוך המערכת — כאן פתוח לקריאה בלי חשבון."
      />

      <DocNav items={navItems} label="נושאי התיעוד" />

      <DocSection id={INTRO_ID} title="מה זו המערכת">
        <p className="mb-2">
          <b>מתווכים</b> היא מערכת ניהול למשרדי תיווך בישראל: הנכסים, הקונים
          והשוכרים, הלידים מכל הערוצים, ההתאמות ביניהם, היומן, השיחות, ההסכמים —
          ורשת שמאפשרת למשרדים לשתף פעולה זה עם זה.
        </p>
        <p className="mb-2" style={{ color: "var(--color-text-muted)" }}>
          המערכת פועלת בענן בכתובת אחת. אין התקנה בשרת של המשרד ואין דומיין נפרד
          לכל לקוח — כל משרד מקבל סביבה מבודדת בתוך אותה מערכת, והבידוד נאכף
          במסד הנתונים עצמו ולא רק בקוד.
        </p>
        <Code>{`${APP_URL}`}</Code>
        <p style={{ color: "var(--color-text-muted)" }}>
          המפעילה: {LEGAL.operator}, ח.פ. {LEGAL.companyId}. שאלות בענייני פרטיות
          ומימוש זכות עיון —{" "}
          <code style={inlineCode} dir="ltr">
            {LEGAL.privacyEmail}
          </code>
          .
        </p>
      </DocSection>

      {/*
        גוף התיעוד — נושא לכל הדרכה, סעיף לכל שלב.
        ‎`<ol>`‎ ולא ‎`<ul>`‎: השלבים בכל נושא הם סדר פעולה, וזה מה
        שקורא מסך אמור להכריז.
      */}
      {GUIDES.map((guide) => (
        <DocSection key={guide.id} id={guide.id} title={guide.title}>
          <p className="mb-3">{guide.intro}</p>
          <ol className="m-0 mb-0 flex list-decimal flex-col gap-3 ps-5">
            {guide.steps.map((step) => (
              <li key={step.title}>
                <b>{step.title}.</b> {step.body}
              </li>
            ))}
          </ol>
          {guide.tip ? (
            <p
              className="mt-3 mb-0 rounded-lg border p-3 text-sm"
              style={{
                borderColor: "var(--color-border)",
                background: "var(--color-hover-soft)",
              }}
            >
              <b>שימו לב:</b> {guide.tip}
            </p>
          ) : null}
        </DocSection>
      ))}

      <DocSection id={INTEGRATIONS_ID} title="חיבורים ואוטומציה">
        <p className="mb-2">
          המערכת קולטת לידים מכל מקור דרך נתיב אחד, עם מפתח נפרד לכל ערוץ — כך
          שרשימת הלידים מראה מאיזה ערוץ הגיע כל לקוח. הצורה המלאה, השדות,
          דוגמאות ל-Make ול-n8n ומפרט OpenAPI לקריאת מכונה נמצאים במסמך נפרד:
        </p>
        <p className="mb-3">
          <a href="/docs/api" className="mv-chip no-underline">
            תיעוד קליטת לידים (API)
          </a>
        </p>
        <p className="mb-2">
          <b>מרכזיות טלפון.</b> חיבור מרכזייה אינו עובר דרך נתיב הלידים — הוא
          מוגדר בניהול המשרד ומקבל כתובת משלו. המערכת מזהה את שמות השדות של
          המרכזיות המקובלות (015, Asterisk וכל מרכזייה ששולחת Webhook) בלי הגדרה
          נוספת, ומציגה שדות שהגיעו ואינם מוכרים לה כדי שלא ייבלעו בשקט.
        </p>
        <p style={{ color: "var(--color-text-muted)" }}>
          חיבורים נוספים שמוגדרים מתוך המערכת: יומן Google (דו-כיווני), תיבת
          Gmail שממנה נפתחים לידים, וואטסאפ, וסליקה לחיוב המנוי.
        </p>
      </DocSection>

      <DocSection id={PRIVACY_ID} title="נתונים ופרטיות">
        <p className="mb-2">
          פרטי הלקוחות — שמות, טלפונים ואימיילים — נשמרים מוצפנים. הפרדת המשרדים
          נאכפת ברמת מסד הנתונים: שאילתה בלי הקשר משרד מחזירה אפס שורות, ולא
          נתונים של משרד אחר.
        </p>
        <p className="mb-2">
          <b>ברשת שבין המשרדים נחשף רק מה שאנונימי</b> — הכוונה, האזור, התקציב
          והתיאור. שם וטלפון של לקוח נחשפים למשרד אחר רק אחרי שההפניה נקלטה
          בפועל.
        </p>
        <p className="mb-2">
          בעל משרד יכול לייצא את כל נתוני המשרד, ולמחוק את החשבון מחיקה מלאה.
          אחרי מחיקה נשארות רק רשומות תשלום ללא פרטים אישיים, שחוק מחייב לשמור,
          ויומן פעולות של מזהים בלבד.
        </p>
        <p style={{ color: "var(--color-text-muted)" }}>
          הנוסח המחייב נמצא ב<a href="/privacy">מדיניות הפרטיות</a> וב
          <a href="/terms">תנאי השימוש</a>. הצהרת הנגישות זמינה ב
          <a href="/accessibility">עמוד הנגישות</a>.
        </p>
      </DocSection>

      <p className="mt-10 text-sm" style={{ color: "var(--color-text-muted)" }}>
        לא מצאתם תשובה? כתבו לנו ל־
        <code style={inlineCode} dir="ltr">
          {LEGAL.supportEmail}
        </code>{" "}
        ונחזור אליכם.
      </p>
    </main>
  );
}
