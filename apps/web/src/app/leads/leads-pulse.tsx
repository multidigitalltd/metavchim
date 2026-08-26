"use client";

import { jerusalemWallParts, leadWaiting } from "@metavchim/shared";
import { IconBolt, IconClock, IconFlame, IconInbox } from "../icons";

/**
 * שלושת המספרים שמעל רשימת הלידים.
 *
 * ## למה
 *
 * המסך נפתח ישר לתוך טבלה, ולכן השאלה היחידה שמתווך שואל בבוקר —
 * **„מה בוער”** — נענתה בספירה בעיניים. שורה שדורשת טיפול אנושי
 * נראתה בדיוק כמו שורה שנפתחה לפני דקה, רק בצבע אחר בעמודה אחת.
 *
 * ## למה האריחים לוחצים
 *
 * מספר שאי אפשר ללחוץ עליו הוא מספר שצריך לפעול לפיו ידנית: לראות
 * „4 דחופים” ואז לחפש אותם בסינון זה בדיוק המסלול הארוך שהאריח
 * נועד לקצר. לחיצה שנייה מבטלת — סינון שאי אפשר לצאת ממנו בלחיצה
 * הוא מלכודת.
 */

interface LeadLike {
  status: string;
  requiresHuman: boolean;
  createdAt: string;
}

export function LeadsPulse({
  items,
  now,
  urgency,
  onPick,
}: {
  items: LeadLike[];
  /**
   * „עכשיו” מגיע מבחוץ ואינו נקרא כאן.
   *
   * ‎`new Date()`‎ ברינדור שרת ורינדור לקוח נותן שתי תוצאות, ו-React
   * מתלונן על אי-התאמה. המסך כבר מחזיק את הערך הזה אחרי ההרכבה.
   */
  now: Date | null;
  urgency: string;
  onPick: (next: string) => void;
}): React.JSX.Element {
  const open = items.filter((lead) => lead.status !== "closed" && lead.status !== "converted");
  const urgent = items.filter((lead) => lead.requiresHuman);
  /*
   * פונקציות ולא תנאי מוטבע: ההצרה של `now` אינה שורדת לתוך
   * ה-callback של `filter`, והחלופה הייתה `as Date` — כלומר להשתיק
   * את הבודק במקום לענות לו.
   */
  const late = now === null ? [] : countLate(items, now);
  const today = now === null ? [] : countToday(items, now);

  return (
    <div className="mv-stat-grid mb-[14px]">
      <Tile icon={<IconInbox s={18} />} label="פתוחים" value={open.length} />
      <Tile
        icon={<IconFlame s={18} />}
        label="דורשים טיפול אנושי"
        value={urgent.length}
        tone="danger"
        active={urgency === "human"}
        onClick={() => onPick("human")}
      />
      <Tile
        icon={<IconClock s={18} />}
        label="ממתינים יותר מדי"
        value={late.length}
        tone="warning"
        active={urgency === "late"}
        onClick={() => onPick("late")}
      />
      <Tile icon={<IconBolt s={18} />} label="נכנסו היום" value={today.length} tone="success" />
    </div>
  );
}

/*
 * `leadWaiting` מחזיר `null` לסטטוס שאינו באחריות הסוכן (נסגר,
 * הומר). זה לא מקרה קצה אלא רוב הרשימה אחרי כמה שבועות — ליד סגור
 * אינו „ממתין”, וספירה שלו הייתה הופכת את המספר לחסר משמעות.
 */
function countLate(items: LeadLike[], at: Date): LeadLike[] {
  return items.filter((lead) => leadWaiting(lead.createdAt, lead.status, at)?.level === "late");
}

/*
 * „היום” הוא היום **בישראל**, ולא היום של המכשיר.
 *
 * ‎`toDateString()` על שני הצדדים קורא את שעון המכשיר, ולכן על
 * מכשיר בניו-יורק הדלי „נכנסו היום” היה היום הניו-יורקי: ליד
 * שנקלט ב-01:30 בישראל נספר אצל אתמול, וליד של אתמול בערב נספר
 * אצל היום (ביקורת Codex). ההשוואה נעשית על תאריך הקיר הירושלמי.
 */
function countToday(items: LeadLike[], at: Date): LeadLike[] {
  const today = jerusalemWallParts(at).date;
  return items.filter((lead) => jerusalemWallParts(new Date(lead.createdAt)).date === today);
}

const TONE_COLOR = {
  danger: "var(--color-danger)",
  warning: "#8a6414",
  success: "var(--color-success)",
} as const;

function Tile({
  icon,
  label,
  value,
  tone,
  active = false,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone?: keyof typeof TONE_COLOR;
  active?: boolean;
  onClick?: () => void;
}): React.JSX.Element {
  /*
   * אריח בלי ערך נשאר אפור. צבע אזהרה על „0 דחופים” מלמד להתעלם
   * מהצבע, וביום שיהיה דחוף אחד הוא כבר לא יסב תשומת לב.
   */
  const color = tone !== undefined && value > 0 ? TONE_COLOR[tone] : "var(--color-text)";
  const body = (
    <>
      <span className="flex items-center gap-2" style={{ color: "var(--color-text-muted)" }}>
        {icon}
        {label}
      </span>
      <strong style={{ fontSize: "calc(24 / 16 * 1rem)", fontWeight: 800, color }}>{value}</strong>
    </>
  );

  if (onClick === undefined) return <div className="mv-stat-tile">{body}</div>;
  return (
    <button
      type="button"
      className="mv-stat-tile mv-stat-tile--pick"
      aria-pressed={active}
      onClick={onClick}
    >
      {body}
    </button>
  );
}
