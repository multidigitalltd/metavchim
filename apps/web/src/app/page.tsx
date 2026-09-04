"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  formatJerusalemTime,
  groupTasksByBucket,
  isTaskUrgent,
  jerusalemDayRange,
  JERUSALEM_TZ,
  readinessFieldLabel,
  recommendationCapabilities,
  recommendationHref,
  taskBucket,
  labelOf,
  type CoachRecommendation,
} from "@metavchim/shared";
import { apiGet, ApiError, apiList } from "@/lib/api";
import { MATURITY_LABELS } from "@/lib/format";
import { readinessHref } from "@/lib/readiness";
import { can, useRequireAuth } from "@/lib/use-auth";
import { useFeature, useFeaturesFailed, useFeaturesReady } from "@/lib/use-features";
import { useMinuteNow } from "@/lib/use-minute-now";
import { VoiceConsole } from "./voice-console";
import { DuplicateContacts } from "./duplicate-contacts";
import { LoadError } from "./load-error";
import { SetupBanner } from "./setup-banner";
import { SystemUpdate } from "./system-update";
import { NowStamp } from "./now-stamp";
import { Celebration, type CelebrationEvent } from "./celebration";
import {
  IconBell,
  IconBolt,
  IconCalendar,
  IconCheck,
  IconFlame,
  IconHandshake,
  IconHome,
  IconLink,
  IconList,
  IconSend,
  IconStar,
  IconUsers,
  IconWarning,
} from "./icons";

/**
 * דשבורד לפי קובץ העיצוב: ברכה עם תאריך, ארבעה כרטיסי מונים,
 * ולוח דו-טורי — "מה חשוב לעשות היום" (שורות ממוספרות) לצד
 * "היום ביומן" וכרטיס קידום הקליטה בקול.
 *
 * הפעולות נגזרות מהדאטה האמיתי (docs/06 §2): לידים שדורשים אדם,
 * המלצות עוזר המכירות, נכסים לא מושלמים וקונים חמים.
 */

interface PropertyRow {
  id: string;
  city?: string;
  street?: string;
  status?: string;
  readinessScore: number;
  missingFields: string[];
}

interface BuyerRow {
  id: string;
  contact: { name: string };
  maturity: string;
}

interface LeadRow {
  id: string;
  contact: { name: string };
  status: string;
  requiresHuman: boolean;
  requiresHumanReason?: string;
}

interface AppointmentRow {
  id: string;
  kind: string;
  title?: string;
  leadId?: string;
  propertyId?: string;
  startsAt: string;
  status: string;
}

/**
 * פילוח שנספר בבסיס הנתונים.
 *
 * הגרפים חושבו קודם מתוך 100 הרשומות שהרשימה טענה, ולכן במשרד עם
 * יותר מכך הוצגה התפלגות של מדגם שרירותי כאילו היא של המאגר כולו.
 */
type Breakdown<K extends string> = { total: number } & Record<K, Record<string, number>>;

interface OfferRow {
  id: string;
  status: string;
  openCount: number;
}

/** משימה פתוחה שלי — הדשבורד מציג את הדחופות, המסך המלא את השאר. */
interface TaskRowDto {
  id: string;
  title: string;
  dueAt?: string;
  status: string;
  priority: string;
  createdAt?: string;
  entityLabel?: string;
}

/** הדופק של המנטור — מה שיש לחגוג השבוע (GET /mentor/pulse). */
interface MentorPulse {
  weekStart: string;
  goalsDone: { id: string; label: string; period: "week" | "month"; periodStart: string }[];
  wins: {
    id?: string;
    kind: "deal_closed" | "exclusivity_signed" | "offer_interested" | "coop_deal";
    title: string;
  }[];
}

/** אותם אירועים כמו במסך המנטור — ובאותם מפתחות, כדי שחגיגה שיצאה שם לא תחזור כאן. */
function celebrationEvents(pulse: MentorPulse): CelebrationEvent[] {
  const goals = pulse.goalsDone.map((g) => ({
    key: `goal:${g.id}:${g.periodStart}`,
    label: `היעד הושג: ${g.label}`,
  }));
  const wins = pulse.wins.map((w, i) => ({
    key: `win:${w.id ?? `${pulse.weekStart}:${w.kind}:${w.title}:${i}`}`,
    label: winLabel(w),
  }));
  return [...goals, ...wins];
}

function winLabel(win: MentorPulse["wins"][number]): string {
  switch (win.kind) {
    case "deal_closed":
      return `סגרתם את ${win.title}`;
    case "exclusivity_signed":
      return `חתמתם בלעדיות על ${win.title}`;
    case "offer_interested":
      return `קונה אמר „מעוניין” על ${win.title}`;
    case "coop_deal":
      return `עסקת שיתוף פעולה — ${win.title}`;
  }
}

/**
 * סיכום הרשת. **מספרים מהשרת ולא סינון של רשימות** — הרשימות חתוכות
 * ל-100 שורות, ומספר שנגזר מהן משקר בדיוק במשרד העמוס שבו הוא חשוב.
 */
interface NetworkSummary {
  incomingOffers: number;
  openReferrals: number;
  credits: number;
}

const APPOINTMENT_KIND_LABELS: Record<string, string> = {
  viewing: "סיור בנכס",
  meeting: "פגישה",
  call: "שיחה",
};

/*
 * ‎**המסך מציג בשעון ישראל, כי בשעון ישראל הוא גם מחליט.**
 *
 * כל ההכרעות כאן ירושלמיות: הטווח שהבקשה מבקשת, `dayKey` שקובע מתי
 * מרעננים, `startsToday` שמכריע מה „של היום”, ו-`taskBucket`
 * שמכריע מה „באיחור”. העיצוב הזמני הישן היה בשעון הדפדפן, ולכן
 * מתווך בחו"ל קיבל שורה שסוננה כ„היום בירושלים” ומודפסת בשעה
 * ניו-יורקית: פגישת 09:00 מוצגת „היום 02:00” (ביקורת Codex).
 *
 * אזור הזמן נקבע כאן, במקום ההגדרה, ולא בכל אתר קריאה — ארבעה
 * צרכנים משתמשים בשני העיצובים האלה, ותיקון באחד מהם היה משאיר
 * שלושה שסותרים אותו.
 */
const timeFmt = { format: formatJerusalemTime };
/* בלי שנה — „24.08”. `formatJerusalemDate` כולל שנה ומשמש במסמכים. */
const dayFmt = new Intl.DateTimeFormat("he-IL", {
  timeZone: JERUSALEM_TZ,
  day: "2-digit",
  month: "2-digit",
});

/**
 * מתי המשימה. "באיחור" ו"היום" ולא תאריך: אלה שתי המילים שקובעות אם
 * נוגעים בה עכשיו, ותאריך מספרי דורש מהקורא לחשב אותן בעצמו.
 *
 * החלוקה עצמה מגיעה מ-`taskBucket` המשותף ולא מחישוב מקומי (ביקורת
 * Codex): שם "באיחור" הוא **רגע שחלף** ולא יום שחלף — משימה ל-09:00
 * היא באיחור ב-11:00 ולא "היום" — והגבולות נמדדים בלוח ירושלמי, כך
 * שדפדפן באזור זמן אחר מקבל את אותה תשובה.
 */
function dueLabel(dueAt: string | undefined, now: Date): { text: string; urgent: boolean } {
  const bucket = taskBucket(dueAt ?? null, now);
  if (bucket === "someday") return { text: "ללא יעד", urgent: false };
  if (bucket === "overdue") return { text: "באיחור", urgent: true };
  const due = new Date(dueAt as string);
  if (bucket === "today") return { text: `היום ${timeFmt.format(due)}`, urgent: true };
  return { text: dayFmt.format(due), urgent: false };
}

/*
 * הטיפוס עצמו מגיע מ-`shared` ואינו משוכפל כאן: עותק מקומי היה
 * הדרך שבה ענף `offer` נשמט מלכתחילה — הוא היה קיים בהגדרה ולא
 * בטיפול.
 */
type Recommendation = CoachRecommendation;

/*
 * ‎**היעד נקבע ב-`shared`, ליד הפונקציה שמייצרת את ההמלצות.**
 *
 * העותק שהיה כאן החזיר `null` לארבעה מעשרת הסוגים — שלושה מצרפים
 * שנכתבים בלי `entityId`, ו-`hesitating_buyer` שנושא
 * ‎`entityType: "offer"` שלא היה לו ענף. כל אחד מהם דחוף מספיק כדי
 * לקבל את השורה הראשונה, כלומר להיבחר כ„הדבר לעשות עכשיו”
 * **בלי דרך לפעול** (ביקורת Codex).
 *
 * ‎`recommendationHref` יושבת עכשיו לצד `buildRecommendations`, עם
 * בדיקה שמונה את הסוגים במקום לדגום אותם: סוג חדש שייכתב שם ואין
 * לו יעד — ייפול בבנייה, ולא יגיע למסך.
 */
const recHref = recommendationHref;

/**
 * ברכה לפי שעת היום — הדשבורד בעיצוב פותח ב"בוקר טוב".
 *
 * ‎**החריג היחיד שבו שעון המכשיר הוא התשובה הנכונה.** כל מועד אחר
 * במערכת הוא ישראלי — פגישה, משימה, גבול יום — אבל הברכה מדברת אל
 * מי שמסתכל על המסך. מתווך שיושב בניו-יורק בשמונה בבוקר צריך
 * לקרוא "בוקר טוב", ולא "ערב טוב" כי בישראל כבר ערב.
 */
function greeting(): string {
  const hour = new Date().getHours(); /* שעון-המכשיר-במכוון: ראו למעלה */
  if (hour < 12) return "בוקר טוב";
  if (hour < 18) return "צהריים טובים";
  return "ערב טוב";
}

/*
 * הדומיין של שורת פעולה — **על מה היא**, ולא כמה היא דחופה.
 *
 * השדה נקרא קודם `tone` ונשא ארבע פלטות הקסה מקומיות. שני דברים
 * היו שגויים בו: הצבעים לא עברו מיפוי למצב כהה, ובעיקר — „דחיפות”
 * כבר נאמרת על ידי המיקום ברשימה ועל ידי כלל השורה הראשונה. צבע
 * שאומר שוב „דחוף” מבזבז את הממד היחיד שיכול לומר „וזה נכס”.
 *
 * לכן חמשת הדומיינים של §4, ולפי נושא: אפרסק לדחיפות, ענבר
 * להמתנה, כחול לנכסים, סגול למנוע ההתאמות, ירוק לסוכן ולשת"פ.
 */
