"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiGet } from "@/lib/api";
import { useRequireAuth } from "@/lib/use-auth";
import { TargetForm, type TargetValues } from "../target-form";

export default function EditRecruitmentTargetPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [target, setTarget] = useState<TargetValues | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (typeof id !== "string") return;
    apiGet<TargetValues>(`/recruitment/${id}`)
      .then(setTarget)
      .catch(() => setMissing(true));
  }, [id]);

  if (authLoading || !user) return null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <nav className="mb-3 text-sm">
        <Link href="/properties/recruitment" className="underline underline-offset-2">
          נכסים לגיוס
        </Link>
      </nav>
      <h1 className="mb-5 text-2xl font-bold">עריכת נכס לגיוס</h1>
      {missing ? (
        <p role="alert" className="mv-card p-5">
          הנכס לגיוס לא נמצא — ייתכן שנמחק.
        </p>
      ) : target === null ? (
        <p className="text-sm text-[var(--color-text-muted)]">טוען…</p>
      ) : (
        <TargetForm initial={target} />
      )}
    </div>
  );
}
