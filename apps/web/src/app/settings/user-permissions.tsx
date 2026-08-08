"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CAPABILITY_LABELS,
  CAPABILITY_MODULES,
  ROLE_CAPABILITIES,
  type Capability,
} from "@metavchim/shared";
import { apiGet, apiPut, ApiError } from "@/lib/api";

interface OverrideRow {
  capability: string;
  effect: string;
  expiresAt?: string;
  reason?: string;
  description: string;
  active: boolean;
}

interface Payload {
  userId: string;
  name: string;
  role: string;
  protected: boolean;
  effective: string[];
  overrides: OverrideRow[];
}

/**
 * אורכי החסימה הזמינים.
 *
 * שדה תאריך חופשי היה מדויק יותר וגם איטי יותר — מנהל שחוסם סוכן
 * ליום בגלל טעות לא רוצה לבחור תאריך בלוח שנה. `null` = לצמיתות.
 */
const DURATIONS: { label: string; days: number | null }[] = [
  { label: "עד מחר", days: 1 },
  { label: "לשבוע", days: 7 },
  { label: "לחודש", days: 30 },
  { label: "לצמיתות", days: null },
];

function expiryFor(days: number | null): string | null {
  if (days === null) return null;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * מסך ההרשאות של איש צוות אחד.
 *
 * המבנה הוא מודולים ולא יכולות: מנהל משרד חושב "אני רוצה שהמתמחה
 * לא ייגע בנכסים החודש", לא "אני רוצה לשלול properties.delete".
 * הרמה העדינה קיימת מתחת למקש הרחבה, למי שצריך אותה.
 */
export function UserPermissions({
  userId,
  onClose,
}: {
  userId: string;
  onClose: () => void;
}): React.JSX.Element {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(() => {
    apiGet<Payload>(`/settings/users/${userId}/capabilities`)
      .then(setData)
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : "טעינת ההרשאות נכשלה");
      });
  }, [userId]);

  useEffect(load, [load]);

  async function apply(
    capabilities: Capability[],
    effect: "grant" | "deny" | "clear",
    days: number | null = null,
    reason?: string,
  ): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await apiPut(`/settings/users/${userId}/capabilities`, {
        capabilities,
        effect,
        ...(effect === "clear" ? {} : { expiresAt: expiryFor(days) }),
        ...(reason ? { reason } : {}),
      });
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "שינוי ההרשאות נכשל");
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) {
    return (
      <p role="alert" className="m-0 px-5 py-3 text-sm" style={{ color: "var(--color-danger)" }}>
        {error}
      </p>
    );
  }
  if (!data) return <p className="m-0 px-5 py-3 text-sm">טוען הרשאות…</p>;

  const effective = new Set(data.effective);
  const roleCaps = new Set<string>(ROLE_CAPABILITIES[data.role] ?? []);
  const overrideOf = new Map(data.overrides.map((row) => [row.capability, row]));

  return (
    <div
      className="mt-3 rounded-[13px] border p-4"
      style={{ borderColor: "var(--color-border)", background: "var(--color-field)" }}
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="m-0 text-sm font-extrabold">הרשאות של {data.name}</h3>
        <button type="button" className="mv-btn-plain" onClick={onClose}>
          סגור
        </button>
      </div>

      {data.protected ? (
        <p className="m-0 mb-3 text-[13px]" style={{ color: "var(--color-text-muted)" }}>
          אי אפשר לשנות כאן הרשאות — בעל המשרד וההרשאות שלכם עצמכם מוגנים, כדי שתמיד
          יישאר מי שיכול לתקן.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="m-0 mb-3 text-sm" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        {CAPABILITY_MODULES.map((module) => {
          const granted = module.capabilities.filter((c) => effective.has(c));
          const inRole = module.capabilities.filter((c) => roleCaps.has(c));
          // רק חסימות שעדיין בתוקף: חריג שפג נשאר בטבלה כתיעוד, וספירה
          // שלו הייתה מציגה "חלקי" ומציעה "החזר גישה" על מודול שכבר
          // פתוח — מצב מוצג שסותר את ההרשאה בפועל (ביקורת Codex)
          const blocked = module.capabilities.filter((c) => {
            const row = overrideOf.get(c);
            return row?.effect === "deny" && row.active;
          });
          // מודול שהתפקיד ממילא לא כולל אינו "חסום" — אין מה להחזיר בו
          const state =
            granted.length === 0 && inRole.length === 0
              ? "לא בתפקיד"
              : granted.length === 0
                ? "חסום"
                : granted.length === inRole.length && blocked.length === 0
                  ? "מלא"
                  : "חלקי";
          const tone =
            state === "חסום"
              ? { color: "#8a1c1c", background: "#fde8e8" }
              : state === "מלא"
                ? { color: "#0C6E34", background: "#E5FCEA" }
                : { color: "#68716a", background: "#eef1ec" };
          const timed = module.capabilities
            .map((c) => overrideOf.get(c))
            .find((row) => row?.effect === "deny" && row.expiresAt && row.active);

          return (
            <div
              key={module.key}
              className="rounded-[11px] border p-3"
              style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-sm font-bold">{module.label}</span>
                  <span className="mv-pill mr-2" style={{ fontSize: 11.5, ...tone }}>
                    {state}
                  </span>
                  <span
                    className="block text-xs"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    {timed ? timed.description : module.description}
                  </span>
                </div>

                {!data.protected ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {blocked.length > 0 ? (
                      <button
                        type="button"
                        className="mv-btn-soft"
                        disabled={busy}
                        onClick={() => void apply([...module.capabilities], "clear")}
                      >
                        החזר גישה
                      </button>
                    ) : (
                      <>
                        <label htmlFor={`dur_${module.key}`} className="mv-visually-hidden">
                          משך החסימה של {module.label}
                        </label>
                        <select
                          id={`dur_${module.key}`}
                          defaultValue="7"
                          className="rounded-lg border px-2 py-1 text-[13px]"
                          style={{
                            borderColor: "var(--color-border)",
                            background: "var(--color-bg)",
                          }}
                        >
                          {DURATIONS.map((d) => (
                            <option key={d.label} value={String(d.days ?? "")}>
                              {d.label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="mv-btn-plain"
                          disabled={busy || inRole.length === 0}
                          onClick={() => {
                            const select = document.getElementById(
                              `dur_${module.key}`,
                            ) as HTMLSelectElement | null;
                            const raw = select?.value ?? "";
                            void apply(
                              [...module.capabilities],
                              "deny",
                              raw === "" ? null : Number(raw),
                            );
                          }}
                        >
                          חסום
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      className="mv-btn-plain"
                      aria-expanded={expanded === module.key}
                      onClick={() => setExpanded(expanded === module.key ? null : module.key)}
                    >
                      {expanded === module.key ? "סגור פירוט" : "פירוט"}
                    </button>
                  </div>
                ) : null}
              </div>

              {expanded === module.key ? (
                <ul className="m-0 mt-3 list-none p-0">
                  {module.capabilities.map((capability) => {
                    const on = effective.has(capability);
                    const override = overrideOf.get(capability);
                    return (
                      <li
                        key={capability}
                        className="flex flex-wrap items-center justify-between gap-2 border-t py-2 text-[13px]"
                        style={{ borderColor: "var(--color-border)" }}
                      >
                        <span>
                          {CAPABILITY_LABELS[capability]}
                          {override ? (
                            <span
                              className="mr-2 text-xs"
                              style={{ color: "var(--color-text-muted)" }}
                            >
                              {override.description}
                            </span>
                          ) : null}
                        </span>
                        <span className="flex gap-1.5">
                          <button
                            type="button"
                            className="mv-btn-plain"
                            disabled={busy}
                            onClick={() =>
                              void apply([capability], on ? "deny" : "grant", null)
                            }
                          >
                            {on ? "חסום" : "הענק"}
                          </button>
                          {override ? (
                            <button
                              type="button"
                              className="mv-btn-soft"
                              disabled={busy}
                              onClick={() => void apply([capability], "clear")}
                            >
                              לפי התפקיד
                            </button>
                          ) : null}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>

      <p className="m-0 mt-3 text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
        התפקיד קובע את נקודת הפתיחה, וכאן מכווננים אותה למשתמש הזה. חסימה זמנית פגה
        מעצמה במועד שנקבע — אין צורך לזכור לבטל אותה. כל שינוי נרשם ביומן הפעולות.
      </p>
    </div>
  );
}
