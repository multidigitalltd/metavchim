"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/api";

/**
 * באנר ההקמה בדשבורד — מוצג רק עד שהצעדים החיוניים הושלמו.
 *
 * הוא מציג את **הצעד הבא בלבד**, לא רשימה: משרד חדש שנתקל בשבע
 * משימות פותח מסך ריק ונוטש. משימה אחת עם הסבר קצר היא מה שגורם
 * ללחוץ.
 */

interface Step {
  key: string;
  title: string;
  why: string;
  href: string;
}

interface Progress {
  doneCount: number;
  totalCount: number;
  percent: number;
  nextStep?: Step;
  ready: boolean;
}

export function SetupBanner() {
  const [progress, setProgress] = useState<Progress | null>(null);

  useEffect(() => {
    apiGet<Progress>("/settings/onboarding")
      .then(setProgress)
      .catch(() => undefined);
  }, []);

  // הכול מוכן, או שאין צעד הבא — הבאנר נעלם לגמרי ולא הופך לרעש קבוע
  if (!progress || progress.ready || !progress.nextStep) return null;

  const next = progress.nextStep;

  return (
    <section
      aria-labelledby="setup-banner-title"
      className="mb-6 rounded-xl border p-4"
      style={{ borderColor: "var(--color-primary)", background: "var(--color-primary-soft)" }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="setup-banner-title" className="font-semibold">
            הצעד הבא בהקמה: {next.title}
          </h2>
          <p className="mt-1" style={{ color: "var(--color-text)" }}>
            {next.why}
          </p>
          <p className="mt-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
            הושלמו {progress.doneCount} מתוך {progress.totalCount} צעדים ·{" "}
            <Link href="/setup" className="underline">
              לרשימה המלאה
            </Link>
          </p>
        </div>
        <Link href={next.href} className="mv-button mv-button--primary">
          בואו נתחיל
        </Link>
      </div>
    </section>
  );
}
