"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@metavchim/ui";
import { apiGet, apiPatch, ApiError } from "@/lib/api";
import { IconDoc } from "../icons";

/**
 * המסמכים המשפטיים — פרטי המפעילה ונוסחי תנאי השימוש והפרטיות.
 *
 * הם נערכים כאן ולא בקוד משום שזה מה שקורה להם בפועל: נוסח חוזר
 * מעורך/ת דין, כתובת החברה משתנה, ומסמך צריך להתעדכן באותו יום —
 * לא בגרסה הבאה של המערכת.
 *
 * **ריק = נוסח ברירת המחדל שבקוד**, ולא מסמך ריק. זו הסיבה שהשדות
 * כאן מוצגים עם הערך הקיים ולא מרוקנים אחרי שמירה, בניגוד לשדות
 * הסודות שלידם: כאן אין מה להסתיר, ועורך שאינו רואה את הנוסח הקיים
 * יכול רק לכתוב אותו מחדש במקום לתקן בו מילה.
 */

const inputStyle = { borderColor: "var(--color-input-border)", background: "var(--color-field)" } as const;

interface LegalSettings {
  operator: string;
  companyId: string;
  address: string;
  privacyEmail: string;
  accessibilityEmail: string;
  updatedAt: string;
  termsText: string;
  privacyText: string;
}

/** שרת שטרם עודכן אינו מחזיר `legal` — המסך לא נופל על זה. */
interface SettingsResponse {
  legal?: LegalSettings;
}

const EMPTY: LegalSettings = {
  operator: "",
  companyId: "",
  address: "",
  privacyEmail: "",
  accessibilityEmail: "",
  updatedAt: "",
  termsText: "",
  privacyText: "",
};

