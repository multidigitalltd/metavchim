"use client";

import Link from "next/link";
import { IconX } from "./icons";
import { useDismissedToday } from "./notice";
import { openSupport } from "./support-button";

/**
 * הודעת עדכון מערכת בראש הדשבורד.
 *
 * ## למה זה לא `Notice`
 *
 * `Notice` הוא משוב על פעולה — הצליח, נכשל, שים לב. זו הכרזה: היא
 * מספרת על יכולת חדשה, היא מזמינה לפעולה, והיא נראית אחרת בכוונה.
 * שימוש באותו רכיב לשני הדברים היה גורם להודעת „נשמר בהצלחה”
 * להיראות כמו קמפיין.
 *
 * ## למה איקס ולא היעלמות אוטומטית
 *
 * מי שקרא וסגר אמר „הבנתי”. הסגירה שווה ליום (`useDismissedToday`)
 * ולא לצמיתות: הכרזה על יכולת מרכזית ראויה להזדמנות שנייה למי
 * שסגר בטעות בדרך לפגישה, אבל לא להיות מטרד קבוע.
 *
 * ## הכרזה אחת, החדשה
 *
 * הכרטיס הוא „עדכון מערכת” — יחיד. שתי הכרזות זו מעל זו הן קיר,
 * ובדיוק המסך הזה מתחיל את היום. לכן הכרטיס מציג את ההכרזה
 * **החדשה ביותר** שמתאימה למשרד, והקודמות נשארות כאן כרשומה של מה
 * שהוכרז — ומי שסוגר סוגר את הכרטיס ליום, לא עובר להכרזה הישנה.
 *
 * ## המנטור — רק למי שיש לו
 *
 * המנטור נפתח עם המאמן החכם, ולמשרד שאין לו אותו הכרזה עליו היא
 * פרסומת ולא עדכון. משרד כזה רואה את ההכרזה הקודמת.
 */

/** נוסח הפנייה שנפתח בטופס — המתווך רק מוסיף מה שירצה ושולח. */
const WA_REQUEST_TEXT = "אשמח להצטרף לשירות הסוכן בוואטסאפ. נא צרו איתי קשר.";

export function SystemUpdate({
  mentor,
}: {
  /** למשרד יש את המנטור (המאמן החכם במסלול) — אחרת מציגים את ההכרזה הקודמת */
  mentor: boolean;
}): React.JSX.Element | null {
  return mentor ? <MentorLaunch /> : <WhatsAppLaunch />;
}

function MentorLaunch(): React.JSX.Element | null {
  const [dismissed, dismiss] = useDismissedToday("mentor-launch");
  if (dismissed) return null;

  return (
    <section className="mv-announce" aria-labelledby="announce-mentor-title">
      <button
        type="button"
        className="mv-announce-close"
        onClick={dismiss}
        aria-label="סגירת ההודעה"
      >
        <IconX s={16} />
      </button>

      <div className="mv-announce-body">
        <p className="mv-announce-kicker">
          <span className="mv-announce-tag">חדש</span>
          עדכון מערכת
        </p>
        <h2 id="announce-mentor-title" className="mv-announce-title">
          המנטור האישי שלך כאן
        </h2>
        <p className="mv-announce-text">
          יעד לשבוע, סיכום במוצאי שבת, ושיחה על מה לשפר — רק מולך, אף פעם לא מול
          אחרים. גם בוואטסאפ.
        </p>
        <Link href="/mentor" className="mv-announce-cta inline-flex no-underline">
          לפגוש את המנטור
        </Link>
      </div>

      {/*
        האיור דקורטיבי — `aria-hidden`. אותם טוקנים כמו ההכרזה הקודמת,
        ולכן מתהפך נכון במצב כהה: מטרה (היעד), ניצוץ (המנטור), ווי (הושג).
      */}
      <svg className="mv-announce-art" viewBox="0 0 200 140" aria-hidden="true">
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
      </svg>
    </section>
  );
}

function WhatsAppLaunch(): React.JSX.Element | null {
  const [dismissed, dismiss] = useDismissedToday("wa-agent-launch");
  if (dismissed) return null;

  return (
    <section className="mv-announce" aria-labelledby="announce-wa-title">
      <button
        type="button"
        className="mv-announce-close"
        onClick={dismiss}
        aria-label="סגירת ההודעה"
      >
        <IconX s={16} />
      </button>

      <div className="mv-announce-body">
        <p className="mv-announce-kicker">
          <span className="mv-announce-tag">חדש</span>
          עדכון מערכת
        </p>
        <h2 id="announce-wa-title" className="mv-announce-title">
          הסוכן הקולי עובד עכשיו גם בוואטסאפ
        </h2>
        <p className="mv-announce-text">
          אפשר לנהל את כל המערכת מהוואטסאפ — הסוכן מקבל הקלטות, מבין מה ביקשתם ומבצע
          בשבילכם. בלי להיכנס לדשבורד.
        </p>
        <button
          type="button"
          className="mv-announce-cta"
          onClick={() => openSupport({ kind: "question", text: WA_REQUEST_TEXT })}
        >
          להצטרפות לשירות
        </button>
      </div>

      {/*
        האיור דקורטיבי — `aria-hidden`, כדי שקורא מסך לא יקריא צורות.
        SVG ולא תמונה: הוא נצבע בטוקנים של המערכת ולכן מתהפך נכון
        במצב כהה, בזמן שקובץ תמונה היה נשאר בהיר על רקע כהה.
      */}
      <svg className="mv-announce-art" viewBox="0 0 200 140" aria-hidden="true">
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
      </svg>
    </section>
  );
}
