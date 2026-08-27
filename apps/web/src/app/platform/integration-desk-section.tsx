"use client";

import { useEffect, useState } from "react";
import { Button } from "@metavchim/ui";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { IconPhone } from "../icons";
import { Notice } from "../notice";

/**
 * שולחן החיבורים — **לתקן מרכזייה בלי להיכנס למשרד.**
 *
 * ## למה המסך הזה קיים
 *
 * חיבור מרכזייה הוא הצעד הטכני היחיד שהמשרד עושה לבד, ומשרדים
 * נתקעים בו: שם משתמש של ספק, כתובת Webhook שצריך להדביק במקום
 * הנכון אצל המרכזייה, שדה שמגיע בשם אחר. עד היום הדרך היחידה לעזור
 * הייתה לבקש מהמשרד לפתוח חלון גישת תמיכה ואז להיכנס כמשתמש שלו —
 * כלומר לקבל את הלידים, הלקוחות, ההקלטות והכספים בשביל לתקן שדה
 * טכני אחד.
 *
 * כאן אין כניסה למשרד: המסך קורא וכותב אל טבלת החיבורים בלבד, ואין
 * ממנו נתיב לשום נתון של לקוח. הגבול נאכף בשרת ובמבחן מבני, לא
 * בזהירות של מי שכותב את המסך הבא.
 *
 * ## מה שהמסך אומר בקול רם
 *
 * שכל פעולה כאן נרשמת ביומן הפעילות **של המשרד** ומייצרת אצלו
 * התראה. זו התמורה לכך שלא צריך לבקש ממנו רשות מראש, והיא צריכה
 * להיות מול העיניים של מי שלוחץ — לא בתיעוד.
 */

interface ProviderField {
  key: string;
  label: string;
  secret: boolean;
}

interface DeskProvider {
  id: string;
  label: string;
  fields: ProviderField[];
}

interface DeskStatus {
  agencyName: string;
  telephony: {
    connected: boolean;
    provider?: string;
    providerLabel?: string;
    status?: string;
    webhookUrl?: string;
    lastEventAt?: string;
    lastEventKeys?: string;
    lastEventOk?: boolean;
    lastEventIssue?: string;
    secretsSet: string[];
    config: Record<string, unknown>;
  };
  providers: DeskProvider[];
}

const inputStyle = {
  borderColor: "var(--color-input-border)",
  background: "var(--color-field)",
} as const;

