"use client";

import { Fragment, useCallback, useEffect, useState, type FormEvent } from "react";
import {
  CAPABILITY_MODULES,
  PLAN_FEATURES,
  jerusalemWallIsoToUtc,
  moduleLabel,
} from "@metavchim/shared";
import { Button } from "@metavchim/ui";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError, apiList } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useRequireAuth } from "@/lib/use-auth";
import { IconPlus } from "../icons";
import { BackupsSection } from "./backups-section";
import { WhatsappSeatsPanel } from "./whatsapp-seats-panel";
import { LeadPricesSection } from "./lead-prices-section";
import { PaymentsSection } from "./payments-section";
import { PlansSection } from "./plans-section";
import { CouponsSection } from "./coupons-section";
import { OffersSection } from "./offers-section";
import { NumberRentalsSection } from "./number-rentals-section";
import { AgentUsageSection } from "./agent-usage-section";
import { PlatformSettingsSection } from "./platform-settings-section";
import { SupportQueueSection } from "./support-queue-section";
import { LegalDocsSection } from "./legal-docs-section";
import { MentorQuotesSection } from "./mentor-quotes-section";
import { IntegrationDeskSection } from "./integration-desk-section";
import { InvoicesSection } from "./invoices-section";
import { TelephonyWebhooksSection } from "./telephony-webhooks-section";
import { CreditEconomySection } from "./credit-economy-section";
import { SystemUpdateSection } from "./system-update-section";
import { PayoutDeskSection } from "./payout-desk-section";
import { ReferralRevenueSection } from "./referral-revenue-section";
import { Notice } from "../notice";
import { EntityTabs, TabPanel, useEntityTab } from "../entity-tabs";

/**
 * ניהול הפלטפורמה — הקמת משרדי תיווך חדשים בלי SSH. נגיש רק למנהלי
 * הפלטפורמה (PLATFORM_ADMIN_EMAILS); לכל שאר המשתמשים מוצג "אין הרשאה".
 */

