"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  dailyQuoteIndex,
  orderQuotes,
  QUOTE_AUTHOR_MAX_LENGTH,
  QUOTE_MAX_LENGTH,
  type MentorQuote,
} from "@metavchim/shared";
import { Button } from "@metavchim/ui";
import { ApiError, apiDelete, apiGet, apiPost } from "@/lib/api";
import { IconChat, IconChevronLeft, IconChevronRight, IconPlus, IconTrash } from "../icons";
import { Notice } from "../notice";

/**
 * ‎**משפטי מוטבציה — של מי שכתב אותם, אחד בכל פעם.**
 *
 * ## מה השתנה כאן, ולמה
 *
 * ‏בגרסה הראשונה ישבה כאן רשימה של חמישה-עשר משפטים שהמערכת בחרה,
 * פרושה בחמש עמודות. שתי טעויות באותה החלטה:
 *
 * ‎**1. הקול לא היה של אף אחד.** משפט מוטבציה עובד כשמי שקורא אותו
 * מזהה את מי שאמר אותו — מנהל המשרד שלו, מי שהכניס אותו למקצוע.
 * רשימה שהגיעה עם התוכנה היא רשימה שאיש לא בחר, וכזו הופכת אחרי
 * שבוע לרעש. עכשיו הפלטפורמה כותבת את מה שמשותף, וכל משרד מוסיף
 * את שלו — והמשפטים של המשרד מוצגים ראשונים.
 *
 * ‎**2. חמישה-עשר משפטים על המסך אינם חמישה-עשר משפטים שנקראו.**
 * קיר טקסט הוא דבר שגוללים מעליו. משפט אחד במרכז, עם מקום לנשום
 * סביבו, הוא משפט שקוראים.
 *
 * ## שתי הכרעות קטנות בסליידר
 *
 * ‎**נקודת הפתיחה נגזרת מהתאריך ולא מהגרלה.** סליידר שנפתח תמיד על
 * הראשון הופך אותו לרקע. `Math.random` היה פותר את זה ושובר משהו
 * אחר: השרת והדפדפן היו מציירים משפטים שונים, והמסך היה מהבהב
 * בטעינה. תאריך יציב בתוך היום נותן את שניהם.
 *
 * ‎**ההחלפה האוטומטית נעצרת ברגע שנגעת.** מי שלחץ „הבא” אמר שהוא
 * קורא, ומשפט שמתחלף מתחת לעין באמצע קריאה הוא בדיוק ההפך ממה
 * שהקטע הזה נועד לו.
 */

/** ‏כמה זמן משפט נשאר על המסך לפני שהסליידר מתקדם מעצמו. */
const ADVANCE_MS = 8000;

export function QuotesSection({
  quotes: initial,
}: {
  quotes: MentorQuote[];
}): React.JSX.Element {
  /*
   * ‏משפטי הפלטפורמה מגיעים עם המסך ואינם משתנים בזמן הצפייה;
   * משפטי המשרד יכולים להשתנות כאן, כשמנהל מוסיף או מוחק. לכן
   * הרשימה מורכבת מחדש משני החצאים במקום להיטען שוב מהשרת —
   * טעינה חוזרת של כל המסך בשביל שורת טקסט היא הבהוב מיותר.
   */
  const platform = useMemo(() => initial.filter((q) => q.scope === "platform"), [initial]);
  const [office, setOffice] = useState<MentorQuote[]>(() =>
    initial.filter((q) => q.scope === "office"),
  );
  const quotes = useMemo(
    () => orderQuotes([...office, ...platform]),
    [office, platform],
  );

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
          משפט לרגע הנכון
        </h2>
      </div>

      <QuoteSlider quotes={quotes} />
      <QuotesEditor office={office} onChange={setOffice} />
    </section>
  );
}

/* ==========================================================================
 * ‏הסליידר
 * ========================================================================== */

