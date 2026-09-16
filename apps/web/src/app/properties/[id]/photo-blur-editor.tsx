"use client";

import { useRef, useState } from "react";
import { PHOTO_BLUR_MAX_RECTS, type PhotoBlurRect } from "@metavchim/shared";
import { Notice } from "../../notice";

/**
 * טשטוש ידני על תמונת נכס — פנים, לוחית רישוי, תמונה משפחתית על הקיר.
 *
 * ## למה גרירה ולא זיהוי אוטומטי
 *
 * זיהוי פנים היה מטשטש גם את הפורטרט שעל הקיר וגם את הבובה על
 * המדף, ומפספס את המכתב עם השם על השולחן. המתווך יודע מה אסור
 * שייצא — הוא מסמן, והשרת מטשטש. שלוש שניות לתמונה.
 *
 * ## למה שברים
 *
 * התמונה מוצגת כאן מוקטנת, ובכל רוחב מסך אחרת. המלבן נשלח כשבר
 * של הרוחב והגובה (0.25 = רבע), והשרת — שמכיר את הגודל האמיתי —
 * מתרגם לפיקסלים. ראו `blurRectToPixels` בחבילה המשותפת.
 *
 * ## למה נאמר „בלתי הפיך”
 *
 * המקור אינו נשמר (החלטת בעל המערכת — עותק לכל תמונה הכפיל את
 * האחסון). מה שטושטש טושטש, ולכן התצוגה המקדימה כאן מראה את
 * הטשטוש **לפני** השליחה, והכפתור אומר כמה מלבנים ייצאו.
 */

interface Draft {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** מלבן קטן מזה (1% מכל צלע) הוא לחיצה, לא גרירה — מדולג. */
const MIN_DRAG = 0.01;

function toRect(draft: Draft): PhotoBlurRect {
  const x = Math.min(draft.x0, draft.x1);
  const y = Math.min(draft.y0, draft.y1);
  return { x, y, w: Math.abs(draft.x1 - draft.x0), h: Math.abs(draft.y1 - draft.y0) };
}

export function PhotoBlurEditor({
  src,
  alt,
  busy,
  error,
  onApply,
  onClose,
}: {
  src: string;
  alt: string;
  busy: boolean;
  error: string | null;
  onApply: (rects: PhotoBlurRect[]) => void;
  onClose: () => void;
}): React.JSX.Element {
  const [rects, setRects] = useState<PhotoBlurRect[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  /** התמונה לא נטענה — המסגרת נשארת גלויה, והסיבה נאמרת במקום ריק שקט */
  const [imageFailed, setImageFailed] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);

  /** מיקום המצביע כשבר של התמונה המוצגת, גזור ל-0..1. */
  function fraction(event: React.PointerEvent): { x: number; y: number } {
    const box = frameRef.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return { x: 0, y: 0 };
    return {
      x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)),
    };
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    if (busy || rects.length >= PHOTO_BLUR_MAX_RECTS) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const p = fraction(event);
    setDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    if (draft === null) return;
    const p = fraction(event);
    setDraft({ ...draft, x1: p.x, y1: p.y });
  }

  function onPointerUp(): void {
    if (draft === null) return;
    const rect = toRect(draft);
    setDraft(null);
    if (rect.w >= MIN_DRAG && rect.h >= MIN_DRAG) setRects((prev) => [...prev, rect]);
  }

  const preview = draft === null ? rects : [...rects, toRect(draft)];

  return (
    <section
      className="mv-card mv-card--pad mb-4"
      aria-labelledby="photo-blur-heading"
      style={{ borderColor: "var(--color-primary)" }}
    >
      <h3 id="photo-blur-heading" className="m-0 mb-1 text-[length:var(--type-body)] font-extrabold">
        טשטוש: {alt}
      </h3>
      <p className="m-0 mb-3 text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-soft)" }}>
        גררו מלבן על מה שצריך להסתיר — פנים, לוחית רישוי, תמונה אישית. אפשר כמה
        מלבנים. הטשטוש בלתי הפיך: המקור אינו נשמר.
      </p>

      {error !== null ? <Notice tone="danger">{error}</Notice> : null}
      {imageFailed ? <Notice tone="danger">התמונה לא נטענה — אי אפשר לסמן עליה. נסו לרענן.</Notice> : null}

      {/*
        המסגרת תופסת את אירועי המצביע, לא התמונה: `img` עם גרירה
        טבעית של הדפדפן הייתה „מרימה” את התמונה במקום לצייר.
        touch-action: none — במגע, הגרירה מציירת ולא גוללת.
      */}
      <div
        ref={frameRef}
        role="img"
        aria-label={`${alt} — גררו כדי לסמן אזור לטשטוש`}
        className="relative mx-auto w-full overflow-hidden rounded-xl"
        style={{
          maxWidth: "720px",
          /* ‏גובה מזערי: תמונה שלא נטענה אינה מכווצת את המסגרת לאפס ומעלימה את הכלי */
          minHeight: "160px",
          cursor: busy ? "progress" : "crosshair",
          touchAction: "none",
          userSelect: "none",
          background: "var(--color-bg)",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDraft(null)}
      >
        <img src={src} alt="" draggable={false} className="block w-full" onError={() => setImageFailed(true)} />
        {preview.map((rect, index) => (
          <div
            key={index}
            aria-hidden="true"
            className="absolute rounded-sm"
            style={{
              left: `${rect.x * 100}%`,
              top: `${rect.y * 100}%`,
              width: `${rect.w * 100}%`,
              height: `${rect.h * 100}%`,
              backdropFilter: "blur(14px)",
              WebkitBackdropFilter: "blur(14px)",
              background: "rgba(255,255,255,0.18)",
              outline: "2px dashed var(--color-primary)",
              outlineOffset: "-2px",
            }}
          />
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="mv-btn-action"
          disabled={busy || rects.length === 0}
          onClick={() => onApply(rects)}
        >
          {busy
            ? "מטשטש…"
            : rects.length === 0
              ? "טשטש"
              : rects.length === 1
                ? "טשטש מלבן אחד"
                : `טשטש ${rects.length} מלבנים`}
        </button>
        <button
          type="button"
          className="mv-btn-plain"
          disabled={busy || rects.length === 0}
          onClick={() => setRects([])}
        >
          נקה סימונים
        </button>
        <button type="button" className="mv-btn-plain" disabled={busy} onClick={onClose}>
          ביטול
        </button>
        {rects.length >= PHOTO_BLUR_MAX_RECTS ? (
          <span className="text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
            עד {PHOTO_BLUR_MAX_RECTS} מלבנים בפעם אחת
          </span>
        ) : null}
      </div>
    </section>
  );
}
