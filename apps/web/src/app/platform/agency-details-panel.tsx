"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@metavchim/ui";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { Notice } from "../notice";

/**
 * ‎**מי המשרד הזה, מה יש בו, ומה הוא משלם — במקום שבו שואלים.**
 *
 * ## למה לא בטבלה
 *
 * ‏הטבלה עונה על „מי מכל המשרדים”: מסלול, סטטוס, מספר משתמשים.
 * ‏זו סריקה, והיא נשענת על כך שכל שורה קצרה. פרטי קשר, ספירות
 * ‏ופעילות הם „מה עם **המשרד הזה**” — שאלה שנשאלת על אחד, ולכן
 * ‏הם נטענים כשהשורה נפתחת ולא בכל טעינה של המסך. משרד שאיש לא
 * ‏פתח אינו עולה דבר.
 *
 * ## ארבע קבוצות ולא רשימת שדות
 *
 * ‏„מי הם”, „מה יש להם”, „מה הם משלמים”, „האם הם חיים”. בעל
 * ‏הפלטפורמה שואל את ארבע השאלות בנפרד — כשלקוח מתקשר הוא צריך
 * ‏טלפון, כשהוא בודק נטישה הוא צריך את הכניסה האחרונה — וערבוב
 * ‏שלהן בטור אחד הופך מסך לטופס.
 */

interface Details {
  contact: {
    ownerName: string | null;
    ownerEmail: string | null;
    ownerPhone: string | null;
    officePhone: string | null;
    officeAddress: string | null;
    licenseNumber: string | null;
  };
  usage: { properties: number; buyers: number; leads: number; calls: number };
  billing: {
    signupSource: string;
    couponCode: string | null;
    couponPercentOff: number | null;
    couponPlanCode: string | null;
    whatsappAgentSeatsExtra: number;
  };
  activity: {
    lastLoginAt: string | null;
    whatsappConnected: boolean;
    telephonyConnected: boolean;
    emailDomainConnected: boolean;
    filesLocked: boolean;
  };
}

/** ‏„—” ולא שדה ריק: חסר שנראה כמו רווח נקרא כתקלה בטעינה. */
function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-sm" style={{ color: "var(--color-text-muted)" }}>
        {label}
      </dt>
      <dd className={value === null ? "" : "font-medium"}>
        {value === null ? <span style={{ color: "var(--color-text-muted)" }}>—</span> : value}
      </dd>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="mb-2 font-semibold">{title}</h4>
      <dl className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        {children}
      </dl>
    </section>
  );
}

