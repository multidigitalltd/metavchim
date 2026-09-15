"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  BOARD_PERIOD_LABELS,
  BOARD_PERIODS,
  BOARD_METRIC_LABELS,
  boardFormulaText,
  canSeeOfficeBoard,
  formatIsraeliNumber,
  initials,
  movementLabel,
  superlativeNote,
  partnerDealLine,
  partnerSectionNote,
  type DealStatus,
  type BoardMetric,
  type BoardGoal,
  type BoardMovement,
  type BoardPeriod,
  type Superlative,
} from "@metavchim/shared";
import { ApiError, apiGet, apiPatch } from "@/lib/api";
import { can, useRequireAuth } from "@/lib/use-auth";
import { useFeature, useFeaturesReady } from "@/lib/use-features";
import { LoadError } from "../load-error";
import { Notice } from "../notice";

/**
 * ‎**„המשרד שלנו” — הביצועים של הצוות, לבעל סוכנות.**
 *
 * ## ‏למה זה מסך ולא לשונית בדוחות
 *
 * ‏הדוח עונה על „מה קרה”. המסך הזה עונה על „מי מוביל החודש”, והוא
 * ‏נועד להיתלות על הקיר ולהישלח לצוות. זו שאלה אחרת, קהל אחר,
 * ‏וחלון זמן אחר — חודש קלנדרי ולא חלון מתגלגל.
 *
 * ## ‏הדירוג גלוי, ולכן אפשר לסמוך עליו
 *
 * ‏הנוסחה מודפסת מעל הטבלה **מאותו קבוע שמחשב אותה**
 * ‎(`boardFormulaText`). דירוג שלא מבינים איך נוצר הוא דירוג
 * ‏שסוכן סופר ביד, מוצא פער, ומפסיק להאמין למערכת.
 *
 * ## ‏והתנועה נמדדת מול העבר של אותו סוכן
 *
 * ‏„עלייה של שני מקומות” היא הישג גם במקום השישי, ו„חודש ראשון”
 * ‏אינו „ירידה”. כל התוויות נייטרליות מגדרית: שם פרטי אינו אומר
 * ‏מהו המגדר של אדם אמיתי.
 */

interface BoardRow {
  userId: string;
  name: string;
  role: string;
  counts: { calls: number; leads: number; properties: number; viewings: number; deals: number };
  score: number;
  rank: number;
  movement: BoardMovement;
  goal: BoardGoal | null;
}

interface Board {
  period: BoardPeriod;
  title: string;
  previousTitle: string;
  agents: number;
  rows: BoardRow[];
  superlatives: Superlative[];
  summary: { key: BoardMetric | "calls"; value: number; diff: number; percent: number | null }[];
  /**
   * ‏האם המשרד פתח את המסך לסוכנים — מצב תיבת הסימון.
   *
   * ‏מגיע עם הטבלה ולא מה-Session הממוטמן: התיבה היא הפקד
   * ‏שמשנה את הדגל, ופקד שקורא ערך ממוטמן יכול להראות
   * ‏מסומן אחרי שכבו אותו בלשונית אחרת.
   */
  visibleToAgents: boolean;
  /**
   * ‎**שת״פים בתוך המשרד — עסקאות שנסגרו בשניים.**
   *
   * ‏אותו חלון ואותה הגדרת „עסקה” כמו הניקוד, ולכן `share.deals`
   * ‏הוא בדיוק המונה שבטבלת הסיכום. ‎`percent === null` = לא הייתה
   * ‏עסקה בכלל, ו„0%” על מכנה אפס הוא מספר שהומצא.
   */
  partners: {
    deals: {
      propertyId: string;
      address: string;
      status: DealStatus;
      closedAt: string;
      agentName: string;
      partnerName: string;
    }[];
    share: { partnered: number; deals: number; percent: number | null };
  };
}

const SUMMARY_LABELS: Record<BoardMetric | "calls", string> = {
  calls: "שיחות יוצאות",
  leads: "לידים חדשים",
  properties: "נכסים שגויסו",
  viewings: "פגישות שנקבעו",
  deals: "עסקאות נסגרו",
};

