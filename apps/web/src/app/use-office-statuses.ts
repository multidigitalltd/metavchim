"use client";

import { useEffect, useState } from "react";
import type { OfficeBuyerStatus } from "@metavchim/shared";
import { apiGet } from "@/lib/api";

/**
 * ‎**רשימת סטטוסי הקונים של המשרד — לכל מסך שמציג או בוחר אחד.**
 *
 * הכרטיס שומר **מזהה** ולא תווית (ראו `buyer-status.ts` בחבילה
 * המשותפת), ולכן כל מסך שמציג סטטוס חייב את הרשימה כדי לתרגם אותו.
 * בלעדיה הכרטיס היה מציג „s3”.
 *
 * ‎**כשל אינו מרעיש.** הרשימה חוזרת ריקה, המסך מציג את שכבה א׳
 * בלבד — בדיוק כפי שנראה מסך של משרד שלא הגדיר סטטוסים — ושום דבר
 * אחר בכרטיס לא נפגע. הודעת שגיאה על תווית משנית מפחידה יותר משהיא
 * עוזרת.
 */
export function useOfficeStatuses(): {
  statuses: OfficeBuyerStatus[];
  /** ‎`false` רק אחרי שהתשובה חזרה — בורר ריק לרגע אינו „בלי סטטוסים”. */
  loading: boolean;
  reload: () => void;
} {
  const [statuses, setStatuses] = useState<OfficeBuyerStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    apiGet<{ statuses: OfficeBuyerStatus[] }>("/settings/buyer-statuses")
      .then((res) => {
        if (alive) setStatuses(res.statuses);
      })
      .catch(() => {
        if (alive) setStatuses([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [nonce]);

  return { statuses, loading, reload: () => setNonce((n) => n + 1) };
}
