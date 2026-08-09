"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Capability } from "@metavchim/shared";
import { apiGet, ApiError } from "./api";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  mustChangePassword: boolean;
  /** שם המשרד — מגיע עם ה-Session, מוצג בפרופיל ובסרגל הצד */
  tenantName?: string;
  isPlatformAdmin?: boolean;
  /**
   * היכולות בפועל של המשתמש — מה שהשרת יאשר, כולל חריגים אישיים.
   *
   * אופציונלי כדי לא לשבור מסך שנטען מול שרת ישן; `can()` מטפל
   * בחוסר בשמרנות (ברירת מחדל: אין הרשאה).
   */
  capabilities?: string[];
}

/**
 * האם למשתמש יש את היכולת בפועל.
 *
 * **לא לגזור הרשאות מ-`ROLE_CAPABILITIES[user.role]`.** זו ברירת
 * המחדל של התפקיד, ומאז שיש חריגים ברמת המשתמש (#80) היא כבר לא מה
 * שהשרת אוכף: סוכן שנחסמה לו יכולת היה רואה כפתור ומקבל 403, ו-viewer
 * שקיבל יכולת לא היה רואה אותו בכלל (ביקורת Codex).
 *
 * בלי משתמש ובלי רשימה — התשובה שלילית. מסך שמסתיר כפתור בטעות הוא
 * תקלה; מסך שמציג כפתור שייכשל הוא הבטחה שבורה.
 */
export function can(user: AuthUser | null, capability: Capability): boolean {
  return user?.capabilities?.includes(capability) ?? false;
}

/** שומר עמוד מוגן: בלי Session תקף — הפניה ל-/login. */
export function useRequireAuth(): { user: AuthUser | null; loading: boolean } {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiGet<{ user: AuthUser }>("/auth/me")
      .then((res) => {
        if (cancelled) return;
        // סיסמה זמנית — חובה להחליף לפני כל פעולה אחרת (ביקורת Codex)
        if (res.user.mustChangePassword && window.location.pathname !== "/change-password") {
          router.replace("/change-password");
          return;
        }
        setUser(res.user);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          router.replace("/login");
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  return { user, loading };
}