function QuoteSlider({ quotes }: { quotes: MentorQuote[] }): React.JSX.Element {
  /*
   * ‎`useState` עם פונקציה, כדי שהתאריך ייקרא פעם אחת: קריאה בכל
   * רינדור הייתה מזיזה את נקודת הפתיחה מתחת ליד של מי שגולל.
   */
  const [index, setIndex] = useState(() => dailyQuoteIndex(quotes.length, new Date()));
  /** ‏האם המשתמש כבר ניווט בעצמו. משנגע — ההחלפה האוטומטית נעצרת. */
  const [touched, setTouched] = useState(false);
  const count = quotes.length;

  const go = useCallback(
    (delta: number) => {
      setTouched(true);
      setIndex((current) => (current + delta + count) % count);
    },
    [count],
  );

  useEffect(() => {
    /* ‏משפט אחד אינו סליידר, ומשנגעו — הקצב הוא של הקורא */
    if (touched || count < 2) return undefined;
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % count);
    }, ADVANCE_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [touched, count]);

  /* ‏רשימה שהתקצרה (מנהל שמחק) לא תשאיר את המצביע מחוץ לגבולות */
  useEffect(() => {
    setIndex((current) => (count === 0 ? 0 : current % count));
  }, [count]);

  if (count === 0) {
    return (
      <p className="m-0 text-[length:var(--type-body)]">
        עוד אין כאן משפטים. מנהל המשרד יכול להוסיף כאן משפטים משלו — כאלה
        שנאמרו בצוות הזה ומדברים אליו.
      </p>
    );
  }

  const quote = quotes[index % count] as MentorQuote;

  return (
    <div>
      <div className="flex items-center gap-2 sm:gap-3">
        {/*
           ‏כפתורי הניווט משני צידי המשפט ולא מתחתיו: הם שייכים למה
           שהם מזיזים, ובשורה נפרדת הם היו נראים כמו ניווט של הכרטיס
           כולו.
        */}
        <button
          type="button"
          className="mv-btn-plain mv-btn-icon shrink-0"
          onClick={() => {
            go(-1);
          }}
          disabled={count < 2}
          aria-label="המשפט הקודם"
        >
          <IconChevronRight s={18} />
        </button>

        {/*
           ‎`aria-live="polite"` ולא `assertive`: החלפת משפט אינה
           הודעה דחופה, והכרזה שקוטעת את מה שקורא המסך אומר כרגע
           הייתה מזיקה יותר משהיא מועילה.
        */}
        <div
          className="flex min-w-0 flex-1 items-center justify-center py-2 text-center"
          aria-live="polite"
          style={{ minHeight: 132 }}
        >
          <blockquote
            key={quote.id}
            className="mv-quote-slide m-0 flex flex-col items-center justify-center gap-1"
          >
            <span className="mv-quote-mark" aria-hidden="true">
              „
            </span>
            <p className="m-0 text-[length:var(--type-panel)] font-bold leading-snug">
              {quote.text}
            </p>
            {/*
               ‏„מי אמר” מוצג רק כשיש כזה. משרד שכתב משפט משלו אינו
               חייב לייחס אותו לאיש, ו„— לא ידוע” מתחת למשפט שמנהל
               המשרד חיבר בעצמו הוא המצאה קטנה שאין בה צורך.
            */}
            {quote.author === "" ? null : (
              <footer
                className="text-[length:var(--type-caption-lg)]"
                style={{ color: "var(--color-text-muted)" }}
              >
                <cite style={{ fontStyle: "normal" }}>— {quote.author}</cite>
              </footer>
            )}
          </blockquote>
        </div>

        <button
          type="button"
          className="mv-btn-plain mv-btn-icon shrink-0"
          onClick={() => {
            go(1);
          }}
          disabled={count < 2}
          aria-label="המשפט הבא"
        >
          <IconChevronLeft s={18} />
        </button>
      </div>

      {count < 2 ? null : (
        <div className="mt-2 flex items-center justify-center gap-3">
          {/*
             ‏נקודות עד תריסר; מעבר לזה הן הופכות לפס אפור שאינו
             אומר דבר, ומונה „7 מתוך 30” אומר בדיוק את אותו מידע.
          */}
          {count <= 12 ? (
            <div className="flex items-center gap-1.5">
              {quotes.map((q, at) => (
                <button
                  key={q.id}
                  type="button"
                  className="mv-quote-dot"
                  aria-current={at === index % count ? "true" : undefined}
                  aria-label={`משפט ${at + 1} מתוך ${count}`}
                  onClick={() => {
                    setTouched(true);
                    setIndex(at);
                  }}
                />
              ))}
            </div>
          ) : (
            <span
              className="text-[length:var(--type-caption)]"
              style={{
                color: "var(--color-text-muted)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {(index % count) + 1} מתוך {count}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/* ==========================================================================
 * ‏העורך של המשרד
 * ========================================================================== */

/**
 * ‎**המקום שבו מנהל המשרד כותב את המשפטים שלו.**
 *
 * ‏הוא יושב כאן, מתחת לסליידר, ולא במסך הגדרות נפרד — כדי שמי
 * שכותב יראה מיד איך זה ייראה לצוות. סוכן רגיל מקבל 403 על הקריאה
 * הראשונה, והקטע פשוט אינו קיים אצלו: „אין לך הרשאה” על משהו שלא
 * ביקש הוא רעש.
 */
function QuotesEditor({
  office,
  onChange,
}: {
  office: MentorQuote[];
  onChange: (quotes: MentorQuote[]) => void;
}): React.JSX.Element | null {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [author, setAuthor] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* ‏‎`onChange` בתלויות של האפקט היה מריץ אותו בכל רינדור של ההורה */
  const report = useRef(onChange);
  report.current = onChange;

  useEffect(() => {
    void (async () => {
      try {
        const rows = await apiGet<MentorQuote[]>("/mentor/quotes");
        setAllowed(true);
        report.current(rows);
      } catch {
        setAllowed(false);
      }
    })();
  }, []);

  if (allowed !== true) return null;

  const add = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await apiPost("/mentor/quotes", { text, author });
      onChange(await apiGet<MentorQuote[]>("/mentor/quotes"));
      setText("");
      setAuthor("");
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "השמירה נכשלה");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await apiDelete(`/mentor/quotes/${id}`);
      onChange(await apiGet<MentorQuote[]>("/mentor/quotes"));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "המחיקה נכשלה");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="mt-4 border-t pt-3"
      style={{ borderColor: "var(--color-input-border)" }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="m-0 text-[length:var(--type-row-title)] font-extrabold">
            המשפטים של המשרד
          </h3>
          <p
            className="m-0 mt-0.5 text-[length:var(--type-caption)]"
            style={{ color: "var(--color-text-muted)" }}
          >
            {office.length === 0
              ? "מה שתכתבו כאן יופיע לכל הצוות, לפני המשפטים הכלליים."
              : office.length === 1
                ? "משפט אחד שלכם, לפני המשפטים הכלליים."
                : `${office.length} משפטים שלכם, לפני המשפטים הכלליים.`}
          </p>
        </div>
        <Button
          variant={open ? "ghost" : "secondary"}
          onClick={() => {
            setOpen(!open);
            setError(null);
          }}
        >
          {open ? "ביטול" : "הוספת משפט"}
        </Button>
      </div>

      {error === null ? null : <Notice tone="danger">{error}</Notice>}

      {!open ? null : (
        <div className="mt-3">
          <label htmlFor="quote-text" className="mb-1 block text-sm font-bold">
            המשפט
          </label>
          <textarea
            id="quote-text"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
            }}
            maxLength={QUOTE_MAX_LENGTH}
            rows={2}
            className="w-full rounded-lg border px-3 py-2.5 text-sm"
            style={{
              background: "var(--color-field)",
              borderColor: "var(--color-input-border)",
              color: "var(--color-text)",
            }}
          />
          <label htmlFor="quote-author" className="mb-1 mt-3 block text-sm font-bold">
            מי אמר <span style={{ fontWeight: 400 }}>(אפשר להשאיר ריק)</span>
          </label>
          <input
            id="quote-author"
            value={author}
            onChange={(event) => {
              setAuthor(event.target.value);
            }}
            maxLength={QUOTE_AUTHOR_MAX_LENGTH}
            className="w-full rounded-lg border px-3 py-2.5 text-sm"
            style={{
              background: "var(--color-field)",
              borderColor: "var(--color-input-border)",
              color: "var(--color-text)",
            }}
          />
          <div className="mt-3">
            <Button
              onClick={() => {
                void add();
              }}
              disabled={busy || text.trim() === ""}
            >
              <span className="flex items-center gap-1.5">
                <IconPlus s={16} /> {busy ? "שומר…" : "הוספה"}
              </span>
            </Button>
          </div>
        </div>
      )}

      {office.length === 0 ? null : (
        <ul className="m-0 mt-3 grid list-none gap-2 p-0">
          {office.map((quote) => (
            <li
              key={quote.id}
              className="flex items-start justify-between gap-2 rounded-lg px-3 py-2"
              style={{ background: "var(--color-field)" }}
            >
              <span className="min-w-0 text-[length:var(--type-caption-lg)]">
                {quote.text}
                {quote.author === "" ? null : (
                  <span style={{ color: "var(--color-text-muted)" }}> — {quote.author}</span>
                )}
              </span>
              <button
                type="button"
                className="mv-btn-plain mv-btn-icon shrink-0"
                onClick={() => {
                  void remove(quote.id);
                }}
                disabled={busy}
                aria-label={`מחיקת המשפט „${quote.text.slice(0, 30)}”`}
              >
                <IconTrash s={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
