"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { apiPost, ApiError } from "@/lib/api";
import {
  A11Y_DEFAULTS,
  A11Y_TOGGLES,
  applyA11y,
  clearA11y,
  loadA11y,
  saveA11y,
  type A11yPrefs,
} from "@/lib/a11y-prefs";
import {
  DEFAULT_DICTATION_MODE,
  loadPreferredMode,
  savePreferredMode,
  type DictationMode,
} from "@/lib/dictation";
import { disablePush, enablePush, readPushState, type PushState } from "@/lib/push";
import { useRequireAuth } from "@/lib/use-auth";
import { ThemeToggle } from "../theme-toggle";

/**
 * הפרופיל האישי — כל מה ששייך למשתמש הזה ולא למשרד: ערכת נושא,
 * העדפת ההכתבה, העדפות נגישות והחלפת סיסמה.
 *
 * ההעדפות נשמרות במכשיר (localStorage) ולא בשרת: הן תלויות מסך ועכבר,
 * וסוכן שעובד גם מהנייד וגם מהמשרד ירצה הגדרות שונות בכל אחד.
 */

const ROLE_LABELS: Record<string, string> = {
  owner: "בעלים",
  admin: "מנהל",
  agent: "סוכן",
  assistant: "עוזר",
  viewer: "צפייה בלבד",
};

