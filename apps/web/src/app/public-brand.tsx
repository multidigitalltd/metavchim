"use client";

import { API_BASE } from "@/lib/api";

/**
 * ‎**המותג של המשרד — בדפים שהלקוח רואה.**
 *
 * ## מה היה חסר
 *
 * שלושת הדפים הציבוריים (חתימה על מסמך, טופס מילוי פרטים, ודף נחיתה
 * של נכס) הם המקומות היחידים שבהם לקוח קצה פוגש את המערכת — והם
 * נשאו את שם המשרד בטקסט אפור בלבד. הלוגו שהמשרד העלה **לא הופיע
 * בהם כלל**, וזו לא הייתה החלטת עיצוב אלא מגבלה טכנית: הנתיב היחיד
 * שהגיש אותו קרא `TenantContext`, שאינו קיים בדף בלי התחברות.
 *
 * מסמך משפטי שנשלח לחתימה נראה כמו טופס אינטרנט גנרי, ודף נכס נראה
 * כאילו הוא של המערכת ולא של המשרד ששילם עליה.
 *
 * ## המונוגרמה אינה קישוט
 *
 * משרד בלי לוגו מקבל את ראשי התיבות שלו בעיגול, ולא „כלום”. כותרת
 * שקופצת בין „יש לוגו” ל„רק טקסט” נראית שבורה בדיוק אצל מי שטרם
 * העלה — כלומר אצל הרוב, ביום הראשון.
 */

/** ראשי התיבות של שם המשרד — עד שתי מילים, כדי שהעיגול יישאר קריא. */
export function officeInitials(officeName: string): string {
  const words = officeName
    .replace(/["'׳״]/gu, "")
    .split(/\s+/u)
    .filter((word) => word.length > 0 && !/^(בע"?מ|בעמ|ltd|inc)$/iu.test(word));
  const letters = words.slice(0, 2).map((word) => [...word][0] ?? "");
  return letters.join("") || "·";
}

export function OfficeBrand({
  officeName,
  logoUrl,
  /** שורה קטנה מעל השם — „הסכם תיווך”, „דף נכס”. */
  eyebrow,
  size = "md",
}: {
  officeName: string;
  logoUrl: string | null;
  eyebrow?: string;
  /** `lg` למסמך שנחתם, `md` לשאר. */
  size?: "md" | "lg";
}) {
  const box = size === "lg" ? 56 : 44;
  return (
    <div className="flex items-center gap-3">
      {logoUrl !== null ? (
        /*
          ‎`img` רגיל ולא `next/image`: הקובץ מוזרם מה-API בנתיב
          שמזוהה בטוקן של אותו דף, ואופטימיזציה בצד השרת הייתה
          דורשת ממנו להביא אותו בעצמו — כלומר לפתוח את הנתיב הזה
          לשרת ה-Next במקום לדפדפן של מי שמחזיק בקישור.

          ‎`object-contain` ולא `cover`: לוגו נמתח הוא לוגו פגום.
        */
        <img
          src={API_BASE + logoUrl}
          alt={officeName}
          className="flex-none rounded-lg object-contain"
          style={{ width: box, height: box }}
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex flex-none items-center justify-center rounded-lg font-bold"
          style={{
            width: box,
            height: box,
            background: "var(--color-primary-soft)",
            color: "var(--color-primary)",
            fontSize: size === "lg" ? 22 : 18,
          }}
        >
          {officeInitials(officeName)}
        </span>
      )}
      <span className="min-w-0">
        {eyebrow !== undefined ? (
          <span
            className="block text-[length:var(--type-caption-lg)] font-semibold"
            style={{ color: "var(--color-text-muted)" }}
          >
            {eyebrow}
          </span>
        ) : null}
        <span
          className="block truncate font-bold"
          style={{ fontSize: size === "lg" ? "calc(20 / 16 * 1rem)" : "calc(17 / 16 * 1rem)" }}
        >
          {officeName}
        </span>
      </span>
    </div>
  );
}
