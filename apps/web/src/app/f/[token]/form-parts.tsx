/**
 * חלקי הטופס הציבורי — משותפים לשני הצדדים.
 *
 * הופרדו מ-`page.tsx` כשנוסף מסלול המוכר: שני הטפסים חייבים להיראות
 * אותו דבר, ועותק שני של המעטפת היה נפרד ממנו בעריכה הראשונה.
 */

import type { ReactNode } from "react";

export function Shell({
  officeName,
  children,
}: {
  officeName?: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-xl px-4 py-8">
      {officeName !== undefined ? (
        <p
          className="m-0 mb-4 text-center text-[length:var(--type-body-sm)] font-bold"
          style={{ color: "var(--color-primary)" }}
        >
          {officeName}
        </p>
      ) : null}
      <div
        className="rounded-2xl border p-6"
        style={{
          borderColor: "var(--color-border)",
          background: "var(--color-surface)",
        }}
      >
        {children}
      </div>
    </main>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-6">
      <h2 className="m-0 mb-1 text-[length:calc(16.5/16*1rem)] font-bold">{label}</h2>
      {hint !== undefined ? (
        <p
          className="m-0 mb-2 text-[length:var(--type-caption)]"
          style={{ color: "var(--color-text-muted)" }}
        >
          {hint}
        </p>
      ) : null}
      {children}
    </section>
  );
}

export function Choice({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="mv-chip"
      aria-pressed={active}
      onClick={onClick}
      style={{
        borderColor: active ? "var(--color-primary)" : "var(--color-input-border)",
        background: active ? "var(--color-primary)" : "var(--color-surface)",
        color: active ? "var(--color-surface)" : "var(--color-text)",
      }}
    >
      {children}
    </button>
  );
}
