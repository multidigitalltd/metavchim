"use client";

import { useState, type FormEvent } from "react";
import { apiPatch, ApiError } from "@/lib/api";
import { waMeUrl } from "@/lib/format";
import { ContactPeople } from "../contact-people";
import { IconChat } from "../icons";

/**
 * בעל הנכס — המוכר או המשכיר.
 *
 * עד כה הוא הופיע כשורה אחת מתחת לכתובת: שם וטלפון, בלי אימייל, בלי
 * בן/בת זוג, ובלי מספר שני. בפועל הוא צד לעסקה בדיוק כמו הקונה,
 * ולרוב יש לו בדיוק אותם מאפיינים — דירה בבעלות משותפת, בן שמטפל
 * בהורים, מספר בית ומספר נייד.
 *
 * הפתרון אינו רכיב חדש אלא אותו רכיב: `ContactPeople` שכבר משרת את
 * כרטיס הקונה. אדם הוא אדם, ואין סיבה ששתי מערכות יתחזקו את אותו
 * דבר בשתי דרכים.
 */

export interface OwnerContact {
  id: string;
  name: string;
  phone: string;
  email?: string;
}

export function PropertyOwner({
  propertyId,
  owner,
  canEdit,
  canEditPeople,
  onChanged,
  canSendUpdate,
  onSendUpdate,
}: {
  propertyId: string;
  owner?: OwnerContact;
  /** שיוך בעלים לנכס — `PATCH /properties/:id`, כלומר `properties.edit`. */
  canEdit: boolean;
  /**
   * עריכת אנשי הקשר והטלפונים — `buyers.edit`, ולא אותה יכולת.
   *
   * שתי היכולות נפרדו כי הן נאכפות בשני Controllers שונים: הוספת
   * בעלים היא עריכת נכס, אבל הוספת בן/בת זוג או מספר נוסף היא עריכת
   * כרטיס לקוח. תפקיד assistant מחזיק את הראשונה ולא את השנייה — עם
   * דגל אחד הוא היה רואה את כל הכפתורים ומקבל 403 על כל אחד מהם
   * (ביקורת Codex).
   */
  canEditPeople: boolean;
  onChanged: () => void;
  /** האם וואטסאפ כלול במסלול — בלעדיו השליחה נחסמת בשרת ממילא. */
  canSendUpdate: boolean;
  /** "שלח עדכון שיווק" — היה מתחת לפרטי הנכס, מקומו כאן ליד הבעלים. */
  onSendUpdate: () => void;
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
        ownerName: String(form.get("ownerName") ?? "").trim(),
        ownerPhone: String(form.get("ownerPhone") ?? "").trim(),
      });
      setAdding(false);
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "שמירת בעל הנכס נכשלה");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mv-list-card mb-[18px] px-5 py-[17px]" aria-labelledby="owner-heading">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="owner-heading" className="m-0" style={{ fontSize: 15.5, fontWeight: 800 }}>
          בעל הנכס
        </h2>
        {owner ? (
          <span className="flex flex-wrap gap-2">
            {canSendUpdate ? (
              <button type="button" className="mv-btn-plain" onClick={onSendUpdate}>
                <IconChat s={15} /> שלח עדכון שיווק
              </button>
            ) : null}
            <a
              href={waMeUrl(owner.phone)}
              target="_blank"
              rel="noopener noreferrer"
              className="mv-btn-plain"
            >
              וואטסאפ
            </a>
          </span>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="m-0 mb-2 text-sm" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : null}

      {owner ? (
        <>
          <p className="m-0 text-sm">
            <strong>{owner.name}</strong>
            {" · "}
            <a href={`tel:${owner.phone}`} className="underline" dir="ltr">
              {owner.phone}
            </a>
            {owner.email ? (
              <>
                {" · "}
                <a href={`mailto:${owner.email}`} className="underline" dir="ltr">
                  {owner.email}
                </a>
              </>
            ) : null}
          </p>
          {/*
            אותו רכיב של כרטיס הקונה — מספרים נוספים ואנשי קשר
            (בן/בת זוג, בעלים שותף, בן שמטפל בהורים).
          */}
          <ContactPeople contactId={owner.id} canEdit={canEditPeople} />
        </>
      ) : adding ? (
        <form onSubmit={(e) => void save(e)} className="max-w-sm">
          <div className="mb-3">
            <label htmlFor="ownerName" className="mb-1 block text-sm font-semibold">
              שם בעל הנכס
            </label>
            <input
              id="ownerName"
              name="ownerName"
              required
              minLength={2}
              maxLength={120}
              className="w-full rounded-lg border px-3 py-2.5"
              style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
            />
          </div>
          <div className="mb-3">
            <label htmlFor="ownerPhone" className="mb-1 block text-sm font-semibold">
              טלפון
            </label>
            <input
              id="ownerPhone"
              name="ownerPhone"
              dir="ltr"
              inputMode="tel"
              required
              placeholder="050-1234567"
              className="w-full rounded-lg border px-3 py-2.5"
              style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
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
          <p className="m-0 mt-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
            אם המספר כבר קיים במערכת, הנכס יקושר לאותו אדם ולא ייווצר כרטיס כפול.
          </p>
        </form>
      ) : (
        <>
          <p className="m-0 mb-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
            טרם הוזן בעל נכס. בלעדיו אי אפשר לשלוח עדכון שיווק ולא להחתים על בלעדיות.
          </p>
          {canEdit ? (
            <button type="button" className="mv-btn-plain" onClick={() => setAdding(true)}>
              הוסף בעל נכס
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
