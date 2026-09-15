"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@metavchim/ui";
import {
  compareLeadsByUrgency,
  leadWaiting,
  OPEN_LEAD_STATUSES,
  type LeadWaitingLevel,
  labelOf,
} from "@metavchim/shared";
import { apiGet, apiList } from "@/lib/api";
import { waMeUrl } from "@/lib/format";
import { LEAD_INTENT_LABELS, LEAD_STATUS_LABELS, leadSourceText } from "@/lib/lead-labels";
import { can, useRequireAuth } from "@/lib/use-auth";
import { useFeature } from "@/lib/use-features";
import { IconChat, IconGlobe, IconLink, IconMic, IconPhone, IconTrash } from "../icons";
import { CapNote, FilterBar, FilterSelect, SearchField, textMatches,
  useFilterFromUrl,
} from "../list-controls";
import { AgentTag } from "../agent-tag";
import { ConvertMenu } from "./convert-menu";
import { Notice } from "../notice";
import { DeleteLeadDialog } from "./delete-lead-dialog";
import { LeadsPulse } from "./leads-pulse";

/**
 * מסך הלידים לפי קובץ העיצוב: טבלת grid עם תג "דחוף", זמן המתנה
 * צבעוני, גלולת סטטוס ופעולות ישירות בשורה — חייג / וואטסאפ /
 * המר לקונה. למטה: תיבת קוד ההטמעה לטופס האתר.
 */

interface LeadRow {
  id: string;
  contact: { name: string; phone: string };
  source: string;
  /** ‏הטקסט שנכתב תחת מקור „אחר”. חסר בכל מקור אחר. */
  sourceNote?: string;
  intent: string;
  status: string;
  requiresHuman: boolean;
  /** הסוכן המטפל. חסר = לא משויך. */
  agentName?: string;
  createdAt: string;
}

/* צבעי זמן ההמתנה מהעיצוב; הענבר מועמק ל-AA (docs/06 §4) */
const WAITING_COLOR: Record<LeadWaitingLevel, string> = {
  ok: "var(--color-text-muted)",
  warn: "#8a6414",
  late: "var(--color-danger)",
};

/* גלולת הסטטוס — אותה משפחת צבעים כמו בעיצוב */
const STATUS_PILL: Record<string, { fg: string; bg: string }> = {
  new: { fg: "var(--color-success)", bg: "var(--color-success-soft)" },
  in_progress: { fg: "var(--domain-amber-fg)", bg: "var(--domain-amber-bg)" },
  converted: { fg: "var(--color-text-muted)", bg: "var(--domain-neutral-tile)" },
  closed: { fg: "var(--chip-neutral-fg)", bg: "var(--chip-neutral-bg)" },
};

const GRID = "1.4fr 1fr 1.6fr 1fr 0.9fr 1.3fr";

/**
 * ‎**המונה על הלשונית — מהפירוק שהמסד החזיר.**
 *
 * ‎`OPEN_LEAD_STATUSES` היא אותה הגדרה שהשרת מסנן לפיה, ולכן החיבור
 * כאן אינו יכול לחלוק על מה שהלשונית תציג. `null` = הפירוק לא נטען,
 * והלשונית מוצגת בלי מספר — עדיף על מספר שאינו נכון.
 */
function bucketCount(
  counts: Record<string, number> | null,
  bucket: "open" | "done" | "all",
): number | null {
  if (counts === null) return null;
  let total = 0;
  for (const [statusKey, n] of Object.entries(counts)) {
    const open = (OPEN_LEAD_STATUSES as readonly string[]).includes(statusKey);
    if (bucket === "all" || (bucket === "open") === open) total += n;
  }
  return total;
}

