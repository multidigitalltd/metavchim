"use client";

import { useRef, useState } from "react";
import type { NetworkChip } from "@metavchim/shared";
import {
  IconClock,
  IconDoor,
  IconCamera,
  IconEye,
  IconPin,
  IconRuler,
  IconStairs,
  IconUsers,
  IconX,
} from "../icons";

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

/**
 * פירוק רשימת התגיות לאזורי הכרטיס.
 *
 * **מקור נתונים אחד, לא שניים.** הפיתוי היה לקרוא את השדות ישירות
 * מה-DTO ולבנות את הכותרת, המיקום והכסף מהם — אבל אז היו שני
 * מסלולים שמחליטים מה מוצג, ו-`network-card.ts` הוא בדיוק המקום
 * שנבנה כדי שיהיה אחד. פרט שאינו נכנס לרשימה שם עדיין אינו מגיע
 * למסך, וזה מה שמגן על החיסיון.
 *
 * מה שאינו מזוהה כאן נשאר תגית. זה מכוון: אייקון חדש שיתווסף
 * ב-shared יופיע ככיתוב ולא ייעלם.
 */
export interface SplitChips {
  /** תקציב או מחיר — התיבה הצבועה. */
  money?: NetworkChip;
  /** ערים ושכונות, מחוברות. */
  place: string;
  /** סוג עסקה וסוג נכס — לתת-הכותרת. */
  subtitle: string;
  /** חדרים, שטח וקומה — האריחים. */
  facts: NetFact[];
  /** כל השאר. */
  rest: NetworkChip[];
}

const FACT_ICONS: Partial<Record<NetworkChip["icon"], { node: React.ReactNode; label: string }>> = {
  door: { node: <IconDoor s={18} />, label: "חדרים" },
  ruler: { node: <IconRuler s={18} />, label: 'שטח במ"ר' },
  stairs: { node: <IconStairs s={18} />, label: "קומה" },
};

export function splitNetworkChips(chips: readonly NetworkChip[]): SplitChips {
  const place: string[] = [];
  const subtitle: string[] = [];
  const facts: NetFact[] = [];
  const rest: NetworkChip[] = [];
  let money: NetworkChip | undefined;

  for (const chip of chips) {
    const fact = FACT_ICONS[chip.icon];
    if (chip.icon === "coins") money ??= chip;
    else if (chip.icon === "map" || chip.icon === "pin") place.push(chip.text);
    else if (chip.icon === "tag" || chip.icon === "key" || chip.icon === "home")
      subtitle.push(chip.text);
    else if (fact !== undefined) facts.push({ icon: fact.node, value: chip.text, label: fact.label });
    else rest.push(chip);
  }

  return {
    money,
    place: place.join(" · "),
    subtitle: subtitle.join(" · "),
    facts,
    rest,
  };
}

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

/**
 * "כל הפרטים" — פופאפ עם המידע המלא של המודעה.
 *
 * הכרטיס בלוח הוא **תקציר**: מי שסורק עשרים מודעות צריך מה/איפה/כמה
 * ולא עשרים שורות פירוט. כל השאר — כל התגיות, ההערות המלאות,
 * התמונות — מחכה כאן, בלחיצה אחת, במסך אחד נקי (בקשת המשתמש:
 * "תקציר בחוץ ומידע מלא בלחיצה… שהכל יהיה הכי מובן ונח לשימוש").
 *
 * `<dialog>` נייטיב: Escape סוגר, הפוקוס נלכד, והרקע מוחשך — בלי
 * ספרייה ובלי ניהול פוקוס ידני.
 */
export function NetDetailsButton({
  title,
  subtitle,
  place,
  money,
  moneyLabel,
  facts,
  chips,
  notes,
  notesLabel,
  photos,
  id,
  publishedAt,
  officeName,
}: {
  title: string;
  subtitle?: string;
  place: string;
  money?: string;
  moneyLabel: string;
  facts: NetFact[];
  chips: NetworkChip[];
  notes?: string;
  notesLabel: string;
  photos?: string[];
  id: string;
  publishedAt?: string;
  officeName?: string;
}): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button
        type="button"
        className="mv-net-details-btn"
        onClick={() => ref.current?.showModal()}
      >
        <IconEye s={15} /> כל הפרטים
      </button>
      <dialog
        ref={ref}
        className="mv-net-dialog"
        aria-label={`כל הפרטים: ${title}`}
        onClick={(e) => {
          // לחיצה על הרקע המוחשך סוגרת — הדיאלוג עצמו הוא התוכן
          if (e.target === ref.current) ref.current?.close();
        }}
      >
        <div className="mv-net-dialog-body">
          <div className="mv-net-dialog-head">
            <div className="min-w-0">
              <h3 className="m-0 text-[18px] font-extrabold">{title}</h3>
              {subtitle ? (
                <p className="m-0 mt-0.5 text-[14.5px]" style={{ color: "var(--color-text-soft)" }}>
                  {subtitle}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              className="mv-net-dialog-close"
              onClick={() => ref.current?.close()}
              aria-label="סגירה"
            >
              <IconX s={16} />
            </button>
          </div>
          {photos !== undefined && photos.length > 0 ? (
            <NetPhotos photos={photos} alt={title} />
          ) : null}
          <NetPlace text={place} />
          {money === undefined ? null : <NetMoney label={moneyLabel} value={money} />}
          <NetFacts facts={facts} />
          {chips.length > 0 ? (
            <div className="mv-net-chips mt-2">
              {chips.map((chip) => (
                <span key={chip.text} className="mv-net-chip">
                  {chip.text}
                </span>
              ))}
            </div>
          ) : null}
          <NetSay label={notesLabel} text={notes} />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <NetMeta id={id} {...(publishedAt === undefined ? {} : { publishedAt })} />
            {officeName ? (
              <span className="text-[14px]" style={{ color: "var(--color-text-muted)" }}>
                פורסם על ידי {officeName}
              </span>
            ) : null}
          </div>
        </div>
      </dialog>
    </>
  );
}

