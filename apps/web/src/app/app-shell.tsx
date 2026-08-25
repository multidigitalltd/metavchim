"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api";
import { resetA11ySync } from "@/lib/a11y-sync";
import { clearSessionCache, fetchMe } from "@/lib/session-cache";
import type { AuthUser } from "@/lib/use-auth";
import { FeaturesProvider } from "@/lib/use-features";
import { NotificationsBell } from "./notifications-bell";
import { TopbarSearch } from "./topbar-search";
import { WhatsNewBanner } from "./whats-new-banner";
import { TrialBanner } from "./trial-banner";
import { SoftphoneProvider } from "./softphone-bar";
import { FeedbackButton } from "./feedback-button";
import { SupportButton } from "./support-button";
import { SingleSessionGuard } from "./single-session-guard";
import { roleLabel } from "@metavchim/shared";
import { IconMenu, LogoMark } from "./icons";
import { OfficeLogoMark } from "./office-logo-mark";

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
  // טופס „מה אתם מחפשים” שהלקוח ממלא — אותו נימוק בדיוק
  "/f/",
  // מסמכים ציבוריים — מקושרים מאתר התדמית ומדף ההצעה, ונקראים גם
  // ע"י מי שאינו משתמש רשום (לקוח קצה שקיבל הצעה, משרד ששוקל להצטרף)
  "/accessibility",
  "/privacy",
  "/terms",
  // תיעוד הקליטה — נקרא בידי מי שמחבר מקור, ולעיתים קרובות בכלל
  // לא בידי משתמש רשום: מפתח של המשרד, או מודל שפה שקורא את העמוד
  "/docs",
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
  ["/kanko", "קונים - kanko"],
  ["/settings", "ניהול משרד"],
  ["/setup", "הקמה"],
  ["/platform", "פלטפורמה"],
  ["/voice", "קליטה בקול"],
  ["/notifications", "התראות"],
  ["/search", "חיפוש"],
  ["/profile", "הפרופיל שלי"],
  ["/tasks", "משימות"],
  ["/guides", "הדרכות"],
  ["/forum", "פורום"],
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
  /* המנטור — ניצוץ ולב: ליווי אישי, לא עוד מסך נתונים */
  mentor: (
    <Icon>
      <path d="M12 3l1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7z" />
      <path d="M17.5 15.5a2 2 0 0 0-2.8 0l-.7.7-.7-.7a2 2 0 1 0-2.8 2.8l3.5 3.5 3.5-3.5a2 2 0 0 0 0-2.8z" />
    </Icon>
  ),
  platform: (
    <Icon>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
    </Icon>
  ),
};

/*
 * „מנהל” היה כאן רשימת תפקידים אחת — `["owner","admin"]` — ששלטה
 * בשלושה פריטים שונים בסרגל: „דוחות”, „ניהול משרד” ו„הקמה”.
 *
 * הצירוף הזה נכון רק כל עוד כל מי שרואה דוחות גם מגדיר את המשרד.
 * מנהל סניף שובר אותו: יש לו `analytics.view` ואין לו
 * `settings.manage`, ורשימה אחת הייתה נותנת לו את שניהם או שוללת
 * את שניהם.
 *
 * לכן כל פריט נבדק מול היכולת שהמסך שמאחוריו באמת דורש — וזו גם
 * היכולת שהשרת אוכף עליו, כך שהסרגל אינו יכול להבטיח מסך שיחזיר
 * 403.
 */

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
const NAV_MODULE: Record<string, readonly string[]> = {
  "/properties": ["properties"],
  "/buyers": ["buyers"],
  "/leads": ["leads"],
  /*
   * שיחות שייכות לשני מודולים: שיחה תלויה בלקוח, ולקוח הוא ליד או
   * קונה. סיווג לליד בלבד הוריד את הפריט מהסרגל למי שמודול הלידים
   * חסום אצלו — אף שהמסך פתוח לו בזכות הקונים, והוא הגיע אליו רק
   * דרך קישור עמוק (ביקורת Codex).
   */
  "/calls": ["leads", "buyers"],
  "/matches": ["matches"],
  "/offers": ["offers"],
  "/calendar": ["calendar"],
  "/tasks": ["calendar"],
  "/collaboration": ["collaboration"],
  "/reports": ["reports"],
  "/settings": ["admin"],
  "/setup": ["admin"],
};

/**
 * הזהות כפי שהמעטפת צריכה אותה.
 *
 * כינוי ל-`AuthUser` ולא הצהרה שנייה: שני הצרכנים קוראים את אותה
 * תשובה מ-`/auth/me` ומאותו מטמון, ושתי הצהרות חלקיות היו נבדלות
 * בשקט — בדיוק הדפוס שגרם לעמלת ההפניה להיות מוצגת 15% ונגבית 10%.
 */
