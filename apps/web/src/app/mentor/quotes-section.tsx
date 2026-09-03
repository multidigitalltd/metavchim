"use client";

import {
  QUOTE_THEME_LABELS,
  QUOTE_THEME_NOTES,
  QUOTE_THEMES,
  quotesByTheme,
} from "@metavchim/shared";
import { IconChat } from "../icons";

/**
 * ‎**משפטי מוטבציה — בתחתית המסך, ובכוונה.**
 *
 * ‏המנטור הזה נבנה סביב הכלל „לא להציג מספר שהומצא”, ומשפט מעורר
 * השראה בראש המסך היה סותר אותו בצורה אחרת: הוא היה הדבר הראשון
 * שנקרא, במקום המספרים. מי שנכנס בבוקר רוצה לדעת כמה שיחות נשארו;
 * מי שמחפש חיזוק יודע לחפש אותו, ובשבילו יש הכפתור למעלה.
 *
 * ‎**כל שורה נושאת את מי שאמר אותה**, וזו אינה קפדנות אקדמית. משפטי
 * מוטבציה הם התחום שבו ייחוס שגוי הוא הנורמה — אותו משפט מיוחס
 * ברשת לאיינשטיין, לגנדי ולמנדלה — ומתווך שיצטט כאן משהו בפני לקוח
 * וייתפס בטעות, המערכת הזיקה לו. הרשימה עצמה והכללים עליה יושבים
 * בחבילה המשותפת, עם שער שבודק שכל מקור הוא כתובת שאפשר לפתוח או
 * הודאה מפורשת שאין כזו.
 */

export function QuotesSection(): React.JSX.Element {
  return (
    <section
      id="mentor-quotes"
      className="mv-card mv-card--pad mt-[18px]"
      aria-labelledby="quotes-heading"
    >
      <div className="mv-card-head">
        <span className="mv-tile mv-tile--44 mv-domain-violet" aria-hidden="true">
          <IconChat s={20} />
        </span>
        <h2 id="quotes-heading" className="mv-card-head__title">
          משפטים לרגעים הקשים
        </h2>
      </div>
      <p
        className="m-0 mb-4 text-[length:var(--type-caption-lg)]"
        style={{ color: "var(--color-text-muted)" }}
      >
        חמש משפחות, לפי מה שעוצר בפועל. כל משפט עם מי שאמר אותו — כדי
        שתוכל לצטט בלי לחשוש.
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        {QUOTE_THEMES.map((theme) => (
          <div
            key={theme}
            className="rounded-xl border p-3"
            style={{ borderColor: "var(--color-input-border)" }}
          >
            <h3 className="m-0 text-[length:var(--type-body)] font-extrabold">
              {QUOTE_THEME_LABELS[theme]}
            </h3>
            <p
              className="m-0 mb-3 mt-0.5 text-[length:var(--type-caption)]"
              style={{ color: "var(--color-text-muted)" }}
            >
              {QUOTE_THEME_NOTES[theme]}
            </p>
            <ul className="m-0 grid list-none gap-3 p-0">
              {quotesByTheme(theme).map((quote) => (
                <li key={quote.text}>
                  {/*
                     ‎`blockquote` ו-`cite` ולא שתי שורות טקסט: הקשר בין
                     המשפט למקור שלו הוא המידע כאן, ובלי הסימון הוא
                     קיים רק ויזואלית.
                  */}
                  <blockquote
                    className="m-0 border-e-2 pe-3 text-[length:var(--type-body)] leading-relaxed"
                    style={{ borderColor: "var(--domain-violet-fg)" }}
                  >
                    {quote.text}
                    <footer
                      className="mt-1 text-[length:var(--type-caption)]"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      <cite style={{ fontStyle: "normal" }}>{quote.source}</cite>
                    </footer>
                  </blockquote>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
