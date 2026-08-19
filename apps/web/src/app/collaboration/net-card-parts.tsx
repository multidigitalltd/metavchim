"use client";

import { IconClock, IconPin } from "../icons";

/**
 * חלקי כרטיס הרשת — **שפה חזותית אחת לביקוש ולנכס.**
 *
 * ## מה היה
 *
 * הכרטיס היה כותרת ואחריה רשימת תגיות. כל פרט קיבל את אותו משקל
 * בדיוק — עיר, חדרים, תקציב, קומה, מעלית — ולכן שום פרט לא בלט.
 * מי שסורק לוח של עשרים מודעות מחפש שלושה דברים לפני הכול: **מה,
 * איפה, וכמה.** הם נבלעו בין השאר.
 *
 * ## מה יש
 *
 * ההיררכיה מפורשת: שם הנושא בשורת גיבור, המיקום בשדה משלו, הכסף
 * בתיבה צבועה, שלושה מספרים באריחים, ורק אחריהם השאר. הרכיבים כאן
 * הם החלקים האלה — כדי ששני סוגי הכרטיסים לא ייפרדו ביום שמישהו
 * יערוך אחד מהם.
 */

/** שורת הגיבור: מי/מה, ותת-כותרת שאומרת איזו עסקה. */
export function NetHero({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
}): React.JSX.Element {
  return (
    <div className="mv-net-hero">
      <span className="mv-net-avatar">{icon}</span>
      <div className="mv-net-hero-text">
        <h3 className="mv-net-hero-title">{title}</h3>
        {subtitle === undefined || subtitle === "" ? null : (
          <p className="mv-net-hero-sub">{subtitle}</p>
        )}
      </div>
    </div>
  );
}

/**
 * המיקום — שדה ולא תגית.
 *
 * זו התשובה לשאלה השנייה שמי שסורק לוח שואל, ותגית בין תגיות אינה
 * נקראת כתשובה אלא כעוד פרט.
 */
export function NetPlace({ text }: { text: string }): React.JSX.Element | null {
  if (text.trim() === "") return null;
  return (
    <p className="mv-net-place">
      <IconPin s={16} />
      {text}
    </p>
  );
}

/** תיבת הכסף — המספר היחיד שמותר לו להיות הגדול בכרטיס. */
export function NetMoney({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.JSX.Element {
  return (
    <p className="mv-net-money">
      <span className="mv-net-money-label">{label}</span>
      <span className="mv-net-money-value">{value}</span>
    </p>
  );
}

export interface NetFact {
  icon: React.ReactNode;
  value: string;
  label: string;
}

/**
 * שלושת המספרים.
 *
 * אריח בלי ערך אינו מוצג: „—” באריח משלו תופס בדיוק את אותו מקום
 * כמו מספר אמיתי, ומלמד לא להסתכל על השורה.
 */
export function NetFacts({ facts }: { facts: NetFact[] }): React.JSX.Element | null {
  const shown = facts.filter((fact) => fact.value.trim() !== "" && fact.value !== "—");
  if (shown.length === 0) return null;
  return (
    <div className="mv-net-facts">
      {shown.map((fact) => (
        <div className="mv-net-fact" key={fact.label}>
          {fact.icon}
          <span className="mv-net-fact-value">{fact.value}</span>
          <span className="mv-net-fact-label">{fact.label}</span>
        </div>
      ))}
    </div>
  );
}

/** מה שהמפרסם כתב — הדבר האנושי היחיד בכרטיס, ולכן תיבה ולא שורה. */
export function NetSay({
  label,
  text,
}: {
  label: string;
  text?: string;
}): React.JSX.Element | null {
  if (text === undefined || text.trim() === "") return null;
  return (
    <div className="mv-net-say">
      <span className="mv-net-say-label">{label}</span>
      <p className="mv-net-say-text">{text}</p>
    </div>
  );
}

/**
 * מזהה קצר וזמן פרסום.
 *
 * המזהה קצר במכוון: ULID מלא הוא 26 תווים שאיש אינו קורא, אבל שש
 * הספרות האחרונות מספיקות בדיוק לשם מה שהוא נחוץ — לומר בטלפון
 * „אני מדבר על 11061”.
 */
export function NetMeta({
  id,
  publishedAt,
}: {
  id: string;
  publishedAt?: string;
}): React.JSX.Element {
  return (
    <div className="mv-net-meta">
      <span className="mv-net-meta-id">#{id.slice(-5)}</span>
      {publishedAt === undefined ? null : (
        <span className="mv-net-meta-time">
          <IconClock s={14} />
          {relativeTime(publishedAt)}
        </span>
      )}
    </div>
  );
}

/**
 * „לפני שבוע” ולא תאריך.
 *
 * בלוח מודעות השאלה אינה מתי פורסם אלא כמה זמן זה כבר תלוי — מודעה
 * מלפני חודש היא מודעה אחרת ממודעה מהבוקר, וכדי לדעת זאת מתאריך
 * צריך לחשב בראש.
 */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "פורסם היום";
  if (days === 1) return "פורסם אתמול";
  if (days < 7) return `פורסם לפני ${days} ימים`;
  const weeks = Math.floor(days / 7);
  if (weeks === 1) return "פורסם לפני שבוע";
  if (days < 30) return `פורסם לפני ${weeks} שבועות`;
  const months = Math.floor(days / 30);
  return months === 1 ? "פורסם לפני חודש" : `פורסם לפני ${months} חודשים`;
}

/** מודעה שפורסמה בשבוע האחרון — הסימן היחיד שמצדיק צבע מלא בכרטיס. */
export function isFresh(iso?: string): boolean {
  if (iso === undefined) return false;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return false;
  return Date.now() - then < 7 * 86_400_000;
}
