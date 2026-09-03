"use client";

import { useRequireAuth } from "@/lib/use-auth";
import { IconSparkle } from "../icons";

/**
 * רכש מדיה — עמוד "בקרוב" עד ההשקה.
 *
 * ## למה הלשונית קיימת לפני הפיצ'ר
 *
 * מתווך שרואה את הלשונית יודע מה מגיע, וביום ההשקה הוא כבר יודע
 * לאן להיכנס. אותו נימוק כמו ב„קונים - Kanko”: התג „בקרוב” אומר
 * את האמת, ולכן אין כאן הבטחה שנשברת בלחיצה.
 *
 * ## מה העמוד אומר, ומה הוא לא אומר
 *
 * משפט אחד וברור — שמכאן יהיה אפשר לנהל את הפרסומים במגוון מדיות.
 * בלי טופס, בלי „הירשמו לעדכון” (זה קיים בפורום, שם יש למה
 * להירשם), ובלי מחירים או מועדים שטרם נקבעו. רשימת המדיות היא
 * הכיוון, לא התחייבות לספקים.
 */
export default function MediaComingSoonPage() {
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
        aria-labelledby="media-heading"
      >
        <h1 id="media-heading" className="m-0 text-2xl font-extrabold">
          רכש מדיה
        </h1>

        {/* גדול ומודגש, בצבע הטקסט המלא — זה המסר של העמוד, לא הערת שוליים */}
        <p className="m-0 mt-4 text-[length:var(--type-screen-title)] font-bold leading-relaxed">
          בקרוב יהיה ניתן לנהל מכאן את הפרסומים שלכם במגוון מדיות —
          במקום אחד, בלי לרוץ בין ספקים ובין ממשקים.
        </p>

        <p
          className="mx-auto mt-5 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[length:var(--type-body-sm)] font-bold"
          style={{
            background: "var(--color-primary-soft)",
            color: "var(--color-primary)",
          }}
        >
          <IconSparkle s={16} /> בקרוב
        </p>

        {/*
          הרשימה מיישרת לימין בתוך כרטיס ממורכז: שורות שנקראות
          כרשימה, ולא כטקסט שמרחף במרכז.
        */}
        <ul className="m-0 mt-6 list-none space-y-2.5 p-0 text-start text-[length:var(--type-button)] leading-relaxed">
          <li>• קמפיינים ברשתות החברתיות ובמנועי החיפוש.</li>
          <li>• פרסום בלוחות הנדל״ן ובאתרי הנכסים.</li>
          <li>• מדיה מקומית — עיתונות, שילוט ודיוור לשכונה.</li>
          <li>• מעקב אחרי מה שכל פרסום הביא בפועל, מול הלידים במערכת.</li>
        </ul>
      </section>
    </div>
  );
}
