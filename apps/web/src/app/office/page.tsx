"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BOARD_PERIOD_LABELS,
  BOARD_PERIODS,
  BOARD_METRIC_LABELS,
  boardFormulaText,
  formatIsraeliNumber,
  initials,
  movementLabel,
  superlativeNote,
  type BoardMetric,
  type BoardMovement,
  type BoardPeriod,
  type Superlative,
} from "@metavchim/shared";
import { ApiError, apiGet } from "@/lib/api";
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
  goalPercent: number | null;
}

interface Board {
  period: BoardPeriod;
  title: string;
  previousTitle: string;
  agents: number;
  rows: BoardRow[];
  superlatives: Superlative[];
  summary: { key: BoardMetric | "calls"; value: number; diff: number; percent: number | null }[];
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

  const load = useCallback(() => {
    setFailed(false);
    apiGet<Board>(`/analytics/board?period=${period}`)
      .then((data) => {
        setBoard(data);
        setDenied(false);
      })
      .catch((err: unknown) => {
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

  if (denied || !can(user, "users.manage")) {
    return (
      <section className="mv-card mv-card--pad">
        <h1 className="mb-2 text-2xl font-bold">המשרד שלנו</h1>
        <p className="m-0" style={{ color: "var(--color-text-muted)" }}>
          המסך מציג את הביצועים של כל הסוכנים בשמם, ולכן הוא פתוח למי שמנהל את
          הצוות. מנהל המשרד יכול לפתוח אותו בהגדרות הצוות.
        </p>
      </section>
    );
  }

  const leader = board?.rows[0];

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

      {failed ? <LoadError message="לא הצלחנו לטעון את הטבלה" onRetry={load} /> : null}

      {board === null ? null : board.rows.length === 0 ? (
        <Notice tone="info">
          עוד אין נתונים לתקופה הזו. הטבלה מתמלאת משיחות, לידים, נכסים, פגישות
          ועסקאות — ברגע שיש פעילות היא מופיעה כאן.
        </Notice>
      ) : (
        <>
          <div className="mv-board__top">
            {leader === undefined ? null : <LeaderCard row={leader} title={board.title} />}
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
                    <th scope="col">יעד חודשי</th>
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
                              {formatIsraeliNumber(row.score)} נק׳ · {movementLabel(row.movement)}
                            </span>
                          </span>
                        </div>
                      </td>
                      <td className="tabular-nums">{formatIsraeliNumber(row.counts.calls)}</td>
                      <td className="tabular-nums">{formatIsraeliNumber(row.counts.leads)}</td>
                      <td className="tabular-nums">{formatIsraeliNumber(row.counts.properties)}</td>
                      <td className="tabular-nums">{formatIsraeliNumber(row.counts.viewings)}</td>
                      <td className="tabular-nums font-bold">{row.counts.deals}</td>
                      <td>
                        {/*
                          ‏בלי יעד אין פס ואין אחוז: „0%” על מי שפשוט לא
                          ‏קבע יעד במנטור נקרא ככישלון.
                        */}
                        {row.goalPercent === null ? (
                          <span style={{ color: "var(--color-text-muted)" }}>לא נקבע</span>
                        ) : (
                          <span className="mv-board__goal">
                            <span className="mv-board__bar">
                              <span
                                className="mv-board__barfill"
                                style={{ width: `${row.goalPercent}%` }}
                              />
                            </span>
                            <span className="tabular-nums">{row.goalPercent}%</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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

/** ‏הכרטיס הכהה — מי מוביל, וממה הניקוד שלו מורכב. */
function LeaderCard({ row, title }: { row: BoardRow; title: string }) {
  return (
    <article className="mv-board__leader" aria-label={`המוביל ב${title}`}>
      <p className="mv-board__leadereyebrow">הסוכן המוביל {title}</p>
      <div className="mv-board__leaderhead">
        <span className="mv-board__leaderavatar" aria-hidden="true">
          {initials(row.name)}
        </span>
        <div className="min-w-0">
          <p className="mv-board__leadername">{row.name}</p>
          <p className="mv-board__leadernote">מוביל בטבלה · {movementLabel(row.movement)}</p>
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