type ActionDomain = "green" | "peach" | "violet" | "blue" | "amber" | "neutral";

interface TaskRow {
  key: string;
  /**
   * ‎**הדחיפות, על הסולם של עוזר המכירות** (`buildRecommendations`).
   *
   * בלי זה הדירוג היה סדר ההוספה: לידים שדורשים אדם נדחפו ראשונים,
   * ולכן קיבלו את הרקע ואת הכפתור הראשי גם כשהמלצה דחופה יותר
   * חיכתה מתחתיהם. כל עוד כל השורות נראו זהות זו הייתה רק רשימה לא
   * ממוינת; מרגע שהשורה הראשונה מכריזה „זה הדבר לעשות עכשיו”, סדר
   * ההוספה הפך לטענה שגויה על המציאות (ביקורת Codex).
   *
   * המספרים אינם מומצאים: הם נלקחים מ-`buildRecommendations`, שכבר
   * מדרג בדיוק את אותם מושגים. השורה היחידה בלי מקבילה שם היא „ליד
   * חדש ממתין” — ראו `PRIORITY`.
   */
  priority: number;
  domain: ActionDomain;
  title: string;
  why: string;
  action: string;
  href: string | null;
  /**
   * אייקון לפי **סוג** הפעולה ולא לפי דחיפותה.
   *
   * הצבע כבר מסמן דחיפות; האייקון עונה על השאלה השנייה — "מה זה
   * בכלל?" — ומאפשר לזהות שורה בסריקה, לפני קריאת הכותרת.
   */
  icon: ReactNode;
}

/**
 * דחיפות לשורות שהדשבורד גוזר בעצמו.
 *
 * הערכים מועתקים מ-`buildRecommendations` ב-`shared`, שמדרג את אותם
 * מושגים בדיוק — ולכן שתי הרשימות מתמזגות לסולם אחד ולא לשניים.
 *
 * ‎**`newLead` הוא היחיד בלי מקבילה שם**, ולכן היחיד שהוא הכרעה
 * שלי: מתחת לליד שדורש אדם (100) ומתחת להצעת שת"פ שממתינה לתשובה
 * (95, כי משרד אחר מחכה לנו), ומעל קונה חם בלי הצעה (70). ליד שהגיע
 * לפני רגע יהפוך ל-`stale_lead` (110) אם יישאר בלי מענה — כלומר
 * המיקום כאן הוא תחילת אותו שעון.
 */
const PRIORITY = {
  /** `today_appointment` */
  todayAppointment: 105,
  /** `urgent_lead` */
  urgentLead: 100,
  /** `pending_coop_offers` */
  pendingCoopOffers: 95,
  /** אין מקבילה — ראו ההסבר למעלה */
  newLead: 92,
  /** `overdue_task` */
  overdueTask: 85,
  /** `hot_buyers_idle` */
  hotBuyer: 70,
  /** `incomplete_property` */
  incompleteProperty: 40,
} as const;

