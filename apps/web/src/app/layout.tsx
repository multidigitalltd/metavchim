import type { Metadata, Viewport } from "next";
import { SkipLink } from "@metavchim/ui";
import { AccessibilityRuntime } from "./a11y-toolbar";
import { AppShell } from "./app-shell";
import { THEME_INIT_SCRIPT } from "./theme-toggle";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "מתווכים — מערכת ניהול למשרדי תיווך",
    template: "%s · מתווכים",
  },
  description: "המתווך סוגר עסקאות. המערכת מטפלת בכל השאר.",
  manifest: "/manifest.webmanifest",
  robots: { index: false }, // אפליקציה פנימית — לא לאינדוקס
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0F8A43" },
    { media: "(prefers-color-scheme: dark)", color: "#0d130f" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <head>
        {/* יישום ערכת הנושא לפני הצביעה הראשונה — בלי זה מסך כהה
            שנבחר ידנית היה מהבהב בלבן בכל טעינת דף */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <SkipLink targetId="main-content" />
        {/* הצהרת הנגישות מופיעה באתר התדמית, לא בתוך המערכת —
            עמוד /accessibility נשאר זמין בכתובת ישירה לקישור משם */}
        <AppShell>{children}</AppShell>
        <AccessibilityRuntime />
      </body>
    </html>
  );
}
