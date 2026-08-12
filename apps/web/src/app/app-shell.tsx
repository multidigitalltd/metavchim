"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api";
import { FeaturesProvider } from "@/lib/use-features";
import { NotificationsBell } from "./notifications-bell";
import { TopbarSearch } from "./topbar-search";
import { WhatsNewBanner } from "./whats-new-banner";
import { TrialBanner } from "./trial-banner";
import { SoftphoneProvider } from "./softphone-bar";
import { IconMenu, LogoMark } from "./icons";

/**
 * מעטפת האפליקציה לפי קובץ העיצוב: סרגל צד כהה עם ניווט אנכי, מונים
 * ותגים ליד הפריטים, ושורת כותרת לבנה עם כותרת המסך, חיפוש גלובלי,
 * התראות וכפתור "קליטה בקול".
 *
 * במסכים ציבוריים — התחברות, דף ההצעה ודף החתימה — המעטפת נעלמת
 * לגמרי: הקונה של המשרד לא אמור לראות תפריטי מתווך.
 *
 * במובייל הסרגל הופך למגירה נשלפת; רוחב 230px קבוע היה גוזל שליש
 * ממסך של 375px.
 */

/**
 * מסכי הכניסה מביאים מעטפת משלהם (AuthShell) — כולל ה-main.
 *
 * בלי ההפרדה הזו היו שני `<main id="main-content">` באותו דף:
 * זה של המעטפת הכללית וזה של המסך. מזהה כפול שובר את קישור הדילוג
 * ומבלבל קורא מסך.
 */
const AUTH_PREFIXES = ["/login", "/signup", "/forgot-password", "/reset-password", "/change-password"];

const PUBLIC_PREFIXES = [
  "/login",
  "/signup",
  "/offer/",
  "/sign/",
  "/p/", // דף נחיתה של נכס — הלקוח לא רואה תפריטי מתווך
  // מסמכים ציבוריים — מקושרים מאתר התדמית ומדף ההצעה, ונקראים גם
  // ע"י מי שאינו משתמש רשום (לקוח קצה שקיבל הצעה, משרד ששוקל להצטרף)
  "/accessibility",
  "/privacy",
  "/terms",
  "/change-password",
  "/forgot-password",
  "/reset-password",
];

/** כותרות המסכים בשורת הכותרת — מיפוי הנתיבים מקובץ העיצוב. */
const SCREEN_TITLES: [prefix: string, title: string][] = [
  ["/properties", "נכסים"],
  ["/buyers", "קונים · שוכרים"],
  ["/leads", "לידים"],
  ["/calls", "שיחות"],
  ["/matches", "התאמות"],
  ["/offers", "הצעות"],
  ["/calendar", "יומן"],
  ["/reports", "דוחות"],
  ["/collaboration", 'שת"פים'],
  ["/settings", "ניהול משרד"],
  ["/setup", "הקמה"],
  ["/platform", "פלטפורמה"],
  ["/voice", "קליטה בקול"],
  ["/notifications", "התראות"],
  ["/search", "חיפוש"],
  ["/profile", "הפרופיל שלי"],
  ["/tasks", "משימות"],
  ["/guides", "הדרכות"],
];

function screenTitle(pathname: string): string {
  if (pathname === "/") return "דשבורד";
  return SCREEN_TITLES.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? "";
}

interface NavSummary {
  properties: number;
  buyers: number;
  newLeads: number;
  matches: number;
  /** משימות שלי באיחור או להיום — התג הכתום. */
  urgentTasks: number;
  /** מודולים שהפלטפורמה חסמה למשרד — פריט חסום יורד מהסרגל. */
  blockedModules?: string[];
  /** הפיצ'רים שכלולים במסלול המשרד — פריט שלא כלול לא מוצג. */
  features?: string[];
}

/** אייקוני קו דקים — הנתיבים המדויקים מקובץ העיצוב. */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="flex-none"
    >
      {children}
    </svg>
  );
}

