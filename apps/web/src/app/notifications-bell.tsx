"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { apiGet } from "@/lib/api";

const POLL_MS = 30_000;

/** פעמון התראות עם מונה שלא-נקראו — Polling עדין; ישודרג ל-WebSocket. */
export function NotificationsBell() {
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (pathname === "/login" || pathname.startsWith("/offer/")) return;
    let cancelled = false;
    const load = () => {
      apiGet<{ unreadCount: number }>("/notifications?limit=1")
        .then((res) => {
          if (!cancelled) setUnread(res.unreadCount);
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

  return (
    <Link
      href="/notifications"
      className="relative inline-flex min-h-11 items-center rounded-md px-3 py-2"
      aria-label={unread > 0 ? `התראות — ${unread} חדשות` : "התראות"}
    >
      <span aria-hidden="true">🔔</span>
      {unread > 0 ? (
        <span
          aria-hidden="true"
          className="absolute -top-0.5 start-1 rounded-full px-1.5 text-xs font-bold"
          style={{ background: "var(--color-danger)", color: "#ffffff" }}
        >
          {unread > 9 ? "9+" : unread}
        </span>
      ) : null}
    </Link>
  );
}