export function IntegrationDeskSection({
  agencies,
}: {
  agencies: { id: string; name: string }[];
}) {
  const [agencyId, setAgencyId] = useState("");
  const [data, setData] = useState<DeskStatus | null>(null);
  const [provider, setProvider] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (agencyId === "") {
      setData(null);
      return;
    }
    setError(null);
    setDone(null);
    apiGet<DeskStatus>(`/platform/agencies/${agencyId}/integrations`)
      .then((res) => {
        setData(res);
        setProvider(res.telephony.provider ?? res.providers[0]?.id ?? "");
        /*
         * הטופס נטען עם מה ששמור — חוץ מהסודות, שאינם חוזרים
         * מהשרת מלכתחילה. שדה סוד ריק פירושו "אל תיגע", ולכן
         * הוא נשאר ריק גם כשיש ערך שמור.
         */
        const loaded: Record<string, string> = {};
        for (const [key, value] of Object.entries(res.telephony.config)) {
          if (typeof value === "string") loaded[key] = value;
        }
        setValues(loaded);
      })
      .catch(() => setError("טעינת החיבורים נכשלה"));
  }, [agencyId]);

  const current = data?.providers.find((p) => p.id === provider);

  async function save(): Promise<void> {
    if (!data || !current) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const config: Record<string, string> = {};
      const secrets: Record<string, string> = {};
      for (const field of current.fields) {
        const value = (values[field.key] ?? "").trim();
        if (field.secret) {
          // ריק = לא נגענו. כך שמירה חוזרת אינה מוחקת סיסמה שמורה
          if (value !== "") secrets[field.key] = value;
        } else {
          config[field.key] = value;
        }
      }
      await apiPost(`/platform/agencies/${agencyId}/integrations/telephony`, {
        provider,
        config,
        secrets,
      });
      setDone(`נשמר אצל ${data.agencyName}. המשרד קיבל התראה, והפעולה רשומה ביומן שלו.`);
      const fresh = await apiGet<DeskStatus>(`/platform/agencies/${agencyId}/integrations`);
      setData(fresh);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "השמירה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="integration-desk-heading"
      id="integration-desk"
      className="mb-8 rounded-xl border p-4"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <h2 id="integration-desk-heading" className="mb-1 text-lg font-semibold">
        <IconPhone s={16} /> שולחן החיבורים — מרכזייה של משרד
      </h2>
      <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
        הגדרת המרכזייה של משרד שנתקע, בלי כניסה לחשבון שלו ובלי לבקש ממנו
        לפתוח גישת תמיכה. המסך הזה נוגע בהגדרות החיבור בלבד — לא בלידים,
        לא בלקוחות, לא בשיחות ולא בכספים. <b>כל שמירה נרשמת ביומן הפעילות
        של המשרד ושולחת לו התראה.</b>
      </p>

      <label htmlFor="desk-agency" className="mb-1 block text-sm font-medium">
        משרד
      </label>
      <select
        id="desk-agency"
        value={agencyId}
        onChange={(e) => setAgencyId(e.target.value)}
        className="mb-3 rounded-lg border px-3 py-2.5"
        style={inputStyle}
      >
        <option value="">בחרו משרד…</option>
        {agencies.map((agency) => (
          <option key={agency.id} value={agency.id}>
            {agency.name}
          </option>
        ))}
      </select>

      {error ? <Notice tone="danger">{error}</Notice> : null}
      {done ? <Notice tone="success">{done}</Notice> : null}

      {data ? (
        <>
          {/*
            האבחון לפני הטופס: השאלה הראשונה היא תמיד "האם המרכזייה
            בכלל פונה אלינו", ומי שרואה אירוע מלפני דקה מחפש בעיה
            אחרת לגמרי ממי שלא ראה אף אירוע.
          */}
          <div
            className="mb-3 rounded-lg border p-3 text-sm"
            style={{ borderColor: "var(--color-border)", background: "var(--color-table-head)" }}
          >
            {data.telephony.connected ? (
              <>
                <p className="m-0">
                  מחובר: <b>{data.telephony.providerLabel}</b>
                  {data.telephony.status !== "active" ? ` (${data.telephony.status})` : ""}
                </p>
                <p className="m-0 mt-1">
                  כתובת ה-Webhook למרכזייה:{" "}
                  <span dir="ltr" className="font-mono">
                    {data.telephony.webhookUrl}
                  </span>
                </p>
                <p className="m-0 mt-1">
                  {data.telephony.lastEventAt
                    ? `אירוע אחרון: ${formatDateTime(data.telephony.lastEventAt)}`
                    : "טרם התקבל אף אירוע מהמרכזייה"}
                  {data.telephony.lastEventOk === false ? " — הגיע ולא זוהה" : ""}
                  {data.telephony.lastEventIssue ? ` (${data.telephony.lastEventIssue})` : ""}
                </p>
                {data.telephony.lastEventKeys ? (
                  <p className="m-0 mt-1" style={{ color: "var(--color-text-muted)" }}>
                    שדות באירוע האחרון:{" "}
                    <span dir="ltr" className="font-mono">
                      {data.telephony.lastEventKeys}
                    </span>
                  </p>
                ) : null}
              </>
            ) : (
              <p className="m-0">למשרד הזה אין עדיין חיבור מרכזייה.</p>
            )}
          </div>

          <label htmlFor="desk-provider" className="mb-1 block text-sm font-medium">
            ספק
          </label>
          <select
            id="desk-provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="mb-3 rounded-lg border px-3 py-2.5"
            style={inputStyle}
          >
            {data.providers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>

          {current && current.fields.length > 0 ? (
            <div className="mb-3 flex flex-col gap-3">
              {current.fields.map((field) => (
                <label key={field.key} htmlFor={`desk-${field.key}`} className="flex flex-col gap-1 text-sm">
                  <span>
                    {field.label}
                    {field.secret ? (
                      <span style={{ color: "var(--color-text-muted)" }}>
                        {data.telephony.secretsSet.includes(field.key)
                          ? " — שמור. השאירו ריק כדי לא לשנות"
                          : " — לא הוזן"}
                      </span>
                    ) : null}
                  </span>
                  <input
                    id={`desk-${field.key}`}
                    type={field.secret ? "password" : "text"}
                    autoComplete="off"
                    dir="ltr"
                    value={values[field.key] ?? ""}
                    onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                    className="rounded-lg border px-3 py-2.5"
                    style={inputStyle}
                  />
                </label>
              ))}
            </div>
          ) : (
            <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
              לספק הזה אין שדות להגדרה — די בכתובת ה-Webhook שתופיע אחרי השמירה.
            </p>
          )}

          <Button disabled={busy} onClick={() => void save()}>
            {busy ? "שומר…" : "שמור עבור המשרד"}
          </Button>
        </>
      ) : null}
    </section>
  );
}
