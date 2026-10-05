"use client";

import Link from "next/link";
import { useRequireAuth } from "@/lib/use-auth";
import { TargetForm } from "../target-form";

export default function NewRecruitmentTargetPage() {
  const { user, loading: authLoading } = useRequireAuth();
  if (authLoading || !user) return null;
  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <nav className="mb-3 text-sm">
        <Link href="/properties/recruitment" className="underline underline-offset-2">
          נכסים לגיוס
        </Link>
      </nav>
      <h1 className="mb-1 text-2xl font-bold">נכס לגיוס חדש</h1>
      <p className="mb-5 text-sm text-[var(--color-text-muted)]">
        מלאו מה שידוע מהמודעה. אפשר להשלים אחר כך — הנכס נכנס למאגר רק אחרי הגיוס.
      </p>
      <TargetForm />
    </div>
  );
}
