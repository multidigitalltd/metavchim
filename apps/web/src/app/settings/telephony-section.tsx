"use client";

import { useEffect, useState, type FormEvent } from "react";
import { apiDelete, apiGet, apiPost, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { IconInfo, IconWarning } from "../icons";

/**
 * חיבור מרכזיית הטלפון של המשרד.
 *
 * מה שמנהל משרד צריך לעשות בפועל: לבחור ספק, להעתיק כתובת אחת,
 * ולהדביק אותה במרכזייה. לכן הכתובת היא הדבר הבולט במסך אחרי
 * החיבור, עם כפתור העתקה — ולא פרט טכני בשורה קטנה.
 */

interface Provider {
  id: string;
  label: string;
  fields: { key: string; label: string; secret: boolean }[];
  clickToDial: boolean;
}

interface Status {
  connected: boolean;
  provider?: string;
  providerLabel?: string;
  webhookUrl?: string;
  lastEventAt?: string;
  lastEventKeys?: string;
  lastEventOk?: boolean;
  /** ‎no_phone | invalid_phone | no_call_id‎ — למה האירוע לא זוהה */
  lastEventIssue?: string;
  clickToDial: boolean;
  config: Record<string, unknown>;
  /** שמות הסודות ששמורים בפועל — בלי הערכים. */
  secretsSet?: string[];
}

/**
 * תבנית גוף ה-JSON להדבקה במסך ה-Webhook של 015.
 *
 * השמות הם **שמותיו של 015** (‎`#callid#`‎ וחבריו) ולא שמות פנימיים
 * שלנו: המנהל מדביק ולא מתרגם, והמפרסר יודע לקרוא אותם.
 */
const PBX015_TEMPLATE = `{
  "callid": "#callid#",
  "status": "#status#",
  "direction": "#direction#",
  "callerid_external": "#callerid_external#",
  "snumber": "#snumber#",
  "cnumber": "#cnumber#",
  "talktime": "#talktime#",
  "totaltime": "#totaltime#",
  "extension": "#extension#"
}`;

/**
 * למה האירוע לא זוהה — ולמי הבעיה שייכת.
 *
 * ההבחנה כאן אינה קוסמטית: `invalid_phone` הוא **מצב תקין**. כך נראית
 * שיחה ממספר חסוי, והיא נפוצה. הודעה שאומרת למנהל המשרד "המרכזייה
 * שולחת שדות שאיננו מכירים" במקרה הזה שולחת אותו לרדוף אחרי תקלה
 * שאינה קיימת — ובפעם הבאה שהאזהרה תופיע באמת, הוא כבר יתעלם ממנה.
 */
function issueExplanation(issue: string | undefined): {
  tone: "warning" | "muted";
  text: string;
  showKeys: boolean;
} {
  switch (issue) {
    case "invalid_phone":
      return {
        tone: "muted",
        text:
          "האירוע התקבל והובן, אבל המספר שהגיע אינו מספר טלפון תקין — כך נראית " +
          "שיחה ממספר חסוי. זו אינה תקלת הגדרה: שיחה ממספר גלוי תיקלט כרגיל.",
        showKeys: false,
      };
    case "no_fields":
      return {
        tone: "warning",
        text:
          "הבקשה הגיעה ריקה — בלי שום שדה. כמעט תמיד זה אומר שה-Content-Type " +
          "שבכותרות אינו תואם לתבנית: כותרת שאומרת JSON וגוף URL-encoded, או להפך. " +
          "ודאו שב-Headers כתוב content-type: application/json ושה-Template הוא ה-JSON שלמטה.",
        showKeys: false,
      };
    case "no_call_id":
      return {
        tone: "warning",
        text:
          "האירוע הגיע עם שדות, אבל בלי מזהה שיחה. בלעדיו אי אפשר לחבר את הצלצול, " +
          "המענה והניתוק לשיחה אחת. ודאו שהתבנית כוללת את השורה של callid.",
        showKeys: true,
      };
    default:
      // no_phone, וגם כל קוד עתידי שהמסך הזה עדיין אינו מכיר
      return {
        tone: "warning",
        text:
          "האירוע לא זוהה: לא נמצא בו מספר מתקשר. כלומר הכתובת נכונה, והמרכזייה " +
          "שולחת שמות שדות שהמערכת עדיין אינה מכירה.",
        showKeys: true,
      };
  }
}

export function TelephonySection() {
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [chosen, setChosen] = useState("generic");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedTemplate, setCopiedTemplate] = useState(false);

  function load(): void {
    apiGet<Provider[]>("/settings/telephony/providers")
      .then(setProviders)
      .catch(() => setProviders([]));
    apiGet<Status>("/settings/telephony")
      .then((res) => {
        setStatus(res);
        if (res.provider) setChosen(res.provider);
      })
      .catch(() => undefined);
  }

  useEffect(load, []);

  async function connect(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const provider = providers?.find((p) => p.id === chosen);
    const config: Record<string, string> = {};
    const secrets: Record<string, string> = {};
    for (const field of provider?.fields ?? []) {
      const value = String(form.get(field.key) ?? "").trim();
      // סוד ריק לא נשלח — כך עדכון שלוחה לא מוחק טוקן שכבר שמור
      if (field.secret) {
        if (value !== "") secrets[field.key] = value;
      } else {
        config[field.key] = value;
      }
    }
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      await apiPost("/settings/telephony", { provider: chosen, config, secrets });
      setMessage("✓ המרכזייה מחוברת — העתיקו את הכתובת והדביקו אותה בהגדרות המרכזייה");
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "החיבור נכשל");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(): Promise<void> {
    if (!window.confirm("לנתק את המרכזייה? הכתובת הנוכחית תפסיק לעבוד מיד.")) return;
    setBusy(true);
    try {
      await apiDelete("/settings/telephony");
      setMessage("המרכזייה נותקה");
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "הניתוק נכשל");
    } finally {
      setBusy(false);
    }
  }

  if (!providers || !status) return null;
  const provider = providers.find((p) => p.id === chosen);

  return (
    <section className="mv-list-card px-5 py-[17px]" aria-labelledby="telephony-heading">
      <h2 id="telephony-heading" className="m-0 mb-1" style={{ fontSize: 15.5, fontWeight: 800 }}>
        מרכזיית טלפון
      </h2>
      <p className="m-0 mb-3 text-[13px]" style={{ color: "var(--color-text-muted)" }}>
        שיחה נכנסת תקפיץ את שם הלקוח לפני שעונים, ותירשם אוטומטית בכרטיס שלו.
        מספר שאינו מוכר שדיברתם איתו ייפתח כליד.
      </p>

      {message ? (
        <p role="status" className="m-0 mb-3 text-sm" style={{ color: "var(--color-primary)" }}>
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="m-0 mb-3 text-sm" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : null}

      {status.connected ? (
        <div
          className="mb-3 rounded-[13px] border p-3.5"
          style={{ borderColor: "var(--color-border)", background: "var(--color-field)" }}
        >
          <p className="m-0 text-sm font-bold">
            ✓ מחובר · {status.providerLabel}
          </p>
          <p className="m-0 mt-1 text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
            {status.lastEventAt
              ? `אירוע אחרון: ${formatDateTime(status.lastEventAt)}`
              : "טרם התקבל אירוע מהמרכזייה"}
          </p>

          <p className="m-0 mb-1 mt-3 text-[13px] font-bold">
            הכתובת להדבקה בהגדרות המרכזייה
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code
              dir="ltr"
              className="min-w-0 flex-1 truncate rounded px-2 py-1.5 text-[12.5px]"
              style={{ background: "var(--color-bg)" }}
            >
              {status.webhookUrl}
            </code>
            <button
              type="button"
              className="mv-btn-plain"
              onClick={() => {
                void navigator.clipboard.writeText(status.webhookUrl ?? "");
                setCopied(true);
              }}
            >
              {copied ? "✓ הועתק" : "העתק"}
            </button>
          </div>
          {/*
            אבחון: שלושה מצבים שונים לגמרי, ובלי ההבחנה ביניהם אי אפשר
            לדעת אם הבעיה אצל הספק או אצלנו.
          */}
          <div className="mt-2.5 rounded-lg border p-2.5" style={{ borderColor: "var(--color-border)" }}>
            {status.lastEventAt === undefined ? (
              <p className="m-0 text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
                טרם התקבל אף אירוע מהמרכזייה. אם כבר הזנתם את הכתובת אצל הספק —
                בצעו שיחת בדיקה, ואם עדיין ריק כאן, הכתובת אצלו אינה מצביעה לכאן.
              </p>
            ) : status.lastEventOk === false ? (
              (() => {
                const why = issueExplanation(status.lastEventIssue);
                return (
                  <>
                    <p
                      className="m-0 text-[12.5px]"
                      style={{
                        color: why.tone === "warning" ? "var(--color-warning)" : "var(--color-text-muted)",
                      }}
                    >
                      {why.tone === "warning" ? <IconWarning s={15} /> : <IconInfo s={15} />}{" "}
                      האירוע האחרון הגיע ב-{new Date(status.lastEventAt).toLocaleString("he-IL")}.{" "}
                      {why.text}
                    </p>
                    {why.showKeys && status.lastEventKeys ? (
                      <>
                        <p
                          className="m-0 mt-1 text-[12px]"
                          dir="ltr"
                          style={{ color: "var(--color-text-muted)" }}
                        >
                          {status.lastEventKeys}
                        </p>
                        <p className="m-0 mt-1 text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
                          שלחו לנו את השורה הזו — היא כל מה שצריך כדי להוסיף את המיפוי.
                        </p>
                      </>
                    ) : null}
                  </>
                );
              })()
            ) : (
              <p className="m-0 text-[12.5px]" style={{ color: "var(--color-success)" }}>
                ✓ אירוע אחרון התקבל וזוהה ב-{new Date(status.lastEventAt).toLocaleString("he-IL")}
              </p>
            )}
          </div>

          {status.provider === "015" ? (
            /*
              מסך ה-Webhook של 015 אינו "הדביקו כתובת וזהו": הוא דורש
              לבחור אירועים, שיטה, כותרת ותבנית גוף — וכל אחד מהם יכול
              להיות נכון בפני עצמו ועדיין לא לשלוח כלום. ההוראות כאן
              הן בדיוק מה שצריך להיות בכל שדה, ולא הסבר כללי.
            */
            <details className="mt-2.5">
              <summary className="cursor-pointer text-[13px] font-bold">
                מה להגדיר במסך ה-Webhook של 015
              </summary>
              <ol
                className="m-0 mt-2 pr-5 text-[12.5px]"
                style={{ color: "var(--color-text-muted)" }}
              >
                <li className="mb-1">
                  <b>אירועים</b> — סמנו <b>Calling</b>, <b>Answer</b> ו-<b>Hangup</b>. בלי
                  אירוע מסומן אחד לפחות המרכזייה לא שולחת כלום, וזה המצב שנראה כאן
                  כ&quot;טרם התקבל אף אירוע&quot;.
                </li>
                <li className="mb-1">
                  <b>URL</b> — הכתובת שלמעלה. <b>Method</b> — ‎POST‎.
                </li>
                <li className="mb-1">
                  <b>Headers</b> — <code dir="ltr">content-type: application/json</code>
                </li>
                <li className="mb-1">
                  <b>Template</b> — הדביקו את זה כמו שהוא:
                </li>
              </ol>
              <pre
                dir="ltr"
                className="mt-1 overflow-x-auto rounded p-2 text-[11.5px]"
                style={{ background: "var(--color-bg)" }}
              >
                {PBX015_TEMPLATE}
              </pre>
              <button
                type="button"
                className="mv-btn-plain"
                onClick={() => {
                  void navigator.clipboard.writeText(PBX015_TEMPLATE);
                  setCopiedTemplate(true);
                }}
              >
                {copiedTemplate ? "✓ הועתק" : "העתק תבנית"}
              </button>
              <p className="m-0 mt-2 text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
                ‎<code dir="ltr">talktime</code> ו-<code dir="ltr">totaltime</code> שניהם
                נחוצים: ההפרש ביניהם הוא מה שמבדיל בין שיחה שנענתה לשיחה שרק צלצלה.
              </p>
            </details>
          ) : (
            <p className="m-0 mt-2 text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
              המרכזייה יכולה לקרוא לכתובת ב-GET עם פרמטרים או ב-POST. השדות הנדרשים:
              מספר המתקשר, מזהה שיחה, וסטטוס (‎ringing / answered / hangup‎).
            </p>
          )}

          <button type="button" className="mv-btn-plain mt-3" disabled={busy} onClick={() => void disconnect()}>
            נתק מרכזייה
          </button>
        </div>
      ) : null}

      <form onSubmit={(e) => void connect(e)} className="max-w-md">
        <div className="mb-3">
          <label htmlFor="tel-provider" className="mb-1 block text-sm font-semibold">
            ספק
          </label>
          <select
            id="tel-provider"
            value={chosen}
            onChange={(event) => setChosen(event.target.value)}
            className="w-full rounded-lg border px-3 py-2.5"
            style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          {provider && provider.fields.length === 0 ? (
            <p className="m-0 mt-1 text-xs" style={{ color: "var(--color-text-muted)" }}>
              לא נדרשים פרטים — מקבלים כתובת ומדביקים אותה במרכזייה.
            </p>
          ) : null}
        </div>

        {(provider?.fields ?? []).map((field) => {
          const stored = (status.secretsSet ?? []).includes(field.key);
          return (
            <div key={field.key} className="mb-3">
              <label htmlFor={`tel-${field.key}`} className="mb-1 block text-sm font-semibold">
                {field.label}
              </label>
              <input
                id={`tel-${field.key}`}
                name={field.key}
                type={field.secret ? "password" : "text"}
                dir="ltr"
                /*
                  ‎`new-password`‎ ולא `off`: כרום מתעלם מ-`off` בשדות
                  סיסמה וממלא לתוכם סיסמה שמורה של המשתמש — כלומר את
                  הסיסמה הפרטית שלו לתוך שדה הסיסמה של המרכזייה.
                */
                autoComplete={field.secret ? "new-password" : "off"}
                defaultValue={field.secret ? "" : String(status.config[field.key] ?? "")}
                placeholder={
                  field.secret && stored ? "שמורה — השאירו ריק כדי לא לשנות" : undefined
                }
                className="w-full rounded-lg border px-3 py-2.5"
                style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
              />
              {/*
                ההבחנה בין "שמור" ל"חסר" היא כל העניין: קודם שני המצבים
                נראו זהים — שדה ריק עם אותו טקסט — והחיבור נראה תקין
                בזמן שהחיוג נכשל על סוד שלא היה שם.
              */}
              {field.secret && status.connected ? (
                <p
                  className="m-0 mt-1 text-xs"
                  style={{ color: stored ? "var(--color-success)" : "var(--color-danger)" }}
                >
                  {stored ? (
                    "✓ שמורה בשרת"
                  ) : (
                    <>
                      <IconWarning s={15} /> לא שמורה — החיוג היוצא לא יעבוד בלעדיה
                    </>
                  )}
                </p>
              ) : null}
            </div>
          );
        })}

        <button type="submit" className="mv-btn-action" disabled={busy}>
          {status.connected ? "עדכן חיבור" : "חבר מרכזייה"}
        </button>
      </form>

    </section>
  );
}
