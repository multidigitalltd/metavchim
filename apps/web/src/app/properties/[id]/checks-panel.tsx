"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  PROPERTY_CHECK_NOTE_MAX,
  PROPERTY_CHECK_STATUS_LABELS,
  PROPERTY_CHECK_STATUSES,
  type PropertyCheckKey,
  type PropertyChecksProgress,
  type PropertyCheckStatus,
} from "@metavchim/shared";
import { apiGet, apiPatch, apiPost, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { IconCheck, IconLink, IconList, IconWarning } from "../../icons";
import { Notice } from "../../notice";

/**
 * תיק הבדיקות של הנכס — לשונית „בדיקות” בכרטיס (docs/03 — property_checks).
 *
 * הרשימה מגיעה מהשרת כבר ממוזגת עם המצב, ולכן המסך אינו יודע מה
 * ברשימה ואינו צריך לדעת. כל שורה: מצב בארבעה כפתורים, הערה
 * שנשמרת בעזיבת השדה, קישור לשירות הממשלתי כשיש, ו„למשימה” כשעוד
 * לא נבדק. בראש — פס התקדמות: „7 מתוך 11 נבדקו, בעיה אחת”.
 */

export interface PropertyCheckRow {
  key: PropertyCheckKey;
  title: string;
  why: string;
  href: string | null;
  status: PropertyCheckStatus;
  note: string | null;
  checkedAt: string | null;
  checkedBy: string | null;
}

export interface PropertyChecksResponse {
  items: PropertyCheckRow[];
  progress: PropertyChecksProgress;
}

const STATUS_DOMAIN: Record<PropertyCheckStatus, string> = {
  unchecked: "mv-domain-neutral",
  ok: "mv-domain-green",
  issue: "mv-domain-peach",
  na: "mv-domain-neutral",
};

export function ChecksPanel({
  propertyId,
  canEdit,
  canTask,
  onProgress,
}: {
  propertyId: string;
  canEdit: boolean;
  /** ‎`calendar.manage` — „למשימה” יוצר משימה, ולכן דורש את יכולת המשימות */
  canTask: boolean;
  /** מדווח לכרטיס על כל שינוי — המונה על הלשונית לא מתיישן */
  onProgress?: (progress: PropertyChecksProgress) => void;
}) {
  const [data, setData] = useState<PropertyChecksResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<PropertyCheckKey | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const apply = useCallback(
    (next: PropertyChecksResponse) => {
      setData(next);
      onProgress?.(next.progress);
    },
    [onProgress],
  );

  useEffect(() => {
    let cancelled = false;
    apiGet<PropertyChecksResponse>(`/properties/${propertyId}/checks`)
      .then((res) => {
        if (!cancelled) apply(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "תיק הבדיקות לא נטען");
      });
    return () => {
      cancelled = true;
    };
  }, [propertyId, apply]);

  async function save(key: PropertyCheckKey, status: PropertyCheckStatus, note: string | null): Promise<void> {
    setBusyKey(key);
    setError(null);
    try {
      apply(await apiPatch<PropertyChecksResponse>(`/properties/${propertyId}/checks/${key}`, { status, ...(note === null ? {} : { note }) }));
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "השמירה נכשלה");
    } finally {
      setBusyKey(null);
    }
  }

  async function toTask(key: PropertyCheckKey, title: string): Promise<void> {
    setBusyKey(key);
    setError(null);
    try {
      await apiPost(`/properties/${propertyId}/checks/${key}/task`, {});
      setMessage(`נוספה משימה: „לבדוק: ${title}” — בלשונית „משימות”.`);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "המשימה לא נוצרה");
    } finally {
      setBusyKey(null);
    }
  }

  if (data === null) {
    return error ? <Notice tone="danger">{error}</Notice> : <p aria-live="polite">טוען את תיק הבדיקות…</p>;
  }

  const { items, progress } = data;

  return (
    <div className="flex flex-col gap-4">
      <section className="mv-card mv-card--pad" aria-labelledby="checks-progress">
        <div className="mv-card-head mv-domain-blue">
          <span className="mv-tile" aria-hidden="true"><IconList s={19} /></span>
          <h2 id="checks-progress" className="mv-card-head__title m-0">לפני שמחתימים</h2>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="m-0 flex items-baseline gap-2">
            <span style={{ fontSize: "var(--type-metric)", fontWeight: 900, color: progress.issues > 0 ? "var(--color-danger)" : progress.allClear ? "var(--color-success)" : "var(--color-text)" }}>
              {progress.checked}/{progress.total}
            </span>
            <span className="font-semibold" style={{ color: "var(--color-text-soft)" }}>
              {progress.allClear
                ? "הכול נבדק ותקין — הנכס מוכן להחתמה"
                : progress.issues > 0
                  ? `${progress.issues === 1 ? "בעיה אחת" : `${progress.issues} בעיות`} נמצאו${progress.remaining > 0 ? `, ועוד ${progress.remaining} טרם נבדקו` : ""}`
                  : progress.remaining === 0
                    ? "הכול נבדק"
                    : `${progress.remaining} בדיקות טרם נעשו`}
            </span>
          </p>
          <div className="mv-progress ms-auto" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent} aria-label="התקדמות הבדיקות" style={{ minWidth: "12rem" }}>
            <span style={{ width: `${progress.percent}%`, background: progress.issues > 0 ? "var(--color-danger)" : "var(--color-success)" }} />
          </div>
        </div>
        <p className="mv-form-hint mt-2">
          המסמכים עצמם — נסח, אישורים, היתרים — נשמרים בלשונית „מסמכים והסכמים”. כאן מסמנים מה נבדק ומה נמצא.
        </p>
      </section>

      {message ? <Notice tone="success" onClose={() => setMessage(null)}>{message}</Notice> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <ol className="m-0 flex list-none flex-col gap-3 p-0" aria-label="רשימת הבדיקות">
        {items.map((item) => (
          <CheckRow
            key={item.key}
            item={item}
            canEdit={canEdit}
            canTask={canTask}
            busy={busyKey === item.key}
            onStatus={(status, note) => void save(item.key, status, note)}
            onNote={(note) => void save(item.key, item.status, note)}
            onTask={() => void toTask(item.key, item.title)}
          />
        ))}
      </ol>
    </div>
  );
}

