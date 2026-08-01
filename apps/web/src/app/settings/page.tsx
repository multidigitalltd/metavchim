"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button } from "@metavchim/ui";
import { apiGet, apiPatch, apiPost, ApiError } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { useRequireAuth } from "@/lib/use-auth";
import { ExportSection } from "./export-section";
import { LeadWebhookSection } from "./lead-webhook-section";
import { WhatsAppStatusSection } from "./whatsapp-status-section";
import { SystemUpdateSection } from "./system-update";

const inputStyle = { borderColor: "var(--color-border)", background: "var(--color-bg)" } as const;

interface TeamUser {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  lastLoginAt?: string;
  locked: boolean;
}

interface AuditRow {
  action: string;
  entityType: string;
  userName?: string;
  createdAt: string;
}

const ROLE_LABELS: Record<string, string> = {
  owner: "בעלים",
  admin: "מנהל",
  agent: "סוכן",
  assistant: "עוזר",
  viewer: "צפייה בלבד",
};

const PLAN_LABELS: Record<string, string> = {
  basic: "Basic — בסיסי",
  pro: "Pro — מקצועי",
  agency: "Agency — משרד",
  enterprise: "Enterprise — רשת/ארגון",
};

/** קודי יומן הפעילות → עברית; קוד לא מוכר מוצג כמו שהוא */
const AUDIT_ACTION_LABELS: Record<string, string> = {
  "property.create": "יצירת נכס",
  "property.update": "עדכון נכס",
  "property.delete": "העברת נכס לארכיון",
  "property.media_upload": "העלאת תמונת נכס",
  "property.media_delete": "מחיקת תמונת נכס",
  "property.media_primary": "קביעת תמונה ראשית",
  "property.media_alt_text": "עדכון תיאור תמונה",
  "property.owner_update": "עדכון שיווק לבעל נכס",
  "buyer.create": "יצירת קונה",
  "buyer.update": "עדכון קונה",
  "buyer.interaction_add": "תיעוד אינטראקציה עם קונה",
  "lead.create": "יצירת ליד",
  "lead.status": "עדכון סטטוס ליד",
  "lead.convert": "המרת ליד לקונה",
  "lead.repeat_inquiry": "פנייה חוזרת של ליד",
  "offer.create": "יצירת הצעה",
  "offer.whatsapp_prepared": "הכנת הצעה לוואטסאפ",
  "appointment.create": "קביעת פגישה",
  "appointment.update": "עדכון פגישה",
  "task.create": "יצירת משימה",
  "task.update": "עדכון משימה",
  "task.delete": "מחיקת משימה",
  "collaboration.share": "שיתוף ברשת",
  "collaboration.unshare": "הסרת שיתוף מהרשת",
  "collaboration.offer": "הצעה ברשת שיתוף",
  "collaboration.interested": "עניין בהצעת שיתוף",
  "collaboration.declined": "דחיית הצעת שיתוף",
  "data.export_buyers": "ייצוא קונים",
  "data.export_properties": "ייצוא נכסים",
  "settings.update": "עדכון הגדרות",
  "system.update": "עדכון גרסת מערכת",
  "users.create": "הוספת איש צוות",
  "users.update": "עדכון איש צוות",
  "users.unlock": "שחרור נעילת התחברות",
  "voice_intake.create": "קליטת נכס בקול",
};

