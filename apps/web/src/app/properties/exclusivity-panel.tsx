"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@metavchim/ui";
import {
  EXCLUSIVITY_THIRD_WARNING_DAYS,
  MARKETING_ACTION_KINDS,
  MARKETING_ACTION_LABEL,
  MAX_EXCLUSIVITY_MONTHS,
  MIN_BROKERS_FOR_NETWORK_ACTION,
  MIN_MARKETING_ACTIONS,
  addMonths,
  defaultExclusivityEnd,
  exclusivityRejectionReason,
  formatJerusalemDate,
  jerusalemWallParts,
  ownerReportText,
  type ExclusivitySubject,
  type MarketingActionKind,
} from "@metavchim/shared";
import { apiDelete, apiGet, apiPost, ApiError } from "@/lib/api";
import { useCopy } from "@/lib/clipboard";
import { SelectMenu } from "../select-menu";
import { Notice } from "../notice";
import { IconCalendar, IconCheck, IconClock } from "../icons";

/**
 * תיק הבלעדיות בכרטיס הנכס.
 *
 * המספר שהמסך מוביל איתו הוא **לא** התאריך שבחוזה אלא מה שנשאר
 * בפועל: בלעדיות שלא תועדו בה שתי פעולות שיווק מסתיימת בתום שליש
 * מהתקופה (חוק המתווכים, סעיף 9(ב2)) — חודשיים לפני מה שכתוב.
 * הפער הזה הוא כל הסיפור, ולכן הוא בראש הפאנל ולא בהערת שוליים.
 */

interface MarketingActionDto {
  id: string;
  kind: MarketingActionKind;
  source: "auto" | "manual";
  detail?: string;
  evidenceUrl?: string;
  brokerCount?: number;
  performedAt: string;
}

interface ExclusivityDto {
  id: string;
  propertyId: string;
  subject: ExclusivitySubject;
  startsAt: string;
  endsAt: string;
  agreedCustomAction: boolean;
  phase: "active" | "at_risk" | "ended_by_third_rule" | "expired";
  thirdAt: string;
  effectiveEndsAt: string;
  daysLeft: number;
  daysToThird: number | null;
  counted: MarketingActionKind[];
  missing: number;
  summary: string;
  actions: MarketingActionDto[];
}

const PHASE_TONE: Record<ExclusivityDto["phase"], string> = {
  active: "var(--color-success)",
  at_risk: "var(--color-warning)",
  ended_by_third_rule: "var(--color-danger)",
  expired: "var(--color-text-muted)",
};

const PHASE_LABEL: Record<ExclusivityDto["phase"], string> = {
  active: "בתוקף",
  at_risk: "בסיכון",
  ended_by_third_rule: "הסתיימה במועד השליש",
  expired: "הסתיימה",
};

const SUBJECT_OPTIONS = [
  { value: "apartment", label: "דירה" },
  { value: "other", label: "מקרקעין אחרים" },
];

function toDateInput(iso: string): string {
  return iso.slice(0, 10);
}

/*
 * שעון ישראל, ולא UTC ולא שעון הדפדפן.
 *
 * העותק הקודם כאן חישב ב-UTC בדיוק כמו זה שבלוגיקה המשותפת — ולכן
 * פעולת שיווק שנרשמה בערב הופיעה במסך ביום הקודם, ואותה סטייה
 * בדיוק הופיעה גם בהודעה שנשלחה למוכר. עכשיו שניהם קוראים לאותה
 * פונקציה, כדי שהמסך והדוח לא יוכלו להתפצל שוב.
 *
 * גבולות התקופה נשמרים כחצות UTC ולכן אינם מושפעים; ‎`performedAt`
 * הוא חותמת זמן אמיתית וזה מה שנשבר.
 */
function formatDate(iso: string): string {
  return formatJerusalemDate(new Date(iso));
}

