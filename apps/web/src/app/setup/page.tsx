"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/api";
import { useRequireAuth } from "@/lib/use-auth";

/**
 * "מה נשאר להפעיל" — מסך הקליטה של משרד חדש.
 *
 * הרשימה מסבירה לכל צעד *למה הוא שווה את הזמן*, ולא רק מה לעשות.
 * מתווך לא מפעיל פיצ'ר כי יש לו ✓ חסר; הוא מפעיל אותו כשהוא מבין
 * מה זה חוסך לו.
 */

interface Step {
  key: string;
  title: string;
  why: string;
  href: string;
  done: boolean;
  essential: boolean;
}

interface Progress {
  steps: Step[];
  doneCount: number;
  totalCount: number;
  percent: number;
  ready: boolean;
}

export default function SetupPage() {
  const { loading: authLoading } = useRequireAuth();
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    apiGet<Progress>("/settings/onboarding")
      .then(setProgress)
      .catch(() => setError("טעינת מצב ההקמה נכשלה"));
  }, [authLoading]);

  if (error) {
    return (
      <p role="alert" style={{ color: "var(--color-danger)" }}>
        {error}
      </p>
    );
  }
  if (!progress) return <p aria-live="polite">טוען…</p>;

  return (
    <>
      <h1 className="mb-1 text-2xl font-bold">הקמת המשרד</h1>
      <p className="mb-6" style={{ color: "var(--color-text-muted)" }}>
        {progress.ready
          ? "המערכת מוכנה לעבודה. הצעדים שנשארו מוסיפים יכולות, אבל אפשר להתחיל כבר עכשיו."
          : "כמה דקות של הקמה, ואחר כך המערכת עובדת בשבילכם."}
      </p>

      <div
        className="mb-6 rounded-xl border p-4"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="font-medium">
            הושלמו {progress.doneCount} מתוך {progress.totalCount}
          </span>
          <span style={{ color: "var(--color-text-muted)" }}>{progress.percent}%</span>
        </div>
        <div
          role="progressbar"
          aria-valuenow={progress.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="התקדמות ההקמה"
          className="h-2 w-full overflow-hidden rounded-full"
          style={{ background: "var(--color-border)" }}
        >
          <div
            className="h-full rounded-full"
            style={{ width: `${progress.percent}%`, background: "var(--color-primary)" }}
          />
        </div>
      </div>

      <ul className="flex flex-col gap-3">
        {progress.steps.map((step) => (
          <li
            key={step.key}
            className="rounded-xl border p-4"
            style={{
              borderColor: step.done ? "var(--color-success)" : "var(--color-border)",
              background: "var(--color-surface)",
            }}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold">
                  <span aria-hidden="true">{step.done ? "✓ " : "○ "}</span>
                  {step.title}
                  {step.essential && !step.done ? (
                    <span className="ms-2 text-sm font-normal" style={{ color: "var(--color-danger)" }}>
                      חיוני
                    </span>
                  ) : null}
                </h2>
                <p className="mt-1" style={{ color: "var(--color-text-muted)" }}>
                  {step.why}
                </p>
              </div>
              {step.done ? (
                <span className="text-sm" style={{ color: "var(--color-success)" }}>
                  הושלם
                </span>
              ) : (
                <Link href={step.href} className="mv-button mv-button--secondary">
                  להגדרה
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
