"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { apiGet } from "@/lib/api";
import { NotificationsBell } from "./notifications-bell";
import { UserMenu } from "./user-menu";
import { WhatsNewBanner } from "./whats-new-banner";

/**
 * כותרת האתר — מוסתרת לגמרי במסכים ציבוריים: התחברות, החלפת סיסמה,
 * ודף ההצעה ללקוח קצה (הקונה של המשרד לא אמור לראות תפריטי מתווך).
 */

const PUBLIC_PREFIXES = [
  "/login",
  "/offer/",
  "/change-password",
  "/forgot-password",
  "/reset-password",
];

const NAV_ITEMS = [
  { href: "/", label: "דשבורד" },
  { href: "/voice", label: "🎤 קול" },
  { href: "/properties", label: "נכסים" },
  { href: "/buyers", label: "קונים" },
  { href: "/leads", label: "לידים" },
  { href: "/matches", label: "התאמות" },
  { href: "/calendar", label: "יומן" },
  { href: "/collaboration", label: "שיתופי פעולה" },
  { href: "/reports", label: "דוחות" },
  { href: "/settings", label: "הגדרות" },
  { href: "/setup", label: "הקמה" },
] as const;

/** מסך ניהול הפלטפורמה — מוצג רק למי שמורשה (ה-API מחזיר 403 לאחרים) */
const PLATFORM_ITEM = { href: "/platform", label: "פלטפורמה" } as const;

export function SiteHeader() {
  const pathname = usePathname();
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);

  useEffect(() => {
    if (isPublic) return;
    apiGet<{ user: { isPlatformAdmin?: boolean } }>("/auth/me")
      .then((res) => setIsPlatformAdmin(res.user.isPlatformAdmin === true))
      .catch(() => undefined);
  }, [isPublic]);

  if (isPublic) return null;

  const navItems = isPlatformAdmin ? [...NAV_ITEMS, PLATFORM_ITEM] : [...NAV_ITEMS];

  return (
    <>
      <header className="mv-header sticky top-0 z-30 border-b" style={{ borderColor: "var(--color-border)" }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <a href="/" className="text-lg font-bold" style={{ color: "var(--color-primary)" }}>
            מתווכים <span className="mv-visually-hidden">— חזרה לדשבורד</span>
          </a>

          <div className="flex items-center gap-2">
            {/* דסקטופ: הניווט המלא בשורה אחת */}
            <nav aria-label="ניווט ראשי" className="hidden md:block">
              <ul className="flex flex-wrap items-center gap-1">
                {navItems.map((item) => (
                  <li key={item.href}>
                    <a
                      href={item.href}
                      className="mv-nav-link inline-block rounded-lg px-3 py-2"
                      aria-current={
                        pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href))
                          ? "page"
                          : undefined
                      }
                    >
                      {item.label}
                    </a>
                  </li>
                ))}
                <li>
                  <form action="/search" role="search" className="flex">
                    <label htmlFor="global-q" className="mv-visually-hidden">
                      חיפוש לפי טלפון, שם או כתובת
                    </label>
                    <input
                      id="global-q"
                      name="q"
                      type="search"
                      required
                      minLength={2}
                      maxLength={80}
                      placeholder="🔍 חיפוש…"
                      className="w-28 rounded-lg border px-2 py-1.5 focus:w-44"
                      style={{
                        borderColor: "var(--color-border)",
                        background: "var(--color-surface)",
                        transition: "width 150ms",
                      }}
                    />
                  </form>
                </li>
              </ul>
            </nav>

            {/* פעמון + משתמש — מופע אחד, בכל הרזולוציות */}
            <NotificationsBell />
            <UserMenu />

            {/* מובייל: הניווט בתפריט ☰ (details — בלי JS; המעבר בין
                עמודים הוא ניווט מלא, כך שהתפריט נסגר מעצמו) */}
            <details className="relative md:hidden">
              <summary
                className="mv-mobile-menu-button flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center rounded-lg border text-xl"
                style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
              >
                <span aria-hidden="true">☰</span>
                <span className="mv-visually-hidden">תפריט ניווט</span>
              </summary>
              <nav aria-label="ניווט ראשי">
                <ul
                  className="absolute end-0 top-full z-20 mt-2 flex w-56 max-w-[calc(100vw-2rem)] flex-col gap-1 rounded-xl border p-2 shadow-lg"
                  style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
                >
                  <li>
                    <form action="/search" role="search" className="p-1">
                      <label htmlFor="global-q-mobile" className="mv-visually-hidden">
                        חיפוש לפי טלפון, שם או כתובת
                      </label>
                      <input
                        id="global-q-mobile"
                        name="q"
                        type="search"
                        required
                        minLength={2}
                        maxLength={80}
                        placeholder="🔍 חיפוש…"
                        className="w-full rounded-lg border px-2 py-1.5"
                        style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
                      />
                    </form>
                  </li>
                  {navItems.map((item) => (
                    <li key={item.href}>
                      <a href={item.href} className="mv-nav-link block rounded-lg px-3 py-2.5">
                        {item.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            </details>
          </div>
        </div>
      </header>
      <WhatsNewBanner />
    </>
  );
}
