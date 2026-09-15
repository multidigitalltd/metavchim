import type { Metadata } from "next";
import {
  docsMarkdown,
  DOC_TOPICS,
  GUIDES,
  GUIDE_AREAS,
  type DocTopic,
} from "@/lib/guide-content";
import { APP_URL, LEGAL } from "@/lib/legal";
import { CopyMarkdown } from "../copy-markdown";
import { DocHeader, DocPassages, DocSection, inlineCode } from "./doc-ui";
import { DocsBrowser, type DocsBrowserItem } from "./docs-browser";
import { SupportCard } from "./support-card";

/**
 * התיעוד הציבורי של המערכת — **הבית של ההדרכות, ולא עותק שלהן.**
 *
 * ## למה זה המקום היחיד
 *
 * ההדרכות ישבו במערכת, מאחורי התחברות, והתיעוד הציבורי היה עותק
 * שני של אותו תוכן. שני עותקים של אותו הסבר נפרדים ביום שמישהו
 * מתקן אחד מהם — וזה בדיוק מה שקרה כאן פעם עם תוויות המקורות
 * ועם מונחי ההפניות.
 *
 * עכשיו יש בית אחד, והוא הציבורי. שלושה קהלים אינם מחוברים
 * ולעולם לא יהיו: מי ששוקל להצטרף ורוצה לדעת מה המערכת עושה לפני
 * שהוא נותן פרטים, מי שמחבר מערכת אחרת ואין לו חשבון, ומודל שפה
 * שנשאל „איך עובדת מערכת מתווכים” וקורא את מה שגלוי. שער התחברות
 * על התיעוד הופך את שלושתם לפניות לתמיכה.
 *
 * הלשונית „הדרכות” שבמערכת מפנה לכאן, ו-`/guides` מפנה לכאן —
 * כלומר קישור ישן ממשיך לעבוד ואין מסך שני לתחזק.
 *
 * ## למה אינדקס ולא מגילה
 *
 * העמוד הזה היה כל התיעוד ברצף, עם עוגן לכל נושא. הנימוק היה
 * „מסמך אחד שאפשר לתת למודל”, והוא נכון — ולכן הוא נשאר, בדיוק
 * במקום שבו הוא שימושי: `/docs/md`. לקורא אנושי מגילה של עשרים
 * ואחד נושאים היא גלילה, ולמנוע חיפוש היא עמוד אחד שמתחרה בעצמו
 * על עשרים ואחת שאילתות שונות. גוף כל נושא עבר ל-`/docs/<נושא>`.
 */

export const metadata: Metadata = {
  title: "תיעוד המערכת — מתווכים",
  description:
    "מה מערכת מתווכים עושה וכיצד: נכסים, קונים, לידים, התאמות, יומן, שיחות, וואטסאפ, שיתופי פעולה בין משרדים, הסכמים וניהול משרד.",
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
 * לא הכיל אותם. עכשיו העמוד וקובץ ה-Markdown נגזרים שניהם מאותה
 * רשימה, והסדר כאן הוא הסדר שם.
 */
function topic(id: string): DocTopic {
  const found = DOC_TOPICS.find((item) => item.id === id);
  if (found === undefined) throw new Error(`סעיף תיעוד חסר: ${id}`);
  return found;
}

/**
 * מפתח החיפוש נבנה **בשרת**, פעם אחת בבנייה.
 *
 * הוא כולל את כותרות הצעדים, הסעיפים והשאלות, כי המילה שמחפשים
 * כמעט תמיד יושבת שם ולא בכותרת הנושא. בנייה בלקוח הייתה מעבירה
 * את אותה עבודה לכל מכשיר, בכל טעינה.
 */
const ITEMS: DocsBrowserItem[] = GUIDES.map((guide) => ({
  id: guide.id,
  title: guide.title,
  summary: guide.summary,
  area: guide.area,
  steps: guide.steps.length,
  hasFaq: (guide.faq ?? []).length > 0,
  haystack: [
    guide.title,
    guide.summary,
    guide.intro,
    ...guide.steps.map((step) => step.title),
    ...(guide.sections ?? []).map((section) => section.title),
    ...(guide.faq ?? []).map((item) => item.q),
  ]
    .join(" ")
    .toLowerCase(),
}));

export default function DocsPage() {
  const about = topic("about");
  const integrations = topic("integrations");
  const glossary = topic("glossary");
  const privacy = topic("privacy");

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
        lead="כל מה שהמערכת יודעת לעשות, לפי נושא — פתוח לקריאה בלי חשבון. זה גם המקום שאליו מפנה „הדרכות” מתוך המערכת."
      />

      <DocSection id={about.id} title={about.title}>
        <DocPassages passages={about.passages} />
        <p style={{ color: "var(--color-text-muted)" }}>
          המפעילה: {LEGAL.operator}, ח.פ. {LEGAL.companyId}. שאלות בענייני פרטיות
          ומימוש זכות עיון —{" "}
          <code style={inlineCode} dir="ltr" lang="en">
            {LEGAL.privacyEmail}
          </code>
          .
        </p>
      </DocSection>

      <DocsBrowser areas={GUIDE_AREAS} items={ITEMS} />

      {/*
        התיעוד כולו כטקסט — למי שמעדיף לתת למודל את כל התמונה
        ולא נושא אחד. הכפתור הזהה שבסוף כל נושא מכסה את המקרה
        ההפוך, ושניהם מגישים בדיוק את מה שכתוב בעמודים.
      */}
      <div className="mt-10">
        <CopyMarkdown
          markdown={docsMarkdown()}
          href="/docs/md"
          subject="תיעוד המערכת המלא"
        />
      </div>

      <div className="mt-10">
        <DocSection id={integrations.id} title={integrations.title}>
          <DocPassages passages={integrations.passages} />
        </DocSection>

        {/*
          המילון אחרי ההדרכות ולא לפניהן: מי שקורא נושא פוגש את
          המונח בהקשר, ומי שנתקל במילה זרה קופץ לכאן. מילון בראש
          המסמך הוא הדף שכולם מדלגים עליו.
        */}
        <DocSection id={glossary.id} title={glossary.title}>
          <DocPassages passages={glossary.passages} />
        </DocSection>

        <DocSection id={privacy.id} title={privacy.title}>
          <DocPassages passages={privacy.passages} />
          <p style={{ color: "var(--color-text-muted)" }}>
            הנוסח המחייב נמצא ב<a href="/privacy">מדיניות הפרטיות</a> וב
            <a href="/terms">תנאי השימוש</a>. הצהרת הנגישות זמינה ב
            <a href="/accessibility">עמוד הנגישות</a>.
          </p>
        </DocSection>
      </div>

      {/*
        כרטיס התמיכה במקום שורת „לא מצאתם תשובה” שהייתה כאן:
        אותו מסר, עם כפתור שפותח מייל מנוסח — ואותה כתובת שמופיעה
        בסוף כל נושא, ולא שתי כתובות שונות באותו מסמך.
      */}
      <div className="mt-10">
        <SupportCard />
      </div>
    </div>
  );
}