export default function DashboardPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const canVoice = useFeature("voice_intake");
  /*
   * שני האזורים שאינם לכל משרד ולא לכל סוכן.
   *
   * `featuresReady` אינו קישוט: `useFeature` מחזיר „כן” כל עוד
   * הרשימה לא הגיעה — נכון לכפתור שלא כדאי שיקפוץ, ושגוי לבקשת
   * רשת שתחזור 403 ותירשם באבחון. הוא חוסם **רק** את הקריאה
   * לסוכן (`loadCoach`), ולא את הדשבורד כולו — ראו ההסבר שם.
   */
  const featuresReady = useFeaturesReady();
  const featuresFailed = useFeaturesFailed();
  const hasCoach = useFeature("ai_coach");
  /*
   * ‎**הדופק של המנטור — לחגוג גם בדשבורד.** יעד שהושג לא מחכה
   * שייכנסו למסך המנטור; הקונפטי יוצא במקום שבו נמצאים. אותם
   * מפתחות כמו במסך המנטור, ולכן החגיגה יוצאת פעם אחת בלבד —
   * במסך הראשון שנפתח. שקט מוחלט בכישלון: הדופק הוא קישוט לכרטיס,
   * לא מקור אמת, ואין מה להציג „נסו שוב” עליו.
   */
  const [mentorPulse, setMentorPulse] = useState<MentorPulse | null>(null);
  /*
   * „עכשיו” אחד לכל המסך, **ומתקדם מעצמו**. קודם הוא חושב בזמן
   * הרינדור, ולכן קפא: מסך שנשאר פתוח המשיך להציג פגישת 09:00
   * כפעולה הדחופה ביותר גם אחרי שהתחילה (ביקורת Codex).
   */
  const now = useMinuteNow();
  /*
   * ‎**מפתח היום — כדי שחצות יביא נתונים חדשים ולא רק יסנן ישנים.**
   *
   * ‎`today` נשלף פעם אחת לטווח היום שהיה בזמן הטעינה. שעון חי מסיר
   * ממנו את פגישות אתמול, אבל אינו יכול לגלות את פגישות היום החדש —
   * והרשימה נשארת „מלאה” (`today !== null`), ולכן הדירוג ממשיך
   * להכריז בזמן שפגישה בדחיפות 105 קיימת ואינה ידועה (ביקורת Codex).
   *
   * הגבול נמדד בשעון ישראל ולא בשעון הדפדפן, מאותה פונקציה שהשרת
   * משתמש בה — אחרת מתווך שנוסע לחו"ל מקבל „יום” אחר מהשרת.
   */
  const dayRange = jerusalemDayRange(now);
  const dayKey = dayRange.start.getTime();
  /*
   * ‎**„של היום” נקבע מהערך, לא ממקורו.**
   *
   * ‎`today` הוא „הפגישות של יום כלשהו” — היום שהיה כשהבקשה יצאה.
   * כל צרכן שקרא אותו כ„הפגישות של היום” נשען על ההנחה שהמערך
   * טרי, ובחצות היא נשברת: `todayEvents` סינן לפי סטטוס בלבד,
   * ולכן הציג את פגישות אתמול כל עוד הבקשה החדשה באוויר — ולתמיד
   * אם היא נכשלה (ביקורת Codex).
   *
   * זו הפעם הרביעית שאותה טעות חוזרת בקובץ הזה, ובכל פעם על צרכן
   * אחר. לכן הבדיקה אינה במקום שדווח אלא בערך עצמו: מסננת אחת
   * שכל מי שמדבר על „היום” עובר דרכה. מערך ישן אינו יכול לייצר
   * שורה שגויה גם אם הרענון נכשל, וגם אם מישהו יוסיף צרכן חמישי.
   */
  const startsToday = (a: AppointmentRow): boolean => {
    const at = new Date(a.startsAt).getTime();
    return at >= dayRange.start.getTime() && at < dayRange.end.getTime();
  };
  /*
   * כל מקור נתונים בדשבורד מאחורי היכולת שהשרת דורש עבורו — לא רק
   * ההצעות. כל אחת מהיכולות האלה ניתנת לשלילה פרטנית למשתמש בודד
   * (`capability-overrides`), ואז הנתיב מחזיר 403.
   *
   * בלי השערים האלה השלילה נראתה כמו נתונים: „אין פגישות מתוכננות
   * להיום” למי שאינו רשאי לראות את היומן, ומוני נכסים/קונים/לידים
   * שנתקעים על „…” לנצח — ואיתם `loading` שלעולם לא נגמר, שמשאיר
   * את „מה חשוב לעשות היום” על „טוען…” לצמיתות (ביקורת Codex).
   */
  const canSeeOffers = can(user, "offers.send");
  const canSeeProperties = can(user, "properties.view");
  const canSeeBuyers = can(user, "buyers.view_own");
  const canSeeLeads = can(user, "leads.view_own");
  const canSeeCalendar = can(user, "calendar.manage");
  const [properties, setProperties] = useState<PropertyRow[] | null>(null);
  const [buyers, setBuyers] = useState<BuyerRow[] | null>(null);
  const [leads, setLeads] = useState<LeadRow[] | null>(null);
  const [today, setToday] = useState<AppointmentRow[] | null>(null);
  const [recs, setRecs] = useState<Recommendation[] | null>(null);
  const [offers, setOffers] = useState<OfferRow[] | null>(null);
  const [buyerBreakdown, setBuyerBreakdown] = useState<Breakdown<"byMaturity"> | null>(null);
  const [leadBreakdown, setLeadBreakdown] = useState<Breakdown<"byStatus"> | null>(null);
  const [myTasks, setMyTasks] = useState<TaskRowDto[] | null>(null);
  const [network, setNetwork] = useState<NetworkSummary | null>(null);
  /*
   * כישלון טעינה נשמר בנפרד ואינו מכווץ ל-[] או ל-0 — אותו כלל כמו
   * במסך השת"פ. "אין לכם משימות פתוחות" על בסיס בקשה שנכשלה הוא
   * שקר שמסתיר עבודה באיחור (ביקורת Codex).
   */
  const [tasksFailed, setTasksFailed] = useState(false);
  const [networkFailed, setNetworkFailed] = useState(false);
  /*
   * אותו כלל, גם על שמונה הטעינות של הדשבורד עצמו.
   *
   * הן נכתבו עם `.catch(() => setX([]))`, כלומר כישלון רשת צויר
   * כ„אפס נכסים, אפס קונים, אפס לידים” — המסך הכי מרתיע שאפשר
   * להראות למתווך, ובלי שום רמז שמדובר בתקלה. הכלל כבר נכתב כאן
   * למעלה עבור המשימות והרשת; זו החלת אותו כלל על השאר.
   *
   * דגל אחד לכל הקבוצה: הן נטענות יחד ונכשלות יחד (רשת, שרת,
   * session שפג), ושמונה הודעות נפרדות על אותה תקלה הן רעש.
   */
  const [dataFailed, setDataFailed] = useState(false);
  /** הקריאה לסוכן נכשלה — מוצג עם „נסו שוב”, ואינו כולל 403. */
  const [coachFailed, setCoachFailed] = useState(false);
  /*
   * ‎**כמה ממקורות הפעולה עדיין באוויר במנה הנוכחית.**
   *
   * השער שואל שאלה אחת — „האם עוד משהו בדרך” — ולכן יש לו ערך
   * אחד. הדרך לכאן עברה בארבעה קירובים שכל אחד מהם נשבר במקום
   * אחר: `today !== null` לא הבחין בין אתמול להיום, `todayDay ===
   * dayKey` נשאר אמת בניסיון חוזר, `dataFailed` ענה על הקבוצה
   * במקום על הבקשה, ודגל שכיסה רק את הפגישות השאיר את שלושת
   * האוספים האחרים עם `x === null` — שמשמעו גם „טרם הגיע” וגם
   * „נכשל”, ולכן כישלון של `/properties` הותיר את הרשימה על שלד
   * טעינה **לנצח** (ביקורת Codex).
   *
   * מונה, ולא דגל לכל מקור: ארבעה דגלים היו ארבעה מקומות לשכוח
   * בהם אחד. הוא נקבע פעם אחת בפתיחת המנה — לפי היכולות, כלומר
   * לפי כמה בקשות באמת ייורו — ויורד ב-`finally` של כל אחת מהן,
   * בהצלחה ובכישלון כאחד, 403 כולל.
   *
   * ‎`null` = טרם נורתה מנה, כלומר עדיין בטעינה.
   */
  const [sourcesPending, setSourcesPending] = useState<number | null>(null);
  const batch = useRef(0);

  const loadDashboard = useCallback(() => {
    /*
     * מונה מנות. „ניסיון חוזר” אינו מבטל את המנה הקודמת — הבקשות
     * שלה עדיין באוויר, וכל אחת מהן עוד תכתוב למצב כשתסתיים.
     *
     * בלי המונה, בקשה ישנה שנכשלת **אחרי** שהניסיון החוזר הצליח
     * מדליקה מחדש „חלק מנתוני הדשבורד לא נטענו” על מסך תקין,
     * ותשובה ישנה שמגיעה מאוחר דורסת נתונים חדשים יותר (ביקורת
     * Codex). רק המנה האחרונה רשאית לכתוב.
     */
    const mine = ++batch.current;
    const ok =
      <T,>(apply: (value: T) => void) =>
      (value: T): void => {
        if (mine !== batch.current) return;
        apply(value);
      };
    setDataFailed(false);
    /*
     * נספר לפי היכולות ולא לפי מספר קבוע: הבקשות המותנות אינן
     * נורות למי שאינו רשאי, ומונה שסופר אותן היה נתקע על מספר
     * שלעולם לא ירד. הפירוקים (`/buyers/breakdown` וכו') אינם
     * נספרים — הם מזינים קוביות ולא את רשימת הפעולות.
     */
    setSourcesPending(
      [canSeeProperties, canSeeBuyers, canSeeLeads, canSeeCalendar].filter(Boolean).length,
    );
    const settled = (): void => {
      if (mine !== batch.current) return;
      setSourcesPending((n) => (n === null ? null : Math.max(0, n - 1)));
    };
    /*
     * 403 אינו כישלון טעינה — הוא תשובה.
     *
     * הדגל המשותף נכתב עבור תקלות (רשת, שרת, session שפג), ובלי
     * ההבחנה הזו הוא נדלק גם על „המסלול שלך אינו כולל את זה”
     * ו„אין לך את היכולת”. משרד במסלול הבסיסי היה רואה „חלק
     * מנתוני הדשבורד לא נטענו” **בכל כניסה**, עם כפתור ניסיון
     * חוזר שלעולם לא ינקה אותו — כלומר בדיוק הרעש שהמסך הזה נועד
     * למנוע, הפוך (ביקורת Codex).
     *
     * שער מפורש עדיף על תפיסה בדיעבד, ולכן הבקשות המותנות גם
     * אינן נורות מלכתחילה (ראו מטה). זו רשת הביטחון: זכאות
     * משתנה, וכל נתיב אחר עלול לסרב מחר.
     */
    const fail = (err: unknown): void => {
      if (mine !== batch.current) return;
      if (err instanceof ApiError && err.status === 403) return;
      setDataFailed(true);
    };
    if (canSeeProperties) {
      apiGet<{ items: PropertyRow[] }>("/properties?limit=100")
        .then(ok((r: { items: PropertyRow[] }) => setProperties(apiList(r.items, "items"))))
        .catch(fail)
        .finally(settled);
    }
    if (canSeeBuyers) {
      apiGet<{ items: BuyerRow[] }>("/buyers?limit=100")
        .then(ok((r: { items: BuyerRow[] }) => setBuyers(apiList(r.items, "items"))))
        .catch(fail)
        .finally(settled);
      apiGet<Breakdown<"byMaturity">>("/buyers/breakdown")
        .then(ok(setBuyerBreakdown))
        .catch(fail);
    }
    if (canSeeLeads) {
      apiGet<{ items: LeadRow[] }>("/leads?limit=100")
        .then(ok((r: { items: LeadRow[] }) => setLeads(apiList(r.items, "items"))))
        .catch(fail)
        .finally(settled);
      apiGet<Breakdown<"byStatus">>("/leads/breakdown")
        .then(ok(setLeadBreakdown))
        .catch(fail);
    }
    if (canSeeCalendar) {
      /*
       * ‎**הטווח המבוקש בשעון ישראל, לא בשעון הדפדפן.**
       *
       * ‎`jerusalemDayRange` שימש עד כה רק כמפתח לרענון, בעוד הבקשה
       * עצמה נבנתה מ-`setHours(0,0,0,0)` מקומי ועוד 24 שעות קבועות.
       * דפדפן בניו-יורק היה מרענן בחצות ירושלים ומבקש **יום
       * ניו-יורקי**, ומציג את התוצאה כדירוג מלא של „היום”; 24 שעות
       * קבועות גם שגויות ביום מעבר שעון (ביקורת Codex).
       *
       * אותה פונקציה קובעת עכשיו גם מתי מרעננים וגם מה מבקשים.
       */
      const { start: dayStart, end: dayEnd } = jerusalemDayRange(new Date());
      /*
       * ‎**הקצה בלעדי — הנתיב מסנן `lte`.**
       *
       * ‎`jerusalemDayRange().end` הוא מחר ב-00:00, ו-`calendar.service`
       * משווה `startsAt: { gte: from, lte: to }` — כלומר פגישה שמתחילה
       * בדיוק בחצות הבאה נכללה ותויגה „היום” (ביקורת Codex).
       * מילישנייה אחורה מוציאה אותה בלי להזיז את שאר היום.
       */
      const dayEndInclusive = new Date(dayEnd.getTime() - 1);
      apiGet<AppointmentRow[]>(
        `/appointments?from=${dayStart.toISOString()}&to=${dayEndInclusive.toISOString()}`,
      )
        .then(ok(setToday))
        /* גם 403 — הבקשה הסתיימה, ולכן היא אינה „בדרך”. */
        .catch(fail)
        .finally(settled);
    }
    /*
     * רשימת ההצעות דורשת `offers.send` — אותו שער שכבר קיים
     * למשימות ולרשת מטה. היכולת מגיעה עם הזהות, שכבר המתנו לה,
     * ולכן היא ידועה כאן ואינה משתנה תחת הרגליים.
     */
    if (canSeeOffers) {
      /*
       * ‎**`GET /offers` מחזיר מערך, לא `{ items }`.**
       *
       * הקריאה כאן ביקשה `r.items` מנתיב שמחזיר את הרשימה עצמה,
       * ולכן היא קיבלה `undefined` **תמיד** — והמונה „הצעות
       * ממתינות” הראה אפס מאז ומתמיד, בלי שדבר נראה שבור. ההגנה
       * הישנה (`?? []`) היא שהסתירה את זה; האימות חשף אותו כתקלת
       * טעינה אמיתית תוך שעות.
       */
      apiGet<OfferRow[]>("/offers")
        .then(ok((rows: OfferRow[]) => setOffers(apiList(rows, "offers"))))
        .catch(fail);
    }
    /*
     * ‎**`dayKey` הוא טריגר ולא ערך — ולכן ההשתקה, ולא הסרה.**
     *
     * הכלל צודק עובדתית: הגוף אינו קורא אותו. אבל הוא גבול היממה
     * הישראלית, והנוכחות שלו כאן היא מה שמחליף את זהות ה-callback
     * כשהיום מתחלף — וכך האפקט שמתחתיו טוען מחדש. הסרתו „לפי
     * הכלל” הייתה משאירה את הדשבורד על טווחי אתמול אחרי חצות.
     */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSeeOffers, canSeeProperties, canSeeBuyers, canSeeLeads, canSeeCalendar, dayKey]);

  useEffect(() => {
    if (!featuresReady || !hasCoach) return;
    let cancelled = false;
    apiGet<MentorPulse>("/mentor/pulse")
      .then((pulse) => {
        if (!cancelled) setMentorPulse(pulse);
      })
      .catch(() => {
        /* 403 = אין מנטור במסלול; כל כישלון אחר — פשוט אין חגיגה */
      });
    return () => {
      cancelled = true;
    };
  }, [featuresReady, hasCoach]);

  useEffect(() => {
    if (authLoading || !user) return;
    loadDashboard();
  }, [authLoading, user, loadDashboard]);

  /*
   * „הסוכן החכם” נטען בנפרד, ולא כחלק מהמנה — כי הוא היחיד שתלוי
   * ברשימת הפיצ'רים.
   *
   * ## למה לא שער אחד על הכל
   *
   * הגרסה הקודמת חסמה את **כל** הטעינה עד ש-`featuresReady`, וזה
   * יצר תלות הרסנית: `/nav/summary` שנכשל משאיר את הרשימה `null`
   * לנצח, ואיתה `featuresReady` שקרי — כלומר הדשבורד היה נתקע על
   * שלדי טעינה לצמיתות, בלי שגיאה ובלי כפתור ניסיון חוזר. תקלה
   * במטא-דאטה של המסלול הפילה מסך שלם שאינו תלוי בה (ביקורת
   * Codex).
   *
   * ההפרדה גם מונעת את הטעינה הכפולה שבגללה נוסף השער מלכתחילה:
   * `hasCoach` שמתהפך כשהרשימה מגיעה בונה מחדש את הקריאה הזו
   * בלבד, ולא את שש הבקשות המרכזיות.
   */
  const loadCoach = useCallback(() => {
    /*
     * ‎**„עוד לא ידוע” ממתין; „לא ייוודע” מנסה בכל זאת.**
     *
     * השער הקודם היה `!featuresReady`, ולכן `/nav/summary` שנכשל
     * השאיר אותו סגור לנצח: `hasCoach` נשאר „כן” אופטימי, הקריאה
     * מעולם לא יצאה, `coachFailed` מעולם לא נדלק — והדירוג נשאר
     * כבוי בלי הסבר ובלי ניסיון חוזר. תקלה במטא-דאטה שתקה מסך
     * (ביקורת Codex). זה בדיוק הכשל שממנו הופרדה הקריאה הזו,
     * שירד רמה אחת.
     *
     * כשהרשימה לא תגיע — יוצאים. הצלחה מביאה המלצות, ו-403 מדליק
     * `coachFailed` שמוצג עם „נסו שוב”. בשני המקרים המצב **נפתר**.
     */
    if (!featuresReady && !featuresFailed) return;
    /*
     * ‎**זכאות שנודעה כשלילית מוחקת גם שגיאה קודמת.** ניסיון שנעשה
     * על סמך „לא ייוודע” ונדחה ב-403 השאיר `coachFailed` דולק, ואז
     * הרשימה שהגיעה סגרה את השער לפני הניקוי — כלומר הודעת „לא
     * הצלחנו לטעון את המלצות הסוכן” נשארה לנצח על מסך של משרד שאין
     * לו סוכן חכם בכלל (ביקורת Codex). ברגע שידוע שאין — אין גם על
     * מה לדווח.
     */
    if (featuresReady && !hasCoach) {
      setCoachFailed(false);
      return;
    }
    setCoachFailed(false);
    apiGet<Recommendation[]>("/coach/recommendations")
      .then(setRecs)
      /*
       * ‎**כישלון נשמר ואינו נבלע.** קודם הוא הושתק, ולכן `recs`
       * נשאר `null` לנצח בלי שאיש ידע. כל עוד השורות נראו זהות זה
       * היה חוסר בלבד; מרגע שהשורה הראשונה מכריזה „זה הדבר לעשות
       * עכשיו”, שתיקה כזו הופכת להכרזה על סמך חלק מהמקורות
       * (ביקורת Codex).
       */
      /*
       * ‎**403 הוא תשובה, לא תקלה** — אותה הבחנה שכבר קיימת ב-`fail`
       * של מנת הדשבורד, ולא החלתי אותה כאן.
       *
       * הקריאה הזו יוצאת ביודעין גם כשרשימת היכולות לא הגיעה, ולכן
       * משרד שאין לו סוכן חכם מקבל 403 ודאי. רישומו ככישלון טעינה
       * הציג „לא הצלחנו לטעון את המלצות הסוכן” עם „נסו שוב” שקורא
       * לאותה קריאה ומחזיר את אותו 403 — לולאה שלא נסגרת, על מסך של
       * מי שאין לו את הפיצ'ר בכלל (ביקורת Codex).
       *
       */
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 403) {
          /* 403 = אין סוכן במסלול. תשובה, לא תקלה — ואין מה לדווח. */
          return;
        }
        setCoachFailed(true);
      });
    /* אותו טריגר, ומאותה סיבה — ראו ההסבר ב-`loadDashboard` */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featuresReady, featuresFailed, hasCoach, dayKey]);

  useEffect(() => {
    if (authLoading || !user) return;
    loadCoach();
  }, [authLoading, user, loadCoach]);

  /*
   * שני האזורים האחרונים נטענים רק למי שרשאי לראות אותם. בלי הבדיקה
   * המוקדמת הדשבורד היה יורה בקשות שחוזרות 403 בכל טעינה אצל סוכן
   * בלי היכולות — ומצייר אזור ריק שאין לו סיבה להתמלא.
   *
   * שתי הטעינות נפרדות מהשאר כדי שיהיה אפשר לנסות שוב רק אותן.
   */
  const loadTasks = useCallback(() => {
    if (!user || !can(user, "calendar.manage")) return;
    setTasksFailed(false);
    apiGet<TaskRowDto[]>("/tasks?status=open&assignee=me")
      .then(setMyTasks)
      .catch(() => setTasksFailed(true));
  }, [user]);

  const loadNetwork = useCallback(() => {
    if (!user || !can(user, "collaboration.offer")) return;
    setNetworkFailed(false);
    apiGet<NetworkSummary>("/collaboration/summary")
      .then(setNetwork)
      .catch(() => setNetworkFailed(true));
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    loadTasks();
    loadNetwork();
  }, [authLoading, loadTasks, loadNetwork]);

  if (authLoading || !user) return <p aria-live="polite">טוען…</p>;

  /*
   * ‎**בלי תקרה לכל מקור בנפרד.** ארבעה מקורות נחתכו לשניים לפני
   * שנכנסו לרשימה, ולכן הגבול הסופי של שש שורות מעולם לא ראה את כל
   * המועמדים: משרד עם שלושה לידים שדורשים טיפול אנושי (100) וליד
   * חדש אחד (92) הציג את ה-92 ודילג על ה-100 השלישי — בזמן ששלוש
   * מתוך שש המשבצות ריקות (ביקורת Codex).
   *
   * זו בדיוק התקלה שאמרתי שסגרתי בסבב 3, כשהסרתי חיתוך מוקדם
   * **אחד** מתוך חמישה והשארתי את השאר. הגבול היחיד הוא זה שבסוף,
   * אחרי המיון והסרת הכפילויות.
   *
   * ‎`incomplete.length` ו-`urgentLeads.length` נצרכים גם ככיתוב
   * באריחי המונים, ושם התקרה שיקרה במפורש: „2 ממתינים להשלמת
   * פרטים” כשיש שבעה.
   */
  const urgentLeads = (leads ?? []).filter((l) => l.requiresHuman);
  const newLeads = (leads ?? []).filter((l) => l.status === "new" && !l.requiresHuman);
  const incomplete = (properties ?? []).filter((p) => p.readinessScore < 80);
  const hotBuyers = (buyers ?? [])
    .filter((b) => b.maturity === "very_hot" || b.maturity === "hot");
  /*
   * „טוען” רק על מקור שבאמת בדרך. מקור שנשלל אינו ממתין לכלום,
   * ולכן ספירתו כ„טרם הגיע” הייתה משאירה את „מה חשוב לעשות היום”
   * על „טוען…” לנצח אצל מי שאין לו את אחת משלוש היכולות.
   */
  const canSeeNetwork = can(user, "collaboration.offer");
  /*
   * ‎**„הכל מטופל” הוא טענה, ולכן הוא ממתין לכל מקור שיכול לסתור
   * אותה.**
   *
   * הביטוי כיסה את שלושת המקורות המקוריים בלבד, ומרגע שפגישות
   * היום, המשימות באיחור והצעות השת"פ נכנסו לרשימה נפתח חלון שבו
   * שלושת הראשונים חזרו ריקים, המסך הכריז „הכל מטופל”, ורגע אחר כך
   * הגיעה פעולה. אותו חלון חוזר בכל רענון חצות (ביקורת Codex).
   *
   * הפגישות נמדדות מול **היום הנוכחי** ולא מול „הגיע משהו”: בחצות
   * המערך של אתמול עדיין בידינו, התנאי החי מרוקן אותו, ובלי
   * ההשוואה הזו המסך היה מכריז „הכל מטופל” בזמן שפגישות היום עוד
   * לא ידועות.
   *
   * ‎**מקור שנכשל אינו „בדרך”.** אחרת תקלה ברשת הייתה משאירה את
   * הרשימה על שלד טעינה לנצח — הכישלון מוצג במקומו עם „נסו שוב”,
   * והרשימה ממשיכה עם מה שיש.
   */
  const loading =
    sourcesPending === null ||
    sourcesPending > 0 ||
    (canSeeCalendar && myTasks === null && !tasksFailed) ||
    (canSeeNetwork && network === null && !networkFailed);

  /*
   * ‎**השורה הראשונה מוכרזת „הדבר לעשות עכשיו”** — §13, ולפי המוקאפ
   * שבעל המוצר אישר מחדש.
   *
   * ההסתייגות הקודמת (הרשימה נשענת על עמוד ראשון של כל מקור, והסוכן
   * חותך 30→5 לידים בשרת) עדיין נכונה כעובדה — הדירוג הוא הטוב
   * ביותר שידוע לדפדפן, לא אמת מוחלטת. אבל ההכרעה העיצובית היא
   * שסדר-כמעט-נכון עם ראש מודגש עדיף על רשימה שטוחה: המספור ממילא
   * מכריז על דירוג, והשורה הראשונה רק אומרת אותו בקול.
   */
  const activeProps = (properties ?? []).filter(
    (p) => p.status === undefined || ["draft", "active", "on_hold"].includes(p.status),
  );
  const pendingOffers = (offers ?? []).filter((o) => o.status === "sent");
  const mullingOffer = pendingOffers.find((o) => o.openCount >= 2);

  /* ---- "מה חשוב לעשות היום": איחוד המקורות לרשימה ממוספרת אחת ---- */
  const candidates: TaskRow[] = [];
  const push = (t: TaskRow): void => {
    candidates.push(t);
  };
  for (const l of urgentLeads) {
    push({
      key: `urgent-${l.id}`,
      priority: PRIORITY.urgentLead,
      domain: "peach",
      title: `ליד דורש טיפול אנושי: ${l.contact.name}`,
      why: l.requiresHumanReason ?? "העוזר הדיגיטלי לא הצליח להתקדם לבד.",
      action: "טפל עכשיו",
      icon: <IconWarning s={16} />,
      href: `/leads/${l.id}`,
    });
  }
  /*
   * ‎**בלי חיתוך מוקדם.** קודם נלקחו ארבע ההמלצות הראשונות בלבד,
   * והחיתוך רץ **לפני** המיון והסרת הכפילויות — כך שאם שתיים מהן
   * מובילות לאותו כרטיס (כמה המלצות פגישה מצביעות כולן על
   * `/calendar`), המלצה חמישית דחופה יותר נזרקה בעוד שורה מקומית
   * פחות דחופה הוצגה במקומה (ביקורת Codex).
   *
   * הגבול היחיד הוא זה שבסוף הצינור, אחרי שהכול מוזג ומוין.
   */
  /*
   * ‎**פגישות מגיעות ממקור אחד — החי.**
   *
   * ‎`today_appointment` מהסוכן נושא כותרת קבועה ואינו נושא `startsAt`,
   * ולכן אין דרך לדעת ממנו שהפגישה כבר התחילה: הוא נשאר בדחיפות 105
   * כל עוד `recs` לא נטען מחדש, ומחזיק את ההדגשה גם ב-09:40. שעון חי
   * אינו עוזר לו — הוא מרענן את התנאי המקומי, לא את תוכן ההמלצה
   * (ביקורת Codex).
   *
   * תיקנתי בסבב הקודם את המסלול המקומי והשארתי את המסלול הזה, אף
   * שהוא אותה שורה בדיוק. המיזוג המקומי הוא ממילא על-קבוצה — אותה
   * הרשאת יומן, בלי `take: 5` — ולכן ההמלצה כאן היא כפילות שאינה
   * יכולה להתיישן, וזו הסיבה להשמיט אותה ולא לנסות לתקן אותה.
   */
  /*
   * ‎**המלצה שהיעד שלה חסום למשתמש אינה מוצגת.**
   *
   * הנתיב לסוכן שמור מאחורי `matches.view`, אבל היעדים יושבים
   * מאחורי יכולות אחרות — סוכן רגיל יכול לקבל המלצה על הצעת שת"פ
   * ולקבל 403 בלחיצה (ביקורת Codex). היכולת שכל יעד דורש מוגדרת
   * ליד היעד עצמו ב-`shared`, ולא כאן.
   */
  const reachable = (recs ?? []).filter((r) => {
    if (r.type === "today_appointment") return false;
    /* פתיחת היעד **וגם** ביצוע הפעולה — ראו `coach.ts`. */
    return recommendationCapabilities(r).every((c) => can(user, c));
  });
  for (const rec of reachable) {
    push({
      key: `rec-${rec.type}-${rec.entityId ?? ""}`,
      priority: rec.priority,
      domain: rec.priority >= 90 ? "peach" : "green",
      title: rec.title,
      why: rec.body,
      action: "לפרטים",
      icon: <IconStar s={16} />,
      href: recHref(rec),
    });
  }
  for (const l of newLeads) {
    push({
      key: `new-${l.id}`,
      priority: PRIORITY.newLead,
      domain: "amber",
      title: `ליד חדש ממתין: ${l.contact.name}`,
      why: "מענה מהיר מכפיל את סיכוי ההמרה.",
      action: "פתח ליד",
      icon: <IconBell s={16} />,
      href: `/leads/${l.id}`,
    });
  }
  for (const p of incomplete) {
    push({
      key: `inc-${p.id}`,
      priority: PRIORITY.incompleteProperty,
      domain: "blue",
      title: `${[p.street, p.city].filter(Boolean).join(", ") || "נכס ללא כתובת"} — מוכנות ${p.readinessScore}%`,
      why: `חסרים: ${p.missingFields.slice(0, 3).map(readinessFieldLabel).join(", ")}${p.missingFields.length > 3 ? " ועוד" : ""}. השלמה תפתח קונים חדשים.`,
      action: "השלם פרטים",
      icon: <IconHome s={16} />,
      href: readinessHref(p.id, p.missingFields),
    });
  }
  /*
   * ‎**שלושת המקורות שהמסך טוען ומעולם לא הכניס לרשימה.**
   *
   * פגישות היום, המשימות שלי והצעות השת"פ הממתינות הוצגו בטור
   * הצדדי בלבד, אף שהמסך טוען אותן ממילא — כלומר „מה חשוב לעשות
   * היום” לא יכול היה להכיל את הפריט הדחוף ביותר: פגישה בעוד
   * שעתיים יושבת בצד בזמן שנכס לא מושלם (40) עומד בראש
   * (ביקורת Codex).
   *
   * המספרים אינם מומצאים — הם של `buildRecommendations` עצמו, שכבר
   * מדרג את אותם שלושה מושגים (105 / 95 / 85). זה מה שהופך את שני
   * המקורות לסולם אחד במקום לשניים.
   *
   * ‎**הכפילות מול הטור הצדדי מכוונת**, וכך גם בחבילת העיצוב: שם
   * השורה הראשונה היא „5 הצעות שיתוף פעולה ממתינות לתגובה” בעוד
   * כרטיס „שת״פים” בצד מציג את אותו מספר. הרשימה אומרת מה לעשות,
   * הכרטיס אומר מה יש. כשהסוכן החכם דולק הוא שולח את אותן המלצות,
   * והסרת הכפילות לפי היעד — שכבר רצה אחרי המיון — משאירה אחת.
   */
  /*
   * ‎**„פעולה” היא פגישה שעוד לא קרתה.**
   *
   * הסינון הראשון פסל רק `cancelled`, ולכן `completed` ו-`no_show`
   * נכנסו — ופגישה שכבר התקיימה ב-09:00 יכלה לקבל 105 ולדחוק בשתיים
   * אחר הצהריים כל פעולה אמיתית, בתור „הדבר לעשות עכשיו”
   * (ביקורת Codex). הנתיב מחזיר את כל הסטטוסים בטווח, ולקחתי את
   * הטווח מחצות.
   *
   * התנאים כאן הם בדיוק אלה של שאילתת הסוכן — `status: "scheduled"`
   * ו-`startsAt >= now` — כי שתי הדרכים מייצרות את אותה שורה
   * בדחיפות 105, ואסור שהן יחלוקו על מה נכלל בה.
   */
  const upcomingToday = (today ?? []).filter(
    (a) => a.status === "scheduled" && startsToday(a) && new Date(a.startsAt).getTime() >= now.getTime(),
  );
  for (const a of upcomingToday) {
    push({
      key: `appt-${a.id}`,
      priority: PRIORITY.todayAppointment,
      domain: "blue",
      title: `היום ${timeFmt.format(new Date(a.startsAt))} — ${a.title ?? APPOINTMENT_KIND_LABELS[a.kind] ?? a.kind}`,
      why: "כדאי לוודא מול הלקוח שהפגישה בתוקף, ולהגיע עם הנכסים המתאימים בהישג יד.",
      action: "ליומן",
      icon: <IconCalendar s={16} />,
      href: "/calendar",
    });
  }
  if (network !== null && network.incomingOffers > 0) {
    push({
      key: "coop-offers",
      priority: PRIORITY.pendingCoopOffers,
      domain: "green",
      title:
        network.incomingOffers === 1
          ? "הצעת שיתוף פעולה ממתינה לתגובה"
          : `${network.incomingOffers} הצעות שיתוף פעולה ממתינות לתגובה`,
      why: "משרד אחר הציע נכס על אחד הביקושים שלכם ומחכה לתשובה.",
      action: "לעבור על ההצעות",
      icon: <IconHandshake s={16} />,
      href: "/collaboration",
    });
  }
  const overdueTasks = (myTasks ?? []).filter((t) => taskBucket(t.dueAt ?? null, now) === "overdue");
  if (overdueTasks.length > 0) {
    push({
      key: "overdue-tasks",
      priority: PRIORITY.overdueTask,
      domain: "peach",
      title:
        overdueTasks.length === 1
          ? `משימה באיחור: ${overdueTasks[0]!.title}`
          : `${overdueTasks.length} משימות באיחור`,
      why: "משימה שעבר זמנה. אם היא כבר לא רלוונטית — עדיף לסגור אותה מלהשאיר אותה פתוחה.",
      action: "למשימות",
      icon: <IconCheck s={16} />,
      href: "/tasks",
    });
  }
  for (const b of hotBuyers) {
    push({
      key: `hot-${b.id}`,
      priority: PRIORITY.hotBuyer,
      domain: "violet",
      title: `לבדוק התאמות עבור ${b.contact.name}`,
      why: `קונה ${labelOf(MATURITY_LABELS, b.maturity) ?? b.maturity} — כדאי לוודא שקיבל הצעות רלוונטיות.`,
      action: "צפה בהתאמות",
      icon: <IconUsers s={16} />,
      href: `/buyers/${b.id}`,
    });
  }
  /*
   * ‎**ממיינים, ואז מסירים כפילויות — בסדר הזה.**
   *
   * המיון הוא התיקון: הדירוג שהשורה הראשונה מכריזה עליו חייב להיות
   * דחיפות ולא סדר הוספה.
   *
   * וההסרה **אחרי** המיון, לא לפניה. קודם היא רצה בזמן הדחיפה, כך
   * שמתוך שתי שורות שמובילות לאותו כרטיס ניצחה זו שנדחפה ראשונה —
   * כלומר שוב סדר ההוספה, רק במקום שקשה יותר לראות. עכשיו מנצחת
   * הדחופה מביניהן, וזו גם השורה שהמתווך היה בוחר לראות.
   *
   * ‎`sort` יציב במנועים המודרניים, ולכן שוויון דחיפות שומר על סדר
   * המקורות — יציב בין רינדורים, וזה מה שחשוב כאן.
   */
  const seen = new Set<string>();
  const shownTasks = [...candidates]
    .sort((a, b) => b.priority - a.priority)
    .filter((t) => {
      if (t.href === null) return true;
      if (seen.has(t.href)) return false;
      seen.add(t.href);
      return true;
    })
    .slice(0, 6);

  const todayEvents = (today ?? [])
    .filter((a) => a.status === "scheduled" && startsToday(a))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, 4);

  /*
   * הסדר מגיע מ-`groupTasksByBucket` המשותף — אותה חלוקה ואותו מיון
   * כמו במסך המשימות: באיחור, היום, השבוע, בהמשך, בלי מועד; ובתוך
   * כל דלי לפי עדיפות ואז מועד. מיון מקומי היה מציג כאן סדר אחר
   * מזה שרואים בלחיצה על "לכל המשימות".
   */
  const shownMyTasks = groupTasksByBucket(myTasks ?? [], now)
    .flatMap((group) => group.tasks)
    .slice(0, 4);
  const dueNow = (myTasks ?? []).filter((t) => isTaskUrgent(t, now)).length;

  /*
   * כל מונה נושא אייקון משלו. זה לא קישוט: בסריקה מהירה של ארבעה
   * מספרים דומים, הצורה היא מה שמבדיל ביניהם לפני שקוראים מילה.
   */
  const statCards = [
    /*
     * הקוביה נעלמת למי שאינו רשאי לראות הצעות, ולא מציגה „…” לנצח.
     *
     * משאירים את הבקשה מאחורי שער אבל לא את הקוביה — והיא נשארה
     * תלויה על מצב הטעינה שלעולם לא ייגמר, עם קישור לנתיב שחוזר
     * 403 (ביקורת Codex). „אין הרשאה” אינו „עוד רגע”.
     */
    ...(canSeeOffers
      ? [
          {
            label: "הצעות ממתינות למענה",
            value: offers === null ? undefined : pendingOffers.length,
            /*
              גם לאפס יש שורת משנה — "אין הצעות פתוחות" (המוקאפ).
              אריח שמספרו 0 בלי מילה מתחתיו נקרא כטעינה שנתקעה.
            */
            sub:
              offers === null
                ? ""
                : pendingOffers.length === 0
                  ? "אין הצעות פתוחות"
                  : mullingOffer !== undefined
                    ? `אחת נפתחה ${mullingOffer.openCount} פעמים`
                    : "",
            href: "/offers",
            /* הצעות והתאמות הן מנוע ההתאמות — סגול (§4) */
            domain: "violet",
            icon: <IconSend s={17} />,
          },
        ]
      : []),
    /* אותו כלל כמו בהצעות: מי שאינו רשאי לראות — הקוביה נעלמת. */
    ...(canSeeProperties
      ? [
          {
            label: "נכסים פעילים",
            value: properties === null ? undefined : activeProps.length,
            sub:
              incomplete.length > 0
                ? `${incomplete.length} ממתינים להשלמת פרטים`
                : "כולם מוכנים לשיווק",
            href: "/properties",
            /* נכסים ויומן — כחול */
            domain: "blue",
            icon: <IconHome s={17} />,
          },
        ]
      : []),
    ...(canSeeBuyers
      ? [
          {
            label: "קונים חמים",
            value: buyers === null ? undefined : hotBuyers.length,
            sub: buyers === null ? "" : `מתוך ${buyers.length} קונים במאגר`,
            href: "/buyers",
            /*
             * אפרסק ולא אדום. „קונה חם” הוא הזדמנות דחופה ולא כשל,
             * ואדום שמור לשגיאה ולחסימה — הצבע היה אומר למתווך
             * שמשהו רע קרה דווקא כשמשהו טוב קרה.
             */
            domain: "peach",
            icon: <IconFlame s={17} />,
          },
        ]
      : []),
    ...(canSeeLeads
      ? [
          {
            label: "לידים חדשים",
            value: leads === null ? undefined : leads.filter((l) => l.status === "new").length,
            // אפס לידים חדשים הוא בשורה טובה, והמוקאפ אומר אותה: "הכל טופל"
            sub:
              leads === null
                ? ""
                : urgentLeads.length > 0
                  ? `${urgentLeads.length} דורשים טיפול אנושי`
                  : leads.filter((l) => l.status === "new").length === 0
                    ? "הכל טופל"
                    : "",
            href: "/leads",
            /* דחיפות: ליד חדש שממתין — אפרסק, כמו קונה חם */
            domain: "peach",
            icon: <IconBell s={17} />,
          },
        ]
      : []),
  ];

  /*
   * הפילוחים נגזרים מהנתונים שכבר נטענו למסך — אין קריאה נוספת
   * לשרת בשביל הגרפים. כל פרוסה מקשרת לרשימה המסוננת, כי פילוח
   * שאי אפשר לצלול אליו הוא קישוט.
   */
  /*
   * ‎**שורות מדד, ולא דונאט ולא פס התקדמות** (§23).
   *
   * החבילה אוסרת את שניהם כאן במפורש — „Do not render donuts or pie
   * charts for small integer counts, and never draw an empty progress
   * bar… This replaced exactly that, on purpose”. והנימוק מעשי ולא
   * טעם: פילוח של ארבעה מספרים קטנים אינו „צורה של נתונים”, ודונאט
   * מבקש מהקורא להשוות שטחי גזרה כדי לשחזר מספר שאפשר פשוט לכתוב.
   * במשרד חדש, שכל הערכים בו אפס, דונאט הוא עיגול ריק שאינו אומר
   * דבר — ושורת מדד עדיין אומרת „לא בשל: 0”.
   *
   * הדומיין נושא את משפחת הצבע, והנקודה את הדרגה בתוכה.
   */
  const bm = buyerBreakdown?.byMaturity ?? {};
  const maturityRows = [
    { label: "חם מאוד", value: bm["very_hot"] ?? 0, domain: "mv-domain-peach", dot: "#b4471f", href: "/buyers?maturity=very_hot" },
    { label: "חם", value: bm["hot"] ?? 0, domain: "mv-domain-amber", dot: "#8a6217", href: "/buyers?maturity=hot" },
    { label: "מתעניין", value: bm["interested"] ?? 0, domain: "mv-domain-green", dot: "#15803d", href: "/buyers?maturity=interested" },
    { label: "לא בשל", value: bm["not_ripe"] ?? 0, domain: "mv-domain-neutral", dot: "#5e6860", href: "/buyers?maturity=not_ripe" },
  ];

  /*
   * שלוש דרגות המשפך שעדיין דורשות מישהו. „הומר” אינו ביניהן —
   * הוא הסוף הטוב, ואינו „ממתין”. הוא נספר בשורת האישור למטה ולא
   * כשלב שמחכה לטיפול.
   */
  const ls = leadBreakdown?.byStatus ?? {};
  const leadRows = [
    { label: "חדש", value: ls["new"] ?? 0, domain: "mv-domain-peach", href: "/leads?status=new" },
    { label: "בטיפול", value: ls["in_progress"] ?? 0, domain: "mv-domain-blue", href: "/leads?status=in_progress" },
    { label: "ממתין ללקוח", value: ls["waiting_customer"] ?? 0, domain: "mv-domain-neutral", href: "/leads?status=waiting_customer" },
  ];
  const leadsWaiting = leadRows.reduce((sum, row) => sum + row.value, 0);
  return (
    <>
      <SetupBanner />

      {/*
        תקלת טעינה נאמרת במפורש, לפני המספרים.
        בלי זה הדשבורד מציג אפסים אמינים למראה על נתונים שלא הגיעו.
      */}
      {dataFailed ? (
        <div className="mb-4">
          <LoadError message="חלק מנתוני הדשבורד לא נטענו" onRetry={loadDashboard} />
        </div>
      ) : null}

      {/*
        שורת הברכה (§24) — כותרת ותאריך, ואז המונה בקצה השורה.

        המונה אינו קישוט: הוא אומר כמה פעולות ממתינות, והמספר שלו
        הוא **אורך הרשימה של §6.1** ולא ספירה נפרדת. שני מספרים
        שמתארים את אותו דבר ומחושבים בשתי דרכים נפרדים ביום
        שמישהו משנה את אחד מהם.
      */}
      <div className="mv-greet mb-6">
        <div className="min-w-0">
          <h1 className="mv-greet__title m-0">
            {greeting()}, {user.name.split(" ")[0]}
            <span style={{ color: "var(--color-primary)" }}>.</span>
          </h1>
          {/* לועזי + עברי + שעון — מתווך ישראלי חי בשני לוחות */}
          <div className="mv-greet__date">
            <NowStamp />
          </div>
        </div>
        {shownTasks.length > 0 ? (
          <div className="mv-greet__counter mv-counter">
            <span className="mv-counter__number mv-ltr">{shownTasks.length}</span>
            <span>
              <span className="mv-counter__lead block">פעולות מחכות לך</span>
              <span className="mv-counter__note block">מסודרות לפי דחיפות</span>
            </span>
          </div>
        ) : null}
      </div>

      {/*
        ‎**החגיגה — מיד אחרי הברכה.** יעד שהושג או עסקה שנסגרה נאמרים
        בשמם במקום שרואים בלי לגלול; הכרטיס הכהה בתחתית מחזיק את
        הרשימה גם אחרי ה„תודה”. הקונפטי יוצא פעם אחת לאירוע (הזיכרון
        בדפדפן משותף עם מסך המנטור).
      */}
      {mentorPulse ? (
        <div className="mb-6">
          <Celebration events={celebrationEvents(mentorPulse)} title="🎉 כל הכבוד — הושג" />
        </div>
      ) : null}

      <DuplicateContacts />

      {/*
        הכרזה על יכולת חדשה — אחרי הברכה ולפני העבודה של היום.
        למעלה מדי היא הייתה קודמת למה שדחוף; למטה מדי איש לא היה
        רואה אותה.
      */}
      <SystemUpdate />

      {/*
        הסוכן הקולי בראש המסך ולא בתחתיתו: הוא נקודת הכניסה לפעולה,
        והמונים הם הרקע שמאחוריה. מאחורי אותו שער מסלול כמו הקידום
        שהיה כאן — אין טעם להזמין לפיצ'ר שהשרת יחסום.
      */}
      {canVoice ? <VoiceConsole /> : null}

      {statCards.length > 0 ? (
      <section aria-labelledby="counts-heading" className="mb-7">
        <h2 id="counts-heading" className="mv-visually-hidden">מונים</h2>
        <dl className="grid grid-cols-2 items-stretch gap-4 lg:grid-cols-4">
          {statCards.map((card) => (
            /*
              ‎**אפס עובר לניטרלי — מהנתון, לא מהמסך.**

              „Any tile whose value is 0 switches to Neutral tokens
              automatically — that is a data-driven rule, not
              hard-coded”. הכלל הזה הוא מה שמונע מ„אין הצעות
              פתוחות” להיראות כמו התרעה: אריח סגול עם 0 גדול קורא
              כמו משהו שדורש טיפול, ובדיוק ההפך נכון.

              ‎`undefined` (טרם נטען) אינו אפס ואינו עובר לניטרלי:
              „עוד לא יודעים” ו„אין” הם שני מצבים שונים.
            */
            <Link
              key={card.label}
              href={card.href}
              className={`mv-kpi no-underline ${
                card.value === 0 ? "mv-domain-neutral" : `mv-domain-${card.domain}`
              }`}
            >
              {/*
                התווית בתחילת השורה והאריח בקצה — כמו במוקאפ: העין
                הסורקת ימין-לשמאל פוגשת קודם את המילים, והאייקון
                יושב בפינה כסימן זיהוי ולא כתחילת משפט.
              */}
              <dt className="mv-kpi__head">
                <span className="mv-kpi__label">{card.label}</span>
                <span className="mv-tile" aria-hidden="true">
                  {card.icon}
                </span>
              </dt>
              <dd className="mv-kpi__value mv-ltr m-0">{card.value ?? "…"}</dd>
              <dd className="mv-kpi__note m-0" style={{ minHeight: "1.2em" }}>
                {card.sub}
              </dd>
            </Link>
          ))}
        </dl>
      </section>
      ) : null}


      {/*
        ‎`align-items: stretch` (ברירת המחדל) ולא `items-start`, ו-372
        ולא 340 — שניהם מ-§24. הכלל שם הוא „Both columns must end at
        the same height… No dead space at the bottom of either
        column”, והכרטיס האחרון בטור הצדדי מקבל `flex-1` כדי לממש
        אותו.
      */}
      <div className="grid gap-4 lg:[grid-template-columns:1fr_372px]">
        {/*
          ‎**הטור הראשי הוא מכל אחד** — הרשימה המדורגת, ואז תת-רשת
          של שני כרטיסי הניתוח (§24).

          קודם כרטיסי הניתוח ישבו **מחוץ** לרשת, ולכן הילד היחיד של
          הטור הראשי היה הרשימה המדורגת. עם `stretch` היא נמתחה לגובה
          הטור הצדדי כולו והשאירה מתחת לשורותיה שטח ריק — בדיוק במשרד
          שבו יש מעט פעולות, כלומר במסך שאמור להיראות רגוע ולא חסר
          (ביקורת Codex).
        */}
        <div className="flex flex-col gap-4">
          {/* ---- מה חשוב לעשות היום ---- */}
          <section aria-labelledby="today-tasks-heading" className="mv-card overflow-hidden">
            {/*
              כותרת הכרטיס כמו במוקאפ: אריח וי ירוק בקצה הימני,
              ולידו הכותרת עם שורת המשנה **מתחתיה** — לא לצדה. שורת
              משנה שיושבת באותה שורה נקראת כהמשך הכותרת, וזה בדיוק
              מה שהיא לא.
            */}
            <div
              className="flex flex-wrap items-center gap-3 px-5 py-4"
              style={{ borderBottom: "1px solid var(--color-card-head-border)" }}
            >
              <span className="mv-tile mv-domain-green" aria-hidden="true">
                <IconCheck s={19} />
              </span>
              <div className="min-w-0">
                <h2
                  id="today-tasks-heading"
                  className="m-0"
                  style={{
                    fontSize: "var(--type-card-title)",
                    fontWeight: 900,
                    letterSpacing: "var(--type-card-title-track)",
                  }}
                >
                  מה חשוב לעשות היום
                </h2>
                <p className="m-0 text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
                  מתעדכן לבד לפי המצב בשטח
                </p>
              </div>
              {shownTasks.length > 0 ? (
                <span
                  className="ms-auto rounded-full px-2.5 py-0.5 text-sm font-bold"
                  style={{ background: "var(--color-primary-soft)", color: "var(--color-primary)" }}
                >
                  {shownTasks.length} פעולות
                </span>
              ) : null}
            </div>

            {/*
              ‎**„הרשימה חלקית” נאמר בקול, ולא נבלע.**

              כשהקריאה לסוכן נכשלת חסרות מהרשימה המלצות שהיו אמורות
              להופיע בה. משתמש שרואה רשימה קצרה מהרגיל בלי הסבר יחשוב
              שהמסך נשבר; לכן נאמר מה חסר ומוצע ניסיון חוזר — כל מצב
              ריק או חלקי מציין את הפעולה שסוגרת אותו.
            */}
            {coachFailed ? (
              <div className="px-5 pt-4">
                <LoadError
                  message="לא הצלחנו לטעון את המלצות הסוכן — הסדר כאן חלקי"
                  onRetry={loadCoach}
                />
              </div>
            ) : null}

            {loading ? (
              <p aria-live="polite" className="px-5 py-4">טוען…</p>
            ) : shownTasks.length === 0 ? (
              <p className="px-5 py-6 text-center" style={{ color: "var(--color-text-muted)" }}>
                הכל מטופל ✓ — אפשר לקלוט נכס או קונה חדשים.
              </p>
            ) : (
              <ul className="m-0 list-none p-0">
                {shownTasks.map((t, index) => (
                  /*
                    ‎**„PRIORITY RULE” — רק השורה הראשונה** (§13).

                    החבילה קוראת לזה „the core UX decision of the
                    product”, ולא בכדי: חמש שורות עם חמש קריאות זהות
                    לפעולה אינן מדרג אלא רשימה, ומתווך שקורא את המסך
                    בין שתי פגישות צריך לדעת מה **הדבר האחד**.
                    בעל המוצר אישר את הכלל מחדש מול המוקאפ.

                    ‎`index === 0` ולא סוג פעולה מסוים: הצבע והכפתור
                    הראשי נגזרים מהדירוג, ולכן הם עוברים עם הראש
                    כשהסדר משתנה — ולא נדבקים לשורה שהייתה ראשונה פעם.
                  */
                  <li
                    key={t.key}
                    className={`mv-row mv-row--action mv-row--flush mv-domain-${t.domain}${
                      index === 0 ? " mv-row--rank-1" : ""
                    }`}
                  >
                    {/*
                      המספר הסידורי חזר לשורה — הוא הדירוג עצמו, וזה
                      מה שהכרטיס הזה מוכר. האייקון נשאר לצדו ועונה על
                      השאלה השנייה, „מה זה בכלל”, כדי שאפשר יהיה לזהות
                      שורה בסריקה לפני קריאת הכותרת.
                    */}
                    <span className="mv-row__ordinal mv-ltr" aria-hidden="true">
                      {index + 1}
                    </span>
                    <span className="mv-tile mv-tile--44" aria-hidden="true">
                      {t.icon}
                    </span>
                    <span className="mv-visually-hidden">פעולה {index + 1}:</span>
                    <span className="min-w-0">
                      <span className="mv-row__title block">{t.title}</span>
                      <span className="mv-row__why block">{t.why}</span>
                    </span>
                    {t.href ? (
                      <Link
                        href={t.href}
                        className={`mv-row__action mv-button ${
                          index === 0 ? "mv-button--primary" : "mv-button--secondary"
                        } flex-none no-underline`}
                      >
                        {t.action}
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

        {/* ---- פילוחים: איפה עומד המשרד, במבט אחד ---- */}
        {canSeeBuyers || canSeeLeads ? (
        <section aria-labelledby="charts-heading" className="flex flex-1 flex-col">
          <h2 id="charts-heading" className="mv-visually-hidden">פילוחי המאגר</h2>
          <div className="grid flex-1 items-stretch gap-4 lg:grid-cols-2">
            {/*
              פילוח הוא טענה על המאגר. „0 בכל פרוסה” למי שאינו רשאי
              לראות קונים או לידים אינו „ריק” אלא תיאור שגוי — ולכן
              הכרטיס נעלם ולא מתרוקן.
            */}
            {canSeeBuyers ? (
              <div className="mv-card flex flex-col p-6">
                <div className="mv-card-head mv-domain-violet">
                  <span className="mv-tile" aria-hidden="true">
                    <IconUsers s={19} />
                  </span>
                  <h3 className="mv-card-head__title m-0">בשלות הקונים</h3>
                </div>
                <p className="mv-card-sub m-0">לחיצה על שורה פותחת את הרשימה המסוננת.</p>
                <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
                  {maturityRows.map((row) => (
                    <li key={row.label}>
                      <Link
                        href={row.href}
                        className={`mv-metric no-underline ${
                          row.value === 0 ? "mv-domain-neutral" : row.domain
                        }`}
                      >
                        {/*
                          הנקודה נושאת את **הדרגה**, לא את הדומיין: „חם
                          מאוד” ו„חם” חולקים משפחת צבע, והנקודה היא מה
                          שמפריד ביניהן. בשורת אפס היא יורשת את הניטרלי
                          ואינה צובעת דרגה שאין לה נציגים.
                        */}
                        <span
                          className="mv-metric__dot"
                          aria-hidden="true"
                          style={row.value === 0 ? undefined : { color: row.dot }}
                        />
                        <span className="mv-metric__label">{row.label}</span>
                        <span className="mv-metric__value mv-ltr">
                          {buyerBreakdown === null ? "…" : row.value}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                {/*
                  הסך-הכול בתחתית, ו-`margin-top:auto` כדי ששני
                  כרטיסי הניתוח יסתיימו באותו גובה גם כשמספר השורות
                  בהם שונה.
                */}
                <p
                  className="m-0 mt-auto pt-3 text-[length:var(--type-body-sm)]"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  סה&quot;כ{" "}
                  <b style={{ color: "var(--color-text)" }}>
                    {buyerBreakdown === null ? "…" : buyerBreakdown.total}
                  </b>{" "}
                  קונים במאגר
                </p>
              </div>
            ) : null}

            {canSeeLeads ? (
              <div className="mv-card flex flex-col p-6">
                {/* ברק ולא משפך — האייקון של הלידים במוקאפ ובאוצר §7 */}
                <div className="mv-card-head mv-domain-peach">
                  <span className="mv-tile" aria-hidden="true">
                    <IconBolt s={19} />
                  </span>
                  <h3 className="mv-card-head__title m-0">מצב הלידים</h3>
                </div>
                <p className="mv-card-sub m-0">המשפך מהפנייה ועד ההמרה.</p>
                <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
                  {leadRows.map((row) => (
                    <li key={row.label}>
                      {/* בלי נקודת סטטוס — במוקאפ שורות המשפך חלקות; הנקודה היא של סולם הבשלות */}
                      <Link
                        href={row.href}
                        className={`mv-metric no-underline ${
                          row.value === 0 ? "mv-domain-neutral" : row.domain
                        }`}
                      >
                        <span className="mv-metric__label">{row.label}</span>
                        <span className="mv-metric__value mv-ltr">
                          {leadBreakdown === null ? "…" : row.value}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                {/*
                  מצב ריק (§22): אישור ירוק ולא פאנל ריק ולא אזהרה.
                  „הכל טופל” היא עובדה טובה, וזה מה שהיא צריכה להיראות.
                */}
                <div className="mt-auto pt-3">
                  {leadBreakdown !== null && leadsWaiting === 0 ? (
                    <p className="mv-zero-line m-0">
                      <IconCheck s={18} /> אין לידים שממתינים — הכל טופל
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </section>
        ) : null}
        </div>

        {/* ---- הטור הצדדי: יומן, משימות, רשת, והמנטור ---- */}
        <div className="flex flex-col gap-4">
          {/*
            „אין פגישות מתוכננות להיום” היא טענה על היומן, ומי שאינו
            רשאי לנהל יומן קיבל אותה על סמך 403 — יחד עם קישור
            „ליומן המלא” שמוביל לנתיב שיסרב (ביקורת Codex).
          */}
          {canSeeCalendar ? (
          <section aria-labelledby="today-heading" className="mv-card p-5">
            {/* כותרת כרטיס לפי §9 — אריח יומן כחול, ואז הקישור בקצה */}
            <div className="mv-card-head mv-domain-blue">
              <span className="mv-tile" aria-hidden="true">
                <IconCalendar s={19} />
              </span>
              <h2 id="today-heading" className="mv-card-head__title m-0">
                היום ביומן
              </h2>
              <Link href="/calendar" className="mv-card-head__link no-underline">
                ליומן המלא
              </Link>
            </div>
            {todayEvents.length === 0 ? (
              <p className="m-0 mt-3 text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-muted)" }}>
                אין פגישות מתוכננות להיום.
              </p>
            ) : (
              /*
                שורות מקוננות (§13) ולא קווי הפרדה: במוקאפ כל פגישה
                יושבת על משטח שקוע מעוגל, והשעה — מודגשת, בקצה השורה.
              */
              <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
                {todayEvents.map((a) => (
                  <li key={a.id} className="mv-row mv-row--nested">
                    <span className="min-w-0" style={{ lineHeight: 1.3 }}>
                      <span className="block text-[length:var(--type-body-sm)] font-bold">
                        {a.title ?? APPOINTMENT_KIND_LABELS[a.kind] ?? a.kind}
                      </span>
                      <span className="block text-sm" style={{ color: "var(--color-text-muted)" }}>
                        {APPOINTMENT_KIND_LABELS[a.kind] ?? a.kind}
                        {a.propertyId ? " · נכס" : a.leadId ? " · ליד" : ""}
                      </span>
                    </span>
                    <span
                      className="mv-ltr ms-auto flex-none font-extrabold"
                      style={{ fontSize: "var(--type-body)" }}
                    >
                      {timeFmt.format(new Date(a.startsAt))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          ) : null}

          {/*
            המשימות שלי — האזור היחיד בדשבורד שמראה מה **אני** רשמתי
            לעצמי. "מה חשוב לעשות היום" נגזר ממצב המאגר ומההמלצות,
            והוא לא מכיר משימה שסוכן פתח ביד; עד עכשיו היא הייתה
            קיימת רק במסך המשימות, כלומר במסך שצריך לזכור להיכנס
            אליו. הדחופות כאן, השאר שם.
          */}
          {canSeeCalendar ? (
            <section aria-labelledby="my-tasks-heading" className="mv-card p-5">
              <div className="mv-card-head mv-domain-neutral">
                <span className="mv-tile" aria-hidden="true">
                  <IconList s={19} />
                </span>
                <h2 id="my-tasks-heading" className="mv-card-head__title m-0">
                  המשימות שלי
                </h2>
                {dueNow > 0 ? (
                  <span
                    className="rounded-full px-2 py-0.5 text-[length:var(--type-caption)] font-bold"
                    style={{ background: "var(--color-danger-soft)", color: "var(--color-danger)" }}
                  >
                    {dueNow} להיום
                  </span>
                ) : null}
                <Link href="/tasks" className="mv-card-head__link no-underline">
                  לכל המשימות
                </Link>
              </div>
              {tasksFailed ? (
                <div className="mt-3">
                  <LoadError message="לא הצלחנו לטעון את המשימות" onRetry={loadTasks} />
                </div>
              ) : myTasks === null ? (
                <p className="m-0 mt-3 text-[length:var(--type-caption-lg)]" aria-live="polite" style={{ color: "var(--color-text-muted)" }}>
                  טוען…
                </p>
              ) : shownMyTasks.length === 0 ? (
                <p className="m-0 mt-3 text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-muted)" }}>
                  <IconCheck s={14} /> אין משימות פתוחות על שמכם.
                </p>
              ) : (
                /*
                  המועד הוא גלולה בקצה השורה, כמו במוקאפ — והצבע שלה
                  אומר את הדחיפות: תאריך רגיל ירקרק, „ללא יעד” ענברי
                  (המתנה), ובאיחור/היום — אדום. הצבע לעולם לא לבדו:
                  המילה שבתוך הגלולה אומרת את אותו הדבר.
                */
                <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
                  {shownMyTasks.map((t) => {
                    const due = dueLabel(t.dueAt, now);
                    const chip = due.urgent
                      ? { background: "var(--color-danger-soft)", color: "var(--color-danger)" }
                      : due.text === "ללא יעד"
                        ? { background: "var(--domain-amber-tile)", color: "var(--domain-amber-fg)" }
                        : { background: "var(--domain-green-tile)", color: "var(--domain-green-fg)" };
                    return (
                      <li key={t.id} className="mv-row mv-row--nested">
                        <span className="min-w-0" style={{ lineHeight: 1.3 }}>
                          <span className="block text-[length:var(--type-body-sm)] font-bold">{t.title}</span>
                          {t.entityLabel ? (
                            <span className="block text-sm" style={{ color: "var(--color-text-muted)" }}>
                              {t.entityLabel}
                            </span>
                          ) : null}
                        </span>
                        <span
                          className="ms-auto flex-none rounded-full px-2.5 py-1 text-[length:var(--type-caption)] font-bold"
                          style={chip}
                        >
                          {due.text}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ) : null}

          {/*
            הרשת בדשבורד. הצעה שקיבלתי על ביקוש והפניה פתוחה הן
            הזדמנויות שפגות: ביקוש נסגר, והפניה נקלטת במשרד אחר. עד
            עכשיו הן חיכו במסך שנכנסים אליו ביוזמה, כלומר בדרך כלל
            אחרי שהיה מאוחר.
          */}
          {can(user, "collaboration.offer") ? (
            /*
              מסגרת ירקרקה, כמו במוקאפ: הרשת היא הדומיין הירוק, וזה
              הכרטיס היחיד בטור שמסגרתו נצבעת — אותה שפה כמו פאנל
              הסוכן, שגם מסגרתו ירוקה.
            */
            <section
              aria-labelledby="coop-heading"
              className="mv-card p-5"
              style={{ borderColor: "var(--domain-green-line)" }}
            >
              <div className="mv-card-head mv-domain-green">
                <span className="mv-tile" aria-hidden="true">
                  <IconLink s={19} />
                </span>
                <h2 id="coop-heading" className="mv-card-head__title m-0">
                  שת&quot;פים
                </h2>
                <Link href="/collaboration" className="mv-card-head__link no-underline">
                  לרשת
                </Link>
              </div>
              {networkFailed ? (
                <div className="mt-3">
                  <LoadError message="לא הצלחנו לטעון את מצב הרשת" onRetry={loadNetwork} />
                </div>
              ) : (
                <>
                  {/*
                    יחיד ורבים ולא "1 הצעות". מספר צמוד לשם עצם בעברית
                    מחייב התאמה, וברשימה קצרה כזו הפער בולט מיד.
                  */}
                  {/*
                    שורות ירוקות שהמספר פותח אותן (§6.3): כאן המספר
                    הוא העניין — „5 הצעות שהתקבלו” — ולכן הוא ראשון
                    ובגודל שמאפשר לקרוא אותו בלי להתקרב.
                  */}
                  <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
                    {[
                      {
                        value: network?.incomingOffers ?? 0,
                        text:
                          network?.incomingOffers === 1
                            ? "הצעה שהתקבלה על הביקושים שלכם"
                            : "הצעות שהתקבלו על הביקושים שלכם",
                      },
                      {
                        value: network?.openReferrals ?? 0,
                        text:
                          network?.openReferrals === 1
                            ? "הפניית לקוח פתוחה ברשת"
                            : "הפניות לקוחות פתוחות ברשת",
                      },
                    ].map((row) => (
                      <li
                        key={row.text}
                        className={`mv-row mv-row--nested ${
                          row.value === 0 ? "mv-domain-neutral" : "mv-domain-green"
                        }`}
                      >
                        <span
                          className="mv-ltr flex-none text-center font-black"
                          style={{
                            minWidth: 26,
                            fontSize: "var(--type-metric)",
                            color: "var(--d-fg)",
                          }}
                        >
                          {network === null ? "…" : row.value}
                        </span>
                        <span className="text-[length:var(--type-body-sm)] font-bold">
                          {row.text}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="m-0 mt-1.5 text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
                    {network === null
                      ? "שיתוף פעולה על ביקושים אינו עולה קרדיטים."
                      : `יתרה: ${network.credits} קרדיטים · שיתוף פעולה על ביקושים אינו עולה קרדיטים.`}
                  </p>
                </>
              )}
            </section>
          ) : null}

          {/*
            ‎**כרטיס כהה אחד למסך, והוא האחרון בטור** (§21).

            לפי החבילה הוא המנטור: המקום היחיד שבו מדברים על
            **המתווך** ולא על הלידים שלו — היעדים שביקש מעצמו, הקצב,
            והסיכום השבועי. ‎`flex-1` כאן הוא מה שמיישר את תחתית שני
            הטורים (§24).

            ‎**מה שכתוב כאן חייב להיות מה שקורה בלחיצה** — ולכן הנוסח
            עבר להווה ביום שהמסך הפסיק להיות „בקרוב”.
          */}
          {hasCoach ? (
            <section aria-labelledby="mentor-heading" className="mv-dark-card flex-1">
              <div className="mv-dark-card__head">
                <span className="mv-dark-card__badge" aria-hidden="true">
                  AI
                </span>
                <h2 id="mentor-heading" className="mv-dark-card__title m-0">
                  המנטור האישי שלך
                </h2>
              </div>
              <p className="mv-dark-card__body m-0">
                מודד את השבוע מול היעדים שביקשתם מעצמכם, חוגג כל עסקה בשמה, ועונה
                על „מה כדאי לי לשפר?” — רק מולכם, אף פעם לא מול עמיתים.
              </p>
              {mentorPulse && (mentorPulse.goalsDone.length > 0 || mentorPulse.wins.length > 0) ? (
                <ul className="mv-dark-card__body m-0 list-none p-0">
                  {mentorPulse.goalsDone.map((g) => (
                    <li key={`g-${g.id}`}>🎯 היעד הושג: {g.label}</li>
                  ))}
                  {mentorPulse.wins.map((w, i) => (
                    <li key={`w-${i}`}>🎉 {winLabel(w)}</li>
                  ))}
                </ul>
              ) : null}
              <Link href="/mentor" className="mv-button mv-dark-card__action no-underline">
                לדבר עם המנטור
              </Link>
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}
