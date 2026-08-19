"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiDelete, apiGet } from "@/lib/api";
import { Notice } from "../notice";

/**
 * מחיקת כרטיס קונה — ארכיון או לצמיתות.
 *
 * **שני שלבים, ובכוונה.** ארכיון הוא ברירת המחדל: "הלקוח כבר לא
 * מחפש" אינו "הלקוח מעולם לא היה", וההיסטוריה שווה משהו. מחיקה
 * לצמיתות פתוחה רק מכרטיס שכבר בארכיון — מי שמגיע אליה כבר החליט
 * פעם אחת, וכרטיס פעיל אינו נעלם בלחיצה בודדת.
 *
 * לפני שתי הפעולות השרת אומר מה תלוי בכרטיס. מנהל שמוחק כרטיס עם
 * שלוש הצעות פתוחות זכאי לדעת את זה לפני, לא אחרי.
 *
 * **הלקוח עצמו אינו נמחק כאן.** הכרטיס הוא הביקוש; האדם נשאר, עם
 * הלידים וההיסטוריה שלו. מחיקת האדם היא פעולה אחרת ובמקום אחר.
 */

interface DeletionPreview {
  matches: number;
  offers: number;
  interactions: number;
  appointments: number;
  sharedDemands: number;
  archived: boolean;
}

function lines(preview: DeletionPreview): string[] {
  const out: string[] = [];
  const add = (n: number, one: string, many: string): void => {
    if (n > 0) out.push(n === 1 ? one : `${n} ${many}`);
  };
  add(preview.matches, "התאמה אחת", "התאמות");
  add(preview.offers, "הצעה אחת שנשלחה", "הצעות שנשלחו");
  add(preview.interactions, "רישום אחד בציר הזמן", "רישומים בציר הזמן");
  add(preview.sharedDemands, "ביקוש אחד ברשת", "ביקושים ברשת");
  return out;
}

export function DeleteBuyer({ buyerId }: { buyerId: string }) {
  const router = useRouter();
  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setError(null);
    setBusy(true);
    try {
      setPreview(await apiGet<DeletionPreview>(`/buyers/${buyerId}/deletion-preview`));
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "טעינת פרטי המחיקה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function run(permanent: boolean) {
    setError(null);
    setBusy(true);
    try {
      await apiDelete(`/buyers/${buyerId}${permanent ? "/permanent" : ""}`);
      router.push("/buyers");
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "הפעולה נכשלה");
      setBusy(false);
    }
  }

  if (preview === null) {
    return (
      <div>
        <button type="button" className="mv-btn-plain" disabled={busy} onClick={() => void open()}>
          <span style={{ color: "var(--color-danger)" }}>מחיקת הכרטיס</span>
        </button>
        {error !== null ? (
          <Notice tone="danger">{error}</Notice>
        ) : null}
      </div>
    );
  }

  const items = lines(preview);
  return (
    <div
      className="rounded-xl border p-3"
      style={{ borderColor: "var(--color-danger)", background: "var(--color-bg)" }}
    >
      <p className="m-0 mb-2 text-sm font-semibold">
        {preview.archived ? "הכרטיס בארכיון" : "מחיקת כרטיס הקונה"}
      </p>
      <p className="m-0 mb-2 text-[14.5px]">
        {items.length > 0 ? `תלויים בכרטיס: ${items.join(" · ")}.` : "אין תוכן מקושר לכרטיס."}
        {preview.appointments > 0
          ? ` ${preview.appointments === 1 ? "פגישה אחת תישאר" : `${preview.appointments} פגישות יישארו`} ביומן, בלי הקישור לכרטיס.`
          : ""}
      </p>

      {!preview.archived ? (
        <p className="m-0 mb-2 text-[14.5px]" style={{ color: "var(--color-text-muted)" }}>
          <b>ארכיון</b> מוריד את הכרטיס מהרשימות ומההתאמות ושומר את ההיסטוריה — אפשר
          למחוק לצמיתות אחר כך. זו הפעולה המומלצת.
        </p>
      ) : (
        <p className="m-0 mb-2 text-[14.5px]" style={{ color: "var(--color-danger)" }}>
          מחיקה לצמיתות אינה הפיכה. הלקוח עצמו והלידים שלו יישארו — נמחק רק הכרטיס הזה.
        </p>
      )}

      {error !== null ? (
        <Notice tone="danger">{error}</Notice>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {!preview.archived ? (
          <button
            type="button"
            className="mv-btn-action"
            disabled={busy}
            onClick={() => void run(false)}
          >
            העבר לארכיון
          </button>
        ) : (
          <button
            type="button"
            className="mv-btn-action"
            disabled={busy}
            onClick={() => void run(true)}
          >
            מחק לצמיתות
          </button>
        )}
        <button type="button" className="mv-btn-plain" onClick={() => setPreview(null)}>
          ביטול
        </button>
      </div>
    </div>
  );
}
