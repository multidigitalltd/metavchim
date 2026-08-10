"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@metavchim/ui";
import { api, apiGet } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useRequireAuth } from "@/lib/use-auth";

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
  readAt?: string;
  createdAt: string;
}

function entityHref(n: NotificationRow): string | null {
  if (!n.entityType || !n.entityId) return null;
  switch (n.entityType) {
    case "property":
      return `/properties/${n.entityId}`;
    case "lead":
      return `/leads/${n.entityId}`;
    case "offer":
      return null; // הצעה נצפית דרך כרטיס הנכס
    case "shared_lead":
      return "/collaboration"; // "נמכר" מוצג בשוק הלידים
    default:
      return null;
  }
}

export default function NotificationsPage() {
  const { loading: authLoading } = useRequireAuth();
  const [items, setItems] = useState<NotificationRow[] | null>(null);

  useEffect(() => {
    if (authLoading) return;
    apiGet<{ items: NotificationRow[] }>("/notifications?limit=50")
      .then((res) => setItems(res.items))
      .catch(() => setItems([]));
  }, [authLoading]);

  async function markAllRead() {
    await api("/notifications/read-all", { method: "PATCH" });
    setItems((prev) =>
      prev ? prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) : prev,
    );
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">התראות</h1>
        <Button variant="secondary" onClick={() => void markAllRead()}>
          סמן הכל כנקרא
        </Button>
      </div>

      {items === null ? (
        <p aria-live="polite">טוען…</p>
      ) : items.length === 0 ? (
        <p style={{ color: "var(--color-text-muted)" }}>
          אין התראות עדיין — כשקונה יפתח הצעה או יגיע ליד חדש, תראו את זה כאן.
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {items.map((n) => {
            const href = entityHref(n);
            return (
              <li
                key={n.id}
                className="rounded-xl border p-4"
                style={{
                  borderColor: n.readAt ? "var(--color-border)" : "var(--color-primary)",
                  background: "var(--color-surface)",
                  opacity: n.readAt ? 0.75 : 1,
                }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-semibold">
                    {!n.readAt ? <span className="mv-visually-hidden">(חדש) </span> : null}
                    {n.title}
                  </h2>
                  <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                    {formatDate(n.createdAt)}
                  </span>
                </div>
                {n.body ? <p style={{ color: "var(--color-text-muted)" }}>{n.body}</p> : null}
                {href ? (
                  <Link href={href} className="mt-1 inline-block underline">
                    מעבר לטיפול
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
