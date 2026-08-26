"use client";

import { useState, type FormEvent } from "react";
import {
  MAX_NOTICE_PERIOD_DAYS,
  OCCUPANCY_LABEL,
  OCCUPANCY_MEANING,
  OCCUPANCY_STATES,
  leaseNotice,
  occupancyConflict,
  type OccupancyState,
} from "@metavchim/shared";
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
 *
 * ## ‎**שלושה מצבים, ורביעי שהוא „טרם נשאל”**
 *
 * הסעיף ידע עד כה שני מצבים בלבד — יש שוכר רשום או אין — וכשלא
 * היה, הוא אמר „הבעלים גר בנכס, **או** שאין דייר”. כלומר הכריז על
 * שתי עובדות שאיש לא בדק, על סמך היעדר רשומה.
 *
 * וההבדל אינו סמנטי: דירה ריקה מראים בכל שעה, דירה של הבעלים דורשת
 * תיאום, ודירה מושכרת דורשת תיאום עם מי שאינו צד לעסקה. שלוש דרכי
 * עבודה שונות שהוצגו כאחת.
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
  occupancy,
  leaseEndsAt,
  noticePeriodDays,
  canEdit,
  canEditPeople,
  canErase,
  onChanged,
}: {
  propertyId: string;
  occupant?: OccupantContact;
  /** ‎`undefined` = טרם נשאל. **לא** „הבעלים גר בנכס”. */
  occupancy?: OccupancyState;
  leaseEndsAt?: string;
  noticePeriodDays?: number;
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
  const [editingLease, setEditingLease] = useState(false);

  const notice = leaseNotice(
    leaseEndsAt === undefined ? null : new Date(`${leaseEndsAt}T00:00:00Z`),
    noticePeriodDays ?? null,
    new Date(),
  );

  /**
   * ‎**בחירת מצב — והשרת הוא זה שמכריע.**
   *
   * הבדיקה כאן חוסכת סיבוב, ואינה מחליפה את זו שבשרת: המסך אינו
   * הנתיב היחיד. מה שהיא כן עושה הוא להסביר **לפני** הלחיצה, כי
   * שגיאה שמגיעה אחריה היא לימוד בדרך הקשה.
   */
  async function chooseOccupancy(next: OccupancyState): Promise<void> {
    const conflict = occupancyConflict(next, occupant !== undefined);
    if (conflict !== null) {
      setError(conflict);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiPatch(`/properties/${propertyId}`, { occupancy: next });
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "שמירת המצב נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function saveLease(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const endsAt = String(form.get("leaseEndsAt") ?? "").trim();
    const days = String(form.get("noticePeriodDays") ?? "").trim();
    setBusy(true);
    setError(null);
    try {
      await apiPatch(`/properties/${propertyId}`, {
        /*
         * ריק = „לא ידוע”, ולכן `null` מפורש ולא השמטה. השמטה
         * פירושה „בלי שינוי”, ואז אי אפשר למחוק תאריך שהוזן בטעות.
         */
        leaseEndsAt: endsAt === "" ? null : endsAt,
        noticePeriodDays: days === "" ? null : Number(days),
      });
      setEditingLease(false);
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "שמירת פרטי החוזה נכשלה");
    } finally {
      setBusy(false);
    }
  }

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
        <h2 id="occupant-heading" className="m-0" style={{ fontSize: "calc(16.5 / 16 * 1rem)", fontWeight: 800 }}>
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

      {/*
        ‎**שלושת המצבים בראש הסעיף, ולפני כל השאר.**

        זו השאלה שהמסך הזה שואל, וכל היתר (שוכר, חוזה) הוא מה שנגזר
        מתשובה אחת מהן. „טרם נסומן” מוצג כמצב ולא כשתיקה — נכס שאיש
        לא סימן בו דבר אינו נכס שהבעלים גר בו.
      */}
      <div className="mb-3" role="group" aria-label="מי גר בנכס">
        <div className="flex flex-wrap gap-2">
          {OCCUPANCY_STATES.map((state) => {
            const active = occupancy === state;
            return (
              <button
                key={state}
                type="button"
                className="rounded-xl border px-3 py-2 text-start"
                aria-pressed={active}
                disabled={!canEdit || busy}
                onClick={() => void chooseOccupancy(state)}
                style={{
                  /*
                    ‎`--color-input-border` ולא `--color-border`: אלה
                    פקדים ולא כרטיסים. המסגרת הדקורטיבית עומדת על
                    ‎1.65:1 בלבד, מתחת לסף WCAG 1.4.11 לגבול פקד —
                    נתפס בשער הניגודיות, ולא בעין.
                  */
                  borderColor: active ? "var(--color-primary)" : "var(--color-input-border)",
                  background: active ? "var(--color-primary-soft)" : "var(--color-bg)",
                  cursor: canEdit && !busy ? "pointer" : "default",
                }}
              >
                <span
                  className="block text-[length:var(--type-body-sm)]"
                  style={{ fontWeight: 800, color: active ? "var(--color-primary)" : "var(--color-text)" }}
                >
                  {OCCUPANCY_LABEL[state]}
                </span>
                {/*
                  מה שנגזר מהמצב, ולא הגדרתו. „אין דייר” הוא עובדה;
                  „אפשר להראות בכל שעה” הוא מה שהמתווך עושה איתה.
                */}
                <span
                  className="block text-[length:var(--type-caption)]"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  {OCCUPANCY_MEANING[state]}
                </span>
              </button>
            );
          })}
        </div>
        {occupancy === undefined ? (
          <p
            className="m-0 mt-1.5 text-[length:var(--type-caption)]"
            style={{ color: "var(--color-text-muted)" }}
          >
            טרם נסומן. עד שנבחר מצב, המערכת אינה יודעת אם אפשר להראות את
            הנכס בלי תיאום מראש.
          </p>
        ) : null}
      </div>

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

          {/*
            ‎**החוזה, והמועד שנופל ממנו.**

            השאלה שמתווך נשאל על דירה מושכרת היא „מתי אפשר להיכנס”,
            והתשובה תלויה במועד שאין לו תזכורת: אחרי המועד האחרון
            להודיע על אי-חידוש, החוזה מתחדש — וההבטחה שניתנה נהיית
            שגויה בשנה שלמה, מול קונה שכבר מכר את הדירה שלו.

            אותו דפוס בדיוק כמו „מועד השליש” בבלעדיות: תאריך שנגזר
            ממסמך, ולא מהזיכרון של מי שקרא אותו פעם.
          */}
          {editingLease ? (
            <form onSubmit={(e) => void saveLease(e)} className="mt-3 max-w-sm">
              <div className="mb-3">
                <label htmlFor="leaseEndsAt" className="mb-1 block text-sm font-semibold">
                  תום חוזה השכירות
                </label>
                <input
                  id="leaseEndsAt"
                  name="leaseEndsAt"
                  type="date"
                  defaultValue={leaseEndsAt ?? ""}
                  className="w-full rounded-lg border px-3 py-2.5"
                  style={{ borderColor: "var(--color-input-border)", background: "var(--color-bg)" }}
                />
              </div>
              <div className="mb-3">
                <label htmlFor="noticePeriodDays" className="mb-1 block text-sm font-semibold">
                  תקופת הודעה על אי-חידוש (ימים)
                </label>
                <input
                  id="noticePeriodDays"
                  name="noticePeriodDays"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={MAX_NOTICE_PERIOD_DAYS}
                  defaultValue={noticePeriodDays ?? ""}
                  dir="ltr"
                  className="w-full rounded-lg border px-3 py-2.5"
                  style={{ borderColor: "var(--color-input-border)", background: "var(--color-bg)" }}
                />
                <p className="m-0 mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
                  מה שכתוב בחוזה. ממנו נגזר המועד האחרון להודיע לשוכר.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="submit" className="mv-btn-action" disabled={busy}>
                  {busy ? "שומר…" : "שמור"}
                </button>
                <button
                  type="button"
                  className="mv-btn-plain"
                  onClick={() => setEditingLease(false)}
                >
                  ביטול
                </button>
              </div>
            </form>
          ) : (
            <div className="mt-2">
              {notice === null ? (
                <p className="m-0 text-sm" style={{ color: "var(--color-text-muted)" }}>
                  תום החוזה לא הוזן — בלעדיו אי אפשר לדעת מתי הדירה מתפנה.
                </p>
              ) : (
                <>
                  <p className="m-0 text-sm">
                    תום חוזה <strong dir="ltr">{leaseEndsAt}</strong>
                    {" · "}
                    המועד האחרון להודיע: <strong dir="ltr">{notice.notifyBy}</strong>
                  </p>
                  {/*
                    „חלף” אדום, „מתקרב” ענבר, ורגוע — אפור. הצבע כאן
                    הוא משמעות ולא קישוט: מועד שחלף פירושו שהתשובה
                    שהמתווך נותן ללקוחות כרגע שגויה.
                  */}
                  <p
                    className="m-0 mt-0.5 text-sm"
                    style={{
                      color:
                        notice.state === "passed"
                          ? "var(--color-danger)"
                          : notice.state === "soon"
                            ? "var(--color-warning)"
                            : "var(--color-text-muted)",
                      fontWeight: notice.state === "ok" ? 400 : 700,
                    }}
                  >
                    {notice.message}
                  </p>
                </>
              )}
              {canEdit ? (
                <button
                  type="button"
                  className="mv-btn-plain mt-1"
                  onClick={() => setEditingLease(true)}
                >
                  {notice === null ? "הוספת פרטי חוזה" : "עדכון פרטי חוזה"}
                </button>
              ) : null}
            </div>
          )}
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
          {/*
            המשפט שהיה כאן — „הבעלים גר בנכס, או שאין דייר” — הצהיר
            על שתי עובדות שאיש לא בדק, על סמך היעדר רשומה. עכשיו
            המצב נבחר למעלה, וכאן נשארת רק הפעולה.
          */}
          <p className="m-0 mb-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
            אם הדירה מושכרת — הוסיפו את השוכר כדי שתיאום ביקור לא יעבור דרך
            פתק.
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
