"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  REACH_PREVIEW,
  describeReach,
  type ReachSummary,
} from "@metavchim/shared";
import { apiGet } from "@/lib/api";
import { IconHome, IconTarget, IconUser } from "../icons";

/**
 * מה מחכה ברשת ואינו מפורסם — **ההצעה שנולדה מהפער.**
 *
 * לראות את הרשת אינו דורש שיתוף; להיראות בה כן. סוכן פותח את הפיד,
 * רואה נכסים וביקושים של אחרים, ולא יודע שהנכס שלו — שמתאים לשלושה
 * מהם — אינו מפורסם, ולכן אף אחד מהם לא יפנה אליו.
 *
 * הוא לא ידע כי לא היה מקום שאומר לו. השורה הזו היא המקום.
 *
 * ## למה מספר ולא סיסמה
 *
 * "יש לכם הזדמנויות ברשת" הוא משפט שאי אפשר לבדוק, ואחרי פעמיים
 * מתעלמים ממנו. "3 מהנכסים שלכם מתאימים למשהו שכבר ברשת" הוא עובדה
 * — והרשימה שמתחתיה מוכיחה אותה בשמות. מי שלוחץ מגיע לכרטיס ופותח
 * לשיתוף בלחיצה נוספת.
 *
 * ## למה לא מוצג כלום כשאין
 *
 * הכלל ב-`logic/network-reach.ts` מחזיר פריט רק אם יש לו התאמה מעל
 * הסף. "פרסמו את הנכס" על נכס שאיש אינו מחפש הוא בקשה להאמין
 * לכלום, ואחרי פעמיים כאלה המשתמש מפסיק להאמין גם להצעה האמיתית.
 */
export function ReachBanner() {
  const [summary, setSummary] = useState<ReachSummary | null>(null);

  useEffect(() => {
    /*
     * כשל בקריאה משאיר את הבאנר סמוי. זו הצעה ולא מידע קריטי, והצגת
     * שגיאה עליה הייתה מטרידה את המשתמש בלי שהוא ביקש דבר.
     */
    apiGet<ReachSummary>("/collaboration/reach")
      .then(setSummary)
      .catch(() => setSummary(null));
  }, []);

  const headline = summary === null ? null : describeReach(summary);
  if (summary === null || headline === null) return null;

  return (
    <section className="mv-reach" aria-labelledby="reach-heading">
      <div className="mv-reach-head">
        <span className="mv-reach-badge">
          <IconTarget s={20} />
        </span>
        <div className="min-w-0">
          <h2
            id="reach-heading"
            className="m-0 text-[16.5px] font-extrabold leading-tight"
          >
            {headline}
          </h2>
          <p
            className="m-0 mt-0.5 text-[14.5px]"
            style={{ color: "var(--color-text-soft)" }}
          >
            מי שאינו מפורסם אינו מוצג למשרדים האחרים — הם לא יכולים לפנות אליכם
            עליו.
          </p>
        </div>
      </div>

      <div className="mv-reach-lists">
        <ReachList
          items={summary.properties}
          icon={<IconHome s={14} />}
          href={(id) => `/properties/${id}`}
          label="נכסים"
        />
        <ReachList
          items={summary.buyers}
          icon={<IconUser s={14} />}
          href={(id) => `/buyers/${id}`}
          label="קונים"
        />
      </div>
    </section>
  );
}

function ReachList({
  items,
  icon,
  href,
  label,
}: {
  items: ReachSummary["properties"];
  icon: React.ReactNode;
  href: (id: string) => string;
  label: string;
}) {
  if (items.length === 0) return null;
  const shown = items.slice(0, REACH_PREVIEW);
  const rest = items.length - shown.length;
  return (
    <ul className="mv-reach-list" aria-label={label}>
      {shown.map((item) => (
        <li key={item.id}>
          <Link href={href(item.id)} className="mv-reach-item">
            {icon}
            <span className="truncate">{item.title}</span>
            {/*
              מספר ההתאמות ולא הניקוד: "4 התאמות" אומר כמה משרדים
              עשויים לפנות, ו"95%" אומר כמה טוב אחד מהם — והראשון הוא
              מה שמניע ללחוץ.
            */}
            <span className="mv-reach-count">
              {item.matches === 1 ? "התאמה אחת" : `${item.matches} התאמות`}
            </span>
          </Link>
        </li>
      ))}
      {rest > 0 ? <li className="mv-reach-rest">ועוד {rest}</li> : null}
    </ul>
  );
}