const SUPERLATIVE_TITLES: Record<BoardMetric | "calls", string> = {
  calls: "הכי הרבה שיחות",
  leads: "הכי הרבה לידים",
  properties: "הכי הרבה נכסים",
  viewings: "הכי הרבה פגישות",
  deals: "הכי הרבה עסקאות",
};

export default function OfficeBoardPage() {
  const { user, loading } = useRequireAuth();
  const hasAnalytics = useFeature("analytics");
  const featuresReady = useFeaturesReady();
  const [period, setPeriod] = useState<BoardPeriod>("month");
  const [board, setBoard] = useState<Board | null>(null);
  const [failed, setFailed] = useState(false);
  const [denied, setDenied] = useState(false);
  /*
   * ‎**גשר עד שהשרת יענה, ולא מקור קבוע.**
   *
   * ‏הסימון נשמר לפני שהטבלה נטענת מחדש — ובכרטיס החסימה
   * ‏אין טבלה בכלל — ולכן צריך מי שיחזיק את הערך בינתיים.
   *
   * ‎**אבל הוא מתאפס בכל טעינה שמצליחה.** ערך מקומי שגובר
   * ‏לנצח היה מציג את ההחלטה שלי גם אחרי שמנהל אחר או
   * ‏לשונית אחרת שינו את המדיניות והטבלה נטענה מחדש (החלפת
   * ‏תקופה) — כלומר תיבה שמשקרת על מה שפתוח בפועל, וזה
   * ‏בדיוק מה שהפקד הזה נועד למנוע (ביקורת Codex).
   */
  const [openedHere, setOpenedHere] = useState<boolean | null>(null);

  /*
   * ‎**מונה בקשות — תשובה של לשונית שכבר עזבו נזרקת.**
   *
   * ‏החלפת לשונית פותחת בקשה חדשה, ושתי בקשות יכולות לחזור בסדר
   * ‏הפוך. בלי המונה, בקשה ישנה שחזרה אחרונה הייתה דורסת את
   * ‏החדשה: הלשונית המסומנת „שנה” והטבלה של „החודש” — כולל
   * ‏הכותרת, הדירוג והסיכום (ביקורת Codex).
   */
  const request = useRef(0);

  const load = useCallback(() => {
    setFailed(false);
    const mine = (request.current += 1);
    apiGet<Board>(`/analytics/board?period=${period}`)
      .then((data) => {
        if (mine !== request.current) return;
        setBoard(data);
        setDenied(false);
        /* ‏תשובת השרת היא האמת — הגשר המקומי סיים את תפקידו */
        setOpenedHere(null);
      })
      .catch((err: unknown) => {
        if (mine !== request.current) return;
        if (err instanceof ApiError && err.status === 403) {
          setDenied(true);
          return;
        }
        setFailed(true);
      });
  }, [period]);

  useEffect(() => {
    if (loading || !featuresReady) return;
    if (!hasAnalytics) {
      setDenied(true);
      return;
    }
    load();
  }, [loading, featuresReady, hasAnalytics, load]);

  if (loading) return null;

  /*
   * ‎**התנאי הוא הפונקציה המשותפת, ולא עותק שלישי שלו.**
   *
   * ‏אותה שאלה נשאלת בשלושה מקומות — השרת, הכפתור בראש
   * ‏המסך וכאן — ושלושה תנאים שנכתבו בנפרד הם שלושה
   * ‏מקומות שבהם אפשר לשכוח את הדגל.
   *
   * ‏סדר המקורות הוא סדר הטריות: מה שנקבע כאן עכשיו, אחריו
   * ‏מה שהטבלה החזירה, ולבסוף העותק שנוסע עם ה-Session.
   */
  const boardOpen =
    openedHere ?? board?.visibleToAgents ?? user?.officeBoardOpen === true;

  const mayView = canSeeOfficeBoard({
    managesTeam: can(user, "users.manage"),
    openToAgents: boardOpen,
  });

  /*
   * ‎**התיבה שייכת ל-`settings.manage`, ולכן היא מוצגת גם
   * ‏למי שאינו רשאי לראות את הטבלה עצמה.**
   *
   * ‏שתי היכולות ניתנות בנפרד (חריג אישי, ‎#80), ומשתמש שאיבד
   * ‎`users.manage` ושמר על `settings.manage` נחת על כרטיס החסימה —
   * ‏כלומר השרת מאשר לו לשנות את ההגדרה, והפקד היחיד שמשנה
   * ‏אותה בלתי נגיש (ביקורת Codex). החסימה אינה אומרת „אסור לך
   * ‏לקבוע מדיניות” אלא „אינך רואה את הנתונים”, ואלה שתי שאלות.
   *
   * ‏בלי הפיצ'ר `analytics` התיבה אינה מוצגת בכלל: פתיחה של
   * ‏מסך שאינו במסלול אינה פותחת לאיש דבר.
   */
  const toggle =
    hasAnalytics && can(user, "settings.manage") ? (
      <VisibilityToggle
        open={boardOpen}
        onSaved={(next) => {
          setOpenedHere(next);
          setBoard((prev) =>
            prev === null ? prev : { ...prev, visibleToAgents: next },
          );
          /*
           * ‏מי שפתח מתוך כרטיס החסימה רשאי עכשיו לראות —
           * ‏וה-403 שנרשם קודם הוא תשובה שכבר אינה נכונה.
           */
          if (next && denied) load();
        }}
      />
    ) : null;

  if (denied || !mayView) {
    return (
      <section className="mv-card mv-card--pad">
        <h1 className="mb-2 text-2xl font-bold">המשרד שלנו</h1>
        <p className="m-0 mb-3" style={{ color: "var(--color-text-muted)" }}>
          המסך מציג את הביצועים של כל הסוכנים בשמם, ולכן הוא פתוח למי שמנהל את
          הצוות. מנהל המשרד יכול לפתוח אותו לכל הצוות בסימון שבראש המסך.
        </p>
        {toggle}
      </section>
    );
  }

  /*
   * ‎**מוביל עם אפס נקודות אינו מוביל.**
   *
   * ‏הטבלה מחזירה שורה לכל סוכן פעיל, ולכן במשרד מאויש שלא עשה
   * ‏דבר בתקופה השורה הראשונה היא פשוט הראשון לפי א״ב — והכרטיז
   * ‏הכהה היה מכריז עליו כמוביל עם 0 נקודות (ביקורת Codex).
   */
  const top = board?.rows[0];
  const leader = top !== undefined && top.score > 0 ? top : null;

  return (
    <div className="mv-board">
      <header className="mv-board__head">
        <div className="min-w-0">
          <h1 className="mv-board__title">המשרד שלנו</h1>
          <p className="mv-board__sub">
            {board === null
              ? "טוען…"
              : `${board.agents} סוכנים · תחרות ${board.title}`}
          </p>
        </div>

        <div className="mv-board__tabs" role="tablist" aria-label="תקופת המדידה">
          {BOARD_PERIODS.map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={period === option}
              className="mv-board__tab"
              data-on={period === option}
              onClick={() => setPeriod(option)}
            >
              {BOARD_PERIOD_LABELS[option]}
            </button>
          ))}
        </div>
      </header>

      {/*
        ‎**הסימון בראש המסך, ולא בהגדרות.**

        ‏זו החלטה על **המסך הזה**, ומי ששואל „מי רואה את
        זה?” שואל את זה כשהוא עומד מול הטבלה — לא בלשונית
        הגדרות שלושה מסכים משם. מתג שצריך לחפש אותו הוא
        מתג שלא נוגעים בו.

        ‎**ורק למי שמחזיק `settings.manage`** — היכולת שהשרת
        אוכף על השמירה עצמה. הצגה לפי `users.manage` הייתה
        מציגה תיבה שתחזיר 403 למי שנשללה לו ההגדרה בחריג
        אישי (#80), והסוכנים עצמם אינם רואים אותה כלל.
      */}
      {toggle}

      {failed ? <LoadError message="לא הצלחנו לטעון את הטבלה" onRetry={load} /> : null}

      {board === null ? null : board.rows.length === 0 ? (
        <Notice tone="info">
          עוד אין נתונים לתקופה הזו. הטבלה מתמלאת משיחות, לידים, נכסים, פגישות
          ועסקאות — ברגע שיש פעילות היא מופיעה כאן.
        </Notice>
      ) : (
        <>
          {leader === null ? (
            <Notice tone="info">
              יש סוכנים בטבלה, אבל עוד אין ניקוד ב{board.title}. הניקוד מתמלא
              מלידים, נכסים, פגישות ועסקאות — שיחות מופיעות בטבלה ואינן מנקדות.
            </Notice>
          ) : null}

          <div className="mv-board__top">
            {leader === null ? null : <LeaderCard row={leader} title={board.title} period={board.period} />}
            <div className="mv-board__supers">
              {board.superlatives.map((item) => (
                <article key={item.metric} className="mv-board__super">
                  <p className="mv-board__superhead">{SUPERLATIVE_TITLES[item.metric]}</p>
                  <p className="mv-board__supername">{item.name}</p>
                  <p className="mv-board__supernote">
                    <strong>
                      {formatIsraeliNumber(item.value)} {BOARD_METRIC_LABELS[item.metric]}
                    </strong>{" "}
                    {superlativeNote(item)}
                  </p>
                </article>
              ))}
            </div>
          </div>

          <section className="mv-card mv-card--pad mt-6" aria-labelledby="board-table-heading">
            <div className="mv-card-head mb-1">
              <h2 id="board-table-heading" className="mv-card-head__title m-0">
                טבלת התחרות
              </h2>
            </div>
            {/*
              ‏הנוסחה מודפסת מהקבוע שמחשב אותה — ראו ההסבר למעלה.
            */}
            <p className="mv-board__formula">{boardFormulaText()}</p>

            <div className="mv-board__tablewrap">
              <table className="mv-board__table">
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">סוכן</th>
                    <th scope="col">שיחות</th>
                    <th scope="col">לידים</th>
                    <th scope="col">נכסים</th>
                    <th scope="col">פגישות</th>
                    <th scope="col">עסקאות</th>
                    {/*
                      ‏היעדים במנטור הם חודשיים, ולכן העמודה קיימת
                      ‏רק בלשונית החודש — אחוז מול מוני רבעון אינו
                      ‏אומר דבר.
                    */}
                    {board.period === "month" ? <th scope="col">יעד חודשי</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {board.rows.map((row) => (
                    <tr key={row.userId}>
                      <td>
                        <span className="mv-board__rank" data-top={row.rank <= 3}>
                          {row.rank}
                        </span>
                      </td>
                      <td>
                        <div className="mv-board__agent">
                          <span className="mv-board__avatar" aria-hidden="true">
                            {initials(row.name)}
                          </span>
                          <span className="min-w-0">
                            <span className="mv-board__agentname">{row.name}</span>
                            <span className="mv-board__agentnote">
                              {formatIsraeliNumber(row.score)} נק׳ · {movementLabel(row.movement, board.period)}
                            </span>
                          </span>
                        </div>
                      </td>
                      <td className="tabular-nums">{formatIsraeliNumber(row.counts.calls)}</td>
                      <td className="tabular-nums">{formatIsraeliNumber(row.counts.leads)}</td>
                      <td className="tabular-nums">{formatIsraeliNumber(row.counts.properties)}</td>
                      <td className="tabular-nums">{formatIsraeliNumber(row.counts.viewings)}</td>
                      <td className="tabular-nums font-bold">{row.counts.deals}</td>
                      {board.period === "month" ? (
                        <td>
                          {/*
                            ‏בלי יעד אין פס ואין אחוז: „0%” על מי שפשוט לא
                            ‏קבע יעד במנטור נקרא ככישלון. וכשיש — המדד
                            ‏נאמר בשמו, אחרת האחוז אינו קריא.
                          */}
                          {row.goal === null ? (
                            <span style={{ color: "var(--color-text-muted)" }}>לא נקבע</span>
                          ) : (
                            <span className="mv-board__goal">
                              <span className="mv-board__bar">
                                <span
                                  className="mv-board__barfill"
                                  style={{ width: `${row.goal.percent}%` }}
                                />
                              </span>
                              <span className="tabular-nums">
                                {row.goal.actual}/{row.goal.target} {row.goal.label}
                              </span>
                            </span>
                          )}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/*
            ‎**השת״פים מתחת לטבלה ולפני הסיכום.**

            ‏זו קריאה של הטבלה ולא נתון עצמאי: „מי סגר מה” נקרא
            ‏קודם, ו„מי סגר עם מי” הוא ההמשך הטבעי שלו. הסיכום
            ‏המספרי של כל המשרד בא אחרי שניהם.
          */}
          <section className="mv-card mv-card--pad mt-6" aria-labelledby="board-partners-heading">
            <div className="mv-card-head mb-1">
              <h2 id="board-partners-heading" className="mv-card-head__title m-0">
                שת&quot;פים בתוך המשרד
              </h2>
              {/*
                ‏המונה ליד הכותרת, לא בתוך הרשימה: הוא התשובה
                ‏לשאלה „כמה מזה קורה אצלנו”, והרשימה היא הפירוט.
              */}
              {board.partners.share.percent === null ? null : (
                <p className="mv-card-head__meta m-0">
                  {formatIsraeliNumber(board.partners.share.partnered)} מתוך{" "}
                  {formatIsraeliNumber(board.partners.share.deals)} עסקאות (
                  {board.partners.share.percent}%)
                </p>
              )}
            </div>
            <p className="mv-board__formula">{partnerSectionNote()}</p>
            {board.partners.deals.length === 0 ? (
              <p className="m-0" style={{ color: "var(--color-text-muted)" }}>
                לא נסגרה עסקה בשיתוף שני סוכנים ב{board.title}.
              </p>
            ) : (
              <ul className="m-0 list-none p-0">
                {board.partners.deals.map((deal) => (
                  <li key={deal.propertyId} className="border-b py-2 last:border-b-0">
                    <Link href={`/properties/${deal.propertyId}`} className="underline">
                      {partnerDealLine({ ...deal, closedAt: new Date(deal.closedAt) })}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mv-card mv-card--pad mt-6" aria-labelledby="board-summary-heading">
            <div className="mv-card-head mb-1">
              <h2 id="board-summary-heading" className="mv-card-head__title m-0">
                סיכום המשרד
              </h2>
            </div>
            <p className="mv-board__formula">
              {board.title} מול {board.previousTitle}
            </p>
            <div className="mv-board__summary">
              {board.summary.map((tile) => (
                <article key={tile.key} className="mv-board__tile">
                  <p className="mv-board__tilelabel">{SUMMARY_LABELS[tile.key]}</p>
                  <p className="mv-board__tilevalue">
                    {formatIsraeliNumber(tile.value)}
                    <Trend diff={tile.diff} percent={tile.percent} />
                  </p>
                </article>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

/**
 * ‎**„להציג את המסך גם לסוכנים” — ההכרעה של בעל הסוכנות.**
 *
 * ## ‏למה הכיתוב מפורט כל כך
 *
 * ‏סימון של התיבה חושף לכל סוכן את הדירוג והניקוד של
 * ‏**כל שאר הסוכנים בשמם**, כולל היעד החודשי של כל אחד.
 * ‏זו החלטה לגיטימית והיא כל תכלית המסך — אבל היא חייבת
 * ‏להילקח בידיעה מלאה. „להציג לסוכנים” לבדו אינו אומר מה
 * ‏בדיוק נחשף.
 *
 * ## ‏ולמה שמירה מיידית ולא כפתור
 *
 * ‏אותו נימוק של שאר המתגים במערכת: תיבה שדורשת שמירה
 * ‏נפרדת היא תיבה שמזיזים ועוזבים — וכאן זה אומר לחשוב
 * ‏שסגרת את המסך בזמן שהוא פתוח. וכשהשמירה נכשלת הסימון
 * ‏**אינו זז** — הערך מגיע מהשרת ומתעדכן רק אחרי תשובה
 * ‏חיובית, כדי שהמסך לא יראה מצב שאינו קיים.
 */
function VisibilityToggle({
  open,
  onSaved,
}: {
  open: boolean;
  onSaved: (next: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(next: boolean): Promise<void> {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await apiPatch("/settings/tenant", { boardVisibleToAgents: next });
      onSaved(next);
      setSaved(true);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "השמירה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mv-card mv-card--pad mb-4" aria-labelledby="board-visibility-heading">
      <h2 id="board-visibility-heading" className="sr-only">
        מי רואה את המסך
      </h2>
      <label className="flex items-start gap-2 text-sm" htmlFor="board-visible-to-agents">
        <input
          type="checkbox"
          id="board-visible-to-agents"
          name="boardVisibleToAgents"
          checked={open}
          disabled={busy}
          onChange={(e) => void toggle(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          <b className="block">
            להציג את המסך הזה גם לסוכנים
            {busy ? " · שומר…" : saved ? " · ✓ נשמר" : ""}
          </b>
          <span style={{ color: "var(--color-text-muted)" }}>
            {open
              ? "כל סוכן במשרד רואה עכשיו את הטבלה המלאה: השמות, הניקוד, הדירוג והיעד החודשי של כל אחד. ביטול הסימון מסתיר מהם את המסך ואת הכפתור שלו."
              : "כרגע המסך פתוח להנהלת המשרד בלבד, והכפתור אינו מופיע לסוכנים. סימון יחשוף לכל סוכן את הטבלה המלאה: השמות, הניקוד, הדירוג והיעד החודשי של כל אחד."}
          </span>
        </span>
      </label>
      {error !== null ? <Notice tone="danger">{error}</Notice> : null}
    </section>
  );
}

/** ‏הכרטיס הכהה — מי מוביל, וממה הניקוד שלו מורכב. */
function LeaderCard({
  row,
  title,
  period,
}: {
  row: BoardRow;
  title: string;
  period: BoardPeriod;
}) {
  return (
    <article className="mv-board__leader" aria-label={`המוביל ב${title}`}>
      <p className="mv-board__leadereyebrow">הסוכן המוביל {title}</p>
      <div className="mv-board__leaderhead">
        <span className="mv-board__leaderavatar" aria-hidden="true">
          {initials(row.name)}
        </span>
        <div className="min-w-0">
          <p className="mv-board__leadername">{row.name}</p>
          <p className="mv-board__leadernote">
            מוביל בטבלה · {movementLabel(row.movement, period)}
          </p>
        </div>
        <p className="mv-board__leaderscore">
          <span>{formatIsraeliNumber(row.score)}</span>
          <small>נקודות</small>
        </p>
      </div>
      <div className="mv-board__leadertiles">
        {(["calls", "leads", "properties", "deals"] as const).map((key) => (
          <div key={key} className="mv-board__leadertile">
            <p className="mv-board__leadertilevalue">{formatIsraeliNumber(row.counts[key])}</p>
            <p className="mv-board__leadertilelabel">{SUMMARY_LABELS[key]}</p>
          </div>
        ))}
      </div>
    </article>
  );
}

/**
 * ‏המגמה מול התקופה הקודמת.
 *
 * ‎**אחוז כשיש ממה, והפרש כשאין.** „‎+∞%” על מעבר מאפס לחמש אינו
 * ‏מידע; „‎+5” הוא.
 */
function Trend({ diff, percent }: { diff: number; percent: number | null }): React.JSX.Element | null {
  if (diff === 0) return null;
  const up = diff > 0;
  const text = percent === null ? `${up ? "+" : ""}${diff}` : `${up ? "+" : ""}${percent}%`;
  return (
    <span className="mv-board__trend" data-up={up}>
      {text}
    </span>
  );
}
