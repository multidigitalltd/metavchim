"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { OnboardingProgress } from "@metavchim/shared";
import { apiGet } from "@/lib/api";
import { Notice, useDismissedToday } from "./notice";

/**
 * ‎**„המייל הזה יוצא מכתובת שאינה שלכם.”**
 *
 * ## למה זה שווה באנר
 *
 * מסך ההגדרות מציע לחבר דומיין, ומי שלא יודע שזה קיים לא מגיע
 * לשם. התוצאה אינה „פיצ'ר שלא נוצל”: כל מייל שיוצא ללקוח — הצעה,
 * הסכם לחתימה, תשובה מהתיבה — נושא כתובת שולח, והיא זו שהלקוח
 * רואה, שומר ומשיב אליה. כשהיא של המערכת, המשרד בונה זיהוי של
 * מישהו אחר; מסירה שנחסמת או נופלת לספאם היא רק התוצאה הגלויה.
 *
 * ## למה כאן ולא בכל מסך
 *
 * הבאנר יושב במקום שבו העלות מורגשת — התיבה, שבה עונים ללקוח —
 * ולא כפס עליון בכל המערכת. תזכורת שמופיעה בכל מסך נקראת פעם
 * אחת ואז מפסיקים לראות אותה, וזה גרוע יותר מלא להציג אותה בכלל.
 *
 * ## למה „לא עכשיו” ליום ולא לתמיד
 *
 * ‎`useDismissedToday` — אותו מנגנון של כל התזכורות שחוזרות. חיבור
 * דומיין דורש גישה ל-DNS, וזה לא תמיד אפשרי באותו רגע; סגירה
 * לצמיתות הייתה קוברת את זה עד שמישהו ימחק localStorage. הבאנר
 * נעלם **לגמרי** ברגע שהדומיין מאומת, ולכן אינו צריך „אל תציג
 * שוב”: הוא נגמר כשהעבודה נגמרת.
 */

export function OfficeDomainNudge(): React.JSX.Element | null {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [dismissed, dismiss] = useDismissedToday("office-domain");

  useEffect(() => {
    let cancelled = false;
    apiGet<OnboardingProgress>("/settings/onboarding")
      .then((progress) => {
        if (cancelled) return;
        const step = progress.steps.find((s) => s.key === "email_domain");
        /*
         * צעד חסר נחשב „מחובר” ולכן שקט. גרסה ישנה של השרת, או
         * תשובה שלא נקראה, אינה סיבה להאשים משרד בדבר שאיננו
         * יודעים עליו — באנר שקרי גרוע מבאנר חסר.
         */
        setConnected(step === undefined ? true : step.done);
      })
      .catch(() => {
        if (!cancelled) setConnected(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (connected !== false || dismissed) return null;

  return (
    <Notice tone="info" onClose={dismiss} className="mb-3">
      המיילים ללקוחות יוצאים כרגע מכתובת המערכת ולא מהכתובת של המשרד. חיבור
      הדומיין שלכם משנה את שם השולח שהלקוח רואה, ומשפר את סיכויי המסירה.{" "}
      <Link href="/settings#email-domain" className="font-medium underline">
        לחיבור הדומיין
      </Link>
    </Notice>
  );
}
