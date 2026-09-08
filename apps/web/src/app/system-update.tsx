"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { IconChevronLeft, IconChevronRight, IconX } from "./icons";
import { useUserDismissedSet } from "@/lib/dismissed-panels";
import { useDismissedToday } from "./notice";
import { openSupport } from "./support-button";

/**
 * הודעות עדכון מערכת בראש הדשבורד.
 *
 * ## למה זה לא `Notice`
 *
 * `Notice` הוא משוב על פעולה — הצליח, נכשל, שים לב. זו הכרזה: היא
 * מספרת על יכולת חדשה, היא מזמינה לפעולה, והיא נראית אחרת בכוונה.
 * שימוש באותו רכיב לשני הדברים היה גורם להודעת „נשמר בהצלחה”
 * להיראות כמו קמפיין.
 *
 * ## ‎**סליידר, ולא הכרזה אחת** (בקשת המשתמש)
 *
 * ‏עד כה הוצגה **הכרזה אחת** — החדשה מבין השתיים שמתאימות למשרד —
 * ‏והנימוק היה נכון: „שתי הכרזות זו מעל זו הן קיר, ובדיוק המסך הזה
 * ‏מתחיל את היום”. אבל המסקנה ממנו הייתה שגויה: הפתרון לקיר אינו
 * ‏למחוק את מה שמעליו אלא **להציג אחת בכל פעם**. עכשיו כל הכרזה
 * ‏היא שקופית משלה, גובה הכרטיס נשאר גובה של הכרזה אחת, ומה
 * ‏שהוסתר קודם פשוט זמין בלחיצה.
 *
 * ‎`MAX_SLIDES` הוא שלוש: מעבר לזה זה ארכיון, לא „מה חדש”. מסך
 * ‏„כל העדכונים” הוא המקום לישן מזה.
 *
 * ## ‏הכרזה היא נתון, לא רכיב
 *
 * ‏שתי ההכרזות היו שתי פונקציות כמעט זהות — אותו שלד, אותו מבנה,
 * ‏אותם שני מנגנוני סגירה, ושני עותקים לכל תיקון. עכשיו הן פריטים
 * ‏ברשימה אחת, מהחדש לישן, והשלד נכתב פעם אחת. הוספת הכרזה היא
 * ‏שורה ברשימה.
 *
 * ## שתי סגירות — ליום, ולתמיד
 *
 * האיקס סוגר את **הכרטיס כולו** ליום (`useDismissedToday`): הכרזה
 * ראויה להזדמנות שנייה למי שסגר בטעות בדרך לפגישה. „לא להציג יותר”
 * הוא **פר-שקופית** ונשמר למשתמש בשרת, ולכן מסתיר בכל המכשירים —
 * והשקופית יורדת מהסליידר בזמן שהשאר נשארות.
 *
 * ## מי רואה מה
 *
 * המנטור נפתח עם המאמן החכם, ולמשרד שאין לו אותו הכרזה עליו היא
 * פרסומת ולא עדכון. `requires` הוא התנאי הזה, ליד ההכרזה עצמה
 * ולא בענף `if` במקום אחר.
 */

/** נוסח הפנייה שנפתח בטופס — המתווך רק מוסיף מה שירצה ושולח. */
const WA_REQUEST_TEXT = "אשמח להצטרף לשירות הסוכן בוואטסאפ. נא צרו איתי קשר.";

/** ‏שלוש האחרונות. מעבר לזה זה ארכיון, לא „מה חדש”. */
const MAX_SLIDES = 3;

interface Announcement {
  /** ‏מפתח „לא להציג יותר”, ומפתח ה-React של השקופית. */
  id: string;
  title: string;
  text: string;
  /** ‏קישור פנימי, או פנייה שנפתחת בטופס התמיכה. */
  cta: { label: string; href: string } | { label: string; request: string };
  /** ‏האיור. דקורטיבי — `aria-hidden` נקבע במעטפת ולא כאן. */
  art: ReactNode;
  /** ‏מה שהמשרד חייב שיהיה לו כדי שזו תהיה הכרזה ולא פרסומת. */
  requires?: "mentor";
}