function CheckRow({
  item,
  canEdit,
  canTask,
  busy,
  onStatus,
  onNote,
  onTask,
}: {
  item: PropertyCheckRow;
  canEdit: boolean;
  canTask: boolean;
  busy: boolean;
  /** המצב **וההערה שבשדה** — לחיצה על מצב מיד אחרי הקלדה שומרת את שניהם */
  onStatus: (status: PropertyCheckStatus, note: string) => void;
  onNote: (note: string) => void;
  onTask: () => void;
}) {
  const [note, setNote] = useState(item.note ?? "");
  useEffect(() => setNote(item.note ?? ""), [item.note]);

  return (
    <li className="mv-card mv-card--pad">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`mv-pill ${STATUS_DOMAIN[item.status]}`}>
              {item.status === "ok" ? <IconCheck s={12} /> : item.status === "issue" ? <IconWarning s={12} /> : null}
              {PROPERTY_CHECK_STATUS_LABELS[item.status]}
            </span>
            <h3 className="m-0 text-[length:var(--type-body)] font-extrabold">{item.title}</h3>
          </div>
          <p className="m-0 mt-1 text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-soft)" }}>
            {item.why}
          </p>
          {item.checkedAt !== null ? (
            <p className="m-0 mt-1 text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
              סומן {formatDateTime(item.checkedAt)}{item.checkedBy !== null ? ` על ידי ${item.checkedBy}` : ""}
            </p>
          ) : null}
        </div>
        {item.href !== null ? (
          <Link href={item.href} target="_blank" rel="noopener noreferrer" className="mv-btn-plain no-underline">
            <IconLink s={14} /> לבדיקה באתר הממשלתי
          </Link>
        ) : (
          <span className="text-[length:var(--type-caption)] font-semibold" style={{ color: "var(--color-text-muted)" }}>
            ברשות המקומית
          </span>
        )}
      </div>

      {canEdit ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {/*
            ‏כפתורי המצב **אינם מושבתים** בזמן שמירה: עזיבת שדה ההערה
            ‏שומרת, ולחיצה על מצב באותו רגע הייתה נופלת על כפתור
            ‏מושבת ונבלעת (ביקורת Codex). הכתיבה היא upsert — לחיצה
            ‏כפולה כותבת פעמיים את אותו דבר, וזה לא נזק. המצב נשלח
            ‏יחד עם ההערה שבשדה, ולכן הקלדה שטרם נשמרה אינה אובדת.
          */}
          <div className="mv-seg mv-seg--wrap" role="group" aria-label={`מצב הבדיקה: ${item.title}`}>
            {PROPERTY_CHECK_STATUSES.map((status) => (
              <button
                key={status}
                type="button"
                aria-pressed={item.status === status}
                onClick={() => onStatus(status, note.trim())}
              >
                {PROPERTY_CHECK_STATUS_LABELS[status]}
              </button>
            ))}
          </div>
          {item.status === "unchecked" && canTask ? (
            <button type="button" className="mv-btn-soft" disabled={busy} onClick={onTask}>
              <IconList s={14} /> למשימה
            </button>
          ) : null}
        </div>
      ) : null}

      <label className="mt-3 flex flex-col gap-1 text-[length:var(--type-caption)] font-semibold">
        מה נמצא
        <textarea
          className="mv-field"
          rows={2}
          maxLength={PROPERTY_CHECK_NOTE_MAX}
          value={note}
          disabled={!canEdit}
          placeholder={item.status === "issue" ? "מה הבעיה, ומה צריך כדי לפתור אותה" : "הערה קצרה — מספר נסח, מי אישר, מה חסר"}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => {
            if (canEdit && note.trim() !== (item.note ?? "")) onNote(note.trim());
          }}
        />
      </label>
    </li>
  );
}
