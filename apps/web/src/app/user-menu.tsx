"use client";

import { useRouter } from "next/navigation";
import { apiPost } from "@/lib/api";

export function UserMenu() {
  const router = useRouter();

  async function logout() {
    try {
      await apiPost("/auth/logout", {});
    } finally {
      router.replace("/login");
    }
  }

  return (
    <button
      type="button"
      onClick={() => void logout()}
      className="min-h-11 rounded-md px-3 py-2 underline"
    >
      התנתקות
    </button>
  );
}