/*
 * ‏האיורים: SVG ולא תמונה — הם נצבעים בטוקנים של המערכת ולכן
 * ‏מתהפכים נכון במצב כהה, בזמן שקובץ תמונה היה נשאר בהיר על רקע
 * ‏כהה.
 */
const MENTOR_ART = (
  <>
    <ellipse cx="96" cy="74" rx="86" ry="60" className="mv-announce-blob" />
    {/* המטרה — היעד שהמתווך ביקש מעצמו */}
    <circle cx="92" cy="72" r="40" className="mv-announce-bubble" />
    <circle cx="92" cy="72" r="24" className="mv-announce-bubble" />
    <circle cx="92" cy="72" r="8" className="mv-announce-badge" />
    {/* הניצוץ — המנטור */}
    <g className="mv-announce-wave">
      <path d="M150 28v18" />
      <path d="M141 37h18" />
    </g>
    {/* הווי — היעד הושג */}
    <circle cx="150" cy="100" r="19" className="mv-announce-badge" />
    <path className="mv-announce-tick" d="M142 100l6 6 11-13" />
  </>
);

const WHATSAPP_ART = (
  <>
    {/* הכתם הרך שמאחורי הכול — אותו תפקיד כמו בקובץ העיצוב */}
    <ellipse cx="96" cy="74" rx="86" ry="60" className="mv-announce-blob" />
    {/* בועת שיחה: הפנייה שמגיעה מהמתווך */}
    <path
      className="mv-announce-bubble"
      d="M40 34h96a12 12 0 0 1 12 12v46a12 12 0 0 1-12 12H70l-20 17V104h-10a12 12 0 0 1-12-12V46a12 12 0 0 1 12-12Z"
    />
    {/* גלי הקול של ההקלטה — מה שהסוכן מקבל ומבין */}
    <g className="mv-announce-wave">
      <path d="M58 76v-14" />
      <path d="M72 82v-26" />
      <path d="M86 87v-36" />
      <path d="M100 82v-26" />
      <path d="M114 78v-18" />
      <path d="M128 73v-8" />
    </g>
    {/* הווי — הבקשה בוצעה */}
    <circle cx="150" cy="100" r="19" className="mv-announce-badge" />
    <path className="mv-announce-tick" d="M142 100l6 6 11-13" />
  </>
);

/** ‎**מהחדש לישן.** הכרזה חדשה נוספת בראש הרשימה. */
const ANNOUNCEMENTS: readonly Announcement[] = [
  {
    id: "announce-mentor-launch",
    title: "המנטור האישי שלך כאן",
    text: "יעד לשבוע, סיכום במוצאי שבת, ושיחה על מה לשפר — רק מולך, אף פעם לא מול אחרים. גם בוואטסאפ.",
    cta: { label: "לפגוש את המנטור", href: "/mentor" },
    art: MENTOR_ART,
    requires: "mentor",
  },
  {
    id: "announce-wa-agent-launch",
    title: "הסוכן הקולי עובד עכשיו גם בוואטסאפ",
    text: "אפשר לנהל את כל המערכת מהוואטסאפ — הסוכן מקבל הקלטות, מבין מה ביקשתם ומבצע בשבילכם. בלי להיכנס לדשבורד.",
    cta: { label: "להצטרפות לשירות", request: WA_REQUEST_TEXT },
    art: WHATSAPP_ART,
  },
];

