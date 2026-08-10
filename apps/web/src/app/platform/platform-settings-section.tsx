"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@metavchim/ui";
import { apiGet, apiPatch, apiPost, ApiError } from "@/lib/api";
import { IconCard, IconChat, IconKey, IconLock, IconMail } from "../icons";

/**
 * הגדרות הפלטפורמה — מפתחות הספקים (Postmark, WhatsApp) והפעלת אימות
 * הכניסה, ישירות מהמסך במקום SSH. הערכים נשמרים מוצפנים ולעולם לא
 * מוחזרים לדפדפן — מוצג רק "מוגדר / לא מוגדר".
 */

const inputStyle = { borderColor: "var(--color-border)", background: "var(--color-bg)" } as const;

interface PlatformSettings {
  postmark: { configured: boolean; source: "db" | "env" | "none"; emailFrom?: string };
  whatsapp: { configured: boolean; source: "db" | "env" | "none"; webhookUrl: string };
  google: { configured: boolean; source: "db" | "env" | "none"; redirectUri: string };
  /** אופציונלי — שרת ישן עוד לא מחזיר אותו, והמסך לא נופל על זה */
  gemini?: { configured: boolean; source: "db" | "env" | "none"; model: string };
  cardcom: { configured: boolean; source: "db" | "env" | "none"; webhookUrl: string };
  loginOtpEnabled: boolean;
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
        <form onSubmit={(e) => void saveEmail(e)} className="flex flex-wrap items-end gap-3">
          <div className="flex-1" style={{ minWidth: "220px" }}>
            <label htmlFor="postmarkServerToken" className="mb-1 block font-medium">
              Server Token {settings.postmark.configured ? <span className="font-normal">(ריק = ללא שינוי)</span> : null}
            </label>
            <input
              id="postmarkServerToken"
              name="postmarkServerToken"
              type="password"
              dir="ltr"
              autoComplete="off"
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

      {/* ---------- התחברות עם Google ---------- */}
      <div className="mb-4 rounded-xl border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold"><IconKey s={16} /> התחברות עם Google</h3>
          <StatusBadge configured={settings.google.configured} source={settings.google.source} />
        </div>
        <p className="mb-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
          מ-Google Cloud Console ⟵ APIs &amp; Services ⟵ Credentials ⟵ OAuth client ID
          (סוג: Web application). ההתחברות פותחת חשבונות קיימים בלבד — משתמש
          שלא הוזמן למשרד לא ייכנס.
        </p>
        <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
          כתובת החזרה שיש להזין שם (Authorized redirect URI):{" "}
          <code dir="ltr" className="rounded px-1" style={{ background: "var(--color-bg)" }}>
            {settings.google.redirectUri}
          </code>
        </p>
        <form onSubmit={(e) => void saveGoogle(e)} className="flex flex-wrap items-end gap-3">
          <div className="flex-1" style={{ minWidth: "220px" }}>
            <label htmlFor="googleClientId" className="mb-1 block font-medium">
              Client ID {settings.google.configured ? <span className="font-normal">(ריק = ללא שינוי)</span> : null}
            </label>
            <input
              id="googleClientId"
              name="googleClientId"
              type="text"
              dir="ltr"
              autoComplete="off"
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
              autoComplete="off"
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
              autoComplete="off"
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
        <form onSubmit={(e) => void saveCardcom(e)} className="flex flex-wrap items-end gap-3">
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
              autoComplete="off"
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
              autoComplete="off"
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
              autoComplete="off"
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
        <form onSubmit={(e) => void saveWhatsApp(e)} className="flex flex-wrap items-end gap-3">
          <div className="flex-1" style={{ minWidth: "220px" }}>
            <label htmlFor="whatsappAppSecret" className="mb-1 block font-medium">
              App Secret {settings.whatsapp.configured ? <span className="font-normal">(ריק = ללא שינוי)</span> : null}
            </label>
            <input
              id="whatsappAppSecret"
              name="whatsappAppSecret"
              type="password"
              dir="ltr"
              autoComplete="off"
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
              autoComplete="off"
              placeholder={settings.whatsapp.configured ? "••••••••" : ""}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <Button type="submit" disabled={busy}>שמור</Button>
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