const ICONS = {
  dashboard: (
    <Icon>
      <rect x="3" y="3" width="8" height="8" rx="2" />
      <rect x="13" y="3" width="8" height="8" rx="2" />
      <rect x="3" y="13" width="8" height="8" rx="2" />
      <rect x="13" y="13" width="8" height="8" rx="2" />
    </Icon>
  ),
  properties: (
    <Icon>
      <polyline points="3 11 12 4 21 11" />
      <rect x="6" y="11" width="12" height="9" />
    </Icon>
  ),
  buyers: (
    <Icon>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <circle cx="17" cy="9" r="2.5" />
    </Icon>
  ),
  leads: (
    <Icon>
      <path d="M13 3 5 13h6l-1 8 8-10h-6z" />
    </Icon>
  ),
  calls: (
    <Icon>
      <path d="M5 4h4l2 5-2.5 1.5c1 2.6 3.4 5 6 6L16 14l5 2v4a1.5 1.5 0 0 1-1.6 1.5C11 20.8 3.2 13 3.5 5.6A1.5 1.5 0 0 1 5 4z" />
    </Icon>
  ),
  matches: (
    <Icon>
      <circle cx="9" cy="12" r="5.5" />
      <circle cx="15" cy="12" r="5.5" />
    </Icon>
  ),
  offers: (
    <Icon>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <line x1="8" y1="8" x2="16" y2="8" />
      <line x1="8" y1="12" x2="16" y2="12" />
      <line x1="8" y1="16" x2="13" y2="16" />
    </Icon>
  ),
  calendar: (
    <Icon>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="8" y1="3" x2="8" y2="7" />
      <line x1="16" y1="3" x2="16" y2="7" />
    </Icon>
  ),
  tasks: (
    <Icon>
      <path d="M4 5.5 5.5 7 8 4.5" />
      <line x1="11" y1="6" x2="20" y2="6" />
      <path d="M4 11.5 5.5 13 8 10.5" />
      <line x1="11" y1="12" x2="20" y2="12" />
      <path d="M4 17.5 5.5 19 8 16.5" />
      <line x1="11" y1="18" x2="20" y2="18" />
    </Icon>
  ),
  reports: (
    <Icon>
      <line x1="5" y1="21" x2="5" y2="12" />
      <line x1="12" y1="21" x2="12" y2="5" />
      <line x1="19" y1="21" x2="19" y2="9" />
    </Icon>
  ),
  coop: (
    <Icon>
      <circle cx="7" cy="7" r="3" />
      <circle cx="17" cy="17" r="3" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </Icon>
  ),
  office: (
    <Icon>
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="12" r="8" />
      <line x1="12" y1="1.5" x2="12" y2="4" />
      <line x1="12" y1="20" x2="12" y2="22.5" />
      <line x1="1.5" y1="12" x2="4" y2="12" />
      <line x1="20" y1="12" x2="22.5" y2="12" />
    </Icon>
  ),
  setup: (
    <Icon>
      <path d="M20 6 9 17l-5-5" />
    </Icon>
  ),
  guides: (
    <Icon>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15.5H6.5A2.5 2.5 0 0 0 4 21Z" />
      <path d="M4 5.5V21" />
      <path d="M8.5 7.5h7M8.5 11h7" />
    </Icon>
  ),
  platform: (
    <Icon>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
    </Icon>
  ),
};

const ROLE_LABELS: Record<string, string> = {
  owner: "בעלים",
  admin: "מנהל",
  agent: "סוכן",
  assistant: "עוזר",
  viewer: "צפייה",
};

/** מי רואה את מסכי הניהול — "דוחות" ו"ניהול משרד" בעיצוב מוצגים למנהל בלבד. */
const MANAGER_ROLES = new Set(["owner", "admin"]);

/**
 * לאיזה מודול שייך כל פריט בסרגל.
 *
 * **לפי היכולות שהמסך באמת דורש ולא לפי שם הנתיב.** "שיחות" נשען על
 * יכולות הלידים, "משימות" על יכולת היומן, ו"ניהול משרד" ו"הקמה" על
 * מודול הניהול — חסימה של אחד מהם משאירה אותם מצביעים ל-403
 * (ביקורת Codex). המפה נבדקת בתוך `navLink`, ולכן פריט חדש שנוסף
 * לסרגל מקבל את ההתנהגות אוטומטית.
 *
 * נתיב שאינו כאן (דשבורד, הדרכות, פרופיל) אינו שייך לאף מודול.
 */
const NAV_MODULE: Record<string, string> = {
  "/properties": "properties",
  "/buyers": "buyers",
  "/leads": "leads",
  "/calls": "leads",
  "/matches": "matches",
  "/offers": "offers",
  "/calendar": "calendar",
  "/tasks": "calendar",
  "/collaboration": "collaboration",
  "/reports": "reports",
  "/settings": "admin",
  "/setup": "admin",
};

