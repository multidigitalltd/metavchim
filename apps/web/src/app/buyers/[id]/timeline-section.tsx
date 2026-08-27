"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button } from "@metavchim/ui";
import { jerusalemDayRange,
  JERUSALEM_TZ,
} from "@metavchim/shared";
import { apiGet, apiPost } from "@/lib/api";
import { can, useRequireAuth } from "@/lib/use-auth";
import { WithDictation } from "../../dictation-field";
import { IconChat, IconDoc, IconGear, IconPhone, IconRefresh } from "../../icons";
import { LoadError } from "../../load-error";
import { Notice } from "../../notice";

/**
 * ציר ההיסטוריה של הקונה (docs/01 §5): כל הערה ותיעוד שיחה במקום אחד —
 * מתווך שני שפותח את הקונה יודע בדיוק איפה הדברים עומדים.
 * טופס ההוספה מוצג רק למי שמחזיק buyers.edit (ביקורת Codex, PR #16).
 *
 * ## למה זה נראה אחרת עכשיו
 *
 * המסך היה רשימת קופסאות אפורות זהות עם שורת מטא-דאטה דהויה בראש
 * כל אחת. הוא הציג את הנתונים נכון ולא סיפר שום סיפור: אי אפשר היה
 * לסרוק אותו במבט ולראות „שלוש שיחות השבוע ואז שקט”, וטופס ההוספה
 * — שורת קלט אחת בגובה 38 פיקסל — נראה כמו שדה חיפוש, לא כמו הזמנה
 * לכתוב.
 *
 * מה שהשתנה, וכל אחד מהם בגלל שאלה שהסוכן שואל:
 *
 * - **ציר אמיתי** — קו אנכי עם נקודה צבועה לכל אירוע. „מה קרה כאן
 *   לאחרונה” נענה בסריקת עין על הצבעים, בלי לקרוא מילה.
 * - **קיבוץ לפי יום** — „היום”, „אתמול”, ואז תאריך. הצפיפות של
 *   יום עמוס נראית, ופער של שבועיים נראה גם הוא.
 * - **בחירת סוג בצ׳יפים** ולא ברשימה נפתחת: שתי אפשרויות אינן
 *   מצדיקות תפריט, ולחיצה אחת מהירה מהקלדה.
 * - **אזור כתיבה רב-שורתי** — תיעוד שיחה הוא משפט או שניים, ושדה
 *   של שורה אחת הסתיר את תחילת מה שנכתב.
 */

interface Interaction {
  id: string;
  kind: string;
  direction?: string;
  content: string;
  createdAt: string;
}

interface InteractionsPage {
  items: Interaction[];
  nextCursor: string | null;
}

/**
 * לכל סוג אירוע — אייקון, שם וצבע.
 *
 * הצבע אינו קישוט: הוא מה שהופך את הציר לניתן לסריקה. שיחה ירוקה,
 * וואטסאפ כחלחל, פעולת מערכת אפורה — והעין מוצאת את הדפוס לפני
 * שהיא קוראת.
 */
const KINDS: Record<string, { icon: ReactNode; label: string; fg: string; bg: string }> = {
  note: { icon: <IconDoc s={14} />, label: "הערה", fg: "var(--color-text-muted)", bg: "var(--domain-neutral-tile)" },
  call: { icon: <IconPhone s={14} />, label: "שיחה", fg: "var(--color-success)", bg: "var(--color-success-soft)" },
  whatsapp: { icon: <IconChat s={14} />, label: "וואטסאפ", fg: "var(--domain-amber-fg)", bg: "var(--domain-amber-bg)" },
  status_change: { icon: <IconRefresh s={14} />, label: "שינוי סטטוס", fg: "var(--color-danger)", bg: "var(--color-danger-soft)" },
  system: { icon: <IconGear s={14} />, label: "מערכת", fg: "var(--chip-neutral-fg)", bg: "var(--chip-neutral-bg)" },
};

const FALLBACK = { icon: <IconDoc s={14} />, label: "אירוע", fg: "var(--chip-neutral-fg)", bg: "var(--chip-neutral-bg)" };

const hourFmt = new Intl.DateTimeFormat("he-IL", {
  timeZone: JERUSALEM_TZ, timeStyle: "short" });
const dayFmt = new Intl.DateTimeFormat("he-IL", {
  timeZone: JERUSALEM_TZ,
  day: "numeric",
  month: "long",
  year: "numeric",
});

/**
 * כותרת היום שמעל קבוצת האירועים.
 *
 * „היום” ו„אתמול” ולא תאריך: אלה שני הימים שסוכן מתייחס אליהם
 * יחסית, וכתיבת תאריך מלא עליהם מכריחה אותו לחשב.
 */
