import type { Metadata, Viewport } from "next";
import { SkipLink } from "@metavchim/ui";
import { AccessibilityToolbar } from "./a11y-toolbar";
import { NotificationsBell } from "./notifications-bell";
import { UserMenu } from "./user-menu";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "מערכת 360 למתווכים",
    template: "%s · מערכת 360 למתווכים",
  },
  description: "המתווך סוגר עסקאות. המערכת מטפלת בכל השאר.",
  manifest: "/manifest.webmanifest",
  robots: { index: false }, // אפליקציה פנימית — לא לאינדוקס
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#1d4ed8" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1522" },
  ],
};

const NAV_ITEMS = [
  { href: "/", label: "דשבורד" },
  { href: "/properties", label: "נכסים" },
  { href: "/buyers", label: "קונים" },
  { href: "/leads", label: "לידים" },
  { href: "/matches", label: "התאמות" },
  { href: "/calendar", label: "יומן" },
  { href: "/collaboration", label: "שיתופי פעולה" },
  { href: "/reports", label: "דוחות" },
  { href: "/settings", label: "הגדרות" },
] as const;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body>
        <SkipLink targetId="main-content" />
        <header className="border-b" style={{ borderColor: "var(--color-border)" }}>
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
            <a href="/" className="text-lg font-bold">
              מערכת 360 <span className="mv-visually-hidden">— חזרה לדשבורד</span>
            </a>
            <nav aria-label="ניווט ראשי">
              <ul className="flex flex-wrap items-center gap-1">
                {NAV_ITEMS.map((item) => (
                  <li key={item.href}>
                    <a
                      href={item.href}
                      className="inline-block rounded-md px-3 py-2 hover:underline"
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
                      className="w-28 rounded-md border px-2 py-1.5 focus:w-44"
                      style={{
                        borderColor: "var(--color-border)",
                        background: "var(--color-surface)",
                        transition: "width 150ms",
                      }}
                    />
                  </form>
                </li>
                <li>
                  <NotificationsBell />
                </li>
                <li>
                  <UserMenu />
                </li>
              </ul>
            </nav>
          </div>
        </header>
        <main id="main-content" className="mx-auto max-w-6xl px-4 py-6">
          {children}
        </main>
        <footer className="mx-auto max-w-6xl px-4 py-6 text-sm" style={{ color: "var(--color-text-muted)" }}>
          <a href="/accessibility" className="underline">
            הצהרת נגישות
          </a>
        </footer>
        <AccessibilityToolbar />
      </body>
    </html>
  );
}
