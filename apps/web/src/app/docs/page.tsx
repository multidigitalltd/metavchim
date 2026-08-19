import type { Metadata } from "next";
import {
  docsMarkdown,
  DOC_TOPICS,
  guideMarkdown,
  GUIDES,
  type DocTopic,
} from "@/lib/guide-content";
import { APP_URL, LEGAL } from "@/lib/legal";
import { CopyMarkdown } from "../copy-markdown";
import {
  Code,
  DocHeader,
  DocNav,
  DocPassages,
  DocSection,
  inlineCode,
} from "./doc-ui";

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

/**
 * סעיפי המסגרת — לפי מזהה, מתוך מקור התוכן המשותף.
 *
 * הם היו כתובים כאן כ-JSX, ולכן „התיעוד המלא” שהעמוד הציע להעתיק
 * לא הכיל אותם. עכשיו העמוד וקובץ ה-Markdown נגזרים משניהם מאותה
 * רשימה, והסדר כאן הוא הסדר שם.
 */
function topic(id: string): DocTopic {
  const found = DOC_TOPICS.find((item) => item.id === id);
  if (found === undefined) throw new Error(`סעיף תיעוד חסר: ${id}`);
  return found;
}

export default function DocsPage() {
  const about = topic("about");
  const integrations = topic("integrations");
  const privacy = topic("privacy");
  const navItems = [
    { id: about.id, title: about.title },
    ...GUIDES.map((guide) => ({ id: guide.id, title: guide.title })),
    { id: integrations.id, title: integrations.title },
    { id: privacy.id, title: privacy.title },
  ];

  return (
    /*
     * `div` ולא `main`. המעטפת הכללית כבר עוטפת כל מסך ציבורי
     * ב-`<main id="main-content">`, ושני main מקוננים הם שני
     * ציוני דרך ראשיים באותו עמוד — כלומר קישור דילוג שמוביל
     * למקום לא ברור וקורא מסך שמדווח על מבנה שגוי.
     */
    <div className="mx-auto max-w-3xl px-4 py-10">
      <DocHeader
        current="product"
        title="תיעוד המערכת"
        lead="כל מה שהמערכת יודעת לעשות, לפי נושא. אותו תוכן שמוצג בהדרכות שבתוך המערכת — כאן פתוח לקריאה בלי חשבון."
      />

      <DocNav items={navItems} label="נושאי התיעוד" />

      {/*
        התיעוד כולו כטקסט — למי שמעדיף לתת למודל את כל התמונה
        ולא נושא אחד. הכפתור הזהה שבסוף כל נושא מכסה את המקרה
        ההפוך, ושניהם מגישים בדיוק את מה שכתוב בעמוד.
      */}
      <CopyMarkdown
        markdown={docsMarkdown()}
        href="/docs/md"
        subject="תיעוד המערכת המלא"
      />

      <DocSection id={about.id} title={about.title}>
        <DocPassages passages={about.passages} />
        <Code>{`${APP_URL}`}</Code>
        <p style={{ color: "var(--color-text-muted)" }}>
          המפעילה: {LEGAL.operator}, ח.פ. {LEGAL.companyId}. שאלות בענייני פרטיות
          ומימוש זכות עיון —{" "}
          <code style={inlineCode} dir="ltr" lang="en">
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
          <CopyMarkdown
            markdown={guideMarkdown(guide)}
            href={`/docs/md/${guide.id}`}
            subject={guide.title}
          />
        </DocSection>
      ))}

      <DocSection id={integrations.id} title={integrations.title}>
        <DocPassages passages={integrations.passages} />
      </DocSection>

      <DocSection id={privacy.id} title={privacy.title}>
        <DocPassages passages={privacy.passages} />
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
    </div>
  );
}
