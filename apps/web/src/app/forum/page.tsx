"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@metavchim/ui";
import { apiGet, apiPost } from "@/lib/api";
import { useRequireAuth } from "@/lib/use-auth";
import { IconSparkle, IconUsers } from "../icons";
import { Notice } from "../notice";

/**
 * הפורום המקצועי — עמוד "בקרוב" עד ההשקה.
 *
 * ## מה הפורום פותר
 *
 * מתווך שנתקל בשאלה — סעיף בהסכם, התנהלות מול לקוח, תמחור שאינו
 * ברור — לא תמיד יכול לשאול אותה בשמו. שאלה מקצועית בפורום פתוח
 * נקראת גם בידי הלקוח, גם בידי המתחרה ממול, ולעיתים גם בידי מי
 * שהשאלה נוגעת בו. התוצאה היא שהשאלות החשובות פשוט לא נשאלות.
 *
 * **האנונימיות היא הפיצ'ר, לא תוספת לו.** זה מה שהופך את הפורום
 * למקום שאפשר להתייעץ בו באמת, ולכן הוא הדבר הראשון שהעמוד אומר.
 *
 * ## למה כפתור שנרשם באמת
 *
 * „הרשמו וקבלו עדכון” שאינו רושם דבר הוא הבטחה שאין למי לקיים
 * ביום ההשקה. הלחיצה נשמרת בשרת (`/feature-signups/forum`),
 * והמסך מציג את המצב האמיתי — כולל למי שכבר נרשם וחוזר לעמוד.
 */

/** מזהה הפיצ'ר בשרת. רשימה סגורה — ראו `SIGNUP_FEATURES`. */
const FEATURE = "forum";

export default function ForumComingSoonPage() {
  const { loading: authLoading } = useRequireAuth();
  /** `null` = טרם ידוע. המסך אינו מנחש „לא נרשמת” בזמן הטעינה. */
  const [signed, setSigned] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    apiGet<{ signed: boolean }>(`/feature-signups/${FEATURE}`)
      .then((res) => setSigned(res.signed))
      /*
       * כשל קריאה משאיר `null` — „לא ידוע”. הכפתור נשאר זמין,
       * והשרת אידמפוטנטי, ולכן לחיצה נוספת אינה מזיקה. להציג
       * „לא נרשמת” על סמך כשל רשת היה שקר.
       */
      .catch(() => undefined);
  }, [authLoading]);

  const join = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await apiPost<{ signed: true }>(`/feature-signups/${FEATURE}`, {});
      setSigned(true);
    } catch {
      setError("ההרשמה לא נשמרה — נסו שוב בעוד רגע.");
    } finally {
      setBusy(false);
    }
  }, []);

  if (authLoading) return null;

  return (
    // div ולא main — העטיפה של AppShell היא ה-main landmark היחיד
    <div className="mv-page">
      <section
        className="mx-auto mt-8 max-w-2xl rounded-2xl border p-8"
        style={{
          borderColor: "var(--color-primary-accent)",
          background:
            "linear-gradient(180deg, var(--color-primary-soft), var(--color-surface) 78%)",
          boxShadow:
            "0 10px 28px color-mix(in srgb, var(--color-primary) 10%, transparent)",
        }}
        aria-labelledby="forum-heading"
      >
        <header className="text-center">
          <span
            className="mx-auto mb-3 inline-flex h-14 w-14 items-center justify-center rounded-full"
            style={{
              background: "var(--color-primary-soft)",
              color: "var(--color-primary)",
            }}
            aria-hidden="true"
          >
            <IconUsers s={28} />
          </span>
          <h1 id="forum-heading" className="m-0 text-2xl font-extrabold">
            פורום המתווכים
          </h1>
          <p
            className="m-0 mt-1 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[15px] font-bold"
            style={{
              background: "var(--color-primary-soft)",
              color: "var(--color-primary)",
            }}
          >
            <IconSparkle s={16} /> בקרוב
          </p>
        </header>

        <p className="m-0 mt-6 text-[19px] font-bold leading-relaxed">
          בקרוב ייפתח כאן פורום מקצועי למתווכים — מקום להעלות שאלות,
          להתייעץ עם עמיתים ולקבל תשובות ממי שכבר עבר את זה.
        </p>

        {/*
          האנונימיות ראשונה ובמסגרת משלה: היא הסיבה שהפורום הזה שונה
          מכל קבוצה מקצועית אחרת, ומי שסורק את העמוד צריך לפגוש אותה
          לפני כל דבר אחר.
        */}
        <div
          className="mt-5 rounded-xl border p-5"
          style={{
            borderColor: "var(--color-primary-accent)",
            background: "var(--color-surface)",
          }}
        >
          <h2 className="m-0 text-[17px] font-extrabold">
            והיתרון הגדול — אפשר לשאול בעילום שם
          </h2>
          <p className="m-0 mt-2 text-[16px] leading-relaxed">
            לא מעט שאלות מקצועיות פשוט אינן נשאלות, כי אי אפשר לשאול
            אותן בשם מלא: סעיף בהסכם שלא ברור, התנהלות מול לקוח,
            מקרה שנתקעתם בו, או פשוט שאלה שמעדיפים לשאול בלי שאיש
            יידע מי שאל. בפורום הזה תוכלו לפרסם שאלה{" "}
            <b>באנונימיות מלאה</b> — ולקבל תשובה מקצועית בדיוק כמו כל
            שאלה אחרת.
          </p>
        </div>

        <ul className="m-0 mt-5 list-none space-y-2.5 p-0 text-[16px] leading-relaxed">
          <li>• שאלות והתייעצויות מקצועיות — בשם או בעילום שם, לבחירתכם.</li>
          <li>• דיונים בין מתווכים מכל הארץ, במקום אחד ולא בעשר קבוצות.</li>
          <li>• תשובות שנשמרות וניתנות לחיפוש — לא נעלמות בגלילה.</li>
        </ul>

        {/* ------------------------------------------------------------
            ההרשמה לעדכון
            ------------------------------------------------------------ */}
        <div
          className="mt-6 rounded-xl border p-5 text-center"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-surface)",
          }}
        >
          {signed === true ? (
            <p className="m-0 text-[16.5px] font-bold" role="status">
              ✓ נרשמתם — נעדכן אתכם במייל ברגע שהפורום יעלה.
            </p>
          ) : (
            <>
              <p className="m-0 mb-3 text-[16.5px] font-bold">
                רוצים לדעת ברגע שהפורום נפתח?
              </p>
              <Button onClick={() => void join()} disabled={busy}>
                {busy ? "רושם…" : "הרשמו וקבלו עדכון כשהפורום עולה"}
              </Button>
              <p
                className="m-0 mt-2 text-sm"
                style={{ color: "var(--color-text-muted)" }}
              >
                הודעה אחת, ביום ההשקה. בלי דיוור ובלי פרטים נוספים —
                אתם כבר מחוברים.
              </p>
            </>
          )}
          {error !== null ? <Notice tone="danger">{error}</Notice> : null}
        </div>
      </section>
    </div>
  );
}
