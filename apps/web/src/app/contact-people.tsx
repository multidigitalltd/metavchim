"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  CONTACT_ROLES,
  CONTACT_ROLE_LABELS,
  PHONE_LABELS,
  PHONE_LABEL_TEXT,
  isContactRole,
  isPhoneLabel,
  type ContactPerson,
} from "@metavchim/shared";
import { ApiError, apiDelete, apiGet, apiPost } from "@/lib/api";

/**
 * מי עומד מאחורי הכרטיס — בעל ואישה שקונים יחד, מיופה כוח, בן שמטפל
 * בהורים; ולכל אחד מהם יותר ממספר אחד.
 *
 * הרכיב יושב בכרטיס הקונה ובכרטיס הליד, ולא במסך נפרד: מתווך מגלה
 * שיש בן/בת זוג בזמן שיחה, ואם הוספתם דורשת ניווט למקום אחר הוא
 * יכתוב את זה בהערות כמו קודם.
 */

interface PhoneRow {
  /** null = המספר הראשי; הוא יושב על איש הקשר ואי אפשר להסירו לבד. */
  id: string | null;
  phone: string;
  label: string;
  primary: boolean;
}

interface PeopleResponse {
  people: ContactPerson[];
  phones: PhoneRow[];
}

function roleLabel(role: ContactPerson["role"]): string {
  if (role === null) return "ראשי";
  return isContactRole(role) ? CONTACT_ROLE_LABELS[role] : "איש קשר נוסף";
}

function phoneLabel(label: string): string {
  return isPhoneLabel(label) ? PHONE_LABEL_TEXT[label] : label;
}