export default function ProfilePage() {
  const { user, loading } = useRequireAuth();
  const router = useRouter();
  const [prefs, setPrefs] = useState<A11yPrefs>(A11Y_DEFAULTS);
  const [mode, setMode] = useState<DictationMode>(DEFAULT_DICTATION_MODE);
  const [passwordMsg, setPasswordMsg] = useState<string | null>(null);
  const [passwordErr, setPasswordErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPrefs(loadA11y());
    setMode(loadPreferredMode());
  }, []);

  function update(patch: Partial<A11yPrefs>): void {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    applyA11y(next);
    saveA11y(next);
    // הרכיב שמרנדר את קו הקריאה יושב ב-layout ולא כאן
    window.dispatchEvent(new CustomEvent("mv-a11y-change", { detail: next }));
  }

  function resetPrefs(): void {
    setPrefs(A11Y_DEFAULTS);
    applyA11y(A11Y_DEFAULTS);
    clearA11y();
    window.dispatchEvent(new CustomEvent("mv-a11y-change", { detail: A11Y_DEFAULTS }));
  }

  function chooseMode(next: DictationMode): void {
    setMode(next);
    savePreferredMode(next);
  }

  async function changePassword(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const next = String(data.get("newPassword"));
    if (next !== String(data.get("confirmPassword"))) {
      setPasswordErr("הסיסמאות אינן זהות");
      setPasswordMsg(null);
      return;
    }
    setSaving(true);
    setPasswordErr(null);
    setPasswordMsg(null);
    try {
      await apiPost("/auth/change-password", {
        currentPassword: String(data.get("currentPassword")),
        newPassword: next,
      });
      form.reset();
      setPasswordMsg("✓ הסיסמה הוחלפה. שאר המכשירים שלך נותקו.");
    } catch (err: unknown) {
      setPasswordErr(err instanceof ApiError ? err.message : "החלפת הסיסמה נכשלה");
    } finally {
      setSaving(false);
    }
  }

  async function logout(): Promise<void> {
    try {
      await apiPost("/auth/logout", {});
    } finally {
      router.replace("/login");
    }
  }

  if (loading || !user) return <p aria-live="polite">טוען…</p>;

  return (
    <>
      {/* ---- כרטיס הזהות ---- */}
      <div className="mv-list-card mb-[18px] flex flex-wrap items-center gap-4 p-6">
        <span
          aria-hidden="true"
          className="grid flex-none place-items-center rounded-full"
          style={{ width: 52, height: 52, background: "var(--color-primary-soft)", color: "var(--color-primary)", fontWeight: 800, fontSize: 19 }}
        >
          {user.name.trim().slice(0, 1)}
        </span>
        <div className="min-w-0">
          <h1 className="m-0" style={{ fontSize: 22, fontWeight: 800 }}>{user.name}</h1>
          <p className="m-0 mt-1 text-[13.5px]" style={{ color: "var(--color-text-muted)" }}>
            <span dir="ltr">{user.email}</span> · {ROLE_LABELS[user.role] ?? user.role}
            {user.tenantName ? ` · ${user.tenantName}` : ""}
          </p>
        </div>
        <button type="button" className="mv-btn-plain ms-auto" onClick={() => void logout()}>
          התנתקות
        </button>
      </div>

      <div className="grid items-start gap-[18px] lg:[grid-template-columns:1fr_1fr]">
        <div className="flex flex-col gap-[18px]">
          {/* ---- תצוגה ---- */}
          <section className="mv-list-card px-5 py-[17px]" aria-labelledby="display-heading">
            <h2 id="display-heading" className="m-0 mb-1" style={{ fontSize: 15.5, fontWeight: 800 }}>
              תצוגה
            </h2>
            <p className="m-0 mb-3 text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
              ההגדרות נשמרות במכשיר הזה בלבד.
            </p>
            <ThemeToggle />
          </section>

          {/* ---- הכתבה ---- */}
          <section className="mv-list-card px-5 py-[17px]" aria-labelledby="dictation-heading">
            <h2 id="dictation-heading" className="m-0 mb-1" style={{ fontSize: 15.5, fontWeight: 800 }}>
              הקלטה והכתבה
            </h2>
            <p className="m-0 mb-3 text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
              בכל שדה טקסט במערכת אפשר להכתיב במקום להקליד. כאן בוחרים מה יהיה מודגש
              כברירת מחדל — שני המצבים תמיד זמינים בשדה עצמו.
            </p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                className="mv-a11y-toggle"
                aria-pressed={mode === "browser"}
                onClick={() => chooseMode("browser")}
              >
                <span className="text-start">
                  <span className="block font-bold">מהיר — זיהוי בדפדפן</span>
                  <span className="block text-xs" style={{ opacity: 0.85 }}>
                    הטקסט מופיע תוך כדי הדיבור. פחות מדויק בעברית, לא עובד בכל דפדפן.
                  </span>
                </span>
                <span aria-hidden="true">{mode === "browser" ? "✓" : ""}</span>
              </button>
              <button
                type="button"
                className="mv-a11y-toggle"
                aria-pressed={mode === "server"}
                onClick={() => chooseMode("server")}
              >
                <span className="text-start">
                  <span className="block font-bold">מדויק — תמלול על השרת</span>
                  <span className="block text-xs" style={{ opacity: 0.85 }}>
                    הטקסט מגיע בסוף ההקלטה, אבל העברית טובה בהרבה. ההקלטה לא יוצאת
                    מהשרת של המשרד ונמחקת מיד.
                  </span>
                </span>
                <span aria-hidden="true">{mode === "server" ? "✓" : ""}</span>
              </button>
            </div>
          </section>

          <PushSection />

          {/* ---- סיסמה ---- */}
          <section className="mv-list-card px-5 py-[17px]" aria-labelledby="password-heading">
            <h2 id="password-heading" className="m-0 mb-3" style={{ fontSize: 15.5, fontWeight: 800 }}>
              החלפת סיסמה
            </h2>
            <form onSubmit={(e) => void changePassword(e)} className="flex max-w-sm flex-col gap-3">
              <label>
                <span className="mb-1 block text-sm font-semibold">הסיסמה הנוכחית</span>
                <input name="currentPassword" type="password" required autoComplete="current-password" className="mv-field" />
              </label>
              <label>
                <span className="mb-1 block text-sm font-semibold">סיסמה חדשה</span>
                <input name="newPassword" type="password" required minLength={10} autoComplete="new-password" className="mv-field" />
              </label>
              <label>
                <span className="mb-1 block text-sm font-semibold">אימות הסיסמה החדשה</span>
                <input name="confirmPassword" type="password" required minLength={10} autoComplete="new-password" className="mv-field" />
              </label>
              <div>
                <button type="submit" className="mv-btn-action" disabled={saving}>
                  {saving ? "מחליף…" : "החלף סיסמה"}
                </button>
              </div>
              {passwordMsg ? (
                <p role="status" className="m-0 text-sm font-bold" style={{ color: "var(--color-primary)" }}>
                  {passwordMsg}
                </p>
              ) : null}
              {passwordErr ? (
                <p role="alert" className="m-0 text-sm" style={{ color: "var(--color-danger)" }}>
                  {passwordErr}
                </p>
              ) : null}
            </form>
          </section>
        </div>

        {/* ---- נגישות ---- */}
        <section className="mv-list-card px-5 py-[17px]" aria-labelledby="a11y-heading">
          <h2 id="a11y-heading" className="m-0 mb-1" style={{ fontSize: 15.5, fontWeight: 800 }}>
            נגישות
          </h2>
          <p className="m-0 mb-3 text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
            ההתאמות חלות מיד ונשמרות למכשיר הזה.
          </p>

          <div className="mb-4">
            <p id="fontsize-label" className="m-0 mb-1.5 text-sm font-semibold">
              גודל טקסט: {prefs.fontScale}%
            </p>
            <div className="flex gap-2" role="group" aria-labelledby="fontsize-label">
              <button
                type="button"
                className="mv-btn-plain"
                onClick={() => update({ fontScale: Math.max(90, prefs.fontScale - 10) })}
              >
                <span aria-hidden="true">A−</span>
                <span className="mv-visually-hidden">הקטן טקסט</span>
              </button>
              <button type="button" className="mv-btn-plain" onClick={() => update({ fontScale: 100 })}>
                איפוס
              </button>
              <button
                type="button"
                className="mv-btn-plain"
                onClick={() => update({ fontScale: Math.min(200, prefs.fontScale + 10) })}
              >
                <span aria-hidden="true">A+</span>
                <span className="mv-visually-hidden">הגדל טקסט</span>
              </button>
            </div>
          </div>

          <ul className="m-0 mb-4 flex list-none flex-col gap-2 p-0">
            {A11Y_TOGGLES.map((toggle) => (
              <li key={toggle.key}>
                <button
                  type="button"
                  aria-pressed={Boolean(prefs[toggle.key])}
                  onClick={() => update({ [toggle.key]: !prefs[toggle.key] } as Partial<A11yPrefs>)}
                  className="mv-a11y-toggle"
                >
                  <span className="text-start">
                    <span className="block font-bold">{toggle.label}</span>
                    <span className="block text-xs" style={{ opacity: 0.85 }}>{toggle.hint}</span>
                  </span>
                  <span aria-hidden="true">{prefs[toggle.key] ? "✓" : ""}</span>
                </button>
              </li>
            ))}
          </ul>

          <button type="button" className="mv-btn-plain" onClick={resetPrefs}>
            אפס את כל ההתאמות
          </button>
        </section>
      </div>
    </>
  );
}

