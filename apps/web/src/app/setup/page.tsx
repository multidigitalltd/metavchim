"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ASSIGNABLE_ROLES, ROLE_LABELS, roleLabel } from "@metavchim/shared";
import { Button } from "@metavchim/ui";
import { apiGet, apiPatch, apiPost, ApiError } from "@/lib/api";
import { can, useRequireAuth } from "@/lib/use-auth";
import { IconCheck, IconMic, IconSheet, IconUsers } from "../icons";
import { Notice } from "../notice";
import { OfficeLogo } from "../settings/office-logo";

/**
 * אשף הקמת המשרד — לפי קובץ העיצוב: ארבעה שלבים עם פס התקדמות,
 * טאבים לחיצים ו"דלגו לשלב הבא" בכל שלב. ההרשמה מנחיתה לכאן.
 *
 * כל שלב מחובר ל-API אמיתי: פרטי המשרד נשמרים בהגדרות, ייבוא שולח
 * למסך הייבוא הקיים, סוכן חדש נוצר עם סיסמה זמנית שמוצגת לבעלים,
 * והנכס הראשון נקלט בקול במסלול הקיים.
 */

const inputStyle = { borderColor: "var(--color-border)", background: "var(--color-field)" } as const;

const STEPS = [
  { n: 1, t: "פרטי המשרד", s: "איך תיראו ללקוחות" },
  { n: 2, t: "המאגר הקיים", s: "ייבוא מאקסל או דילוג" },
  { n: 3, t: "הסוכנים", s: "מי עובד איתכם" },
  { n: 4, t: "הנכס הראשון", s: "בדיבור, בפחות מדקה" },
] as const;

interface OfficeSettings {
  name: string;
  officePhone?: string;
  officeAddress?: string;
  licenseNumber?: string;
}

interface CreatedAgent {
  name: string;
  email: string;
  role: string;
  tempPassword: string;
}

/** שלב 1 — פרטי המשרד: מה שמופיע על כל הצעה ודף נחיתה. */
function StepOffice({ allowed, onSaved }: { allowed: boolean; onSaved: () => void }) {
  const [values, setValues] = useState<OfficeSettings | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoadFailed(false);
    apiGet<OfficeSettings>("/settings/tenant")
      .then(setValues)
      .catch(() => setLoadFailed(true));
  };
  /*
   * כשל טעינה אינו הופך לטופס ריק: טופס ריק שנשמר היה מוחק את
   * הטלפון, הכתובת והרישיון הקיימים (ביקורת Codex). במקום זה —
   * הודעה וכפתור ניסיון חוזר.
   */
  useEffect(() => {
    if (allowed) load();
  }, [allowed]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const f = new FormData(event.currentTarget);
    try {
      await apiPatch("/settings/tenant", {
        name: String(f.get("name")).trim(),
        officePhone: String(f.get("officePhone") ?? "").trim(),
        officeAddress: String(f.get("officeAddress") ?? "").trim(),
        licenseNumber: String(f.get("licenseNumber") ?? "").trim(),
      });
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "השמירה נכשלה");
      setBusy(false);
    }
  }

  // ההרשאה נבדקת גם בשרת (settings.manage) — כאן רק לא מציגים
  // טופס שכל שמירה בו תסתיים ב-403 (ביקורת Codex)
  if (!allowed) {
    return (
      <div>
        <h2 className="mb-1 text-xl font-bold">נתחיל מהמשרד</h2>
        <p style={{ color: "var(--color-text-muted)" }}>
          עריכת פרטי המשרד שמורה לבעל המשרד או למנהל — אפשר לדלג לשלב הבא.
        </p>
      </div>
    );
  }
  if (loadFailed) {
    return (
      <div>
        <Notice tone="danger">טעינת פרטי המשרד נכשלה — לא נציג טופס ריק כדי לא לדרוס נתונים קיימים.</Notice>
        <Button variant="secondary" onClick={load}>נסו שוב</Button>
      </div>
    );
  }
  if (!values) return <p aria-live="polite">טוען…</p>;

  return (
    <form onSubmit={(e) => void save(e)} noValidate>
      <h2 className="mb-1 text-xl font-bold">נתחיל מהמשרד</h2>
      <p className="mb-5" style={{ color: "var(--color-text-muted)" }}>
        השם והפרטים מופיעים על כל דף הצעה שלקוח פותח, ועל המסמכים להחתמה.
      </p>
      {error ? (
        <Notice tone="danger">{error}</Notice>
      ) : null}
      {/* הלוגו נשמר מיד בבחירה ואינו חלק בטופס — קובץ אינו שדה טקסט */}
      <OfficeLogo />
      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="ob-name" className="mb-1 block font-medium">שם המשרד *</label>
          <input id="ob-name" name="name" required minLength={2} defaultValue={values.name} placeholder='לדוגמה: אורית לוי נדל"ן' className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
        </div>
        <div>
          <label htmlFor="ob-phone" className="mb-1 block font-medium">טלפון המשרד</label>
          <input id="ob-phone" name="officePhone" dir="ltr" defaultValue={values.officePhone ?? ""} placeholder="02-999-1234" className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
        </div>
        <div>
          <label htmlFor="ob-address" className="mb-1 block font-medium">כתובת המשרד</label>
          <input id="ob-address" name="officeAddress" defaultValue={values.officeAddress ?? ""} placeholder="הרצל 1, בית שמש" className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
        </div>
        <div>
          <label htmlFor="ob-license" className="mb-1 block font-medium">מספר רישיון תיווך</label>
          <input id="ob-license" name="licenseNumber" dir="ltr" defaultValue={values.licenseNumber ?? ""} className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
          <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
            מופיע על הצעות ומסמכים — אפשר להשלים גם אחר כך.
          </p>
        </div>
      </div>
      <Button type="submit" disabled={busy}>{busy ? "שומר…" : "שמור והמשך"}</Button>
    </form>
  );
}

