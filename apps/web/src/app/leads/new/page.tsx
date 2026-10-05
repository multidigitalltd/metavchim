"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@metavchim/ui";
import { safeReturnPath, withQuery } from "@metavchim/shared";
import { LEAD_SOURCE_LABELS } from "@/lib/lead-labels";
import { apiPost, ApiError } from "@/lib/api";
import { useRequireAuth } from "@/lib/use-auth";
import { DictateFor } from "../../dictation-field";
import { Notice } from "../../notice";

const inputStyle = { borderColor: "var(--color-input-border)", background: "var(--color-field)" } as const;

function NewLeadForm() {
  useRequireAuth();
  const router = useRouter();
  /*
   * ‎**מאיפה הגיעו לכאן, וכשיש לאן — לשם חוזרים.**
   *
   * טופס הפגישה שולח לכאן את מי שגילה באמצע שהלקוח עוד אינו
   * במערכת, ומצפה לקבל אותו חזרה עם הליד מקושר. הנתיב עובר דרך
   * ‎`safeReturnPath`: פרמטר הפניה שאינו נבדק הוא open redirect,
   * וכאן הוא היה מנחית סוכן טרי על מסך של מישהו אחר.
   */
  const params = useSearchParams();
  const returnTo = safeReturnPath(params.get("returnTo"));
  const [error, setError] = useState<string | null>(null);
  // הפנייה מוזגה לליד פתוח של סוכן אחר — אין לאן לנווט (view_own), רק מיידעים
  const [mergedNotice, setMergedNotice] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  /* המקור נשמר במצב כדי שתיבת „אחר” תדע מתי להיפתח */
  const [source, setSource] = useState("voice_call");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const f = new FormData(event.currentTarget);
    try {
      const created = await apiPost<{ id: string; merged?: boolean; visible?: boolean }>("/leads", {
        contactName: String(f.get("contactName")).trim(),
        contactPhone: String(f.get("contactPhone")).trim(),
        /* ריק לא נשלח — מחרוזת ריקה אינה כתובת, והסכימה מקפידה */
        contactEmail: String(f.get("contactEmail") ?? "").trim() || undefined,
        source: String(f.get("source")),
        /* ‏הפירוט נשלח רק כשבחרו „אחר” — ראו את התיבה שנפתחת מתחת */
        ...(String(f.get("source")) === "other" && String(f.get("sourceNote") ?? "").trim() !== ""
          ? { sourceNote: String(f.get("sourceNote")).trim() }
          : {}),
        intent: String(f.get("intent")),
        summary: String(f.get("summary") ?? "").trim() || undefined,
      });
      if (created.merged && created.visible === false) {
        /*
         * הליד הפתוח שייך לסוכן אחר — הפנייה נוספה אצלו והוא קיבל
         * התראה. **אין ליד לחזור אליו**, ולכן גם אין חזרה אוטומטית:
         * הודעה שנעלמת אחרי חצי שנייה בדרך למסך אחר היא הודעה
         * שאיש לא קרא, ומי שקבע סיור היה חוזר עם ליד מקושר שאינו
         * שלו.
         */
        setMergedNotice(true);
        setSubmitting(false);
        return;
      }
      if (returnTo !== null) {
        // חזרה לטופס הפגישה עם הליד שזה עתה נוצר כבר מקושר
        router.replace(withQuery(returnTo, "leadId", created.id));
        return;
      }
      // ליד פתוח כבר קיים לאיש הקשר — השרת מיזג את הפנייה אליו במקום לפצל
      router.replace(created.merged ? `/leads/${created.id}?merged=1` : `/leads/${created.id}`);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "שמירת הליד נכשלה");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-2 text-2xl font-bold">ליד חדש</h1>
      {returnTo === null ? null : (
        <p className="mb-4" style={{ color: "var(--color-text-muted)" }}>
          אחרי השמירה נחזור לטופס הפגישה, והליד כבר יהיה מקושר אליה.
        </p>
      )}
      <form onSubmit={onSubmit} noValidate>
        {mergedNotice ? (
          <Notice tone="success">ℹ️ לאיש הקשר כבר יש ליד פתוח אצל סוכן אחר במשרד — הפנייה נוספה לציר הזמן של הליד שלו והוא קיבל
            התראה. אין צורך לפתוח ליד חדש.</Notice>
        ) : null}
        {error ? (
          <Notice tone="danger">{error}</Notice>
        ) : null}

        <div className="mb-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="contactName" className="mb-1 block font-medium">שם מלא *</label>
            <input id="contactName" name="contactName" required minLength={2} className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
          </div>
          <div>
            <label htmlFor="contactPhone" className="mb-1 block font-medium">טלפון *</label>
            <input id="contactPhone" name="contactPhone" type="tel" required dir="ltr" placeholder="050-1234567" className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
          </div>
          {/*
            כמו בטופס הקונה: השירות ידע לשמור כתובת מאז ומתמיד — ייבוא
            מקובץ ופנייה מדף נחיתה כתבו אותה — ורק הטופס שהסוכן ממלא
            לא שאל.
          */}
          <div className="sm:col-span-2">
            <label htmlFor="contactEmail" className="mb-1 block font-medium">
              דוא&quot;ל{" "}
              <span className="font-normal" style={{ color: "var(--color-text-muted)" }}>
                (לא חובה)
              </span>
            </label>
            <input
              id="contactEmail"
              name="contactEmail"
              type="email"
              dir="ltr"
              autoComplete="email"
              placeholder="name@example.com"
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <div>
            <label htmlFor="intent" className="mb-1 block font-medium">מה הוא רוצה?</label>
            <select id="intent" name="intent" defaultValue="buy" className="w-full rounded-lg border px-3 py-2.5" style={inputStyle}>
              <option value="buy">לקנות</option>
              <option value="sell">למכור</option>
              <option value="rent_in">לשכור</option>
              <option value="rent_out">להשכיר</option>
              <option value="info">מתעניין</option>
              <option value="unknown">עוד לא ברור</option>
            </select>
          </div>
          <div>
            <label htmlFor="source" className="mb-1 block font-medium">מקור</label>
            {/*
              ‎**הרשימה נגזרת מהסכימה, ולא מוקלדת כאן.**

              ‏עד כה היו כאן חמש אפשרויות מוקלדות ידנית, ובהן „ידני”
              שהוצג בשם „אחר” — כלומר ערך שקיבל תווית של ערך אחר,
              ושתי אפשרויות אמיתיות (`landing`, `kanko`) שלא הופיעו
              כלל. גזירה מ-`LEAD_SOURCE_LABELS` פותרת את שניהם, וגם
              דואגת שמקור שיתווסף מחר יופיע כאן מעצמו.
            */}
            <select
              id="source"
              name="source"
              value={source}
              onChange={(event) => setSource(event.target.value)}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            >
              {Object.entries(LEAD_SOURCE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            {/* „אחר” בלי המשך אינו מידע — התיבה נפתחת רק עליו */}
            {source === "other" ? (
              <input
                name="sourceNote"
                maxLength={60}
                placeholder="איפה בדיוק? למשל: דוכן ביריד"
                aria-label="פירוט המקור"
                className="mt-2 w-full rounded-lg border px-3 py-2.5"
                style={inputStyle}
              />
            ) : null}
          </div>
        </div>

        <div className="mb-6">
          <label htmlFor="summary" className="mb-1 block font-medium">סיכום הפנייה</label>
          <textarea id="summary" name="summary" rows={3} maxLength={2000} placeholder="מה הוא סיפר? מה סוכם?" className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
          <DictateFor targetId="summary" />
        </div>

        <div className="flex gap-3">
          <Button type="submit" disabled={submitting}>{submitting ? "שומר…" : "שמור ליד"}</Button>
          <Button type="button" variant="ghost" onClick={() => router.back()}>ביטול</Button>
        </div>
      </form>
    </div>
  );
}

export default function NewLeadPage() {
  // ‎`useSearchParams` דורש גבול Suspense, אחרת כל המסלול יוצא
  // מהרינדור המוקדם
  return (
    <Suspense fallback={<p aria-live="polite">טוען…</p>}>
      <NewLeadForm />
    </Suspense>
  );
}
