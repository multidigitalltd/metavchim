"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * ‎**`/market` הישן — הפניה ללשונית „נתוני שוק” בפורום** (docs/18).
 *
 * נתוני השוק עברו מהתפריט הראשי לפורום המקצועי (החלטת בעל המוצר).
 * קישורים שכבר יצאו — מהמנטור, מהסוכן, מסימניות — ממשיכים לעבוד:
 * היישוב, הסוג והגודל עוברים כמו שהם, והלשונית הפנימית (`tab` הישן)
 * עוברת ל-`view`, כי `tab` של הפורום תפוס.
 */
export default function MarketRedirect() {
  const router = useRouter();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const inner = params.get("tab");
    params.delete("tab");
    if (inner !== null && !params.has("view")) params.set("view", inner);
    params.set("tab", "market");
    router.replace(`/forum?${params.toString()}`);
  }, [router]);

  return null;
}
