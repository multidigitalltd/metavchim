"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  QUOTE_AUTHOR_MAX_LENGTH,
  QUOTE_LIMIT_PER_SCOPE,
  QUOTE_MAX_LENGTH,
  type MentorQuote,
} from "@metavchim/shared";
import { apiDelete, apiGet, apiList, apiPost, ApiError } from "@/lib/api";
import { LoadError } from "../load-error";
import { Notice } from "../notice";

/**
 * ‎**משפטי המוטבציה שכל המשרדים רואים.**
 *
 * ## למה זה מסך פלטפורמה ולא רשימה בקוד
 *
 * ‏עד כאן ישבו במנטור חמישה-עשר משפטים שהמערכת בחרה. משפט מוטבציה
 * עובד כשהקול שלו מוכר, ורשימה שהגיעה עם התוכנה היא רשימה שאיש לא
 * בחר — אחרי שבוע גוללים מעליה. מה שנכתב כאן נבחר בידי אדם, ואפשר
 * לשנות אותו בלי גרסה חדשה.
 *
 * ‎**מה שנכתב כאן מוצג בכל משרד במערכת**, ולכן זו הכתיבה היחידה
 * בטבלה הזו שאינה שייכת למשרד: פוליסת ה-RLS מתירה לכל משרד לקרוא
 * את השורות האלה ולא לכתוב אותן. משרד שרוצה משפטים משלו מוסיף אותם
 * במסך המנטור, והם מוצגים אצלו **לפני** אלה שכאן.
 *
 * ## „מי אמר” — ריק הוא תשובה
 *
 * ‏הגרסה הקודמת אכפה מקור על כל ציטוט, מתוך חשש שמתווך יצטט משפט
 * מומצא בפני לקוח. החשש נכון, אבל הוא של מי שכותב ולא של המערכת:
 * מי שמייחס משפט לאדם אחראי לייחוס, ומי שכותב משפט משלו אינו צריך
 * להמציא לו מחבר. השדה אופציונלי, וריק פירושו שלא מוצג ייחוס כלל.
 */

const inputStyle = {
  borderColor: "var(--color-input-border)",
  background: "var(--color-field)",
} as const;

export function MentorQuotesSection(): React.JSX.Element {
  const [quotes, setQuotes] = useState<MentorQuote[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  function load(): void {
    setLoadFailed(false);
    apiGet<{ quotes: MentorQuote[] }>("/platform/mentor-quotes")
      .then((res) => setQuotes(apiList(res.quotes, "quotes")))
      .catch(() => setLoadFailed(true));
  }

  useEffect(load, []);

  async function add(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError(null);
    try {
      await apiPost("/platform/mentor-quotes", {
        text: String(data.get("text") ?? "").trim(),
        author: String(data.get("author") ?? "").trim(),
      });
      form.reset();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "השמירה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await apiDelete(`/platform/mentor-quotes/${id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "המחיקה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mv-list-card px-5 py-[17px]" aria-labelledby="mentor-quotes-heading">
      <h2
        id="mentor-quotes-heading"
        className="m-0 mb-1"
        style={{ fontSize: "calc(16.5 / 16 * 1rem)", fontWeight: 800 }}
      >
        משפטי מוטבציה במנטור
      </h2>
      <p
        className="m-0 mb-3 text-[length:var(--type-caption-lg)]"
        style={{ color: "var(--color-text-muted)" }}
      >
        מוצגים בסליידר שבתחתית מסך המנטור, אצל כל מתווך בכל המשרדים. משרד
        שמוסיף משפטים משלו יראה אותם ראשונים. עד {QUOTE_LIMIT_PER_SCOPE} משפטים.
      </p>

      {error ? <Notice tone="danger">{error}</Notice> : null}

      <form onSubmit={(e) => void add(e)} className="mb-4 flex flex-wrap items-end gap-2">
        <div className="min-w-[260px] flex-1">
          <label htmlFor="mq-text" className="mb-1 block text-sm font-semibold">
            המשפט
          </label>
          <input
            id="mq-text"
            name="text"
            required
            maxLength={QUOTE_MAX_LENGTH}
            className="w-full rounded-lg border px-3 py-2.5"
            style={inputStyle}
          />
        </div>
        <div>
          <label htmlFor="mq-author" className="mb-1 block text-sm font-semibold">
            מי אמר <span style={{ fontWeight: 400 }}>(לא חובה)</span>
          </label>
          <input
            id="mq-author"
            name="author"
            maxLength={QUOTE_AUTHOR_MAX_LENGTH}
            className="w-48 rounded-lg border px-3 py-2.5"
            style={inputStyle}
          />
        </div>
        <button type="submit" className="mv-button mv-button--primary" disabled={busy}>
          {busy ? "שומר…" : "הוספה"}
        </button>
      </form>

      {loadFailed ? (
        <LoadError onRetry={load} />
      ) : quotes === null ? (
        <p className="m-0 text-[length:var(--type-caption-lg)]">טוען…</p>
      ) : quotes.length === 0 ? (
        <p
          className="m-0 text-[length:var(--type-caption-lg)]"
          style={{ color: "var(--color-text-muted)" }}
        >
          אין עדיין משפטים. עד שיהיו, משרד רואה רק את מה שכתב בעצמו.
        </p>
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0">
          {quotes.map((quote) => (
            <li
              key={quote.id}
              className="flex items-start justify-between gap-3 rounded-lg px-3 py-2"
              style={{ background: "var(--color-field)" }}
            >
              <span className="min-w-0 text-[length:var(--type-caption-lg)]">
                {quote.text}
                {quote.author === "" ? null : (
                  <span style={{ color: "var(--color-text-muted)" }}>
                    {" "}
                    — {quote.author}
                  </span>
                )}
              </span>
              <button
                type="button"
                className="mv-button mv-button--ghost shrink-0"
                onClick={() => void remove(quote.id)}
                disabled={busy}
              >
                מחיקה
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
