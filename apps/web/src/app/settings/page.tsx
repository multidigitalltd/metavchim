"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ASSIGNABLE_ROLES, ROLE_CAPABILITIES, ROLE_LABELS, roleLabel } from "@metavchim/shared";
import { Button } from "@metavchim/ui";
import { apiGet, apiPatch, apiPost, ApiError, apiList } from "@/lib/api";
import { useScrollAffordance } from "@/lib/use-scroll-affordance";
import { formatDateTime } from "@/lib/format";
import { can, useRequireAuth } from "@/lib/use-auth";
import { useFeature } from "@/lib/use-features";
import { IconKey, IconLock } from "../icons";
import { BillingSection } from "./billing-section";
import { PayoutPanel } from "./payout-panel";
import { DeleteAccountSection } from "./delete-account-section";
import { ExportSection } from "./export-section";
import { LeadWebhookSection } from "./lead-webhook-section";
import { PlanSection } from "./plan-section";
import { WhatsAppStatusSection } from "./whatsapp-status-section";
import { LockedFeature } from "./locked-feature";
import { TelephonySection } from "./telephony-section";
import { VirtualNumbersSection } from "./virtual-numbers-section";
import { SupportAccessSection } from "./support-access-section";
import { SupportTicketsSection } from "./support-tickets-section";
import { EmailDomainSection } from "./email-domain-section";
import { GmailSection } from "./gmail-section";
import { GoogleCalendarSection } from "./google-calendar-section";
import { MatchWeightsSection } from "./match-weights-section";
import { AutomationsSection } from "./automations-section";
import { OfficeDefaultsSection } from "./office-defaults-section";
import { CustomAutomationsSection } from "./custom-automations-section";
import { RecurrenceSection } from "./recurrence-section";
import { DismissReportSection } from "./dismiss-report";
import { AgreementTemplatesSection } from "./agreement-templates-section";
import { RetainedAgreementsSection } from "./retained-agreements-section";
import { SystemUpdateSection } from "./system-update";
import { SessionsList } from "../sessions-list";
import { UserPermissions } from "./user-permissions";
import { Notice } from "../notice";
import { OfficeLogo } from "./office-logo";

const inputStyle = {
  borderColor: "var(--color-input-border)",
  background: "var(--color-field)",
} as const;

interface TeamUser {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  lastLoginAt?: string;
  locked: boolean;
  phone?: string;
  whatsappAccess: boolean;
}

interface AuditRow {
  action: string;
  entityType: string;
  userName?: string;
  /** הפעולה בוצעה ע"י התמיכה — הכתובת שנכנסה. */
  supportAdmin?: string;
  createdAt: string;
}

const TEAM_GRID = "1.4fr 1fr 1.15fr 1fr 0.8fr 1fr";

/* רשימת "אבטחה ופרטיות" מקובץ העיצוב — כל שורה נכונה בפועל במערכת */
const SECURITY_ROWS = [
  "הפרדה מוחלטת בין משרדים — ברמת בסיס הנתונים",
  "טלפונים ואימיילים מוצפנים במסד הנתונים",
  "הקלטות קול נמחקות מיד אחרי התמלול",
  "חסימה אוטומטית אחרי ניסיונות כניסה כושלים",
  "תיעוד מלא: מי עשה מה ומתי",
  "גיבוי יומי אוטומטי + עותק מחוץ לשרת",
];

/** קודי יומן הפעילות → עברית; קוד לא מוכר מוצג כמו שהוא */
const AUDIT_ACTION_LABELS: Record<string, string> = {
  "property.create": "יצירת נכס",
  "property.update": "עדכון נכס",
  "property.delete": "העברת נכס לארכיון",
  "property.media_upload": "העלאת תמונת נכס",
  "property.media_delete": "מחיקת תמונת נכס",
  "property.media_primary": "קביעת תמונה ראשית",
  "property.media_alt_text": "עדכון תיאור תמונה",
  "property.owner_update": "עדכון שיווק לבעל נכס",
  "buyer.create": "יצירת קונה",
  "buyer.update": "עדכון קונה",
  "buyer.interaction_add": "תיעוד אינטראקציה עם קונה",
  "lead.create": "יצירת ליד",
  "lead.status": "עדכון סטטוס ליד",
  "lead.delete": "מחיקת ליד",
  // הרישום הזה הוא הראיה שבקשת המחיקה של לקוח בוצעה — ולכן הוא
  // חייב להיקרא בעברית ביומן, ולא כקוד
  "contact.erase": "מחיקת לקוח מהמערכת",
  // החלטות פלטפורמה נרשמות ביומן של המשרד עצמו: בלעדיהן מודול שנעלם
  // נראה כמו תקלה, ואין למנהל שום דרך לדעת שזו הייתה החלטה
  "platform.blocked_modules": "שינוי חסימת מודולים בידי הפלטפורמה",
  "lead.convert": "המרת ליד לקונה",
  "lead.repeat_inquiry": "פנייה חוזרת של ליד",
  "offer.create": "יצירת הצעה",
  "offer.whatsapp_prepared": "הכנת הצעה לוואטסאפ",
  "appointment.create": "קביעת פגישה",
  "appointment.update": "עדכון פגישה",
  "task.create": "יצירת משימה",
  "task.update": "עדכון משימה",
  "task.delete": "מחיקת משימה",
  "collaboration.share": "שיתוף ברשת",
  "collaboration.unshare": "הסרת שיתוף מהרשת",
  "collaboration.offer": "הצעה ברשת שיתוף",
  "collaboration.interested": "עניין בהצעת שיתוף",
  "collaboration.declined": "דחיית הצעת שיתוף",
  "data.export_buyers": "ייצוא קונים",
  "data.export_properties": "ייצוא נכסים",
  "settings.update": "עדכון הגדרות",
  "system.update": "עדכון גרסת מערכת",
  "users.create": "הוספת איש צוות",
  "users.update": "עדכון איש צוות",
  "users.unlock": "שחרור נעילת התחברות",
  // ניתוק כפוי של עובד מכל מכשיריו — פעולה ניהולית שמישהו נותן
  // עליה דין וחשבון, ולכן היא נקראת בעברית ולא כקוד
  "users.sessions_revoke": "ניתוק כל החיבורים של איש צוות",
  "voice_intake.create": "קליטת נכס בקול",
  "contact.merge": "מיזוג כרטיסים כפולים",
  "contact.duplicate_dismiss": "דחיית הצעת מיזוג",
  "settings.lead_webhook_create": "יצירת מקור קליטת לידים",
  "settings.lead_webhook_delete": "מחיקת מקור קליטת לידים",
};

/**
 * פרטי המשרד. השלושה האחרונים נכנסים לנוסחי ההסכמים ולהצעות —
 * מספר רישיון התיווך הוא פרט חובה בהזמנה בכתב לפי חוק המתווכים
 * במקרקעין, ובלעדיו התבנית מדפיסה מקום ריק.
 */
