"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { roleLabel } from "@metavchim/shared";
import { apiGet, apiPatch, apiPost, ApiError } from "@/lib/api";
import { SessionsList } from "../sessions-list";

/** הפרופיל כפי שהשרת מחזיר אותו (‎GET /auth/profile). */
interface ProfileDto {
  name: string;
  email: string;
  phone: string;
  hasPassword: boolean;
  preferences: Record<string, unknown>;
}
import {
  A11Y_DEFAULTS,
  A11Y_MAX_SCALE,
  A11Y_MIN_SCALE,
  A11Y_TOGGLES,
  applyA11y,
  clampFontScale,
  clearA11y,
  loadA11y,
  saveA11y,
  type A11yPrefs,
} from "@/lib/a11y-prefs";
import { disablePush, enablePush, readPushState, type PushState } from "@/lib/push";
import { useRequireAuth } from "@/lib/use-auth";
import { resetA11ySync } from "@/lib/a11y-sync";
import { clearSessionCache } from "@/lib/session-cache";
import { ThemeToggle } from "../theme-toggle";
import { PlanSection } from "../settings/plan-section";
import { Notice } from "../notice";
import { WhatsAppLinkSection } from "./whatsapp-link-section";
import { WhatsAppNotifySection } from "./whatsapp-notify-section";

/**
 * הפרופיל האישי — כל מה ששייך למשתמש הזה ולא למשרד: ערכת נושא,
 * התראות בדפדפן, העדפות נגישות והחלפת סיסמה.
 *
 * בחירת מצב ההכתבה *אינה* כאן במכוון: היא נעשית בכל מקום שמקליטים,
 * בשני כפתורים ליד השדה. הגדרה מרוחקת שמשפיעה על מסך אחר היא בדיוק
 * מה שגורם למשתמש לחשוב שהמערכת מתעלמת ממנו.
 *
 * ההעדפות נשמרות במכשיר (localStorage) ולא בשרת: הן תלויות מסך ועכבר,
 * וסוכן שעובד גם מהנייד וגם מהמשרד ירצה הגדרות שונות בכל אחד.
 */

const inputStyle = { borderColor: "var(--color-input-border)", background: "var(--color-field)" } as const;

