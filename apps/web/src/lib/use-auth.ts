"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Capability } from "@metavchim/shared";
import { ApiError } from "./api";
import { cachedUser, clearSessionCache, fetchMe } from "./session-cache";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  mustChangePassword: boolean;
  /** שם המשרד — מגיע עם ה-Session, מוצג בפרופיל ובסרגל הצד */
  tenantName?: string;
  /** האם למשרד יש לוגו — הסרגל מבקש את הקובץ רק אם כן */
  tenantHasLogo?: boolean;
  isPlatformAdmin?: boolean;
  /**
   * היכולות בפועל של המשתמש — מה שהשרת יאשר, כולל חריגים אישיים.
   *
   * אופציונלי כדי לא לשבור מסך שנטען מול שרת ישן; `can()` מטפל
   * בחוסר בשמרנות (ברירת מחדל: אין הרשאה).
   */
  capabilities?: string[];
  /** סוף תקופת הניסיון; null = אין תפוגה. */
  trialEndsAt?: string | null;
  /** התקופה נגמרה — רק מסך המנוי פתוח. */
  billingOnly?: boolean;
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

/**
 * שומר עמוד מוגן: בלי Session תקף — הפניה ל-/login.
 *
 * ## למה `loading` מתחיל ב-false כשהזהות במטמון
 *
 * המסכים כתובים כ-‎`if (authLoading) return;`‎ לפני שהם מושכים את
 * הנתונים שלהם, ולכן `loading` שמתחיל תמיד ב-true מכריח סבב רינדור
 * נוסף לפני שהבקשה האמיתית יוצאת — גם כשהתשובה כבר ידועה. בניווט
 * בין מסכים זו ההמתנה המיותרת היחידה שנשארה אחרי המטמון.
 *
 * ראו `session-cache.ts` לגבי התפוגה והניקוי.
 */
export function useRequireAuth(): { user: AuthUser | null; loading: boolean } {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(() => cachedUser());
  const [loading, setLoading] = useState(() => cachedUser() === null);

  useEffect(() => {
    let cancelled = false;
    fetchMe()
      .then((me) => {
        if (cancelled) return;
        // סיסמה זמנית — חובה להחליף לפני כל פעולה אחרת (ביקורת Codex)
        if (me.mustChangePassword && window.location.pathname !== "/change-password") {
          router.replace("/change-password");
          return;
        }
        setUser(me);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          // Session שפג — המטמון חייב להתרוקן, אחרת המשתמש הבא
          // באותה לשונית יקבל זהות ישנה מדקה שעברה
          clearSessionCache();
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
