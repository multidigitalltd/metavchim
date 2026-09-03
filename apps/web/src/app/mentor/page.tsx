"use client";

import { useRequireAuth } from "@/lib/use-auth";
import { IconSparkle } from "../icons";

/**
 * המנטור האישי — עמוד "בקרוב" עד ההשקה.
 *
 * הלשונית קיימת בתפריט כבר עכשיו (בקשת המשתמש), באותו דפוס של
 * „קונים - Kanko”: מתווך שרואה אותה יודע מה מגיע, וביום ההשקה הוא
 * כבר יודע לאן להיכנס.
 *
 * הניסוח מדבר על **ליווי** ולא על עוד דוח. כל שאר המערכת מודדת
 * ביצועים ומציגה מספרים; מה שאין בה הוא מישהו שאומר „כל הכבוד”
 * אחרי עסקה, ומזכיר את היעד כשהשבוע היה חלש. זה מה שהעמוד מבטיח,
 * וזה מה שההשקה צריכה לקיים.
 *
 * ## ‏המסך עצמו כבר בנוי, והוא **לא** נמחק
 *
 * ‏המנטור המלא — היעדים, הגרף השבועי, פידבק המנהל וסליידר המשפטים —
 * ‏יושב ב-`mentor-screen.tsx` וממשיך להיבדק בכל שער ובכל טיפוס.
 * ‏מה שהוסר הוא **הנתיב**: הפיתוח נמשך, והמסך ייחשף כשיהיה מוכן
 * ‏(בקשת המשתמש). החזרה היא שורה אחת — לייבא את `MentorScreen`
 * ‏ולהחזיר אותה מכאן.
 *
 * ‏למה כקובץ נפרד ולא כדגל: דגל משאיר שני מסלולים חיים באותו קובץ,
 * ‏ומי שקורא אותו צריך להכריע איזה מהם רץ. קובץ נפרד אומר את זה
 * ‏בשמו.
 */
export default function MentorComingSoonPage() {
  const { loading } = useRequireAuth();
  if (loading) return null;

  return (
    // div ולא main — העטיפה של AppShell היא ה-main landmark היחיד
    <div className="mv-page">
      <section
        className="mx-auto mt-10 max-w-xl rounded-2xl border p-8 text-center"
        style={{
          borderColor: "var(--color-primary-accent)",
          background:
            "linear-gradient(180deg, var(--color-primary-soft), var(--color-surface) 78%)",
          boxShadow:
            "0 10px 28px color-mix(in srgb, var(--color-primary) 10%, transparent)",
        }}
        aria-labelledby="mentor-heading"
      >
        <h1 id="mentor-heading" className="m-0 text-2xl font-extrabold">
          המנטור האישי שלך
          <span
            className="mx-2 inline-block rounded-full px-2.5 py-0.5 align-middle text-[length:var(--type-body-sm)] font-extrabold"
            style={{
              background: "var(--color-primary-soft)",
              color: "var(--color-primary)",
            }}
          >
            AI
          </span>
        </h1>

        <p className="m-0 mt-4 text-[length:var(--type-screen-title)] font-bold leading-relaxed">
          בקרוב — מנטור אישי שילווה אתכם לאורך הדרך: יעקוב אחרי הביצועים
          שלכם, יעזור לקבוע יעדים ולהגיע אליהם, ייתן מוטיבציה כשקשה,
          יאמין בכם גם כשאתם לא — ויחגוג איתכם כל הצלחה.
        </p>

        <p
          className="m-0 mt-4 text-[length:var(--type-button)] leading-relaxed"
          style={{ color: "var(--color-text-muted)" }}
        >
          לא עוד דוח עם מספרים. מישהו שמכיר את השבוע שלכם, יודע מה
          הבטחתם לעצמכם, ודוחף אתכם לשם.
        </p>

        <p
          className="mx-auto mt-5 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[length:var(--type-body-sm)] font-bold"
          style={{
            background: "var(--color-primary-soft)",
            color: "var(--color-primary)",
          }}
        >
          <IconSparkle s={16} /> ההשקה בקרוב
        </p>
      </section>
    </div>
  );
}