interface TenantSettings {
  name: string;
  whatsappNumber?: string;
  plan: string;
  licenseNumber?: string;
  officeAddress?: string;
  officePhone?: string;
  defaultCommission?: string;
  defaultPaymentTerms?: string;
  /** מדיניות הרשת: כל נכס/קונה חדש מתפרסם לרשת השיתופים אוטומטית */
  autoShareProperties: boolean;
  autoShareBuyers: boolean;
  autoEmailOffers: boolean;
  /** מקומות לסוכן הוואטסאפ — כמה יש למשרד, וכמה מהם תפוסים */
  whatsappAgentSeats: number;
  whatsappAgentSeatsUsed: number;
}

/**
 * עוגנים ישנים → הלשונית שמכילה אותם.
 *
 * חנות המודולים ומסך הלידים מקשרים ל-‎/settings#telephony‎ וחבריו;
 * המיפוי הזה שומר על הקישורים האלה עובדים אחרי הפיצול ללשוניות.
 */
const HASH_TABS: Record<string, string> = {
  "match-weights": "matching",
  automations: "automations",
  whatsapp: "integrations",
  telephony: "integrations",
  "google-calendar": "integrations",
  gmail: "integrations",
  "lead-webhook": "integrations",
  // הבאנר בתיבה מפנה לכאן; בלי השורה הזו הוא נוחת בלשונית הצוות
  "email-domain": "integrations",
  data: "data",
  "support-access": "support",
};

/** לשוניות ניהול המשרד — הסדר הוא סדר השימוש בפועל. */
const TABS: [key: string, label: string][] = [
  ["team", "צוות והרשאות"],
  ["office", "פרטי המשרד"],
  ["billing", "מנוי ותשלום"],
  ["matching", "התאמות"],
  /*
    לשונית משלה ולא פינה ב"התאמות": האוטומציות אינן קשורות למנוע
    ההתאמות, והן התשובה לשאלה "למה נפתחה לי המשימה הזאת" — שאלה
    שמחפשים אותה כיעד, לא בתוך מסך אחר.
  */
  ["automations", "אוטומציות"],
  ["integrations", "חיבורים ומודולים"],
  ["documents", "מסמכים והסכמים"],
  ["data", "נתונים ואבטחה"],
  /*
    לשונית משלה ולא פינה בתוך "נתונים ואבטחה": גישת התמיכה ישבה עד
    כה בין החיבורים, כלומר במקום שנפתח כדי לחבר מרכזייה — ומי שחיפש
    איך לדבר עם מישהו לא הגיע לשם. עכשיו זה יעד: לשלוח פנייה, לראות
    מה קרה איתה, ולפתוח גישה אם ביקשו.
  */
  ["support", "פניות לתמיכה"],
];

