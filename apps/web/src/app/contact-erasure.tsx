"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiDelete, apiGet } from "@/lib/api";
import { IconWarning } from "./icons";

/**
 * מחיקת לקוח מהמערכת — זכות המחיקה שלו.
 *
 * לקוח שמבקש מהמשרד לא להחזיק עליו מידע זכאי לכך, והמשרד צריך שזה
 * ייקח לו לחיצה — לא פנייה לתמיכה, ולא תקווה שמישהו יזכור למחוק גם
 * את ההקלטות. הרכיב יושב בתוך כרטיס הלקוח, כלומר בכל מקום שבו
 * רואים את האדם: כרטיס קונה, כרטיס ליד וכרטיס בעל נכס.
 *
 * שני שלבים ולא אחד, ובכוונה: השרת אומר קודם **מה בדיוק יימחק**,
 * ורק אז מקלידים את השם. הסכם חתום שנמחק הוא גם הזכאות של המתווך
 * לדמי התיווך, ומנהל שמגלה את זה אחרי הלחיצה גילה מאוחר מדי.
 */

interface ErasurePreview {
  buyers: number;
  leads: number;
  calls: number;
  recordings: number;
  messages: number;
  agreements: number;
  signedAgreements: number;
  appointments: number;
  properties: number;
  sharedListings: number;
  linkedPeople: number;
}

/** שורות התצוגה — רק מה שבאמת קיים, כדי שהאזהרה תישאר קריאה. */
function lines(preview: ErasurePreview): string[] {
  const out: string[] = [];
  const add = (n: number, one: string, many: string): void => {
    if (n > 0) out.push(n === 1 ? one : `${n} ${many}`);
  };
  add(preview.buyers, "כרטיס קונה אחד", "כרטיסי קונה");
  add(preview.leads, "ליד אחד", "לידים");
  add(preview.appointments, "פגישה אחת", "פגישות ומשימות");
  add(preview.calls, "שיחה אחת", "שיחות");
  add(preview.recordings, "הקלטה אחת", "הקלטות");
  add(preview.messages, "הודעה אחת", "הודעות");
  add(preview.agreements, "הסכם אחד", "הסכמים");
  add(preview.sharedListings, "פרסום אחד ברשת", "פרסומים ברשת");
  add(preview.linkedPeople, "אדם מקושר אחד", "אנשים מקושרים");
  return out;
}

export function ContactErasure({
  contactId,
  name,
}: {
  contactId: string;
  /** שם הלקוח — מוצג באזהרה, וזה מה שצריך להקליד לאישור. */
  name: string;
}) {
  const router = useRouter();
  const [preview, setPreview] = useState<ErasurePreview | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setError(null);
    setBusy(true);
    try {
      setPreview(await apiGet<ErasurePreview>(`/contacts/${contactId}/erasure-preview`));
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "טעינת פרטי המחיקה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function erase() {
    setError(null);
    setBusy(true);
    try {
      await apiDelete(`/contacts/${contactId}`, { confirmName: typed });
      /*
       * חזרה לדשבורד ולא רענון: המסך שאנחנו עומדים בו הוא כרטיס של
       * ליד או קונה שהרגע נמחק, ורענון שלו היה מציג שגיאת "לא נמצא".
       */
      router.push("/");
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "המחיקה נכשלה");
      setBusy(false);
    }
  }

  if (preview === null) {
    return (
      <div className="mt-3 border-t pt-2" style={{ borderColor: "var(--color-border)" }}>
        <button type="button" className="mv-btn-plain" disabled={busy} onClick={() => void open()}>
          <span style={{ color: "var(--color-danger)" }}>מחיקת הלקוח מהמערכת</span>
        </button>
        <p className="m-0 mt-1 text-xs" style={{ color: "var(--color-text-muted)" }}>
          לבקשת הלקוח — מוחק את כל המידע שהמשרד מחזיק עליו, לצמיתות.
        </p>
        {error ? (
          <p role="alert" className="m-0 mt-2 text-sm" style={{ color: "var(--color-danger)" }}>
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  const items = lines(preview);
  return (
    <div
      className="mt-3 rounded-xl border p-3"
      style={{ borderColor: "var(--color-danger)", background: "var(--color-bg)" }}
    >
      <p className="m-0 mb-2 text-sm font-semibold">
        <IconWarning s={16} /> מחיקת {name} מהמערכת — אי אפשר לשחזר
      </p>
      {items.length > 0 ? (
        <p className="m-0 mb-2 text-[13px]">יימחקו: {items.join(" · ")}.</p>
      ) : (
        <p className="m-0 mb-2 text-[13px]">לכרטיס הזה אין עדיין תוכן מקושר — יימחק הכרטיס עצמו.</p>
      )}
      {/*
        ההסכם החתום מקבל שורה משלו ולא נבלע ברשימה: זה הפריט היחיד
        שמחיקתו פוגעת במשרד ולא רק מוחקת מידע.
      */}
      {preview.signedAgreements > 0 ? (
        <p className="m-0 mb-2 text-[13px]" style={{ color: "var(--color-danger)" }}>
          <b>
            שימו לב: {preview.signedAgreements === 1
              ? "הסכם חתום אחד"
              : `${preview.signedAgreements} הסכמים חתומים`}
          </b>{" "}
          יימחקו יחד עם החתימה ומספר הזהות שבהם. זהו גם המסמך שמבסס את הזכאות לדמי
          התיווך.
        </p>
      ) : null}
      {preview.properties > 0 ? (
        <p className="m-0 mb-2 text-[13px]" style={{ color: "var(--color-text-muted)" }}>
          {preview.properties === 1 ? "הנכס שבבעלותו יישאר" : "הנכסים שבבעלותו יישארו"} במאגר
          המשרד, בלי הקישור אליו ובלי פרטיו.
        </p>
      ) : null}

      <label className="block">
        <span className="mb-1 block text-xs font-semibold">לאישור, הקלידו את שם הלקוח:</span>
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={name}
          className="mv-field"
          autoComplete="off"
        />
      </label>

      {error ? (
        <p role="alert" className="m-0 mt-2 text-sm" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className="mv-btn-action"
          disabled={busy || typed.trim() === ""}
          onClick={() => void erase()}
        >
          מחק לצמיתות
        </button>
        <button
          type="button"
          className="mv-btn-plain"
          onClick={() => {
            setPreview(null);
            setTyped("");
            setError(null);
          }}
        >
          ביטול
        </button>
      </div>
    </div>
  );
}
