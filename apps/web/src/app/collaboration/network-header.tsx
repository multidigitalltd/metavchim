"use client";

import Link from "next/link";
import { useState } from "react";
import { formatIsraeliNumber } from "@metavchim/shared";
import { PrivacyBanner } from "./privacy-banner";
import {
  IconCheck,
  IconGlobe,
  IconHandshake,
  IconHome,
  IconLink,
  IconUpload,
  IconUser,
  IconUsers,
} from "../icons";

/**
 * ‎**כרטיס הפתיחה של הרשת — מה קורה בה, ומה מחכה לי בה.**
 *
 * ## למה ארבעה מספרים ולא פסקה
 *
 * ‏המסך פתח קודם בכותרת ובמשפט הסבר, ומי שנחת בו לא ידע אם הרשת
 * עובדת בשבילו. „32 ביקושים ברשת” ו„12 משרדים מחוברים” הם התשובה
 * לשאלה שמתווך שואל בשנייה הראשונה: יש כאן מספיק בשביל שאכפת לי.
 *
 * ‎**האריח הראשון הוא היחיד שהוא פעולה.** „6 מתאימים לנכסים שלך,
 * מחכים לפעולה” אינו מדד אלא רשימת מטלות, ולכן הוא בצבע הדומיין
 * הסגול ולא בניטרלי — והוא גם היחיד שגולל אל הקטע שהוא סופר.
 *
 * ## המספר הזה נגזר מהפיד ולא מהשרת
 *
 * ‏שאר המספרים נספרים במסד (`/collaboration/summary`), כי הפיד חסום
 * במאה שורות ומשרד שרואה מאה ביקושים אינו יודע אם יש 100 או 340.
 * ‏„מתאימים לנכסים שלך” הוא היוצא מן הכלל, וזו הכרעה: הוא **התווית
 * של הקטע שמתחתיו**, ולכן הוא חייב להיות בדיוק מספר הכרטיסים בו.
 * חישוב שני בשרת היה מנוע התאמות שני, ומספיק הבדל אחד בסינון כדי
 * שהכותרת תאמר „6” מעל חמישה כרטיסים.
 */

export interface NetworkSummary {
  demands: number;
  listings: number;
  referrals: number;
  offices: number;
  dealsThisMonth: number;
  incomingOffers: number;
  openReferrals: number;
  credits: number;
}

/** ‏מספר לאריח. `null` = טרם נטען, וזה אינו אפס. */
function tileValue(value: number | null): string {
  return value === null ? "…" : formatIsraeliNumber(value);
}

export function NetworkHeader({
  summary,
  actionable,
}: {
  summary: NetworkSummary | null;
  /**
   * ‏כמה ביקושים יש להם נכס מתאים אצלי — נספר בפיד עצמו.
   * ‎`null` כשהפיד עוד לא נטען.
   */
  actionable: number | null;
}): React.JSX.Element {
  return (
    <section className="mv-card mv-card--pad mb-[18px]" aria-labelledby="coop-heading">
      {/*
        ‏`flex-wrap` ולא רק על המסך הגדול: הכותרת נושאת חמישה
        פריטים — אריח, שם, גלולת סטטוס ושני כפתורים — ובמסך של
        טלפון הם 458px בתוך 316. בלי שבירה זה לא „צר” אלא **גלילה
        אופקית של העמוד כולו**, וזו תמיד תקלה. שתי שורות של פקדים
        נקראות; עמוד שזז הצידה לא.
      */}
      <div className="mv-card-head flex-wrap gap-y-2.5">
        <span className="mv-tile mv-tile--44 mv-domain-violet" aria-hidden="true">
          <IconHandshake s={20} />
        </span>
        <h1 id="coop-heading" className="mv-card-head__title m-0">
          שיתופי פעולה
        </h1>
        {/*
          ‎`mv-pill` עם `mv-domain-green`: הגלולה נצבעת מטוקני הדומיין
          ולא מצבע כתוב, ולכן היא נכונה גם בערכה הכהה ובניגודיות
          גבוהה.
        */}
        <span className="mv-pill mv-domain-green flex items-center gap-1">
          <IconGlobe s={13} /> הרשת פעילה
        </span>
        {/*
          הפרסום עצמו נעשה מכרטיס הקונה — הביקוש נגזר מדרישות אמיתיות
          ולא מטופס ריק. אבל מי שנוחת כאן צריך לדעת שזה קיים ואיפה,
          אחרת המסך נראה כמו רשימה לצפייה בלבד.
        */}
        <Link
          href="/buyers"
          className="mv-button mv-button--secondary ms-auto"
          style={{ textDecoration: "none" }}
        >
          <span className="flex items-center gap-1.5">
            <IconUpload s={15} /> פרסום ביקוש לרשת
          </span>
        </Link>
        <InviteOfficeButton />
      </div>

      <p
        className="m-0 mb-4 text-[length:var(--type-caption-lg)]"
        style={{ color: "var(--color-text-muted)" }}
      >
        המערכת מצליבה את המאגר שלך מול כל המשרדים ברשת, כל הזמן.
      </p>

      <dl className="m-0 grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
        {/*
          אריח הפעולה ראשון, ובצבע. הוא היחיד כאן שאפשר לעשות איתו
          משהו עכשיו, והוא גם היחיד שקישור אליו אינו ניווט אלא גלילה
          אל הקטע שהוא סופר — הרשימה כבר על המסך, מתחת.
        */}
        <a
          href="#coop-matched"
          className={`mv-kpi mv-kpi--sm no-underline ${
            actionable === 0 ? "mv-domain-neutral" : "mv-domain-violet"
          }`}
        >
          <dt className="mv-kpi__head">
            <span className="mv-kpi__label">מתאימים לנכסים שלך</span>
            <span className="mv-tile" aria-hidden="true">
              <IconHome s={16} />
            </span>
          </dt>
          <dd className="mv-kpi__foot m-0">
            <span className="mv-kpi__value mv-ltr">{tileValue(actionable)}</span>
            <span className="mv-kpi__note">מחכים לפעולה</span>
          </dd>
        </a>

        <Tile
          label="ביקושים"
          note="ברשת, פתוחים כרגע"
          value={summary === null ? null : summary.demands}
          icon={<IconUser s={16} />}
        />
        <Tile
          label="משרדים"
          note="שותפים מחוברים אליך"
          value={summary === null ? null : summary.offices}
          icon={<IconUsers s={16} />}
        />
        <Tile
          label="עסקאות"
          note="משותפות, נסגרו החודש"
          value={summary === null ? null : summary.dealsThisMonth}
          icon={<IconHandshake s={16} />}
          domain="green"
        />
      </dl>

      {/*
        החיסיון הוא השורה האחרונה של הכרטיס ולא פאנל מתקפל בלשונית
        אחת. „הם ייקחו לי את הלקוח” הוא החשש שעוצר מתווכים מלשתף,
        והתשובה לו הייתה מוסתרת מאחורי לחיצה — כלומר מי שהיסס פשוט
        לא לחץ.
      */}
      <div className="mt-4">
        <PrivacyBanner />
      </div>
    </section>
  );
}

