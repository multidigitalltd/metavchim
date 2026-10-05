"use client";

import { useState } from "react";
import {
  FORUM_REPORT_REASONS,
  FORUM_REPORT_REASON_LABELS,
  type ForumKind,
  type ForumReportReason,
  type ForumTopic,
} from "@metavchim/shared";
import { ApiError, apiPost } from "@/lib/api";
import { ConfirmDialog } from "../confirm-dialog";
import { IconEye, IconStar, IconUser } from "../icons";
import { Notice } from "../notice";

/**
 * הפורום המקצועי — מה שמשותף לכל המסכים שלו (docs/16).
 *
 * צורות התשובה כפי שה-API מחזיר (תאריכים כמחרוזות), תג המחבר —
 * המקום היחיד שמצייר „מי כתב” — הכוכבים, ודיווח.
 */

/* ---------- צורות התשובה ---------- */

export interface AuthorDto {
  label: string;
  office: string | null;
  anonymous: boolean;
}

export interface ThreadSummary {
  id: string;
  kind: ForumKind;
  topic: ForumTopic;
  title: string;
  snippet: string;
  author: AuthorDto;
  replyCount: number;
  score: number;
  answered: boolean;
  pinned: boolean;
  locked: boolean;
  mine: boolean;
  following: boolean;
  lastActivityAt: string;
  createdAt: string;
}

export interface PostDto {
  id: string;
  body: string;
  author: AuthorDto;
  score: number;
  voted: boolean;
  mine: boolean;
  accepted: boolean;
  hidden: boolean;
  createdAt: string;
  editedAt: string | null;
}

export interface ThreadDto extends ThreadSummary {
  body: string;
  voted: boolean;
  hidden: boolean;
  canModerate: boolean;
  editedAt: string | null;
  posts: PostDto[];
}

export interface ListingDto {
  id: string;
  kind: "tool" | "pro";
  category: string;
  name: string;
  description: string;
  url: string | null;
  contact: string | null;
  area: string | null;
  ratingAverage: number | null;
  ratingCount: number;
  /** ‏הדירוג שלי על הרשומה — כולל הבחירה בעילום שם, כדי שהטופס ייפתח כפי שנשמר */
  myRating: { score: number; comment: string | null; anonymous: boolean } | null;
  mine: boolean;
  createdAt: string;
}

export interface RatingDto {
  id: string;
  score: number;
  comment: string | null;
  author: AuthorDto;
  createdAt: string;
}

export const threadHref = (id: string): string => `/forum/t/${id}`;

/** צבע הדומיין לפי סוג השרשור — שאלה מזמינה תשובה, טיפ נותן. */
export const KIND_DOMAIN: Record<ForumKind, string> = {
  question: "mv-domain-blue",
  discussion: "mv-domain-violet",
  tip: "mv-domain-green",
};

/* ---------- המחבר ---------- */

/**
 * תג המחבר — אנונימי מקבל אייקון עין ובלי משרד; מזוהה מקבל שם ומשרד.
 * ‎`title` נושא את ההסבר, כדי שמי שמרחף יבין למה אין שם.
 */
export function AuthorBadge({ author, small = false }: { author: AuthorDto; small?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 ${small ? "text-[length:var(--type-caption)]" : "text-[length:var(--type-caption-lg)]"} font-bold`}
      style={{ color: author.anonymous ? "var(--color-text-muted)" : "var(--color-text-soft)" }}
      title={author.anonymous ? "פורסם בעילום שם — הזהות אינה נשמרת" : undefined}
    >
      {author.anonymous ? <IconEye s={14} /> : <IconUser s={14} />}
      {author.label}
      {author.office !== null ? (
        <span className="font-semibold" style={{ color: "var(--color-text-muted)" }}>
          · {author.office}
        </span>
      ) : null}
    </span>
  );
}

/* ---------- כוכבים ---------- */

/** תצוגת דירוג — חמישה כוכבים, מלאים לפי הממוצע, עם טקסט לקוראי מסך. */
export function Stars({ value, count }: { value: number | null; count: number }) {
  const rounded = value === null ? 0 : Math.round(value);
  return (
    <span className="mv-stars" role="img" aria-label={value === null ? "טרם דורג" : `${value} מתוך 5, ${count} דירוגים`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} data-on={n <= rounded ? "1" : undefined} aria-hidden="true">
          <IconStar s={15} />
        </span>
      ))}
      <span className="mv-stars__text" aria-hidden="true">
        {value === null ? "טרם דורג" : `${value} · ${count}`}
      </span>
    </span>
  );
}

/** בחירת דירוג — קבוצת רדיו: מקלדת, קוראי מסך ועכבר מקבלים אותו דבר. */
export function StarInput({ value, onChange }: { value: number; onChange: (score: number) => void }) {
  return (
    <div className="mv-stars mv-stars--input" role="radiogroup" aria-label="דירוג מניסיון אישי">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} מתוך 5`}
          data-on={n <= value ? "1" : undefined}
          onClick={() => onChange(n)}
        >
          <IconStar s={22} />
        </button>
      ))}
    </div>
  );
}

/* ---------- דיווח ---------- */

export type ReportTarget = "thread" | "post" | "listing" | "rating";

export function ReportDialog({
  target,
  onClose,
}: {
  target: { type: ReportTarget; id: string } | null;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<ForumReportReason>("spam");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function send(): Promise<void> {
    if (target === null) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/forum/reports/${target.type}/${target.id}`, {
        reason,
        ...(note.trim() === "" ? {} : { note: note.trim() }),
      });
      setDone(true);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "הדיווח לא נשלח");
    } finally {
      setBusy(false);
    }
  }

  function close(): void {
    setDone(false);
    setNote("");
    setReason("spam");
    onClose();
  }

  return (
    <ConfirmDialog
      open={target !== null}
      title={done ? "הדיווח התקבל" : "דיווח לניהול הפורום"}
      tone={done ? "success" : "danger"}
      confirmLabel={done ? "סגירה" : "לדווח"}
      cancelLabel={done ? null : "ביטול"}
      busy={busy}
      busyLabel="שולח…"
      onConfirm={done ? close : () => void send()}
      onClose={close}
    >
      {done ? (
        <p className="m-0">תודה. ניהול הפלטפורמה יבדוק ויכריע — הדיווח אינו גלוי לאיש מלבדו.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="m-0">מה הבעיה? הדיווח מגיע לניהול הפלטפורמה בלבד.</p>
          <div className="flex flex-col gap-1.5">
            {FORUM_REPORT_REASONS.map((code) => (
              <label key={code} className="flex items-center gap-2 text-[length:var(--type-caption-lg)]">
                <input type="radio" name="report-reason" checked={reason === code} onChange={() => setReason(code)} />
                {FORUM_REPORT_REASON_LABELS[code]}
              </label>
            ))}
          </div>
          <label className="flex flex-col gap-1 text-[length:var(--type-caption)] font-semibold">
            פירוט (רשות)
            <textarea className="mv-field" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          {error ? <Notice tone="danger">{error}</Notice> : null}
        </div>
      )}
    </ConfirmDialog>
  );
}