const inputStyle = { borderColor: "var(--color-input-border)", background: "var(--color-field)" } as const;

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
  /** מקומות נוספים שנרכשו לסוכן הוואטסאפ, מעבר לאחד שכלול במסלול */
  whatsappAgentSeatsExtra: number;
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
      <p className="m-0 mb-2 text-[length:var(--type-caption-lg)]">
        <b>חסימת מודולים ל{agency.name}</b>{" "}
        <span style={{ color: "var(--color-text-muted)" }}>
          — מודול מסומן נחסם לכל משתמשי המשרד, כולל הבעלים, ומנהל המשרד אינו יכול
          להחזיר אותו ממסך ההרשאות שלו.
        </span>
      </p>
      <ul className="m-0 grid list-none gap-1.5 p-0 md:grid-cols-3">
        {CAPABILITY_MODULES.map((module) => (
          <li key={module.key}>
            <label className="flex items-start gap-2 text-[length:var(--type-caption)]">
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
  /*
   * ‎**מקומות נוספים לסוכן הוואטסאפ.**
   *
   * הוספתי את השדה ל-API ולא למסך, ולכן אי אפשר היה למכור מקום דרך
   * המוצר — כל משרד היה נעול על אחד אלא אם מישהו קורא ל-API ידנית
   * (ביקורת Codex). זו הייתה הדרישה עצמה: „כל 1 נוסף זה בתוספת
   * תשלום” אינו קיים אם אין איפה להוסיף אותו.
   */
  const [waSeats, setWaSeats] = useState(String(agency.whatsappAgentSeatsExtra));

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
      <p className="m-0 mb-2 text-[length:var(--type-caption-lg)]">
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
            <li key={feature.code} className="text-[length:var(--type-caption)]">
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
                    className="rounded-lg border px-2 py-0.5 text-[length:var(--type-caption)]"
                    style={
                      state === value
                        ? {
                            borderColor: "var(--color-primary)",
                            background: "var(--color-primary-soft)",
                            color: "var(--color-primary)",
                          }
                        : { borderColor: "var(--color-input-border)" }
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

      <p className="m-0 mb-2 text-[length:var(--type-caption-lg)]">
        <b>חלון החינם והמחיר</b>{" "}
        <span style={{ color: "var(--color-text-muted)" }}>
          — שדה ריק מבטל את החריגה ומחזיר להתנהגות הרגילה. „חינם למשרד הזה”
          נעשה בהארכת החלון ולא במחיר אפס.
        </span>
      </p>
      <div className="mb-2 flex flex-wrap gap-3">
        <label className="text-[length:var(--type-caption)]">
          <span className="mb-1 block font-medium">סוף תקופת הניסיון</span>
          <input
            type="date"
            value={trialEndsAt}
            onChange={(e) => setTrialEndsAt(e.target.value)}
            className="rounded-lg border px-2 py-1"
            style={inputStyle}
          />
        </label>
        <label className="text-[length:var(--type-caption)]">
          <span className="mb-1 block font-medium">שולם עד</span>
          <input
            type="date"
            value={paidUntil}
            onChange={(e) => setPaidUntil(e.target.value)}
            className="rounded-lg border px-2 py-1"
            style={inputStyle}
          />
        </label>
        <label className="text-[length:var(--type-caption)]">
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
        <label className="text-[length:var(--type-caption)]">
          <span className="mb-1 block font-medium">מקומות נוספים לסוכן וואטסאפ</span>
          <input
            type="number"
            min={0}
            max={20}
            value={waSeats}
            onChange={(e) => setWaSeats(e.target.value)}
            className="w-32 rounded-lg border px-2 py-1"
            style={inputStyle}
          />
          <span className="mt-1 block" style={{ color: "var(--color-text-muted)" }}>
            מעבר לאחד שכלול במסלול
          </span>
        </label>
        <label className="text-[length:var(--type-caption)]">
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
               *
               * ‎`23:59:59Z` היה סוף היום ב-UTC, כלומר 02:59 בישראל
               * למחרת — המנוי נסגר כשלוש שעות לתוך היום הבא. אותו
               * מסך קובע גם תוקף קופון, ושתי משמעויות ל„סוף היום”
               * באותו מסך הן באג בהמתנה. שתיהן סוף היום בישראל.
               */
              trialEndsAt:
                trialEndsAt === ""
                  ? null
                  : jerusalemWallIsoToUtc(`${trialEndsAt}T23:59:59.000`).toISOString(),
              paidUntil:
                paidUntil === ""
                  ? null
                  : jerusalemWallIsoToUtc(`${paidUntil}T23:59:59.000`).toISOString(),
              priceOverrideMonthlyAgorot: shekelToAgorot(monthly),
              priceOverrideYearlyAgorot: shekelToAgorot(yearly),
              // ריק = בלי שינוי; מספר לא תקין אינו נשלח כאפס
              ...(waSeats.trim() === "" || !Number.isInteger(Number(waSeats))
                ? {}
                : { whatsappAgentSeatsExtra: Number(waSeats) }),
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
 * לשוניות מסך הפלטפורמה.
 *
 * ## למה זה השתנה מעוגנים ללשוניות
 *
 * העמוד גדל לעשרים סעיפים בגלילה אחת. הפתרון הקודם היה שורת עוגנים
 * („קיצורי דרך בעמוד”) עם הנימוק שהסעיפים נקראים ברצף ואין סיבה
 * להסתיר אף אחד — וזה הפסיק להיות נכון: עוגן מקפיץ אותך למקום
 * בתוך מסמך שממשיך להיות ארוך, ולכן אחרי הקפיצה עדיין לא ברור מה
 * שייך למה ואיפה נגמר הסעיף. בעיקר, **הכול נטען תמיד**: עשרים
 * סעיפים ששולפים במקביל בכל כניסה, גם כשבאת לדבר אחד.
 *
 * לשוניות פותרות את שניהם — וקיים כאן כבר `EntityTabs` שעושה בדיוק
 * את זה בכרטיסי הקונה והנכס, כולל שמירת הבחירה בכתובת.
 *
 * ## הקיבוץ
 *
 * לפי **מה באת לעשות**, לא לפי מה שקרוב במימוש:
 *
 * - **תמיכה** ראשונה: זו הרשימה היחידה שמישהו ממתין בקצה השני שלה.
 * - **משרדים** — הקמה, הרשימה, ושולחן החיבורים שמתקן להם הגדרות.
 * - **מסלולים ומחירים** — כל מה שקובע כמה גובים.
 * - **גבייה** — כל מה שקרה עם הכסף בפועל.
 * - **חיבורים** — ספקים חיצוניים והוובהוקים שלהם.
 * - **מערכת** — גרסאות, גיבויים, שימוש בסוכן ומסמכים משפטיים.
 *
 * ## מה שאבד, ולמה זה בסדר
 *
 * שורת העוגנים החזיקה קיצור ישיר לכרטיס „התחברות עם Google” — לא
 * לכותרת הסעיף אלא לשדות עצמם — כי זה מה שמחפשים בחיבור הראשון.
 * הקיצור הזה נעלם, אבל מה שהוליד אותו נעלם איתו: הכרטיס היה קבור
 * באמצע עשרים סעיפים, ועכשיו הוא בלשונית „חיבורים” שבה יש חמישה.
 */
const PLATFORM_TABS = [
  { key: "support", label: "תמיכה" },
  { key: "agencies", label: "משרדים" },
  { key: "pricing", label: "מסלולים ומחירים" },
  { key: "billing", label: "גבייה" },
  { key: "integrations", label: "חיבורים" },
  { key: "system", label: "מערכת" },
] as const;

const PLATFORM_TAB_KEYS = PLATFORM_TABS.map((tab) => tab.key);
export default function PlatformPage() {
  const { loading: authLoading } = useRequireAuth();
  const [tab, setTab] = useEntityTab(PLATFORM_TAB_KEYS, "support");
  const [agencies, setAgencies] = useState<AgencyRow[] | null>(null);
  /** המשרד שעורכים לו כרגע את חסימות המודולים; null = אף אחד. */
  const [modulesFor, setModulesFor] = useState<string | null>(null);
  const [overridesFor, setOverridesFor] = useState<string | null>(null);
  const [waFor, setWaFor] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ ownerEmail: string; tempPassword: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [planOptions, setPlanOptions] = useState<PlanOption[]>([]);
  /*
   * אחוז העמלה נשמר במסך אחד ומוצג בשני. בלי המונה הזה החישוב
   * והאזהרה במסך כלכלת הקרדיטים היו ממשיכים להראות את האחוז הישן עד
   * לרענון — כלומר מסתירים את ההפסד בדיוק ברגע שנוצר.
   */
  const [referralFeeVersion, setReferralFeeVersion] = useState(0);

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
      .then((res) => setPlanOptions(apiList(res.plans, "plans")))
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
      <Notice tone="danger">המסך הזה זמין רק למנהלי הפלטפורמה.</Notice>
    );
  }

  return (
    <>
      <h1 className="mb-2 text-2xl font-bold">ניהול הפלטפורמה</h1>
      <p className="mb-4" style={{ color: "var(--color-text-muted)" }}>
        הקמת משרדי תיווך חדשים וניהולם — כל משרד מבודד לחלוטין, עם הצוות והנתונים שלו.
      </p>

      <EntityTabs
        tabs={PLATFORM_TABS.map((entry) => ({ key: entry.key, label: entry.label }))}
        active={tab}
        onSelect={setTab}
        label="לשוניות ניהול הפלטפורמה"
      />

      {/*
        השגיאה מחוץ ללשוניות: היא נובעת מפעולות של יותר מאחת מהן
        (הקמת משרד, שינוי מסלול, השהיה), והצגתה רק בלשונית שממנה
        יצאה הייתה מסתירה אותה ממי שהחליף לשונית בינתיים.
      */}
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <TabPanel tab="support" active={tab}>
        {/*
          ‎**מקור אחד לשני הערוצים.** קודם ישבו כאן שני מסכים —
          פניות מהכפתור, ותיבת המייל — עם שתי רשימות, שני סינונים
          ושני מונים. מבחינת מי שמטפל זו אותה עבודה, ולכן "מה מחכה
          לי" הייתה שתי שאלות.
        */}
        <SupportQueueSection />
      </TabPanel>

      <TabPanel tab="pricing" active={tab}>
        <PlansSection onCatalogChange={loadPlanOptions} />
        {/*
          מיד אחרי המסלולים: הצעה בלינק היא "מסלול + חריגים למשרד
          אחד", וזה המסך שממנו יוצאים אליה אחרי שיחת מכירה.
        */}
        <OffersSection
          agencies={(agencies ?? []).map((a) => ({
            id: a.id,
            name: a.name,
            priceOverrideMonthlyAgorot: a.priceOverrideMonthlyAgorot,
            priceOverrideYearlyAgorot: a.priceOverrideYearlyAgorot,
          }))}
        />
        {/* מוצג רק כשיש השכרות — רוב הזמן אין, ורשימה ריקה קבועה היא רעש */}
        <NumberRentalsSection />
        <CouponsSection />
        <LeadPricesSection />
        <CreditEconomySection refreshToken={referralFeeVersion} />
      </TabPanel>

      <TabPanel tab="billing" active={tab}>
        {/*
          תור המשיכות ראשון בלשונית: מישהו ממתין בקצה השני שלו, והוא
          ממתין לכסף. תור ששוכב שבוע הוא הדרך המהירה ביותר לאבד את
          אמון המשרדים ברשת ההפניות.
        */}
        <PayoutDeskSection />
        {/*
          צמוד לתור המשיכות: שם רואים מה יוצא מהפלטפורמה, וכאן מה
          נשאר בה. עד עכשיו היה רק הצד הראשון על המסך.
        */}
        <ReferralRevenueSection />
        <PaymentsSection />
        {/*
          כסף שנכנס בלי מסמך הוא דבר שצריך לראות בלי לחפש, ולכן
          החשבוניות יושבות עם התשלומים ולא עם ההגדרה שמייצרת אותן.
        */}
        <InvoicesSection />
      </TabPanel>

      <TabPanel tab="integrations" active={tab}>
        <PlatformSettingsSection onReferralFeeChange={() => setReferralFeeVersion((v) => v + 1)} />
        {/*
          צמוד להגדרות הספקים: שתיהן עונות על "חיברתי ספק ולא קורה
          כלום", וזו הרשימה שאומרת אם הוא בכלל פונה אלינו.
        */}
        <TelephonyWebhooksSection />
      </TabPanel>

      <TabPanel tab="system" active={tab}>
        <SystemUpdateSection />
        <BackupsSection />
        {/*
          מפתח ה-Gemini מוגדר ב"חיבורים", וכאן רואים כמה הוא עולה
          בפועל — פקודות, אסימונים, ואיפה זה נצרך.
        */}
        <AgentUsageSection />
        <LegalDocsSection />
        {/*
          ליד המסמכים המשפטיים ולא ליד ההגדרות: שניהם **תוכן** שהפלטפורמה
          כותבת ומוצג בכל המשרדים, ולא מתג שמשנה התנהגות.
        */}
        <MentorQuotesSection />
      </TabPanel>

      <TabPanel tab="agencies" active={tab}>
        {/*
          אישור ההקמה בתוך הלשונית ולא מעליה: הסיסמה הזמנית מוצגת
          פעם אחת בלבד, וטופס ההקמה יושב כאן — הודעה שנחתה בלשונית
          אחרת היא הודעה שאפשר לפספס ואי אפשר לשחזר.
        */}
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
          שולחן החיבורים בלשונית המשרדים ולא ב"חיבורים": מה שמתקנים
          בו הוא ההגדרה של **משרד מסוים**, וזו שאלה על המשרד.
        */}
        <IntegrationDeskSection
          agencies={(agencies ?? []).map((a) => ({ id: a.id, name: a.name }))}
        />

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
                          style={{ borderColor: "var(--color-input-border)", background: "var(--color-bg)", color: "var(--color-text)" }}
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
                        <span className="block text-sm" style={{ color: "var(--color-danger)" }}>
                          התקופה הסתיימה — מוגבל למסך המנוי
                        </span>
                      ) : a.paidUntil !== null ? (
                        <span className="block text-sm" style={{ color: "var(--color-text-muted)" }}>
                          שולם עד {formatDate(a.paidUntil)}
                        </span>
                      ) : a.trialEndsAt !== null ? (
                        <span className="block text-sm" style={{ color: "var(--color-text-muted)" }}>
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
                        {/*
                          שמות ולא מונה. "2 חסומים" מחייב לפתוח את
                          הפאנל כדי לדעת מה נחסם, ובעל הפלטפורמה
                          סורק כאן טבלה של משרדים — הוא צריך לראות
                          את ההבדל בין חסימת חיוב לחסימת הפניות בלי
                          לפתוח שורה-שורה.
                        */}
                        {a.blockedModules.length === 0
                          ? "הכול פתוח"
                          : a.blockedModules.map(moduleLabel).join(" · ")}
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
                      {/*
                        מנויי הוואטסאפ ליד שאר פעולות המשרד: כשסוכן
                        מתקשר ואומר „הסוכן לא עונה לי”, זו השורה שבה
                        התמיכה כבר נמצאת.
                      */}
                      <Button
                        variant="secondary"
                        aria-expanded={waFor === a.id}
                        onClick={() => setWaFor(waFor === a.id ? null : a.id)}
                      >
                        וואטסאפ
                      </Button>
                      <Button variant="ghost" onClick={() => void deleteAgency(a)}>
                        <span style={{ color: "var(--color-danger)" }}>מחק משרד</span>
                      </Button>
                    </td>
                  </tr>
                  {waFor === a.id ? (
                    <tr style={{ background: "var(--color-bg)" }}>
                      <td colSpan={7} className="p-3">
                        <WhatsappSeatsPanel tenantId={a.id} />
                      </td>
                    </tr>
                  ) : null}
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
      </TabPanel>
    </>
  );
}
