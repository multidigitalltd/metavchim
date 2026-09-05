import type { Metadata } from "next";
import { APP_URL } from "@/lib/legal";
import { DocHeader, DocSection } from "../doc-ui";

/**
 * חיבור וואטסאפ עסקי — **המדריך המלא, בתיעוד הציבורי.**
 *
 * ## למה עמוד ולא רק סעיף בהדרכת הוואטסאפ
 *
 * ההדרכה שבמערכת עונה על „מה עושים עם הוואטסאפ אחרי שהוא מחובר”.
 * החיבור עצמו הוא תהליך מול Meta — תיק עסקי, אימות, אפליקציה, טוקן,
 * Webhook — שנעשה פעם אחת בידי מי שמפעיל את הפלטפורמה, ולעיתים בידי
 * איש טכני של המשרד. הוא יושב כאן, פתוח, מאותה סיבה שתיעוד ה-API
 * פתוח: מי שמבצע אותו לא בהכרח מחובר למערכת, והוא רוצה לשלוח את
 * הקישור למי שעוזר לו.
 *
 * ## מקור אחד
 *
 * זה המקור לצעדים. `docs/whatsapp-setup.md` במאגר מחזיק את מה
 * שאינו צעד: מצב המימוש, רשימת הערכים, וההחלטות הפתוחות.
 */

export const metadata: Metadata = {
  title: "חיבור וואטסאפ עסקי — מתווכים",
  description:
    "מדריך שלב-אחרי-שלב לחיבור WhatsApp Business Cloud API של Meta למערכת מתווכים: תיק עסקי, אימות, אפליקציה, טוקן קבוע, Webhook, תבניות מאושרות ובדיקה.",
  alternates: { canonical: `${APP_URL}/docs/whatsapp` },
  robots: { index: true, follow: true },
};

function P({ lead, children }: { lead?: string; children: React.ReactNode }) {
  return (
    <p className="mb-2">
      {lead === undefined ? null : <b>{lead} </b>}
      {children}
    </p>
  );
}

/** צעדים ממוספרים — סדר פעולה, ולכן `ol`. */
function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="mb-3 flex list-decimal flex-col gap-1.5 ps-5">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ol>
  );
}

/** אזהרה — מה שנשרף אם עושים אותו לא נכון. */
function Warn({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="mb-3 rounded-lg border p-3"
      style={{ borderColor: "var(--color-warning)", background: "var(--color-warning-bg)" }}
    >
      {children}
    </p>
  );
}

const inline = {
  background: "var(--color-hover-soft)",
  padding: "2px 6px",
  borderRadius: 4,
  fontSize: "1em",
} as const;

function C({ children }: { children: string }) {
  return (
    <code style={inline} dir="ltr" lang="en">
      {children}
    </code>
  );
}

