"use client";

import { useRef, useState } from "react";
import type { NetworkChip, NetworkDetailRow } from "@metavchim/shared";
import { mediaSrc } from "@/lib/api";
import {
  IconChevronDown,
  IconClock,
  IconDoor,
  IconCamera,
  IconEye,
  IconPin,
  IconRuler,
  IconStairs,
  IconTarget,
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
function relativeTime(iso: string): string {
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
  money,
  moneyLabel,
  details,
  notes,
  notesLabel,
  photos,
  id,
  publishedAt,
  officeName,
}: {
  title: string;
  subtitle?: string;
  money?: string;
  moneyLabel: string;
  /**
   * רשימת השדות המלאה, מתויגת — מ-`demandDetailRows` /
   * `presentationDetailRows`. שדה בלי ערך מוצג "לא צוין" ולא נעלם:
   * המשתמש ביקש "ממש את כל השדות", ושדה שנעלם נקרא כמידע מוסתר.
   */
  details: NetworkDetailRow[];
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
              <h3 className="m-0 text-[length:calc(18/16*1rem)] font-extrabold">{title}</h3>
              {subtitle ? (
                <p className="m-0 mt-0.5 text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-soft)" }}>
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
            <NetPhotos photos={photos} alt={title} gallery />
          ) : null}
          {money === undefined ? null : <NetMoney label={moneyLabel} value={money} />}
          {/*
            רשימה מתויגת ולא צ'יפים: בפופאפ כבר לא סורקים אלא
            מחליטים, והחלטה צריכה "מימון: אישור עקרוני ביד" ולא
            תגית שצריך לנחש לאיזה שדה היא שייכת. שדה ריק נשאר
            ברשימה עם "לא צוין" — כך רואים שאין מידע, לא שהוסתר.
          */}
          <dl className="mv-net-dialog-fields">
            {details.map((row) => (
              <div className="mv-net-dialog-field" key={row.label}>
                <dt>{row.label}</dt>
                <dd className={row.value === undefined ? "mv-net-dialog-field-empty" : ""}>
                  {row.value ?? "לא צוין"}
                </dd>
              </div>
            ))}
          </dl>
          <NetSay label={notesLabel} text={notes} />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <NetMeta id={id} {...(publishedAt === undefined ? {} : { publishedAt })} />
            {officeName ? (
              <span className="text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
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
 * ‎**רצועת ההתאמות — קטע מתקפל, לא פסקה ירוקה.**
 *
 * ‏הרשימה הזו היא הפעולה של הכרטיס: הנכסים שלי שמתאימים לביקוש
 * הזה, וליד כל אחד „הצע נכס זה”. בתור פסקה ירוקה עם רשימה פתוחה
 * מתחתיה היא נראתה כמו עוד שדה בכרטיס, ובכרטיס עם ארבע התאמות היא
 * דחפה את שאר המודעה אל מחוץ למסך.
 *
 * ‏רצועה סגורה בעצמה, בצבע הדומיין הסגול — אותו צבע שאריח „מחכים
 * לפעולה” בכרטיס הפתיחה נושא, כי זה אותו דבר בדיוק. המספר על
 * הרצועה אומר כמה יש בלי לפתוח, והשברון אומר שאפשר לסגור.
 *
 * ‎**פתוחה כברירת מחדל.** הכפתור שבתוכה הוא הפעולה שהמסך קיים
 * בשבילה, ורצועה סגורה הייתה מסתירה אותה מאחורי לחיצה נוספת בכל
 * כרטיס. מי שרוצה לסרוק סוגר.
 *
 * ‎`<details>` נייטיב: המקלדת, קורא המסך וכפתור „חפש בעמוד” של
 * הדפדפן מקבלים קטע מתקפל אמיתי בלי state ובלי ARIA ידני.
 */
export function NetMatchStrip({
  count,
  title,
  children,
}: {
  count: number;
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <details className="mv-net-strip mv-domain-violet" open>
      <summary className="mv-net-strip-head">
        <IconTarget s={16} />
        <span className="mv-net-strip-title">{title}</span>
        <span className="mv-net-strip-count">{count}</span>
        <span className="mv-net-strip-chevron" aria-hidden="true">
          <IconChevronDown s={16} />
        </span>
      </summary>
      <div className="mv-net-strip-body">{children}</div>
    </details>
  );
}

/**
 * ‎**„התאמה 92%” בראש הכרטיס — התשובה לפני הקריאה.**
 *
 * ‏ההתאמות ישבו רק בתוך הכרטיס, מתחת לפרטים. כלומר כדי לדעת אם
 * מודעה רלוונטית לי בכלל צריך היה לקרוא אותה עד הסוף — ובלוח של
 * עשרות מודעות זה בדיוק מה שאיש אינו עושה. הכרטיס נראה זהה בין אם
 * יש לי נכס מושלם עבורו ובין אם אין לי דבר.
 *
 * ‏המספר הוא ה**גבוה** מבין ההתאמות ולא ממוצע ולא ספירה: הוא עונה
 * על „כמה קרוב הכי טוב שיש לי”, וזו השאלה שמחליטה אם לפתוח.
 *
 * ‎`null` = אין התאמה, וזה מצב אמיתי שצריך להיקרא ולא להיעלם —
 * הכרטיס עדיין רלוונטי, ומתחתיו כפתור המעקב.
 */
export function NetMatchBadge({
  score,
  label,
}: {
  /** האחוז הגבוה מבין ההתאמות, או `null` כשאין. */
  score: number | null;
  /** מה מתאים — „נכס שלך” / „קונה שלך”. לקורא המסך בלבד. */
  label: string;
}): React.JSX.Element {
  const matched = score !== null;
  return (
    <span
      className={`mv-pill flex items-center gap-1.5 ${
        matched ? "mv-domain-violet" : "mv-domain-neutral"
      }`}
      title={matched ? `${label} מתאים בציון ${score}` : `אין ${label} מתאים במאגר שלך`}
    >
      <IconTarget s={13} />
      {matched ? `התאמה ${score}%` : "אין התאמה"}
    </span>
  );
}

/**
 * ‏האחוז הגבוה מבין ההתאמות, או `null` כשאין.
 *
 * פונקציה ולא ביטוי בשני מקומות: שני סוגי הכרטיסים מחשבים את אותו
 * מספר, ו-`Math.max` על מערך ריק מחזיר `-Infinity` — כלומר „התאמה
 * ‎-Infinity%” בכל כרטיס בלי התאמות, אם מישהו יכתוב את זה שוב בקצרה.
 */
export function bestMatchScore(
  matches: readonly { score: number }[] | undefined,
): number | null {
  if (matches === undefined || matches.length === 0) return null;
  return matches.reduce((top, match) => (match.score > top ? match.score : top), 0);
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
      <span className="min-w-0 flex-1">
        <b className="block text-[length:var(--type-caption-lg)]">{what}</b>
        <span className="text-[length:var(--type-caption)]" style={{ color: "var(--color-text-soft)" }}>
          {hint}
        </span>
      </span>
    </div>
  );
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
 * בטעינה. תמונה שנכשלת נעלמת בשקט במקום להשאיר סמל שבור על
 * המודעה.
 *
 * הכתובות הן נתיבים ב-API (`mediaSrc`), ולא כתובות אחסון חתומות —
 * ראו `apps/api/.../network-media.ts`.
 */
export function NetPhotos({
  photos,
  alt,
  gallery = false,
}: {
  photos: string[];
  alt: string;
  /**
   * `true` = הגלריה המלאה, פתוחה — לפופאפ "כל הפרטים".
   * `false` = התמונה הראשית בלבד — לכרטיס בלוח. הגלריה אינה
   * נפתחת בכרטיס: מי שרוצה את כל התמונות לוחץ "כל הפרטים",
   * והכרטיסים נשארים שווי-גובה (בקשת המשתמש).
   */
  gallery?: boolean;
}): React.JSX.Element | null {
  const [broken, setBroken] = useState<string[]>([]);
  const usable = photos.filter((url) => !broken.includes(url));
  if (usable.length === 0) return null;

  const [main, ...rest] = usable;
  return (
    <div className="mv-net-photos">
      <img
        src={mediaSrc(main!)}
        alt={alt}
        loading="lazy"
        className="mv-net-photo-main"
        onError={() => setBroken((was) => [...was, main!])}
      />
      {gallery && rest.length > 0 ? (
        <div className="mv-net-photo-strip">
          {rest.map((url) => (
            <img
              key={url}
              src={mediaSrc(url)}
              alt={alt}
              loading="lazy"
              className="mv-net-photo-thumb"
              onError={() => setBroken((was) => [...was, url])}
            />
          ))}
        </div>
      ) : null}
      {!gallery && rest.length > 0 ? (
        /* רמז שיש עוד — הפתיחה עצמה בפופאפ "כל הפרטים" */
        <span className="mv-net-chip" aria-hidden="true">
          <IconCamera s={14} /> ‎+{rest.length} תמונות
        </span>
      ) : null}
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
          src={mediaSrc(logoUrl)}
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
