"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@metavchim/ui";
import { apiGet, apiPatch, apiPost, ApiError } from "@/lib/api";
import {
  MAX_PLATFORM_FEE_PERCENT,
  PLATFORM_REFERRAL_FEE_PERCENT,
  referralPayout,
} from "@metavchim/shared";
import { IconCard, IconChat, IconCoins, IconKey, IconLock, IconMail, IconPin } from "../icons";

/**
 * הגדרות הפלטפורמה — מפתחות הספקים (Postmark, WhatsApp) והפעלת אימות
 * הכניסה, ישירות מהמסך במקום SSH. הערכים נשמרים מוצפנים ולעולם לא
 * מוחזרים לדפדפן — מוצג רק "מוגדר / לא מוגדר".
 */

const inputStyle = { borderColor: "var(--color-border)", background: "var(--color-bg)" } as const;

interface PlatformSettings {
  postmark: { configured: boolean; source: "db" | "env" | "none"; emailFrom?: string };
  whatsapp: { configured: boolean; source: "db" | "env" | "none"; webhookUrl: string };
  google: {
    configured: boolean;
    source: "db" | "env" | "none";
    redirectUri: string;
    redirectUris: { label: string; url: string }[];
  };
  /** אופציונלי — שרת ישן עוד לא מחזיר אותו, והמסך לא נופל על זה */
  gemini?: { configured: boolean; source: "db" | "env" | "none"; model: string };
  cardcom: { configured: boolean; source: "db" | "env" | "none"; webhookUrl: string };
  loginOtpEnabled: boolean;
  /** אחוז עמלת ההפניות — ערך ולא סטטוס; שרת ישן לא מחזיר אותו. */
  referralFeePercent?: number;
  maps?: { configured: boolean };
}

function StatusBadge({ configured, source }: { configured: boolean; source: string }) {
  return (
    <span
      className="rounded-full px-3 py-0.5 text-sm font-medium"
      style={{
        background: configured ? "var(--color-primary-soft)" : "var(--color-border)",
        color: configured ? "var(--color-primary)" : "var(--color-text-muted)",
      }}
    >
      {configured ? (source === "env" ? "✓ מוגדר (משרת)" : "✓ מוגדר") : "לא מוגדר"}
    </span>
  );
}

