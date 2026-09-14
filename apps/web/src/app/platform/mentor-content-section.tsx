"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@metavchim/ui";
import {
  CONTENT_NOTES_MAX,
  CONTENT_TITLE_MAX,
  MENTOR_CONTENT_KIND_LABELS,
  parseContentUrl,
  type MentorContentKind,
} from "@metavchim/shared";
import { ApiError, apiDelete, apiGet, apiPost } from "@/lib/api";
import { ConfirmDialog } from "../confirm-dialog";
import { Notice } from "../notice";

/**
 * ‎**התוכן של המנטור — סרטונים ופודקאסטים לכל המשרדים.**
 *
 * ## ‏מה נכנס כאן
 *
 * ‎**כתובת, לא קוד הטמעה.** „הטמעת סרטון” בניסוח הנאיבי שלה היא
 * ‏שדה שמקבל `<iframe>` והאתר מרנדר אותו — כלומר הזרקת HTML למסך
 * ‏של כל מתווך במערכת. כאן מדביקים את הכתובת מסרגל הכתובות או
 * ‏מכפתור השיתוף, והשרת קורא ממנה מזהה.
 *
 * ‏אותה קריאה רצה גם כאן, תוך כדי הקלדה — לא כדי לאכוף (השרת
 * ‏אוכף), אלא כדי שמי שהדביק כתובת שאינה נקראת יידע **לפני**
 * ‏שהוא לוחץ, ולא ממשפט שגיאה אחרי.
 *
 * ## ‏ומה יראו המתווכים
 *
 * ‏את מה שכאן ואת מה שהמשרד שלהם הוסיף, באותה רשימה. השורות
 * ‏שכאן מסומנות „מהמערכת” אצלם, ואין להם דרך למחוק אותן.
 */

interface ContentRow {
  id: string;
  title: string;
  notes: string;
  kind: MentorContentKind;
  ref: string;
  sourceUrl: string;
  sortOrder: number;
  platform: boolean;
}

