"use client";

import { useRef, useState } from "react";
import type { NetworkChip, NetworkDetailRow } from "@metavchim/shared";
import { mediaSrc } from "@/lib/api";
import {
  IconChevronDown,
  IconClock,
  IconCamera,
  IconEye,
  IconInfo,
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

/*
 * ‏שלושת השדות שמקבלים אריח משלהם, והתווית שלהם.
 *
 * ‎**בלי אייקון.** האריח נושא תווית ומספר, ובקובץ העיצוב זו כל
 * צורתו: „חדרים / 4”. סמל נוסף מעליהם היה שכפול של אותה מילה
 * בצורה שצריך לפענח — סרגל אינו נקרא „שטח” אלא נזכר ככזה.
 */
const FACT_LABELS: Partial<Record<NetworkChip["icon"], string>> = {
  door: "חדרים",
  ruler: 'שטח',
  stairs: "קומה",
};

/**
 * ‏ערך האריח בלי המילה שכבר כתובה בתווית שמעליו.
 *
 * הצ'יפ נוסח כמשפט עצמאי („4 חדרים”, „קומה 3”) כי הוא עמד לבדו
 * בשורת תגיות. באריח יש תווית מעליו, ולכן אותה מילה הופיעה פעמיים:
 * „חדרים / 4 חדרים”. מה שנשאר ריק חוזר לטקסט המלא — עדיף כפילות
 * מאשר אריח בלי ערך.
 */
function factValue(text: string, label: string): string {
  const trimmed = text
    .replace(new RegExp(`^${label}\\s+`, "u"), "")
    .replace(new RegExp(`\\s+${label}$`, "u"), "")
    .trim();
  return trimmed === "" ? text : trimmed;
}

export function splitNetworkChips(chips: readonly NetworkChip[]): SplitChips {
  const place: string[] = [];
  const subtitle: string[] = [];
  const facts: NetFact[] = [];
  const rest: NetworkChip[] = [];
  let money: NetworkChip | undefined;

  for (const chip of chips) {
    const label = FACT_LABELS[chip.icon];
    if (chip.icon === "coins") money ??= chip;
    else if (chip.icon === "map" || chip.icon === "pin") place.push(chip.text);
    else if (chip.icon === "tag" || chip.icon === "key" || chip.icon === "home")
      subtitle.push(chip.text);
    else if (label !== undefined) facts.push({ value: factValue(chip.text, label), label });
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

/**
 * ‏המשרד המפרסם — עיגול, שם ועיר, בראש הכרטיס.
 *
 * הוא היה צ'יפ אחד מבין כמה בפס העליון, כלומר פרט ברשימת פרטים.
 * בפועל הוא הראשון שמסתכלים עליו: מודעה של משרד שמכירים נקראת
 * אחרת מזו של משרד שלא שמעו עליו, וההחלטה אם בכלל לקרוא נופלת שם.
 *
 * ‏הלוגו נכנס לעיגול כשיש, ואות ראשונה כשאין. לוגו שנשבר בטעינה
 * חוזר לאות — מודעה עם שם משרד ובלי סמל, ולא עיגול ריק.
 */
export function NetOfficeHead({
  name,
  place,
  logoUrl,
}: {
  name: string;
  /** עיר המשרד או של המודעה — שורה שנייה קטנה מתחת לשם. */
  place?: string;
  logoUrl?: string;
}): React.JSX.Element {
  const [broken, setBroken] = useState(false);
  return (
    <span className="mv-net-office">
      <span className="mv-net-office__avatar" aria-hidden="true">
        {logoUrl !== undefined && !broken ? (
          <img src={mediaSrc(logoUrl)} alt="" loading="lazy" onError={() => setBroken(true)} />
        ) : (
          name.trim().slice(0, 1)
        )}
      </span>
      <span className="min-w-0">
        <span className="mv-net-office__name">{name}</span>
        {place === undefined || place.trim() === "" ? null : (
          <span className="mv-net-office__place">{place}</span>
        )}
      </span>
    </span>
  );
}

/**
 * ‎**שורה, לא כרטיס — תצוגת „שורות” של הפיד.**
 *
 * ‏אותה מודעה בדיוק, באותם נתונים (`splitNetworkChips` נשאר המקור
 * היחיד שמחליט מה מגיע למסך), אבל במסת מבט אחת: מה זה, כמה, ומה
 * עושים. מי שסורק ארבעים מודעות אינו קורא הערות ואינו פותח רצועות
 * — הוא מחפש את השתיים שכדאי לפתוח.
 *
 * ‎**מה אין כאן, ובכוונה:** ההערות, התמונות, וההסבר „אין לכם נכס
 * מתאים”. תג ההתאמה בשורה כבר אומר אותו דבר במילה אחת, והפירוט
 * ממתין ב„כל הפרטים” ובתצוגת הכרטיסיות — שהמתג אליה נמצא באותה
 * שורה שבה בוחרים את התצוגה.
 */
export function NetRow({
  icon,
  title,
  subtitle,
  badge,
  money,
  facts,
  actions,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  badge: React.ReactNode;
  money?: string;
  facts: NetFact[];
  actions: React.ReactNode;
}): React.JSX.Element {
  const shown = facts.filter((fact) => fact.value.trim() !== "" && fact.value !== "—");
  return (
    <div className="mv-net-rowline">
      <span className="mv-net-rowline__tile" aria-hidden="true">
        {icon}
      </span>
      <span className="mv-net-rowline__main">
        <span className="mv-net-line__title">
          {title}
          {badge}
        </span>
        {subtitle === undefined || subtitle === "" ? null : (
          <span className="mv-net-line__sub">{subtitle}</span>
        )}
      </span>
      <span className="mv-net-rowline__figures">
        {money === undefined ? null : (
          <span className="mv-net-rowline__money">{money}</span>
        )}
        {shown.length === 0 ? null : (
          <span className="mv-net-line__sub">
            {shown.map((fact) => `${fact.label} ${fact.value}`).join(" · ")}
          </span>
        )}
      </span>
      <span className="mv-net-rowline__act">{actions}</span>
    </div>
  );
}

/**
 * ‏שורת הכותרת — מה זה מימין, ומה מיוחד בו משמאל.
 *
 * ‎**בלי אווטאר.** האווטאר עבר לפס העליון, אל המשרד המפרסם — שם
 * הוא אומר „מי”, וכאן הוא רק חזר על סוג המודעה שכבר כתוב בשמה.
 *
 * ‏המיקום נכנס לתת-הכותרת ואינו שדה בפני עצמו: „אשדוד · דירה”
 * נקרא בשורה אחת, ושדה ממוסגר משלו הוסיף מלבן שלישי לכרטיס בלי
 * להוסיף מידע.
 */
export function NetHero({
  title,
  subtitle,
  aside,
}: {
  title: string;
  subtitle?: string;
  /** תגיות מצב שיושבות בקצה שורת הכותרת — „בלעדיות”, „חדש ברשת”. */
  aside?: React.ReactNode;
}): React.JSX.Element {
  return (
    <>
      <div className="mv-net-titlerow">
        <h3 className="mv-net-hero-title">{title}</h3>
        {aside === undefined ? null : <span className="flex flex-wrap items-center gap-2">{aside}</span>}
      </div>
      {subtitle === undefined || subtitle === "" ? null : (
        <p className="mv-net-sub">{subtitle}</p>
      )}
    </>
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
        className="mv-net-act"
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
  summary,
  domain,
  icon,
  children,
}: {
  count: number;
  title: string;
  /** ‏„2 קונים · הגבוה 94” — מה שיודעים בלי לפתוח. */
  summary: string;
  /** צבע הקטע שהכרטיס שייך לו — כחול לנכסים, סגול לביקושים. */
  domain: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <details className={`mv-net-strip ${domain}`}>
      <summary className="mv-net-strip-head">
        <span className="mv-net-strip__tile" aria-hidden="true">
          {icon}
        </span>
        <span className="mv-net-strip-title">
          {title}
          <span className="mv-net-strip__sub">{summary}</span>
        </span>
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
  domain,
}: {
  /** האחוז הגבוה מבין ההתאמות, או `null` כשאין. */
  score: number | null;
  /** מה מתאים — „נכס שלך” / „קונה שלך”. לקורא המסך בלבד. */
  label: string;
  /** צבע הקטע כשיש התאמה; בלי התאמה התג תמיד ניטרלי. */
  domain: string;
}): React.JSX.Element {
  const matched = score !== null;
  return (
    <span
      className={`mv-pill ${matched ? domain : "mv-domain-neutral"}`}
      title={matched ? `${label} מתאים בציון ${score}` : `אין ${label} מתאים במאגר שלך`}
    >
      {matched ? `התאמה ${score}` : "אין התאמה"}
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
      <b className="mv-net-nomatch__head">
        <IconInfo s={16} />
        {what}
      </b>
      <span className="mv-net-nomatch__hint">{hint}</span>
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
