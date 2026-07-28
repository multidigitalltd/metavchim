"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, ApiError } from "./api";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
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
        if (!cancelled) {
          setUser(res.user);
          setLoading(false);
        }
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
