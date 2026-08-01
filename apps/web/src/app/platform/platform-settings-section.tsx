"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@metavchim/ui";
import { apiGet, apiPatch, apiPost, ApiError } from "@/lib/api";

/**
 * הגדרות הפלטפורמה — מפתחות הספקים (Postmark, WhatsApp) והפעלת אימות
 * הכניסה, ישירות מהמסך במקום SSH. הערכים נשמרים מוצפנים ולעולם לא
 * מוחזרים לדפדפן — מוצג רק "מוגדר / לא מוגדר".
 */

const inputStyle = { borderColor: "var(--color-border)", background: "var(--color-bg)" } as const;

interface PlatformSettings {
  postmark: { configured: boolean; source: "db" | "env" | "none"; emailFrom?: string };
  whatsapp: { configured: boolean; source: "db" | "env" | "none" };
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
          <h3 className="font-semibold">📧 אימייל (Postmark)</h3>
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

      {/* ---------- וואטסאפ ---------- */}
      <div className="mb-4 rounded-xl border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">💬 וואטסאפ (Meta Cloud API)</h3>
          <StatusBadge configured={settings.whatsapp.configured} source={settings.whatsapp.source} />
        </div>
        <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
          מפתחות האפליקציה ב-Meta for Developers. כל משרד מזין אחר כך את המספר
          העסקי שלו בהגדרות שלו, וההודעות מנותבות אליו אוטומטית.
        </p>
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
          <h3 className="font-semibold">🔐 אימות כניסה בקוד למייל</h3>
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
