"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@metavchim/ui";
import { apiGet, apiPatch, apiPost, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useRequireAuth } from "@/lib/use-auth";

/**
 * ניהול הפלטפורמה — הקמת משרדי תיווך חדשים בלי SSH. נגיש רק למנהלי
 * הפלטפורמה (PLATFORM_ADMIN_EMAILS); לכל שאר המשתמשים מוצג "אין הרשאה".
 */

const inputStyle = { borderColor: "var(--color-border)", background: "var(--color-bg)" } as const;

interface AgencyRow {
  id: string;
  name: string;
  plan: string;
  status: string;
  userCount: number;
  createdAt: string;
}

const PLAN_LABELS: Record<string, string> = {
  basic: "Basic",
  pro: "Pro",
  agency: "Agency",
  enterprise: "Enterprise",
};

const STATUS_LABELS: Record<string, string> = {
  active: "פעיל",
  trial: "ניסיון",
  suspended: "מושהה",
  churned: "עזב",
};

export default function PlatformPage() {
  const { loading: authLoading } = useRequireAuth();
  const [agencies, setAgencies] = useState<AgencyRow[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ ownerEmail: string; tempPassword: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function load() {
    apiGet<AgencyRow[]>("/platform/agencies")
      .then(setAgencies)
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 403) setForbidden(true);
        else setError("טעינת המשרדים נכשלה");
      });
  }

  useEffect(() => {
    if (!authLoading) load();
  }, [authLoading]);

  async function changePlan(id: string, plan: string) {
    await apiPatch(`/platform/agencies/${id}`, { plan });
    load();
  }

  async function toggleSuspend(agency: AgencyRow) {
    const next = agency.status === "suspended" ? "active" : "suspended";
    await apiPatch(`/platform/agencies/${agency.id}`, { status: next });
    load();
  }

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const form = event.currentTarget;
    const f = new FormData(form);
    try {
      const result = await apiPost<{ ownerEmail: string; tempPassword: string }>(
        "/platform/agencies",
        {
          name: String(f.get("name")).trim(),
          ownerEmail: String(f.get("ownerEmail")).trim(),
          ownerName: String(f.get("ownerName")).trim(),
          plan: String(f.get("plan")),
        },
      );
      setCreated(result);
      form.reset();
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "הקמת המשרד נכשלה");
    } finally {
      setSubmitting(false);
    }
  }

  if (authLoading) return <p aria-live="polite">טוען…</p>;
  if (forbidden) {
    return (
      <p role="alert" style={{ color: "var(--color-text-muted)" }}>
        המסך הזה זמין רק למנהלי הפלטפורמה.
      </p>
    );
  }

  return (
    <>
      <h1 className="mb-2 text-2xl font-bold">ניהול הפלטפורמה</h1>
      <p className="mb-6" style={{ color: "var(--color-text-muted)" }}>
        הקמת משרדי תיווך חדשים וניהולם — כל משרד מבודד לחלוטין, עם הצוות והנתונים שלו.
      </p>

      {error ? (
        <p role="alert" className="mb-4 rounded-lg border p-3" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : null}

      {created ? (
        <div role="alert" className="mb-6 rounded-xl border p-4" style={{ borderColor: "var(--color-success)" }}>
          <p className="mb-1 font-semibold">✓ המשרד הוקם!</p>
          <p>
            התחברות: <span dir="ltr" className="font-mono">{created.ownerEmail}</span>
          </p>
          <p>
            סיסמה זמנית (מוצגת פעם אחת — העבירו לבעל המשרד):{" "}
            <span dir="ltr" className="font-mono text-lg">{created.tempPassword}</span>
          </p>
          <Button variant="ghost" className="mt-2" onClick={() => setCreated(null)}>
            סגור
          </Button>
        </div>
      ) : null}

      <section aria-labelledby="new-agency" className="mb-8 rounded-xl border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <h2 id="new-agency" className="mb-3 text-lg font-semibold">➕ משרד חדש</h2>
        <form onSubmit={(e) => void onCreate(e)} className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="name" className="mb-1 block font-medium">שם המשרד</label>
            <input id="name" name="name" required minLength={2} className="rounded-lg border px-3 py-2.5" style={inputStyle} />
          </div>
          <div>
            <label htmlFor="ownerName" className="mb-1 block font-medium">שם הבעלים</label>
            <input id="ownerName" name="ownerName" required minLength={2} className="rounded-lg border px-3 py-2.5" style={inputStyle} />
          </div>
          <div>
            <label htmlFor="ownerEmail" className="mb-1 block font-medium">אימייל הבעלים</label>
            <input id="ownerEmail" name="ownerEmail" type="email" required dir="ltr" className="rounded-lg border px-3 py-2.5" style={inputStyle} />
          </div>
          <div>
            <label htmlFor="plan" className="mb-1 block font-medium">מסלול</label>
            <select id="plan" name="plan" defaultValue="pro" className="rounded-lg border px-3 py-2.5" style={inputStyle}>
              {Object.entries(PLAN_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <Button type="submit" disabled={submitting}>
            {submitting ? "מקים…" : "הקם משרד"}
          </Button>
        </form>
      </section>

      <section aria-labelledby="agencies-list">
        <h2 id="agencies-list" className="mb-3 text-lg font-semibold">
          משרדים {agencies !== null ? `(${agencies.length})` : ""}
        </h2>
        {agencies === null ? (
          <p aria-live="polite">טוען…</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--color-border)" }}>
            <table className="w-full">
              <caption className="mv-visually-hidden">משרדי התיווך בפלטפורמה</caption>
              <thead style={{ background: "var(--color-surface)" }}>
                <tr>
                  <th scope="col" className="p-3 text-start">משרד</th>
                  <th scope="col" className="p-3 text-start">מסלול</th>
                  <th scope="col" className="p-3 text-start">סטטוס</th>
                  <th scope="col" className="p-3 text-start">משתמשים</th>
                  <th scope="col" className="p-3 text-start">הוקם</th>
                  <th scope="col" className="p-3 text-start">
                    <span className="mv-visually-hidden">פעולות</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {agencies.map((a) => (
                  <tr key={a.id} className="border-t" style={{ borderColor: "var(--color-border)" }}>
                    <td className="p-3 font-medium">{a.name}</td>
                    <td className="p-3">
                      <label>
                        <span className="mv-visually-hidden">מסלול של {a.name}</span>
                        <select
                          value={a.plan}
                          onChange={(e) => void changePlan(a.id, e.target.value)}
                          className="rounded-lg border px-2 py-1.5"
                          style={{ borderColor: "var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)" }}
                        >
                          {Object.entries(PLAN_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                      </label>
                    </td>
                    <td className="p-3">
                      <span style={a.status === "suspended" ? { color: "var(--color-danger)" } : undefined}>
                        {STATUS_LABELS[a.status] ?? a.status}
                      </span>
                    </td>
                    <td className="p-3">{a.userCount}</td>
                    <td className="p-3">{formatDate(a.createdAt)}</td>
                    <td className="p-3">
                      <Button
                        variant={a.status === "suspended" ? "secondary" : "ghost"}
                        onClick={() => void toggleSuspend(a)}
                      >
                        {a.status === "suspended" ? "הפעל מחדש" : "השהה"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