export function MentorContentSection() {
  const [rows, setRows] = useState<ContentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [sortOrder, setSortOrder] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<ContentRow | null>(null);

  const load = useCallback(() => {
    apiGet<ContentRow[]>("/platform/mentor-content")
      .then((data) => {
        setRows(data);
        setError(null);
      })
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : "לא הצלחנו לטעון את התוכן"),
      );
  }, []);

  useEffect(load, [load]);

  /*
   * ‏הקריאה המקומית היא **תצוגה מקדימה בלבד**: אותה פונקציה בדיוק
   * ‏רצה בשרת לפני השמירה, ולכן אין כאן כלל שני שיכול להיפרד ממנו.
   */
  const preview = url.trim() === "" ? null : parseContentUrl(url.trim());

  async function add(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiPost("/platform/mentor-content", {
        title: title.trim(),
        url: url.trim(),
        ...(notes.trim() === "" ? {} : { notes: notes.trim() }),
        ...(sortOrder.trim() === "" ? {} : { sortOrder: Number(sortOrder) }),
      });
      setTitle("");
      setUrl("");
      setNotes("");
      setSortOrder("");
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "ההוספה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: ContentRow): Promise<void> {
    setRemoving(null);
    setError(null);
    try {
      await apiDelete(`/platform/mentor-content/${row.id}`);
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "המחיקה נכשלה");
    }
  }

  return (
    <section className="mt-8" aria-labelledby="platform-content-heading">
      <div className="mv-card-head mb-3">
        <h2 id="platform-content-heading" className="mv-card-head__title m-0">
          תוכן למנטור — סרטונים ופודקאסטים
        </h2>
      </div>

      <Notice tone="info">
        מה שנוסף כאן מופיע בתחתית עמוד המנטור <strong>בכל המשרדים</strong>, לצפייה
        והאזנה בתוך המערכת. מדביקים כתובת מיוטיוב, מספוטיפיי או מאפל פודקאסטס —
        לא קוד הטמעה.
      </Notice>

      {error !== null ? <Notice tone="danger">{error}</Notice> : null}

      <form className="mt-4 flex flex-col gap-3" onSubmit={(e) => void add(e)}>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <label
              htmlFor="platform-content-title"
              className="mb-1 block text-sm font-medium"
            >
              כותרת
            </label>
            <input
              id="platform-content-title"
              className="mv-field"
              value={title}
              maxLength={CONTENT_TITLE_MAX}
              minLength={2}
              required
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="w-[110px]">
            <label
              htmlFor="platform-content-order"
              className="mb-1 block text-sm font-medium"
            >
              סדר
            </label>
            <input
              id="platform-content-order"
              className="mv-field"
              type="number"
              min={0}
              max={9999}
              placeholder="0"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label htmlFor="platform-content-url" className="mb-1 block text-sm font-medium">
            קישור
          </label>
          <input
            id="platform-content-url"
            className="mv-field"
            type="url"
            dir="ltr"
            placeholder="https://www.youtube.com/watch?v=…"
            value={url}
            required
            onChange={(e) => setUrl(e.target.value)}
          />
          {/*
            ‏התשובה מיד ובמקום — „מה יישמר” ולא „נסה ותראה”. מי
            ‏שהדביק כתובת חלקית רואה זאת לפני שהוא לוחץ.
          */}
          {url.trim() !== "" ? (
            <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
              {preview === null
                ? "הכתובת אינה נקראת — בדקו שהיא מתחילה ב-https ושהיא מלאה."
                : `ייקרא כ: ${MENTOR_CONTENT_KIND_LABELS[preview.kind]}${
                    preview.kind === "link" ? " (נפתח מחוץ למערכת)" : ""
                  }`}
            </p>
          ) : null}
        </div>

        <div>
          <label
            htmlFor="platform-content-notes"
            className="mb-1 block text-sm font-medium"
          >
            על מה זה (לא חובה)
          </label>
          <input
            id="platform-content-notes"
            className="mv-field"
            value={notes}
            maxLength={CONTENT_NOTES_MAX}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <div>
          <Button type="submit" disabled={busy}>
            {busy ? "מוסיף…" : "הוספת תוכן"}
          </Button>
        </div>
      </form>

      {rows === null ? (
        <p className="mt-4">טוען…</p>
      ) : rows.length === 0 ? (
        <p className="mt-4" style={{ color: "var(--color-text-muted)" }}>
          עוד לא הועלה תוכן משותף.
        </p>
      ) : (
        <ul className="m-0 mt-5 flex list-none flex-col gap-2 p-0">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border p-3"
              style={{ borderColor: "var(--color-border)" }}
            >
              <span
                className="text-sm font-bold tabular-nums"
                style={{ color: "var(--color-text-muted)" }}
              >
                {row.sortOrder}
              </span>
              <div className="min-w-[200px] flex-1">
                <p className="m-0 font-bold">{row.title}</p>
                <p className="m-0 text-sm" style={{ color: "var(--color-text-muted)" }}>
                  {MENTOR_CONTENT_KIND_LABELS[row.kind]}
                  {row.notes === "" ? "" : ` · ${row.notes}`}
                </p>
                <a
                  className="text-sm"
                  dir="ltr"
                  href={row.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {row.sourceUrl}
                </a>
              </div>
              <Button variant="ghost" onClick={() => setRemoving(row)}>
                הסרה
              </Button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={removing !== null}
        title="להסיר את התוכן?"
        tone="danger"
        confirmLabel="הסרה"
        busyLabel="מוחק…"
        onConfirm={() => {
          if (removing !== null) void remove(removing);
        }}
        onClose={() => setRemoving(null)}
      >
        <p className="m-0">
          „{removing?.title ?? ""}” ייעלם מעמוד המנטור בכל המשרדים.
        </p>
      </ConfirmDialog>
    </section>
  );
}