interface Me {
  name: string;
  role: string;
  tenantName?: string;
  isPlatformAdmin?: boolean;
  /** סוף תקופת הניסיון; null = אין תפוגה. */
  trialEndsAt?: string | null;
  /** התקופה נגמרה — רק מסך המנוי פתוח. */
  billingOnly?: boolean;
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("");
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
  const [me, setMe] = useState<Me | null>(null);
  const [counts, setCounts] = useState<NavSummary | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  /*
   * תשובה שהתחילה לפני יציאה נזרקת.
   *
   * ה-AppShell נשאר טעון בין משתמשים. בקשה שהייתה באוויר ברגע
   * היציאה יכולה להסתיים אחריה ולמלא בחזרה את המשתמש הקודם — ואם
   * הבקשה של המשתמש החדש נכשלת, השם, המשרד והתפריט של הקודם
   * נשארים על המסך לצמיתות (ביקורת Codex).
   *
   * דגל cancelled ב-cleanup ולא AbortController: אותה תוצאה, בלי
   * לשנות את חתימת apiGet לכל הקוראים.
   */
  useEffect(() => {
    if (isPublic) return;
    let cancelled = false;
    apiGet<{ user: Me }>("/auth/me")
      .then((res) => {
        if (!cancelled) setMe(res.user);
      })
      .catch(() => {
        // כשל מאפס במקום להשאיר את הקודם
        if (!cancelled) setMe(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isPublic]);

  /*
   * לשונית ההקמה נעלמת ברגע שהמשרד סיים.
   *
   * הבאנר בדשבורד כבר ידע להיעלם, אבל הלשונית נשארה — כלומר משרד
   * ותיק ראה לנצח קישור למסך שאין בו מה לעשות, וכל כניסה אליו רק
   * מאשרת שהכל מסומן. נשאל רק עבור מנהלים, כי רק להם הלשונית מוצגת.
   */
  const [setupDone, setSetupDone] = useState(false);
  useEffect(() => {
    // משרד שתקופתו נגמרה — כל נתיב שאינו מסך המנוי מוחזר 402; אין
    // טעם לשאול ולקבל שגיאה
    if (isPublic || me === null || me.billingOnly === true || !MANAGER_ROLES.has(me.role)) return;
    apiGet<{ ready: boolean }>("/settings/onboarding")
      .then((p) => setSetupDone(p.ready))
      .catch(() => undefined);
  }, [isPublic, me, pathname]);

  /* המונים מתרעננים במעבר מסך — פעולה במסך אחד (קליטת ליד) צריכה
     להשתקף בתג כשעוברים הלאה, בלי Polling קבוע */
  useEffect(() => {
    /*
     * מעבר למסך ציבורי (יציאה) מנקה את הסיכום.
     *
     * ה-AppShell נשאר טעון בין משתמשים — יציאה וכניסה של משרד אחר הן
     * `router.replace` ולא טעינה מחדש. בלי הניקוי, המשרד החדש היה
     * מקבל את רשימת הפיצ'רים של הקודם עד שהשאילתה מצליחה, ולתמיד אם
     * היא נכשלת: כפתורים חסומים שמוצגים, ופעילים שמוסתרים (ביקורת
     * Codex).
     */
    if (isPublic) {
      setCounts(null);
      setMe(null);
      return;
    }
    if (me?.billingOnly === true) {
      setCounts(null);
      return;
    }
    let cancelled = false;
    apiGet<NavSummary>("/nav/summary")
      .then((summary) => {
        if (!cancelled) setCounts(summary);
      })
      .catch(() => {
        if (!cancelled) setCounts(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isPublic, pathname, me]);

  // סגירת המגירה במעבר מסך — אחרת היא נשארת פתוחה מעל התוכן החדש
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  /*
   * המגירה מתנהגת כדיאלוג: ESC סוגר, הפוקוס נכנס אליה בפתיחה וחוזר
   * לכפתור בסגירה. בלי זה ניווט במקלדת נשאר תקוע מאחורי שכבת הכיסוי
   * (docs/06 §4).
   */
  useEffect(() => {
    if (!menuOpen) return;
    drawerRef.current?.querySelector<HTMLElement>("a")?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  if (AUTH_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) {
    return <>{children}</>;
  }
  if (isPublic) {
    return <main id="main-content" className="mx-auto max-w-6xl px-4 py-6">{children}</main>;
  }

  /*
   * תקופה שנגמרה — מסגרת מינימלית סביב מסך המנוי.
   *
   * תפריט מלא כאן היה תפריט שכל קישור בו מוחזר 402 ומקפיץ בחזרה
   * לאותו מסך. עדיף לא להציג אותו מלכתחילה: מה שנשאר הוא הכותרת,
   * התוכן, ויציאה.
   */
  if (me?.billingOnly === true) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-6">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <strong>{me.tenantName ?? "מתווכים"}</strong>
          {/*
            דרך ה-API כמו בכל מקום אחר: ה-API יושב על מקור נפרד,
            ו-form שמצביע לנתיב יחסי היה מגיע לשרת ה-Next.
          */}
          <button
            type="button"
            className="mv-btn-ghost"
            onClick={() => {
              void apiPost("/auth/logout", {})
                .catch(() => undefined)
                .finally(() => window.location.assign("/login"));
            }}
          >
            יציאה
          </button>
        </header>
        <main id="main-content">{children}</main>
      </div>
    );
  }

  const isManager = me !== null && MANAGER_ROLES.has(me.role);

  const navLink = (
    href: string,
    label: string,
    icon: ReactNode,
    end?: ReactNode,
  ): ReactNode => {
    // מודול חסום — הפריט יורד מהסרגל, ולא מוצג ומוביל ל-403
    const module = NAV_MODULE[href];
    if (module !== undefined && (counts?.blockedModules ?? []).includes(module)) return null;
    const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
    return (
      <Link
        key={href}
        href={href}
        className="mv-sidebar-link"
        aria-current={active ? "page" : undefined}
      >
        {icon}
        <span>{label}</span>
        {end}
      </Link>
    );
  };

  const count = (n: number | undefined): ReactNode =>
    n !== undefined && n > 0 ? <span className="mv-nav-count">{n}</span> : null;

  /*
   * פריט ניווט לפיצ'ר שאינו במסלול לא מוצג.
   *
   * הכניסה למסך תיחסם בשרת בכל מקרה (FeatureGuard), וקישור שמוביל
   * ל-403 גרוע מקישור שלא קיים. כל עוד המונים לא נטענו — מציגים,
   * כדי שהתפריט לא "יקפוץ" ולא ייעלם על רשת איטית.
   */
  const hasFeature = (code: string): boolean =>
    counts?.features === undefined || counts.features.includes(code);
  // אותה רשימה מחולקת למסכים עצמם — הניווט לא יכול להיות המקום
  // היחיד שיודע מה כלול (ראו lib/use-features)
  const features = counts?.features ?? null;

  const sidebar = (
    <>
      <div className="mv-sidebar-head">
        <div className="mv-logo">
          <LogoMark s={30} />
          <span>
            מתווכים<span style={{ color: "var(--color-action)" }}>.</span>
          </span>
        </div>
        <div className="mv-sidebar-sub">{me?.tenantName ?? " "}</div>
      </div>

      <nav aria-label="ניווט ראשי" className="mv-sidebar-nav">
        {navLink("/", "דשבורד", ICONS.dashboard)}
        {navLink("/properties", "נכסים", ICONS.properties, count(counts?.properties))}
        {navLink("/buyers", "קונים · שוכרים", ICONS.buyers, count(counts?.buyers))}
        {navLink(
          "/leads",
          "לידים",
          ICONS.leads,
          counts !== null && counts.newLeads > 0 ? (
            <span className="mv-nav-badge">{counts.newLeads}</span>
          ) : null,
        )}
        {navLink("/calls", "שיחות", ICONS.calls)}
        {navLink("/matches", "התאמות", ICONS.matches, count(counts?.matches))}
        {navLink("/offers", "הצעות", ICONS.offers)}
        {navLink("/calendar", "יומן", ICONS.calendar)}
        {navLink(
          "/tasks",
          "משימות",
          ICONS.tasks,
          /* באיחור או להיום — התג הכתום, כמו בלידים חדשים */
          counts !== null && counts.urgentTasks > 0 ? (
            <span className="mv-nav-badge">{counts.urgentTasks}</span>
          ) : null,
        )}
        {/*
          השת"פ לפני הדוחות: הוא עבודה יומיומית של הסוכן, והדוחות הם
          מסך שמנהל פותח פעם בשבוע. בלי שער מסלול — השת"פ הבסיסי פתוח
          בכל המסלולים.
        */}
        <div className="mv-nav-group">רשת</div>
        {/*
          יתרת הקרדיטים ישבה כאן, צמודה לשת"פ — וזה בדיוק מה שלימד את
          המתווכים ששיתוף פעולה עולה כסף. שיתוף פעולה חינם; קרדיטים
          נוגעים אך ורק לקליטת הפניית לקוח. היתרה עברה ללשונית
          "הפניות לקוחות", שם היא באמת רלוונטית.
        */}
        {navLink("/collaboration", 'שת"פים', ICONS.coop)}
        {isManager && hasFeature("analytics")
          ? navLink("/reports", "דוחות", ICONS.reports)
          : null}
        {navLink("/guides", "הדרכות", ICONS.guides)}
        {isManager ? navLink("/settings", "ניהול משרד", ICONS.office) : null}
        {isManager && !setupDone ? navLink("/setup", "הקמה", ICONS.setup) : null}
        {me?.isPlatformAdmin ? navLink("/platform", "פלטפורמה", ICONS.platform) : null}
      </nav>

      {me ? (
        <Link href="/profile" className="mv-sidebar-user" aria-label={`הפרופיל של ${me.name}`}>
          <span className="mv-avatar" aria-hidden="true">
            {initials(me.name)}
          </span>
          <span className="min-w-0">
            <span className="mv-sidebar-user-name">{me.name}</span>
            <span className="mv-sidebar-user-role">{ROLE_LABELS[me.role] ?? me.role}</span>
          </span>
        </Link>
      ) : null}
    </>
  );

  return (
    <div className="mv-app">
      <aside className="mv-sidebar" aria-label="תפריט המערכת">
        {sidebar}
      </aside>

      {/* מגירת המובייל — מוצגת רק כשנפתחת, ומעליה שכבת כיסוי לסגירה */}
      {menuOpen ? (
        <>
          <button
            type="button"
            className="mv-scrim"
            aria-label="סגירת התפריט"
            onClick={() => setMenuOpen(false)}
          />
          <aside
            ref={drawerRef}
            className="mv-sidebar mv-sidebar--drawer"
            role="dialog"
            aria-modal="true"
            aria-label="תפריט המערכת"
          >
            {sidebar}
          </aside>
        </>
      ) : null}

      <div className="mv-main">
        <header className="mv-topbar">
          {/* aria-label קבוע: מתחת ל-640px התווית הוויזואלית מוסתרת,
              וקורא מסך חייב שם נגיש שאינו תלוי ברוחב (ביקורת Codex) */}
          <button
            ref={menuButtonRef}
            type="button"
            className="mv-menu-button"
            aria-label="תפריט"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
          >
            <IconMenu s={15} />
            <span className="mv-topbar-label" aria-hidden="true">תפריט</span>
          </button>

          {/* לא h1 — הכותרת הסמנטית של הדף נמצאת בתוכן עצמו */}
          <p className="mv-screen-title">{screenTitle(pathname)}</p>

          <TopbarSearch />

          <div className="mv-topbar-end">
            <NotificationsBell />

          {/* קליטה קולית נחסמת בשרת בלי הפיצ'ר — קישור ל-403 גרוע
              מקישור שלא קיים */}
          {hasFeature("voice_intake") ? (
              <Link href="/voice" className="mv-voice-button" aria-label="פקודה קולית">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="9" y="2.5" width="6" height="11" rx="3" />
                  <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
                  <line x1="12" y1="17.5" x2="12" y2="21" />
                </svg>
                <span className="mv-topbar-label">פקודה קולית</span>
              </Link>
          ) : null}

            <Link href="/profile" className="mv-icon-button" aria-label="הפרופיל שלי" title="הפרופיל שלי">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="8" r="3.5" />
                <path d="M4.5 20c0-3.6 3.4-6 7.5-6s7.5 2.4 7.5 6" />
              </svg>
            </Link>
          </div>
        </header>

        <main id="main-content" className="mv-content">
          <TrialBanner trialEndsAt={me?.trialEndsAt} />
          <WhatsNewBanner />
          {/*
            הסופטפון עוטף מבפנים ל-FeaturesProvider כי הוא נשען על
            `useFeature("telephony")`. פס השיחה עצמו ממוקם `fixed`,
            ולכן העטיפה כאן אינה כולאת אותו בתוך אזור התוכן.
          */}
          <FeaturesProvider features={features}>
            <SoftphoneProvider>{children}</SoftphoneProvider>
          </FeaturesProvider>
        </main>
      </div>
    </div>
  );
}
