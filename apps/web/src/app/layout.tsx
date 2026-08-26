import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { SkipLink } from "@metavchim/ui";
import { AccessibilityRuntime } from "./a11y-toolbar";
import { AppShell } from "./app-shell";
import { GlobalDictation } from "./global-dictation";
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
  /*
   * ‎**ערך ישיר, וכאן זה נכון — ‎ערך-מפורש-במכוון.**
   *
   * ‎`theme-color` הוא תגית `meta` שהדפדפן קורא **לפני** שיש CSS.
   * ‎`var(--color-primary-accent)` שם אינו ערך אלא מחרוזת חסרת
   * מובן, ולכן זה המקום היחיד בעץ שחייב את המספר עצמו. שתי השורות
   * כבר מכסות את שתי הערכות בעצמן, וזו הסיבה שאין כאן מה לתקן.
   *
   * הערכים מכוונים ל-`--color-primary-accent` ול-`--dk-bg`; שינוי
   * שם מחייב שינוי כאן, ואין דרך לאכוף את זה מלבד השורה הזו.
   */
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0F8A43" },
    { media: "(prefers-color-scheme: dark)", color: "#0d130f" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  /*
   * ה-Nonce שנוצר ב-Middleware. בלעדיו סקריפט ערכת הנושא ייחסם
   * ע"י CSP, והמסך יהבהב בלבן בכל טעינה אצל מי שבחר מצב כהה.
   */
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="he" dir="rtl">
      <head>
        {/* יישום ערכת הנושא לפני הצביעה הראשונה — בלי זה מסך כהה
            שנבחר ידנית היה מהבהב בלבן בכל טעינת דף */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <SkipLink targetId="main-content" />
        {/* הצהרת הנגישות מופיעה באתר התדמית, לא בתוך המערכת —
            עמוד /accessibility נשאר זמין בכתובת ישירה לקישור משם */}
        <AppShell>{children}</AppShell>
        <AccessibilityRuntime />
        {/* מיקרופון בכל שדה טקסט — צץ מתחת לשדה שבפוקוס */}
        <GlobalDictation />
      </body>
    </html>
  );
}
