"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Button } from "@metavchim/ui";
import type { Announcement } from "@metavchim/shared";
import { apiGet, apiPost } from "@/lib/api";

/**
 * באנר "מה חדש" (docs/09 שלב 2): מתווכים לא קוראים מיילים על גרסאות —
 * עדכון משמעותי מוצג בתוך המוצר עד שהמשתמש מסמן שראה. הסמן נשמר
 * פר-משתמש בשרת, כך שהבאנר לא חוזר בכל מכשיר מחדש.
 *
 * "לא נצפה" נגזר בהשוואה לקסיקוגרפית על ה-id (YYYY-MM-DD-slug) — אותו
 * כלל כמו בשרת: סמן שהוסר מהרשימה (rollback/שינוי שם) לא משחזר את כל
 * ההיסטוריה, והסמן רק מתקדם (ביקורת Codex).
 */

const PUBLIC_PATHS = ["/login", "/offer", "/change-password", "/accessibility"];

export function WhatsNewBanner() {
  const pathname = usePathname();
  const [unseen, setUnseen] = useState<Announcement[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  // "הבנתי" נלחץ — תשובת GET מאוחרת (מרוץ ניווט) לא תפתח את הבאנר מחדש
  const dismissedRef = useRef(false);

  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  useEffect(() => {
    if (isPublic) return;
    let cancelled = false;
    apiGet<{ items: Announcement[]; lastSeenId: string | null }>("/announcements")
      .then(({ items, lastSeenId }) => {
        if (cancelled || dismissedRef.current) return;
        setUnseen(lastSeenId === null ? items : items.filter((a) => a.id > lastSeenId));
      })
      .catch(() => {
        if (!cancelled) setUnseen([]); // לא מחוברים / שגיאה — אין באנר, אין רעש
      });
    return () => {
      cancelled = true;
    };
  }, [isPublic]);

  if (isPublic) return null;

  const items = unseen ?? [];
  const newest = items[0];

  const dismiss = async (): Promise<void> => {
    if (items.length === 0) return;
    dismissedRef.current = true;
    setUnseen([]); // סוגרים מיד — הרשת ברקע
    // שולחים את המזהה הגדול ביותר לקסיקוגרפית — הכלל שקובע "נצפה" בשרת
    const maxId = items.reduce((m, a) => (a.id > m ? a.id : m), items[0]?.id ?? "");
    try {
      await apiPost("/announcements/seen", { id: maxId });
    } catch {
      // לא קריטי: הסמן לא נשמר — הבאנר יחזור בטעינה הבאה
    }
  };

  return (
    // אזור חי יציב: קיים מהרינדור הראשון, כך שקוראי מסך מקריאים את
    // הבאנר גם כשהוא נכנס אחרי שה-fetch הסתיים (docs/06 §דינמיות)
    <div aria-live="polite">
      {newest === undefined ? null : (
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
              {items.length > 1 ? ` (ועוד ${items.length - 1} עדכונים)` : ""}
            </p>
            <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>
              {newest.body}
            </span>
            <span className="ms-auto flex gap-2">
              {items.length > 1 ? (
                <Button
                  variant="secondary"
                  onClick={() => setExpanded((v) => !v)}
                  aria-expanded={expanded}
                >
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
              {items.slice(1).map((a) => (
                <li key={a.id} className="text-sm">
                  <span aria-hidden="true">{a.emoji} </span>
                  <strong>{a.title}</strong> — {a.body}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      )}
    </div>
  );
}
