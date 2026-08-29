"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { apiGet, apiList, apiPatch } from "@/lib/api";
import { notificationHref } from "@/lib/notification-links";
import { can, type AuthUser } from "@/lib/use-auth";

const POLL_MS = 30_000;

interface NotificationDto {
  id: string;
  type: string;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
  readAt?: string;
  createdAt: string;
}

/**
 * פעמון ההתראות — לפי קובץ העיצוב: כפתור ריבועי עם נקודת חיווי,
 * ופאנל נפתח עם ההתראות האחרונות ו"סמן הכל כנקרא".
 */

/* צבע הנקודה לפי סוג ההתראה — כמו בעיצוב: חדש=כתום-אדמדם, חיובי=ירוק */
function dotColor(type: string): string {
  if (type.includes("lead")) return "var(--color-danger)";
  if (type.includes("interest") || type.includes("signed") || type.includes("match"))
    return "#12A150";
  return "#c98a2e";
}

function timeAgo(iso: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "עכשיו";
  if (minutes < 60) return `לפני ${minutes} דק׳`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "לפני שעה" : `לפני ${hours} שעות`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "אתמול" : `לפני ${days} ימים`;
}

/**
 * `user` מגיע מהמעטפת ולא מ-hook נוסף: הזהות כבר נטענה שם, וקריאה
 * שנייה הייתה מוסיפה בקשה ומרוץ. הוא דרוש כדי לא לשלוח את הלוחץ
 * ליעד שיחזיר לו 403 — התראות משרדיות מגיעות גם למי שאינו רשאי
 * לפתוח את היעד שלהן (ביקורת Codex).
 */
export function NotificationsBell({ user }: { user: AuthUser | null }) {
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<NotificationDto[]>([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (pathname === "/login" || pathname.startsWith("/offer/")) return;
    let cancelled = false;
    const load = () => {
      apiGet<{ items: NotificationDto[]; unreadCount: number }>("/notifications?limit=6")
        .then((res) => {
          if (cancelled) return;
          setUnread(res.unreadCount);
          setItems(apiList(res.items, "items"));
        })
        .catch(() => undefined);
    };
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent): void => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function markAllRead(): Promise<void> {
    try {
      await apiPatch("/notifications/read-all", {});
      setUnread(0);
      setItems((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
    } catch {
      /* הכפתור נשאר — אפשר לנסות שוב */
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        className="mv-icon-button"
        aria-label={unread > 0 ? `התראות — ${unread} חדשות` : "התראות"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6" />
          <path d="M10 19a2 2 0 0 0 4 0" />
        </svg>
        {unread > 0 ? <span className="mv-icon-dot" aria-hidden="true" /> : null}
      </button>

      {open ? (
        <div className="mv-notif-pop" role="region" aria-label="התראות אחרונות">
          <div className="mv-notif-head">
            <span>מאז שהתחברת לאחרונה</span>
            {unread > 0 ? (
              <button type="button" className="mv-notif-mark" onClick={() => void markAllRead()}>
                סמן הכל כנקרא
              </button>
            ) : null}
          </div>
          {items.length === 0 ? (
            <p className="mv-notif-empty">אין התראות חדשות</p>
          ) : (
            items.map((n) => {
              /*
               * **כל שורה בפעמון לחיצה** (בקשת המשתמש). התראה
               * בלי יעד ספציפי — סוג חדש, או כזו שאינה מקושרת
               * לישות — הובילה עד כה לשום מקום: המתווך קרא
               * „הצעת שיתוף פעולה חדשה”, לחץ, ולא קרה דבר. מסך
               * ההתראות המלא הוא היעד הנכון שם, כי בו מוצג גם
               * גוף ההתראה שנחתך כאן.
               */
              const href =
                notificationHref(n.entityType, n.entityId, (c) => can(user, c)) ??
                "/notifications";
              const inner = (
                <>
                  <span
                    className="mv-notif-dot"
                    style={{ background: dotColor(n.type) }}
                    aria-hidden="true"
                  />
                  <span className="min-w-0">
                    <span className="mv-notif-text">{n.title}</span>
                    <span className="mv-notif-time">{timeAgo(n.createdAt)}</span>
                  </span>
                </>
              );
              /*
               * הלחיצה גם מסמנת כנקראה — מיטבית: הניווט אינו מחכה
               * לסימון ואינו נכשל בגללו.
               */
              return (
                <Link
                  key={n.id}
                  href={href}
                  className="mv-notif-item"
                  style={{ opacity: n.readAt ? 0.6 : 1, textDecoration: "none", color: "inherit" }}
                  onClick={() => {
                    setOpen(false);
                    if (!n.readAt) {
                      void apiPatch(`/notifications/${n.id}/read`, {}).catch(() => undefined);
                      setUnread((u) => Math.max(0, u - 1));
                    }
                  }}
                >
                  {inner}
                </Link>
              );
            })
          )}
          <Link href="/notifications" className="mv-notif-all" onClick={() => setOpen(false)}>
            לכל ההתראות
          </Link>
        </div>
      ) : null}
    </div>
  );
}