export function ContactPeople({
  contactId,
  canEdit,
}: {
  contactId: string;
  /** סוכן ללא הרשאת עריכה רואה את האנשים ואינו יכול לשנות אותם. */
  canEdit: boolean;
}) {
  const [data, setData] = useState<PeopleResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addingPerson, setAddingPerson] = useState(false);
  const [addingPhone, setAddingPhone] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    apiGet<PeopleResponse>(`/contacts/${contactId}/people`)
      .then(setData)
      .catch(() => setData({ people: [], phones: [] }));
  }, [contactId]);

  useEffect(load, [load]);

  async function run(action: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await action();
      load();
      setAddingPerson(false);
      setAddingPhone(false);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "הפעולה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  function submitPerson(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(() =>
      apiPost(`/contacts/${contactId}/people`, {
        name: String(form.get("name")).trim(),
        phone: String(form.get("phone")).trim(),
        role: String(form.get("role")),
      }),
    );
  }

  function submitPhone(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(() =>
      apiPost(`/contacts/${contactId}/phones`, {
        phone: String(form.get("phone")).trim(),
        label: String(form.get("label")),
      }),
    );
  }

  if (data === null) return null;

  const extraPeople = data.people.filter((p) => p.role !== null);

  return (
    <section className="mv-list-card px-5 py-[17px]" aria-labelledby="people-heading">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 id="people-heading" className="m-0" style={{ fontSize: 15.5, fontWeight: 800 }}>
          אנשי קשר וטלפונים
        </h2>
        {canEdit ? (
          <div className="ms-auto flex gap-2">
            <button
              type="button"
              className="mv-btn-plain"
              style={{ padding: "5px 11px", fontSize: 12.5 }}
              onClick={() => {
                setAddingPerson((v) => !v);
                setAddingPhone(false);
              }}
            >
              + אדם
            </button>
            <button
              type="button"
              className="mv-btn-plain"
              style={{ padding: "5px 11px", fontSize: 12.5 }}
              onClick={() => {
                setAddingPhone((v) => !v);
                setAddingPerson(false);
              }}
            >
              + טלפון
            </button>
          </div>
        ) : null}
      </div>

      {/* ---- הטלפונים של האדם הראשי ---- */}
      <ul className="m-0 mb-3 list-none p-0">
        {data.phones.map((row) => (
          <li key={row.id ?? "primary"} className="flex items-center gap-2 py-1">
            <span className="mv-chip" style={{ minWidth: 52, justifyContent: "center" }}>
              {phoneLabel(row.label)}
            </span>
            <a href={`tel:${row.phone}`} dir="ltr" className="text-sm underline">
              {row.phone}
            </a>
            {row.primary ? (
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                ראשי
              </span>
            ) : canEdit ? (
              <button
                type="button"
                className="mv-btn-plain ms-auto"
                style={{ padding: "3px 9px", fontSize: 12 }}
                disabled={busy}
                onClick={() => void run(() => apiDelete(`/contacts/${contactId}/phones/${row.id}`))}
              >
                הסר
              </button>
            ) : null}
          </li>
        ))}
      </ul>

      {addingPhone ? (
        <form onSubmit={submitPhone} className="mb-3 flex flex-wrap items-end gap-2">
          <label className="grow">
            <span className="mb-1 block text-xs font-semibold">מספר נוסף</span>
            <input name="phone" dir="ltr" required placeholder="050-1234567" className="mv-field" />
          </label>
          <label>
            <span className="mb-1 block text-xs font-semibold">סוג</span>
            <select name="label" className="mv-field" defaultValue="mobile">
              {PHONE_LABELS.map((label) => (
                <option key={label} value={label}>
                  {PHONE_LABEL_TEXT[label]}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="mv-btn-action" disabled={busy}>
            הוסף
          </button>
        </form>
      ) : null}

      {/* ---- אנשים נוספים על אותו כרטיס ---- */}
      {extraPeople.length > 0 ? (
        <ul className="m-0 list-none border-t p-0 pt-2" style={{ borderColor: "var(--color-input-border)" }}>
          {extraPeople.map((person) => (
            <li key={person.contactId} className="flex flex-wrap items-center gap-2 py-1.5">
              <span className="mv-chip">{roleLabel(person.role)}</span>
              <strong className="text-sm">{person.name}</strong>
              <a href={`tel:${person.phone}`} dir="ltr" className="text-sm underline">
                {person.phone}
              </a>
              {canEdit ? (
                <button
                  type="button"
                  className="mv-btn-plain ms-auto"
                  style={{ padding: "3px 9px", fontSize: 12 }}
                  disabled={busy}
                  onClick={() =>
                    void run(() => apiDelete(`/contacts/${contactId}/people/${person.contactId}`))
                  }
                >
                  נתק
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {addingPerson ? (
        <form onSubmit={submitPerson} className="mt-2 flex flex-wrap items-end gap-2">
          <label className="grow">
            <span className="mb-1 block text-xs font-semibold">שם</span>
            <input name="name" required minLength={2} className="mv-field" />
          </label>
          <label className="grow">
            <span className="mb-1 block text-xs font-semibold">טלפון</span>
            <input name="phone" dir="ltr" required placeholder="050-1234567" className="mv-field" />
          </label>
          <label>
            <span className="mb-1 block text-xs font-semibold">תפקיד</span>
            <select name="role" className="mv-field" defaultValue="spouse">
              {CONTACT_ROLES.map((role) => (
                <option key={role} value={role}>
                  {CONTACT_ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="mv-btn-action" disabled={busy}>
            הוסף
          </button>
        </form>
      ) : null}

      {/* הסבר קצר שמופיע רק כשאין עדיין אף אחד — כדי שהמתווך יבין
          שזה קיים בלי לקרוא תיעוד, ולא ייראה כרעש למי שכבר משתמש */}
      {extraPeople.length === 0 && !addingPerson ? (
        <p className="m-0 mt-1 text-xs" style={{ color: "var(--color-text-muted)" }}>
          אפשר להוסיף בן/בת זוג או מיופה כוח — הודעה מהמספר שלהם תיכנס לכרטיס הזה
          ולא תפתח ליד חדש.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="m-0 mt-2 text-sm" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : null}
    </section>
  );
}
