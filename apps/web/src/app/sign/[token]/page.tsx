"use client";

import { use, useEffect, useState, type FormEvent } from "react";
import { Button } from "@metavchim/ui";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { SignaturePad } from "./signature-pad";
import { Notice } from "../../notice";

/**
 * חתימה על הסכם — דף ציבורי ללקוח, בלי התחברות. הטוקן שבקישור הוא
 * המפתח היחיד, ופוליסת ה-RLS חושפת רק את השורה שלו.
 *
 * הדף מציג את הנוסח כפי שנשמר ברגע השליחה (לא נטען מחדש מהתבנית),
 * וכך מה שנחתם הוא בדיוק מה שהוצג.
 */

interface AgreementView {
  kind: string;
  kindLabel: string;
  officeName: string;
  body: string;
  status: string;
  signedAt?: string;
  signerName?: string;
  bodyHash: string;
}

const inputStyle = { borderColor: "var(--color-border)", background: "var(--color-field)" } as const;

export default function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [view, setView] = useState<AgreementView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [signedAt, setSignedAt] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);

  useEffect(() => {
    apiGet<AgreementView>(`/public/agreements/${token}`)
      .then((res) => {
        setView(res);
        if (res.status === "signed") setSignedAt(res.signedAt ?? "");
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof ApiError ? err.message : "טעינת ההסכם נכשלה");
      });
  }, [token]);

  async function onSign(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    /*
     * ההצהרה נקראת מהתיבה עצמה ולא נשלחת כ-true קבוע.
     *
     * קודם היא נשלחה תמיד כ-true, והטופס גם ויתר על ולידציית הדפדפן
     * (noValidate) — כך שלחיצה רגילה חתמה על ההסכם בלי שהחותם אישר
     * דבר, והשרת רשם אישור שמעולם לא ניתן. בהסכם שכל ערכו הוא ראייתי
     * זה מרוקן את החתימה מתוכן (ביקורת Codex).
     */
    const confirmed = form.get("confirmed") === "on";
    if (!confirmed) {
      setSubmitting(false);
      setError("יש לאשר את ההצהרה לפני החתימה");
      return;
    }
    /*
     * החתימה המצוירת נדרשת כאן ולא בשרת.
     *
     * בשרת היא רשות בכוונה — דפדפן בלי קנבס עדיין צריך לחתום, ומה
     * שמחייב את המסמך הוא ההצהרה, מספר הזהות והגיבוב. במסך היא כן
     * חובה: זה מה שהופך את המסמך למשהו שנראה חתום.
     */
    if (signature === null) {
      setSubmitting(false);
      setError("חתמו בשדה החתימה לפני השליחה");
      return;
    }
    try {
      const res = await apiPost<{ signedAt: string }>(`/public/agreements/${token}/sign`, {
        signerName: String(form.get("signerName")).trim(),
        signerIdNumber: String(form.get("signerIdNumber")).trim(),
        confirmed,
        signatureImage: signature,
      });
      setSignedAt(res.signedAt);
      /*
       * טעינה מחדש אחרי החתימה, ולא רק עדכון התאריך.
       *
       * ברגע החתימה השרת מכניס את מספר הזהות לגוף המסמך ומחשב מחדש
       * את הגיבוב. בלי הרענון הדף היה ממשיך להציג את הנוסח שלפני
       * החתימה ומציג את הגיבוב הישן כ"מזהה המסמך" — כלומר מספר
       * שאינו תואם את המסמך שנשמר (ביקורת Codex).
       */
      apiGet<AgreementView>(`/public/agreements/${token}`)
        .then(setView)
        .catch(() => undefined);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "החתימה נכשלה — נסו שוב");
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-2xl py-10">
        <Notice tone="danger">{loadError}</Notice>
      </div>
    );
  }

  if (!view) return <p aria-live="polite">טוען הסכם…</p>;

  return (
    <div className="mx-auto max-w-2xl py-6">
      <h1 className="mb-1 text-2xl font-bold">{view.kindLabel}</h1>
      <p className="mb-6" style={{ color: "var(--color-text-muted)" }}>
        {view.officeName}
      </p>

      <article
        className="mb-6 whitespace-pre-wrap rounded-xl border p-5 leading-relaxed"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      >
        {view.body}
      </article>

      {signedAt !== null ? (
        <div
          className="rounded-xl border p-5"
          style={{ borderColor: "var(--color-success)", background: "var(--color-surface)" }}
        >
          <p className="mb-2 text-lg font-semibold">✓ ההסכם נחתם</p>
          <p style={{ color: "var(--color-text-muted)" }}>
            {view.signerName ? `נחתם בידי ${view.signerName}. ` : ""}
            עותק ההסכם נשמר אצל המתווך.
          </p>
          {/* טביעת האצבע של הנוסח — מאפשרת לוודא בהמשך שהטקסט לא שונה */}
          <p className="mt-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
            מזהה מסמך: <code dir="ltr">{view.bodyHash.slice(0, 16)}</code>
          </p>
        </div>
      ) : (
        <form
          onSubmit={onSign}
          className="rounded-xl border p-5"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <h2 className="mb-3 text-lg font-semibold">חתימה</h2>

          {error ? (
            <Notice tone="danger">{error}</Notice>
          ) : null}

          <div className="mb-4">
            <label htmlFor="signerName" className="mb-1 block font-medium">
              שם מלא
            </label>
            <input
              id="signerName"
              name="signerName"
              required
              minLength={2}
              autoComplete="name"
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>

          <div className="mb-4">
            <label htmlFor="signerIdNumber" className="mb-1 block font-medium">
              תעודת זהות / דרכון
            </label>
            <input
              id="signerIdNumber"
              name="signerIdNumber"
              required
              inputMode="numeric"
              pattern="[0-9A-Za-z]{5,20}"
              dir="ltr"
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>

          <div className="mb-4">
            <SignaturePad onChange={setSignature} disabled={submitting} />
          </div>

          <label className="mb-4 flex items-start gap-2">
            <input type="checkbox" name="confirmed" required className="mt-1.5" />
            <span>
              קראתי את ההסכם, הבנתי את תוכנו, ואני חותם עליו מרצוני החופשי. ידוע לי
              שהחתימה האלקטרונית מחייבת אותי כמו חתימה בכתב יד.
            </span>
          </label>

          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "חותם…" : "אני חותם על ההסכם"}
          </Button>

          <p className="mt-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
            לצורך תיעוד החתימה יישמרו מועד החתימה, כתובת ה-IP וסוג הדפדפן שממנו
            נחתם ההסכם.
          </p>
        </form>
      )}
    </div>
  );
}
