import type { Metadata } from "next";
import { fetchLegal, type LegalDetails } from "../../lib/legal";
import { LegalText } from "../legal-text";

export const metadata: Metadata = { title: "תנאי שימוש" };

/**
 * תנאי שימוש.
 *
 * הנוסח שכאן הוא ברירת המחדל. אם נשמר נוסח ב-/platform — הוא שמוצג
 * במקומו במלואו, כדי שנוסח שחזר מעורך/ת דין ייכנס לאוויר בהדבקה
 * ולא בגרסה חדשה של הקוד.
 */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 mt-6 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}


/** נוסח ברירת המחדל — מוצג כל עוד לא נשמר נוסח ב-/platform. */
function TermsDefaultBody({ legal }: { legal: LegalDetails }) {
  return (
    <>
      <p className="mb-4">
        תנאים אלה חלים על השימוש בשירות {legal.productName}, המופעל על ידי{" "}
        {legal.operator} (ח.פ. {legal.companyId}). שימוש בשירות מהווה הסכמה
        לתנאים.
      </p>

      <Section title="השירות">
        <p>
          {legal.productName} היא מערכת לניהול פעילות של משרד תיווך: ניהול
          נכסים וקונים, התאמה ביניהם, שליחת הצעות, תיעוד שיחות וניהול
          משימות ויומן. השירות ניתן כתוכנה כשירות (SaaS) ולפי המסלול שנבחר.
        </p>
      </Section>

      <Section title="החשבון והאחריות עליו">
        <ul className="list-inside list-disc space-y-1">
          <li>המשרד אחראי לנכונות פרטי החשבון ולשמירת סודיות הסיסמאות.</li>
          <li>
            החשבון אישי לכל משתמש/ת. שיתוף פרטי כניסה אסור — גם משום
            שהוא שובר את תיעוד הפעולות ואת מודל ההרשאות.
          </li>
          <li>
            המשרד אחראי לפעולות שנעשות בחשבונות המשתמשים שלו, ולהודיע לנו
            מיד על חשד לשימוש לא מורשה.
          </li>
        </ul>
      </Section>

      <Section title="שימוש מותר">
        <p className="mb-3">אין להשתמש בשירות כדי:</p>
        <ul className="list-inside list-disc space-y-1">
          <li>
            לשלוח דיוור פרסומי ללא הסכמה, בניגוד לסעיף 30א לחוק התקשורת
            (&quot;חוק הספאם&quot;).
          </li>
          <li>
            להזין או לעבד מידע אישי שאין למשרד בסיס חוקי להחזיק בו.
          </li>
          <li>לנסות לעקוף את מנגנוני ההרשאות, הבידוד או האבטחה של המערכת.</li>
          <li>
            להעמיס על המערכת באופן שפוגע בשירות למשרדים אחרים, או לגשת
            אליה בכלים אוטומטיים מעבר לממשקים שסופקו.
          </li>
        </ul>
      </Section>

      <Section title="תוכן המשרד והבעלות עליו">
        <p>
          כל המידע שהמשרד מזין למערכת — נכסים, לקוחות, הודעות, מסמכים —
          נשאר בבעלות המשרד. אנחנו לא רוכשים בו זכויות, ומשתמשים בו רק
          כדי לספק את השירות ולפי מדיניות הפרטיות. המשרד רשאי לייצא את
          הנתונים שלו בכל עת.
        </p>
      </Section>

      <Section title="הודעות וואטסאפ">
        <p>
          שליחת הודעות דרך השירות כפופה גם לתנאי השימוש של ספק הוואטסאפ
          (Meta). חסימה או הגבלה של מספר הוואטסאפ של המשרד עקב תלונות
          נמענים היא באחריות המשרד, ואיננו יכולים לבטלה.
        </p>
      </Section>

      <Section title="תשלום, חידוש וביטול">
        <ul className="list-inside list-disc space-y-1">
          <li>התשלום מתבצע לפי המסלול שנבחר ומראש לתקופת החיוב.</li>
          <li>
            המנוי מתחדש אוטומטית בסוף כל תקופה, אלא אם ניתנה הודעת ביטול
            לפני מועד החידוש.
          </li>
          <li>
            ביטול נכנס לתוקף בתום תקופת החיוב המשולמת; השירות זמין עד
            אותו מועד.
          </li>
          <li>
            שינוי מחירים יימסר מראש ולא יחול על תקופת חיוב ששולמה כבר.
          </li>
          <li>
            זכות הביטול לפי חוק הגנת הצרכן, התשמ&quot;א-1981, שמורה במקום
            שבו הוא חל.
          </li>
        </ul>
      </Section>

      <Section title="זמינות השירות">
        <p>
          אנו פועלים לזמינות גבוהה ומנטרים את השירות באופן שוטף, אך איננו
          מתחייבים לזמינות רציפה ללא הפסקה. תחזוקה מתוכננת תבוצע ככל
          הניתן בשעות שאינן שעות עבודה, ותימסר עליה הודעה מראש.
        </p>
      </Section>

      <Section title="הגבלת אחריות">
        <p className="mb-3">
          השירות הוא כלי עזר לניהול הפעילות. הוא אינו מהווה ייעוץ משפטי,
          שמאי או מקצועי, ואינו מחליף את שיקול הדעת של המתווך/ת ואת
          חובותיו/ה על פי חוק המתווכים במקרקעין, התשנ&quot;ו-1996.
        </p>
        <p>
          התאמות, ציוני בשלות והמלצות שהמערכת מציגה הן הצעות מבוססות
          נתונים — ההחלטה והאחריות עליה הן של המשתמש/ת. אחריותנו הכספית
          הכוללת לא תעלה על הסכום ששולם עבור השירות בשנים-עשר החודשים
          שקדמו לאירוע.
        </p>
      </Section>

      <Section title="הפסקת שירות">
        <p>
          אנו רשאים להשעות חשבון במקרה של הפרה מהותית של תנאים אלה או של
          אי-תשלום, לאחר התראה ושהות סבירה לתיקון — למעט במקרים שבהם
          נדרשת פעולה מיידית כדי להגן על המערכת או על משרדים אחרים.
        </p>
      </Section>

      <Section title="דין וסמכות שיפוט">
        <p>
          על תנאים אלה יחולו דיני מדינת ישראל. סמכות השיפוט הבלעדית נתונה
          לבתי המשפט המוסמכים במחוז תל אביב.
        </p>
      </Section>

      <Section title="יצירת קשר">
        <p>
          {legal.operator}
          {legal.address !== "" && `, ${legal.address}`}
          <br />
          דוא&quot;ל:{" "}
          <a href={`mailto:${legal.supportEmail}`} className="underline">
            {legal.supportEmail}
          </a>
        </p>
      </Section>

    </>
  );
}

export default async function TermsOfServicePage() {
  const { legal, overrides } = await fetchLegal();

  return (
    <article className="mx-auto max-w-2xl pb-12">
      <h1 className="mb-1 text-2xl font-bold">תנאי שימוש</h1>
      <p className="mb-6 text-sm text-[var(--color-text-muted)]">
        עודכן לאחרונה: {legal.updatedAt}
      </p>

      {overrides.termsText ? (
        <LegalText text={overrides.termsText} />
      ) : (
        <TermsDefaultBody legal={legal} />
      )}

      <p className="mt-8 text-sm text-[var(--color-text-muted)]">
        ראו גם:{" "}
        <a href="/privacy" className="underline">
          מדיניות פרטיות
        </a>{" "}
        ·{" "}
        <a href="/accessibility" className="underline">
          הצהרת נגישות
        </a>
      </p>
    </article>
  );
}
