"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { apiGet } from "@/lib/api";
import { NotificationsBell } from "./notifications-bell";
import { TopbarSearch } from "./topbar-search";
import { WhatsNewBanner } from "./whats-new-banner";

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

const PUBLIC_PREFIXES = [
  "/login",
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
  ["/buyers", "קונים"],
  ["/leads", "לידים"],
  ["/calls", "שיחות"],
  ["/matches", "התאמות"],
  ["/offers", "הצעות"],
  ["/calendar", "יומן"],
  ["/reports", "דוחות"],
  ["/collaboration", 'שת"פ בין משרדים'],
  ["/settings", "ניהול משרד"],
  ["/setup", "הקמה"],
  ["/platform", "פלטפורמה"],
  ["/voice", "קליטה בקול"],
  ["/notifications", "התראות"],
  ["/search", "חיפוש"],
  ["/profile", "הפרופיל שלי"],
  ["/tasks", "משימות"],
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
  credits: number | null;
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

interface Me {
  name: string;
  role: string;
  tenantName?: string;
  isPlatformAdmin?: boolean;
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

  useEffect(() => {
    if (isPublic) return;
    apiGet<{ user: Me }>("/auth/me")
      .then((res) => setMe(res.user))
      .catch(() => undefined);
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
    if (isPublic || me === null || !MANAGER_ROLES.has(me.role)) return;
    apiGet<{ ready: boolean }>("/settings/onboarding")
      .then((p) => setSetupDone(p.ready))
      .catch(() => undefined);
  }, [isPublic, me, pathname]);

  /* המונים מתרעננים במעבר מסך — פעולה במסך אחד (קליטת ליד) צריכה
     להשתקף בתג כשעוברים הלאה, בלי Polling קבוע */
  useEffect(() => {
    if (isPublic) return;
    apiGet<NavSummary>("/nav/summary")
      .then(setCounts)
      .catch(() => undefined);
  }, [isPublic, pathname]);

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

  if (isPublic) {
    return <main id="main-content" className="mx-auto max-w-6xl px-4 py-6">{children}</main>;
  }

  const isManager = me !== null && MANAGER_ROLES.has(me.role);

  const navLink = (
    href: string,
    label: string,
    icon: ReactNode,
    end?: ReactNode,
  ): ReactNode => {
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

  const sidebar = (
    <>
      <div className="mv-sidebar-head">
        <div className="mv-logo">
          מתווכים<span style={{ color: "var(--color-action)" }}>.</span>
        </div>
        <div className="mv-sidebar-sub">{me?.tenantName ?? " "}</div>
      </div>

      <nav aria-label="ניווט ראשי" className="mv-sidebar-nav">
        {navLink("/", "דשבורד", ICONS.dashboard)}
        {navLink("/properties", "נכסים", ICONS.properties, count(counts?.properties))}
        {navLink("/buyers", "קונים", ICONS.buyers, count(counts?.buyers))}
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
        {isManager && hasFeature("analytics")
          ? navLink("/reports", "דוחות", ICONS.reports)
          : null}

        {hasFeature("collaboration") ? (
          <>
            <div className="mv-nav-group">רשת</div>
            {navLink(
              "/collaboration",
              'שת"פ בין משרדים',
              ICONS.coop,
              counts?.credits !== null && counts?.credits !== undefined ? (
                <span className="mv-nav-credits">{counts.credits} קרדיטים</span>
              ) : null,
            )}
          </>
        ) : null}
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
          <button
            ref={menuButtonRef}
            type="button"
            className="mv-menu-button"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
          >
            <span aria-hidden="true">☰</span> תפריט
          </button>

          {/* לא h1 — הכותרת הסמנטית של הדף נמצאת בתוכן עצמו */}
          <p className="mv-screen-title">{screenTitle(pathname)}</p>

          <TopbarSearch />

          <div className="mv-topbar-end">
            <NotificationsBell />

            <Link href="/voice" className="mv-voice-button">
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
              קליטה בקול
            </Link>

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
          <WhatsNewBanner />
          {children}
        </main>
      </div>
    </div>
  );
}