function Tile({
  label,
  note,
  value,
  icon,
  domain = "neutral",
}: {
  label: string;
  note: string;
  value: number | null;
  icon: React.ReactNode;
  domain?: "neutral" | "green";
}): React.JSX.Element {
  return (
    <div
      className={`mv-kpi mv-kpi--sm ${
        value === 0 || value === null ? "mv-domain-neutral" : `mv-domain-${domain}`
      }`}
    >
      <dt className="mv-kpi__head">
        <span className="mv-kpi__label">{label}</span>
        <span className="mv-tile" aria-hidden="true">
          {icon}
        </span>
      </dt>
      <dd className="mv-kpi__foot m-0">
        <span className="mv-kpi__value mv-ltr">{tileValue(value)}</span>
        <span className="mv-kpi__note">{note}</span>
      </dd>
    </div>
  );
}

/**
 * ‎**הזמנת משרד לרשת — לינק, ולא מנגנון.**
 *
 * ‏הרשת שווה בדיוק כמו מספר המשרדים שבה, ומתווך שמכיר משרד שכן
 * הוא הערוץ הטבעי ביותר להרחיב אותה. מה שהוא צריך זה טקסט מוכן
 * להדבקה בוואטסאפ — לא טופס.
 *
 * ‏אין כאן מעקב אחרי מי הזמין את מי ואין בונוס: זו הייתה תכונה
 * אחרת לגמרי (טוקן, ייחוס בהרשמה, זיכוי), והיא לא נבחרה. הכפתור
 * עושה בדיוק מה שכתוב עליו.
 */
function InviteOfficeButton(): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  const invite = (): void => {
    /*
     * ‎`window.location.origin` ולא כתובת קבועה: אותה מערכת רצה גם
     * בסביבת בדיקה, ולינק לייצור שנשלח משם הוא לינק שגוי.
     */
    const text = `יש לי מאגר נכסים וקונים במטווחים, ואנחנו משתפים פעולה עם משרדים ברשת. שווה לך להצטרף: ${window.location.origin}/signup`;
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 4000);
      })
      .catch(() => {
        /* ‏דפדפן שחסם את הלוח — עדיף בלי אישור מאשר אישור שקרי */
        setCopied(false);
      });
  };

  return (
    <button
      type="button"
      className="mv-button mv-button--primary"
      onClick={invite}
      title="העתקת הזמנה מוכנה לשליחה בוואטסאפ"
    >
      <span className="flex items-center gap-1.5">
        {copied ? <IconCheck s={15} /> : <IconLink s={15} />}
        {copied ? "ההזמנה הועתקה" : "הזמנת משרד לרשת"}
      </span>
    </button>
  );
}
