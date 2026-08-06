"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