/**
 * ההודעה כשאין התאמה מהצד שלנו — **בולטת, לא שורת לוואי.**
 *
 * הנוסח הקודם היה טקסט אפור קטן שנבלע בכרטיס; המשתמש ביקש שההודעה
 * תהיה "ברורה ומובנת ויותר מודגשת". תיבה עם אייקון, כותרת מודגשת
 * והמשך פעולה — מה בכל זאת אפשר לעשות.
 */
export function NetNoMatch({
  what,
  hint,
}: {
  what: string;
  hint: string;
}): React.JSX.Element {
  return (
    <div className="mv-net-nomatch" role="note">
      <span className="mv-net-nomatch-icon" aria-hidden="true">
        <IconUsers s={17} />
      </span>
      <span className="min-w-0">
        <b className="block text-[14.5px]">{what}</b>
        <span className="text-[14px]" style={{ color: "var(--color-text-soft)" }}>
          {hint}
        </span>
      </span>
    </div>
  );
}

/** מודעה שפורסמה בשבוע האחרון — הסימן היחיד שמצדיק צבע מלא בכרטיס. */
export function isFresh(iso?: string): boolean {
  if (iso === undefined) return false;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return false;
  return Date.now() - then < 7 * 86_400_000;
}

/**
 * תמונת הנכס במודעה — **ראשית גדולה, והשאר מאחורי כפתור.**
 *
 * מתווך אינו מציע נכס ללקוח שלו על סמך טבלת נתונים. בלי תמונה
 * המודעה נקראת ולא מופעלת, וזה ההבדל בין פיד שמייצר שיחות לפיד
 * שגוללים מעליו.
 *
 * גלריה פתוחה תמיד הייתה הופכת כל כרטיס לגובה מסך: הראשית מוצגת,
 * והשאר נפתח בלחיצה של מי שכבר התעניין.
 *
 * ‎`loading="lazy"`‎ — פיד של עשרות מודעות לא ימשוך עשרות תמונות
 * בטעינה. הכתובות חתומות וקצרות-חיים, ולכן תמונה שנכשלת נעלמת
 * בשקט במקום להשאיר סמל שבור על המודעה.
 */
export function NetPhotos({ photos, alt }: { photos: string[]; alt: string }): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [broken, setBroken] = useState<string[]>([]);
  const usable = photos.filter((url) => !broken.includes(url));
  if (usable.length === 0) return null;

  const [main, ...rest] = usable;
  return (
    <div className="mv-net-photos">
      <img
        src={main}
        alt={alt}
        loading="lazy"
        className="mv-net-photo-main"
        onError={() => setBroken((was) => [...was, main!])}
      />
      {rest.length === 0 ? null : open ? (
        <div className="mv-net-photo-strip">
          {rest.map((url) => (
            <img
              key={url}
              src={url}
              alt={alt}
              loading="lazy"
              className="mv-net-photo-thumb"
              onError={() => setBroken((was) => [...was, url])}
            />
          ))}
        </div>
      ) : (
        <button type="button" className="mv-net-chip" onClick={() => setOpen(true)}>
          <IconCamera s={14} /> כל התמונות ({usable.length})
        </button>
      )}
    </div>
  );
}

/**
 * לוגו המשרד המפרסם, לצד שמו.
 *
 * משרד מזוהה נבחר לפני משרד אנונימי — זה כל התפקיד. הלוגו אינו
 * מחליף את השם אלא מתלווה אליו: לוגו שנכשל בטעינה משאיר מודעה עם
 * שם משרד, ולא מודעה בלי מפרסם.
 */
export function NetOffice({
  name,
  logoUrl,
}: {
  name: string;
  logoUrl?: string;
}): React.JSX.Element {
  const [broken, setBroken] = useState(false);
  return (
    <span className="mv-net-chip" title="המשרד שפרסם את המודעה">
      {logoUrl !== undefined && !broken ? (
        <img
          src={logoUrl}
          alt=""
          loading="lazy"
          className="mv-net-office-logo"
          onError={() => setBroken(true)}
        />
      ) : (
        <IconUsers s={14} />
      )}
      {name}
    </span>
  );
}
