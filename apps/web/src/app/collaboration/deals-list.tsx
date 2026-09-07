"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  COOP_DEAL_STAGE_LABELS,
  coopDealSplitLabel,
  isFinalCoopDealStage,
  type CoopDealStage,
} from "@metavchim/shared";
import { apiGet, mediaSrc } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { IconEye, IconHandshake } from "../icons";
import { LoadError } from "../load-error";

/**
 * העסקאות המשותפות — הרשימה.
 *
 * זו הלשונית שסוגרת את הרשת: עד כאן היא ידעה לחבר בין שני משרדים
 * ולעצור שם. מי שאישר חיבור נשאר עם שורה שכתוב עליה "מעוניין"
 * ובלי שום מקום להמשיך, ולכן ההמשך קרה בוואטסאפ — מחוץ למערכת,
 * ובלי שהמשרד יודע מה קרה עם הנכס שלו.
 *
 * פתוחות למעלה וסגורות למטה: מי שנכנס לכאן בא לטפל במה שרץ, לא
 * לקרוא היסטוריה.
 */

export interface DealSummary {
  id: string;
  stage: CoopDealStage;
  mySide: "listing" | "buyer";
  commissionSplit: number;
  title: string;
  counterpartOffice: string;
  counterpartLogoUrl?: string;
  lastActivityAt: string;
  createdAt: string;
}

/** צבע השלב — פתוח, נחתם, ירד מהפרק. */
function stageTone(stage: CoopDealStage): string {
  if (stage === "signed") return "var(--color-success)";
  if (stage === "cancelled") return "var(--color-text-muted)";
  return "var(--color-primary)";
}

export function DealsList() {
  const [deals, setDeals] = useState<DealSummary[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    apiGet<DealSummary[]>("/collaboration/deals")
      .then(setDeals)
      /*
       * מצב שגיאה מפורש ולא רשימה ריקה: "אין עסקאות משותפות" אחרי
       * תקלת רשת הוא מסקנה עסקית שגויה — המתווך חושב שהחיבור שאישר
       * אתמול נעלם.
       */
      .catch(() => {
        setDeals([]);
        setFailed(true);
      });
  }, []);

  useEffect(load, [load]);

  const open = (deals ?? []).filter((deal) => !isFinalCoopDealStage(deal.stage));
  const closed = (deals ?? []).filter((deal) =>
    isFinalCoopDealStage(deal.stage),
  );

  return (
    <section
      id="coop-panel-deals"
      role="tabpanel"
      aria-labelledby="coop-tab-deals"
      className="mv-card mv-card--pad mb-[18px]"
    >
      {/* אותה כותרת כמו בשאר לשוניות הרשת — אריח, שם, מונה, ומשפט בקצה */}
      <div className="mv-card-head">
        <span className="mv-tile mv-tile--44 mv-domain-green" aria-hidden="true">
          <IconHandshake s={20} />
        </span>
        <h2 className="mv-card-head__title">עסקאות משותפות</h2>
        {open.length + closed.length > 0 ? (
          <span className="mv-pill mv-domain-green">
            {[
              open.length > 0 ? `${open.length} בתהליך` : null,
              closed.length > 0 ? `${closed.length} נסגרו` : null,
            ]
              .filter((part): part is string => part !== null)
              .join(" · ")}
          </span>
        ) : null}
        <p className="mv-card-head__note">
          כל עסקה שנסגרה בשיתוף, עם חלוקת העמלה שנחתמה
        </p>
      </div>

      {failed ? (
        <LoadError message="לא הצלחנו לטעון את העסקאות המשותפות" onRetry={load} />
      ) : null}

      {deals !== null && deals.length === 0 && !failed ? (
        <p className="mv-list-card p-5 text-center">
          עוד אין עסקאות משותפות. חדר נפתח ברגע שאתם או הצד השני
          מאשרים חיבור ברשת.
        </p>
      ) : null}

      {open.length > 0 ? (
        <ul className="mv-net-grid" aria-label="עסקאות פעילות">
          {open.map((deal) => (
            <DealCard key={deal.id} deal={deal} />
          ))}
        </ul>
      ) : null}

      {closed.length > 0 ? (
        <>
          <h3 className="mt-5 mb-3 text-[length:var(--type-row-title)] font-bold">
            עסקאות שנסגרו ({closed.length})
          </h3>
          <ul className="mv-net-grid" aria-label="עסקאות שנסגרו">
            {closed.map((deal) => (
              <DealCard key={deal.id} deal={deal} />
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

/**
 * ‏כרטיס עסקה — באותה שפה של כרטיס הרשת.
 *
 * ‏מי מולי בראש, מצב העסקה בצד השני, הכותרת, ואז שני אריחי מספרים.
 * הכרטיס אינו קישור אחד ענק אלא כרטיס עם פעולה בתחתיתו: קישור
 * שעוטף חמישה אזורים נקרא לקורא מסך כשם אחד ארוך, ואי אפשר לבחור
 * ממנו טקסט.
 */
function DealCard({ deal }: { deal: DealSummary }) {
  return (
    <li className="mv-net-card mv-domain-green">
      <div className="mv-net-top">
        <span className="mv-net-office">
          <span className="mv-net-office__avatar" aria-hidden="true">
            {deal.counterpartLogoUrl === undefined ? (
              deal.counterpartOffice.trim().slice(0, 1)
            ) : (
              /*
               * `img` ולא `next/image`: הלוגו מוזרם דרך ה-API עם
               * העוגייה של המשתמש, ואופטימיזציה בשרת הייתה מנסה
               * למשוך אותו בלי הזדהות.
               */
              <img src={mediaSrc(deal.counterpartLogoUrl)} alt="" loading="lazy" />
            )}
          </span>
          <span className="min-w-0">
            <span className="mv-net-office__name">{deal.counterpartOffice}</span>
            <span className="mv-net-office__place">
              עודכן {formatDate(deal.lastActivityAt)}
            </span>
          </span>
        </span>
        <span className="mv-pill" style={{ color: stageTone(deal.stage) }}>
          {COOP_DEAL_STAGE_LABELS[deal.stage]}
        </span>
      </div>

      <div className="mv-net-titlerow">
        <h3 className="mv-net-hero-title">{deal.title}</h3>
      </div>
      <p className="mv-net-sub">
        {coopDealSplitLabel(deal.commissionSplit, deal.mySide)}
      </p>

      <div className="mv-net-cardfoot">
        <div className="mv-net-meta">
          <span className="mv-net-meta-id">#{deal.id.slice(-5)}</span>
        </div>
        <div className="mv-net-actions">
          <Link
            href={`/collaboration/deals/${deal.id}`}
            className="mv-net-act mv-net-act--go"
            style={{ textDecoration: "none" }}
          >
            <IconEye s={15} /> חדר העסקה
          </Link>
        </div>
      </div>
    </li>
  );
}