export function SystemUpdate({
  mentor,
}: {
  /** למשרד יש את המנטור (המאמן החכם במסלול) — אחרת ההכרזה עליו אינה מוצגת */
  mentor: boolean;
}): React.JSX.Element | null {
  const [dismissedToday, dismissToday] = useDismissedToday("system-update");
  const forever = useUserDismissedSet();
  const [index, setIndex] = useState(0);

  const slides = ANNOUNCEMENTS.filter(
    (item) =>
      (item.requires !== "mentor" || mentor) && !forever.has(item.id),
  ).slice(0, MAX_SLIDES);

  /*
   * ‎`ready` ולא רק `has`: לפני שהתשובה הגיעה איננו יודעים מה הוסתר,
   * והצגה כזו מהבהבת הכרזה למי שכבר ביקש לא לראות אותה.
   */
  if (dismissedToday || !forever.ready || slides.length === 0) return null;

  /*
   * ‏השקופית שנסגרה „לתמיד” יורדת מהרשימה, ולכן המצביע עלול להצביע
   * ‏אל מעבר לסוף. הצמדה בזמן הרינדור ולא ב-`useEffect`: אחרת יש
   * ‏פריים אחד עם `undefined`.
   */
  const at = Math.min(index, slides.length - 1);
  const slide = slides[at];
  if (slide === undefined) return null;

  /*
   * ‏משתנה מקומי ולא `slide.cta` בתוך ה-JSX: ההצרה של איחוד
   * ‏מותייגת אינה שורדת קריאה מחדש של תכונה בתוך סגור.
   */
  const cta = slide.cta;
  const many = slides.length > 1;
  const go = (next: number): void => setIndex((next + slides.length) % slides.length);

  return (
    <section className="mv-announce" aria-labelledby="announce-title">
      <button
        type="button"
        className="mv-announce-close"
        onClick={dismissToday}
        aria-label="סגירת ההודעות להיום"
      >
        <IconX s={16} />
      </button>

      <div className="mv-announce-body">
        <p className="mv-announce-kicker">
          <span className="mv-announce-tag">חדש</span>
          עדכון מערכת
          {/*
            ‏„2 מתוך 3” נאמר במילים ולא רק בנקודות: הנקודות הן סימן
            ‏מקום, והמספר הוא מה שנקרא בקול.
          */}
          {many ? (
            <span style={{ color: "var(--color-text-muted)" }}>
              {" · "}
              {at + 1} מתוך {slides.length}
            </span>
          ) : null}
        </p>

        {/*
          ‎`key` על השקופית — בלעדיו React ממחזר את אותם צמתים
          והאנימציה אינה רצה מחדש במעבר.
        */}
        <div key={slide.id} className="mv-slide-in">
          <h2 id="announce-title" className="mv-announce-title">
            {slide.title}
          </h2>
          <p className="mv-announce-text">{slide.text}</p>
        </div>

        <div className="mv-announce-actions">
          {"href" in cta ? (
            <Link href={cta.href} className="mv-announce-cta inline-flex no-underline">
              {cta.label}
            </Link>
          ) : (
            <button
              type="button"
              className="mv-announce-cta"
              onClick={() => openSupport({ kind: "question", text: cta.request })}
            >
              {cta.label}
            </button>
          )}
          <button
            type="button"
            className="mv-announce-dismiss"
            onClick={() => forever.never(slide.id)}
          >
            לא להציג יותר
          </button>
        </div>

        {/*
          ‏הניווט מוצג רק כשיש לאן לנווט. חיצים ונקודות על שקופית
          יחידה הם פקדים שאינם עושים דבר.
        */}
        {many ? (
          <div className="mt-2 flex items-center gap-2">
            {/*
              ‏בעברית „הקודם” הוא לכיוון ימין. `IconChevronRight`
              מצביע לשם, ולכן הוא על הכפתור הזה ולא על השני.
            */}
            <button
              type="button"
              className="mv-btn-plain mv-btn-icon"
              onClick={() => go(at - 1)}
              aria-label="ההכרזה הקודמת"
            >
              <IconChevronRight s={16} />
            </button>
            <button
              type="button"
              className="mv-btn-plain mv-btn-icon"
              onClick={() => go(at + 1)}
              aria-label="ההכרזה הבאה"
            >
              <IconChevronLeft s={16} />
            </button>
            <span className="flex items-center gap-1.5">
              {slides.map((item, i) => (
                <button
                  key={item.id}
                  type="button"
                  className="mv-slide-dot"
                  aria-current={i === at}
                  aria-label={`הכרזה ${i + 1} מתוך ${slides.length}`}
                  onClick={() => setIndex(i)}
                />
              ))}
            </span>
          </div>
        ) : null}
      </div>

      {/* האיור דקורטיבי — `aria-hidden`, כדי שקורא מסך לא יקריא צורות */}
      <svg className="mv-announce-art" viewBox="0 0 200 140" aria-hidden="true">
        {slide.art}
      </svg>
    </section>
  );
}
