"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { afterLoginTarget } from "@metavchim/shared";
import { apiPost, ApiError } from "@/lib/api";
import { clearSessionCache } from "@/lib/session-cache";
import { AuthShell } from "../auth-shell";
import { Notice } from "../notice";


/** החלפת סיסמה — חובה בכניסה ראשונה עם סיסמה זמנית (ביקורת Codex). */
function ChangePasswordForm() {
  const router = useRouter();
  /*
   * המסך הזה הוא תחנת ביניים בדרך פנימה, ולכן הוא מחזיר לאן שביקשו
   * ולא תמיד ללוח הבקרה: מקבל הצעה שנכנס בפעם הראשונה חוזר ללינק
   * שבגללו הגיע. אותה רשימת היתר בדיוק כמו במסך ההתחברות.
   */
  const target = afterLoginTarget(useSearchParams().get("next"));
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
      /*
       * בלי הניקוי הזה נוצרת לולאה: המטמון עדיין נושא
       * `mustChangePassword: true`, ולכן המסך הבא מפנה חזרה לכאן —
       * עד שהתפוגה חולפת. ראו session-cache.
       */
      clearSessionCache();
      router.replace(target);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "החלפת הסיסמה נכשלה");
      setSubmitting(false);
    }
  }

  return (
    <form method="post" onSubmit={(e) => void onSubmit(e)} noValidate>
        {error ? (
          <Notice tone="danger">{error}</Notice>
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
  );
}

/* `useSearchParams` דורש גבול Suspense כדי שהמסך לא ייצא מהרינדור
   הסטטי — אותו דפוס בדיוק כמו במסך ההתחברות. */
export default function ChangePasswordPage() {
  return (
    <AuthShell
      title="בחירת סיסמה חדשה"
      subtitle="לפני שממשיכים — החליפו את הסיסמה הזמנית בסיסמה קבועה משלכם."
      points={["הסיסמה הזמנית תפוג ברגע שתשמרו", "בחרו סיסמה שרק אתם מכירים", "אפשר לשנות אותה שוב מהפרופיל"]}
    >
      <Suspense fallback={<p aria-live="polite">טוען…</p>}>
        <ChangePasswordForm />
      </Suspense>
    </AuthShell>
  );
}