export default function WhatsAppDocsPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <DocHeader
        title="חיבור וואטסאפ עסקי"
        lead="איך מחברים את WhatsApp Business Cloud API של Meta למערכת — צעד אחרי צעד, מהתיק העסקי ועד ההודעה הראשונה שנכנסת כליד."
        current="whatsapp"
      />

      <DocSection id="overview" title="מה מקבלים בסוף">
        <P>
          חיבור אחד, ארבעה דברים שמתחילים לעבוד: כל הודעה שלקוח שולח למספר העסקי
          של המשרד הופכת <b>לליד</b> או מצטרפת לכרטיס קיים; <b>הסוכן האישי</b>{" "}
          עונה בוואטסאפ למשתמשי המערכת; <b>התראות</b> על שיחה שלא נענתה, תשובת
          לקוח במייל ותזכורת לפני סיור יוצאות בוואטסאפ; ו<b>הצעות ללקוחות</b>{" "}
          נפתחות מוכנות בוואטסאפ של הסוכן — הוא קורא ולוחץ שלח.
        </P>
        <P lead="מי עושה מה.">
          שלבים 1–10 ו-13–14 נעשים פעם אחת בידי מי שמפעיל את הפלטפורמה, במסך{" "}
          <C>/platform</C>. שלב 11 נעשה בכל משרד בנפרד, בניהול המשרד. שלב 12 הוא
          הבדיקה של שניהם.
        </P>
        <P lead="לפני שמתחילים, ביד:">
          חשבון פייסבוק אישי של מי שינהל את האפליקציה · מספר טלפון{" "}
          <b>שאינו רשום היום בוואטסאפ</b> (רגיל או Business) · מסמכי החברה לאימות
          (תעודת התאגדות או אישור עוסק מורשה, ומסמך עם כתובת העסק) · גישה למסך{" "}
          <C>/platform</C>.
        </P>
        <Warn>
          מספר שכבר רשום בוואטסאפ רגיל אינו ניתן לרישום ב-API עד שמוחקים שם את
          החשבון (הגדרות ← חשבון ← מחיקת החשבון שלי) — והמחיקה מוחקת גם את
          ההיסטוריה. אם המספר בשימוש יומיומי, עדיף מספר חדש.
        </Warn>
      </DocSection>

      <DocSection id="step-1-2" title="שלבים 1–2 · תיק עסקי ואימות — מתחילים עכשיו">
        <Steps
          items={[
            <>
              נכנסים ל-<C>business.facebook.com</C>. אם אין תיק עסקי — <b>Create a
              business portfolio</b>: שם העסק, שם מלא, אימייל עסקי.
            </>,
            <>
              <b>Settings</b> (גלגל השיניים) ← <b>Business verification</b> ←{" "}
              <b>Start verification</b> ← מעלים את מסמכי החברה.
            </>,
          ]}
        />
        <P>
          האימות הוא השלב שלוקח הכי הרבה זמן — כמה ימי עסקים — ולכן הוא ראשון: הוא
          רץ ברקע בזמן שממשיכים. הכתובת במסמכים חייבת להתאים לכתובת שבתנאי השימוש
          ובמדיניות הפרטיות באתר; Meta משווה.
        </P>
      </DocSection>

      <DocSection id="step-3-4" title="שלבים 3–4 · האפליקציה ומוצר WhatsApp">
        <Steps
          items={[
            <>
              <C>developers.facebook.com</C> ← <b>My Apps</b> ← <b>Create App</b>.
            </>,
            <>
              <b>App name</b> — שם פנימי, הלקוחות לא רואים אותו (למשל{" "}
              <C>metavchim-api</C>). <b>App contact email</b> — האימייל שלכם.
            </>,
            <>
              <b>Business portfolio</b> — לבחור את התיק משלב 1. חובה: בלי שיוך
              לתיק אי אפשר להנפיק טוקן קבוע בשלב 7, ואת זה אי אפשר לתקן בלי ליצור
              אפליקציה מחדש.
            </>,
            <>
              <b>Use case</b> ← <b>Other</b> ← סוג <b>Business</b> ← <b>Create app</b>.
            </>,
            <>
              בלוח הבקרה, ברשימת המוצרים: <b>WhatsApp</b> ← <b>Set up</b>. Meta יוצרת
              חשבון וואטסאפ עסקי (WABA) ומספר בדיקה חינמי — לבדיקות בלבד.
            </>,
          ]}
        />
      </DocSection>

      <DocSection id="step-5-6" title="שלבים 5–6 · הערכים והמספר האמיתי">
        <P>
          <b>WhatsApp</b> ← <b>API Setup</b>. כאן יושבים שלושת הערכים: <b>Temporary
          access token</b> (תקף 24 שעות, לבדיקה בלבד), <b>Phone number ID</b> ו-
          <b>WhatsApp Business Account ID</b>.
        </P>
        <P lead="בדיקה מהירה:">
          תחת „To” ← <b>Manage phone number list</b> ← מוסיפים את הנייד הפרטי,
          מאשרים בקוד ← <b>Send message</b>. הודעה הגיעה? החיבור חי.
        </P>
        <P lead="המספר האמיתי:">
          באותו מסך <b>Add phone number</b>. <b>Display name</b> הוא השם שהלקוחות
          יראו — הוא עובר אישור של Meta וחייב להיות קשור לשם העסק; שם שרירותי נדחה
          ומעכב הכול. קטגוריה, תיאור קצר, ואימות המספר ב-SMS או בשיחה.
        </P>
      </DocSection>

      <DocSection id="step-7-8" title="שלבים 7–8 · טוקן קבוע ו-App Secret">
        <Warn>
          הטוקן משלב 5 מת אחרי 24 שעות. בלי טוקן קבוע החיבור ייפול למחרת.
        </Warn>
        <Steps
          items={[
            <>
              <C>business.facebook.com</C> ← <b>Settings</b> ← <b>Users</b> ←{" "}
              <b>System users</b> ← <b>Add</b>: שם <C>metavchim-api</C>, תפקיד{" "}
              <b>Admin</b>.
            </>,
            <>
              <b>Add assets</b> ← <b>Apps</b> ← האפליקציה ← <b>Full control</b>; ושוב{" "}
              <b>Add assets</b> ← <b>WhatsApp accounts</b> ← ה-WABA ← <b>Full control</b>.
            </>,
            <>
              <b>Generate new token</b>: האפליקציה, ההרשאות{" "}
              <C>whatsapp_business_messaging</C> ו-<C>whatsapp_business_management</C>,{" "}
              <b>Token expiration: Never</b>. מעתיקים ושומרים במקום בטוח — הוא מוצג
              פעם אחת בלבד.
            </>,
            <>
              <b>App Secret</b>: בלוח הבקרה של האפליקציה, <b>App settings</b> ←{" "}
              <b>Basic</b> ← <b>App secret</b> ← <b>Show</b> ← להעתיק. הוא מה שמאפשר
              למערכת לוודא שהודעה נכנסת הגיעה באמת מ-Meta.
            </>,
          ]}
        />
      </DocSection>

      <DocSection id="step-9-10" title="שלבים 9–10 · Webhook — קודם אצלנו, אחר כך ב-Meta">
        <P lead="במערכת:">
          <C>/platform</C> ← כרטיס „וואטסאפ (Meta Cloud API)” ← מדביקים את{" "}
          <b>App Secret</b>, ממציאים <b>Verify Token</b> (מחרוזת אקראית, 16 תווים
          לפחות, שומרים עותק) ← <b>שמירה</b> ← מעתיקים את <b>כתובת ה-Webhook</b>{" "}
          שמוצגת בכרטיס.
        </P>
        <P lead="ב-Meta:">
          <b>WhatsApp</b> ← <b>Configuration</b> ← <b>Webhook</b> ← <b>Edit</b>:{" "}
          <b>Callback URL</b> — הכתובת שהועתקה; <b>Verify token</b> — בדיוק אותה
          מחרוזת ← <b>Verify and save</b>. ואז ליד <i>Webhook fields</i>:{" "}
          <b>Manage</b> ← ✓ על <C>messages</C>. בלי הסימון הזה ה-Webhook מאומת אבל
          לא מגיעה אליו אף הודעה.
        </P>
        <P lead="אם האימות נכשל:">
          „couldn&apos;t be validated” — המחרוזות אינן זהות תו-בתו, או שלא נשמרו אצלנו
          קודם. „הכתובת לא נגישה” — חייבת להיות כתובת הייצור הציבורית ב-HTTPS;{" "}
          <C>localhost</C> לא יעבוד. רווח נגרר — הדבקה גוררת לפעמים רווח או שורה
          חדשה; בודקים בשני הצדדים.
        </P>
      </DocSection>

      <DocSection id="step-11" title="שלב 11 · המספר של כל משרד">
        <P>
          כל משרד, בניהול משרד ← „חיבורים ומודולים” ← „וואטסאפ”, מזין את המספר
          העסקי שלו — ספרות בלבד, בלי <C>+</C>, בלי 0 מוביל ובלי מקפים:{" "}
          <C>972501234567</C>. לפי המספר הזה המערכת מנתבת כל הודעה נכנסת למשרד
          הנכון. מספר שגוי = ההודעות נופלות בשקט. המספר עצמו חייב להיות רשום
          ב-WABA (שלב 6).
        </P>
      </DocSection>

      <DocSection id="step-12" title="שלב 12 · הבדיקה האמיתית">
        <Steps
          items={[
            <>שולחים וואטסאפ מהנייד הפרטי אל המספר העסקי.</>,
            <>תוך שניות נוצר ליד חדש במשרד המתאים.</>,
            <>
              בניהול המשרד ← „וואטסאפ” שלושת הסימנים הופכים ל-✓: חיבור השרת ל-Meta,
              המספר העסקי של המשרד, ומועד ההודעה הנכנסת האחרונה.
            </>,
          ]}
        />
      </DocSection>

      <DocSection id="step-13" title="שלב 13 · שליחה מהשרת — הטוקן ומזהה המספר">
        <P>
          הקליטה עובדת כבר משלב 12. כדי שהמערכת גם <b>תשלח</b> — הסוכן האישי,
          ההתראות והתזכורות — מזינים ב-<C>/platform</C> באותו כרטיס את{" "}
          <b>Access Token</b> (הטוקן הקבוע משלב 7) ואת <b>Phone Number ID</b> (שלב
          5, ספרות בלבד), ולוחצים <b>„בדוק חיבור”</b>: המערכת פונה ל-Meta על המספר
          ומדווחת אם הוא עונה.
        </P>
        <P lead="„מענה למספר לא רשום”.">
          נוסח שנשלח למי שכותב לסוכן ואינו משתמש במערכת — הזדמנות מכירה, לא הודעת
          שגיאה. ריק = הנוסח המובנה עם קישור ההרשמה. נשלח לכל היותר פעם בשבוע לכל
          מספר.
        </P>
      </DocSection>

      <DocSection id="step-14" title="שלב 14 · תבניות מאושרות וכלל 24 השעות">
        <P>
          Meta מתירה לעסק לפתוח שיחה עם לקוח רק בנוסח שאושר מראש (Template).
          בתוך 24 שעות מההודעה האחרונה של הלקוח — כל הודעה חופשית. לכן ארבעה
          זרמים במערכת נשענים על תבנית, וכל אחת מוגדרת ב-<C>/platform</C> בשם
          התבנית ובקוד השפה שלה אצל Meta (ברירת מחדל <C>he</C>):
        </P>
        <ul className="mb-3 flex list-disc flex-col gap-1 ps-5">
          <li>
            <b>התראה לסוכן</b> — שיחה שלא נענתה וכדומה. שני פרמטרים: כותרת ופירוט.
          </li>
          <li>
            <b>טופס ללקוח אחרי שיחה שלא נענתה</b> — פרמטר אחד: הקישור לטופס „מה
            אתם מחפשים”.
          </li>
          <li>
            <b>תזכורת לפני סיור</b> — פרמטר אחד: הודעת התזכורת.
          </li>
          <li>
            <b>תשובת לקוח במייל</b> — התראה לסוכן, פרמטר אחד: שם הלקוח.
          </li>
        </ul>
        <P lead="ריק הוא מצב תקין.">
          בלי תבנית המערכת אינה שולחת דבר שייפסל — לכל זרם יש נתיב חלופי: משימה עם
          ההודעה מוכנה, מייל, או התראה במערכת. שמות התבניות נבדקים בשמירה מול מה
          ש-Meta מתירה (אותיות קטנות, ספרות וקו תחתון).
        </P>
        <P lead="חיוב.">
          מאז יולי 2025 החיוב הוא לכל הודעה: <C>marketing</C> תמיד בתשלום;{" "}
          <C>utility</C> ו-<C>authentication</C> חינם בתוך החלון; <C>service</C>{" "}
          חינם. „יש נכס חדש שמתאים לך” היא תבנית שיווקית; „ההצעה שלך נשלחה” בתוך
          שיחה פעילה — חינם.
        </P>
      </DocSection>

      <DocSection id="go-live" title="לצאת לאוויר — ממצב Development ל-Live">
        <P>
          במצב Development הודעות נכנסות עובדות במלואן, אבל שליחה אפשרית רק
          למספרים שהוספתם ידנית לרשימת הבדיקה בשלב 5. כדי לשלוח לכל לקוח:
        </P>
        <Steps
          items={[
            <>אימות העסק משלב 2 — הושלם.</>,
            <>
              <b>App Review</b> על שתי ההרשאות משלב 7.
            </>,
            <>
              העברת האפליקציה למצב <b>Live</b>.
            </>,
          ]}
        />
      </DocSection>

      <DocSection id="checklist" title="רשימת בדיקה — הערכים ואיפה הם נשמרים">
        <ul className="mb-3 flex list-disc flex-col gap-1 ps-5">
          <li>
            App Secret, Verify Token, Access Token, Phone Number ID — <C>/platform</C>{" "}
            ← „וואטסאפ (Meta Cloud API)”.
          </li>
          <li>Verify Token — גם ב-Meta, אותה מחרוזת.</li>
          <li>ארבע התבניות ושפתן, ומענה למספר לא רשום — באותו כרטיס.</li>
          <li>המספר העסקי של כל משרד — ניהול משרד ← „וואטסאפ”.</li>
          <li>WhatsApp Business Account ID — שומרים בצד; נדרש לחיבור מספרים בידי כל משרד (בתכנון).</li>
        </ul>
        <p className="mb-3">
          <a href="/docs#whatsapp" className="mv-chip no-underline">
            ההדרכה למשתמשים: מה עושים עם הוואטסאפ אחרי החיבור
          </a>
        </p>
      </DocSection>
    </main>
  );
}
