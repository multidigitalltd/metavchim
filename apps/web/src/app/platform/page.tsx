"use client";

import { Fragment, useCallback, useEffect, useState, type FormEvent } from "react";
import { CAPABILITY_MODULES, PLAN_FEATURES } from "@metavchim/shared";
import { Button } from "@metavchim/ui";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useRequireAuth } from "@/lib/use-auth";
import { IconPlus } from "../icons";
import { BackupsSection } from "./backups-section";
import { LeadPricesSection } from "./lead-prices-section";
import { PaymentsSection } from "./payments-section";
import { PlansSection } from "./plans-section";
import { CouponsSection } from "./coupons-section";
import { PlatformSettingsSection } from "./platform-settings-section";
import { LegalDocsSection } from "./legal-docs-section";
import { CreditEconomySection } from "./credit-economy-section";
import { SystemUpdateSection } from "./system-update-section";
import { SupportDeskSection } from "./support-desk-section";
import { PayoutDeskSection } from "./payout-desk-section";

/**
 * ניהול הפלטפורמה — הקמת משרדי תיווך חדשים בלי SSH. נגיש רק למנהלי
 * הפלטפורמה (PLATFORM_ADMIN_EMAILS); לכל שאר המשתמשים מוצג "אין הרשאה".
 */

const inputStyle = { borderColor: "var(--color-border)", background: "var(--color-field)" } as const;

interface AgencyRow {
  id: string;
  name: string;
  plan: string;
  status: string;
  userCount: number;
  createdAt: string;
  trialEndsAt: string | null;
  paidUntil: string | null;
  /** true = מחובר אך מוגבל למסך המנוי. */
  periodEnded: boolean;
  /** חלון גישת תמיכה פתוח — null כשאין הסכמה בתוקף. */
  supportAccessUntil: string | null;
  /** מודולים שהפלטפורמה חסמה למשרד — מפתחות מקטלוג המודולים. */
  blockedModules: string[];
  /** תכונות שנפתחו למשרד מעבר למסלול, ותכונות שנסגרו בתוכו. */
  featureGrants: string[];
  featureDenials: string[];
  /** מחיר מוסכם באגורות; null = מחיר המסלול. */
  priceOverrideMonthlyAgorot: number | null;
  priceOverrideYearlyAgorot: number | null;
}

/**
 * רשימת המסלולים מגיעה מהקטלוג ולא מקבועה במסך.
 *
 * הרשימה הייתה כתובה כאן, ולכן מסלול שבעל הפלטפורמה הגדיר לא היה
 * מופיע בטופס — כלומר אי אפשר היה לשייך אליו משרד.
 */
interface PlanOption {
  code: string;
  name: string;
  /** התכונות שבמסלול — כדי שמסך החריגים יראה מה חריג ומה לא. */
  features?: string[];
}

/**
 * עורך חסימות המודולים למשרד.
 *
 * הרשימה היא **אותו קטלוג** שמנהל המשרד רואה במסך ההרשאות שלו, ולא
 * העתק שלה: מודול שנוסף למערכת מופיע בשני המקומות בלי לזכור לעדכן
 * מסך שני. ההבדל הוא מי מחליט — כאן זו הפלטפורמה, והמשרד אינו יכול
 * לבטל.
 *
 * המצב מוחזק מקומית ונשמר בלחיצה אחת: סימון שנשלח לשרת בכל תיבה היה
 * משאיר את המשרד עם חצי חסימה כשמישהו סוגר את הדפדפן באמצע.
 */
