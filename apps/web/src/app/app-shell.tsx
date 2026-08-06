"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { apiGet } from "@/lib/api";
import { NotificationsBell } from "./notifications-bell";
import { UserMenu } from "./user-menu";
import { WhatsNewBanner } from "./whats-new-banner";

/**
 * מעטפת האפליקציה לפי קובץ העיצוב: סרגל צד כהה עם ניווט אנכי, ושורת
 * כותרת עליונה עם התראות וכניסה מהירה לקליטה בקול.
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
  "/change-password",
  "/forgot-password",
  "/reset-password",
];

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
}

/** אייקוני קו דקים, בסגנון קובץ העיצוב. */
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

const NAV_ITEMS: NavItem[] = [
  {
    href: "/",
    label: "דשבורד",
    icon: (
      <Icon>
        <rect x="3" y="3" width="8" height="8" rx="2" />
        <rect x="13" y="3" width="8" height="8" rx="2" />
        <rect x="3" y="13" width="8" height="8" rx="2" />
        <rect x="13" y="13" width="8" height="8" rx="2" />
      </Icon>
    ),
  },
  {
    href: "/properties",
    label: "נכסים",
    icon: (
      <Icon>
        <path d="M3 10.5 12 3l9 7.5" />
        <path d="M5 9.5V21h14V9.5" />
      </Icon>
    ),
  },
  {
    href: "/buyers",
    label: "קונים",
    icon: (
      <Icon>
        <circle cx="9" cy="8" r="3.2" />
        <path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
        <path d="M17 11.5a3 3 0 1 0-1.5-5.6" />
      </Icon>
    ),
  },
  {
    href: "/leads",
    label: "לידים",
    icon: (
      <Icon>
        <path d="M4 5h16v11H7l-3 3z" />
      </Icon>
    ),
  },
  {
    href: "/matches",
    label: "התאמות",
    icon: (
      <Icon>
        <path d="M4 8h9l-2.5-2.5" />
        <path d="M20 16h-9l2.5 2.5" />
      </Icon>
    ),
  },
  {
    href: "/offers",
    label: "הצעות",
    icon: (
      <Icon>
        <rect x="4" y="3" width="16" height="18" rx="2.5" />
        <path d="M8 8h8M8 12h8M8 16h5" />
      </Icon>
    ),
  },
  {
    href: "/calendar",
    label: "יומן",
    icon: (
      <Icon>
        <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
        <path d="M3.5 10h17M8 3v4M16 3v4" />
      </Icon>
    ),
  },
  {
    href: "/reports",
    label: "דוחות",
    icon: (
      <Icon>
        <path d="M5 20V10M12 20V4M19 20v-7" />
      </Icon>
    ),
  },
  {
    href: "/collaboration",
    label: 'שת"פ בין משרדים',
    icon: (
      <Icon>
        <circle cx="7" cy="12" r="3" />
        <circle cx="17" cy="12" r="3" />
        <path d="M10 12h4" />
      </Icon>
    ),
  },
  {
    href: "/settings",
    label: "ניהול משרד",
    icon: (
      <Icon>
        <circle cx="12" cy="12" r="3" />
        <circle cx="12" cy="12" r="8" />
      </Icon>
    ),
  },
  {
    href: "/setup",
    label: "הקמה",
    icon: (
      <Icon>
        <path d="M20 6 9 17l-5-5" />
      </Icon>
    ),
  },
];

const PLATFORM_ITEM: NavItem = {
  href: "/platform",
  label: "פלטפורמה",
  icon: (
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
  const [menuOpen, setMenuOpen] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isPublic) return;
    apiGet<{ user: Me }>("/auth/me")
      .then((res) => setMe(res.user))
      .catch(() => undefined);
  }, [isPublic]);

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

  const navItems = me?.isPlatformAdmin ? [...NAV_ITEMS, PLATFORM_ITEM] : NAV_ITEMS;

  const sidebar = (
    <>
      <div className="mv-sidebar-head">
        <div className="mv-logo">
          מתווכים<span style={{ color: "var(--color-action)" }}>.</span>
        </div>
        <div className="mv-sidebar-sub">{me?.tenantName ?? " "}</div>
      </div>

      <nav aria-label="ניווט ראשי" className="mv-sidebar-nav">
        {navItems.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className="mv-sidebar-link"
              aria-current={active ? "page" : undefined}
            >
              {item.icon}
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {me ? (
        <div className="mv-sidebar-user">
          <span className="mv-avatar" aria-hidden="true">
            {initials(me.name)}
          </span>
          <span className="min-w-0">
            <span className="mv-sidebar-user-name">{me.name}</span>
            <span className="mv-sidebar-user-role">{ROLE_LABELS[me.role] ?? me.role}</span>
          </span>
        </div>
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

          <Link href="/voice" className="mv-button mv-button--primary mv-voice-button">
            <span aria-hidden="true">🎤</span> קליטה בקול
          </Link>

          <div className="mv-topbar-end">
            <NotificationsBell />
            <UserMenu />
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
