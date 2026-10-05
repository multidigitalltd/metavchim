"use client";

import { useCallback, useEffect, useState } from "react";
import { marketRoomBucketLabel, type BuyerMarketDto, type BudgetFitKind } from "@metavchim/shared";
import { apiGet } from "@/lib/api";
import { LoadError } from "../../load-error";
import { MarketAttribution, ils } from "../../market/market-parts";

/**
 * ‎**התקציב מול השוק — עיר אחר עיר** (docs/18 §3, יכולת 5).
 *
 * „עם 2.1 מיליון בחיפה — מעל החציון; בתל אביב — מתחת לרבעון
 * התחתון.” משפט שמתווך אומר לכל קונה חדש מהזיכרון, וכאן הוא נשען על
 * עסקאות השנה המלאה האחרונה. הקונה שומע מספר, לא דעה — וזה ההבדל
 * בין קונה שמרחיב אזור לבין קונה שמחליף מתווך.
 */

const FIT_TEXT: Record<BudgetFitKind, { label: string; domain: string }> = {
  comfortable: { label: "מעל החציון", domain: "mv-domain-green" },
  tight: { label: "בין הרבעון התחתון לחציון", domain: "mv-domain-amber" },
  below: { label: "מתחת לרבעון התחתון", domain: "mv-domain-peach" },
};

export function BuyerMarket({ buyerId }: { buyerId: string }) {
  const [data, setData] = useState<BuyerMarketDto | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    apiGet<BuyerMarketDto>(`/market/buyers/${buyerId}`)
      .then(setData)
      .catch(() => setFailed(true));
  }, [buyerId]);

  useEffect(load, [load]);

  if (failed) return <LoadError message="לא הצלחנו לטעון את נתוני השוק" onRetry={load} />;
  if (!data) return null;
  // בלי תקציב ובלי ערים אין מה להשוות — הכרטיס „פרטי חיפוש” כבר אומר מה חסר
  if (data.budgetIls === null && data.fits.length === 0) return null;

  return (
    <section className="mv-list-card px-5 py-[18px]" aria-labelledby="buyer-market-heading">
      <h2 id="buyer-market-heading" className="m-0 mb-2" style={{ fontSize: "calc(16.5 / 16 * 1rem)", fontWeight: 800 }}>
        התקציב מול השוק
      </h2>
      {data.budgetIls === null ? (
        <p className="m-0" style={{ color: "var(--color-text-muted)" }}>
          הוסיפו תקציב לקונה כדי לראות אותו מול מחירי העסקאות בערים שהוא מחפש בהן.
        </p>
      ) : data.fits.length === 0 ? (
        <p className="m-0" style={{ color: "var(--color-text-muted)" }}>
          אין עדיין מספיק עסקאות בערים של הקונה{data.rooms !== 0 ? ` ב${marketRoomBucketLabel(data.rooms)}` : ""}.
        </p>
      ) : (
        <>
          <p className="m-0 mb-2" style={{ color: "var(--color-text-muted)", fontSize: "var(--type-caption-lg)" }}>
            תקציב {ils(data.budgetIls)} מול דירות {data.rooms !== 0 ? marketRoomBucketLabel(data.rooms) : ""} שנמכרו ב-{data.year}:
          </p>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {data.fits.map((fit) => (
              <li key={fit.settlement} className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{fit.settlement}</span>
                <span className={`mv-pill ${FIT_TEXT[fit.kind].domain}`}>{FIT_TEXT[fit.kind].label}</span>
                <span style={{ color: "var(--color-text-muted)", fontSize: "var(--type-caption-lg)" }}>
                  חציון {ils(fit.median)} · {fit.deals} עסקאות
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {data.unknownCities.length > 0 ? (
        <p className="m-0 mt-2" style={{ color: "var(--color-text-muted)", fontSize: "var(--type-caption)" }}>
          לא נמצאו במאגר: {data.unknownCities.join(", ")}
        </p>
      ) : null}
      <MarketAttribution text={data.attribution} />
    </section>
  );
}
