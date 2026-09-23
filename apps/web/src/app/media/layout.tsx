"use client";

import { useRequireAuth } from "@/lib/use-auth";
import { MediaComingSoon } from "./coming-soon";

/**
 * שער תצוגה מקדימה — רכש מדיה פתוח למנהל הפלטפורמה בלבד.
 *
 * ‏עוטף את כל `/media/*` (הארכיון, העמוד הפנימי, ההזמנות ודף החזרה)
 * במקום אחד: מי שאינו מנהל הפלטפורמה רואה „בקרוב” ואינו מגיע למסכים
 * עצמם — ולכן גם לא לקריאות ה-API שלהם. השרת אוכף את אותו כלל
 * ב-`MediaPreviewGuard`; זה כאן כדי שהמסך יגיד את האמת ולא 403.
 *
 * ‏להשקה: מוחקים את הקובץ הזה ואת `coming-soon.tsx`, את התג בתפריט
 * (web ונייד) ואת השער בשרת. הנייד מציג את ה-web המוטמע, ולכן השער
 * הזה מכסה גם אותו.
 */
export default function MediaPreviewLayout({ children }: { children: React.ReactNode }): React.JSX.Element | null {
  const { user, loading } = useRequireAuth();
  if (loading) return null;
  if (user?.isPlatformAdmin !== true) return <MediaComingSoon />;
  return <>{children}</>;
}
