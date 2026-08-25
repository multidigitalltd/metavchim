import Link from "next/link";
import { LogoMark } from "./icons";

/**
 * המעטפת של מסכי הכניסה — התחברות, הרשמה, איפוס והחלפת סיסמה.
 *
 * ארבעת המסכים היו ארבעה טפסים על רקע ריק, כל אחד עם הכותרת שלו,
 * בזמן שכל שאר המערכת כבר עוצבה. משרד ששוקל להצטרף רואה את המסך הזה
 * לפני שהוא רואה משהו אחר.
 *
 * הלוח הימני נושא את הבטחת הערך ולא רק את הלוגו: מי שהגיע לדף
 * ההרשמה מקישור צריך לדעת למה הוא נרשם, ומי שמאפס סיסמה מקבל תזכורת
 * שקטה למה הוא חוזר.
 */

export function AuthShell({
  title,
  subtitle,
  points,
  children,
  foot,
}: {
  title: string;
  subtitle?: string;
  /** שלוש הבטחות בלוח המותג; ברירת מחדל — הניסוח של דף הכניסה. */
  points?: string[];
  children: React.ReactNode;
  foot?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="mv-auth">
      <aside className="mv-auth-brand">
        <div className="mv-auth-brand-logo">
          <LogoMark s={26} />
          <span>
            מתווכים<span style={{ color: "var(--color-action)" }}>.</span>
          </span>
        </div>
        <h1>המתווך סוגר עסקאות. המערכת מטפלת בכל השאר.</h1>
        <p>מערכת ניהול למשרדי תיווך בישראל — נכסים, קונים, התאמות והצעות במקום אחד.</p>
        <ul className="mv-auth-points">
          {(points ?? DEFAULT_POINTS).map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      </aside>

      <div className="mv-auth-panel">
        <main id="main-content" className="mv-auth-card">
          <h2>{title}</h2>
          {subtitle ? <p className="mv-auth-sub">{subtitle}</p> : null}
          {children}
          {foot ? <div className="mv-auth-foot">{foot}</div> : null}
          <p className="mv-auth-foot" style={{ fontSize: "var(--type-caption)" }}>
            <Link href="/privacy" className="underline">
              פרטיות
            </Link>
            {" · "}
            <Link href="/terms" className="underline">
              תנאי שימוש
            </Link>
            {" · "}
            <Link href="/accessibility" className="underline">
              נגישות
            </Link>
          </p>
        </main>
      </div>
    </div>
  );
}

/**
 * שלוש ההבטחות בלוח המותג.
 *
 * "הכול בעברית, מימין לשמאל, ונגיש" ישב כאן ונמחק: זו דרישת סף
 * למערכת ישראלית, לא סיבה לבחור בה — אף משרד לא מתלבט בין מערכות
 * לפי כיוון הכתיבה. מה שבאמת אין במקום אחר הוא הרשת: קונה שאין לו
 * נכס ונכס שאין לו קונה יושבים בשני משרדים שונים, והמערכת מחברת
 * ביניהם — בשיתוף פעולה על ביקושים ובהפניית לקוחות שאינם מתאימים.
 */
const DEFAULT_POINTS = [
  "התאמת קונים לנכסים — עם הסבר לכל התאמה",
  "הצעות בוואטסאפ בלחיצה, ודף נחיתה לכל נכס",
  "רשת שיתופי פעולה בין משרדים — ביקושים והפניות לקוחות",
];