export default function ProfilePage() {
  const { user, loading } = useRequireAuth();
  const router = useRouter();
  const [prefs, setPrefs] = useState<A11yPrefs>(A11Y_DEFAULTS);
  const [passwordMsg, setPasswordMsg] = useState<string | null>(null);
  const [passwordErr, setPasswordErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<ProfileDto | null>(null);
  const [detailsMsg, setDetailsMsg] = useState<string | null>(null);
  const [detailsErr, setDetailsErr] = useState<string | null>(null);

  useEffect(() => {
    /*
     * הסנכרון מהשרת עצמו כבר קרה ב-AccessibilityRuntime, שמורכב בכל
     * מסך. כאן נדרשים רק פרטי הפרופיל לטופס, וההעדפות נקראות
     * מהמטמון — שכבר מעודכן מהשרת באותה נקודה.
     */
    setPrefs(loadA11y());
    apiGet<ProfileDto>("/auth/profile")
      .then((res) => {
        setProfile(res);
        const fromServer = res.preferences?.a11y as Partial<A11yPrefs> | undefined;
        const merged = fromServer ? { ...A11Y_DEFAULTS, ...fromServer } : A11Y_DEFAULTS;
        // ערך שנשמר בשרת לפני שנקבעה הרצפה מגיע לכאן כמו שהוא
        setPrefs({ ...merged, fontScale: clampFontScale(merged.fontScale) });
      })
      .catch(() => undefined);
  }, []);

  /**
   * שמירה בשרת היא מה שהופך את ההעדפה לאישית ולא למכשירית.
   *
   * היא נשלחת ולא מומתנת: המשתמש כבר רואה את השינוי מהמטמון, וכישלון
   * רשת לא צריך להחזיר לו את המסך אחורה — הוא ייסנכרן בשינוי הבא.
   */
  function persist(next: A11yPrefs): void {
    apiPatch("/auth/profile", { preferences: { ...(profile?.preferences ?? {}), a11y: next } }).catch(
      () => undefined,
    );
  }

  function update(patch: Partial<A11yPrefs>): void {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    applyA11y(next);
    saveA11y(next);
    persist(next);
    // הרכיב שמרנדר את קו הקריאה יושב ב-layout ולא כאן
    window.dispatchEvent(new CustomEvent("mv-a11y-change", { detail: next }));
  }

  function resetPrefs(): void {
    setPrefs(A11Y_DEFAULTS);
    applyA11y(A11Y_DEFAULTS);
    clearA11y();
    persist(A11Y_DEFAULTS);
    window.dispatchEvent(new CustomEvent("mv-a11y-change", { detail: A11Y_DEFAULTS }));
  }

  async function saveDetails(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const nextEmail = String(data.get("email") ?? "").trim();
    const emailChanging = profile !== null && nextEmail.toLowerCase() !== profile.email.toLowerCase();
    setDetailsMsg(null);
    setDetailsErr(null);
    try {
      const updated = await apiPatch<ProfileDto>("/auth/profile", {
        name: String(data.get("name") ?? "").trim(),
        phone: String(data.get("phone") ?? "").trim(),
        email: nextEmail,
        ...(emailChanging
          ? { currentPassword: String(data.get("emailPassword") ?? "") }
          : {}),
      });
      setProfile(updated);
      form.reset();
      setDetailsMsg(
        emailChanging
          ? "✓ הפרטים נשמרו. כתובת ההתחברות השתנתה — חיבורים פתוחים אחרים נותקו."
          : "✓ הפרטים נשמרו",
      );
    } catch (err: unknown) {
      setDetailsErr(err instanceof ApiError ? err.message : "השמירה נכשלה");
    }
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
    // המטמון קודם: המעטפת נשארת טעונה בין משתמשים, ובלי הניקוי
    // המשתמש הבא באותה לשונית יקבל את הזהות של הקודם עד לתפוגה
    clearSessionCache();
    /*
     * גם דגל סנכרון הנגישות — לא רק מטמון הזהות.
     *
     * `syncA11yFromServer` רץ פעם אחת לטעינת עמוד, ויציאה דרך
     * `router.replace` אינה טוענת מחדש. בלי האיפוס המשתמש הבא
     * באותה לשונית יורש את הפונט, הניגודיות וקו הקריאה של הקודם —
     * בדיוק מה שהמטמון תוקן כדי למנוע (ביקורת Codex), בחצי השני
     * של אותה בעיה.
     */
    resetA11ySync();
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
          style={{ width: 52, height: 52, background: "var(--color-primary-soft)", color: "var(--color-primary)", fontWeight: 800, fontSize: 20 }}
        >
          {user.name.trim().slice(0, 1)}
        </span>
        <div className="min-w-0">
          <h1 className="m-0" style={{ fontSize: 22, fontWeight: 800 }}>{user.name}</h1>
          <p className="m-0 mt-1 text-[length:var(--type-body-sm)]" style={{ color: "var(--color-text-muted)" }}>
            <span dir="ltr">{user.email}</span> · {roleLabel(user.role)}
            {user.tenantName ? ` · ${user.tenantName}` : ""}
          </p>
        </div>
        <button type="button" className="mv-btn-plain ms-auto" onClick={() => void logout()}>
          התנתקות
        </button>
      </div>

      <div className="grid items-start gap-[18px] lg:[grid-template-columns:1fr_1fr]">
        <div className="flex flex-col gap-[18px]">
          {/* ---- הפרטים שלי ---- */}
          <section className="mv-list-card px-5 py-[17px]" aria-labelledby="details-heading">
            <h2 id="details-heading" className="m-0 mb-1" style={{ fontSize: 16.5, fontWeight: 800 }}>
              הפרטים שלי
            </h2>
            <p className="m-0 mb-3 text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-muted)" }}>
              הטלפון ישמש להתראות בוואטסאפ כשהחיבור יופעל במשרד.
            </p>

            {detailsMsg ? (
              <Notice tone="success">{detailsMsg}</Notice>
            ) : null}
            {detailsErr ? (
              <Notice tone="danger">{detailsErr}</Notice>
            ) : null}

            {profile ? (
              <form method="post" onSubmit={(e) => void saveDetails(e)}>
                <div className="mb-3">
                  <label htmlFor="pf-name" className="mb-1 block text-sm font-semibold">שם מלא</label>
                  <input id="pf-name" name="name" defaultValue={profile.name} required minLength={2} maxLength={120} className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
                </div>
                <div className="mb-3">
                  <label htmlFor="pf-phone" className="mb-1 block text-sm font-semibold">טלפון</label>
                  <input id="pf-phone" name="phone" dir="ltr" inputMode="tel" placeholder="050-1234567" defaultValue={profile.phone} maxLength={20} className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
                </div>
                <div className="mb-3">
                  <label htmlFor="pf-email" className="mb-1 block text-sm font-semibold">כתובת אימייל</label>
                  <input id="pf-email" name="email" type="email" dir="ltr" defaultValue={profile.email} required maxLength={254} disabled={!profile.hasPassword} className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
                  {profile.hasPassword ? (
                    <>
                      <label htmlFor="pf-email-password" className="mb-1 mt-2 block text-sm font-semibold">
                        סיסמה נוכחית <span className="font-normal">(רק אם שיניתם את האימייל)</span>
                      </label>
                      <p className="m-0 mb-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
                        האימייל הוא כתובת ההתחברות, ולכן שינוי שלו דורש אימות ומנתק חיבורים פתוחים אחרים.
                      </p>
                      <input id="pf-email-password" name="emailPassword" type="password" autoComplete="current-password" className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
                    </>
                  ) : (
                    <p className="m-0 mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
                      החשבון מחובר דרך Google — כתובת האימייל מנוהלת שם.
                    </p>
                  )}
                </div>
                <button type="submit" className="mv-btn-action">שמור פרטים</button>
              </form>
            ) : (
              <p className="m-0 text-sm" style={{ color: "var(--color-text-muted)" }}>טוען…</p>
            )}
          </section>

          {/* ---- תצוגה ---- */}
          <section className="mv-list-card px-5 py-[17px]" aria-labelledby="display-heading">
            <h2 id="display-heading" className="m-0 mb-1" style={{ fontSize: 16.5, fontWeight: 800 }}>
              תצוגה
            </h2>
            <p className="m-0 mb-3 text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
              ההגדרות נשמרות במכשיר הזה בלבד.
            </p>
            <ThemeToggle />
          </section>

          <PushSection />

          <WhatsAppLinkSection />
          <WhatsAppNotifySection />

          {/* ---- סיסמה ---- */}
          <section className="mv-list-card px-5 py-[17px]" aria-labelledby="password-heading">
            <h2 id="password-heading" className="m-0 mb-3" style={{ fontSize: 16.5, fontWeight: 800 }}>
              החלפת סיסמה
            </h2>
            <form method="post" onSubmit={(e) => void changePassword(e)} className="flex max-w-sm flex-col gap-3">
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
                <Notice tone="success">{passwordMsg}</Notice>
              ) : null}
              {passwordErr ? (
                <Notice tone="danger">{passwordErr}</Notice>
              ) : null}
            </form>
          </section>
        </div>

        {/* ---- חיבורים פתוחים ---- */}
        <section className="mv-list-card px-5 py-[17px]" aria-labelledby="sessions-heading">
          <h2 id="sessions-heading" className="m-0 mb-1" style={{ fontSize: 16.5, fontWeight: 800 }}>
            חיבורים פתוחים
          </h2>
          <p className="m-0 mb-3 text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
            כל מכשיר שמחובר לחשבון שלך עכשיו. חיבור שאינך מזהה — נתק אותו
            והחלף סיסמה.
          </p>
          <SessionsList />
        </section>

        {/* ---- נגישות ---- */}
        <section className="mv-list-card px-5 py-[17px]" aria-labelledby="a11y-heading">
          <h2 id="a11y-heading" className="m-0 mb-1" style={{ fontSize: 16.5, fontWeight: 800 }}>
            נגישות
          </h2>
          <p className="m-0 mb-3 text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
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
                disabled={prefs.fontScale <= A11Y_MIN_SCALE}
                onClick={() => update({ fontScale: clampFontScale(prefs.fontScale - 10) })}
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
                disabled={prefs.fontScale >= A11Y_MAX_SCALE}
                onClick={() => update({ fontScale: clampFontScale(prefs.fontScale + 10) })}
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
                    <span className="block text-sm" style={{ opacity: 0.85 }}>{toggle.hint}</span>
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

      {/*
        בתחתית ולא בראש: כרטיס עיון — לא פעולה יומיומית, והוא דחף את
        הפרטים האישיים מתחת לקו המסך. המסלול נשאר בפרופיל בכלל כי
        סוכן, עוזר וצופה הם בדיוק מי שנתקל בקיר של פיצ'ר — ומסך
        ההגדרות סגור בפניהם (settings.manage); בלעדי זה ההסבר שהשרת
        מכין להם היה בלתי נגיש (ביקורת Codex). קו ה-SIP האישי כבר לא
        כאן — הקווים מוקצים בידי מנהל המשרד בהגדרות המרכזייה.
      */}
      <div className="mt-[18px] flex flex-col gap-[18px]">
        <PlanSection />
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
      <h2 id="push-heading" className="m-0 mb-1" style={{ fontSize: 16.5, fontWeight: 800 }}>
        התראות בדפדפן
      </h2>
      <p className="m-0 mb-3 text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
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
          התראות הדפדפן טרם הופעלו במערכת. פנו לתמיכה — הכפתור בצד המסך.
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
              <span className="block text-sm" style={{ opacity: 0.85 }}>
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
            <Notice tone="danger">{error}</Notice>
          ) : null}
        </>
      )}
    </section>
  );
}
