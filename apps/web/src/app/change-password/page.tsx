"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { apiPost, ApiError } from "@/lib/api";
import { AuthShell } from "../auth-shell";


/** החלפת סיסמה — חובה בכניסה ראשונה עם סיסמה זמנית (ביקורת Codex). */
export default function ChangePasswordPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const f = new FormData(event.currentTarget);
    const newPassword = String(f.get("newPassword"));
    if (newPassword !== String(f.get("confirm"))) {
      setError("הסיסמאות אינן תואמות");
      return;
    }
    setSubmitting(true);
    try {
      await apiPost("/auth/change-password", {
        currentPassword: String(f.get("currentPassword")),
        newPassword,
      });
      router.replace("/");
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "החלפת הסיסמה נכשלה");
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      title="בחירת סיסמה חדשה"
      subtitle="לפני שממשיכים — החליפו את הסיסמה הזמנית בסיסמה קבועה משלכם."
      points={["הסיסמה הזמנית תפוג ברגע שתשמרו", "בחרו סיסמה שרק אתם מכירים", "אפשר לשנות אותה שוב מהפרופיל"]}
    >
      <form method="post" onSubmit={(e) => void onSubmit(e)} noValidate>
        {error ? (
          <p role="alert" className="mb-4 rounded-lg border p-3" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}>
            {error}
          </p>
        ) : null}
        <div className="mb-4">
          <label htmlFor="currentPassword" className="mb-1 block font-medium">הסיסמה הזמנית</label>
          <input id="currentPassword" name="currentPassword" type="password" required dir="ltr" autoComplete="current-password" className="mv-auth-input" />
        </div>
        <div className="mb-4">
          <label htmlFor="newPassword" className="mb-1 block font-medium">סיסמה חדשה <span className="font-normal">(10 תווים לפחות)</span></label>
          <input id="newPassword" name="newPassword" type="password" required minLength={10} dir="ltr" autoComplete="new-password" className="mv-auth-input" />
        </div>
        <div className="mb-6">
          <label htmlFor="confirm" className="mb-1 block font-medium">אימות סיסמה</label>
          <input id="confirm" name="confirm" type="password" required minLength={10} dir="ltr" autoComplete="new-password" className="mv-auth-input" />
        </div>
        <button type="submit" disabled={submitting} className="mv-auth-submit">
        {submitting ? "שומר…" : "שמור והמשך"}
      </button>
      </form>
    </AuthShell>
  );
}