export function ExclusivityPanel({
  propertyId,
  propertyTitle,
  officeName,
  canEdit,
}: {
  propertyId: string;
  propertyTitle: string;
  officeName: string;
  canEdit: boolean;
}) {
  const [data, setData] = useState<ExclusivityDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [logging, setLogging] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiGet<{ exclusivity: ExclusivityDto | null }>(
        `/properties/${propertyId}/exclusivity`,
      );
      /*
       * ‎**`?? null` ולא `res.exclusivity` בלבד.**
       *
       * ‎`apiGet` הוא הצהרת טיפוס ולא ולידציה — גוף בלי המפתח
       * ‎`exclusivity` מחזיר `undefined`, והבדיקה למטה היא
       * ‎`data === null` בדיוק. `undefined` חומק ממנה, נכנס
       * ל-`ActiveExclusivity`, ונופל על `data.missing` — כלומר
       * **כל כרטיס הנכס** מוחלף ב„אירעה שגיאה” בגלל פאנל אחד.
       * הנפילה הזו נצפתה בפועל בבדיקה בדפדפן.
       */
      setData(res.exclusivity ?? null);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : "טעינת הבלעדיות נכשלה");
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return null;

  return (
    <section className="mv-list-card px-[22px] py-[18px]" aria-labelledby="exclusivity-heading">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 id="exclusivity-heading" className="m-0" style={{ fontSize: "calc(16.5 / 16 * 1rem)", fontWeight: 800 }}>
          בלעדיות
        </h2>
        {data ? (
          <span
            className="mv-pill"
            style={{ color: PHASE_TONE[data.phase], borderColor: PHASE_TONE[data.phase] }}
          >
            {PHASE_LABEL[data.phase]}
          </span>
        ) : null}
        {data && canEdit ? (
          <button
            type="button"
            className="mv-btn-plain ms-auto"
            onClick={() => setReportOpen((v) => !v)}
          >
            דוח שיווק לבעל הנכס
          </button>
        ) : null}
      </div>

      {error !== null ? (
        <Notice tone="danger">{error}</Notice>
      ) : null}

      {data === null ? (
        <NoExclusivity
          canEdit={canEdit}
          opening={opening}
          onOpen={() => setOpening(true)}
          onCancel={() => setOpening(false)}
          propertyId={propertyId}
          onCreated={(next) => {
            setData(next);
            setOpening(false);
          }}
        />
      ) : (
        <>
          <ActiveExclusivity data={data} canEdit={canEdit} onChanged={load} />

          {reportOpen ? (
            <OwnerReport data={data} propertyTitle={propertyTitle} officeName={officeName} />
          ) : null}

          {canEdit ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {logging ? null : (
                <Button variant="ghost" onClick={() => setLogging(true)}>
                  + תיעוד פעולת שיווק
                </Button>
              )}
              <button
                type="button"
                className="mv-btn-plain ms-auto"
                style={{ color: "var(--color-danger)" }}
                onClick={() => {
                  void (async () => {
                    if (!window.confirm("לסיים את תקופת הבלעדיות?")) return;
                    await apiPost(`/exclusivity/${data.id}/end`, { reason: "cancelled" });
                    await load();
                  })();
                }}
              >
                סיום בלעדיות
              </button>
            </div>
          ) : null}

          {logging ? (
            <LogAction
              propertyId={propertyId}
              minStart={data.startsAt}
              onDone={(next) => {
                setData(next);
                setLogging(false);
              }}
              onCancel={() => setLogging(false)}
            />
          ) : null}
        </>
      )}
    </section>
  );
}

/* ============================================================
   מצב פעיל
   ============================================================ */

/**
 * ‎**שלושת אריחי הסיכום (SPEC-4c §5).**
 *
 * ‎**אותו רכיב בשני המצבים, ובכוונה.** האפיון מזהיר במפורש „do not
 * let one drift” — ואם המצב הריק והמצב הפעיל מציירים אריחים משלהם,
 * הם יתפצלו ביום שאחד מהם משתנה. כאן הם נבדלים **בערכים בלבד**.
 *
 * ‎**במצב הריק שלושת הערכים אפורים**, ואין בהם אף צבע: לא נפתחה
 * בלעדיות, ולכן לא קרה דבר שראוי לצבוע אותו. ענבר על „0 מתוך 2”
 * בנכס שאין עליו בלעדיות היה אומר „דחוף” על מצב שאינו קיים.
 */