type Me = AuthUser;

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
  /*
   * כישלון בהבאת `/nav/summary` נשמר בנפרד מהתוצאה.
   *
   * `counts` מתאפס ל-`null` בארבעה מצבים שונים — טרם נטען, מסך
   * ציבורי, משתמש בחיוב בלבד, וכישלון — ורשימת היכולות נגזרת ממנו.
   * צרכן שממתין לרשימה אינו יכול להבדיל ביניהם, ולכן כישלון נראה לו
   * כמו המתנה שלא נגמרת (ביקורת Codex). רק הכישלון מסומן כאן.
   */
  const [featuresFailed, setFeaturesFailed] = useState(false);
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
    fetchMe()
      .then((user) => {
        if (!cancelled) setMe(user);
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
    if (
      isPublic ||
      me === null ||
      me.billingOnly === true ||
      me.capabilities?.includes("settings.manage") !== true
    ) {
      return;
    }
    /*
     * נשאל בכל ניווט **כל עוד ההקמה לא הושלמה**, ומפסיק לצמיתות
     * ברגע שהיא הושלמה.
     *
     * שני הכיוונים נדרשים. בלי העצירה, כל מעבר מסך שילם על שאלה
     * שהתשובה שלה כבר ידועה — `ready` אינו חוזר להיות false. אבל
     * עצירה אחרי התשובה הראשונה בלבד שוברת את הכיוון השני: המשרד
     * משלים את ההקמה במסך אחר, ה-AppShell שורד את הניווט, ולשונית
     * ההקמה נשארת לנצח (ביקורת Codex).
     */
    if (setupDone) return;
    apiGet<{ ready: boolean }>("/settings/onboarding")
      .then((p) => setSetupDone(p.ready))
      .catch(() => undefined);
  }, [isPublic, me, pathname, setupDone]);

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
      setFeaturesFailed(false);
      return;
    }
    if (me?.billingOnly === true) {
      setCounts(null);
      setFeaturesFailed(false);
      return;
    }
    let cancelled = false;
    /*
     * ‎**הדגל מתאפס בפתיחת הניסיון, לא בסיומו.**
     *
     * אחרת כישלון במסך אחד נשאר דולק לאורך כל המעבר למסך הבא, ובחלון
     * הזה צרכן שמפרש „לא ייוודע” כרשות לפעול יוצא לרשת על סמך מידע
     * ישן — ומקבל 403 שנרשם כתקלה (ביקורת Codex). מרגע שבקשה חדשה
     * באוויר המצב הוא „עוד לא ידוע”, וזו האמת.
     */
    setFeaturesFailed(false);
    apiGet<NavSummary>("/nav/summary")
      .then((summary) => {
        if (!cancelled) setCounts(summary);
      })
      .catch(() => {
        if (!cancelled) {
          setCounts(null);
          setFeaturesFailed(true);
        }
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
              clearSessionCache();
              resetA11ySync();
              void apiPost("/auth/logout", {})
                .catch(() => undefined)
                .finally(() => window.location.assign("/login"));
            }}
          >
            יציאה
          </button>
        </header>
        <main id="main-content">{children}</main>
        {/*
          גם כאן. משרד שתקופתו נגמרה חסום מכל מסך עבודה, וזה בדיוק
          המצב שבו הוא הכי צריך לדבר עם מישהו — תמיכה שנסגרת יחד עם
          המנוי משאירה בעיית תשלום בלי דרך לפתור אותה.
        */}
        <SupportButton />
        <FeedbackButton />
      </div>
    );
  }

  const hasCapability = (capability: string): boolean =>
    me?.capabilities?.includes(capability) ?? false;
  /* „ניהול משרד” ו„הקמה” — מי שמגדיר את המשרד */
  const managesOffice = hasCapability("settings.manage");
  /* „דוחות” — מי שמורשה לקרוא את התמונה העסקית */
  const seesReports = hasCapability("analytics.view");

  const navLink = (
    href: string,
    label: string,
    icon: ReactNode,
    end?: ReactNode,
  ): ReactNode => {
    /*
     * מודול חסום — הפריט יורד מהסרגל, ולא מוצג ומוביל ל-403. פריט
     * ששייך לכמה מודולים יורד רק כששולליהם **כולם** חסומים: די
     * במודול אחד פתוח כדי שיהיה שם מה לראות.
     */
    const modules = NAV_MODULE[href];
    const blocked = counts?.blockedModules ?? [];
    if (modules !== undefined && modules.every((m) => blocked.includes(m))) return null;
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
        {/*
          הלוגו של המשרד מתחת לזה של המערכת ולא במקומו: המערכת אחת
          וכל משרד הוא דייר בה, והחלפת המותג הראשי הייתה מבלבלת
          בדיוק את מי שעובר בין שני משרדים. נעלם בשקט למי שלא העלה.
        */}
        <OfficeLogoMark />
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
          השת"פים צמודים למשימות ולא מתחת לכותרת "רשת" משלהם.

          הכותרת יצרה קטגוריה נפרדת, וקטגוריה נפרדת אומרת "זה משהו
          אחר" — בזמן שבפועל זו עבודה יומיומית של הסוכן, באותה תדירות
          בדיוק כמו לידים, התאמות ומשימות. מסך שיושב מתחת לכותרת
          משלו נפתח פעם בשבוע; מסך שיושב ברצף נפתח כל יום.

          יתרת הקרדיטים ישבה כאן פעם, צמודה לשת"פ — וזה בדיוק מה
          שלימד את המתווכים ששיתוף פעולה עולה כסף. שיתוף פעולה חינם;
          קרדיטים נוגעים אך ורק לקליטת הפניית לקוח, והיתרה עברה
          ללשונית "הפניות לקוחות" שם היא באמת רלוונטית.

          בלי שער מסלול — השת"פ הבסיסי פתוח בכל המסלולים.
        */}
        {navLink("/collaboration", 'שת"פים', ICONS.coop)}
        {/* קונים מפולחים מ-Kanko — עמוד "בקרוב" עד ההשקה (בקשת המשתמש) */}
        {navLink(
          "/kanko",
          "קונים - kanko",
          ICONS.buyers,
          <span className="mv-nav-soon">בקרוב</span>,
        )}
        {seesReports && hasFeature("analytics")
          ? navLink("/reports", "דוחות", ICONS.reports)
          : null}
        {navLink("/guides", "הדרכות", ICONS.guides)}
        {/* פורום מקצועי — עמוד "בקרוב" עד ההשקה (בקשת המשתמש) */}
        {navLink(
          "/forum",
          "פורום",
          ICONS.buyers,
          <span className="mv-nav-soon">בקרוב</span>,
        )}
        {/*
          המנטור האישי — עמוד "בקרוב" עד ההשקה (בקשת המשתמש).
          התג AI מסמן שזה פיצ'ר של בינה מלאכותית ולא עוד מסך נתונים.
        */}
        {navLink(
          "/mentor",
          "המנטור האישי שלך",
          ICONS.mentor,
          <span className="mv-nav-ai">AI</span>,
        )}
        {managesOffice ? navLink("/settings", "ניהול משרד", ICONS.office) : null}
        {managesOffice && !setupDone ? navLink("/setup", "הקמה", ICONS.setup) : null}
        {me?.isPlatformAdmin ? navLink("/platform", "פלטפורמה", ICONS.platform) : null}
      </nav>

      {me ? (
        <Link href="/profile" className="mv-sidebar-user" aria-label={`הפרופיל של ${me.name}`}>
          <span className="mv-avatar" aria-hidden="true">
            {initials(me.name)}
          </span>
          <span className="min-w-0">
            <span className="mv-sidebar-user-name">{me.name}</span>
            <span className="mv-sidebar-user-role">{roleLabel(me.role)}</span>
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
            <NotificationsBell user={me} />

          {/* קליטה קולית נחסמת בשרת בלי הפיצ'ר — קישור ל-403 גרוע
              מקישור שלא קיים */}
          {hasFeature("voice_intake") ? (
              <Link href="/voice" className="mv-voice-button" aria-label="הסוכן הקולי">
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
                <span className="mv-topbar-label">הסוכן הקולי</span>
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
          {/* חיבור אחד לחשבון — הדיאלוג חוסם עד בחירה; ראו ההסבר ברכיב */}
          <SingleSessionGuard />
          <TrialBanner trialEndsAt={me?.trialEndsAt} />
          <WhatsNewBanner />
          {/*
            הסופטפון עוטף מבפנים ל-FeaturesProvider כי הוא נשען על
            `useFeature("telephony")`. פס השיחה עצמו ממוקם `fixed`,
            ולכן העטיפה כאן אינה כולאת אותו בתוך אזור התוכן.
          */}
          <FeaturesProvider features={features} failed={featuresFailed}>
            <SoftphoneProvider>{children}</SoftphoneProvider>
          </FeaturesProvider>
        </main>
        {/*
          כפתור התמיכה מחוץ ל-main ולכן בכל מסך פנימי, בלי תלות
          במסלול או ביכולת: מי שנתקל בתקלה הוא זה שמדווח עליה.
        */}
        <SupportButton />
        <FeedbackButton />
      </div>
    </div>
  );
}
