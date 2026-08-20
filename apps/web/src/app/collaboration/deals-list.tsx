"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  COOP_DEAL_STAGE_LABELS,
  coopDealSplitLabel,
  isFinalCoopDealStage,
  type CoopDealStage,
} from "@metavchim/shared";
import { apiGet } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { IconHandshake, IconUsers } from "../icons";
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
      className="mb-8"
    >
      <h2 className="mb-1 text-lg font-semibold">
        <IconHandshake s={17} /> עסקאות משותפות
      </h2>
      <p
        className="mb-4 text-[15.5px]"
        style={{ color: "var(--color-text-muted)" }}
      >
        כל חיבור שאושר פותח כאן חדר משותף: פרטי הסוכן שמולכם, כתובת
        הנכס, שרשור לתיאום ושלבי העסקה. הלקוחות נשארים אצל המשרד
        שהביא אותם.
      </p>

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
          <h3 className="mt-6 mb-3 text-base font-semibold">
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

function DealCard({ deal }: { deal: DealSummary }) {
  return (
    <li className="mv-net-card">
      <Link
        href={`/collaboration/deals/${deal.id}`}
        className="block p-4 no-underline"
        style={{ color: "inherit" }}
      >
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span
            className="mv-pill"
            style={{ color: stageTone(deal.stage) }}
          >
            {COOP_DEAL_STAGE_LABELS[deal.stage]}
          </span>
          <span className="flex items-center gap-1.5 text-[15px]">
            {deal.counterpartLogoUrl === undefined ? (
              <IconUsers s={15} />
            ) : (
              /*
               * `img` ולא `next/image`: הכתובת חתומה וקצרת-חיים,
               * ואופטימיזציה בשרת הייתה מנסה למשוך אותה אחרי שפגה.
               */
              <img
                src={deal.counterpartLogoUrl}
                alt=""
                loading="lazy"
                style={{ height: 20, width: "auto", borderRadius: 4 }}
              />
            )}
            {deal.counterpartOffice}
          </span>
        </div>
        <p className="m-0 mb-1 font-bold">{deal.title}</p>
        <p
          className="m-0 text-[15px]"
          style={{ color: "var(--color-text-muted)" }}
        >
          {coopDealSplitLabel(deal.commissionSplit, deal.mySide)} · עודכן{" "}
          {formatDate(deal.lastActivityAt)}
        </p>
      </Link>
    </li>
  );
}