function SummaryTiles({
  period,
  third,
  done,
  active,
}: {
  period: React.ReactNode;
  third: React.ReactNode;
  /** כמה פעולות שיווק נספרו — `null` כשאין בלעדיות. */
  done: number | null;
  active: boolean;
}): React.JSX.Element {
  const tiles: { icon: React.ReactNode; label: string; value: React.ReactNode; sub: string }[] = [
    {
      icon: <IconCalendar s={20} />,
      label: "תקופת הבלעדיות",
      value: period,
      sub: "תאריך התחלה וסיום ייקבעו בפתיחה",
    },
    {
      icon: <IconClock s={20} />,
      label: "מועד השליש",
      value: third,
      sub: `המועד שבו נדרשות ${MIN_MARKETING_ACTIONS} פעולות שיווק מתועדות`,
    },
    {
      icon: <IconCheck s={20} />,
      label: "פעולות שיווק",
      value: (
        <>
          {done ?? 0} <span style={{ fontWeight: 800 }}>מתוך {MIN_MARKETING_ACTIONS}</span>
        </>
      ),
      sub: "הנדרשות בתקנות עד מועד השליש",
    },
  ];

  return (
    <div className="mb-3 grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="px-3.5 py-3"
          /*
            טוקנים ולא ערכי הקס. ‎`globals.css` נוקב בטעם הזה במפורש:
            ערך שנכתב בשורה אינו עובר מיפוי לערכה כהה, ולכן אריח
            שנכתב כך היה נשאר בהיר על מסך כהה. הדומיין הניטרלי הוא
            בדיוק זה שנושא אפסים וממתינים, וזה מה שהאריחים האלה הם
            לפני שנפתחה בלעדיות.
          */
          style={{
            background: "var(--domain-neutral-bg)",
            border: "1px solid var(--domain-neutral-line)",
            borderRadius: 17,
          }}
        >
          <div
            className="flex items-center gap-1.5 text-[length:var(--type-body-sm)]"
            style={{ color: "var(--color-text-muted)", fontWeight: 800 }}
          >
            {tile.icon}
            {tile.label}
          </div>
          <div
            className="mt-1"
            style={{
              fontSize: "calc(22 / 16 * 1rem)",
              fontWeight: 900,
              letterSpacing: "-0.025em",
              /*
                אפור כשאין בלעדיות — אין מה לצבוע לפני שקרה משהו.
                ‎`--domain-neutral-fg` ולא ‎#5E6860: זהו **מספר**, וחבילת
                העיצוב קובעת רצפה למספרים שהאפור ההוא נמצא מתחתיה.
              */
              color: active ? "var(--color-text)" : "var(--domain-neutral-fg)",
            }}
          >
            {tile.value}
          </div>
          {/*
            שורת ההסבר מוצגת רק כשאין בלעדיות. במצב פעיל היא הופכת
            לרעש: הערך עצמו כבר אומר את מה שהיא מסבירה.
          */}
          {active ? null : (
            <div
              className="mt-0.5 text-[length:var(--type-caption)]"
              style={{ color: "var(--color-text-muted)" }}
            >
              {tile.sub}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ActiveExclusivity({
  data,
  canEdit,
  onChanged,
}: {
  data: ExclusivityDto;
  canEdit: boolean;
  onChanged: () => Promise<void>;
}) {
  const done = MIN_MARKETING_ACTIONS - data.missing;
  return (
    <>
      <p className="m-0 mb-2 text-[length:var(--type-body-sm)]" style={{ color: PHASE_TONE[data.phase] }}>
        {data.summary}
      </p>

      <SummaryTiles
        active
        /*
          "מ-X עד Y" ולא "X – Y": מקף בין שני תאריכים בתוך פסקה
          בעברית מתהפך ויזואלית, והתקופה נקראה כאילו היא מתחילה
          באוקטובר ונגמרת ביולי. מילים אינן מתהפכות.
        */
        period={
          <span className="text-[length:var(--type-body)]">
            מ-{formatDate(data.startsAt)} עד {formatDate(data.endsAt)}
          </span>
        }
        third={
          <>
            <span className="text-[length:var(--type-body)]">{formatDate(data.thirdAt)}</span>
            {data.daysToThird !== null ? (
              <span
                className="text-[length:var(--type-caption)]"
                style={{ color: "var(--color-text-muted)", fontWeight: 800 }}
              >
                {" "}· בעוד {data.daysToThird} ימים
              </span>
            ) : null}
          </>
        }
        done={done}
      />

      {/*
        המונה הוא הדבר שהסוכן צריך לפעול לפיו, ולכן הוא לא מספר יבש
        אלא רשימה של מה כבר נספר — "שילוט ✓, עיתון ✗" אומר מה לעשות
        עכשיו, בעוד "1 מתוך 2" משאיר אותו לנחש.

        ‎**והמספר עצמו ירד מכאן.** אריח הסיכום שמעל אומר בדיוק
        ‎"{done} מתוך {MIN_MARKETING_ACTIONS}", ושתי שורות שאומרות את
        אותו מספר במרחק שלוש שורות אינן דגש אלא ספק: הקורא עוצר כדי
        לבדוק אם הן מסכימות. חלוקת העבודה היא זו — האריח נושא את
        המספר, והרשימה כאן נושאת את **מה** נספר.
      */}
      <div className="mt-2">
        <p className="m-0 mb-1 text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
          מה כבר נספר
        </p>
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
          {MARKETING_ACTION_KINDS.filter(
            (kind) => kind !== "agreed_other" || data.agreedCustomAction,
          ).map((kind) => {
            const counted = data.counted.includes(kind);
            return (
              <li
                key={kind}
                className="mv-chip"
                style={{
                  opacity: counted ? 1 : 0.5,
                  color: counted ? "var(--color-success)" : "var(--color-text-muted)",
                }}
              >
                {counted ? "✓ " : "○ "}
                {MARKETING_ACTION_LABEL[kind]}
              </li>
            );
          })}
        </ul>
      </div>

      {data.actions.length > 0 ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-[length:var(--type-caption-lg)]">
            כל הפעולות שתועדו ({data.actions.length})
          </summary>
          <ul className="m-0 mt-1 list-none p-0">
            {data.actions.map((action) => (
              <li
                key={action.id}
                className="flex flex-wrap items-center gap-2 border-b py-1 text-[length:var(--type-caption)]"
                style={{ borderColor: "var(--color-border)" }}
              >
                <span>{MARKETING_ACTION_LABEL[action.kind]}</span>
                <span style={{ color: "var(--color-text-muted)" }}>
                  {formatDate(action.performedAt)}
                  {action.detail ? ` · ${action.detail}` : ""}
                </span>
                {action.source === "auto" ? (
                  <span className="mv-chip" title="נרשם מעצמו מתוך פעולה במערכת">
                    אוטומטי
                  </span>
                ) : canEdit ? (
                  <button
                    type="button"
                    className="mv-btn-plain ms-auto"
                    style={{ color: "var(--color-danger)" }}
                    onClick={() => {
                      void (async () => {
                        await apiDelete(`/exclusivity/actions/${action.id}`);
                        await onChanged();
                      })();
                    }}
                  >
                    הסר
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}

/* ============================================================
   פתיחת תקופה
   ============================================================ */

function NoExclusivity({
  canEdit,
  opening,
  onOpen,
  onCancel,
  propertyId,
  onCreated,
}: {
  canEdit: boolean;
  opening: boolean;
  onOpen: () => void;
  onCancel: () => void;
  propertyId: string;
  onCreated: (next: ExclusivityDto) => void;
}) {
  /*
   * ‎**היום הישראלי, לא היום ב-UTC.**
   *
   * זהו תאריך ההתחלה שמוצע לתקופת בלעדיות — כלומר שדה בחוזה. בין
   * חצות לשלוש לפנות בוקר ‎`toISOString` עדיין מציין את אתמול, ולכן
   * הטופס היה מציע להתחיל יום קודם, ואיתו זז גם מועד הסיום ומועד
   * השליש שנגזרים ממנו. גבולות התקופה נשמרים כחצות UTC, ולכן די
   * בכך שהתאריך עצמו יהיה הנכון.
   */
  const today = jerusalemWallParts(new Date()).date;
  const [subject, setSubject] = useState<ExclusivitySubject>("apartment");
  const [startsAt, setStartsAt] = useState(today);
  const [endsAt, setEndsAt] = useState(
    toDateInput((defaultExclusivityEnd("apartment", new Date(today)) ?? new Date()).toISOString()),
  );
  const [agreedCustomAction, setAgreedCustomAction] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (!opening) {
    return (
      <div>
        <SummaryTiles active={false} period="לא נפתחה" third="—" done={null} />
        <p className="m-0 mb-2 text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-muted)" }}>
          אין בלעדיות פעילה על הנכס. מעקב אחר התקופה כולל את מועד השליש — המועד
          שבו הבלעדיות מסתיימת אם לא תועדו {MIN_MARKETING_ACTIONS} פעולות שיווק.
        </p>
        {canEdit ? <Button onClick={onOpen}>פתיחת תקופת בלעדיות</Button> : null}
      </div>
    );
  }

  const maxEnd = toDateInput(addMonths(new Date(startsAt), MAX_EXCLUSIVITY_MONTHS[subject]).toISOString());

  async function submit(): Promise<void> {
    const local = exclusivityRejectionReason({
      subject,
      startsAt: new Date(startsAt),
      endsAt: new Date(endsAt),
    });
    if (local) {
      setProblem(local);
      return;
    }
    try {
      const created = await apiPost<ExclusivityDto>(`/properties/${propertyId}/exclusivity`, {
        subject,
        startsAt,
        endsAt,
        agreedCustomAction,
      });
      onCreated(created);
    } catch (e: unknown) {
      setProblem(e instanceof ApiError ? e.message : "פתיחת הבלעדיות נכשלה");
    }
  }

  return (
    <div
      className="rounded-lg border p-3"
      style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[length:var(--type-caption)]">
          <span className="mb-0.5 block font-semibold">סוג הנכס לעניין החוק</span>
          <SelectMenu
            value={subject}
            options={SUBJECT_OPTIONS}
            label="סוג הנכס לעניין החוק"
            onChange={(v) => {
              const next = v as ExclusivitySubject;
              setSubject(next);
              const fallback = defaultExclusivityEnd(next, new Date(startsAt));
              if (fallback) setEndsAt(toDateInput(fallback.toISOString()));
            }}
          />
        </label>
        <label className="text-[length:var(--type-caption)]">
          <span className="mb-0.5 block font-semibold">תחילת התקופה</span>
          <input
            type="date"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            className="rounded-lg border px-2.5 py-1.5"
            style={{ borderColor: "var(--color-input-border)", background: "var(--color-surface)" }}
          />
        </label>
        <label className="text-[length:var(--type-caption)]">
          <span className="mb-0.5 block font-semibold">סיום התקופה</span>
          <input
            type="date"
            value={endsAt}
            max={maxEnd}
            onChange={(e) => setEndsAt(e.target.value)}
            className="rounded-lg border px-2.5 py-1.5"
            style={{ borderColor: "var(--color-input-border)", background: "var(--color-surface)" }}
          />
        </label>
      </div>

      <label className="mt-2 flex items-center gap-2 text-[length:var(--type-caption)]">
        <input
          type="checkbox"
          checked={agreedCustomAction}
          onChange={(e) => setAgreedCustomAction(e.target.checked)}
        />
        סוכמה עם הלקוח פעולת שיווק מותאמת (פריט 7 בתקנות)
      </label>

      <p className="m-0 mt-2 text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
        התקרה בחוק: {MAX_EXCLUSIVITY_MONTHS[subject]} חודשים מיום ההזמנה (סעיף 9(ב)).
        התראה על פעולות חסרות נשלחת {EXCLUSIVITY_THIRD_WARNING_DAYS} ימים לפני מועד השליש.
      </p>

      {problem !== null ? (
        <Notice tone="danger">{problem}</Notice>
      ) : null}

      <div className="mt-2 flex gap-2">
        <Button onClick={() => void submit()}>פתיחה</Button>
        <Button variant="ghost" onClick={onCancel}>
          ביטול
        </Button>
      </div>
    </div>
  );
}

/* ============================================================
   תיעוד פעולה
   ============================================================ */

function LogAction({
  propertyId,
  minStart,
  onDone,
  onCancel,
}: {
  propertyId: string;
  minStart: string;
  onDone: (next: ExclusivityDto) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<MarketingActionKind>("signage");
  /*
   * ‎**מועד הפעולה מתחיל בהיום הישראלי.** פעולת שיווק היא הראיה
   * שמאריכה את הבלעדיות מעבר לשליש, ומתווך שתיעד ב-00:30 היה מקבל
   * את אתמול כברירת מחדל — תאריך שגוי במסמך שסופרים בו ימים.
   */
  const [performedAt, setPerformedAt] = useState(jerusalemWallParts(new Date()).date);
  const [detail, setDetail] = useState("");
  const [brokerCount, setBrokerCount] = useState("1");
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(): Promise<void> {
    try {
      const next = await apiPost<ExclusivityDto>(`/properties/${propertyId}/exclusivity/actions`, {
        kind,
        performedAt,
        ...(detail.trim() === "" ? {} : { detail: detail.trim() }),
        ...(kind === "broker_network" ? { brokerCount: Number(brokerCount) } : {}),
      });
      onDone(next);
    } catch (e: unknown) {
      setProblem(e instanceof ApiError ? e.message : "התיעוד נכשל");
    }
  }

  return (
    <div
      className="mt-2 rounded-lg border p-3"
      style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className="grow text-[length:var(--type-caption)]">
          <span className="mb-0.5 block font-semibold">סוג הפעולה</span>
          <SelectMenu
            value={kind}
            options={MARKETING_ACTION_KINDS.map((k) => ({
              value: k,
              label: MARKETING_ACTION_LABEL[k],
            }))}
            label="סוג פעולת השיווק"
            onChange={(v) => setKind(v as MarketingActionKind)}
          />
        </label>
        <label className="text-[length:var(--type-caption)]">
          <span className="mb-0.5 block font-semibold">מתי בוצעה</span>
          <input
            type="date"
            value={performedAt}
            min={toDateInput(minStart)}
            onChange={(e) => setPerformedAt(e.target.value)}
            className="rounded-lg border px-2.5 py-1.5"
            style={{ borderColor: "var(--color-input-border)", background: "var(--color-surface)" }}
          />
        </label>
        {kind === "broker_network" ? (
          <label className="text-[length:var(--type-caption)]">
            <span className="mb-0.5 block font-semibold">כמה מתווכים</span>
            <input
              type="number"
              min={1}
              max={500}
              value={brokerCount}
              onChange={(e) => setBrokerCount(e.target.value)}
              className="w-24 rounded-lg border px-2.5 py-1.5"
              style={{ borderColor: "var(--color-input-border)", background: "var(--color-surface)" }}
            />
          </label>
        ) : null}
      </div>

      <label className="mt-2 block text-[length:var(--type-caption)]">
        <span className="mb-0.5 block font-semibold">פירוט (לא חובה)</span>
        <input
          value={detail}
          maxLength={300}
          placeholder="למשל: מודעה בידיעות רמת גן, גיליון 12.1"
          onChange={(e) => setDetail(e.target.value)}
          className="w-full rounded-lg border px-2.5 py-1.5"
          style={{ borderColor: "var(--color-input-border)", background: "var(--color-surface)" }}
        />
      </label>

      {kind === "broker_network" ? (
        <p className="m-0 mt-1 text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
          נספר כפעולה מ-{MIN_BROKERS_FOR_NETWORK_ACTION} מתווכים ומעלה, במצטבר לאורך התקופה.
        </p>
      ) : null}

      {problem !== null ? (
        <Notice tone="danger">{problem}</Notice>
      ) : null}

      <div className="mt-2 flex gap-2">
        <Button onClick={() => void submit()}>שמירה</Button>
        <Button variant="ghost" onClick={onCancel}>
          ביטול
        </Button>
      </div>
    </div>
  );
}

/* ============================================================
   דוח לבעל הנכס
   ============================================================ */

function OwnerReport({
  data,
  propertyTitle,
  officeName,
}: {
  data: ExclusivityDto;
  propertyTitle: string;
  officeName: string;
}) {
  const clipboard = useCopy();
  const text = ownerReportText({
    propertyTitle,
    officeName,
    period: { startsAt: new Date(data.startsAt), endsAt: new Date(data.endsAt) },
    actions: data.actions.map((a) => ({
      kind: a.kind,
      performedAt: new Date(a.performedAt),
      ...(a.brokerCount === undefined ? {} : { brokerCount: a.brokerCount }),
    })),
    now: new Date(),
  });

  return (
    <div
      className="mt-2 rounded-lg border p-3"
      style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
    >
      <p className="m-0 mb-1 text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
        זה מה שבעל הנכס מקבל — פעולות ותאריכים בלבד, בלי מצב הבלעדיות הפנימי.
      </p>
      <pre className="m-0 whitespace-pre-wrap text-[length:var(--type-caption)]" style={{ fontFamily: "inherit" }}>
        {text}
      </pre>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button variant="ghost" onClick={() => void clipboard.copy(text)}>
          העתקה
        </Button>
        <a
          className="mv-btn-plain"
          href={`https://wa.me/?text=${encodeURIComponent(text)}`}
          target="_blank"
          rel="noreferrer"
        >
          שליחה בוואטסאפ
        </a>
        {/*
          עד כאן הלחיצה על „העתקה” לא אמרה דבר — לא בהצלחה ולא
          בכישלון. הדוח עצמו מוצג מעל, ולכן גם כשהלוח חסום יש דרך
          פשוטה קדימה.
        */}
        <span role="status" className="text-[length:var(--type-caption)]">
          {clipboard.state === "copied" ? (
            <span style={{ color: "var(--color-success)" }}>✓ הדוח הועתק</span>
          ) : clipboard.state === "failed" ? (
            <span style={{ color: "var(--color-danger)" }}>
              הדפדפן חסם את הגישה ללוח — סמנו את הדוח שמעל והעתיקו ידנית
            </span>
          ) : null}
        </span>
      </div>
    </div>
  );
}
