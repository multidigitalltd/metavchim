"use client";

import { useState } from "react";
import { useUserDismissed } from "@/lib/dismissed-panels";
import {
  IconCheck,
  IconCoins,
  IconEdit,
  IconHome,
  IconLock,
  IconMail,
  IconMap,
  IconPhone,
  IconUser,
  IconX,
} from "../icons";

/**
 * חיסיון הלקוח — **הדבר הראשון שרואים באזור הרשת.**
 *
 * המידע הזה היה קיים, בתוך פאנל מתקפל, ב-12.5px, מתחת לשתי פסקאות
 * הסבר. כלומר: התשובה לשאלה שעוצרת מתווכים מלשתף הייתה מוסתרת
 * מאחורי לחיצה, ומי שהיסס פשוט לא לחץ.
 *
 * ## למה באנר ולא פאנל
 *
 * פאנל מתקפל מתאים למידע שמחפשים; חשש מחפש **אותך**. השורה הראשונה
 * צריכה לומר את המסקנה — הפרטים חסויים עד אישור הדדי — והפירוט
 * נשאר זמין למי שרוצה לוודא.
 *
 * שתי עמודות ולא פסקה: "מה כן" ו"מה לא" זו השוואה, וטבלה נקראת
 * במבט אחד במקום שצריך לדלות אותה מתוך משפטים.
 */

/** מה שהצד השני רואה, ומה שלעולם לא. הרשימות הן נתונים ולא JSX — כך שתיהן נראות אותו דבר. */
const EXPOSED: [
  Icon: (p: { s?: number }) => React.ReactElement,
  text: string,
][] = [
  [IconMap, "ערים ושכונות"],
  [IconHome, "סוג נכס, חדרים וסוג עסקה"],
  [IconCoins, "תקציב — מעוגל ל-100 אלף ₪"],
  [IconCheck, "דרישות החובה"],
  [IconEdit, "התיאור החופשי שאתם כותבים"],
];

const HIDDEN: [
  Icon: (p: { s?: number }) => React.ReactElement,
  text: string,
][] = [
  [IconUser, "שם הלקוח"],
  [IconPhone, "טלפון"],
  [IconMail, "אימייל"],
  [IconCoins, "התקציב המדויק"],
  [IconEdit, "ההערות הפנימיות שלכם"],
];

export function PrivacyBanner() {
  const [open, setOpen] = useState(false);
  /*
   * סגירה ו"אל תציג יותר" (בקשת המשתמש) — למשתמש ולא לדפדפן, כך
   * שהבחירה מלווה אותו בכל מכשיר. מי שכבר הפנים את כללי החיסיון לא
   * צריך לפגוש את הבאנר בכל כניסה לרשת.
   */
  const banner = useUserDismissed("net-privacy-banner");
  if (banner.hidden) return null;

  return (
    <section className="mv-privacy" aria-labelledby="privacy-banner-heading">
      <div className="mv-privacy-head">
        <span className="mv-privacy-badge">
          <IconLock s={21} />
        </span>
        <div className="min-w-0">
          <h2
            id="privacy-banner-heading"
            className="m-0 text-[18px] font-extrabold leading-tight"
          >
            פרטי הלקוחות חסויים — עד אישור הדדי
          </h2>
          <p
            className="m-0 mt-1 text-[15px]"
            style={{ color: "var(--color-text-soft)" }}
          >
            כל הקונים והנכסים כאן מוצגים <b>בלי שם, בלי טלפון ובלי אימייל</b>.
            הקשר בין המשרדים נפתח רק כששני הצדדים מאשרים — עד אז הלקוח נשאר
            שלכם.
          </p>
        </div>
        <button
          type="button"
          className="mv-privacy-more"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "סגור" : "מה בדיוק נחשף?"}
        </button>
        <button
          type="button"
          className="text-[14px] underline"
          style={{ color: "var(--color-text-muted)", whiteSpace: "nowrap" }}
          onClick={banner.never}
        >
          אל תציג יותר
        </button>
        <button
          type="button"
          aria-label="סגירת ההסבר על חיסיון הלקוחות"
          style={{ color: "var(--color-text-muted)", lineHeight: 0 }}
          onClick={banner.close}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M4 4l8 8M12 4l-8 8"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {open ? (
        <div className="mv-privacy-grid">
          <div>
            <p
              className="mv-privacy-title"
              style={{ color: "var(--color-primary)" }}
            >
              <IconCheck s={15} /> נחשף
            </p>
            <ul className="mv-privacy-list">
              {EXPOSED.map(([Icon, text]) => (
                <li key={text}>
                  <Icon s={15} /> {text}
                </li>
              ))}
            </ul>
          </div>
          <div className="mv-privacy-col--hidden">
            <p
              className="mv-privacy-title"
              style={{ color: "var(--color-danger)" }}
            >
              <IconX s={15} /> לא נחשף
            </p>
            <ul className="mv-privacy-list">
              {HIDDEN.map(([Icon, text]) => (
                <li key={text}>
                  <Icon s={15} /> {text}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </section>
  );
}