/**
 * התראות פוש בדפדפן.
 *
 * שלושה תנאים בלתי-תלויים חייבים להתקיים, ולכל אחד יש הודעה משלו:
 * הדפדפן תומך, השרת הוגדר עם מפתחות VAPID, והמשתמש אישר. "לא זמין"
 * גנרי היה שולח מתווך לחפש תקלה במקום הלא נכון — למשל להאשים את
 * המערכת כשההרשאה נחסמה בהגדרות הדפדפן שלו.
 */
function PushSection() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void readPushState().then(setState);
  }, []);

  useEffect(refresh, [refresh]);

  async function toggle(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      if (state?.subscribed) {
        await disablePush();
      } else {
        const failure = await enablePush();
        if (failure) setError(failure);
      }
      refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mv-list-card px-5 py-[17px]" aria-labelledby="push-heading">
      <h2 id="push-heading" className="m-0 mb-1" style={{ fontSize: 15.5, fontWeight: 800 }}>
        התראות בדפדפן
      </h2>
      <p className="m-0 mb-3 text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
        ליד חדש, הצעה שנפתחה או תזכורת לפגישה — קופצים על המסך גם כשהמערכת
        סגורה. ההגדרה היא לדפדפן הזה בלבד; במכשיר אחר צריך להפעיל שוב.
      </p>

      {state === null ? (
        <p aria-live="polite" className="m-0 text-sm">בודק…</p>
      ) : state.support === "unsupported" ? (
        <p className="m-0 text-sm" style={{ color: "var(--color-text-muted)" }}>
          הדפדפן הזה אינו תומך בהתראות. באייפון צריך להוסיף את המערכת למסך
          הבית (שיתוף ← הוסף למסך הבית) ואז להפעיל משם.
        </p>
      ) : state.support === "not-configured" ? (
        <p className="m-0 text-sm" style={{ color: "var(--color-text-muted)" }}>
          התראות הדפדפן טרם הופעלו בשרת של המשרד. פנו למנהל המערכת.
        </p>
      ) : (
        <>
          <button
            type="button"
            className="mv-a11y-toggle"
            aria-pressed={state.subscribed}
            disabled={busy}
            onClick={() => void toggle()}
          >
            <span className="text-start">
              <span className="block font-bold">
                {state.subscribed ? "התראות פעילות בדפדפן הזה" : "הפעל התראות בדפדפן הזה"}
              </span>
              <span className="block text-xs" style={{ opacity: 0.85 }}>
                {state.subscribed
                  ? "לחיצה תכבה אותן במכשיר הזה"
                  : "הדפדפן יבקש אישור פעם אחת"}
              </span>
            </span>
            <span aria-hidden="true">{state.subscribed ? "✓" : ""}</span>
          </button>

          {state.permission === "denied" && !state.subscribed ? (
            <p className="mt-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
              ההרשאה חסומה בהגדרות הדפדפן לאתר הזה. יש לאפשר אותה שם, ואז לחזור לכאן.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="mt-2 text-sm" style={{ color: "var(--color-danger)" }}>
              {error}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
