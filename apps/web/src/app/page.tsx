"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { groupTasksByBucket, isTaskUrgent, taskBucket , labelOf } from "@metavchim/shared";
import { apiGet, ApiError } from "@/lib/api";
import { FIELD_LABELS, MATURITY_LABELS } from "@/lib/format";
import { can, useRequireAuth } from "@/lib/use-auth";
import { useFeature, useFeaturesReady } from "@/lib/use-features";
import { VoiceConsole } from "./voice-console";
import { DuplicateContacts } from "./duplicate-contacts";
import { LoadError } from "./load-error";
import { SetupBanner } from "./setup-banner";
import { SystemUpdate } from "./system-update";
import { NowStamp } from "./now-stamp";
import { BarChart, DonutChart, type Slice } from "./charts";
import {
  IconBell,
  IconCheck,
  IconFilter,
  IconFlame,
  IconHandshake,
  IconHome,
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

const timeFmt = new Intl.DateTimeFormat("he-IL", { hour: "2-digit", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("he-IL", { day: "2-digit", month: "2-digit" });

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

interface Recommendation {
  priority: number;
  type: string;
  title: string;
  body: string;
  entityType?: "property" | "lead" | "buyer" | "offer" | "appointment";
  entityId?: string;
}

function recHref(rec: Recommendation): string | null {
  if (!rec.entityId) return null;
  switch (rec.entityType) {
    case "property":
      return `/properties/${rec.entityId}`;
    case "lead":
      return `/leads/${rec.entityId}`;
    case "buyer":
      return `/buyers/${rec.entityId}`;
    case "appointment":
      return "/calendar";
    default:
      return null;
  }
}

/** ברכה לפי שעת היום — הדשבורד בעיצוב פותח ב"בוקר טוב". */
function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "בוקר טוב";
  if (hour < 18) return "צהריים טובים";
  return "ערב טוב";
}

/* צבעי מספור השורות — הפלטה מקובץ העיצוב; ירוק הטקסט מועמק ל-AA */
const TONE = {
  danger: { bg: "#faf1ec", fg: "#b0512c" },
  green: { bg: "#E5FCEA", fg: "#0C6E34" },
  amber: { bg: "#f7efdd", fg: "#7a5c1f" },
  neutral: { bg: "#EDEFED", fg: "#3F4742" },
} as const;

interface TaskRow {
  key: string;
  tone: keyof typeof TONE;
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
  const hasCoach = useFeature("ai_coach");
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

  const loadDashboard = useCallback(() => {
    setDataFailed(false);
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
      if (err instanceof ApiError && err.status === 403) return;
      setDataFailed(true);
    };
    if (canSeeProperties) {
      apiGet<{ items: PropertyRow[] }>("/properties?limit=100")
        .then((r) => setProperties(r.items))
        .catch(fail);
    }
    if (canSeeBuyers) {
      apiGet<{ items: BuyerRow[] }>("/buyers?limit=100")
        .then((r) => setBuyers(r.items))
        .catch(fail);
      apiGet<Breakdown<"byMaturity">>("/buyers/breakdown")
        .then(setBuyerBreakdown)
        .catch(fail);
    }
    if (canSeeLeads) {
      apiGet<{ items: LeadRow[] }>("/leads?limit=100")
        .then((r) => setLeads(r.items))
        .catch(fail);
      apiGet<Breakdown<"byStatus">>("/leads/breakdown")
        .then(setLeadBreakdown)
        .catch(fail);
    }
    if (canSeeCalendar) {
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      apiGet<AppointmentRow[]>(
        `/appointments?from=${dayStart.toISOString()}&to=${dayEnd.toISOString()}`,
      )
        .then(setToday)
        .catch(fail);
    }
    /*
     * רשימת ההצעות דורשת `offers.send` — אותו שער שכבר קיים
     * למשימות ולרשת מטה. היכולת מגיעה עם הזהות, שכבר המתנו לה,
     * ולכן היא ידועה כאן ואינה משתנה תחת הרגליים.
     */
    if (canSeeOffers) {
      apiGet<{ items: OfferRow[] }>("/offers")
        .then((r) => setOffers(r.items))
        .catch(fail);
    }
  }, [canSeeOffers, canSeeProperties, canSeeBuyers, canSeeLeads, canSeeCalendar]);

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
    if (!featuresReady || !hasCoach) return;
    apiGet<Recommendation[]>("/coach/recommendations")
      .then(setRecs)
      .catch(() => undefined);
  }, [featuresReady, hasCoach]);

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

  const urgentLeads = (leads ?? []).filter((l) => l.requiresHuman).slice(0, 2);
  const newLeads = (leads ?? []).filter((l) => l.status === "new" && !l.requiresHuman).slice(0, 2);
  const incomplete = (properties ?? []).filter((p) => p.readinessScore < 80).slice(0, 2);
  const hotBuyers = (buyers ?? [])
    .filter((b) => b.maturity === "very_hot" || b.maturity === "hot");
  /*
   * „טוען” רק על מקור שבאמת בדרך. מקור שנשלל אינו ממתין לכלום,
   * ולכן ספירתו כ„טרם הגיע” הייתה משאירה את „מה חשוב לעשות היום”
   * על „טוען…” לנצח אצל מי שאין לו את אחת משלוש היכולות.
   */
  const loading =
    (canSeeProperties && properties === null) ||
    (canSeeBuyers && buyers === null) ||
    (canSeeLeads && leads === null);

  const activeProps = (properties ?? []).filter(
    (p) => p.status === undefined || ["draft", "active", "on_hold"].includes(p.status),
  );
  const pendingOffers = (offers ?? []).filter((o) => o.status === "sent");
  const mullingOffer = pendingOffers.find((o) => o.openCount >= 2);

  /* ---- "מה חשוב לעשות היום": איחוד המקורות לרשימה ממוספרת אחת ---- */
  const tasks: TaskRow[] = [];
  const seen = new Set<string>();
  const push = (t: TaskRow): void => {
    if (t.href !== null && seen.has(t.href)) return;
    if (t.href !== null) seen.add(t.href);
    tasks.push(t);
  };
  for (const l of urgentLeads) {
    push({
      key: `urgent-${l.id}`,
      tone: "danger",
      title: `ליד דורש טיפול אנושי: ${l.contact.name}`,
      why: l.requiresHumanReason ?? "העוזר הדיגיטלי לא הצליח להתקדם לבד.",
      action: "טפל עכשיו",
      icon: <IconWarning s={16} />,
      href: `/leads/${l.id}`,
    });
  }
  for (const rec of (recs ?? []).slice(0, 4)) {
    push({
      key: `rec-${rec.type}-${rec.entityId ?? ""}`,
      tone: rec.priority >= 90 ? "danger" : "green",
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
      tone: "amber",
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
      tone: "neutral",
      title: `${[p.street, p.city].filter(Boolean).join(", ") || "נכס ללא כתובת"} — מוכנות ${p.readinessScore}%`,
      why: `חסרים: ${p.missingFields.slice(0, 3).map((f) => FIELD_LABELS[f] ?? f).join(", ")}${p.missingFields.length > 3 ? " ועוד" : ""}. השלמה תפתח קונים חדשים.`,
      action: "השלם פרטים",
      icon: <IconHome s={16} />,
      href: `/properties/${p.id}/edit`,
    });
  }
  for (const b of hotBuyers.slice(0, 2)) {
    push({
      key: `hot-${b.id}`,
      tone: "green",
      title: `לבדוק התאמות עבור ${b.contact.name}`,
      why: `קונה ${labelOf(MATURITY_LABELS, b.maturity) ?? b.maturity} — כדאי לוודא שקיבל הצעות רלוונטיות.`,
      action: "צפה בהתאמות",
      icon: <IconUsers s={16} />,
      href: `/buyers/${b.id}`,
    });
  }
  const shownTasks = tasks.slice(0, 6);

  const todayEvents = (today ?? [])
    .filter((a) => a.status === "scheduled")
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, 4);

  /*
   * הסדר מגיע מ-`groupTasksByBucket` המשותף — אותה חלוקה ואותו מיון
   * כמו במסך המשימות: באיחור, היום, השבוע, בהמשך, בלי מועד; ובתוך
   * כל דלי לפי עדיפות ואז מועד. מיון מקומי היה מציג כאן סדר אחר
   * מזה שרואים בלחיצה על "לכל המשימות".
   */
  const now = new Date();
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
            sub: mullingOffer !== undefined ? `אחת נפתחה ${mullingOffer.openCount} פעמים` : "",
            href: "/offers",
            valueColor: undefined as string | undefined,
            icon: <IconSend s={17} />,
            tone: "var(--color-primary)",
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
            valueColor: undefined as string | undefined,
            icon: <IconHome s={17} />,
            tone: "var(--color-primary)",
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
            valueColor: "var(--color-danger)" as string | undefined,
            icon: <IconFlame s={17} />,
            tone: "var(--color-danger)",
          },
        ]
      : []),
    ...(canSeeLeads
      ? [
          {
            label: "לידים חדשים",
            value: leads === null ? undefined : leads.filter((l) => l.status === "new").length,
            sub: urgentLeads.length > 0 ? `${urgentLeads.length} דורשים טיפול אנושי` : "",
            href: "/leads",
            valueColor: undefined as string | undefined,
            icon: <IconBell s={17} />,
            tone: "var(--color-primary)",
          },
        ]
      : []),
  ];

  /*
   * הפילוחים נגזרים מהנתונים שכבר נטענו למסך — אין קריאה נוספת
   * לשרת בשביל הגרפים. כל פרוסה מקשרת לרשימה המסוננת, כי פילוח
   * שאי אפשר לצלול אליו הוא קישוט.
   */
  const bm = buyerBreakdown?.byMaturity ?? {};
  const maturitySlices: Slice[] = [
    { label: "חם מאוד", value: bm["very_hot"] ?? 0, color: "#b0512c", href: "/buyers?maturity=very_hot" },
    { label: "חם", value: bm["hot"] ?? 0, color: "#d9a441", href: "/buyers?maturity=hot" },
    { label: "מתעניין", value: bm["interested"] ?? 0, color: "var(--color-primary-accent)", href: "/buyers?maturity=interested" },
    { label: "לא בשל", value: bm["not_ripe"] ?? 0, color: "#9aa79d", href: "/buyers?maturity=not_ripe" },
  ];

  const ls = leadBreakdown?.byStatus ?? {};
  const leadSlices: Slice[] = [
    { label: "חדש", value: ls["new"] ?? 0, color: "var(--color-primary-accent)", href: "/leads?status=new" },
    { label: "בטיפול", value: ls["in_progress"] ?? 0, color: "#d9a441", href: "/leads?status=in_progress" },
    { label: "ממתין ללקוח", value: ls["waiting_customer"] ?? 0, color: "#7a9bd4", href: "/leads?status=waiting_customer" },
    { label: "הומר", value: ls["converted"] ?? 0, color: "var(--color-primary)", href: "/leads?status=converted" },
  ];
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

      {/* ברכה + תאריך — בשורת בסיס אחת, כמו בעיצוב */}
      <div className="mb-6 flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
        <h1 className="m-0" style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.01em" }}>
          {greeting()}, {user.name.split(" ")[0]}
        </h1>
        {/* לועזי + עברי + שעון — מתווך ישראלי חי בשני לוחות */}
        <NowStamp />
      </div>

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
        <dl className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
          {statCards.map((card) => (
            <Link key={card.label} href={card.href} className="mv-stat-card no-underline">
              <dt className="flex items-center gap-2 text-[14.5px] font-semibold" style={{ color: "var(--color-text-muted)" }}>
                <span className="mv-stat-icon" style={{ color: card.tone }} aria-hidden="true">
                  {card.icon}
                </span>
                {card.label}
              </dt>
              <dd className="mv-stat-value m-0" style={card.valueColor ? { color: card.valueColor } : undefined}>
                {card.value ?? "…"}
              </dd>
              <dd className="m-0 text-[14px]" style={{ color: "var(--color-text-muted)", minHeight: "1.2em" }}>
                {card.sub}
              </dd>
              {/* חץ שמופיע בריחוף — רמז שהכרטיס כולו לחיץ */}
              <span className="mv-stat-go" aria-hidden="true">←</span>
            </Link>
          ))}
        </dl>
      </section>
      ) : null}

      {/* ---- פילוחים: איפה עומד המשרד, במבט אחד ---- */}
      {canSeeBuyers || canSeeLeads ? (
      <section aria-labelledby="charts-heading" className="mb-7">
        <h2 id="charts-heading" className="mv-visually-hidden">פילוחי המאגר</h2>
        <div className="grid gap-3.5 lg:grid-cols-2">
          {/*
            פילוח הוא טענה על המאגר. „0 בכל פרוסה” למי שאינו רשאי
            לראות קונים או לידים אינו „ריק” אלא תיאור שגוי — ולכן
            הכרטיס נעלם ולא מתרוקן.
          */}
          {canSeeBuyers ? (
            <div className="mv-list-card px-5 py-[18px]">
              <h3 className="m-0 mb-1 flex items-center gap-2" style={{ fontSize: 15.5, fontWeight: 800 }}>
                <IconUsers s={16} /> בשלות הקונים
              </h3>
              <p className="m-0 mb-3 text-[14px]" style={{ color: "var(--color-text-muted)" }}>
                לחיצה על שורה פותחת את הרשימה המסוננת.
              </p>
              <DonutChart
                slices={maturitySlices}
                centerValue={buyerBreakdown === null ? "…" : String(buyerBreakdown.total)}
                centerLabel="קונים"
              />
            </div>
          ) : null}

          {canSeeLeads ? (
            <div className="mv-list-card px-5 py-[18px]">
              <h3 className="m-0 mb-1 flex items-center gap-2" style={{ fontSize: 15.5, fontWeight: 800 }}>
                <IconFilter s={16} /> מצב הלידים
              </h3>
              <p className="m-0 mb-3 text-[14px]" style={{ color: "var(--color-text-muted)" }}>
                המשפך מהפנייה ועד ההמרה.
              </p>
              <BarChart slices={leadSlices} />
            </div>
          ) : null}
        </div>
      </section>
      ) : null}

      <div className="grid items-start gap-6 lg:[grid-template-columns:1fr_340px]">
        {/* ---- מה חשוב לעשות היום ---- */}
        <section
          aria-labelledby="today-tasks-heading"
          className="overflow-hidden rounded-xl border"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <div
            className="flex flex-wrap items-center gap-2.5 px-5 py-4"
            style={{ borderBottom: "1px solid var(--color-card-head-border)" }}
          >
            <h2 id="today-tasks-heading" className="m-0" style={{ fontSize: 18, fontWeight: 800 }}>
              מה חשוב לעשות היום
            </h2>
            <span className="text-[14px]" style={{ color: "var(--color-text-muted)" }}>
              מתעדכן לבד לפי המצב בשטח
            </span>
            {shownTasks.length > 0 ? (
              <span
                className="ms-auto rounded-full px-2.5 py-0.5 text-sm font-bold"
                style={{ background: "var(--color-primary-soft)", color: "var(--color-primary)" }}
              >
                {shownTasks.length} פעולות
              </span>
            ) : null}
          </div>

          {loading ? (
            <p aria-live="polite" className="px-5 py-4">טוען…</p>
          ) : shownTasks.length === 0 ? (
            <p className="px-5 py-6 text-center" style={{ color: "var(--color-text-muted)" }}>
              הכל מטופל ✓ — אפשר לקלוט נכס או קונה חדשים.
            </p>
          ) : (
            <ul className="m-0 list-none p-0">
              {shownTasks.map((t, index) => (
                <li
                  key={t.key}
                  className="mv-todo-row flex items-center gap-3.5 px-5 py-3.5"
                  style={{ borderBottom: "1px solid var(--color-row-border)" }}
                >
                  {/*
                    אייקון במקום מספר סידורי: המספר חזר על עצמו בכל
                    שורה ולא אמר דבר על התוכן, בעוד שהצורה מזהה את סוג
                    הפעולה במבט. הסדר עצמו נשמר במיקום ברשימה, ונקרא
                    לקורא מסך דרך aria-label.
                  */}
                  <span
                    aria-hidden="true"
                    className="grid flex-none place-items-center"
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 9,
                      background: TONE[t.tone].bg,
                      color: TONE[t.tone].fg,
                    }}
                  >
                    {t.icon}
                  </span>
                  <span className="mv-visually-hidden">פעולה {index + 1}:</span>
                  <span className="min-w-0" style={{ lineHeight: 1.35 }}>
                    <span className="block text-[15.5px] font-bold">{t.title}</span>
                    <span className="block text-[14px]" style={{ color: "var(--color-text-muted)" }}>
                      {t.why}
                    </span>
                  </span>
                  {t.href ? (
                    <Link
                      href={t.href}
                      className="ms-auto flex-none text-[14.5px] font-bold no-underline"
                      style={{ color: "var(--color-primary)" }}
                    >
                      {t.action}
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ---- הטור הצדדי: היום ביומן + קליטה בקול ---- */}
        <div className="flex flex-col gap-4">
          {/*
            „אין פגישות מתוכננות להיום” היא טענה על היומן, ומי שאינו
            רשאי לנהל יומן קיבל אותה על סמך 403 — יחד עם קישור
            „ליומן המלא” שמוביל לנתיב שיסרב (ביקורת Codex).
          */}
          {canSeeCalendar ? (
          <section
            aria-labelledby="today-heading"
            className="rounded-xl border px-5 py-4"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          >
            <div className="mb-1 flex items-center">
              <h2 id="today-heading" className="m-0" style={{ fontSize: 16.5, fontWeight: 800 }}>
                היום ביומן
              </h2>
              <Link
                href="/calendar"
                className="ms-auto text-[14px] font-bold no-underline"
                style={{ color: "var(--color-primary)" }}
              >
                ליומן המלא
              </Link>
            </div>
            {todayEvents.length === 0 ? (
              <p className="m-0 py-2 text-[14.5px]" style={{ color: "var(--color-text-muted)" }}>
                אין פגישות מתוכננות להיום.
              </p>
            ) : (
              todayEvents.map((a) => (
                <div
                  key={a.id}
                  className="flex items-baseline gap-3 py-2"
                  style={{ borderBottom: "1px solid var(--color-row-border)" }}
                >
                  <span
                    className="flex-none text-[14.5px] font-extrabold"
                    style={{ width: 40, color: "var(--color-primary)" }}
                  >
                    {timeFmt.format(new Date(a.startsAt))}
                  </span>
                  <span style={{ lineHeight: 1.3 }}>
                    <span className="block text-[15px] font-bold">
                      {a.title ?? APPOINTMENT_KIND_LABELS[a.kind] ?? a.kind}
                    </span>
                    <span className="block text-sm" style={{ color: "var(--color-text-muted)" }}>
                      {APPOINTMENT_KIND_LABELS[a.kind] ?? a.kind}
                      {a.propertyId ? " · נכס" : a.leadId ? " · ליד" : ""}
                    </span>
                  </span>
                </div>
              ))
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
            <section
              aria-labelledby="my-tasks-heading"
              className="rounded-xl border px-5 py-4"
              style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
            >
              <div className="mb-1 flex items-center gap-2">
                <h2 id="my-tasks-heading" className="m-0" style={{ fontSize: 16.5, fontWeight: 800 }}>
                  המשימות שלי
                </h2>
                {dueNow > 0 ? (
                  <span
                    className="rounded-full px-2 py-0.5 text-[14px] font-bold"
                    style={{ background: "#f7e6e0", color: "var(--color-danger)" }}
                  >
                    {dueNow} להיום
                  </span>
                ) : null}
                <Link
                  href="/tasks"
                  className="ms-auto text-[14px] font-bold no-underline"
                  style={{ color: "var(--color-primary)" }}
                >
                  לכל המשימות
                </Link>
              </div>
              {tasksFailed ? (
                <LoadError message="לא הצלחנו לטעון את המשימות" onRetry={loadTasks} />
              ) : myTasks === null ? (
                <p className="m-0 py-2 text-[14.5px]" aria-live="polite" style={{ color: "var(--color-text-muted)" }}>
                  טוען…
                </p>
              ) : shownMyTasks.length === 0 ? (
                <p className="m-0 py-2 text-[14.5px]" style={{ color: "var(--color-text-muted)" }}>
                  <IconCheck s={14} /> אין משימות פתוחות על שמכם.
                </p>
              ) : (
                shownMyTasks.map((t) => {
                  const due = dueLabel(t.dueAt, now);
                  return (
                    <div
                      key={t.id}
                      className="flex items-baseline gap-3 py-2"
                      style={{ borderBottom: "1px solid var(--color-row-border)" }}
                    >
                      <span
                        className="flex-none text-[14px] font-extrabold"
                        style={{
                          width: 58,
                          color: due.urgent ? "var(--color-danger)" : "var(--color-text-muted)",
                        }}
                      >
                        {due.text}
                      </span>
                      <span style={{ lineHeight: 1.3 }}>
                        <span className="block text-[15px] font-bold">{t.title}</span>
                        {t.entityLabel ? (
                          <span className="block text-sm" style={{ color: "var(--color-text-muted)" }}>
                            {t.entityLabel}
                          </span>
                        ) : null}
                      </span>
                    </div>
                  );
                })
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
            <section
              aria-labelledby="coop-heading"
              className="rounded-xl border px-5 py-4"
              style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
            >
              <div className="mb-2 flex items-center gap-2">
                <h2 id="coop-heading" className="m-0 flex items-center gap-2" style={{ fontSize: 16.5, fontWeight: 800 }}>
                  <IconHandshake s={16} /> שת&quot;פים
                </h2>
                <Link
                  href="/collaboration"
                  className="ms-auto text-[14px] font-bold no-underline"
                  style={{ color: "var(--color-primary)" }}
                >
                  לרשת
                </Link>
              </div>
              {networkFailed ? (
                <LoadError message="לא הצלחנו לטעון את מצב הרשת" onRetry={loadNetwork} />
              ) : (
                <>
                  {/*
                    יחיד ורבים ולא "1 הצעות". מספר צמוד לשם עצם בעברית
                    מחייב התאמה, וברשימה קצרה כזו הפער בולט מיד.
                  */}
                  <ul className="m-0 list-none p-0 text-[14.5px]">
                    <li className="flex items-baseline gap-2 py-1.5" style={{ borderBottom: "1px solid var(--color-row-border)" }}>
                      <b style={{ color: (network?.incomingOffers ?? 0) > 0 ? "var(--color-primary)" : undefined }}>
                        {network === null ? "…" : network.incomingOffers}
                      </b>
                      <span>
                        {network?.incomingOffers === 1
                          ? "הצעה שהתקבלה על הביקושים שלכם"
                          : "הצעות שהתקבלו על הביקושים שלכם"}
                      </span>
                    </li>
                    <li className="flex items-baseline gap-2 py-1.5">
                      <b style={{ color: (network?.openReferrals ?? 0) > 0 ? "var(--color-primary)" : undefined }}>
                        {network === null ? "…" : network.openReferrals}
                      </b>
                      <span>
                        {network?.openReferrals === 1
                          ? "הפניית לקוח פתוחה ברשת"
                          : "הפניות לקוחות פתוחות ברשת"}
                      </span>
                    </li>
                  </ul>
                  <p className="m-0 mt-1.5 text-[14px]" style={{ color: "var(--color-text-muted)" }}>
                    {network === null
                      ? "שיתוף פעולה על ביקושים אינו עולה קרדיטים."
                      : `יתרה: ${network.credits} קרדיטים · שיתוף פעולה על ביקושים אינו עולה קרדיטים.`}
                  </p>
                </>
              )}
            </section>
          ) : null}

          {/* קידום שמוביל לפיצ'ר שאינו במסלול נחסם בשרת — אין טעם
              להזמין אליו */}
          {canVoice ? (
            <section
              aria-labelledby="voice-promo-heading"
              className="rounded-xl p-[18px]"
              style={{ background: "#111513", color: "#dfe3e0" }}
            >
              <div className="mb-2 flex items-center gap-2">
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#70EE91"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <rect x="9" y="2.5" width="6" height="11" rx="3" />
                  <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
                  <line x1="12" y1="17.5" x2="12" y2="21" />
                </svg>
                <h2 id="voice-promo-heading" className="m-0 text-sm font-extrabold" style={{ color: "#fff" }}>
                  קלטו נכס בדיבור
                </h2>
              </div>
              <p className="m-0 text-[14.5px]" style={{ lineHeight: 1.5, color: "#aab3ad" }}>
                ״דירת 4 חדרים בהרצל 12 בית שמש, קומה 3, עם מעלית וחניה, 2.4 מיליון״ — פחות
                מדקה, וכרטיס הנכס מוכן.
              </p>
              <Link
                href="/voice"
                className="mt-3 block rounded-[9px] py-[9px] text-center text-[15px] font-bold no-underline"
                style={{ background: "#70EE91", color: "#0B1F12" }}
              >
                נסו עכשיו
              </Link>
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}
