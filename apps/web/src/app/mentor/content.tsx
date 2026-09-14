"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CONTENT_NOTES_MAX,
  CONTENT_TITLE_MAX,
  embedHeight,
  embedUrl,
  MENTOR_CONTENT_KIND_LABELS,
  type MentorContentKind,
} from "@metavchim/shared";
import { ApiError, apiDelete, apiGet, apiPost } from "@/lib/api";
import { can, type AuthUser } from "@/lib/use-auth";
import { ConfirmDialog } from "../confirm-dialog";
import { IconHeadphones, IconPlay, IconTrash } from "../icons";
import { LoadError } from "../load-error";
import { Notice } from "../notice";

/**
 * ‎**איזור התוכן של המנטור — סרטונים ופודקאסטים.**
 *
 * ## ‏למה זה כאן
 *
 * ‏המנטור נותן מדידה, משוב ותרגול. מה שחסר לו הוא **חומר**: סרטון
 * ‏הדרכה, פרק פודקאסט, שיחה עם מתווך ותיק. עד כה זה נשלח בקבוצת
 * ‏הוואטסאפ של המשרד ונעלם בגלילה תוך יומיים.
 *
 * ## ‏הנגן נטען בלחיצה, לא בטעינת העמוד
 *
 * ‎**זו ההכרעה שנושאת את המשקל כאן.** עשר מסגרות יוטיוב בטעינת
 * ‏העמוד הן עשר בקשות לשרת חיצוני, סקריפט נגן לכל אחת, ומאות
 * ‏קילובייטים — בעמוד שרובו אינו נצפה. הכרטיס הוא **חזית**: כותרת,
 * ‏תיאור וכפתור. המסגרת נבנית ברגע שנלחץ, ורק זו שנלחצה.
 *
 * ## ‏ומה **אינו** מגיע לכאן
 *
 * ‏קוד הטמעה. השרת שומר מזהה שנקרא מהכתובת, והמסגרת נבנית ממנו
 * ‏ומהמקור הקבוע (`embedUrl`). מחרוזת שהמנהל הדביק אינה מגיעה
 * ‏ל-`src`, וממילא אינה מגיעה ל-HTML.
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

export function MentorContentSection({ user }: { user: AuthUser | null }) {
  const [rows, setRows] = useState<ContentRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const manage = can(user, "settings.manage");

  const load = useCallback(() => {
    setFailed(false);
    apiGet<ContentRow[]>("/mentor/content")
      .then(setRows)
      .catch((err: unknown) => {
        /* 403 = המנטור אינו במסלול. את זה העמוד כבר אומר למעלה. */
        if (err instanceof ApiError && err.status === 403) {
          setRows([]);
          return;
        }
        setFailed(true);
      });
  }, []);

  useEffect(load, [load]);

  return (
    <section className="mv-learn" aria-labelledby="mentor-content-heading">
      <div className="mv-learn__head">
        <div className="min-w-0">
          <h2 id="mentor-content-heading" className="mv-learn__title">
            <span className="mv-learn__icon" aria-hidden="true">
              <IconHeadphones s={18} />
            </span>
            תוכן והדרכות
          </h2>
          <p className="mv-learn__sub">
            סרטונים ופודקאסטים למתווכים — לצפייה והאזנה כאן, בלי לצאת
            מהמערכת.
          </p>
        </div>
        {manage ? <AddContent onAdded={load} /> : null}
      </div>

      {failed ? (
        <LoadError message="לא הצלחנו לטעון את התוכן" onRetry={load} />
      ) : rows === null ? (
        <p aria-live="polite" className="mv-learn__empty">
          טוען…
        </p>
      ) : rows.length === 0 ? (
        <p className="mv-learn__empty">
          {manage
            ? "עוד לא הועלה תוכן. הדביקו קישור מיוטיוב, מספוטיפיי או מאפל פודקאסטס."
            : "עוד לא הועלה תוכן לאיזור הזה."}
        </p>
      ) : (
        <ul className="mv-learn__grid">
          {rows.map((row) => (
            <ContentCard
              key={row.id}
              row={row}
              /* ‏שורת פלטפורמה גלויה למשרד ואינה שלו — אין לו מה למחוק בה */
              onRemoved={manage && !row.platform ? load : null}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/* ====================================================================== */
/* ‏כרטיס אחד — חזית, ואז נגן                                             */
/* ====================================================================== */

function ContentCard({
  row,
  onRemoved,
}: {
  row: ContentRow;
  onRemoved: (() => void) | null;
}) {
  const [playing, setPlaying] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove(): Promise<void> {
    setConfirm(false);
    setError(null);
    try {
      await apiDelete(`/mentor/content/${row.id}`);
      onRemoved?.();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "המחיקה נכשלה");
    }
  }

  return (
    <li className="mv-learn__card">
      <div className="mv-learn__cardhead">
        <span className="mv-learn__kind">
          {MENTOR_CONTENT_KIND_LABELS[row.kind]}
        </span>
        {row.platform ? (
          <span className="mv-learn__kind" data-platform="true">
            מהמערכת
          </span>
        ) : null}
        {onRemoved !== null ? (
          <button
            type="button"
            className="mv-learn__del"
            title="הסרת התוכן"
            aria-label={`הסרת ${row.title}`}
            onClick={() => setConfirm(true)}
          >
            <IconTrash s={15} />
          </button>
        ) : null}
      </div>

      <h3 className="mv-learn__cardtitle">{row.title}</h3>
      {row.notes !== "" ? (
        <p className="mv-learn__cardnote">{row.notes}</p>
      ) : null}

      {error !== null ? <Notice tone="danger">{error}</Notice> : null}

      {/*
        ‎**קישור חיצוני אינו מתחזה לנגן.** יש פודקאסטים בלי הטמעה,
        ‏וכפתור „נגן” שפותח לשונית הוא בדיוק ההפתעה שגורמת ללחוץ
        ‏פעמיים ולפתוח שתיים.
      */}
      {row.kind === "link" ? (
        <a
          className="mv-learn__play"
          href={row.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          פתיחה באתר החיצוני
        </a>
      ) : playing ? (
        <iframe
          className="mv-learn__frame"
          src={playerUrl(row)}
          height={embedHeight(row.kind)}
          title={row.title}
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          allow="autoplay; encrypted-media; picture-in-picture; clipboard-write"
          allowFullScreen
        />
      ) : (
        <button
          type="button"
          className="mv-learn__play"
          onClick={() => setPlaying(true)}
        >
          <IconPlay s={16} />
          {row.kind === "youtube" ? "צפייה" : "האזנה"}
        </button>
      )}

      <ConfirmDialog
        open={confirm}
        title="להסיר את התוכן?"
        tone="danger"
        confirmLabel="הסרה"
        busyLabel="מוחק…"
        onConfirm={() => void remove()}
        onClose={() => setConfirm(false)}
      >
        <p className="m-0">
          „{row.title}” ייעלם מהמסך של כל המתווכים במשרד.
        </p>
      </ConfirmDialog>
    </li>
  );
}

/*
 * ‏הכתובת נבנית מהמזהה ומהמקור הקבוע — `embedUrl` — ואליה מצטרף
 * ‏ניגון מיידי: מי שלחץ „צפייה” כבר ביקש לצפות, ולחיצה שנייה על
 * ‏הנגן שנפתח היא חיכוך בלי סיבה.
 */
function playerUrl(row: ContentRow): string {
  const base = embedUrl({ kind: row.kind, ref: row.ref });
  if (row.kind === "youtube") return `${base}?autoplay=1&rel=0`;
  return base;
}

/* ====================================================================== */
/* ‏הוספה — למי שמנהל את המשרד                                            */
/* ====================================================================== */

function AddContent({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiPost("/mentor/content", {
        title: title.trim(),
        url: url.trim(),
        ...(notes.trim() === "" ? {} : { notes: notes.trim() }),
      });
      setTitle("");
      setUrl("");
      setNotes("");
      setOpen(false);
      onAdded();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "ההוספה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="mv-btn-plain" onClick={() => setOpen(true)}>
        הוספת תוכן
      </button>
    );
  }

  return (
    <form className="mv-learn__form" onSubmit={(e) => void submit(e)}>
      <div>
        <label htmlFor="mv-learn-title" className="mb-1 block text-sm font-medium">
          כותרת
        </label>
        <input
          id="mv-learn-title"
          className="mv-field"
          value={title}
          maxLength={CONTENT_TITLE_MAX}
          minLength={2}
          required
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div>
        <label htmlFor="mv-learn-url" className="mb-1 block text-sm font-medium">
          קישור מיוטיוב, מספוטיפיי או מאפל פודקאסטס
        </label>
        <input
          id="mv-learn-url"
          className="mv-field"
          type="url"
          dir="ltr"
          placeholder="https://www.youtube.com/watch?v=…"
          value={url}
          required
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>
      <div>
        <label htmlFor="mv-learn-notes" className="mb-1 block text-sm font-medium">
          על מה זה (לא חובה)
        </label>
        <input
          id="mv-learn-notes"
          className="mv-field"
          value={notes}
          maxLength={CONTENT_NOTES_MAX}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      {error !== null ? <Notice tone="danger">{error}</Notice> : null}
      <div className="flex gap-2">
        <button type="submit" className="mv-btn-primary" disabled={busy}>
          {busy ? "מוסיף…" : "הוספה"}
        </button>
        <button
          type="button"
          className="mv-btn-plain"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
        >
          ביטול
        </button>
      </div>
    </form>
  );
}