function dayLabel(date: Date, now: Date): string {
  /*
   * גבול היום בשעון ישראל, לא בשעון המכשיר. `getDate()` היה קובע
   * את „היום” של המתווך: אירוע שקרה ב-23:00 בישראל נקרא „אתמול”
   * למי שנמצא בניו-יורק, ולהפך.
   */
  const startOf = (d: Date): number => jerusalemDayRange(d).start.getTime();
  const days = Math.round((startOf(now) - startOf(date)) / 86_400_000);
  if (days <= 0) return "היום";
  if (days === 1) return "אתמול";
  return dayFmt.format(date);
}

/** קיבוץ לפי יום — שומר על סדר הרשימה שהגיעה מהשרת (חדש → ישן). */
function groupByDay(items: Interaction[], now: Date): [string, Interaction[]][] {
  const groups: [string, Interaction[]][] = [];
  for (const item of items) {
    const label = dayLabel(new Date(item.createdAt), now);
    const last = groups[groups.length - 1];
    if (last && last[0] === label) last[1].push(item);
    else groups.push([label, [item]]);
  }
  return groups;
}

export function TimelineSection({ buyerId }: { buyerId: string }) {
  const { user } = useRequireAuth();
  const [items, setItems] = useState<Interaction[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [kind, setKind] = useState<"note" | "call">("note");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canEdit = can(user, "buyers.edit");

  /*
   * ציר ריק מוצג כאן כמסך פתיחה מזמין („עדיין אין היסטוריה”) — וזה
   * נכון ללקוח חדש, אבל שקר גמור על לקוח ותיק שהטעינה שלו נכשלה.
   * המתווך מרים טלפון בלי לדעת מה נאמר בשיחה הקודמת.
   */
  const [loadFailed, setLoadFailed] = useState(false);

  const loadFirstPage = useCallback(() => {
    setLoadFailed(false);
    apiGet<InteractionsPage>(`/buyers/${buyerId}/interactions`)
      .then((page) => {
        setItems(page.items);
        setNextCursor(page.nextCursor);
      })
      .catch(() => setLoadFailed(true));
  }, [buyerId]);

  useEffect(loadFirstPage, [loadFirstPage]);

  async function loadMore(): Promise<void> {
    if (!nextCursor) return;
    setBusy(true);
    try {
      const page = await apiGet<InteractionsPage>(
        `/buyers/${buyerId}/interactions?cursor=${encodeURIComponent(nextCursor)}`,
      );
      setItems((prev) => [...(prev ?? []), ...page.items]);
      setNextCursor(page.nextCursor);
    } catch {
      setError("טעינת המשך ההיסטוריה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function onAdd(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (content.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/buyers/${buyerId}/interactions`, { kind, content: content.trim() });
      setContent("");
      const page = await apiGet<InteractionsPage>(`/buyers/${buyerId}/interactions`);
      setItems(page.items);
      setNextCursor(page.nextCursor);
    } catch {
      setError("שמירת התיעוד נכשלה");
    } finally {
      setBusy(false);
    }
  }

  /*
   * „עכשיו” נלכד פעם אחת לכל רינדור ולא בכל שורה: שתי קריאות
   * לשעון בתוך אותה רשימה יכולות ליפול משני צדי חצות, ואז שני
   * אירועים מאותה דקה מקובצים תחת „היום” ו„אתמול”.
   */
  const now = new Date();
  const groups = items === null ? [] : groupByDay(items, now);

  return (
    <section aria-labelledby="timeline-heading" className="mb-8">
      <h2 id="timeline-heading" className="mb-1 text-lg font-semibold">
        היסטוריה {items ? `(${items.length}${nextCursor ? "+" : ""})` : ""}
      </h2>
      <p className="m-0 mb-4 text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
        כל מה שנאמר עם הלקוח, בסדר כרונולוגי. מי שיפתח את הכרטיס אחריכם
        יראה בדיוק את אותה תמונה.
      </p>

      {canEdit ? (
        /*
          כרטיס ולא שורה. הטופס הישן היה שדה יחיד ברוחב מלא שנראה
          כמו חיפוש; קופסה עם רקע רך ומסגרת אומרת „כאן כותבים”.
        */
        <form
          onSubmit={onAdd}
          className="mb-6 rounded-2xl border p-4"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-primary-soft)",
          }}
        >
          <fieldset className="m-0 mb-3 border-0 p-0">
            <legend className="mb-2 p-0 text-[length:var(--type-caption)] font-bold">מה קרה?</legend>
            <div className="flex flex-wrap gap-2">
              {(["note", "call"] as const).map((option) => {
                const meta = KINDS[option] ?? FALLBACK;
                const active = kind === option;
                return (
                  <button
                    key={option}
                    type="button"
                    className="mv-chip"
                    aria-pressed={active}
                    onClick={() => setKind(option)}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      {meta.icon}
                      {meta.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <label htmlFor="int-content" className="mb-1 block text-[length:var(--type-caption)] font-bold">
            {kind === "call" ? "מה סוכם בשיחה?" : "מה חשוב לזכור?"}
          </label>
          <WithDictation value={content} onChange={setContent}>
            <textarea
              id="int-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              maxLength={4000}
              rows={3}
              placeholder={
                kind === "call"
                  ? 'למשל: "דיברנו — מחפש כניסה מיידית, גמיש בתקציב עד 2.7"'
                  : 'למשל: "מעדיף קומה גבוהה, לא ראה עדיין את הרחוב"'
              }
              className="w-full rounded-xl border px-3 py-2.5 text-[length:var(--type-body-sm)]"
              style={{
                borderColor: "var(--color-input-border)",
                background: "var(--color-surface)",
                resize: "vertical",
              }}
            />
          </WithDictation>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
              נשמר לצמיתות ומשויך אליכם.
            </span>
            <Button type="submit" disabled={busy || content.trim() === ""}>
              {busy ? "שומר…" : "שמירה בציר"}
            </Button>
          </div>
        </form>
      ) : null}

      {error ? (
        <Notice tone="danger">{error}</Notice>
      ) : null}

      {loadFailed ? (
        <LoadError message="לא הצלחנו לטעון את ההיסטוריה" onRetry={loadFirstPage} />
      ) : items === null ? (
        <p aria-live="polite">טוען היסטוריה…</p>
      ) : items.length === 0 ? (
        /*
          מצב ריק שמסביר ומזמין, במקום משפט אפור בשורה אחת. זה המסך
          הראשון שסוכן רואה על כל לקוח חדש.
        */
        <div
          className="rounded-2xl border p-6 text-center"
          style={{ borderColor: "var(--color-border)", borderStyle: "dashed" }}
        >
          <span
            className="mx-auto mb-3 flex items-center justify-center rounded-full"
            style={{ width: 44, height: 44, background: "var(--color-primary-soft)" }}
            aria-hidden="true"
          >
            <IconDoc s={20} />
          </span>
          <p className="m-0 text-[length:var(--type-body)] font-bold">הציר עוד ריק</p>
          <p className="m-0 mt-1 text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
            {canEdit
              ? "אחרי השיחה הראשונה — שורה אחת כאן שווה יותר מזיכרון."
              : "עדיין לא תועד דבר על הלקוח הזה."}
          </p>
        </div>
      ) : (
        <>
          {groups.map(([label, group]) => (
            <div key={label} className="mb-5">
              <h3
                className="m-0 mb-2 text-[length:var(--type-caption)] font-bold"
                style={{ color: "var(--color-text-muted)" }}
              >
                {label}
              </h3>
              {/*
                הקו האנכי הוא גבול על ה-`ol` עצמו, בצד ההתחלה
                (ימין ב-RTL) — ולכן הוא נמתח בדיוק לגובה הקבוצה
                בלי אלמנט נוסף שצריך למדוד.
              */}
              <ol
                className="m-0 list-none p-0"
                style={{
                  borderInlineStart: "2px solid var(--color-border)",
                  paddingInlineStart: 18,
                  marginInlineStart: 9,
                }}
              >
                {group.map((i) => {
                  const meta = KINDS[i.kind] ?? FALLBACK;
                  return (
                    <li key={i.id} className="relative pb-4 last:pb-0">
                      {/*
                        הנקודה על הקו: חצי מרוחב הנקודה ועוד מחצית
                        עובי הקו החוצה, כדי שתשב עליו במרכזה.
                      */}
                      <span
                        aria-hidden="true"
                        className="absolute flex items-center justify-center rounded-full"
                        style={{
                          insetInlineStart: -29,
                          top: 2,
                          width: 22,
                          height: 22,
                          background: meta.bg,
                          color: meta.fg,
                          boxShadow: "0 0 0 3px var(--color-bg)",
                        }}
                      >
                        {meta.icon}
                      </span>
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="text-[length:var(--type-caption)] font-bold" style={{ color: meta.fg }}>
                          {meta.label}
                          {i.direction ? (i.direction === "in" ? " נכנסת" : " יוצאת") : ""}
                        </span>
                        <time
                          dateTime={i.createdAt}
                          className="text-[length:var(--type-caption)]"
                          style={{ color: "var(--color-text-muted)" }}
                        >
                          {hourFmt.format(new Date(i.createdAt))}
                        </time>
                      </div>
                      <p
                        className="m-0 mt-1 whitespace-pre-wrap text-[length:var(--type-body-sm)]"
                        style={{ lineHeight: 1.6 }}
                      >
                        {i.content}
                      </p>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
          {nextCursor ? (
            <Button variant="secondary" onClick={loadMore} disabled={busy}>
              {busy ? "טוען…" : "הצג היסטוריה ישנה יותר"}
            </Button>
          ) : null}
        </>
      )}
    </section>
  );
}
