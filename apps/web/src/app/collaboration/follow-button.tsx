"use client";

import { useState } from "react";
import { followLabel, FOLLOW_ACTIVE_NOTE, type FollowKind } from "@metavchim/shared";
import { ApiError, apiDelete, apiPost } from "@/lib/api";
import { IconBell, IconCheck } from "../icons";

/**
 * ‎**„עקוב” — הפעולה שיש כשאין מה להציע, בשני כיווני הרשת.**
 *
 * ## למה הכפתור הזה קיים
 *
 * ‏ביקוש שאין לו נכס מתאים אצלי היה מבוי סתום: קראתי, אין לי מה
 * לעשות, וזה נגמר שם — גם כשהנכס שהיה מתאים בדיוק נכנס למאגר שלי
 * שבוע אחר כך. איש אינו חוזר לגלול ביקושים ישנים כדי לבדוק.
 *
 * ‏ובכיוון השני בדיוק אותו דבר: נכס טוב ברשת שאין לי קונה עבורו
 * ‏היום. `kind` הוא ההבדל היחיד בין השניים.
 *
 * ## שתי הכרעות בכפתור עצמו
 *
 * ‎**הוא אומר את המצב, לא את פעולת הביטול.** „הפסק לעקוב” מאלץ
 * לקרוא כדי לדעת מה קורה עכשיו; „עוקבים אחרי הביקוש” נקרא בעין
 * אחת, והלחיצה ממילא מבטלת.
 *
 * ‎**המצב מתעדכן אצל ההורה ולא רק כאן.** הפיד מחזיק את השורה, וכפתור
 * ששומר מצב לעצמו היה חוזר לקדמותו ברענון הראשון של הרשימה —
 * המשתמש היה רואה „עקוב” על ביקוש שהוא כבר עוקב אחריו.
 */
export function FollowButton({
  kind,
  id,
  following,
  onChanged,
}: {
  /**
   * ‎**שני הכיוונים, כפתור אחד.**
   *
   * ‏ביקוש („כשייכנס נכס מתאים”) ונכס („כשייכנס קונה מתאים”) הם
   * ‏אותה פעולה בדיוק על שתי ישויות. שני רכיבים כמעט זהים היו
   * ‏נפרדים ביום שמישהו יתקן שגיאה באחד מהם.
   */
  kind: FollowKind;
  id: string;
  following: boolean;
  onChanged: (following: boolean) => void;
}): React.JSX.Element {
  /* ‏הנתיב נגזר מהכיוון — ולא מוקלד בכל אתר קריאה */
  const path = kind === "demand" ? "demands" : "listings";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      if (following) {
        await apiDelete(`/collaboration/${path}/${id}/follow`);
        onChanged(false);
      } else {
        await apiPost(`/collaboration/${path}/${id}/follow`, {});
        onChanged(true);
      }
    } catch (caught) {
      /*
       * ‏השגיאה נאמרת ליד הכפתור ולא בראש המסך: היא נוגעת לביקוש
       * הזה בלבד („הגעתם לגבול המעקבים”), והודעה גלובלית על כרטיס
       * אחד היא הודעה שאיש אינו יודע לאיזה מהם היא שייכת.
       */
      setError(caught instanceof ApiError ? caught.message : "הפעולה נכשלה");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="flex flex-col items-stretch gap-1">
      {/*
        ‏גלולת פעולה בתחתית הכרטיס, ולא כפתור מערכת: היא אחת משתיים
        באותה שורה („כל הפרטים” לצידה), ושתיהן חייבות לקרוא כזוג.
        המצב הפעיל מסומן במילוי **ובגבול** — מילוי לבדו אינו מספיק
        לפקד שמצבו נשמר (WCAG 1.4.11).
      */}
      <button
        type="button"
        className={`mv-net-act${following ? " mv-net-act--on" : ""}`}
        aria-pressed={following}
        onClick={() => {
          void toggle();
        }}
        disabled={busy}
        title={following ? FOLLOW_ACTIVE_NOTE[kind] : undefined}
      >
        {following ? <IconCheck s={15} /> : <IconBell s={15} />}
        {followLabel(following, kind)}
      </button>
      {error === null ? null : (
        <span
          role="alert"
          className="text-[length:var(--type-caption)]"
          style={{ color: "var(--color-danger)" }}
        >
          {error}
        </span>
      )}
    </span>
  );
}
