"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  OPEN_HOUSE_SLOT_MINUTES,
  OPEN_HOUSE_STATUS_LABELS,
  formatJerusalemTime,
  jerusalemWallErrorMessage,
  openHouseInviteMessage,
  openHouseReminderMessage,
  openHouseWhen,
  resolveJerusalemWall,
  type OpenHouseStatus,
  type SlotAvailability,
} from "@metavchim/shared";
import { apiGet, apiPatch, apiPost, ApiError } from "@/lib/api";
import { useCopy } from "@/lib/clipboard";
import { waMeUrl } from "@/lib/format";
import { IconHome } from "../../icons";
import { Notice } from "../../notice";
import { ViewingFeedbackCell } from "./owner-activity";

/**
 * ‏לשונית „בית פתוח” בכרטיס הנכס (docs/03 — open_houses).
 *
 * ‏למעלה האירוע הקרוב: מתי, כמה נרשמו, המשבצות, וקישור ההרשמה —
 * ‏אותו קישור של דף הנחיתה, כלומר אותו QR שכבר על השלט. מתחת
 * ‏המבקרים: „הגיע” בהקשה אחת, ומשוב באותן שלוש הקשות של סיור רגיל,
 * ‏כי כל מבקר הוא סיור ביומן. תזכורת אישית נשלחת מהוואטסאפ של הסוכן.
 */

interface VisitorDto {
  appointmentId: string;
  leadId: string;
  slotAt: string;
  name: string;
  phone?: string;
  visible: boolean;
  arrived: boolean;
  feedback: { price: string | null; condition: string | null; fit: string | null };
}

interface EventDto {
  id: string;
  startsAt: string;
  endsAt: string;
  slotMinutes: number;
  slotCapacity: number | null;
  status: OpenHouseStatus;
  slots: SlotAvailability[];
  registered: number;
  arrived: number;
  visitors: VisitorDto[];
  visitorsTruncated: boolean;
}

export interface OpenHousesResponse {
  registrationUrl: string | null;
  events: EventDto[];
}

/** ‏מה שהמונה על הלשונית סופר — נרשמים לאירועים שטרם הסתיימו */
export function upcomingRegistered(data: OpenHousesResponse): number {
  return data.events.filter((e) => e.status === "planned").reduce((sum, e) => sum + e.registered, 0);
}