export function PlatformSettingsSection() {
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    apiGet<PlatformSettings>("/platform/settings")
      .then(setSettings)
      .catch(() => undefined);
  }

  useEffect(load, []);

  async function saveEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);
    const form = event.currentTarget;
    const f = new FormData(form);
    try {
      const token = String(f.get("postmarkServerToken")).trim();
      await apiPatch("/platform/settings", {
        ...(token !== "" ? { postmarkServerToken: token } : {}),
        emailFrom: String(f.get("emailFrom")).trim(),
      });
      form.reset();
      setMessage("✓ הגדרות האימייל נשמרו");
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "השמירה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function saveWhatsApp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);
    const form = event.currentTarget;
    const f = new FormData(form);
    try {
      const secret = String(f.get("whatsappAppSecret")).trim();
      const verify = String(f.get("whatsappVerifyToken")).trim();
      await apiPatch("/platform/settings", {
        ...(secret !== "" ? { whatsappAppSecret: secret } : {}),
        ...(verify !== "" ? { whatsappVerifyToken: verify } : {}),
      });
      form.reset();
      setMessage("✓ הגדרות הוואטסאפ נשמרו");
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "השמירה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function saveGoogle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);
    const form = event.currentTarget;
    const f = new FormData(form);
    try {
      const clientId = String(f.get("googleClientId")).trim();
      const clientSecret = String(f.get("googleClientSecret")).trim();
      const geminiKey = String(f.get("geminiApiKey") ?? "").trim();
      await apiPatch("/platform/settings", {
        ...(clientId !== "" ? { googleClientId: clientId } : {}),
        ...(clientSecret !== "" ? { googleClientSecret: clientSecret } : {}),
        ...(geminiKey !== "" ? { geminiApiKey: geminiKey } : {}),
      });
      form.reset();
      setMessage("✓ הגדרות Google נשמרו — כפתור ההתחברות יופיע במסך הכניסה");
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "השמירה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  /**
   * בדיקת חיבור אמיתית מול קארדקום.
   *
   * שדה מלא אינו אישור תקין: ספרה שהוקלדה לא נכון במספר המסוף, או שם
   * API של סביבת בדיקות, מתגלים אחרת רק בעסקה הראשונה של לקוח משלם.
   * הבדיקה פותחת דף תשלום ואינה גובה דבר — הכתובת פשוט לא נפתחת.
   */
  async function testCardcom(): Promise<void> {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const res = await apiPost<{ ok: boolean; terminalNumber: number; message: string }>(
        "/platform/settings/test-cardcom",
        {},
      );
      if (res.ok) setMessage(`✓ החיבור לקארדקום תקין (מסוף ${res.terminalNumber})`);
      else setError(`קארדקום דחה את הבקשה: ${res.message}`);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "בדיקת החיבור נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function saveCardcom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);
    const form = event.currentTarget;
    const f = new FormData(form);
    try {
      const terminal = String(f.get("cardcomTerminalNumber")).trim();
      const apiName = String(f.get("cardcomApiName")).trim();
      const apiPassword = String(f.get("cardcomApiPassword")).trim();
      await apiPatch("/platform/settings", {
        ...(terminal !== "" ? { cardcomTerminalNumber: terminal } : {}),
        ...(apiName !== "" ? { cardcomApiName: apiName } : {}),
        ...(apiPassword !== "" ? { cardcomApiPassword: apiPassword } : {}),
      });
      form.reset();
      setMessage("✓ פרטי הסליקה נשמרו — כפתור הרכישה יופיע במסך המנוי של כל משרד");
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "השמירה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  /** שמירת הגדרת טקסט בודדת; ריק מוחק ומחזיר לברירת המחדל. */
  async function saveSetting(key: string, raw: FormDataEntryValue | null) {
    setBusy(true);
    setError(null);
    try {
      await apiPatch("/platform/settings", { [key]: String(raw ?? "").trim() });
      await load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "השמירה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  /**
   * שמירת אחוז העמלה.
   *
   * ריק נשלח כריק ולא כאפס: אפס הוא "לא גובים", וריק הוא "חזרה
   * לברירת המחדל". השרת מבחין ביניהם, והמסך לא אמור להחליט במקומו.
   */
  async function saveReferralFee(raw: FormDataEntryValue | null) {
    const text = String(raw ?? "").trim();
    setBusy(true);
    setError(null);
    try {
      await apiPatch("/platform/settings", {
        referralFeePercent: text === "" ? "" : Number(text),
      });
      await load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "שמירת העמלה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function toggleOtp(enabled: boolean) {
    setError(null);
    setMessage(null);
    try {
      await apiPatch("/platform/settings", { loginOtpEnabled: enabled });
      setMessage(
        enabled
          ? "✓ אימות הכניסה בקוד הופעל — בכניסה הבאה יישלח קוד למייל"
          : "✓ אימות הכניסה בקוד כובה",
      );
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "העדכון נכשל");
    }
  }

  async function sendTest() {
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const { sentTo } = await apiPost<{ sentTo: string }>("/platform/settings/test-email", {});
      setMessage(`✓ מייל בדיקה נשלח אל ${sentTo} — בדקו את התיבה (וגם בספאם)`);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "שליחת מייל הבדיקה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  if (!settings) return null;

  return (
    <section aria-labelledby="platform-settings-heading" className="mb-8">
      <h2 id="platform-settings-heading" className="mb-1 text-lg font-semibold">
        חיבורי המערכת
      </h2>
      <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
        מפתחות הספקים משותפים לכל המשרדים בפלטפורמה. הם נשמרים מוצפנים ולא מוצגים
        שוב אחרי השמירה.
      </p>

      {message ? (
        <p role="status" className="mb-3 rounded-lg border p-3" style={{ borderColor: "var(--color-success)", background: "var(--color-surface)" }}>
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mb-3 rounded-lg border p-3" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : null}

      {/* ---------- אימייל ---------- */}
      <div className="mb-4 rounded-xl border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold"><IconMail s={16} /> אימייל (Postmark)</h3>
          <StatusBadge configured={settings.postmark.configured} source={settings.postmark.source} />
        </div>
        <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
          נדרש לאיפוס סיסמה ולאימות כניסה. הטוקן: Postmark ⟵ Servers ⟵ API Tokens.
          כתובת השולח חייבת להיות מאומתת ב-Postmark (Sender Signature או דומיין).
        </p>
        <form autoComplete="off" onSubmit={(e) => void saveEmail(e)} className="flex flex-wrap items-end gap-3">
          <div className="flex-1" style={{ minWidth: "220px" }}>
            <label htmlFor="postmarkServerToken" className="mb-1 block font-medium">
              Server Token {settings.postmark.configured ? <span className="font-normal">(ריק = ללא שינוי)</span> : null}
            </label>
            <input
              id="postmarkServerToken"
              name="postmarkServerToken"
              type="password"
              dir="ltr"
              autoComplete="new-password"
              data-1p-ignore
              data-lpignore="true"
              placeholder={settings.postmark.configured ? "••••••••" : ""}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <div className="flex-1" style={{ minWidth: "220px" }}>
            <label htmlFor="emailFrom" className="mb-1 block font-medium">כתובת השולח</label>
            <input
              id="emailFrom"
              name="emailFrom"
              type="email"
              dir="ltr"
              required
              defaultValue={settings.postmark.emailFrom ?? ""}
              placeholder="no-reply@metavchim.co.il"
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <Button type="submit" disabled={busy}>שמור</Button>
          {settings.postmark.configured ? (
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void sendTest()}>
              שלח מייל בדיקה
            </Button>
          ) : null}
        </form>
      </div>

      {/* ---------- חיבורי Google ---------- */}
      <div className="mb-4 rounded-xl border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {/*
            השם היה "התחברות עם Google" בלבד, ולכן מי שחיפש איפה
            מחברים את יומן Google או את Gmail הסיק שאין לזה מקום —
            בעוד ששלושתם קוראים בדיוק את אותם שני ערכים.
          */}
          {/*
            מזהה משלו: הקיצור בראש העמוד מכוון לכאן ולא לכותרת
            הכללית של "חיבורי המערכת" — קפיצה לשם הנחיתה את הקורא
            לפני כרטיס Postmark, וכרטיס Google נשאר מתחת למסך
            (ביקורת Codex).
          */}
          <h3 id="google-connections" className="font-semibold">
            <IconKey s={16} /> חיבורי Google — התחברות, יומן ו-Gmail
          </h3>
          <StatusBadge configured={settings.google.configured} source={settings.google.source} />
        </div>
        <p className="mb-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
          מ-Google Cloud Console ⟵ APIs &amp; Services ⟵ Credentials ⟵ OAuth client ID
          (סוג: Web application). <strong>אותם שני ערכים משרתים את שלושת החיבורים</strong> —
          אין צורך ליצור אפליקציה נפרדת ליומן או ל-Gmail. ההתחברות פותחת חשבונות
          קיימים בלבד — משתמש שלא הוזמן למשרד לא ייכנס.
        </p>
        <div className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
          <p className="mb-1">
            כתובות החזרה שיש להזין ב-Google (Authorized redirect URIs) —{" "}
            <strong>כל השלוש</strong>, אחרת החיבור החסר ייפול על
            <code dir="ltr" className="mx-1">redirect_uri_mismatch</code>:
          </p>
          <ul className="m-0 list-none p-0">
            {settings.google.redirectUris.map((entry) => (
              <li key={entry.url} className="flex flex-wrap items-center gap-2 py-0.5">
                <span style={{ minWidth: 130 }}>{entry.label}</span>
                <code dir="ltr" className="rounded px-1" style={{ background: "var(--color-bg)" }}>
                  {entry.url}
                </code>
              </li>
            ))}
          </ul>
        </div>
        {/*
          שכבות ההגנה מפני מילוי אוטומטי אינן קישוט: Chrome התעלם
          מ-‎autocomplete="off"‎ בשדה סיסמה ומילא לתוך Client Secret את
          הסיסמה השמורה של המשתמש — הערך נשמר, ו-Google החזיר
          invalid_client על כל ההתחברות. ‎new-password‎ עוצר את הדפדפן,
          ו-data-1p-ignore/data-lpignore את מנהלי הסיסמאות החיצוניים.
        */}
        <form autoComplete="off" onSubmit={(e) => void saveGoogle(e)} className="flex flex-wrap items-end gap-3">
          <div className="flex-1" style={{ minWidth: "220px" }}>
            <label htmlFor="googleClientId" className="mb-1 block font-medium">
              Client ID {settings.google.configured ? <span className="font-normal">(ריק = ללא שינוי)</span> : null}
            </label>
            <input
              id="googleClientId"
              name="googleClientId"
              type="text"
              dir="ltr"
              autoComplete="new-password"
              data-1p-ignore
              data-lpignore="true"
              placeholder={settings.google.configured ? "••••••••" : "…apps.googleusercontent.com"}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <div className="flex-1" style={{ minWidth: "220px" }}>
            <label htmlFor="googleClientSecret" className="mb-1 block font-medium">
              Client Secret {settings.google.configured ? <span className="font-normal">(ריק = ללא שינוי)</span> : null}
            </label>
            <input
              id="googleClientSecret"
              name="googleClientSecret"
              type="password"
              dir="ltr"
              autoComplete="new-password"
              data-1p-ignore
              data-lpignore="true"
              placeholder={settings.google.configured ? "••••••••" : ""}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          {/*
            מפתח Gemini באותו טופס: שני מפתחות Google, מסך אחד.
            "מוגדר" מציג גם את המודל שרץ בפועל — אחרת אין דרך לדעת.
          */}
          <div className="flex-1" style={{ minWidth: "220px" }}>
            <label htmlFor="geminiApiKey" className="mb-1 block font-medium">
              Gemini API Key (פקודות קוליות){" "}
              {settings.gemini?.configured ? (
                <span className="font-normal">
                  ✓ מוגדר · {settings.gemini.model} (ריק = ללא שינוי)
                </span>
              ) : null}
            </label>
            <input
              id="geminiApiKey"
              name="geminiApiKey"
              type="password"
              dir="ltr"
              autoComplete="new-password"
              data-1p-ignore
              data-lpignore="true"
              placeholder={settings.gemini?.configured ? "••••••••" : "מ-Google AI Studio"}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <Button type="submit" disabled={busy}>שמור</Button>
        </form>
      </div>

      {/* ---------- סליקה (קארדקום) ---------- */}
      <div className="mb-4 rounded-xl border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold"><IconCard s={16} /> סליקה (קארדקום)</h3>
          <StatusBadge configured={settings.cardcom.configured} source={settings.cardcom.source} />
        </div>
        <p className="mb-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
          מספר המסוף ופרטי ה-API מאזור הניהול של קארדקום ⟵ הגדרות ⟵ משתמשי API.
          בלעדיהם מסך המנוי מציג &quot;התשלום המקוון טרם הופעל&quot; ואין כפתור רכישה.
        </p>
        <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
          פרטי כרטיס האשראי מוקלדים בדף של קארדקום ואינם עוברים במערכת בשום שלב.
        </p>
        {/*
          נאמר במפורש ולא מוסתר: בדיקת החיבור מאמתת מסוף ושם API בלבד,
          כי לקארדקום אין קריאה שמאמתת סיסמה בלי לזכות משהו. "✓ החיבור
          תקין" שהיה מכסה גם על סיסמה שגויה היה מתגלה בזיכוי הראשון.
        */}
        <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
          <strong>סיסמת ה-API נדרשת לזיכויים.</strong> בדיקת החיבור מאמתת את מספר המסוף
          ואת שם ה-API; הסיסמה נבדקת רק בזיכוי הראשון בפועל.
        </p>
        <div className="mb-3">
          <p className="mb-1 text-sm font-medium">כתובת ה-Webhook להזנה בקארדקום:</p>
          <p
            className="overflow-x-auto rounded-lg border p-2 font-mono text-sm"
            dir="ltr"
            style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
          >
            {settings.cardcom.webhookUrl}
          </p>
        </div>
        <form autoComplete="off" onSubmit={(e) => void saveCardcom(e)} className="flex flex-wrap items-end gap-3">
          <div style={{ minWidth: "140px" }}>
            <label htmlFor="cardcomTerminalNumber" className="mb-1 block font-medium">
              מספר מסוף {settings.cardcom.configured ? <span className="font-normal">(ריק = ללא שינוי)</span> : null}
            </label>
            <input
              id="cardcomTerminalNumber"
              name="cardcomTerminalNumber"
              type="text"
              inputMode="numeric"
              dir="ltr"
              autoComplete="new-password"
              data-1p-ignore
              data-lpignore="true"
              placeholder={settings.cardcom.configured ? "••••" : "1000"}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <div className="flex-1" style={{ minWidth: "180px" }}>
            <label htmlFor="cardcomApiName" className="mb-1 block font-medium">
              שם משתמש API {settings.cardcom.configured ? <span className="font-normal">(ריק = ללא שינוי)</span> : null}
            </label>
            <input
              id="cardcomApiName"
              name="cardcomApiName"
              type="text"
              dir="ltr"
              autoComplete="new-password"
              data-1p-ignore
              data-lpignore="true"
              placeholder={settings.cardcom.configured ? "••••••••" : ""}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <div className="flex-1" style={{ minWidth: "180px" }}>
            <label htmlFor="cardcomApiPassword" className="mb-1 block font-medium">
              סיסמת API {settings.cardcom.configured ? <span className="font-normal">(ריק = ללא שינוי)</span> : null}
            </label>
            <input
              id="cardcomApiPassword"
              name="cardcomApiPassword"
              type="password"
              dir="ltr"
              autoComplete="new-password"
              data-1p-ignore
              data-lpignore="true"
              placeholder={settings.cardcom.configured ? "••••••••" : ""}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <Button type="submit" disabled={busy}>שמור</Button>
          {settings.cardcom.configured ? (
            <Button type="button" variant="ghost" disabled={busy} onClick={() => void testCardcom()}>
              בדוק חיבור
            </Button>
          ) : null}
        </form>
      </div>

      {/* ---------- וואטסאפ ---------- */}
      <div className="mb-4 rounded-xl border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold"><IconChat s={16} /> וואטסאפ (Meta Cloud API)</h3>
          <StatusBadge configured={settings.whatsapp.configured} source={settings.whatsapp.source} />
        </div>
        <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
          מפתחות האפליקציה ב-Meta for Developers. כל משרד מזין אחר כך את המספר
          העסקי שלו בהגדרות שלו, וההודעות מנותבות אליו אוטומטית.
        </p>
        {/* הכתובת שמוזנת ב-Meta for Developers. היא ישבה קודם בהגדרות
            המשרד, שם מנהל משרד ראה פרט תפעולי של הפלטפורמה שאין לו שום
            דרך לפעול עליו — אין לו אפליקציית Meta. */}
        <div className="mb-3">
          <p className="mb-1 text-sm font-medium">כתובת ה-Webhook להזנה במטא:</p>
          <p
            className="overflow-x-auto rounded-lg border p-2 font-mono text-sm"
            dir="ltr"
            style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
          >
            {settings.whatsapp.webhookUrl}
          </p>
        </div>
        <form autoComplete="off" onSubmit={(e) => void saveWhatsApp(e)} className="flex flex-wrap items-end gap-3">
          <div className="flex-1" style={{ minWidth: "220px" }}>
            <label htmlFor="whatsappAppSecret" className="mb-1 block font-medium">
              App Secret {settings.whatsapp.configured ? <span className="font-normal">(ריק = ללא שינוי)</span> : null}
            </label>
            <input
              id="whatsappAppSecret"
              name="whatsappAppSecret"
              type="password"
              dir="ltr"
              autoComplete="new-password"
              data-1p-ignore
              data-lpignore="true"
              placeholder={settings.whatsapp.configured ? "••••••••" : ""}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <div className="flex-1" style={{ minWidth: "220px" }}>
            <label htmlFor="whatsappVerifyToken" className="mb-1 block font-medium">
              Verify Token <span className="font-normal">(אתם ממציאים אותו)</span>
            </label>
            <input
              id="whatsappVerifyToken"
              name="whatsappVerifyToken"
              type="password"
              dir="ltr"
              autoComplete="new-password"
              data-1p-ignore
              data-lpignore="true"
              placeholder={settings.whatsapp.configured ? "••••••••" : ""}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <Button type="submit" disabled={busy}>שמור</Button>
        </form>
      </div>

      {/* ---------- מפות ---------- */}
      <div className="rounded-xl border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold"><IconPin s={16} /> מפות</h3>
          <StatusBadge
            configured={settings.maps?.configured ?? false}
            source={settings.maps?.configured ? "db" : "none"}
          />
        </div>
        <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
          טוקן ציבורי לאריחי מפה. כל עוד הוא ריק, המפות במערכת מוצגות ככבויות ושום
          דבר אחר לא מושפע. <b>אריחים בלבד</b> — המערכת אינה שולחת לספק כתובות של
          לקוחות ואינה שומרת נתונים שלו, ולכן אפשר להפעיל את זה בלי המתנה להכרעה על
          פענוח כתובות.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void saveSetting("mapboxToken", new FormData(e.currentTarget).get("mapboxToken"));
          }}
          className="flex flex-wrap items-end gap-2"
        >
          <label className="grow">
            <span className="mb-1 block text-xs font-semibold">
              טוקן ציבורי (ריק = מפות כבויות)
            </span>
            <input
              name="mapboxToken"
              dir="ltr"
              placeholder="pk...."
              className="w-full rounded-lg border px-2.5 py-2"
              style={inputStyle}
            />
          </label>
          <Button type="submit" disabled={busy}>שמור</Button>
        </form>
      </div>

      {/* ---------- עמלת הפניות ---------- */}
      <div className="rounded-xl border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <h3 className="mb-1 font-semibold"><IconCoins s={16} /> עמלת הפלטפורמה על הפניית לקוח</h3>
        <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
          כשמשרד מפנה לקוח למשרד אחר, זהו האחוז שיורד מהתמורה לטובת הפלטפורמה.
          השאר נכנס ליתרת הקרדיטים של המשרד המפנה. האחוז מוצג לשני הצדדים לפני כל
          החלטה, ומשפיע על הפניות שיפורסמו מכאן ואילך — לא על מה שכבר פורסם.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void saveReferralFee(new FormData(e.currentTarget).get("referralFeePercent"));
          }}
          className="flex flex-wrap items-end gap-2"
        >
          <label>
            <span className="mb-1 block text-xs font-semibold">אחוז מהתמורה</span>
            <input
              name="referralFeePercent"
              type="number"
              min={0}
              max={MAX_PLATFORM_FEE_PERCENT}
              step={1}
              defaultValue={settings.referralFeePercent ?? PLATFORM_REFERRAL_FEE_PERCENT}
              className="w-28 rounded-lg border px-2.5 py-2"
              style={inputStyle}
            />
          </label>
          <Button type="submit" disabled={busy}>שמור</Button>
          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            {/* דוגמה מספרית — מסך שמראה רק אחוז מחייב את הקורא לחשב בראש */}
            לדוגמה: תמורה של 20 קרדיטים ⇐ {referralPayout(20, settings.referralFeePercent ?? PLATFORM_REFERRAL_FEE_PERCENT).platformFeeCredits} לפלטפורמה,{" "}
            {referralPayout(20, settings.referralFeePercent ?? PLATFORM_REFERRAL_FEE_PERCENT).payoutCredits} למשרד המפנה
          </span>
        </form>
      </div>

      {/* ---------- אימות כניסה ---------- */}
      <div className="rounded-xl border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold"><IconLock s={16} /> אימות כניסה בקוד למייל</h3>
          <Button
            variant={settings.loginOtpEnabled ? "danger" : "primary"}
            disabled={!settings.postmark.configured}
            onClick={() => void toggleOtp(!settings.loginOtpEnabled)}
          >
            {settings.loginOtpEnabled ? "כבה אימות" : "הפעל אימות"}
          </Button>
        </div>
        <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          {settings.postmark.configured
            ? "כשמופעל, כל כניסה למערכת תדרוש קוד בן 6 ספרות שנשלח למייל של המשתמש."
            : "יש להגדיר אימייל תחילה — בלי ספק אימייל פעיל, הפעלת האימות הייתה נועלת את כולם בחוץ."}
        </p>
      </div>
    </section>
  );
}
