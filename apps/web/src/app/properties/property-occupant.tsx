"use client";

import { useState, type FormEvent } from "react";
import { apiPatch, ApiError } from "@/lib/api";
import { waMeUrl } from "@/lib/format";
import { ContactPeople } from "../contact-people";
import { Notice } from "../notice";

/**
 * מי **גר** בנכס, כשזה אינו הבעלים.
 *
 * דירה שמושכרת בזמן שהיא מוצעת למכירה היא מצב רגיל לגמרי, ובו יש
 * שני אנשים שונים לגמרי: הבעלים מחליט על המכירה, והשוכר פותח את
 * הדלת. עד היום היה בכרטיס איש קשר אחד, ולכן המתווך החזיק את מספר
 * השוכר בטלפון הפרטי שלו או בהערה חופשית — כלומר **מחוץ להרשאות,
 * מחוץ להצפנה, ומחוץ למחיקת לקוח**. בקשת מחיקה של שוכר לא הייתה
 * מוצאת אותו שם.
 *
 * ## למה סעיף נפרד ולא עוד איש קשר בסעיף הבעלים
 *
 * ‎`ContactPeople` מוסיף אנשים **לאותו אדם** — בן/בת זוג, בן שמטפל
 * בהורים. שוכר אינו קרוב של הבעלים אלא צד אחר בעל תפקיד אחר, ומי
 * שיראה אותו ברשימת „אנשי הקשר של המוכר” עלול להתקשר אליו כדי לדבר
 * על המחיר. ההפרדה כאן היא בדיוק ההבחנה שצריכה להיות ברורה מהמסך.
 *
 * בתוך הסעיף עצמו `ContactPeople` כן משמש — לשני שוכרים שגרים יחד
 * ולמספר נוסף. שם ההיגיון נכון: זה אותו משק בית.
 */

export interface OccupantContact {
  id: string;
  name: string;
  phone: string;
  email?: string;
}

export function PropertyOccupant({
  propertyId,
  occupant,
  canEdit,
  canEditPeople,
  canErase,
  onChanged,
}: {
  propertyId: string;
  occupant?: OccupantContact;
  /** שיוך דייר לנכס — `PATCH /properties/:id`, כלומר `properties.edit`. */
  canEdit: boolean;
  /** עריכת אנשי הקשר והטלפונים — `buyers.edit`, כמו בסעיף הבעלים. */
  canEditPeople: boolean;
  /** `contacts.delete` — מחיקת השוכר לבקשתו, מתוך כרטיס הנכס. */
  canErase: boolean;
  onChanged: () => void;
}): React.JSX.Element {
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await apiPatch(`/properties/${propertyId}`, {
        occupantName: String(form.get("occupantName") ?? "").trim(),
        occupantPhone: String(form.get("occupantPhone") ?? "").trim(),
      });
      setAdding(false);
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "שמירת פרטי הדייר נכשלה");
    } finally {
      setBusy(false);
    }
  }

  /**
   * „הדירה התפנתה” — ניתוק ולא מחיקה.
   *
   * הכרטיס של השוכר נשאר במאגר: הוא אדם שהמשרד מכיר, ואולי הוא
   * עצמו מחפש עכשיו דירה. מה שמתנתק הוא הקשר לנכס הזה.
   */
  async function clear(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await apiPatch(`/properties/${propertyId}`, { occupantCleared: true });
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "הסרת הדייר נכשלה");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mv-list-card px-5 py-[17px]" aria-labelledby="occupant-heading">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="occupant-heading" className="m-0" style={{ fontSize: 16.5, fontWeight: 800 }}>
          מי גר בנכס
        </h2>
        {occupant ? (
          <a
            href={waMeUrl(occupant.phone)}
            target="_blank"
            rel="noopener noreferrer"
            className="mv-btn-plain"
          >
            וואטסאפ
          </a>
        ) : null}
      </div>

      {error ? <Notice tone="danger">{error}</Notice> : null}

      {occupant ? (
        <>
          <p className="m-0 text-sm">
            <strong>{occupant.name}</strong>
            {" · "}
            <a href={`tel:${occupant.phone}`} className="underline" dir="ltr">
              {occupant.phone}
            </a>
            {occupant.email ? (
              <>
                {" · "}
                <a href={`mailto:${occupant.email}`} className="underline" dir="ltr">
                  {occupant.email}
                </a>
              </>
            ) : null}
          </p>
          {/*
            המשפט הזה אינו קישוט. סעיף שנראה כמו סעיף הבעלים ויושב
            לידו מזמין בדיוק את הטעות שהוא בא למנוע — שיחה על המחיר
            עם מי שאינו הצד שמחליט עליו.
          */}
          <p className="m-0 mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
            שוכר — לתיאום ביקור בלבד. הצד שמחליט על העסקה הוא בעל הנכס.
          </p>
          <ContactPeople contactId={occupant.id} canEdit={canEditPeople} canErase={canErase} />
          {canEdit ? (
            <button
              type="button"
              className="mv-btn-plain mt-2"
              disabled={busy}
              onClick={() => void clear()}
            >
              {busy ? "מסיר…" : "הדירה התפנתה"}
            </button>
          ) : null}
        </>
      ) : adding ? (
        <form onSubmit={(e) => void save(e)} className="max-w-sm">
          <div className="mb-3">
            <label htmlFor="occupantName" className="mb-1 block text-sm font-semibold">
              שם השוכר
            </label>
            <input
              id="occupantName"
              name="occupantName"
              required
              minLength={2}
              maxLength={120}
              className="w-full rounded-lg border px-3 py-2.5"
              style={{ borderColor: "var(--color-input-border)", background: "var(--color-bg)" }}
            />
          </div>
          <div className="mb-3">
            <label htmlFor="occupantPhone" className="mb-1 block text-sm font-semibold">
              טלפון
            </label>
            <input
              id="occupantPhone"
              name="occupantPhone"
              dir="ltr"
              inputMode="tel"
              required
              placeholder="050-1234567"
              className="w-full rounded-lg border px-3 py-2.5"
              style={{ borderColor: "var(--color-input-border)", background: "var(--color-bg)" }}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="mv-btn-action" disabled={busy}>
              {busy ? "שומר…" : "שמור"}
            </button>
            <button type="button" className="mv-btn-plain" onClick={() => setAdding(false)}>
              ביטול
            </button>
          </div>
          <p className="m-0 mt-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
            אם המספר כבר קיים במערכת, הנכס יקושר לאותו אדם ולא ייווצר כרטיס כפול.
          </p>
        </form>
      ) : (
        <>
          <p className="m-0 mb-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
            הבעלים גר בנכס, או שאין דייר. אם הדירה מושכרת — הוסיפו את השוכר כדי
            שתיאום ביקור לא יעבור דרך פתק.
          </p>
          {canEdit ? (
            <button type="button" className="mv-btn-plain" onClick={() => setAdding(true)}>
              הוסף שוכר
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
