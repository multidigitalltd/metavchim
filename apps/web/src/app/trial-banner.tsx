"use client";

import Link from "next/link";
import { describeTrialLeft, shouldWarnAboutTrial, trialDaysLeft } from "@metavchim/shared";

/**
 * תזכורת שתקופת הניסיון נגמרת.
 *
 * בלעדיה הניסיון פשוט נגמר: יום אחד המשרד מנסה להתחבר ומקבל "תקופת
 * הניסיון הסתיימה", בלי שאיש הזהיר אותו ובאמצע יום עבודה. אזהרה
 * שקטה שבוע מראש הופכת את זה מתקלה להחלטה.
 *
 * מוצג רק בשבוע האחרון: באנר שיושב כל 14 הימים הופך לרעש, ומי
 * שהתרגל להתעלם ממנו לא יראה אותו גם ביום האחרון.
 */

export function TrialBanner({
  trialEndsAt,
}: {
  trialEndsAt: string | null | undefined;
}): React.JSX.Element | null {
  const now = new Date();
  if (!shouldWarnAboutTrial(trialEndsAt, now)) return null;
  const days = trialDaysLeft(trialEndsAt, now) ?? 0;

  // ניסיון שכבר פג — ההתחברות ממילא חסומה, ולכן זה מצב ביניים של
  // Session שעוד חי. ההודעה נשארת מדויקת ולא הופכת ל"נשארו -1 ימים"
  const expired = days <= 0;

  return (
    <p
      role="status"
      className="m-0 flex flex-wrap items-center justify-center gap-2 px-4 py-2 text-sm"
      style={{
        background: expired ? "#faf1ec" : "#f7efdd",
        color: expired ? "#b0512c" : "#7a5c1f",
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      <strong>{describeTrialLeft(days)}</strong>
      <span>— כדי להמשיך לעבוד בלי הפרעה, השלימו את המנוי.</span>
      <Link href="/settings" className="underline font-bold">
        לפרטי המסלול
      </Link>
    </p>
  );
}