export function AgencyDetailsPanel({ tenantId, agencyName }: { tenantId: string; agencyName: string }) {
  const [details, setDetails] = useState<Details | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setDetails(await apiGet<Details>(`/platform/agencies/${tenantId}/details`));
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "טעינת הפרטים נכשלה");
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * ‎**השליחה אומרת למי היא הלכה.** „נשלח” לבדו משאיר את השולח
   * ‏בלי לדעת אם הכתובת שבידיו היא זו שקיבלה — והשרת הוא היחיד
   * ‏שיודע מי הבעלים הפעיל.
   */
  const send = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setSending(true);
    setError(null);
    try {
      const res = await apiPost<{ sentTo: string }>(`/platform/agencies/${tenantId}/email`, {
        subject: String(form.get("subject") ?? ""),
        body: String(form.get("body") ?? ""),
      });
      setSent(res.sentTo);
      setComposing(false);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "השליחה נכשלה");
    } finally {
      setSending(false);
    }
  };

  if (error !== null && details === null) return <Notice tone="danger">{error}</Notice>;
  if (details === null) return <p style={{ color: "var(--color-text-muted)" }}>טוען פרטים…</p>;

  const { contact, usage, billing, activity } = details;
  const connections = [
    activity.whatsappConnected ? "וואטסאפ" : null,
    activity.telephonyConnected ? "מרכזייה" : null,
    activity.emailDomainConnected ? "דומיין מייל" : null,
  ].filter((x): x is string => x !== null);

  return (
    <div className="grid gap-5">
      {error !== null ? <Notice tone="danger">{error}</Notice> : null}
      {sent !== null ? <Notice tone="success">‏המייל נשלח אל {sent}</Notice> : null}

      <Group title="קשר">
        <Field label="בעל המשרד" value={contact.ownerName} />
        <Field label="דוא״ל הבעלים" value={contact.ownerEmail} />
        <Field label="טלפון הבעלים" value={contact.ownerPhone} />
        <Field label="טלפון המשרד" value={contact.officePhone} />
        <Field label="כתובת" value={contact.officeAddress} />
        <Field label="מספר רישיון" value={contact.licenseNumber} />
      </Group>

      <Group title="שימוש">
        <Field label="נכסים" value={String(usage.properties)} />
        <Field label="קונים" value={String(usage.buyers)} />
        <Field label="לידים" value={String(usage.leads)} />
        <Field label="שיחות" value={String(usage.calls)} />
      </Group>

      <Group title="מנוי וכסף">
        <Field
          label="מקור ההרשמה"
          value={billing.signupSource === "self" ? "נרשם עצמאית" : "הוקם ידנית"}
        />
        <Field
          label="קופון"
          value={
            billing.couponCode === null
              ? null
              : `${billing.couponCode}${billing.couponPercentOff === null ? "" : ` · ${String(billing.couponPercentOff)}%`}`
          }
        />
        <Field label="הקופון הוגבל למסלול" value={billing.couponPlanCode} />
        <Field
          label="מקומות ואטסאפ נוספים"
          value={billing.whatsappAgentSeatsExtra === 0 ? null : String(billing.whatsappAgentSeatsExtra)}
        />
      </Group>

      <Group title="פעילות">
        <Field
          label="כניסה אחרונה"
          value={activity.lastLoginAt === null ? null : formatDate(activity.lastLoginAt)}
        />
        <Field label="חיבורים פעילים" value={connections.length === 0 ? null : connections.join(" · ")} />
        {/* ‏נעילת קבצים היא מצב מחיקה — היא נאמרת ולא נרמזת */}
        {activity.filesLocked ? <Field label="קבצים" value="נעולים (מחיקת משרד)" /> : null}
      </Group>

      <div>
        {composing ? (
          <form onSubmit={(e) => void send(e)} className="grid gap-3">
            <p style={{ color: "var(--color-text-muted)" }}>
              ‏ההודעה תישלח אל {contact.ownerEmail ?? "בעל המשרד"} מהשולח של המערכת.
            </p>
            <label className="grid gap-1">
              <span className="font-medium">נושא</span>
              <input
                name="subject"
                required
                minLength={2}
                maxLength={200}
                className="rounded-lg border px-3 py-2.5"
                style={{ borderColor: "var(--color-input-border)", background: "var(--color-bg)", color: "var(--color-text)" }}
              />
            </label>
            <label className="grid gap-1">
              <span className="font-medium">תוכן</span>
              <textarea
                name="body"
                required
                minLength={2}
                maxLength={20000}
                rows={6}
                className="rounded-lg border px-3 py-2.5"
                style={{ borderColor: "var(--color-input-border)", background: "var(--color-bg)", color: "var(--color-text)" }}
              />
            </label>
            <div className="flex gap-2">
              <Button type="submit" disabled={sending}>
                {sending ? "שולח…" : "שלח"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setComposing(false)}>
                ביטול
              </Button>
            </div>
          </form>
        ) : (
          <Button
            variant="secondary"
            disabled={contact.ownerEmail === null}
            onClick={() => {
              setSent(null);
              setComposing(true);
            }}
          >
            {contact.ownerEmail === null ? "אין בעלים פעיל לשלוח אליו" : `שליחת מייל ל${agencyName}`}
          </Button>
        )}
      </div>
    </div>
  );
}