export default function LeadsPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const canVoice = useFeature("voice_intake");
  const canDelete = can(user, "leads.delete");
  /*
   * ‎**אותן שתי יכולות שכרטיס הליד בודק** — ולא יכולת חדשה ל„המרה”.
   *
   * התפריט אינו ממיר בעצמו: הוא מנווט אל הטפסים שכבר קיימים שם,
   * וכל אחד מהם מוגן ביכולת שלו. הצגת אפשרות שהמסך הבא לא יראה
   * הייתה שולחת את המתווך למקום ריק.
   */
  const canConvertBuyer = can(user, "buyers.edit");
  const canConvertProperty = can(user, "properties.create");
  const [items, setItems] = useState<LeadRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /* הליד שעליו נפתח חלון המחיקה — שורה אחת בכל רגע */
  const [deleting, setDeleting] = useState<LeadRow | null>(null);
  const [deleted, setDeleted] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  /*
   * ‎**„חדש” כברירת מחדל** (בקשת המשתמש).
   *
   * מה שמתווך פותח את המסך כדי לעשות הוא לטפל במה שעוד לא טופל.
   * ‏„בטיפול” ו„ממתין ללקוח” הם לידים שכבר נגעו בהם, והם דוחקים
   * למטה בדיוק את מי שממתין למגע ראשון.
   *
   * ‎**זה סינון גלוי ולא מצב נסתר:** שורת הסינון מציגה „מציג X
   * מתוך Y” עם כפתור ניקוי, לחיצה על לשונית מנקה אותו, וקישור
   * מהדשבורד עם `?status=` גובר עליו.
   */
  const [status, setStatus] = useState("new");
  /*
   * ‎**„לטיפול” היא ברירת המחדל, לא „הכל”** (בקשת המשתמש).
   *
   * ‏ליד שהומר כבר הפך לכרטיס קונה, וכל מה שנעשה איתו נעשה שם.
   * הצגתו לצד מי שממתין למענה מנפחת את הרשימה במשהו שאין בו
   * פעולה — והופכת „כמה לידים יש לי” למספר שאי אפשר לאפס, כלומר
   * למד עומס במקום לרשימת עבודה.
   *
   * ‎`OPEN_LEAD_STATUSES` ולא רשימה שנכתבת כאן: היא כבר מגדירה
   * „ליד חי” בשרת (פנייה נוספת מצטרפת אליו במקום לפצל ציר זמן),
   * ושתי הגדרות שנפרדות היו מציגות מסך שאינו תואם להתנהגות.
   */
  const [bucket, setBucket] = useState<"open" | "done" | "all">("open");
  const [urgency, setUrgency] = useState("");
  const [intent, setIntent] = useState("");

  /*
   * קישורי המשפך מהדשבורד: ‎/leads?status=new‎ וכדומה.
   *
   * ‎**הלשונית נגררת אחרי הסטטוס שבקישור.** מרגע שהלשונית מסננת
   * במסד, קישור לסטטוס שאינו בלשונית הנוכחית היה נוחת על רשימה
   * ריקה בלי שום הסבר — הסטטוס נבחר, והשורות פשוט אינן שם. היום
   * הדשבורד מקשר רק לשלושת הפתוחים, וזו בדיוק הסיבה לסגור את זה
   * עכשיו ולא אחרי שיתווסף הקישור הרביעי.
   */
  useFilterFromUrl({
    status: (value) => {
      setStatus(value);
      setBucket(
        (OPEN_LEAD_STATUSES as readonly string[]).includes(value) ? "open" : "done",
      );
    },
    intent: setIntent,
  });
  // שעון קפוא לרינדור — כדי שכל השורות ימדדו מול אותו רגע
  const [now, setNow] = useState<Date | null>(null);

  /*
   * ‎**הלשונית מסננת במסד, לא על העמוד שחזר** (ביקורת Codex).
   *
   * החלוקה רצה קודם על מה ש-`/leads?limit=100` החזיר. במשרד עם יותר
   * מ-100 לידים, ליד פתוח שנדחק מחוץ לעמוד על-ידי לידים סגורים
   * חדשים ממנו **פשוט לא הופיע בתור העבודה** — ואין שום סימן לכך
   * שהוא קיים. הפרמטר `open` עושה את החלוקה ב-`where` של השאילתה,
   * לפני התקרה.
   *
   * שאר הסינונים (חיפוש, כוונה, דחיפות) נשארים מקומיים: הם מצמצמים
   * בתוך הלשונית, ו-`CapNote` אומר מתי התקרה נגעה.
   */
  useEffect(() => {
    if (authLoading) return;
    setItems(null);
    const scope = bucket === "all" ? "" : `&open=${bucket === "open"}`;
    apiGet<{ items: LeadRow[] }>(`/leads?limit=100${scope}`)
      .then((res) => {
        setItems([...apiList(res.items, "items")].sort(compareLeadsByUrgency));
        setNow(new Date());
      })
      .catch(() => setError("טעינת הלידים נכשלה"));
  }, [authLoading, bucket]);

  /*
   * ‎**המונים על הלשוניות מגיעים מהמסד** ולא מספירת השורות שהמסך
   * במקרה טען. מונה שנספר מ-100 שורות היה מציג „לטיפול (63)” במשרד
   * שיש בו 400 — מספר שנראה סמכותי ואינו נכון, וזו בדיוק הסיבה
   * ש-`/leads/breakdown` כבר קיים.
   */
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    if (authLoading) return;
    apiGet<{ byStatus: Record<string, number> }>("/leads/breakdown")
      .then((res) => setCounts(res.byStatus))
      /* בלי מונים הלשוניות עדיין עובדות — הן פשוט בלי המספר. */
      .catch(() => setCounts(null));
  }, [authLoading]);

  /*
   * ‎**„אין לידים” הוא משפט על המשרד, לא על הלשונית.**
   *
   * מסך הפתיחה עם „חברו את טופס האתר” נכון למשרד שאין לו לידים
   * כלל. מרגע שהלשונית מסננת במסד, לשונית ריקה הייתה מציגה אותו —
   * ובעיקר **מסתירה את הלשוניות עצמן**, כי כל הפריסה יושבת בענף
   * השני. משרד עם 400 לידים שלחץ „טופל” היה נתקע במסך הדרכה בלי
   * דרך לחזור.
   *
   * הפירוק יודע את התשובה במדויק. כשהוא לא נטען נשארת ההתנהגות
   * הקודמת — לשונית ברירת המחדל בלבד — כדי שמשרד חדש עדיין יקבל
   * את מסך הפתיחה.
   */
  const officeEmpty =
    counts === null
      ? items !== null && items.length === 0 && bucket === "open"
      : bucketCount(counts, "all") === 0;

  const visible = useMemo(
    () =>
      (items ?? []).filter(
        (l) =>
          textMatches(query, l.contact.name, l.contact.phone) &&
          /*
           * הלשונית כבר סוננה במסד (ראו האפקט למעלה), ולכן אינה
           * מופיעה כאן. הבורר שמתחתיה מדויק, והם מצטלבים ואינם
           * מתחרים: „טופל” + „סגור” הוא חיתוך תקין.
           */
          (!status || l.status === status) &&
          (!intent || l.intent === intent) &&
          // "מי מחכה יותר מדי" — הסינון שמייצר את שיחת הטלפון הבאה
          (urgency === "" ||
            (urgency === "human" && l.requiresHuman) ||
            (urgency === "late" &&
              now !== null &&
              leadWaiting(l.createdAt, l.status, now)?.level === "late")),
      ),
    [items, query, status, intent, urgency, now],
  );

  return (
    <>
      {/*
        בלי שורת הסבר בראש המסך. „לידים מטופס האתר נכנסים לכאן
        אוטומטית” הוא משפט הדרכה — הוא נקרא פעם אחת ואז נשאר לתפוס
        מקום לנצח, מעל התוכן שבאמת מסתכלים עליו. מקומו במדריכים.
      */}
      <div className="mb-[18px] flex flex-wrap items-center gap-3">
        <h1 className="m-0" style={{ fontSize: "var(--type-panel)", fontWeight: 800 }}>
          לידים
        </h1>
        <div className="ms-auto flex flex-wrap gap-2.5">
          {canVoice ? (
            <Link href="/voice" className="mv-btn-plain" style={{ padding: "8px 14px", fontSize: "var(--type-caption)" }}>
              <IconMic s={15} /> ליד בקול
            </Link>
          ) : null}
          <Link href="/leads/new" className="mv-btn-action">
            + ליד ידני
          </Link>
        </div>
      </div>

      {/* מה ירד ומה נשאר — השאלה היחידה שיש למוחק מיד אחרי הלחיצה */}
      {deleted ? (
        <Notice tone="success" onClose={() => setDeleted(null)}>
          {deleted}
        </Notice>
      ) : null}

      {error ? (
        <Notice tone="danger">{error}</Notice>
      ) : items === null ? (
        <p aria-live="polite">טוען לידים…</p>
      ) : officeEmpty ? (
        <div className="rounded-xl border p-8 text-center" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
          <p className="mb-3 text-lg font-semibold">אין עדיין לידים</p>
          <p className="mb-4" style={{ color: "var(--color-text-muted)" }}>
            אפשר להוסיף ליד ידנית או בקול — וגם לחבר את טופס יצירת הקשר
            שבאתר המשרד, כך שכל פנייה תיכנס לכאן אוטומטית.
          </p>
          <Link href="/settings">
            <Button variant="secondary">חיבור לידים מהאתר</Button>
          </Link>
        </div>
      ) : (
        <>
          {/*
            שלושה מספרים לפני הרשימה.
            
            מסך שנפתח ישר לתוך טבלה מחייב לספור בעיניים כדי לענות על
            השאלה היחידה שמתווך שואל בבוקר: „מה בוער”. האריחים גם
            מסננים בלחיצה — מספר שאי אפשר ללחוץ עליו הוא מספר שצריך
            לפעול לפיו ידנית.
          */}
          <LeadsPulse
            items={items}
            now={now}
            urgency={urgency}
            onPick={(next) => {
              setUrgency(next === urgency ? "" : next);
              setStatus("");
            }}
          />

          {/*
            שלוש לשוניות ולא בורר רביעי: זו החלוקה שקובעת *על מה
            מסתכלים*, והיא צריכה להיות גלויה תמיד — בורר נוסף בשורת
            הסינונים היה מסתיר את העובדה שהרשימה מסוננת כברירת מחדל.
          */}
          <div className="mb-3 flex gap-1.5" role="tablist" aria-label="אילו לידים להציג">
            {(
              [
                ["open", "לטיפול"],
                ["done", "טופל"],
                ["all", "הכל"],
              ] as const
            ).map(([key, label]) => {
              const count = bucketCount(counts, key);
              const on = bucket === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => {
                    setBucket(key);
                    /* בורר סטטוס שנשאר מהלשונית הקודמת מייצר רשימה ריקה בלי סיבה נראית. */
                    setStatus("");
                  }}
                  /*
                    ‎`primary-soft` על `primary` — אותה גלולה נבחרת
                    שכבר בשימוש במסכים אחרים. `--color-on-primary`
                    שכתבתי כאן קודם אינו קיים כלל, ו-`--color-border`
                    הוא מסגרת דקורטיבית (1.65:1) ולא גבול פקד —
                    שער הניגודיות תפס את שניהם.
                  */
                  className="rounded-full border px-3.5 py-1.5 text-sm font-semibold"
                  style={{
                    background: on ? "var(--color-primary-soft)" : "var(--color-surface)",
                    color: on ? "var(--color-primary)" : "var(--color-text)",
                    borderColor: on ? "var(--color-primary)" : "var(--color-input-border)",
                  }}
                >
                  {count === null ? label : `${label} (${count})`}
                </button>
              );
            })}
          </div>

          <FilterBar
            shown={visible.length}
            total={items.length}
            noun="לידים"
            active={query.trim() !== "" || status !== "" || intent !== "" || urgency !== ""}
            onClear={() => {
              setQuery("");
              setStatus("");
              setIntent("");
              setUrgency("");
            }}
          >
            <SearchField
              label="חיפוש ליד"
              placeholder="שם או טלפון"
              value={query}
              onChange={setQuery}
            />
            <FilterSelect
              label="סינון לפי סטטוס"
              value={status}
              onChange={setStatus}
              allLabel="כל הסטטוסים"
              options={Object.entries(LEAD_STATUS_LABELS)}
            />
            <FilterSelect
              label="סינון לפי כוונה"
              value={intent}
              onChange={setIntent}
              allLabel="כל הכוונות"
              options={Object.entries(LEAD_INTENT_LABELS)}
            />
            <FilterSelect
              label="סינון לפי דחיפות"
              value={urgency}
              onChange={setUrgency}
              allLabel="כל רמות הדחיפות"
              options={[
                ["human", "דורשים טיפול אנושי"],
                ["late", "ממתינים יותר מדי"],
              ]}
            />
          </FilterBar>

          {visible.length === 0 ? (
            <div
              className="rounded-xl border p-8 text-center"
              style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
            >
              <p className="mb-3">אף ליד לא תואם את הסינון.</p>
              <Button
                variant="secondary"
                onClick={() => {
                  setQuery("");
                  setStatus("");
                  setIntent("");
                  setUrgency("");
                }}
              >
                נקה סינון
              </Button>
            </div>
          ) : (
            <>
              {/* מובייל: כרטיסים (docs/06 §1.5) */}
              <ul className="flex flex-col gap-3 sm:hidden">
                {visible.map((lead) => {
                  const waiting = now ? leadWaiting(lead.createdAt, lead.status, now) : null;
                  const pill = STATUS_PILL[lead.status] ?? STATUS_PILL["closed"]!;
                  return (
                    <li
                      key={lead.id}
                      className="rounded-xl border p-3"
                      style={{
                        borderColor: lead.requiresHuman || waiting?.level === "late" ? "var(--color-danger)" : "var(--color-border)",
                        background: "var(--color-surface)",
                      }}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/leads/${lead.id}`} className="font-bold underline">
                          {lead.contact.name}
                        </Link>
                        {lead.requiresHuman ? (
                          <span className="mv-tag" style={{ background: "var(--color-danger-soft)", color: "var(--color-danger)" }}>דחוף</span>
                        ) : null}
                        <span className="mv-pill ms-auto" style={{ color: pill.fg, background: pill.bg }}>
                          {labelOf(LEAD_STATUS_LABELS, lead.status) ?? lead.status}
                        </span>
                      </div>
                      <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
                        {labelOf(LEAD_INTENT_LABELS, lead.intent) ?? lead.intent} ·{" "}
                        {leadSourceText(lead.source, lead.sourceNote)}
                      </p>
                      {waiting ? (
                        <p className="text-sm font-extrabold" style={{ color: WAITING_COLOR[waiting.level] }}>
                          {waiting.label}
                        </p>
                      ) : null}
                      <div className="mt-2 flex flex-wrap gap-2">
                        <a href={`tel:${lead.contact.phone}`} className="mv-btn-soft">
                          <IconPhone s={15} /> חייג
                        </a>
                        <a href={waMeUrl(lead.contact.phone)} target="_blank" rel="noopener noreferrer" className="mv-btn-plain">
                          <IconChat s={15} /> וואטסאפ
                        </a>
                        {/*
                          ‎**ההמרה מהרשימה** — הצד וסוג העסקה נבחרים
                          כאן, והטופס נפתח כבר מלא בכרטיס.
                        */}
                        {lead.status !== "converted" ? (
                          <ConvertMenu
                            leadId={lead.id}
                            leadName={lead.contact.name}
                            canBuyer={canConvertBuyer}
                            canProperty={canConvertProperty}
                          />
                        ) : null}
                        {/* ליד שהומר כבר יצר כרטיס — מוחקים את הכרטיס, לא את המקור */}
                        {canDelete && lead.status !== "converted" ? (
                          <button
                            type="button"
                            className="mv-btn-plain ms-auto"
                            style={{ color: "var(--color-danger)" }}
                            onClick={() => setDeleting(lead)}
                          >
                            <IconTrash s={15} /> מחק
                          </button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>

              {/* שולחני: טבלת ה-grid מהעיצוב */}
              <div className="mv-list-card hidden sm:block">
                <div className="mv-list-head" style={{ gridTemplateColumns: GRID }}>
                  <span>שם</span>
                  <span>מקור</span>
                  <span>מה הוא רוצה</span>
                  <span>ממתין</span>
                  <span>סטטוס</span>
                  <span>פעולות</span>
                </div>
                {visible.map((lead) => {
                  const waiting = now ? leadWaiting(lead.createdAt, lead.status, now) : null;
                  const pill = STATUS_PILL[lead.status] ?? STATUS_PILL["closed"]!;
                  return (
                    <div key={lead.id} className="mv-list-row" style={{ gridTemplateColumns: GRID }}>
                      <span className="flex items-center gap-2 truncate text-[length:var(--type-body)] font-bold">
                        {/*
                          אות ראשונה בעיגול. ברשימה של עשרות שורות
                          זהות היא מה שמאפשר למצוא שוב שורה שכבר
                          ראית, בלי לקרוא את כל השמות מחדש.
                        */}
                        <span className="mv-avatar-dot" aria-hidden="true">
                          {lead.contact.name.trim().slice(0, 1)}
                        </span>
                        <Link href={`/leads/${lead.id}`} className="truncate no-underline hover:underline" style={{ color: "inherit" }}>
                          {lead.contact.name}
                        </Link>
                        {lead.requiresHuman ? (
                          <span className="mv-tag" style={{ background: "var(--color-danger-soft)", color: "var(--color-danger)" }}>דחוף</span>
                        ) : null}
                      </span>
                      <span className="flex items-center gap-1.5 truncate text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-soft)" }}>
                        <IconGlobe s={14} />
                        {leadSourceText(lead.source, lead.sourceNote)}
                      </span>
                      <span className="truncate text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-soft)" }}>
                        {labelOf(LEAD_INTENT_LABELS, lead.intent) ?? lead.intent}
                      </span>
                      <span className="text-[length:var(--type-caption-lg)] font-extrabold" style={{ color: waiting ? WAITING_COLOR[waiting.level] : "var(--color-text-muted)" }}>
                        {waiting?.label ?? "—"}
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <AgentTag
                          {...(lead.agentName === undefined ? {} : { name: lead.agentName })}
                        />
                        <span className="mv-pill" style={{ color: pill.fg, background: pill.bg, fontSize: "var(--type-caption)" }}>
                          {labelOf(LEAD_STATUS_LABELS, lead.status) ?? lead.status}
                        </span>
                      </span>
                      <span className="flex gap-[7px]">
                        <a href={`tel:${lead.contact.phone}`} className="mv-btn-soft">
                          <IconPhone s={15} /> חייג
                        </a>
                        <a href={waMeUrl(lead.contact.phone)} target="_blank" rel="noopener noreferrer" className="mv-btn-plain">
                          <IconChat s={15} /> וואטסאפ
                        </a>
                        {lead.status !== "converted" ? (
                          <ConvertMenu
                            leadId={lead.id}
                            leadName={lead.contact.name}
                            canBuyer={canConvertBuyer}
                            canProperty={canConvertProperty}
                          />
                        ) : null}
                        {/*
                          מחיקה מהשורה — בלי להיכנס לכרטיס ובלי לגלול
                          אליו עד הסוף. הכפתור בלי מילה כדי שלא ייקח
                          את מקומן של החיוג והוואטסאפ שנלחצות פי כמה,
                          ועם שם נגיש כי סמל לבדו אינו נקרא.
                        */}
                        {canDelete && lead.status !== "converted" ? (
                          <button
                            type="button"
                            className="mv-btn-plain"
                            style={{ color: "var(--color-danger)" }}
                            aria-label={`מחיקת הליד של ${lead.contact.name}`}
                            onClick={() => setDeleting(lead)}
                          >
                            <IconTrash s={15} />
                          </button>
                        ) : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/*
            קליטת לידים מפרסום — **כתובת קליטה, לא קוד הטמעה**.

            הניסוח הקודם ("יש לכם אתר משרד? הדביקו את קוד הטופס") שגה
            בשני דברים. הראשון: הוא צמצם את ההצעה למי שיש לו אתר,
            כלומר למיעוט מהמשרדים — רובם משווקים בדף פייסבוק,
            באינסטגרם או בקמפיין ממומן, וכולם יכולים לקלוט לידים.

            השני חמור יותר: **טופס ההטמעה המוכן הוסר** (ראו
            `lead-webhook-section.tsx`), ומה שהמסך באמת נותן הוא כתובת
            שאליה שולחים POST. "קוד הטמעה" הבטיח משהו שאין, ומי שהלך
            לחפש אותו מצא כתובת ולא הבין מה לעשות איתה. הבטחה שאי
            אפשר לקיים גרועה מניסוח צר (ביקורת Codex).
          */}
          <div
            className="mt-3.5 flex flex-wrap items-center gap-3 rounded-xl border border-dashed px-[18px] py-3.5"
            style={{ borderColor: "#cfd6ce", background: "var(--color-surface)" }}
          >
            <span className="flex items-center gap-2 text-[length:var(--type-body-sm)]" style={{ color: "var(--color-text-muted)" }}>
              <IconLink s={16} />
              כתובת קליטה לכל ערוץ פרסום
            </span>
            <Link href="/settings" className="mv-btn-plain ms-auto" style={{ color: "var(--color-primary)" }}>
              הגדרת מקורות לידים
            </Link>
          </div>

          <CapNote
            /*
              התקרה חלה **בתוך הלשונית**, ולכן היא ראויה לציון גם בלי
              סינון מקומי: הלשונית עצמה כבר מצמצמת במסד.
            */
            show={items.length === 100}
            noun="לידים"
          />
        </>
      )}

      {deleting ? (
        <DeleteLeadDialog
          leadId={deleting.id}
          contactName={deleting.contact.name}
          open
          onClose={() => setDeleting(null)}
          onDeleted={(message) => {
            // השורה יורדת מהמסך בלי טעינה מחדש של הרשימה כולה
            setItems((prev) => (prev ?? []).filter((l) => l.id !== deleting.id));
            setDeleting(null);
            setDeleted(message);
          }}
        />
      ) : null}
    </>
  );
}