/** שלב 3 — הוספת סוכנים: נוצרים עם סיסמה זמנית שמוצגת לבעלים. */
function StepAgents({ allowed }: { allowed: boolean }) {
  const [created, setCreated] = useState<CreatedAgent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = event.currentTarget;
    const f = new FormData(form);
    const name = String(f.get("agentName")).trim();
    const email = String(f.get("agentEmail")).trim().toLowerCase();
    const role = String(f.get("agentRole"));
    try {
      const res = await apiPost<{ tempPassword: string }>("/settings/users", {
        name,
        email,
        role,
      });
      setCreated((prev) => [...prev, { name, email, role, tempPassword: res.tempPassword }]);
      form.reset();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "הוספת הסוכן נכשלה");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2 className="mb-1 text-xl font-bold">מי עובד איתכם</h2>
      <p className="mb-5" style={{ color: "var(--color-text-muted)" }}>
        כל סוכן מקבל משתמש משלו. סוכן רואה את הלקוחות שלו; מנהל רואה את כל המשרד.
        אפשר לדלג ולהוסיף בכל רגע ממסך ההגדרות.
      </p>
      {!allowed ? (
        <p style={{ color: "var(--color-text-muted)" }}>
          הוספת משתמשים שמורה לבעל המשרד — אפשר לדלג לשלב הבא.
        </p>
      ) : (
        <>
          {error ? (
            <Notice tone="danger">{error}</Notice>
          ) : null}
          <form onSubmit={(e) => void add(e)} className="mb-4 grid items-end gap-3 sm:grid-cols-[1.4fr_1.4fr_1fr_auto]" noValidate>
            <div>
              <label htmlFor="ob-agent-name" className="mb-1 block text-sm font-medium">שם הסוכן</label>
              <input id="ob-agent-name" name="agentName" required minLength={2} placeholder="שירה כהן" className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
            </div>
            <div>
              <label htmlFor="ob-agent-email" className="mb-1 block text-sm font-medium">אימייל</label>
              <input id="ob-agent-email" name="agentEmail" type="email" required dir="ltr" placeholder="shira@office.co.il" className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
            </div>
            <div>
              <label htmlFor="ob-agent-role" className="mb-1 block text-sm font-medium">תפקיד</label>
              <select id="ob-agent-role" name="agentRole" defaultValue="agent" className="w-full rounded-lg border px-3 py-2.5" style={inputStyle}>
                {ASSIGNABLE_ROLES.map((value) => (
                  <option key={value} value={value}>{ROLE_LABELS[value]}</option>
                ))}
              </select>
            </div>
            <Button type="submit" variant="secondary" disabled={busy}>
              {busy ? "מוסיף…" : "הוסף"}
            </Button>
          </form>
          {created.length > 0 ? (
            <ul className="flex flex-col gap-2 border-t pt-4" style={{ borderColor: "var(--color-border)" }}>
              {created.map((a) => (
                <li key={a.email} className="rounded-lg border p-3" style={{ borderColor: "var(--color-success)" }}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span style={{ color: "var(--color-success)" }}><IconCheck s={15} /></span>
                    <span className="font-medium">{a.name}</span>
                    <span style={{ color: "var(--color-text-muted)" }}>
                      {roleLabel(a.role)} · {a.email}
                    </span>
                  </div>
                  {/*
                    הסיסמה הזמנית מוצגת פעם אחת בלבד — אין לה עותק
                    בשרת. הבעלים מעביר אותה לסוכן, והמערכת מחייבת
                    החלפה בכניסה הראשונה.
                  */}
                  <p className="mt-1 text-sm">
                    סיסמה זמנית להעברה לסוכן:{" "}
                    <code dir="ltr" className="rounded px-1.5 py-0.5 font-bold" style={{ background: "var(--color-bg)" }}>
                      {a.tempPassword}
                    </code>{" "}
                    <span style={{ color: "var(--color-text-muted)" }}>
                      (מוצגת פעם אחת — העתיקו עכשיו; בכניסה הראשונה הסוכן יחליף אותה)
                    </span>
                  </p>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </div>
  );
}

export default function SetupPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const router = useRouter();
  const [step, setStep] = useState(1);
  const pct = (step / STEPS.length) * 100;

  if (authLoading) return <p aria-live="polite">טוען…</p>;

  return (
    <div className="mx-auto max-w-4xl">
      {/* כותרת התקדמות — "לוקח בערך 4 דקות" מוריד את הלחץ לדלג על הכול */}
      <div className="mb-5">
        <div className="mb-2 flex flex-wrap items-baseline gap-2">
          <span className="text-sm font-bold" style={{ color: "var(--color-primary)" }}>
            שלב {step} מתוך {STEPS.length}
          </span>
          <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>
            · לוקח בערך 4 דקות, ואפשר לחזור לזה אחר כך
          </span>
        </div>
        <div
          role="progressbar"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="התקדמות ההקמה"
          className="h-[7px] w-full overflow-hidden rounded-full"
          style={{ background: "var(--color-border)" }}
        >
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: "var(--color-primary)" }} />
        </div>
      </div>

      {/* טאבי השלבים — לחיצים, כמו בעיצוב: עיגול מצב + שם + תקציר */}
      <div className="mb-5 grid gap-2 sm:grid-cols-4">
        {STEPS.map((s) => {
          const state = s.n < step ? "done" : s.n === step ? "now" : "next";
          return (
            <button
              key={s.n}
              type="button"
              onClick={() => setStep(s.n)}
              aria-current={state === "now" ? "step" : undefined}
              className="rounded-xl border p-3 text-start"
              style={{
                background: state === "now" ? "var(--color-surface)" : "transparent",
                borderColor: state === "now" ? "var(--color-border)" : "transparent",
                cursor: "pointer",
              }}
            >
              <span className="mb-1 flex items-center gap-2">
                <span
                  className="grid h-[22px] w-[22px] flex-none place-items-center rounded-full text-sm font-extrabold"
                  style={{
                    background:
                      state === "done"
                        ? "var(--color-primary)"
                        : state === "now"
                          ? "var(--color-text)"
                          : "var(--color-border)",
                    color: state === "next" ? "var(--color-text-muted)" : "var(--color-bg)",
                  }}
                >
                  {state === "done" ? <IconCheck s={13} /> : s.n}
                </span>
                <span className="text-sm font-bold" style={{ color: state === "next" ? "var(--color-text-muted)" : "var(--color-text)" }}>
                  {s.t}
                </span>
              </span>
              <span className="block ps-8 text-sm" style={{ color: "var(--color-text-muted)" }}>{s.s}</span>
            </button>
          );
        })}
      </div>

      <div className="rounded-2xl border p-6" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", minHeight: 320 }}>
        {step === 1 ? (
          <StepOffice allowed={can(user, "settings.manage")} onSaved={() => setStep(2)} />
        ) : null}

        {step === 2 ? (
          <div>
            <h2 className="mb-1 text-xl font-bold">יש לכם מאגר קיים?</h2>
            <p className="mb-5" style={{ color: "var(--color-text-muted)" }}>
              אם הנכסים והלקוחות שלכם באקסל — העלו אותם עכשיו והתחילו עם מערכת
              מלאה. אפשר גם לדלג ולייבא בהמשך.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => router.push("/import")}
                className="rounded-2xl border-2 p-5 text-start"
                style={{ borderColor: "var(--color-primary)", background: "var(--color-bg)", cursor: "pointer" }}
              >
                <span className="mb-3 grid h-11 w-11 place-items-center rounded-xl" style={{ background: "var(--color-primary-soft)", color: "var(--color-primary)" }}>
                  <IconSheet s={21} />
                </span>
                <span className="mb-1 block text-lg font-extrabold">ייבוא מאקסל</span>
                <span className="block text-sm leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                  נכסים ולקוחות, גם ‎.xlsx‎ וגם ‎.csv‎ — אתם מעלים את הקובץ כמו
                  שהוא והמערכת מזהה את העמודות.
                </span>
              </button>
              <button
                type="button"
                onClick={() => setStep(3)}
                className="rounded-2xl border p-5 text-start"
                style={{ borderColor: "var(--color-border)", background: "var(--color-bg)", cursor: "pointer" }}
              >
                <span className="mb-3 grid h-11 w-11 place-items-center rounded-xl" style={{ background: "var(--color-border)", color: "var(--color-text-muted)" }}>
                  <IconMic s={21} />
                </span>
                <span className="mb-1 block text-lg font-extrabold">מתחילים מאפס</span>
                <span className="block text-sm leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                  נקלוט את הנכסים בדיבור, אחד-אחד, לפי הקצב שלכם.
                </span>
              </button>
            </div>
          </div>
        ) : null}

        {step === 3 ? <StepAgents allowed={can(user, "users.manage")} /> : null}

        {step === 4 ? (
          <div>
            <h2 className="mb-1 text-xl font-bold">עכשיו הנכס הראשון</h2>
            <p className="mb-5" style={{ color: "var(--color-text-muted)" }}>
              לחצו על המיקרופון ותארו את הנכס במילים שלכם — הכרטיס נבנה מהדיבור,
              ותוכלו לתקן כל שדה לפני השמירה.
            </p>
            <div className="flex flex-wrap items-center gap-6">
              <div className="flex-none text-center">
                <button
                  type="button"
                  onClick={() => router.push("/voice")}
                  aria-label="קליטת נכס בקול"
                  className="grid h-[104px] w-[104px] place-items-center rounded-full border-0"
                  style={{ background: "var(--color-primary)", color: "var(--color-bg)", cursor: "pointer" }}
                >
                  <IconMic s={42} />
                </button>
                <p className="mt-3 text-sm font-bold" style={{ color: "var(--color-text-muted)" }}>
                  לחצו והתחילו לדבר
                </p>
              </div>
              <div className="min-w-[240px] flex-1 rounded-xl border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}>
                <p className="mb-2 text-sm font-bold" style={{ color: "var(--color-text-muted)" }}>
                  לדוגמה, אפשר להגיד:
                </p>
                <p className="m-0 leading-relaxed">
                  „דירת 4 חדרים ברחוב הרצל 12 בבית שמש, קומה 3 מתוך 6, עם מעלית
                  וחניה, 2.4 מיליון, כניסה בעוד חודשיים.”
                </p>
              </div>
            </div>
            <p className="mt-5 flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
              <IconUsers s={16} />
              את שאר ההגדרות (וואטסאפ, טלפוניה, יומן גוגל) מפעילים ממסך ההגדרות — כל
              אחת כשתצטרכו אותה.
            </p>
          </div>
        ) : null}

        {/* פוטר ניווט אחיד: המשך / חזרה / דלגו — כמו בעיצוב */}
        <div className="mt-7 flex flex-wrap items-center gap-2 border-t pt-5" style={{ borderColor: "var(--color-border)" }}>
          {step > 1 && step < 4 ? (
            <Button onClick={() => setStep(step + 1)}>המשך</Button>
          ) : null}
          {step === 4 ? (
            <Button onClick={() => router.push("/")}>סיימנו — קחו אותי לדשבורד</Button>
          ) : null}
          {step > 1 ? (
            <Button variant="ghost" onClick={() => setStep(step - 1)}>חזרה</Button>
          ) : null}
          <div className="flex-1" />
          {step < 4 ? (
            <Button variant="ghost" onClick={() => setStep(step + 1)}>דלגו לשלב הבא</Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