export default function SettingsPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const [tab, setTab] = useState("team");
  /*
   * הסרגל נגלל לרוחב עם פס גלילה מוסתר, ומסך ההגדרות צמח לתריסר
   * נושאים — כלומר לשונית שנקטעת על הקצה בלי סימן שיש עוד, ולשונית
   * שנבחרה מהכתובת (`?tab=billing`) שיושבת מחוץ לתצוגה. אותו טיפול
   * בדיוק כמו בלשוניות כרטיס הישות, מאותו הוק.
   */
  const strip = useScrollAffordance<HTMLDivElement>(tab);

  /*
   * הלשונית נקראת מהכתובת בטעינה ונכתבת אליה בכל מעבר — כך קישור
   * ל-‎?tab=billing‎ (למשל מכרטיס המסלול) נוחת במקום הנכון, ורענון
   * לא זורק חזרה ללשונית הראשונה. replaceState ולא ניווט: אין כאן
   * טעינת עמוד, רק החלפת תצוגה.
   *
   * גם עוגנים ישנים ממופים: קישורים כמו ‎/settings#telephony‎ פזורים
   * בחנות המודולים ובמסך הלידים, ומאז הפיצול ללשוניות הם היו נוחתים
   * על הלשונית הראשונה — שבה האלמנט שאליו כיוונו כלל אינו מורכב
   * (ביקורת Codex). אחרי בחירת הלשונית גוללים לעוגן עצמו.
   */
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    if (requested && TABS.some(([key]) => key === requested)) {
      setTab(requested);
      return;
    }
    const anchor = window.location.hash.replace("#", "");
    const owning = HASH_TABS[anchor];
    if (!owning) return;
    setTab(owning);
    // הגלילה אחרי שהלשונית הורכבה — לפני כן האלמנט לא קיים
    window.setTimeout(() => {
      document.getElementById(anchor)?.scrollIntoView({ block: "start" });
    }, 120);
  }, []);

  function selectTab(next: string): void {
    setTab(next);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", next);
    window.history.replaceState({}, "", `?${params.toString()}`);
  }
  const canTelephony = useFeature("telephony");
  const canAgreements = useFeature("agreements");
  const canDataIo = useFeature("data_io");
  const canAutomations = useFeature("automations");
  const [tenant, setTenant] = useState<TenantSettings | null>(null);
  const [team, setTeam] = useState<TeamUser[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [adding, setAdding] = useState(false);
  /** מזהה המשתמש שפאנל ההרשאות שלו פתוח — אחד בכל רגע */
  const [permissionsFor, setPermissionsFor] = useState<string | null>(null);
  /* מזהה איש הצוות שרשימת החיבורים שלו פתוחה; null = אף אחת */
  const [sessionsFor, setSessionsFor] = useState<string | null>(null);

  const load = useCallback(() => {
    apiGet<TenantSettings>("/settings/tenant")
      .then(setTenant)
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 403) setForbidden(true);
      });
    apiGet<TeamUser[]>("/settings/users")
      .then(setTeam)
      .catch(() => undefined);
    apiGet<{ items: AuditRow[] }>("/settings/audit?limit=30")
      .then((r) => setAudit(apiList(r.items, "items")))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!authLoading && user) load();
  }, [authLoading, user, load]);

  async function saveTenant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const whatsapp = String(f.get("whatsappNumber") ?? "").replace(/\D/gu, "");
    try {
      // כל שדה נשלח תמיד, גם ריק: השרת מפרש "" כמחיקה, ובלי זה אי אפשר
      // היה לנקות שדה שמולא בטעות — הערך הריק פשוט לא נשלח ונשאר כשהיה
      await apiPatch("/settings/tenant", {
        name: String(f.get("name")).trim(),
        whatsappNumber: whatsapp,
        licenseNumber: String(f.get("licenseNumber") ?? "").trim(),
        officeAddress: String(f.get("officeAddress") ?? "").trim(),
        officePhone: String(f.get("officePhone") ?? "").trim(),
        defaultCommission: String(f.get("defaultCommission") ?? "").trim(),
        defaultPaymentTerms: String(f.get("defaultPaymentTerms") ?? "").trim(),
      });
      setMessage("✓ ההגדרות נשמרו");
      load();
    } catch (err: unknown) {
      setMessage(err instanceof ApiError ? err.message : "השמירה נכשלה");
    }
  }

  /**
   * שמירת מתג בודד — בלי טופס ובלי כפתור.
   *
   * ‎`PATCH /settings/tenant` מקבל שדות חלקיים, ולכן מה שלא נשלח
   * אינו נוגע. שליחת כל השדות כאן הייתה מחזירה לשרת גם את שם המשרד
   * ואת אחוז העמלה מתוך `tenant` שבזיכרון — כלומר דורסת עריכה
   * שנעשתה בלשונית אחרת בין הטעינה ללחיצה.
   *
   * המצב המקומי מתעדכן **אחרי** ההצלחה: מתג שהתהפך ואז נכשל היה
   * מציג „כבוי” על אוטומציה שממשיכה לרוץ.
   */
  async function saveTenantFlags(patch: {
    autoShareProperties?: boolean;
    autoShareBuyers?: boolean;
    autoEmailOffers?: boolean;
  }): Promise<void> {
    await apiPatch("/settings/tenant", patch);
    setTenant((prev) => (prev === null ? prev : { ...prev, ...patch }));
  }

  async function addUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const f = new FormData(form);
    try {
      const result = await apiPost<{ tempPassword: string }>(
        "/settings/users",
        {
          name: String(f.get("newName")).trim(),
          email: String(f.get("newEmail")).trim(),
          role: String(f.get("newRole")),
        },
      );
      setTempPassword(result.tempPassword);
      form.reset();
      load();
    } catch (err: unknown) {
      setMessage(err instanceof ApiError ? err.message : "הוספת המשתמש נכשלה");
    }
  }

  async function toggleActive(member: TeamUser) {
    await apiPatch(`/settings/users/${member.id}`, {
      isActive: !member.isActive,
    });
    load();
  }

  async function changeRole(member: TeamUser, role: string) {
    await apiPatch(`/settings/users/${member.id}`, { role });
    load();
  }

  /**
   * טלפון של סוכן — בעל המשרד מזין כדי לחבר אותו לסוכן הוואטסאפ.
   * נשמר ביציאה מהשדה, ורק אם באמת השתנה — לא בכל מעבר פוקוס.
   */
  async function savePhone(member: TeamUser, raw: string) {
    const phone = raw.trim();
    if (phone === (member.phone ?? "")) return;
    if (phone !== "" && !/^[\d\-+ ]{9,20}$/u.test(phone)) {
      setMessage("מספר הטלפון לא נשמר — ספרות בלבד, 9 עד 20 תווים");
      return;
    }
    try {
      await apiPatch(`/settings/users/${member.id}`, { phone });
      setMessage(
        phone === ""
          ? `✓ הטלפון של ${member.name} נמחק`
          : `✓ הטלפון של ${member.name} נשמר`,
      );
      load();
    } catch (err: unknown) {
      setMessage(err instanceof ApiError ? err.message : "שמירת הטלפון נכשלה");
    }
  }

  /** מנוי הסוכן בוואטסאפ — הפעלה/כיבוי לכל סוכן בנפרד. */
  async function toggleWhatsapp(member: TeamUser) {
    try {
      await apiPatch(`/settings/users/${member.id}`, {
        whatsappAccess: !member.whatsappAccess,
      });
      load();
    } catch (err: unknown) {
      setMessage(err instanceof ApiError ? err.message : "עדכון הגישה נכשל");
    }
  }

  async function unlock(member: TeamUser) {
    await apiPost(`/settings/users/${member.id}/unlock`, {});
    setMessage(`✓ הנעילה של ${member.name} שוחררה — אפשר להתחבר מיד`);
    load();
  }

  /** מי מחזיק בסוכן הוואטסאפ — בשמות, כי זו השאלה שנשאלת. */
  const whatsappHolders = team
    .filter((member) => member.whatsappAccess && member.isActive)
    .map((member) => member.name);

  if (authLoading) return <p aria-live="polite">טוען…</p>;
  if (forbidden) {
    return (
      <Notice tone="danger">אין לך הרשאה להגדרות המשרד — פנו לבעל המשרד.</Notice>
    );
  }

  return (
    <>
      {message ? (
        <Notice tone="success">{message}</Notice>
      ) : null}

      {/*
        לשוניות ולא עמוד אחד ארוך: מסך ההגדרות צמח לשנים-עשר קטעים,
        ו"איפה משנים מסלול" הפך לגלילה ארוכה שרוב המשתמשים ויתרו
        עליה. הלשונית נשמרת בכתובת (‎?tab=‎) כדי שקישור לקטע מסוים
        יפתח אותו, ורענון לא יזרוק חזרה ללשונית הראשונה.
      */}
      <div
        className="mv-tabs mb-[18px]"
        role="tablist"
        aria-label="נושאי ניהול המשרד"
        ref={strip}
      >
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`tab-${key}`}
            aria-selected={tab === key}
            aria-controls={`panel-${key}`}
            onClick={() => selectTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        id={`panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`tab-${tab}`}
        className="grid items-start gap-[18px] lg:[grid-template-columns:1fr_360px]"
      >
        {/*
          ================= הטור הראשי =================

          `min-w-0` אינו קישוט: פריט grid מקבל `min-width: auto`, ולכן
          הוא מסרב לרדת מתחת לרוחב התוכן שלו. טבלת הצוות מציבה
          `minWidth: 640` בכוונה — כדי שהעטיפה שמעליה תגלול אותה
          לרוחב — ובלי `min-w-0` הרצפה הזו טיפסה עד ה-grid ומתחה את
          **כל העמוד** ל-658px במסך של 390. התוצאה: גלילה אופקית של
          המסך כולו במובייל, במקום גלילה של הטבלה בלבד.
        */}
        <div className="flex min-w-0 flex-col gap-[18px]">
          {/* ---- המסלול: מה כלול ואיפה המשרד עומד מול המכסות ---- */}
          {tab === "billing" ? (
            <>
              <PlanSection />
              <section
                className="mv-list-card px-5 py-[17px]"
                aria-labelledby="billing-heading"
              >
                <span id="billing-heading" className="mv-visually-hidden">
                  מנוי, מסלולים ואמצעי תשלום
                </span>
                <BillingSection />
              </section>
              {/*
                היתרה הכספית ליד המנוי והתשלומים ולא במסך השיתופים
                (בקשת המשתמש): משיכת כסף היא עניין של ניהול המשרד —
                מי שמושך הוא בעל המשרד, לא הסוכן שגלש בפיד הרשת.
                הכרטיס עוטף את עצמו כי כשאין יתרה ואין היסטוריה הוא
                אינו מוצג כלל — עטיפה כאן הייתה נשארת כקופסה ריקה.
              */}
              <PayoutPanel />
            </>
          ) : null}

          {/* ---- סוכני המשרד — הטבלה מקובץ העיצוב ---- */}
          {tab === "team" ? (
            <section className="mv-list-card" aria-labelledby="team-heading">
              <div
                className="flex items-center px-5 py-[15px]"
                style={{
                  borderBottom: "1px solid var(--color-card-head-border)",
                }}
              >
                <h2
                  id="team-heading"
                  className="m-0"
                  style={{ fontSize: "calc(16.5 / 16 * 1rem)", fontWeight: 800 }}
                >
                  סוכני המשרד
                </h2>
                <button
                  type="button"
                  className="mv-btn-action ms-auto"
                  style={{ padding: "6px 13px", fontSize: "var(--type-caption)" }}
                  onClick={() => setAdding((v) => !v)}
                >
                  {adding ? "ביטול" : "+ הוסף סוכן"}
                </button>
              </div>

              {/*
                ‎**למי הסוכן מוקצה, ובאיזה מצב המקומות.**

                המקום הוא מנוי: אחד כלול בכל מסלול שיש בו סוכן, וכל
                נוסף נרכש. בלי השורה הזו בעל המשרד אינו יודע אם
                „הקצה” יעבוד עד שינסה — והוא גם אינו יודע למי הסוכן
                שייך כרגע, שזו השאלה הראשונה שהוא שואל.
              */}
              {tenant === null || tenant.whatsappAgentSeats === 0 ? null : (
                <p
                  className="mx-5 mt-3 mb-0 text-[length:var(--type-caption-lg)]"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  <span className="font-semibold" style={{ color: "var(--color-text)" }}>
                    הסוכן בוואטסאפ:
                  </span>{" "}
                  {whatsappHolders.length === 0
                    ? "לא מוקצה לאיש כרגע."
                    : `מוקצה ל${whatsappHolders.join(", ")}.`}{" "}
                  {tenant.whatsappAgentSeatsUsed} מתוך {tenant.whatsappAgentSeats}{" "}
                  {tenant.whatsappAgentSeats === 1 ? "מקום" : "מקומות"} בשימוש
                  {tenant.whatsappAgentSeatsUsed >= tenant.whatsappAgentSeats
                    ? " — כדי להקצות לסוכן אחר, כבו קודם אצל מי שמחזיק."
                    : "."}
                </p>
              )}

              {tempPassword ? (
                <div
                  role="alert"
                  className="mx-5 mt-3 rounded-xl border p-3"
                  style={{ borderColor: "var(--color-success)" }}
                >
                  <p className="m-0 font-medium">
                    המשתמש נוצר! סיסמה זמנית (מוצגת פעם אחת בלבד):
                  </p>
                  <p className="m-0 mt-1 font-mono text-lg" dir="ltr">
                    {tempPassword}
                  </p>
                  <Button
                    variant="ghost"
                    className="mt-2"
                    onClick={() => setTempPassword(null)}
                  >
                    סגור
                  </Button>
                </div>
              ) : null}

              {adding ? (
                <form
                  onSubmit={(e) => void addUser(e)}
                  className="flex flex-wrap items-end gap-3 px-5 py-4"
                  style={{
                    borderBottom: "1px solid var(--color-card-head-border)",
                  }}
                >
                  <div>
                    <label
                      htmlFor="newName"
                      className="mb-1 block text-sm font-semibold"
                    >
                      שם
                    </label>
                    <input
                      id="newName"
                      name="newName"
                      required
                      minLength={2}
                      className="rounded-lg border px-3 py-2"
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="newEmail"
                      className="mb-1 block text-sm font-semibold"
                    >
                      אימייל
                    </label>
                    <input
                      id="newEmail"
                      name="newEmail"
                      type="email"
                      required
                      dir="ltr"
                      className="rounded-lg border px-3 py-2"
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="newRole"
                      className="mb-1 block text-sm font-semibold"
                    >
                      תפקיד
                    </label>
                    <select
                      id="newRole"
                      name="newRole"
                      defaultValue="agent"
                      className="rounded-lg border px-3 py-2"
                      style={inputStyle}
                    >
                      {/*
                        הרשימה נגזרת מ-`ASSIGNABLE_ROLES` ולא כתובה
                        כאן: היא הופיעה בשני מקומות במסך הזה ובעוד
                        שניים אחרים, וכל עותק היה רשימה חלקית אחרת.
                      */}
                      {ASSIGNABLE_ROLES.map((value) => (
                        <option key={value} value={value}>
                          {ROLE_LABELS[value]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button type="submit" className="mv-btn-action">
                    הוסף
                  </button>
                </form>
              ) : null}

              <div className="overflow-x-auto">
                <div style={{ minWidth: 760 }}>
                  <div
                    className="mv-list-head"
                    style={{ gridTemplateColumns: TEAM_GRID }}
                  >
                    <span>שם</span>
                    <span>תפקיד</span>
                    <span>סוכן וואטסאפ</span>
                    <span>רואה קונים</span>
                    <span>ייצוא נתונים</span>
                    <span>
                      <span className="mv-visually-hidden">פעולות</span>
                    </span>
                  </div>
                  {team.map((member) => {
                    const caps = ROLE_CAPABILITIES[member.role] ?? [];
                    const canExport = caps.includes("data.export");
                    const seesAll = caps.includes("buyers.view_all");
                    const editable =
                      member.role !== "owner" && member.id !== user?.id;
                    /*
                     * ‎**הקצאת המקום נערכת גם על שורת בעל המשרד ועל
                     * השורה של עצמך.**
                     *
                     * ‎`editable` חוסם את שתיהן, ובצדק — תפקיד, טלפון
                     * והשבתה הם זהות. אבל המקום בוואטסאפ הוא מנוי,
                     * ובלי היכולת לכבות אותו אצל מי שמחזיק בו **אין
                     * דרך להעביר אותו לסוכן אחר**. השרת אוכף את אותה
                     * הבחנה בדיוק.
                     */
                    const seatEditable = can(user, "billing.manage");
                    return (
                      <div key={member.id}>
                        <div
                          className="mv-list-row"
                          style={{
                            gridTemplateColumns: TEAM_GRID,
                            opacity: member.isActive ? 1 : 0.55,
                          }}
                        >
                          <span className="flex items-center gap-2.5 text-sm font-bold">
                            <span
                              aria-hidden="true"
                              className="grid flex-none place-items-center rounded-full"
                              style={{
                                width: 30,
                                height: 30,
                                background: "var(--color-primary-soft)",
                                color: "var(--color-primary)",
                                /* מונוגרם בעיגול קבוע — ראו ההערה ב-.mv-avatar-dot */
                                fontSize: "14px",
                                fontWeight: 800,
                              }}
                            >
                              {member.name.trim().slice(0, 1)}
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate">
                                {member.name}
                                {member.isActive ? "" : " (מושבת)"}
                              </span>
                              <span
                                className="block truncate text-sm font-normal"
                                dir="ltr"
                                style={{ color: "var(--color-text-muted)" }}
                              >
                                {member.email}
                              </span>
                            </span>
                          </span>
                          <span
                            className="text-[length:var(--type-caption-lg)]"
                            style={{ color: "var(--color-text-soft)" }}
                          >
                            {editable ? (
                              <>
                                <label
                                  htmlFor={`role_${member.id}`}
                                  className="mv-visually-hidden"
                                >
                                  תפקיד של {member.name}
                                </label>
                                <select
                                  id={`role_${member.id}`}
                                  value={member.role}
                                  onChange={(event) =>
                                    void changeRole(member, event.target.value)
                                  }
                                  className="rounded-lg border px-2 py-1"
                                  style={inputStyle}
                                >
                                  {ASSIGNABLE_ROLES.map((value) => (
                                    <option key={value} value={value}>
                                      {ROLE_LABELS[value]}
                                    </option>
                                  ))}
                                </select>
                              </>
                            ) : (
                              roleLabel(member.role)
                            )}
                          </span>
                          {/*
                            הזהות מול סוכן הוואטסאפ: הטלפון האישי +
                            מתג המנוי. המנוי נפרד לכל סוכן — בעל
                            המשרד מדליק רק למי ששילם עליו. שורת
                            בעל המשרד ושלי אינן ניתנות לעריכה כאן
                            (טלפון עורכים בפרופיל; הבעלים כלול תמיד).
                            key על הטלפון: אחרי שמירה ורענון הרשימה
                            defaultValue ישן לא נדבק לשדה.
                          */}
                          <span className="flex flex-col items-start gap-1.5">
                            {editable ? (
                              <>
                                <input
                                  key={`${member.id}-${member.phone ?? ""}`}
                                  aria-label={`טלפון וואטסאפ של ${member.name}`}
                                  dir="ltr"
                                  defaultValue={member.phone ?? ""}
                                  placeholder="050-0000000"
                                  className="w-full max-w-[150px] rounded-lg border px-2 py-1 text-sm"
                                  style={inputStyle}
                                  onBlur={(event) =>
                                    void savePhone(member, event.target.value)
                                  }
                                />
                                {/*
                                  המתג רק למי שמחזיק billing.manage:
                                  זו רכישה, לא ניהול צוות — והשרת
                                  אוכף את אותו כלל (ביקורת Codex).
                                */}
                                {seatEditable ? (
                                  <button
                                    type="button"
                                    className="mv-pill"
                                    style={{
                                      fontSize: "var(--type-caption)",
                                      cursor: "pointer",
                                      border: "none",
                                      color: member.whatsappAccess
                                        ? "var(--color-primary)"
                                        : "var(--color-text-muted)",
                                      background: member.whatsappAccess
                                        ? "var(--color-primary-soft)"
                                        : "var(--color-hover-soft)",
                                    }}
                                    aria-pressed={member.whatsappAccess}
                                    onClick={() => void toggleWhatsapp(member)}
                                  >
                                    {member.whatsappAccess ? "מחזיק בסוכן" : "הקצה"}
                                  </button>
                                ) : (
                                  <span
                                    className="mv-pill"
                                    style={{
                                      fontSize: "var(--type-caption)",
                                      color: member.whatsappAccess
                                        ? "var(--color-primary)"
                                        : "var(--color-text-muted)",
                                      background: member.whatsappAccess
                                        ? "var(--color-primary-soft)"
                                        : "var(--color-hover-soft)",
                                    }}
                                  >
                                    {member.whatsappAccess ? "מחזיק בסוכן" : "כבוי"}
                                  </span>
                                )}
                              </>
                            ) : (
                              <>
                                <span className="text-sm" dir="ltr">
                                  {member.phone ?? "—"}
                                </span>
                                {/*
                                  ‎„כלול תמיד” ירד: בעל המשרד מחזיק
                                  במקום כברירת מחדל ורשאי להעביר
                                  אותו, ולכן התווית חייבת לומר מה
                                  המצב **בפועל** ולא מה התפקיד.
                                */}
                                {seatEditable ? (
                                  <button
                                    type="button"
                                    className="mv-pill"
                                    style={{
                                      fontSize: "var(--type-caption)",
                                      cursor: "pointer",
                                      border: "none",
                                      color: member.whatsappAccess
                                        ? "var(--color-primary)"
                                        : "var(--color-text-muted)",
                                      background: member.whatsappAccess
                                        ? "var(--color-primary-soft)"
                                        : "var(--color-hover-soft)",
                                    }}
                                    aria-pressed={member.whatsappAccess}
                                    onClick={() => void toggleWhatsapp(member)}
                                  >
                                    {member.whatsappAccess ? "מחזיק בסוכן" : "הקצה"}
                                  </button>
                                ) : (
                                  <span
                                    className="mv-pill"
                                    style={{
                                      fontSize: "var(--type-caption)",
                                      color: member.whatsappAccess
                                        ? "var(--color-primary)"
                                        : "var(--color-text-muted)",
                                      background: member.whatsappAccess
                                        ? "var(--color-primary-soft)"
                                        : "var(--color-hover-soft)",
                                    }}
                                  >
                                    {member.whatsappAccess ? "מחזיק בסוכן" : "כבוי"}
                                  </span>
                                )}
                              </>
                            )}
                          </span>
                          <span
                            className="text-[length:var(--type-caption-lg)]"
                            style={{ color: "var(--color-text-soft)" }}
                          >
                            {seesAll ? "את כל הקונים" : "רק את הקונים שלו"}
                          </span>
                          <span>
                            <span
                              className="mv-pill"
                              style={{
                                fontSize: "var(--type-caption)",
                                color: canExport ? "var(--color-primary)" : "var(--color-text-muted)",
                                background: canExport ? "var(--color-primary-soft)" : "var(--color-hover-soft)",
                              }}
                            >
                              {canExport ? "מותר" : "חסום"}
                            </span>
                          </span>
                          <span className="flex flex-wrap justify-end gap-1.5">
                            {member.locked ? (
                              <button
                                type="button"
                                className="mv-btn-soft"
                                onClick={() => void unlock(member)}
                              >
                                <IconLock s={15} /> שחרר נעילה
                              </button>
                            ) : null}
                            {editable ? (
                              <button
                                type="button"
                                className="mv-btn-plain"
                                aria-expanded={permissionsFor === member.id}
                                onClick={() =>
                                  setPermissionsFor(
                                    permissionsFor === member.id
                                      ? null
                                      : member.id,
                                  )
                                }
                              >
                                <IconKey s={15} /> הרשאות
                              </button>
                            ) : null}
                            {/*
                              „חיבורים” גם למי שאינו ניתן לעריכה
                              (בעל המשרד, ואני עצמי): לראות מאיפה
                              מישהו מחובר אינו שינוי, וזו בדיוק
                              השורה שרוצים לבדוק כשחושדים שחשבון
                              בכיר נפרץ.
                            */}
                            <button
                              type="button"
                              className="mv-btn-plain"
                              aria-expanded={sessionsFor === member.id}
                              onClick={() =>
                                setSessionsFor(
                                  sessionsFor === member.id ? null : member.id,
                                )
                              }
                            >
                              חיבורים
                            </button>
                            {editable ? (
                              <button
                                type="button"
                                className="mv-btn-plain"
                                onClick={() => void toggleActive(member)}
                              >
                                {member.isActive ? "השבת" : "הפעל"}
                              </button>
                            ) : null}
                          </span>
                        </div>
                        {permissionsFor === member.id ? (
                          <UserPermissions
                            userId={member.id}
                            onClose={() => setPermissionsFor(null)}
                          />
                        ) : null}
                        {sessionsFor === member.id ? (
                          <div
                            className="mt-2 rounded-lg border p-3"
                            style={{ borderColor: "var(--color-border)" }}
                          >
                            {/*
                              המפתח הוא מזהה המשתמש: בלעדיו React היה
                              משתמש באותו מופע לשורה אחרת, והרשימה
                              שנטענה קודם הייתה מוצגת רגע תחת שם
                              אחר — כלומר החיבורים של אדם אחד מוצמדים
                              לשמו של אחר.
                            */}
                            <SessionsList
                              key={member.id}
                              userId={member.id}
                              userName={member.name}
                            />
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
              <p
                className="m-0 px-5 py-[13px] text-[length:var(--type-caption)]"
                style={{ color: "var(--color-text-muted)" }}
              >
                הרשאות לפי תפקיד — הגנה מפני סוכן שעוזב עם המאגר. כל פעולה
                מתועדת: מי עשה מה ומתי. המנוי לסוכן הוואטסאפ נפרד לכל סוכן:
                הזינו את הטלפון האישי של הסוכן והפעילו לו את המנוי — והוא
                יקבל בוואטסאפ בדיוק את ההרשאות והנתונים שיש לו בדשבורד.
              </p>
            </section>
          ) : null}

          {/* ---- פרטי המשרד ---- */}
          {tab === "office" ? (
            <section
              className="mv-list-card px-5 py-[17px]"
              aria-labelledby="office-heading"
            >
              <h2
                id="office-heading"
                className="m-0 mb-3"
                style={{ fontSize: "calc(16.5 / 16 * 1rem)", fontWeight: 800 }}
              >
                פרטי המשרד
              </h2>
              {tenant ? (
                <form onSubmit={(e) => void saveTenant(e)} className="max-w-md">
                  {/* הלוגו ראשון: הוא הדבר היחיד בטופס שרואים אותו */}
                  <OfficeLogo />
                  <div className="mb-3.5">
                    <label
                      htmlFor="name"
                      className="mb-1 block text-sm font-semibold"
                    >
                      שם המשרד
                    </label>
                    <input
                      id="name"
                      name="name"
                      defaultValue={tenant.name}
                      required
                      minLength={2}
                      className="w-full rounded-lg border px-3 py-2.5"
                      style={inputStyle}
                    />
                  </div>
                  <div className="mb-3.5">
                    <label
                      htmlFor="whatsappNumber"
                      className="mb-1 block text-sm font-semibold"
                    >
                      מספר וואטסאפ עסקי{" "}
                      <span className="font-normal">
                        (לניתוב הודעות נכנסות)
                      </span>
                    </label>
                    <input
                      id="whatsappNumber"
                      name="whatsappNumber"
                      dir="ltr"
                      placeholder="972501234567"
                      defaultValue={tenant.whatsappNumber ?? ""}
                      className="w-full rounded-lg border px-3 py-2.5"
                      style={inputStyle}
                    />
                  </div>
                  <div className="mb-3.5">
                    <label
                      htmlFor="licenseNumber"
                      className="mb-1 block text-sm font-semibold"
                    >
                      מספר רישיון תיווך
                    </label>
                    <p
                      className="m-0 mb-1 text-sm"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      נכנס לנוסח ההזמנה בכתב — פרט חובה לפי חוק המתווכים
                      במקרקעין.
                    </p>
                    <input
                      id="licenseNumber"
                      name="licenseNumber"
                      dir="ltr"
                      defaultValue={tenant.licenseNumber ?? ""}
                      maxLength={40}
                      className="w-full rounded-lg border px-3 py-2.5"
                      style={inputStyle}
                    />
                  </div>
                  <div className="mb-3.5">
                    <label
                      htmlFor="officeAddress"
                      className="mb-1 block text-sm font-semibold"
                    >
                      כתובת המשרד
                    </label>
                    <input
                      id="officeAddress"
                      name="officeAddress"
                      placeholder="הרצל 10, תל אביב"
                      defaultValue={tenant.officeAddress ?? ""}
                      maxLength={200}
                      className="w-full rounded-lg border px-3 py-2.5"
                      style={inputStyle}
                    />
                  </div>
                  <div className="mb-3.5">
                    <label
                      htmlFor="officePhone"
                      className="mb-1 block text-sm font-semibold"
                    >
                      טלפון המשרד
                    </label>
                    <input
                      id="officePhone"
                      name="officePhone"
                      dir="ltr"
                      inputMode="tel"
                      placeholder="03-1234567"
                      defaultValue={tenant.officePhone ?? ""}
                      maxLength={30}
                      className="w-full rounded-lg border px-3 py-2.5"
                      style={inputStyle}
                    />
                  </div>
                  <div className="mb-3.5">
                    <label
                      htmlFor="defaultCommission"
                      className="mb-1 block text-sm font-semibold"
                    >
                      דמי תיווך — ברירת מחדל
                    </label>
                    <p
                      className="m-0 mb-1 text-sm"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      פרט חובה בהזמנה בכתב. נכנס אוטומטית לכל הסכם שנשלח לחתימה,
                      ואפשר לשנות אותו בשליחה בודדת.
                    </p>
                    <input
                      id="defaultCommission"
                      name="defaultCommission"
                      placeholder="2% ממחיר העסקה"
                      defaultValue={tenant.defaultCommission ?? ""}
                      maxLength={80}
                      className="w-full rounded-lg border px-3 py-2.5"
                      style={inputStyle}
                    />
                  </div>
                  <div className="mb-3.5">
                    <label
                      htmlFor="defaultPaymentTerms"
                      className="mb-1 block text-sm font-semibold"
                    >
                      מועד תשלום דמי התיווך — ברירת מחדל
                    </label>
                    <input
                      id="defaultPaymentTerms"
                      name="defaultPaymentTerms"
                      placeholder="במועד חתימת חוזה מחייב"
                      defaultValue={tenant.defaultPaymentTerms ?? ""}
                      maxLength={120}
                      className="w-full rounded-lg border px-3 py-2.5"
                      style={inputStyle}
                    />
                  </div>
                  <button type="submit" className="mv-btn-action">
                    שמור
                  </button>
                </form>
              ) : (
                <p aria-live="polite">טוען…</p>
              )}
            </section>
          ) : null}

          {tab === "integrations" ? (
            <>
              {/*
            מדף המודולים. הקטעים עצמם נשארים כאן — החנות היא איך
            מוצאים אותם, לא איפה מגדירים אותם.
          */}
              <section
                className="mb-8 rounded-xl border px-5 py-[17px]"
                style={{
                  background: "var(--color-table-head)",
                  borderColor: "var(--color-border)",
                }}
                aria-labelledby="modules-heading"
              >
                <h2
                  id="modules-heading"
                  className="m-0 mb-1"
                  style={{ fontSize: "calc(16.5 / 16 * 1rem)", fontWeight: 800 }}
                >
                  מודולים וחיבורים
                </h2>
                <p
                  className="m-0 mb-3 text-sm"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  מרכזייה, וואטסאפ, לידים מאתרים חיצוניים ועוד — במסך אחד עם
                  הסטטוס של כל אחד.
                </p>
                <Link
                  href="/settings/integrations"
                  className="mv-btn-ghost inline-block"
                >
                  לחנות המודולים
                </Link>
              </section>

              {/*
            סטטוס הוואטסאפ לבעל המשרד בלבד. השלב הראשון בו ("חיבור
            השרת ל-Meta") הוא באחריותנו כמפעילי המערכת, ולשאר הצוות
            הקטע רק מציג ✗ אדומים שאין להם מה לעשות איתם.
          */}
              {user?.role === "owner" ? (
                <div id="whatsapp">
                  <WhatsAppStatusSection />
                </div>
              ) : null}
              <div id="telephony">
                {canTelephony ? (
                  <>
                    <TelephonySection />
                    {/*
                      צמוד למרכזייה ולא בסעיף משלו: מספר וירטואלי הוא
                      חסר משמעות בלי חיבור שמביא את השיחות, וסעיף נפרד
                      היה מזמין להגדיר ניתוב לשיחות שלא יגיעו.
                    */}
                    <VirtualNumbersSection />
                  </>
                ) : (
                  <LockedFeature
                    code="telephony"
                    description="שיחות נכנסות נכנסות למערכת אוטומטית עם זיהוי הלקוח, וחיוג יוצא בלחיצה מתוך הכרטיס. תומך ב-015, Vonage ובכל מרכזייה ששולחת Webhook."
                  />
                )}
              </div>

              <div id="google-calendar">
                <GoogleCalendarSection />
              </div>

              <div id="gmail">
                <GmailSection />
              </div>

              {/*
                חיבור דומיין הוא פעולת הגדרות של המשרד (settings.manage) —
                לשאר הצוות הקטע היה רק טופס שמחזיר 403.
              */}
              {can(user, "settings.manage") ? (
                <div id="email-domain">
                  <EmailDomainSection />
                </div>
              ) : null}

              <div id="lead-webhook">
                <LeadWebhookSection />
              </div>
            </>
          ) : null}

          {tab === "documents" ? (
            canAgreements ? (
              <>
                <AgreementTemplatesSection />
                {/* מסמכים חתומים ששרדו מחיקת לקוח — מוצג רק כשיש */}
                <RetainedAgreementsSection />
              </>
            ) : (
              <LockedFeature
                code="agreements"
                description="הסכמי תיווך ובלעדיות נשלחים לחתימה בקישור, נחתמים מהנייד ונשמרים בכרטיס — בלי מדפסת ובלי סורק."
              />
            )
          ) : null}

          {/*
            הדוח יושב ליד המשקלים ולא במסך הדוחות: המסקנה שלו היא
            "העלו את המשקל של X", והמקום לעשות את זה הוא כאן. במסך
            הדוחות הוא גם היה חסום מאחורי שער המסלול — ובאיכות
            ההתאמות אין סיבה לגבות תשלום.
          */}
          {tab === "matching" ? (
            <>
              <MatchWeightsSection />
              <DismissReportSection />
            </>
          ) : null}

          {/*
            שלושת הסוגים באותה לשונית, ובסדר הזה: מה שהמערכת עושה
            מעצמה, מה שהמשרד בנה, ומה שרץ בזמנים קבועים. המשימות
            הקבועות ישבו קודם ביומן — כלומר מי שחיפש "למה נפתחה לי
            המשימה הזאת" לא מצא אותן, ומי שנכנס ליומן פגש הגדרה
            משרדית באמצע לוח אישי.
          */}
          {tab === "automations" ? (
            <>
              {/*
                האוטומציות המובנות פתוחות תמיד: הן רצות ממילא, והמסך
                הזה הוא הדרך היחידה לכבות אותן. נעילה שלהן הייתה
                משאירה משרד עם אוטומציות פועלות שאין לו שליטה עליהן.
              */}
              {/*
                ברירות המחדל של המשרד ראשונות: הן מסבירות את מה
                שרץ **על כל כרטיס חדש**, וזו השאלה שמגיעים איתה
                ללשונית הזו. הן מוצגות רק למי שמנהל את המשרד —
                מתג משרדי לסוכן רגיל מחזיר 403, וכפתור שמחזיר 403
                גרוע מכפתור שאינו קיים.
              */}
              {can(user, "settings.manage") && tenant !== null ? (
                <OfficeDefaultsSection
                  value={{
                    autoShareProperties: tenant.autoShareProperties,
                    autoShareBuyers: tenant.autoShareBuyers,
                    autoEmailOffers: tenant.autoEmailOffers,
                  }}
                  onSave={saveTenantFlags}
                />
              ) : null}
              <AutomationsSection />
              {canAutomations ? (
                <>
                  <CustomAutomationsSection />
                  <RecurrenceSection />
                </>
              ) : (
                <LockedFeature
                  code="automations"
                  description="בניית כללים משלכם: מתי זה קורה, על מה מתוך זה, ומה לעשות — וגם משימות אוטומטיות שחוזרות בזמנים קבועים."
                />
              )}
            </>
          ) : null}

          {tab === "support" ? (
            <>
              <SupportTicketsSection />
              {/*
                גישת תמיכה אינה תלוית-מסלול — כל משרד יכול לבקש עזרה —
                אבל היא כן תלוית-הרשאה: פתיחת דלת לחשבון היא החלטה של
                מי שמנהל את המשרד. לסוכן רגיל הקטע כלל אינו מוצג, כי
                כפתור שמחזיר 403 גרוע מכפתור שאינו קיים.
              */}
              {can(user, "settings.manage") ? <SupportAccessSection /> : null}
            </>
          ) : null}

          {/* ---- יומן פעילות ---- */}
          {tab === "data" ? (
            <section className="mv-list-card" aria-labelledby="audit-heading">
              <div
                className="px-5 py-[15px]"
                style={{
                  borderBottom: "1px solid var(--color-card-head-border)",
                }}
              >
                <h2
                  id="audit-heading"
                  className="m-0"
                  style={{ fontSize: "calc(16.5 / 16 * 1rem)", fontWeight: 800 }}
                >
                  יומן פעילות
                </h2>
                <p
                  className="m-0 mt-0.5 text-[length:var(--type-caption)]"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  מי עשה מה ומתי — כל פעולה במערכת מתועדת ואינה ניתנת למחיקה.
                </p>
              </div>
              {audit.length === 0 ? (
                <p
                  className="px-5 py-4"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  אין רישומים עדיין.
                </p>
              ) : (
                <ol className="m-0 list-none p-0">
                  {audit.map((row, index) => (
                    <li
                      key={index}
                      className="flex flex-wrap gap-1.5 px-5 py-2.5 text-[length:var(--type-body-sm)]"
                      style={{
                        borderBottom: "1px solid var(--color-row-border)",
                      }}
                    >
                      <span className="font-bold">
                        {/*
                        פעולת תמיכה נקראת "תמיכה", לא בשם המשתמש שבשמו
                        פעלו: המשתמש לא עשה את זה, והצגת שמו הייתה
                        בדיוק הייחוס השגוי שהסימון בא למנוע. הכתובת
                        נשמרת לצידה — "תמיכה" אנונימי אינו אחריות.
                      */}
                        {row.supportAdmin ? (
                          <span style={{ color: "var(--color-warning)" }}>
                            תמיכה{" "}
                            <span className="font-normal text-[length:var(--type-caption)]" dir="ltr">
                              ({row.supportAdmin})
                            </span>
                          </span>
                        ) : (
                          (row.userName ?? "מערכת")
                        )}
                      </span>
                      <span style={{ color: "var(--color-text-soft)" }}>
                        {AUDIT_ACTION_LABELS[row.action] ?? row.action}
                      </span>
                      <span
                        className="ms-auto"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        {formatDateTime(row.createdAt)}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          ) : null}
        </div>

        {/* ================= הטור הצדדי ================= */}
        <div className="flex min-w-0 flex-col gap-4">
          {/* ---- אבטחה ופרטיות — הרשימה מקובץ העיצוב ---- */}
          {tab === "data" ? (
            <section
              className="mv-list-card px-5 py-[17px]"
              aria-labelledby="security-heading"
            >
              <h2
                id="security-heading"
                className="m-0 mb-[11px]"
                style={{ fontSize: "calc(16.5 / 16 * 1rem)", fontWeight: 800 }}
              >
                אבטחה ופרטיות
              </h2>
              {SECURITY_ROWS.map((row) => (
                <div
                  key={row}
                  className="flex items-center gap-[9px] py-1.5 text-[length:var(--type-body-sm)]"
                  style={{ color: "var(--color-text-soft)" }}
                >
                  <span
                    aria-hidden="true"
                    className="font-extrabold"
                    style={{ color: "#2ECC66" }}
                  >
                    ✓
                  </span>
                  {row}
                </div>
              ))}
            </section>
          ) : null}

          {/* ---- נתונים — כולו מאחורי data_io ---- */}
          {tab === "data" && canDataIo ? (
            <section
              id="data"
              className="mv-list-card px-5 py-[17px]"
              aria-labelledby="data-heading"
            >
              <h2
                id="data-heading"
                className="m-0 mb-[11px]"
                style={{ fontSize: "calc(16.5 / 16 * 1rem)", fontWeight: 800 }}
              >
                נתונים
              </h2>
              <div className="mb-2 flex gap-2">
                <Link
                  href="/import"
                  className="mv-btn-plain flex-1 text-center"
                  style={{ padding: "8px 0", fontSize: "var(--type-caption-lg)" }}
                >
                  ייבוא מאקסל
                </Link>
              </div>
              <ExportSection />
            </section>
          ) : null}

          {tab === "data" ? <SystemUpdateSection /> : null}

          {/* ---- בפיתוח עכשיו — מקובץ העיצוב ---- */}
          {tab === "data" ? (
            <section
              className="rounded-xl border px-5 py-[17px]"
              style={{
                background: "var(--color-table-head)",
                borderColor: "var(--color-border)",
              }}
              aria-labelledby="roadmap-heading"
            >
              <div className="mb-[9px] flex items-center gap-[9px]">
                <span
                  className="mv-tag"
                  /*
                    טוקנים ולא ערך ישיר (#266). הערך הקשיח שהיה כאן כבר
                    נלכד פעם אחת ב-CSS: קפוא בשלוש הערכות הוא עמד על
                    1.07:1 מול הכרטיס במצב כהה — צ'יפ כהה על כרטיס כהה,
                    בלתי קריא. שם הוא תוקן לאותו זוג טוקנים, וכאן לא.
                    אותו זוג, אותו נימוק.

                    (הערך עצמו אינו נכתב כאן בכוונה: שער שסופר ערכים
                    ישירים ואינו מפשיט הערות היה סופר את ההסבר.)
                  */
                  style={{ background: "var(--color-primary)", color: "var(--color-surface)" }}
                >
                  בקרוב
                </span>
                <h2
                  id="roadmap-heading"
                  className="m-0"
                  style={{ fontSize: "var(--type-body)", fontWeight: 800 }}
                >
                  בפיתוח עכשיו
                </h2>
              </div>
              <p
                className="m-0 text-[length:var(--type-caption-lg)]"
                style={{ color: "var(--color-text-soft)", lineHeight: 1.6 }}
              >
                שליחה אוטומטית בוואטסאפ
              </p>
              <p
                className="m-0 mt-2 text-[length:var(--type-caption)]"
                style={{ color: "var(--color-text-muted)" }}
              >
                כשפיצ׳ר עולה — באנר "מה חדש" מופיע לכולם בכניסה הבאה.
              </p>
            </section>
          ) : null}
        </div>
      </div>

      {/* אזור הסכנה — בעל המשרד בלבד, בלשונית הנתונים ורחוק מהיד */}
      {tab === "data" && user?.role === "owner" && tenant ? (
        <DeleteAccountSection tenantName={tenant.name} />
      ) : null}
    </>
  );
}
