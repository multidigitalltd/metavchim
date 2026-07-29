"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Button } from "@metavchim/ui";
import type { Announcement } from "@metavchim/shared";
import { apiGet, apiPost } from "@/lib/api";

/**
 * באנר "מה חדש" (docs/09 שלב 2): מתווכים לא קוראים מיילים על גרסאות —
 * עדכון משמעותי מוצג בתוך המוצר עד שהמשתמש מסמן שראה. הסמן נשמר
 * פר-משתמש בשרת, כך שהבאנר לא חוזר בכל מכשיר מחדש.
 */

const PUBLIC_PATHS = ["/login", "/offer", "/change-password", "/accessibility"];

export function WhatsNewBanner() {
  const pathname = usePathname();
  const [unseen, setUnseen] = useState<Announcement[] | null>(null);
  const [expanded, setExpanded] = useState(false);

  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  useEffect(() => {
    if (isPublic) return;
    apiGet<{ items: Announcement[]; lastSeenId: string | null }>("/announcements")
      .then(({ items, lastSeenId }) => {
        // הרשימה מהחדש לישן; "לא נצפה" = כל מה שלפני הסמן
        const idx = lastSeenId === null ? items.length : items.findIndex((a) => a.id === lastSeenId);
        setUnseen(items.slice(0, idx === -1 ? items.length : idx));
      })
      .catch(() => setUnseen([])); // לא מחוברים / שגיאה — אין באנר, אין רעש
  }, [isPublic, pathname]);

  if (isPublic || unseen === null || unseen.length === 0) return null;
  const newest = unseen[0];
  if (newest === undefined) return null;

  const dismiss = async (): Promise<void> => {
    setUnseen([]); // סוגרים מיד — הרשת ברקע
    try {
      await apiPost("/announcements/seen", { id: newest.id });
    } catch {
      // לא קריטי: הסמן לא נשמר — הבאנר יחזור בטעינה הבאה
    }
  };

  return (
    <section
      role="region"
      aria-label="מה חדש במערכת"
      className="border-b px-4 py-2.5"
      style={{ borderColor: "var(--color-border)", background: "var(--color-primary-soft, var(--color-surface))" }}
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
        <p className="m-0 font-medium">
          <span aria-hidden="true">{newest.emoji} </span>
          חדש: {newest.title}
          {unseen.length > 1 ? ` (ועוד ${unseen.length - 1} עדכונים)` : ""}
        </p>
        <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          {newest.body}
        </span>
        <span className="ms-auto flex gap-2">
          {unseen.length > 1 ? (
            <Button variant="secondary" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
              {expanded ? "הסתר" : "כל העדכונים"}
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => void dismiss()}>
            הבנתי
          </Button>
        </span>
      </div>
      {expanded ? (
        <ul className="mx-auto mt-2 flex max-w-6xl list-none flex-col gap-2 p-0">
          {unseen.slice(1).map((a) => (
            <li key={a.id} className="text-sm">
              <span aria-hidden="true">{a.emoji} </span>
              <strong>{a.title}</strong> — {a.body}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