function Field({
  id,
  label,
  hint,
  value,
  onChange,
  type = "text",
}: {
  id: keyof LegalSettings;
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <div className="flex-1" style={{ minWidth: "220px" }}>
      <label htmlFor={id} className="mb-1 block font-medium">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border px-3 py-2"
        style={inputStyle}
      />
      {hint ? (
        <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function LegalDocsSection() {
  const [legal, setLegal] = useState<LegalSettings | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  function load() {
    setLoadFailed(false);
    apiGet<SettingsResponse>("/platform/settings")
      /*
       * שרת ישן שאינו מחזיר `legal` הוא תשובה תקינה — פשוט אין עדיין
       * ערכים. זה שונה מכשל טעינה, ולכן רק כאן נופלים ל-EMPTY.
       */
      .then((s) => setLegal(s.legal ?? EMPTY))
      .catch(() => {
        /*
         * **כשל טעינה אינו טופס ריק.** אילו הצגנו כאן EMPTY, מנהל
         * שהיה מתקן שדה אחד ושומר היה שולח מחרוזת ריקה בכל שאר
         * השדות — והשרת מפרש ריק כמחיקה. תקלת רשת רגעית הייתה
         * מוחקת את כל פרטי החברה ואת שני הנוסחים בבת אחת.
         */
        setLegal(null);
        setLoadFailed(true);
      });
  }

  useEffect(load, []);

  function set<K extends keyof LegalSettings>(key: K, value: string) {
    setLegal((current) => (current === null ? current : { ...current, [key]: value }));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (legal === null) return;
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      /*
       * **כל השדות נשלחים, גם הריקים** — בניגוד לשדות הסודות במסך
       * הזה, שבהם ריק פירושו "בלי שינוי". כאן ריק הוא פעולה: חזרה
       * לנוסח ברירת המחדל. בלי זה לא הייתה שום דרך לבטל עריכה
       * שנשמרה, רק לדרוס אותה בעריכה אחרת.
       */
      await apiPatch("/platform/settings", {
        legalOperator: legal.operator.trim(),
        legalCompanyId: legal.companyId.trim(),
        legalAddress: legal.address.trim(),
        legalPrivacyEmail: legal.privacyEmail.trim(),
        legalAccessibilityEmail: legal.accessibilityEmail.trim(),
        legalUpdatedAt: legal.updatedAt.trim(),
        legalTermsText: legal.termsText.trim(),
        legalPrivacyText: legal.privacyText.trim(),
      });
      setMessage("✓ המסמכים נשמרו ומופיעים בעמודים מיד");
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "השמירה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="legal-heading" className="mb-8">
      <h2 id="legal-heading" className="mb-3 text-xl font-semibold">
        <IconDoc s={18} /> מסמכים משפטיים
      </h2>

      {loadFailed ? (
        <div
          className="rounded-xl border p-4"
          style={{ borderColor: "var(--color-danger)", background: "var(--color-surface)" }}
        >
          <p className="mb-3" style={{ color: "var(--color-danger)" }}>
            טעינת המסמכים נכשלה. העריכה חסומה עד שהערכים הקיימים ייטענו —
            שמירה על סמך טופס ריק הייתה מוחקת אותם.
          </p>
          <Button type="button" onClick={load}>
            ניסיון חוזר
          </Button>
        </div>
      ) : legal === null ? (
        <p style={{ color: "var(--color-text-muted)" }}>טוען…</p>
      ) : (
        <form onSubmit={(e) => void save(e)}>
          <div
            className="mb-4 rounded-xl border p-4"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          >
            <h3 className="mb-1 font-semibold">פרטי המפעילה</h3>
            <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
              מופיעים בתנאי השימוש, במדיניות הפרטיות ובהצהרת הנגישות. שדה
              שנשאר ריק מציג את ערך ברירת המחדל שבמערכת.
            </p>
            <div className="mb-3 flex flex-wrap gap-3">
              <Field
                id="operator"
                label="שם החברה"
                value={legal.operator}
                onChange={(v) => set("operator", v)}
              />
              <Field
                id="companyId"
                label="ח.פ."
                value={legal.companyId}
                onChange={(v) => set("companyId", v)}
              />
            </div>
            <div className="mb-3 flex flex-wrap gap-3">
              <Field
                id="address"
                label="כתובת למשלוח דואר"
                hint="כל עוד ריק — המסמכים אינם מציגים שורת כתובת כלל. כתובת חייבת להתאים למסמכי החברה."
                value={legal.address}
                onChange={(v) => set("address", v)}
              />
            </div>
            <div className="mb-3 flex flex-wrap gap-3">
              <Field
                id="privacyEmail"
                label='דוא"ל לפניות פרטיות'
                type="email"
                value={legal.privacyEmail}
                onChange={(v) => set("privacyEmail", v)}
              />
              <Field
                id="accessibilityEmail"
                label='דוא"ל רכז/ת נגישות'
                type="email"
                value={legal.accessibilityEmail}
                onChange={(v) => set("accessibilityEmail", v)}
              />
            </div>
            <div className="flex flex-wrap gap-3">
              <Field
                id="updatedAt"
                label="תאריך עדכון המסמכים"
                hint='נכתב כלשונו, למשל "17 באוגוסט 2026". לעדכן בכל שינוי מהותי.'
                value={legal.updatedAt}
                onChange={(v) => set("updatedAt", v)}
              />
            </div>
          </div>

          <div
            className="mb-4 rounded-xl border p-4"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          >
            <h3 className="mb-1 font-semibold">נוסח המסמכים</h3>
            <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
              <strong>ריק = הנוסח שבמערכת.</strong> נוסח שנכתב כאן דורס אותו
              במלואו — כך נוסח שחזר מעורך/ת דין נכנס לאוויר בהדבקה. לחזרה
              לנוסח המקורי: לרוקן את התיבה ולשמור.
            </p>
            <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
              עיצוב הטקסט: <code>## כותרת</code> · <code>### תת-כותרת</code> ·{" "}
              <code>- פריט ברשימה</code> · <code>**מודגש**</code>. שורה ריקה מפרידה
              בין פסקאות.
            </p>

            <label htmlFor="termsText" className="mb-1 block font-medium">
              תנאי שימוש
            </label>
            <textarea
              id="termsText"
              value={legal.termsText}
              onChange={(e) => set("termsText", e.target.value)}
              rows={14}
              placeholder="ריק — מוצג הנוסח שבמערכת"
              className="mb-4 w-full rounded-lg border px-3 py-2 font-mono text-sm"
              style={inputStyle}
            />

            <label htmlFor="privacyText" className="mb-1 block font-medium">
              מדיניות פרטיות
            </label>
            <textarea
              id="privacyText"
              value={legal.privacyText}
              onChange={(e) => set("privacyText", e.target.value)}
              rows={14}
              placeholder="ריק — מוצג הנוסח שבמערכת"
              className="w-full rounded-lg border px-3 py-2 font-mono text-sm"
              style={inputStyle}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={busy}>
              {busy ? "שומר…" : "שמירת המסמכים"}
            </Button>
            <a href="/terms" target="_blank" rel="noreferrer" className="underline">
              תצוגת תנאי השימוש
            </a>
            <a href="/privacy" target="_blank" rel="noreferrer" className="underline">
              תצוגת מדיניות הפרטיות
            </a>
          </div>

          {message !== null ? (
            <p className="mt-3" style={{ color: "var(--color-primary)" }}>
              {message}
            </p>
          ) : null}
          {error !== null ? (
            <p className="mt-3" style={{ color: "var(--color-danger)" }}>
              {error}
            </p>
          ) : null}
        </form>
      )}
    </section>
  );
}