function ModuleBlocks({
  agency,
  onSave,
  onCancel,
}: {
  agency: AgencyRow;
  onSave: (blockedModules: string[]) => void;
  onCancel: () => void;
}) {
  const [blocked, setBlocked] = useState<string[]>(agency.blockedModules);

  function toggle(key: string): void {
    setBlocked((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  return (
    <div>
      <p className="m-0 mb-2 text-[13px]">
        <b>חסימת מודולים ל{agency.name}</b>{" "}
        <span style={{ color: "var(--color-text-muted)" }}>
          — מודול מסומן נחסם לכל משתמשי המשרד, כולל הבעלים, ומנהל המשרד אינו יכול
          להחזיר אותו ממסך ההרשאות שלו.
        </span>
      </p>
      <ul className="m-0 grid list-none gap-1.5 p-0 md:grid-cols-3">
        {CAPABILITY_MODULES.map((module) => (
          <li key={module.key}>
            <label className="flex items-start gap-2 text-[12.5px]">
              <input
                type="checkbox"
                checked={blocked.includes(module.key)}
                onChange={() => toggle(module.key)}
                className="mt-0.5"
              />
              <span>
                <b>{module.label}</b>
                <span className="block" style={{ color: "var(--color-text-muted)" }}>
                  {module.description}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => onSave(blocked)}>
          שמור חסימות
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          ביטול
        </Button>
      </div>
    </div>
  );
}

/** `YYYY-MM-DD` לשדה תאריך; ריק כשאין תאריך. */
function dateInputValue(iso: string | null): string {
  return iso ? (iso.slice(0, 10) ?? "") : "";
}

/** אגורות → שקלים לתצוגה; ריק כשאין חריגה. */
function shekelInputValue(agorot: number | null): string {
  return agorot === null ? "" : String(agorot / 100);
}

/**
 * חריגי הפלטפורמה על משרד יחיד — תכונות, חלון החינם ומחיר מוסכם.
 *
 * שלושתם במסך אחד משום שהם אותה שיחה מסחרית: מה המשרד הזה מקבל,
 * עד מתי בחינם, וכמה הוא משלם. פיצול שלהם היה מאלץ לזכור את השניים
 * האחרים בכל פעם שנוגעים באחד.
 *
 * לכל תכונה שלושה מצבים ולא תיבת סימון אחת: „לפי המסלול” הוא מצב
 * בפני עצמו, ולא „לא מסומן”. בלעדיו אי אפשר לבטל חריג ולחזור
 * להתנהגות הרגילה — רק להחליף אותו בחריג הפוך, שממשיך לחול גם
 * אחרי שהמסלול משתנה.
 */
function TenantOverrides({
  agency,
  planFeatures,
  onSaveFeatures,
  onSaveBilling,
  onCancel,
}: {
  agency: AgencyRow;
  /** התכונות שבמסלול של המשרד — כדי להראות מה חריג ומה לא. */
  planFeatures: string[];
  onSaveFeatures: (grants: string[], denials: string[]) => void;
  onSaveBilling: (patch: Record<string, string | number | null>) => void;
  onCancel: () => void;
}) {
  const [grants, setGrants] = useState<string[]>(agency.featureGrants);
  const [denials, setDenials] = useState<string[]>(agency.featureDenials);
  const [trialEndsAt, setTrialEndsAt] = useState(dateInputValue(agency.trialEndsAt));
  const [paidUntil, setPaidUntil] = useState(dateInputValue(agency.paidUntil));
  const [monthly, setMonthly] = useState(shekelInputValue(agency.priceOverrideMonthlyAgorot));
  const [yearly, setYearly] = useState(shekelInputValue(agency.priceOverrideYearlyAgorot));

  /** „לפי המסלול” | „פתוח” | „סגור” — שלושת המצבים של תכונה. */
  function stateOf(code: string): "plan" | "open" | "closed" {
    if (denials.includes(code)) return "closed";
    if (grants.includes(code)) return "open";
    return "plan";
  }

  function setState(code: string, next: "plan" | "open" | "closed"): void {
    setGrants((prev) => (next === "open" ? [...new Set([...prev, code])] : prev.filter((c) => c !== code)));
    setDenials((prev) =>
      next === "closed" ? [...new Set([...prev, code])] : prev.filter((c) => c !== code),
    );
  }

  /*
   * שדה ריק = ביטול החריגה (`null`), ולא אפס. זו ההבחנה שמאפשרת
   * להחזיר משרד להתנהגות הרגילה בלי להקים אותו מחדש.
   */
  function shekelToAgorot(value: string): number | null {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const shekels = Number(trimmed);
    return Number.isFinite(shekels) && shekels > 0 ? Math.round(shekels * 100) : null;
  }

  return (
    <div>
      <p className="m-0 mb-2 text-[13px]">
        <b>חריגים ל{agency.name}</b>{" "}
        <span style={{ color: "var(--color-text-muted)" }}>
          — מה שמוגדר כאן גובר על המסלול. „סגור” גובר על „פתוח” תמיד, כדי
          שסגירה תחזיק גם אם התכונה נפתחה קודם ונשכחה.
        </span>
      </p>

      <ul className="m-0 mb-3 grid list-none gap-1.5 p-0 md:grid-cols-2">
        {PLAN_FEATURES.map((feature) => {
          const inPlan = planFeatures.includes(feature.code);
          const state = stateOf(feature.code);
          return (
            <li key={feature.code} className="text-[12.5px]">
              <b>{feature.label}</b>{" "}
              <span style={{ color: "var(--color-text-muted)" }}>
                ({inPlan ? "במסלול" : "לא במסלול"})
              </span>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {(
                  [
                    ["plan", "לפי המסלול"],
                    ["open", "פתוח"],
                    ["closed", "סגור"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={state === value}
                    onClick={() => setState(feature.code, value)}
                    className="rounded-lg border px-2 py-0.5 text-[12px]"
                    style={
                      state === value
                        ? {
                            borderColor: "var(--color-primary)",
                            background: "var(--color-primary-soft)",
                            color: "var(--color-primary)",
                          }
                        : { borderColor: "var(--color-border)" }
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
      <Button variant="secondary" onClick={() => onSaveFeatures(grants, denials)}>
        שמור תכונות
      </Button>

      <hr className="my-3" style={{ borderColor: "var(--color-border)" }} />

      <p className="m-0 mb-2 text-[13px]">
        <b>חלון החינם והמחיר</b>{" "}
        <span style={{ color: "var(--color-text-muted)" }}>
          — שדה ריק מבטל את החריגה ומחזיר להתנהגות הרגילה. „חינם למשרד הזה”
          נעשה בהארכת החלון ולא במחיר אפס.
        </span>
      </p>
      <div className="mb-2 flex flex-wrap gap-3">
        <label className="text-[12.5px]">
          <span className="mb-1 block font-medium">סוף תקופת הניסיון</span>
          <input
            type="date"
            value={trialEndsAt}
            onChange={(e) => setTrialEndsAt(e.target.value)}
            className="rounded-lg border px-2 py-1"
            style={inputStyle}
          />
        </label>
        <label className="text-[12.5px]">
          <span className="mb-1 block font-medium">שולם עד</span>
          <input
            type="date"
            value={paidUntil}
            onChange={(e) => setPaidUntil(e.target.value)}
            className="rounded-lg border px-2 py-1"
            style={inputStyle}
          />
        </label>
        <label className="text-[12.5px]">
          <span className="mb-1 block font-medium">מחיר חודשי מוסכם (₪)</span>
          <input
            type="number"
            min={1}
            value={monthly}
            onChange={(e) => setMonthly(e.target.value)}
            className="w-32 rounded-lg border px-2 py-1"
            style={inputStyle}
          />
        </label>
        <label className="text-[12.5px]">
          <span className="mb-1 block font-medium">מחיר שנתי מוסכם (₪)</span>
          <input
            type="number"
            min={1}
            value={yearly}
            onChange={(e) => setYearly(e.target.value)}
            className="w-32 rounded-lg border px-2 py-1"
            style={inputStyle}
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={() =>
            onSaveBilling({
              /*
               * סוף היום ולא תחילתו: „עד ה-31” פירושו שה-31 עוד
               * פתוח. חצות היה סוגר את המשרד יום שלם מוקדם מדי.
               */
              trialEndsAt: trialEndsAt === "" ? null : new Date(`${trialEndsAt}T23:59:59Z`).toISOString(),
              paidUntil: paidUntil === "" ? null : new Date(`${paidUntil}T23:59:59Z`).toISOString(),
              priceOverrideMonthlyAgorot: shekelToAgorot(monthly),
              priceOverrideYearlyAgorot: shekelToAgorot(yearly),
            })
          }
        >
          שמור חיוב
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          סגור
        </Button>
      </div>
    </div>
  );
}

const STATUS_LABELS: Record<string, string> = {
  active: "פעיל",
  trial: "ניסיון",
  suspended: "מושהה",
  churned: "עזב",
};

/**
 * קיצורי הקפיצה בראש העמוד — [עוגן, תווית].
 *
 * הסדר הוא סדר הסעיפים בעמוד, כדי שהשורה תתפקד גם כתוכן עניינים.
 * "התחברות עם Google" מופיע כאן במפורש: זה הסעיף שמחפשים כשמחברים
 * את המערכת לראשונה, והוא היה קבור בין עשרה סעיפים אחרים.
 */
const JUMP_LINKS: readonly (readonly [string, string])[] = [
  ["platform-system-heading", "עדכוני מערכת"],
  ["platform-backups-heading", "גיבויים"],
  ["plans-heading", "מסלולים"],
  ["coupons-heading", "קופונים"],
  ["lead-prices-heading", "תמחור לידים"],
  ["payments-heading", "תשלומים"],
  ["platform-settings-heading", "חיבורי המערכת"],
  ["legal-heading", "מסמכים משפטיים"],
  // ישירות אל כרטיס Google ולא אל כותרת הסעיף: זה הקיצור שבאמת
  // מחפשים, והוא חייב לנחות על השדות עצמם
  ["google-connections", "חיבורי Google"],
  ["new-agency", "משרד חדש"],
  ["agencies-list", "המשרדים"],
];

export default function PlatformPage() {
  const { loading: authLoading } = useRequireAuth();
  const [agencies, setAgencies] = useState<AgencyRow[] | null>(null);
  /** המשרד שעורכים לו כרגע את חסימות המודולים; null = אף אחד. */
  const [modulesFor, setModulesFor] = useState<string | null>(null);
  const [overridesFor, setOverridesFor] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ ownerEmail: string; tempPassword: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [planOptions, setPlanOptions] = useState<PlanOption[]>([]);

  function load() {
    apiGet<AgencyRow[]>("/platform/agencies")
      .then(setAgencies)
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 403) setForbidden(true);
        else setError("טעינת המשרדים נכשלה");
      });
  }

  const loadPlanOptions = useCallback(() => {
    apiGet<{ plans: PlanOption[] }>("/platform/plans")
      .then((res) => setPlanOptions(res.plans))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!authLoading) {
      load();
      loadPlanOptions();
    }
  }, [authLoading, loadPlanOptions]);

  /**
   * מעבר מסלול — עם אזהרה לפני, לא הודעה אחרי.
   *
   * הורדת מסלול היא הדרך המהירה ביותר לשבור משרד עובד: סוכנים מעל
   * המכסה, מרכזייה שמפסיקה לקלוט. השרת יודע בדיוק מה ייסגר, ולכן
   * שואלים אותו לפני שמאשרים ולא משאירים את זה לניחוש.
   */
  async function changePlan(id: string, plan: string) {
    try {
      const { warnings } = await apiGet<{ warnings: string[] }>(
        `/platform/agencies/${id}/plan-preview?plan=${encodeURIComponent(plan)}`,
      );
      if (warnings.length > 0 && !window.confirm(`${warnings.join("\n")}\n\nלהמשיך?`)) {
        load(); // מחזיר את הבורר לערך שבשרת
        return;
      }
    } catch {
      // תצוגה מקדימה היא שיפור, לא תנאי — כשל בה לא חוסם את השינוי
    }
    await apiPatch(`/platform/agencies/${id}`, { plan });
    load();
  }

  async function supportEnter(agency: AgencyRow) {
    if (
      !window.confirm(
        `להיכנס למשרד "${agency.name}" כתמיכה?\n\nהכניסה תחליף את החיבור הנוכחי שלך — כדי לחזור לפלטפורמה יש להתנתק ולהתחבר שוב. הכניסה נרשמת ביומן הפעילות של המשרד.`,
      )
    ) {
      return;
    }
    try {
      await apiPost(`/platform/agencies/${agency.id}/support-session`, {});
      // העוגייה הוחלפה — מעכשיו אנחנו המשתמש של המשרד
      window.location.href = "/";
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : "הכניסה נכשלה");
    }
  }

  async function toggleSuspend(agency: AgencyRow) {
    const next = agency.status === "suspended" ? "active" : "suspended";
    await apiPatch(`/platform/agencies/${agency.id}`, { status: next });
    load();
  }

  /**
   * שחרור ידני של משרד שתקופתו נגמרה.
   *
   * עד כה לא הייתה לזה שום דרך מהממשק: הסטטוס הוא רק אחד מתנאי
   * הגישה, ומשרד שהסטטוס שלו "פעיל" עדיין נחסם לפי התאריך. הכפתור
   * מנקה את התפוגה, כלומר "המשרד הזה פתוח בלי קשר לחיוב" — אותה
   * משמעות של משרד שהוקם ידנית.
   */
  async function grantAccess(agency: AgencyRow) {
    if (
      !window.confirm(
        `לפתוח את "${agency.name}" ללא תפוגה? הגישה תינתן בלי קשר לתשלום, עד שתוגדר תפוגה חדשה.`,
      )
    ) {
      return;
    }
    await apiPatch(`/platform/agencies/${agency.id}`, { paidUntil: null });
    load();
  }

  /**
   * חסימת מודולים למשרד. הרשימה נשלחת במלואה — המסך מחזיק את המצב
   * המבוקש, והשרת מחליף בו את הקיים.
   */
  async function saveFeatures(agency: AgencyRow, grants: string[], denials: string[]) {
    setError(null);
    try {
      await apiPatch(`/platform/agencies/${agency.id}/features`, { grants, denials });
      setOverridesFor(null);
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "השמירה נכשלה");
    }
  }

  async function saveBillingOverride(
    agency: AgencyRow,
    patch: Record<string, string | number | null>,
  ) {
    setError(null);
    try {
      await apiPatch(`/platform/agencies/${agency.id}/billing-override`, patch);
      setOverridesFor(null);
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "השמירה נכשלה");
    }
  }

  async function saveModules(agency: AgencyRow, blockedModules: string[]) {
    setError(null);
    try {
      await apiPatch(`/platform/agencies/${agency.id}/modules`, { blockedModules });
      setModulesFor(null);
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "שמירת החסימות נכשלה");
    }
  }

  /**
   * מחיקת משרד לצמיתות.
   *
   * הקלדת השם ולא confirm: זו הפעולה היחידה במסך שאי אפשר לחזור
   * ממנה, והיא יושבת בשורה אחת מתוך רשימה של משרדים שנראים אותו
   * דבר. אישור בלחיצה אחת כאן הוא תאונה שמחכה לקרות.
   */
  async function deleteAgency(agency: AgencyRow) {
    const typed = window.prompt(
      `מחיקה לצמיתות של "${agency.name}" — כל הלקוחות, הנכסים, השיחות, ההסכמים והמשתמשים נמחקים ואי אפשר לשחזר.\n\nלאישור הקלידו את שם המשרד במדויק:`,
    );
    if (typed === null) return;
    setError(null);
    try {
      await apiDelete(`/platform/agencies/${agency.id}`, { confirmName: typed });
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "המחיקה נכשלה");
    }
  }

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const form = event.currentTarget;
    const f = new FormData(form);
    try {
      const result = await apiPost<{ ownerEmail: string; tempPassword: string }>(
        "/platform/agencies",
        {
          name: String(f.get("name")).trim(),
          ownerEmail: String(f.get("ownerEmail")).trim(),
          ownerName: String(f.get("ownerName")).trim(),
          plan: String(f.get("plan")),
        },
      );
      setCreated(result);
      form.reset();
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "הקמת המשרד נכשלה");
    } finally {
      setSubmitting(false);
    }
  }

  if (authLoading) return <p aria-live="polite">טוען…</p>;
  if (forbidden) {
    return (
      <p role="alert" style={{ color: "var(--color-text-muted)" }}>
        המסך הזה זמין רק למנהלי הפלטפורמה.
      </p>
    );
  }

  return (
    <>
      <h1 className="mb-2 text-2xl font-bold">ניהול הפלטפורמה</h1>
      <p className="mb-4" style={{ color: "var(--color-text-muted)" }}>
        הקמת משרדי תיווך חדשים וניהולם — כל משרד מבודד לחלוטין, עם הצוות והנתונים שלו.
      </p>

      {/*
        קיצורי קפיצה לסעיפים. העמוד צמח לעשרה סעיפים, ו"התחברות עם
        Google" — הסעיף שמחפשים בו בפועל כשמחברים את המערכת — יושב
        באמצע ואי אפשר למצוא אותו בלי לגלול את כולו. עוגנים ולא
        לשוניות: הסעיפים כאן נקראים ברצף ואין סיבה להסתיר אף אחד.
      */}
      <nav aria-label="קיצורי דרך בעמוד" className="mb-6 flex flex-wrap gap-2">
        {JUMP_LINKS.map(([anchor, label]) => (
          <a key={anchor} href={`#${anchor}`} className="mv-chip" style={{ textDecoration: "none" }}>
            {label}
          </a>
        ))}
      </nav>

      {error ? (
        <p role="alert" className="mb-4 rounded-lg border p-3" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : null}

      {created ? (
        <div role="alert" className="mb-6 rounded-xl border p-4" style={{ borderColor: "var(--color-success)" }}>
          <p className="mb-1 font-semibold">✓ המשרד הוקם!</p>
          <p>
            התחברות: <span dir="ltr" className="font-mono">{created.ownerEmail}</span>
          </p>
          <p>
            סיסמה זמנית (מוצגת פעם אחת — העבירו לבעל המשרד):{" "}
            <span dir="ltr" className="font-mono text-lg">{created.tempPassword}</span>
          </p>
          <Button variant="ghost" className="mt-2" onClick={() => setCreated(null)}>
            סגור
          </Button>
        </div>
      ) : null}

      {/*
        תור התמיכה ראשון: זו הרשימה היחידה במסך הזה שמישהו ממתין
        בקצה השני שלה.
      */}
      <SupportDeskSection />

      {/*
        מיד אחרי התמיכה: גם כאן מישהו ממתין בקצה השני, וכאן הוא ממתין
        לכסף. תור משיכות ששוכב שבוע הוא הדרך המהירה ביותר לאבד את
        אמון המשרדים ברשת ההפניות.
      */}
      <PayoutDeskSection />

      <SystemUpdateSection />

      <BackupsSection />

      <PlansSection onCatalogChange={loadPlanOptions} />
      <CouponsSection />
      <LeadPricesSection />
      <CreditEconomySection />
      <PaymentsSection />

      <PlatformSettingsSection />

      <LegalDocsSection />

      <section aria-labelledby="new-agency" className="mb-8 rounded-xl border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <h2 id="new-agency" className="mb-3 text-lg font-semibold"><IconPlus s={16} /> משרד חדש</h2>
        <form onSubmit={(e) => void onCreate(e)} className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="name" className="mb-1 block font-medium">שם המשרד</label>
            <input id="name" name="name" required minLength={2} className="rounded-lg border px-3 py-2.5" style={inputStyle} />
          </div>
          <div>
            <label htmlFor="ownerName" className="mb-1 block font-medium">שם הבעלים</label>
            <input id="ownerName" name="ownerName" required minLength={2} className="rounded-lg border px-3 py-2.5" style={inputStyle} />
          </div>
          <div>
            <label htmlFor="ownerEmail" className="mb-1 block font-medium">אימייל הבעלים</label>
            <input id="ownerEmail" name="ownerEmail" type="email" required dir="ltr" className="rounded-lg border px-3 py-2.5" style={inputStyle} />
          </div>
          <div>
            <label htmlFor="plan" className="mb-1 block font-medium">מסלול</label>
            <select id="plan" name="plan" defaultValue="pro" className="rounded-lg border px-3 py-2.5" style={inputStyle}>
              {planOptions.map((plan) => (
                <option key={plan.code} value={plan.code}>{plan.name}</option>
              ))}
            </select>
          </div>
          <Button type="submit" disabled={submitting}>
            {submitting ? "מקים…" : "הקם משרד"}
          </Button>
        </form>
      </section>

      <section aria-labelledby="agencies-list">
        <h2 id="agencies-list" className="mb-3 text-lg font-semibold">
          משרדים {agencies !== null ? `(${agencies.length})` : ""}
        </h2>
        {agencies === null ? (
          <p aria-live="polite">טוען…</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--color-border)" }}>
            <table className="w-full">
              <caption className="mv-visually-hidden">משרדי התיווך בפלטפורמה</caption>
              <thead style={{ background: "var(--color-surface)" }}>
                <tr>
                  <th scope="col" className="p-3 text-start">משרד</th>
                  <th scope="col" className="p-3 text-start">מסלול</th>
                  <th scope="col" className="p-3 text-start">סטטוס</th>
                  <th scope="col" className="p-3 text-start">משתמשים</th>
                  <th scope="col" className="p-3 text-start">מודולים</th>
                  <th scope="col" className="p-3 text-start">הוקם</th>
                  <th scope="col" className="p-3 text-start">
                    <span className="mv-visually-hidden">פעולות</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {agencies.map((a) => (
                  <Fragment key={a.id}>
                  <tr className="border-t" style={{ borderColor: "var(--color-border)" }}>
                    <td className="p-3 font-medium">{a.name}</td>
                    <td className="p-3">
                      <label>
                        <span className="mv-visually-hidden">מסלול של {a.name}</span>
                        <select
                          value={a.plan}
                          onChange={(e) => void changePlan(a.id, e.target.value)}
                          className="rounded-lg border px-2 py-1.5"
                          style={{ borderColor: "var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)" }}
                        >
                          {planOptions.map((plan) => (
                            <option key={plan.code} value={plan.code}>{plan.name}</option>
                          ))}
                        </select>
                      </label>
                    </td>
                    <td className="p-3">
                      <span style={a.status === "suspended" ? { color: "var(--color-danger)" } : undefined}>
                        {STATUS_LABELS[a.status] ?? a.status}
                      </span>
                      {/*
                        הסטטוס לבדו הטעה: משרד "פעיל" שתקופתו נגמרה
                        אינו מצליח לעבוד, ומי שראה כאן "פעיל" לא ידע
                        למה הוא מתלונן.
                      */}
                      {a.periodEnded ? (
                        <span className="block text-xs" style={{ color: "var(--color-danger)" }}>
                          התקופה הסתיימה — מוגבל למסך המנוי
                        </span>
                      ) : a.paidUntil !== null ? (
                        <span className="block text-xs" style={{ color: "var(--color-text-muted)" }}>
                          שולם עד {formatDate(a.paidUntil)}
                        </span>
                      ) : a.trialEndsAt !== null ? (
                        <span className="block text-xs" style={{ color: "var(--color-text-muted)" }}>
                          ניסיון עד {formatDate(a.trialEndsAt)}
                        </span>
                      ) : null}
                    </td>
                    <td className="p-3">{a.userCount}</td>
                    {/*
                      החסימה היא של הפלטפורמה מעל מנהל המשרד: הוא
                      אינו יכול להחזיר לעצמו מודול שנחסם כאן, גם לא
                      דרך מסך ההרשאות שלו.
                    */}
                    <td className="p-3">
                      <button
                        type="button"
                        className="mv-btn-plain"
                        aria-expanded={modulesFor === a.id}
                        onClick={() => setModulesFor(modulesFor === a.id ? null : a.id)}
                      >
                        {a.blockedModules.length === 0
                          ? "הכול פתוח"
                          : `${a.blockedModules.length} חסומים`}
                      </button>
                      {/*
                        החריגים ליד החסימות ולא בעמודה משלהם: שתיהן
                        אותה שאלה — מה המשרד הזה מקבל — ועמודה נוספת
                        הייתה מצרה את הטבלה בלי להוסיף מידע.
                      */}
                      <button
                        type="button"
                        className="mv-btn-plain block"
                        aria-expanded={overridesFor === a.id}
                        onClick={() => setOverridesFor(overridesFor === a.id ? null : a.id)}
                      >
                        {a.featureGrants.length + a.featureDenials.length === 0 &&
                        a.priceOverrideMonthlyAgorot === null &&
                        a.priceOverrideYearlyAgorot === null
                          ? "ללא חריגים"
                          : "חריגים ✓"}
                      </button>
                    </td>
                    <td className="p-3">{formatDate(a.createdAt)}</td>
                    <td className="p-3">
                      <Button
                        variant={a.status === "suspended" ? "secondary" : "ghost"}
                        onClick={() => void toggleSuspend(a)}
                      >
                        {a.status === "suspended" ? "הפעל מחדש" : "השהה"}
                      </Button>
                      {/*
                        הכפתור קיים רק כשהמשרד פתח חלון בעצמו — אין
                        "כניסה" קבועה. הלחיצה מחליפה את העוגייה, ולכן
                        היציאה מהפלטפורמה נאמרת מראש.
                      */}
                      {a.supportAccessUntil ? (
                        <Button variant="secondary" onClick={() => void supportEnter(a)}>
                          כניסת תמיכה
                        </Button>
                      ) : null}
                      {a.periodEnded ? (
                        <Button variant="secondary" onClick={() => void grantAccess(a)}>
                          פתח ללא תפוגה
                        </Button>
                      ) : null}
                      <Button variant="ghost" onClick={() => void deleteAgency(a)}>
                        <span style={{ color: "var(--color-danger)" }}>מחק משרד</span>
                      </Button>
                    </td>
                  </tr>
                  {overridesFor === a.id ? (
                    <tr style={{ background: "var(--color-bg)" }}>
                      <td colSpan={7} className="p-3">
                        <TenantOverrides
                          agency={a}
                          planFeatures={
                            planOptions.find((p) => p.code === a.plan)?.features ?? []
                          }
                          onCancel={() => setOverridesFor(null)}
                          onSaveFeatures={(grants, denials) =>
                            void saveFeatures(a, grants, denials)
                          }
                          onSaveBilling={(patch) => void saveBillingOverride(a, patch)}
                        />
                      </td>
                    </tr>
                  ) : null}
                  {modulesFor === a.id ? (
                    <tr style={{ background: "var(--color-bg)" }}>
                      <td colSpan={7} className="p-3">
                        <ModuleBlocks
                          agency={a}
                          onCancel={() => setModulesFor(null)}
                          onSave={(blocked) => void saveModules(a, blocked)}
                        />
                      </td>
                    </tr>
                  ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
