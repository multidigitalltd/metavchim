"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/api";

/**
 * הבלעדיויות שדורשות פעולה — **ורק הן.**
 *
 * בלעדיות בתוקף שהכול בסדר איתה אינה צריכה שורה במסך: היא תופסת
 * מקום ומלמדת את העין לדלג. מוצגות כאן רק שלוש הקטגוריות שיש בהן
 * מה לעשות היום — חסרות פעולות שיווק לפני מועד השליש, מסתיימת
 * בקרוב, או שכבר הסתיימה בלי שאיש שם לב.
 *
 * כשאין כאלה הרכיב אינו מצייר דבר, ולא "הכול תקין" — הודעה כזו היא
 * עוד שורה לקרוא בלי שקרה בה משהו.
 */

interface WatchItem {
  id: string;
  propertyId: string;
  propertyTitle: string;
  phase: "active" | "at_risk" | "ended_by_third_rule" | "expired";
  daysLeft: number;
  missing: number;
  summary: string;
}

/** מעל זה הבלעדיות רחוקה מספיק כדי שלא תופיע בשורת ההתראה. */
const SOON_DAYS = 30;

const TONE: Record<WatchItem["phase"], string> = {
  active: "var(--color-warning)",
  at_risk: "var(--color-warning)",
  ended_by_third_rule: "var(--color-danger)",
  expired: "var(--color-text-muted)",
};

export function ExclusivityWatch() {
  const [items, setItems] = useState<WatchItem[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await apiGet<{ items: WatchItem[] }>("/exclusivity");
        setItems(
          res.items.filter(
            (item) =>
              item.phase === "ended_by_third_rule" ||
              item.missing > 0 ||
              (item.phase === "active" && item.daysLeft <= SOON_DAYS),
          ),
        );
      } catch {
        /* שקט בכוונה: זו שורת עזר, ולא סיבה להכשיל את מסך הנכסים */
      }
    })();
  }, []);

  if (items.length === 0) return null;

  return (
    <section
      className="mv-list-card mb-3 px-[22px] py-[14px]"
      aria-labelledby="exclusivity-watch-heading"
    >
      <h2
        id="exclusivity-watch-heading"
        className="m-0 mb-1.5"
        style={{ fontSize: 15, fontWeight: 800 }}
      >
        בלעדיויות שדורשות טיפול
      </h2>
      <ul className="m-0 list-none p-0">
        {items.slice(0, 8).map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-baseline gap-2 border-b py-1.5 text-[length:var(--type-caption-lg)] last:border-b-0"
            style={{ borderColor: "var(--color-border)" }}
          >
            <Link href={`/properties/${item.propertyId}`} className="font-semibold">
              {item.propertyTitle}
            </Link>
            <span style={{ color: TONE[item.phase] }}>{item.summary}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
