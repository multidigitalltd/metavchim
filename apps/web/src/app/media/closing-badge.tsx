"use client";

import { mediaClosingState, type MediaClosingState } from "@metavchim/shared";
import { formatDateTime } from "@/lib/format";
import { useMinuteNow } from "@/lib/use-minute-now";

/**
 * מועד סגירת הגיליון — מתי, ובאיזה טון.
 *
 * ‏„נסגר בעוד יומיים” הוא מידע; „נסגר מחר” הוא דחיפות; „המועד עבר”
 * ‏אומר שבעל הפלטפורמה טרם עדכן לגיליון הבא — ולא שאי אפשר להזמין.
 * ‏המצב נגזר מ-`mediaClosingState`, אותה פונקציה שהתזכורת בשרת
 * ‏נשענת עליה.
 */
const TONE: Record<Exclude<MediaClosingState, "none">, string> = {
  open: "mv-domain-neutral",
  soon: "mv-domain-peach",
  closed: "mv-domain-amber",
};

export function ClosingBadge({
  nextClosingAt,
  compact = false,
}: {
  nextClosingAt: string | null;
  compact?: boolean;
}): React.JSX.Element | null {
  const now = useMinuteNow();
  if (nextClosingAt === null) return null;
  const at = new Date(nextClosingAt);
  const state = mediaClosingState(at, now);
  if (state === "none") return null;
  const label =
    state === "closed"
      ? "מועד הסגירה האחרון עבר"
      : state === "soon"
        ? `הגיליון נסגר בקרוב — ${formatDateTime(at)}`
        : `סגירת גיליון: ${formatDateTime(at)}`;
  return (
    <span className={`mv-pill ${TONE[state]}`} title={compact ? label : undefined}>
      {compact && state !== "closed" ? (state === "soon" ? "נסגר בקרוב" : `סגירה ${formatDateTime(at)}`) : label}
    </span>
  );
}