export default function SettingsPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const [tenant, setTenant] = useState<{
    name: string;
    whatsappNumber?: string;
    plan: string;
    leadWebhookKey?: string;
  } | null>(null);
  const [team, setTeam] = useState<TeamUser[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(() => {
    apiGet<{ name: string; whatsappNumber?: string; plan: string; leadWebhookKey?: string }>("/settings/tenant")
      .then(setTenant)
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 403) setForbidden(true);
      });
    apiGet<TeamUser[]>("/settings/users").then(setTeam).catch(() => undefined);
    apiGet<{ items: AuditRow[] }>("/settings/audit?limit=30")
      .then((r) => setAudit(r.items))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!authLoading && user) load();
  }, [authLoading, user, load]);

  async function saveTenant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const whatsapp = String(f.get("whatsappNumber") ?? "").replace(/\D/gu, "");
    try {
      await apiPatch("/settings/tenant", {
        name: String(f.get("name")).trim(),
        ...(whatsapp ? { whatsappNumber: whatsapp } : {}),
      });
      setMessage("✓ ההגדרות נשמרו");
      load();
    } catch (err: unknown) {
      setMessage(err instanceof ApiError ? err.message : "השמירה נכשלה");
    }
  }

  async function addUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const f = new FormData(form);
    try {
      const result = await apiPost<{ tempPassword: string }>("/settings/users", {
        name: String(f.get("newName")).trim(),
        email: String(f.get("newEmail")).trim(),
        role: String(f.get("newRole")),
      });
      setTempPassword(result.tempPassword);
      form.reset();
      load();
    } catch (err: unknown) {
      setMessage(err instanceof ApiError ? err.message : "הוספת המשתמש נכשלה");
    }
  }

  async function toggleActive(member: TeamUser) {
    await apiPatch(`/settings/users/${member.id}`, { isActive: !member.isActive });
    load();
  }

  async function changeRole(member: TeamUser, role: string) {
    await apiPatch(`/settings/users/${member.id}`, { role });
    load();
  }

  async function unlock(member: TeamUser) {
    await apiPost(`/settings/users/${member.id}/unlock`, {});
    setMessage(`✓ הנעילה של ${member.name} שוחררה — אפשר להתחבר מיד`);
    load();
  }

  if (authLoading) return <p aria-live="polite">טוען…</p>;
  if (forbidden) {
    return (
      <p role="alert" style={{ color: "var(--color-text-muted)" }}>
        אין לך הרשאה להגדרות המשרד — פנו לבעל המשרד.
      </p>
    );
  }

  return (
    <>
      <h1 className="mb-6 text-2xl font-bold">הגדרות המשרד</h1>

      {message ? (
        <p role="status" className="mb-4 rounded-lg border p-3" style={{ borderColor: "var(--color-primary)" }}>
          {message}
        </p>
      ) : null}

      <section aria-labelledby="office-heading" className="mb-8">
        <h2 id="office-heading" className="mb-3 text-lg font-semibold">פרטי המשרד</h2>
        {tenant ? (
          <form onSubmit={(e) => void saveTenant(e)} className="max-w-md">
            <div className="mb-4">
              <label htmlFor="name" className="mb-1 block font-medium">שם המשרד</label>
              <input id="name" name="name" defaultValue={tenant.name} required minLength={2} className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
            </div>
            <div className="mb-4">
              <label htmlFor="whatsappNumber" className="mb-1 block font-medium">
                מספר וואטסאפ עסקי <span className="font-normal">(לניתוב הודעות נכנסות)</span>
              </label>
              <input id="whatsappNumber" name="whatsappNumber" dir="ltr" placeholder="972501234567" defaultValue={tenant.whatsappNumber ?? ""} className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
            </div>
            <p className="mb-4 text-sm" style={{ color: "var(--color-text-muted)" }}>
              מסלול: <strong>{PLAN_LABELS[tenant.plan] ?? tenant.plan}</strong>
            </p>
            <Button type="submit">שמור</Button>
          </form>
        ) : (
          <p aria-live="polite">טוען…</p>
        )}
      </section>

      <section aria-labelledby="team-heading" className="mb-8">
        <h2 id="team-heading" className="mb-3 text-lg font-semibold">הצוות ({team.length})</h2>

        {tempPassword ? (
          <div role="alert" className="mb-4 rounded-xl border p-4" style={{ borderColor: "var(--color-success)" }}>
            <p className="font-medium">המשתמש נוצר! סיסמה זמנית (מוצגת פעם אחת בלבד):</p>
            <p className="mt-1 font-mono text-lg" dir="ltr">{tempPassword}</p>
            <Button variant="ghost" className="mt-2" onClick={() => setTempPassword(null)}>סגור</Button>
          </div>
        ) : null}

        {team.length > 0 ? (
          <div className="mb-4 overflow-x-auto rounded-xl border" style={{ borderColor: "var(--color-border)" }}>
            <table className="w-full">
              <caption className="mv-visually-hidden">אנשי הצוות במשרד: שם, תפקיד, סטטוס</caption>
              <thead style={{ background: "var(--color-surface)" }}>
                <tr>
                  <th scope="col" className="p-3 text-start">שם</th>
                  <th scope="col" className="p-3 text-start">תפקיד</th>
                  <th scope="col" className="p-3 text-start">כניסה אחרונה</th>
                  <th scope="col" className="p-3 text-start">סטטוס</th>
                </tr>
              </thead>
              <tbody>
                {team.map((member) => (
                  <tr key={member.id} className="border-t" style={{ borderColor: "var(--color-border)" }}>
                    <td className="p-3">
                      <span className="font-medium">{member.name}</span>
                      <span className="block text-sm" dir="ltr" style={{ color: "var(--color-text-muted)" }}>{member.email}</span>
                    </td>
                    <td className="p-3">
                      {member.role === "owner" || member.id === user?.id ? (
                        ROLE_LABELS[member.role] ?? member.role
                      ) : (
                        <>
                          <label htmlFor={`role_${member.id}`} className="mv-visually-hidden">
                            תפקיד של {member.name}
                          </label>
                          <select
                            id={`role_${member.id}`}
                            value={member.role}
                            onChange={(event) => void changeRole(member, event.target.value)}
                            className="rounded-lg border px-2 py-1.5"
                            style={inputStyle}
                          >
                            <option value="admin">מנהל</option>
                            <option value="agent">סוכן</option>
                            <option value="assistant">עוזר</option>
                            <option value="viewer">צפייה בלבד</option>
                          </select>
                        </>
                      )}
                    </td>
                    <td className="p-3">{member.lastLoginAt ? formatDate(member.lastLoginAt) : "—"}</td>
                    <td className="p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {member.locked ? (
                          <>
                            <span className="font-medium" style={{ color: "var(--color-danger)" }}>
                              🔒 נעול זמנית
                            </span>
                            <Button variant="secondary" onClick={() => void unlock(member)}>
                              שחרר נעילה
                            </Button>
                          </>
                        ) : null}
                        {member.role === "owner" || member.id === user?.id ? (
                          member.locked ? null : <span style={{ color: "var(--color-success)" }}>פעיל</span>
                        ) : (
                          <Button variant={member.isActive ? "ghost" : "secondary"} onClick={() => void toggleActive(member)}>
                            {member.isActive ? "השבת" : "הפעל מחדש"}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <form onSubmit={(e) => void addUser(e)} className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="newName" className="mb-1 block font-medium">שם</label>
            <input id="newName" name="newName" required minLength={2} className="rounded-lg border px-3 py-2.5" style={inputStyle} />
          </div>
          <div>
            <label htmlFor="newEmail" className="mb-1 block font-medium">אימייל</label>
            <input id="newEmail" name="newEmail" type="email" required dir="ltr" className="rounded-lg border px-3 py-2.5" style={inputStyle} />
          </div>
          <div>
            <label htmlFor="newRole" className="mb-1 block font-medium">תפקיד</label>
            <select id="newRole" name="newRole" defaultValue="agent" className="rounded-lg border px-3 py-2.5" style={inputStyle}>
              <option value="admin">מנהל</option>
              <option value="agent">סוכן</option>
              <option value="assistant">עוזר</option>
              <option value="viewer">צפייה בלבד</option>
            </select>
          </div>
          <Button type="submit">➕ הוסף איש צוות</Button>
        </form>
      </section>

      <WhatsAppStatusSection />

      {tenant ? <LeadWebhookSection initialKey={tenant.leadWebhookKey} /> : null}

      <ExportSection />

      <SystemUpdateSection />

      <section aria-labelledby="audit-heading">
        <h2 id="audit-heading" className="mb-1 text-lg font-semibold">יומן פעילות</h2>
        <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
          מי עשה מה ומתי — כל פעולה במערכת מתועדת ואינה ניתנת למחיקה.
        </p>
        {audit.length === 0 ? (
          <p style={{ color: "var(--color-text-muted)" }}>אין רישומים עדיין.</p>
        ) : (
          <ol className="flex flex-col gap-1 text-sm">
            {audit.map((row, index) => (
              <li key={index} className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--color-border)" }}>
                <span className="font-medium">{row.userName ?? "מערכת"}</span>
                {" · "}
                <span>{AUDIT_ACTION_LABELS[row.action] ?? row.action}</span>
                {" · "}
                <span style={{ color: "var(--color-text-muted)" }}>{formatDateTime(row.createdAt)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
