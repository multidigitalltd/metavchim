"use client";

import { useState } from "react";

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
export function PrivacyBanner() {
  const [open, setOpen] = useState(false);

  return (
    <section className="mv-privacy" aria-labelledby="privacy-banner-heading">
      <div className="mv-privacy-head">
        <span className="mv-privacy-badge" aria-hidden="true">
          🔒
        </span>
        <div className="min-w-0">
          <h2
            id="privacy-banner-heading"
            className="m-0 text-[17px] font-extrabold leading-tight"
          >
            פרטי הלקוחות חסויים — עד אישור הדדי
          </h2>
          <p
            className="m-0 mt-1 text-[14px]"
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
      </div>

      {open ? (
        <div className="mv-privacy-grid">
          <div>
            <p
              className="mv-privacy-title"
              style={{ color: "var(--color-primary)" }}
            >
              ✓ נחשף
            </p>
            <ul className="mv-privacy-list">
              <li>🗺️ ערים ושכונות</li>
              <li>🏠 סוג נכס, חדרים וסוג עסקה</li>
              <li>💰 תקציב — מעוגל כלפי מעלה ל-100 אלף ₪</li>
              <li>✅ דרישות החובה</li>
              <li>📝 התיאור החופשי שאתם כותבים</li>
            </ul>
          </div>
          <div>
            <p
              className="mv-privacy-title"
              style={{ color: "var(--color-danger)" }}
            >
              ✕ לא נחשף
            </p>
            <ul className="mv-privacy-list">
              <li>שם הלקוח</li>
              <li>טלפון</li>
              <li>אימייל</li>
              <li>התקציב המדויק</li>
              <li>ההערות הפנימיות שלכם</li>
            </ul>
          </div>
        </div>
      ) : null}
    </section>
  );
}
