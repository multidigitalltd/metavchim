"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@metavchim/ui";
import {
  recordingPullHealth,
  type RecordingPullHealth,
  telephonyGaps,
  telephonyProvider,
} from "@metavchim/shared";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { IconPhone } from "../icons";
import { Notice } from "../notice";
import { DeskVirtualNumbers } from "./desk-virtual-numbers";

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

/** ‏גוון לפי חומרה. „טרם נוסתה” אינו אזהרה, ולכן הוא ניטרלי. */
function pullTone(level: RecordingPullHealth["level"]): string {
  switch (level) {
    case "ok":
      return "var(--color-success)";
    case "warn":
      return "var(--color-warning)";
    case "broken":
      return "var(--color-danger)";
    case "unknown":
      return "var(--color-text-muted)";
  }
}

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
    lastPullAt?: string;
    lastPullOk?: boolean;
    lastPullIssue?: string;
    pullFailStreak?: number;
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
  /**
   * מה שנטען — **ולאיזה משרד.**
   *
   * המזהה נשמר יחד עם הנתונים ולא לצדם. בלעדיו החלפת משרד השאירה את
   * הטופס הקודם על המסך בזמן שהבקשה החדשה בדרך, ולחיצה על שמירה
   * באותו חלון שלחה את **ההגדרות של משרד אחד אל המשרד השני** —
   * כלומר דרסה חיבור עובד של מישהו שלא נגעו בו. תשובה של בקשה ישנה
   * שחוזרת אחרי החדשה עושה בדיוק את אותו דבר (ביקורת Codex, P1).
   */
  const [loaded, setLoaded] = useState<{ agencyId: string; data: DeskStatus } | null>(null);
  const [provider, setProvider] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  /*
   * ‎**הבחירה החיה, לקריאה אחרי `await`.**
   *
   * דגל ה-`live` של האפקט מכסה את הטעינה בלבד; המשך של `save`
   * שרץ אחרי החלפת משרד אינו מכוסה בו כלל, והוא כותב `setLoaded`
   * של המשרד הישן על זה שכבר נטען. מאחר שהתצוגה דורשת התאמה בין
   * המזהה שנטען לנבחר, המשרד החדש נשאר **בלי טופס** עד שייבחר
   * מחדש, וההודעה „נשמר אצל…” נושאת את השם הקודם (ביקורת Codex).
   *
   * ‎`ref` ולא `state`: הקריאה נעשית אחרי `await` בתוך סגור שנוצר
   * ברינדור קודם, ולכן ערך מ-`state` שם הוא הישן מעצם הגדרתו.
   */
  const selected = useRef(agencyId);

  useEffect(() => {
    selected.current = agencyId;
    /*
     * הניקוי מיידי ולפני הבקשה: כל עוד הטופס הישן על המסך אפשר
     * ללחוץ עליו, והלחיצה תישלח למשרד החדש.
     */
    setLoaded(null);
    setValues({});
    setProvider("");
    setError(null);
    setDone(null);
    if (agencyId === "") return;

    // תשובה שחוזרת אחרי שהמשרד כבר הוחלף אינה נכנסת ל-state
    let live = true;
    apiGet<DeskStatus>(`/platform/agencies/${agencyId}/integrations`)
      .then((res) => {
        if (!live) return;
        setLoaded({ agencyId, data: res });
        setProvider(res.telephony.provider ?? res.providers[0]?.id ?? "");
        /*
         * הטופס נטען עם מה ששמור — חוץ מהסודות, שאינם חוזרים
         * מהשרת מלכתחילה. שדה סוד ריק פירושו "אל תיגע", ולכן
         * הוא נשאר ריק גם כשיש ערך שמור.
         */
        const fields: Record<string, string> = {};
        for (const [key, value] of Object.entries(res.telephony.config)) {
          if (typeof value === "string") fields[key] = value;
        }
        setValues(fields);
      })
      .catch(() => {
        if (live) setError("טעינת החיבורים נכשלה");
      });
    return () => {
      live = false;
    };
  }, [agencyId]);

  /** מוצג רק כשמה שנטען שייך למשרד שנבחר עכשיו. */
  const data = loaded !== null && loaded.agencyId === agencyId ? loaded.data : null;
  const current = data?.providers.find((p) => p.id === provider);
  /*
   * ‏לפי הספק **השמור** ולא הנבחר בטופס: השורה מתארת את החיבור
   * ‏שקיים, לא את זה שהמנהל עומד לשמור.
   */
  const savedProvider =
    data?.telephony.provider === undefined ? undefined : telephonyProvider(data.telephony.provider);
  const gaps =
    data?.telephony.connected === true && savedProvider !== undefined
      ? telephonyGaps(savedProvider, data.telephony.config ?? {}, data.telephony.secretsSet ?? [])
      : [];
  /*
   * ‏המשפט מגיע מ-`shared` — אותו מילון בדיוק שהמתווך רואה על
   * ‏השיחה. שני ניסוחים לאותו קוד היו אומרים למנהל הפלטפורמה דבר
   * ‏אחד ולמשרד דבר אחר, והשיחה ביניהם מתחילה מתרגום.
   */
  const pull: RecordingPullHealth = recordingPullHealth({
    lastPullAt: data?.telephony.lastPullAt ? new Date(data.telephony.lastPullAt) : null,
    lastPullOk: data?.telephony.lastPullOk ?? null,
    lastPullIssue: data?.telephony.lastPullIssue ?? null,
    pullFailStreak: data?.telephony.pullFailStreak ?? 0,
    /* ‏חיבור מכובה אינו „תקין” — ראו `recordingPullHealth` */
    active: data?.telephony.connected === true && data.telephony.status === "active",
  });

  /**
   * ‎**הפקת הכתובת בשם המשרד, בלי פרטי ספק.**
   *
   * ‏אותה קריאה של השמירה, עם תצורה וסודות ריקים — מה שהיא יוצרת
   * ‏הוא מפתח הוובהוק בלבד. מוצעת רק כשאין עדיין חיבור, כי שמירה
   * ‏ריקה על שורה קיימת הייתה מוחקת פרטים שכבר הוזנו.
   */
  async function issueWebhook(): Promise<void> {
    if (loaded === null || loaded.agencyId !== agencyId) return;
    const target = loaded.agencyId;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await apiPost(`/platform/agencies/${target}/integrations/telephony`, {
        provider,
        config: {},
        secrets: {},
      });
      if (selected.current !== target) return;
      setDone("הכתובת הופקה — העתיקו אותה והדביקו בהגדרות המרכזייה של המשרד.");
      const fresh = await apiGet<DeskStatus>(`/platform/agencies/${target}/integrations`);
      if (selected.current !== target) return;
      setLoaded({ agencyId: target, data: fresh });
    } catch (err: unknown) {
      if (selected.current !== target) return;
      setError(err instanceof ApiError ? err.message : "ההפקה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function save(): Promise<void> {
    /*
     * המשרד שאליו נשלח הוא זה שהנתונים נטענו עבורו, והבדיקה כאן
     * חוזרת גם אחרי ה-`await`: אין שום מסלול שבו טופס אחד מגיע
     * לכרטיס של משרד אחר.
     */
    if (!data || !current || loaded === null || loaded.agencyId !== agencyId) return;
    const target = loaded.agencyId;
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
      await apiPost(`/platform/agencies/${target}/integrations/telephony`, {
        provider,
        config,
        secrets,
      });
      /*
       * השמירה עצמה הושלמה אצל `target` בין אם המסך עבר הלאה ובין
       * אם לא — אבל מכאן והלאה אין לכתוב דבר למסך של משרד אחר.
       */
      if (selected.current !== target) return;
      setDone(`נשמר אצל ${data.agencyName}. המשרד קיבל התראה, והפעולה רשומה ביומן שלו.`);
      const fresh = await apiGet<DeskStatus>(`/platform/agencies/${target}/integrations`);
      if (selected.current !== target) return;
      setLoaded({ agencyId: target, data: fresh });
      // הסודות שהוזנו נמחקים מהטופס אחרי שנשמרו — הם לא נקראים בחזרה
      setValues((prev) => {
        const next = { ...prev };
        for (const field of current.fields) if (field.secret) delete next[field.key];
        return next;
      });
    } catch (err: unknown) {
      if (selected.current !== target) return;
      setError(err instanceof ApiError ? err.message : "השמירה נכשלה");
    } finally {
      // הדגל משותף למסך ולא למשרד — שחרורו תמיד, אחרת הטופס החדש נעול
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
                {/*
                  ‎**משיכת ההקלטות — חיבור שני, ומצב שני.**

                  ‏„הוובהוק מגיע” ו„ההקלטה נמשכת” נכשלים בנפרד:
                  ‏אירועים נכנסים יפה בזמן שלחבילה במרכזייה אין
                  ‏הרשאה למשוך הקלטות. עד כה זה נראה רק על שיחה
                  ‏בודדת — כלומר כדי לאבחן היה צריך לבקש מהמשרד
                  ‏לפתוח שיחה ולהקריא את השורה.
                */}
                <p className="m-0 mt-1" style={{ color: pullTone(pull.level) }}>
                  משיכת הקלטות: {pull.sentence}
                  {pull.at === undefined ? "" : ` · ${formatDateTime(pull.at.toISOString())}`}
                </p>
              </>
            ) : (
              <>
                <p className="m-0">למשרד הזה אין עדיין חיבור מרכזייה.</p>
                {/*
                  ‎**הכתובת אינה תלויה בפרטי הספק.** המפתח שבתוכה
                  מזהה את המשרד, ולכן אפשר להוציא אותה עכשיו,
                  להדביק במרכזייה, ולהתחיל לקלוט שיחות — ואת פרטי
                  015 להשלים אחר כך. הצימוד הזה השבית משרדים שהמתינו
                  לפרטי הגישה.
                */}
                <p className="m-0 mt-1" style={{ color: "var(--color-text-muted)" }}>
                  אפשר להפיק את הכתובת כבר עכשיו, בלי פרטי הספק — קליטת השיחות אינה
                  תלויה בהם.
                </p>
                <Button
                  className="mt-2"
                  disabled={busy}
                  onClick={() => void issueWebhook()}
                >
                  הפק כתובת Webhook למשרד
                </Button>
              </>
            )}
            {/*
              ‏„מה עוד חסר” ולא „החיבור שבור”: קליטת השיחות כבר
              עובדת, וכל פער פותח יכולת נוספת. אותו כלל בדיוק שמסך
              המשרד מציג.
            */}
            {gaps.length > 0 ? (
              <div className="mt-2">
                <p className="m-0 font-semibold">מה עוד אפשר להוסיף</p>
                <ul className="m-0 mt-1 pr-5">
                  {gaps.map((gap) => (
                    <li key={gap.capability}>
                      <b>{gap.label}</b> — חסר: {gap.missing.join(", ")}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
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
                    /*
                      `new-password` ולא `off` בשדה סוד, כמו במסך של
                      המשרד עצמו: כרום מתעלם מ-`off` בשדות סיסמה
                      וממלא לתוכם סיסמה שמורה של המשתמש — כאן זו
                      הסיסמה הפרטית של **מנהל הפלטפורמה**, והשמירה
                      הייתה כותבת אותה כסיסמת המרכזייה של המשרד
                      (ביקורת Codex, P1).
                    */
                    autoComplete={field.secret ? "new-password" : "off"}
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

          {/*
            ‎`key` לפי משרד: הרכיב נבנה מחדש בהחלפה, ולכן טבלה של
            משרד אחד לעולם אינה נשלחת למשרד אחר — אותו כלל כמו
            הטופס שמעליו, רק שכאן הוא נאכף בזהות הרכיב ולא בבדיקה.
          */}
          <DeskVirtualNumbers key={agencyId} agencyId={agencyId} agencyName={data.agencyName} />
        </>
      ) : null}
    </section>
  );
}