export function OpenHousePanel({
  propertyId,
  propertyLabel,
  priceAgorot,
  officeName,
  canEdit,
  onLoaded,
}: {
  propertyId: string;
  propertyLabel: string;
  priceAgorot: number | null;
  officeName: string;
  canEdit: boolean;
  onLoaded?: (data: OpenHousesResponse) => void;
}) {
  const [data, setData] = useState<OpenHousesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const copy = useCopy();
  /* ‏טופס אירוע חדש — תאריך ושעות בשעון ישראל */
  const [date, setDate] = useState("");
  const [from, setFrom] = useState("17:00");
  const [to, setTo] = useState("19:00");
  const [slotMinutes, setSlotMinutes] = useState<number>(20);
  const [capacity, setCapacity] = useState("");
  /* ‏מבקר שהגיע בלי להירשם */
  const [walkName, setWalkName] = useState("");
  const [walkPhone, setWalkPhone] = useState("");

  const apply = useCallback(
    (next: OpenHousesResponse) => {
      setData(next);
      onLoaded?.(next);
    },
    [onLoaded],
  );

  const reload = useCallback(() => {
    apiGet<OpenHousesResponse>(`/properties/${propertyId}/open-houses`)
      .then(apply)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "בית פתוח לא נטען"));
  }, [propertyId, apply]);

  useEffect(() => {
    let cancelled = false;
    apiGet<OpenHousesResponse>(`/properties/${propertyId}/open-houses`)
      .then((res) => {
        if (!cancelled) apply(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "בית פתוח לא נטען");
      });
    return () => {
      cancelled = true;
    };
  }, [propertyId, apply]);

  async function run(action: () => Promise<OpenHousesResponse>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      apply(await action());
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "הפעולה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  function createEvent(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const start = resolveJerusalemWall(date, from, null);
    const end = resolveJerusalemWall(date, to, null);
    if (!start.ok) {
      setError(jerusalemWallErrorMessage(start.reason));
      return;
    }
    if (!end.ok) {
      setError(jerusalemWallErrorMessage(end.reason));
      return;
    }
    const cap = capacity.trim() === "" ? null : Number(capacity);
    void run(() =>
      apiPost<OpenHousesResponse>(`/properties/${propertyId}/open-houses`, {
        startsAt: start.at.toISOString(),
        endsAt: end.at.toISOString(),
        slotMinutes,
        slotCapacity: cap !== null && Number.isInteger(cap) && cap > 0 ? cap : null,
      }),
    ).then(() => {
      setDate("");
      setWalkName("");
    });
  }

  function walkIn(event: FormEvent<HTMLFormElement>, openHouseId: string): void {
    event.preventDefault();
    void run(() =>
      apiPost<OpenHousesResponse>(`/properties/${propertyId}/open-houses/${openHouseId}/visitors`, {
        name: walkName.trim(),
        phone: walkPhone.trim(),
      }),
    ).then(() => {
      setWalkName("");
      setWalkPhone("");
    });
  }

  if (data === null) {
    return error ? <Notice tone="danger">{error}</Notice> : <p aria-live="polite">טוען בית פתוח…</p>;
  }
  const planned = data.events.filter((e) => e.status === "planned");
  const past = data.events.filter((e) => e.status !== "planned");
  const url = data.registrationUrl;

  return (
    <div className="flex flex-col gap-4">
      {error ? <Notice tone="danger">{error}</Notice> : null}

      {planned.length === 0 ? (
        <section className="mv-card mv-card--pad">
          <div className="mv-card-head mv-domain-green">
            <span className="mv-tile" aria-hidden="true"><IconHome s={19} /></span>
            <h2 className="mv-card-head__title m-0">בית פתוח</h2>
          </div>
          <p className="m-0" style={{ color: "var(--color-text-soft)" }}>
            אין בית פתוח מתוכנן. קובעים שעתיים, המבקרים נרשמים למשבצת מהקישור או מה-QR שעל השלט, ובשטח מסמנים מי הגיע ומה אמר.
          </p>
        </section>
      ) : null}

      {planned.map((event) => {
        const startsAt = new Date(event.startsAt);
        const endsAt = new Date(event.endsAt);
        const invite = url === null ? null : openHouseInviteMessage({ propertyLabel, startsAt, endsAt, priceAgorot, url, officeName });
        return (
          <section key={event.id} className="mv-card mv-card--pad" aria-labelledby={`oh-${event.id}`}>
            <div className="mv-card-head mv-domain-green">
              <span className="mv-tile" aria-hidden="true"><IconHome s={19} /></span>
              <h2 id={`oh-${event.id}`} className="mv-card-head__title m-0">בית פתוח — {openHouseWhen(startsAt, endsAt)}</h2>
            </div>
            <p className="m-0 font-semibold">
              {event.registered === 0 ? "עדיין אין נרשמים" : `${event.registered} נרשמו · ${event.arrived} הגיעו`}
              {event.slotCapacity === null ? "" : ` · עד ${event.slotCapacity} למשבצת`}
            </p>
            <ul className="m-0 mt-2 flex list-none flex-wrap gap-1.5 p-0" aria-label="משבצות">
              {event.slots.map((slot) => (
                <li key={slot.startsAt} className={`mv-pill ${slot.remaining === 0 ? "mv-domain-neutral" : "mv-domain-green"}`}>
                  {formatJerusalemTime(new Date(slot.startsAt))}
                  {slot.remaining === null ? (slot.registered > 0 ? ` · ${slot.registered}` : "") : ` · ${slot.registered}/${event.slotCapacity}`}
                </li>
              ))}
            </ul>

            {url !== null && invite !== null ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <a href={url} target="_blank" rel="noreferrer" className="mv-ltr break-all text-[length:var(--type-caption-lg)] underline">{url}</a>
                <button type="button" className="mv-btn-plain" onClick={() => void copy.copy(url, event.id)}>
                  {copy.state === "copied" && copy.key === event.id ? "✓ הועתק" : "העתק קישור"}
                </button>
                <a href={`https://wa.me/?text=${encodeURIComponent(invite)}`} target="_blank" rel="noreferrer" className="mv-btn-soft">
                  לשתף הזמנה בוואטסאפ
                </a>
                <span className="text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
                  זה אותו קישור של ה-QR שעל השלט — מי שסורק נרשם ישר למשבצת.
                </span>
              </div>
            ) : null}

            <VisitorsList event={event} canEdit={canEdit} busy={busy} propertyLabel={propertyLabel} officeName={officeName} onArrived={(v, arrived) => void run(() => apiPatch<OpenHousesResponse>(`/properties/${propertyId}/open-houses/${event.id}/visitors/${v.appointmentId}`, { arrived }))} onSaved={reload} />

            {canEdit ? (
              <form onSubmit={(e) => walkIn(e, event.id)} className="mt-3 flex flex-wrap items-end gap-2" aria-label="מבקר שלא נרשם">
                <label className="flex flex-col gap-1 text-[length:var(--type-caption)] font-semibold">
                  הגיע בלי להירשם — שם
                  <input className="mv-control" value={walkName} onChange={(e) => setWalkName(e.target.value)} minLength={2} required />
                </label>
                <label className="flex flex-col gap-1 text-[length:var(--type-caption)] font-semibold">
                  טלפון
                  <input className="mv-control mv-ltr" inputMode="tel" value={walkPhone} onChange={(e) => setWalkPhone(e.target.value)} minLength={9} required />
                </label>
                <button type="submit" className="mv-btn-soft" disabled={busy}>לרשום שהגיע</button>
              </form>
            ) : null}

            {canEdit ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="mv-btn-soft" disabled={busy} onClick={() => void run(() => apiPatch<OpenHousesResponse>(`/properties/${propertyId}/open-houses/${event.id}`, { status: "done" }))}>
                  האירוע התקיים
                </button>
                <button type="button" className="mv-btn-plain" disabled={busy} onClick={() => void run(() => apiPatch<OpenHousesResponse>(`/properties/${propertyId}/open-houses/${event.id}`, { status: "cancelled" }))}>
                  לבטל את האירוע
                </button>
              </div>
            ) : null}
          </section>
        );
      })}

      {canEdit ? (
        <section className="mv-card mv-card--pad" aria-labelledby="oh-new">
          <h3 id="oh-new" className="m-0 mb-3 text-[length:var(--type-body)] font-extrabold">בית פתוח חדש</h3>
          <form onSubmit={createEvent} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <label className="flex flex-col gap-1 text-[length:var(--type-caption)] font-semibold">
              תאריך
              <input type="date" className="mv-control" value={date} onChange={(e) => setDate(e.target.value)} required />
            </label>
            <label className="flex flex-col gap-1 text-[length:var(--type-caption)] font-semibold">
              מהשעה
              <input type="time" className="mv-control" value={from} onChange={(e) => setFrom(e.target.value)} required />
            </label>
            <label className="flex flex-col gap-1 text-[length:var(--type-caption)] font-semibold">
              עד השעה
              <input type="time" className="mv-control" value={to} onChange={(e) => setTo(e.target.value)} required />
            </label>
            <label className="flex flex-col gap-1 text-[length:var(--type-caption)] font-semibold">
              משבצת
              <select className="mv-control" value={slotMinutes} onChange={(e) => setSlotMinutes(Number(e.target.value))}>
                {OPEN_HOUSE_SLOT_MINUTES.map((m) => (
                  <option key={m} value={m}>{m} דקות</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[length:var(--type-caption)] font-semibold">
              מקומות למשבצת
              <input className="mv-control mv-ltr" inputMode="numeric" value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="בלי הגבלה" />
            </label>
            <div className="sm:col-span-2 lg:col-span-5">
              <button type="submit" className="mv-btn-action" disabled={busy}>{busy ? "קובע…" : "לקבוע בית פתוח"}</button>
            </div>
          </form>
        </section>
      ) : null}

      {past.length > 0 ? (
        <section className="mv-card mv-card--pad" aria-labelledby="oh-past">
          <h3 id="oh-past" className="m-0 mb-2 text-[length:var(--type-body)] font-extrabold">אירועים קודמים</h3>
          <ol className="m-0 flex list-none flex-col gap-3 p-0">
            {past.map((event) => (
              <li key={event.id}>
                <details>
                  <summary className="cursor-pointer font-semibold">
                    {openHouseWhen(new Date(event.startsAt), new Date(event.endsAt))} · {OPEN_HOUSE_STATUS_LABELS[event.status]} · {event.registered} נרשמו, {event.arrived} הגיעו
                  </summary>
                  <VisitorsList event={event} canEdit={canEdit} busy={busy} propertyLabel={propertyLabel} officeName={officeName} onArrived={(v, arrived) => void run(() => apiPatch<OpenHousesResponse>(`/properties/${propertyId}/open-houses/${event.id}/visitors/${v.appointmentId}`, { arrived }))} onSaved={reload} />
                </details>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

function VisitorsList({
  event,
  canEdit,
  busy,
  propertyLabel,
  officeName,
  onArrived,
  onSaved,
}: {
  event: EventDto;
  canEdit: boolean;
  busy: boolean;
  propertyLabel: string;
  officeName: string;
  onArrived: (visitor: VisitorDto, arrived: boolean) => void;
  onSaved: () => void;
}) {
  if (event.visitors.length === 0) return null;
  return (
    <>
    {event.visitorsTruncated ? (
      <p className="mv-form-hint mt-3">מוצגים {event.visitors.length} המבקרים הראשונים; המונים למעלה כוללים את כולם.</p>
    ) : null}
    <ol className="m-0 mt-3 flex list-none flex-col gap-2 p-0" aria-label={`המבקרים — ${openHouseWhen(new Date(event.startsAt), new Date(event.endsAt))}`}>
      {event.visitors.map((visitor) => (
        <li key={visitor.appointmentId} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-2" style={{ borderColor: "var(--color-border)" }}>
          <span className="mv-ltr font-bold">{formatJerusalemTime(new Date(visitor.slotAt))}</span>
          <span className="font-semibold">{visitor.name}</span>
          {visitor.phone !== undefined ? <span className="mv-ltr" style={{ color: "var(--color-text-muted)" }}>{visitor.phone}</span> : null}
          {visitor.arrived ? (
            <span className="mv-pill mv-domain-green">הגיע</span>
          ) : (
            <span className="mv-pill mv-domain-neutral">{event.status === "done" ? "לא הגיע" : "נרשם"}</span>
          )}
          {canEdit && event.status === "planned" ? (
            <button type="button" className={visitor.arrived ? "mv-btn-plain" : "mv-btn-soft"} disabled={busy} onClick={() => onArrived(visitor, !visitor.arrived)}>
              {visitor.arrived ? "בטל „הגיע”" : "הגיע"}
            </button>
          ) : null}
          {visitor.arrived ? (
            <ViewingFeedbackCell appointmentId={visitor.appointmentId} feedback={visitor.feedback} canEdit={canEdit} onSaved={onSaved} />
          ) : null}
          {!visitor.arrived && event.status === "planned" && visitor.phone !== undefined ? (
            <a
              href={waMeUrl(visitor.phone, openHouseReminderMessage({ name: visitor.name, propertyLabel, slotAt: new Date(visitor.slotAt), officeName }))}
              target="_blank"
              rel="noreferrer"
              className="mv-btn-plain"
            >
              תזכורת בוואטסאפ
            </a>
          ) : null}
        </li>
      ))}
    </ol>
    </>
  );
}
