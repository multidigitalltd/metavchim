"use client";

import { useEffect, useState, type FormEvent } from "react";
import { apiDelete, apiGet, apiPost, ApiError } from "@/lib/api";
import { useCopy } from "@/lib/clipboard";
import { formatDateTime } from "@/lib/format";
import { IconInfo, IconWarning } from "../icons";
import { LoadError } from "../load-error";
import { Notice } from "../notice";
import { importSentences, type RecordingImportSummary } from "@metavchim/shared";

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

/*
 * המונים עצמם מגיעים מ-`RecordingImportSummary` שבחבילה המשותפת —
 * שם גם נבנים המשפטים, ושם יש בדיקות. כאן נוסף רק מה שאינו משפט.
 */
interface ImportResult extends RecordingImportSummary {
  /** שמות השדות בשורה שהספק החזיר — שמות בלבד, בלי ערכים */
  rowKeys: string[];
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
      /*
       * no_phone, וגם כל קוד עתידי שהמסך הזה עדיין אינו מכיר.
       *
       * שתי סיבות אפשריות, והרשימה שמתחת מכריעה ביניהן: שדה שאיננו
       * מכירים יופיע בשם שאינו ברשימה, ושדה שהספק שלח **ריק** מסומן
       * במפורש ‹ריק›. הניסוח הקודם הציג רק את הראשונה, ושלח לחפש
       * מיפוי חסר אצלנו כשהתקלה הייתה תבנית חסרה אצל הספק.
       */
      return {
        tone: "warning",
        text:
          "האירוע לא זוהה: לא נמצא בו מספר מתקשר. הכתובת נכונה והפנייה הגיעה — " +
          "כלומר או שהמרכזייה שולחת שם שדה שהמערכת אינה מכירה, או שהיא שולחת את " +
          "השדה ריק. ברשימה שמתחת: שדה שערכו מסומן ‹ריק› הגיע ריק, וזו הגדרת " +
          "התבנית אצל הספק.",
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
  /*
   * שני מצבי העתקה נפרדים ולא אחד: הכתובת והתבנית הם שני כפתורים
   * שיכולים להילחץ ברצף, ומצב משותף היה מכבה את ההודעה של הראשון.
   */
  const urlClipboard = useCopy();
  const templateClipboard = useCopy();

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
      <h2 id="telephony-heading" className="m-0 mb-1" style={{ fontSize: "calc(16.5 / 16 * 1rem)", fontWeight: 800 }}>
        מרכזיית טלפון
      </h2>
      <p className="m-0 mb-3 text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-muted)" }}>
        שיחה נכנסת תקפיץ את שם הלקוח לפני שעונים, ותירשם אוטומטית בכרטיס שלו.
        מספר שאינו מוכר שדיברתם איתו ייפתח כליד.
      </p>

      {message ? (
        <Notice tone="success">{message}</Notice>
      ) : null}
      {error ? (
        <Notice tone="danger">{error}</Notice>
      ) : null}

      {status.connected ? (
        <div
          className="mb-3 rounded-[13px] border p-3.5"
          style={{ borderColor: "var(--color-border)", background: "var(--color-field)" }}
        >
          <p className="m-0 text-sm font-bold">
            ✓ מחובר · {status.providerLabel}
          </p>
          <p className="m-0 mt-1 text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
            {status.lastEventAt
              ? `אירוע אחרון: ${formatDateTime(status.lastEventAt)}`
              : "טרם התקבל אירוע מהמרכזייה"}
          </p>

          <p className="m-0 mb-1 mt-3 text-[length:var(--type-caption-lg)] font-bold">
            הכתובת להדבקה בהגדרות המרכזייה
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code
              dir="ltr"
              className="min-w-0 flex-1 truncate rounded px-2 py-1.5 text-[length:var(--type-caption)]"
              style={{ background: "var(--color-bg)" }}
            >
              {status.webhookUrl}
            </code>
            <button
              type="button"
              className="mv-btn-plain"
              onClick={() => {
                void urlClipboard.copy(status.webhookUrl ?? "");
              }}
            >
              העתק
            </button>
          </div>
          {/*
            הודעה נפרדת ולא תווית מתחלפת: כישלון בהעתקה צריך להיאמר,
            וכפתור שהשם שלו מתחלף מבלבל קורא מסך שמגיע אליו אחר כך.
            הכתובת עצמה מוצגת מעליו, ולכן ההעתקה הידנית זמינה תמיד.
          */}
          <p role="status" className="m-0 mt-1 text-[length:var(--type-caption)]">
            {urlClipboard.state === "copied" ? (
              <span style={{ color: "var(--color-success)" }}>✓ הכתובת הועתקה</span>
            ) : urlClipboard.state === "failed" ? (
              <span style={{ color: "var(--color-danger)" }}>
                הדפדפן חסם את הגישה ללוח — סמנו את הכתובת שמעל והעתיקו ידנית
              </span>
            ) : null}
          </p>
          {/*
            אבחון: שלושה מצבים שונים לגמרי, ובלי ההבחנה ביניהם אי אפשר
            לדעת אם הבעיה אצל הספק או אצלנו.
          */}
          <div className="mt-2.5 rounded-lg border p-2.5" style={{ borderColor: "var(--color-border)" }}>
            {status.lastEventAt === undefined ? (
              <p className="m-0 text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
                טרם התקבל אף אירוע מהמרכזייה. אם כבר הזנתם את הכתובת אצל הספק —
                בצעו שיחת בדיקה, ואם עדיין ריק כאן, הכתובת אצלו אינה מצביעה לכאן.
              </p>
            ) : status.lastEventOk === false ? (
              (() => {
                const why = issueExplanation(status.lastEventIssue);
                return (
                  <>
                    <p
                      className="m-0 text-[length:var(--type-caption)]"
                      style={{
                        color: why.tone === "warning" ? "var(--color-warning)" : "var(--color-text-muted)",
                      }}
                    >
                      {why.tone === "warning" ? <IconWarning s={15} /> : <IconInfo s={15} />}{" "}
                      האירוע האחרון הגיע ב-{formatDateTime(status.lastEventAt)}.{" "}
                      {why.text}
                    </p>
                    {why.showKeys && status.lastEventKeys ? (
                      <>
                        <p
                          className="m-0 mt-1 text-[length:var(--type-caption)]"
                          dir="ltr"
                          style={{ color: "var(--color-text-muted)" }}
                        >
                          {status.lastEventKeys}
                        </p>
                        <p className="m-0 mt-1 text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
                          שלחו לנו את השורה הזו — היא כל מה שצריך כדי להוסיף את המיפוי.
                        </p>
                      </>
                    ) : null}
                  </>
                );
              })()
            ) : (
              <p className="m-0 text-[length:var(--type-caption)]" style={{ color: "var(--color-success)" }}>
                ✓ אירוע אחרון התקבל וזוהה ב-{formatDateTime(status.lastEventAt)}
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
              <summary className="cursor-pointer text-[length:var(--type-caption-lg)] font-bold">
                מה להגדיר במסך ה-Webhook של 015
              </summary>
              <ol
                className="m-0 mt-2 pr-5 text-[length:var(--type-caption)]"
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
                className="mt-1 overflow-x-auto rounded p-2 text-[length:var(--type-caption)]"
                style={{ background: "var(--color-bg)" }}
              >
                {PBX015_TEMPLATE}
              </pre>
              <button
                type="button"
                className="mv-btn-plain"
                onClick={() => {
                  void templateClipboard.copy(PBX015_TEMPLATE);
                }}
              >
                העתק תבנית
              </button>
              <p role="status" className="m-0 mt-1 text-[length:var(--type-caption)]">
                {templateClipboard.state === "copied" ? (
                  <span style={{ color: "var(--color-success)" }}>✓ התבנית הועתקה</span>
                ) : templateClipboard.state === "failed" ? (
                  <span style={{ color: "var(--color-danger)" }}>
                    הדפדפן חסם את הגישה ללוח — סמנו את התבנית שמעל והעתיקו ידנית
                  </span>
                ) : null}
              </p>
              <p className="m-0 mt-2 text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
                ‎<code dir="ltr">talktime</code> ו-<code dir="ltr">totaltime</code> שניהם
                נחוצים: ההפרש ביניהם הוא מה שמבדיל בין שיחה שנענתה לשיחה שרק צלצלה.
              </p>
            </details>
          ) : (
            <p className="m-0 mt-2 text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
              המרכזייה יכולה לקרוא לכתובת ב-GET עם פרמטרים או ב-POST. השדות הנדרשים:
              מספר המתקשר, מזהה שיחה, וסטטוס (‎ringing / answered / hangup‎).
            </p>
          )}

          {status.provider === "015" ? <ImportRecordings /> : null}

          <button type="button" className="mv-btn-plain mt-3" disabled={busy} onClick={() => void disconnect()}>
            נתק מרכזייה
          </button>
        </div>
      ) : null}

      <form method="post" onSubmit={(e) => void connect(e)} className="max-w-md">
        <div className="mb-3">
          <label htmlFor="tel-provider" className="mb-1 block text-sm font-semibold">
            ספק
          </label>
          <select
            id="tel-provider"
            value={chosen}
            onChange={(event) => setChosen(event.target.value)}
            className="w-full rounded-lg border px-3 py-2.5"
            style={{ borderColor: "var(--color-input-border)", background: "var(--color-bg)" }}
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          {provider && provider.fields.length === 0 ? (
            <p className="m-0 mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
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
                style={{ borderColor: "var(--color-input-border)", background: "var(--color-bg)" }}
              />
              {/*
                ההבחנה בין "שמור" ל"חסר" היא כל העניין: קודם שני המצבים
                נראו זהים — שדה ריק עם אותו טקסט — והחיבור נראה תקין
                בזמן שהחיוג נכשל על סוד שלא היה שם.
              */}
              {field.secret && status.connected ? (
                <p
                  className="m-0 mt-1 text-sm"
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

      {/* הקצאת קווי SIP — של המנהל, לא של כל סוכן בפרופיל שלו */}
      {status.connected ? <TeamSipLines /> : null}
    </section>
  );
}

interface TeamLine {
  userId: string;
  name: string;
  username: string;
  hasPassword: boolean;
}

/**
 * קווי הסופטפון של הצוות — מוקצים כאן, בידי מנהל המשרד.
 *
 * הקווים והסיסמאות מגיעים ממנהל המרכזייה אל מנהל המשרד — ולכן הוא
 * זה שמזין אותם, פעם אחת לכל סוכן. הסוכן עצמו רק לוחץ "חבר סופטפון".
 * (קודם כל סוכן הזין קו בעצמו בפרופיל — והקו נשאר ריק אצל רובם.)
 */
function TeamSipLines() {
  const [lines, setLines] = useState<TeamLine[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /*
   * רשימה ריקה כאן נראית כמו „לאף סוכן אין קו”, ומזמינה להזין מחדש
   * שם משתמש וסיסמה שכבר שמורים.
   */
  const [loadFailed, setLoadFailed] = useState(false);

  function load(): void {
    setLoadFailed(false);
    apiGet<TeamLine[]>("/settings/telephony/lines")
      .then(setLines)
      .catch(() => setLoadFailed(true));
  }

  useEffect(load, []);

  async function save(userId: string, form: HTMLFormElement): Promise<void> {
    const data = new FormData(form);
    const password = String(data.get("password") ?? "");
    setBusyId(userId);
    setError(null);
    setSavedId(null);
    try {
      await apiPost(`/settings/telephony/lines/${userId}`, {
        username: String(data.get("username") ?? "").trim(),
        // סיסמה ריקה = השאר את השמורה; שליחתה הייתה מוחקת אותה
        ...(password.trim() !== "" ? { password } : {}),
      });
      setSavedId(userId);
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "שמירת הקו נכשלה");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mt-6 border-t pt-4" style={{ borderColor: "var(--color-border)" }}>
      <h3 className="m-0 mb-1 text-sm font-extrabold">קווי סופטפון לצוות</h3>
      <p className="m-0 mb-3 text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
        הקצו לכל סוכן את הקו והסיסמה שקיבלתם ממנהל המרכזייה — אצלו יופיע כפתור
        &quot;חבר סופטפון&quot; והוא יוכל לדבר מהדפדפן. סיסמה שמורה לא מוצגת; השאירו
        ריק כדי לא לשנות אותה.
      </p>

      {error ? (
        <Notice tone="danger">{error}</Notice>
      ) : null}

      {loadFailed ? (
        <LoadError message="לא הצלחנו לטעון את קווי הצוות" onRetry={load} />
      ) : lines === null ? (
        <p aria-live="polite" className="m-0 text-sm">טוען…</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {lines.map((line) => (
            <li key={line.userId}>
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void save(line.userId, event.currentTarget);
                }}
              >
                <span className="w-36 truncate pb-2 text-sm font-semibold">{line.name}</span>
                <div>
                  <label htmlFor={`line-u-${line.userId}`} className="mb-1 block text-sm font-semibold">
                    קו / שלוחה
                  </label>
                  <input
                    id={`line-u-${line.userId}`}
                    name="username"
                    dir="ltr"
                    defaultValue={line.username}
                    maxLength={80}
                    autoComplete="off"
                    className="w-32 rounded-lg border px-2.5 py-1.5 text-sm"
                    style={{ borderColor: "var(--color-input-border)", background: "var(--color-bg)" }}
                  />
                </div>
                <div>
                  <label htmlFor={`line-p-${line.userId}`} className="mb-1 block text-sm font-semibold">
                    סיסמת הקו
                  </label>
                  <input
                    id={`line-p-${line.userId}`}
                    name="password"
                    type="password"
                    dir="ltr"
                    autoComplete="new-password"
                    placeholder={line.hasPassword ? "שמורה — השאירו ריק" : ""}
                    className="w-36 rounded-lg border px-2.5 py-1.5 text-sm"
                    style={{ borderColor: "var(--color-input-border)", background: "var(--color-bg)" }}
                  />
                </div>
                <button type="submit" className="mv-btn-plain" disabled={busyId !== null}>
                  {busyId === line.userId ? "שומר…" : "שמור"}
                </button>
                {savedId === line.userId ? (
                  <span role="status" className="pb-2 text-sm" style={{ color: "var(--color-success)" }}>
                    ✓ נשמר
                  </span>
                ) : null}
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * ייבוא הקלטות שהמרכזייה מחזיקה ואנחנו לא.
 *
 * הוובהוק מספר לנו על הקלטה בזמן שהשיחה מסתיימת. שיחה שהאירוע
 * שלה אבד, הגיע בלי שדה ההקלטה, או נקלטה לפני שההקלטה הייתה
 * מוכנה — נשארת בלי אודיו לתמיד, ואצל הספק היא תימחק בבוא היום.
 *
 * ידני ולא אוטומטי: זו קריאה על טווח תאריכים שלם, והיא נוגעת
 * במנוי של המשרד אצל הספק.
 */
function ImportRecordings() {
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(): Promise<void> {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await apiPost<ImportResult>("/settings/telephony/recordings/import", { days }));
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "הייבוא נכשל — נסו שוב");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-xl border p-3" style={{ borderColor: "var(--color-border)" }}>
      <p className="m-0 mb-1 font-bold text-[length:var(--type-body-sm)]">ייבוא הקלטות קודמות</p>
      <p className="m-0 mb-2 text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
        מושך מהמרכזייה את ההקלטות של שיחות שכבר רשומות אצלכם ואין להן אודיו —
        למשל שיחות שההקלטה שלהן לא הייתה מוכנה כשהאירוע הגיע.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[length:var(--type-caption)]">
          עד לפני
          <input
            type="number"
            min={1}
            max={90}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="mv-input mx-1.5 w-[70px]"
          />
          ימים
        </label>
        <button type="button" className="mv-btn-plain" disabled={busy} onClick={() => void run()}>
          {busy ? "מייבא…" : "ייבא הקלטות"}
        </button>
      </div>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {result ? (
        <Notice tone="success">
          {/*
            ‎**המשפטים נבנים כרשימה ומחוברים ברווח — לא משורשרים
            ידנית.**

            הצורה הקודמת פתחה במשפט אחד („סומנו למשיכה” או „לא
            נמצאו”) והוסיפה אחריו משפטים שכל אחד מהם נשא רווח מוביל
            משלו. זה עבד כל עוד המשפט הראשון תמיד הופיע. ברגע
            שהמונה פוצל ל-`linked`/`skipped`, ייבוא שכל תוצאותיו
            שיחות שלא נענו הגיע לכאן עם `linked === 0` — והמסך אמר
            „לא נמצאו הקלטות חדשות לצרף” ומיד אחר כך מנה אותן.
            שני משפטים סותרים באותה הודעה (ביקורת Codex).

            ‎`importSentences` הופכת „מה מופיע” ל-`filter(Boolean)`
            ו„איך זה מחובר” ל-`join`. משפט חדש מצטרף בלי להחזיק דעה
            על מי לפניו — וזה מה שנשבר כאן פעמיים.
          */}
          {importSentences(result).join(" ")}
          {/*
            „הספק החזיר הקלטות ואין לנו מזהה הורדה” הוא אבחון; „לא
            נמצאו הקלטות” הוא מבוי סתום. צורת השורה אינה מתועדת אצל
            015, ולכן שמות השדות שהוא באמת החזיר הם מה שסוגר את
            הפער — והם חייבים להגיע למסך, לא רק ליומן השרת.
            שמות בלבד: ערכי השורה נושאים מספרי טלפון.
          */}
          {result.withoutRecordId > 0 ? (
            <span className="mt-1 block">
              {`${result.withoutRecordId} הקלטות אצל הספק בלי מזהה הורדה שאנחנו מכירים — אי אפשר למשוך אותן עד שנדע באיזה שדה הוא מגיע.`}
              {result.rowKeys.length > 0 ? (
                <>
                  {" השדות שהמרכזייה החזירה: "}
                  <span dir="ltr" style={{ unicodeBidi: "isolate" }}>
                    {result.rowKeys.join(", ")}
                  </span>
                  {". שלחו את השורה הזו לתמיכה."}
                </>
              ) : null}
            </span>
          ) : null}
        </Notice>
      ) : null}
    </div>
  );
}
