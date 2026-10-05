"use client";

import {
  MARKET_FLAG_LABELS,
  MARKET_NATURE_GROUP_LABELS,
  formatMarketIls,
  type MarketDealDto,
  type MarketFreshnessDto,
  type MarketPosition,
} from "@metavchim/shared";
import { formatDate, formatNumber } from "@/lib/format";

/**
 * ‎**חלקים משותפים לכל מסך שמציג עסקאות** — כרטיס הנכס, הקונה, מסך
 * נתוני השוק ודו"ח הבעלים (docs/18).
 *
 * טבלה אחת ולא ארבע: מתווך שרואה עסקה בכרטיס ואחר כך בדו"ח צריך
 * לזהות אותה — אותן עמודות, באותו סדר, עם אותן תוויות לדגלים.
 */

/** סכום קצר — „1.25 מיליון ₪”. */
export const ils = (value: number | null | undefined): string =>
  value === null || value === undefined ? "—" : formatMarketIls(value);

/** מחיר למ"ר — „18,450 ₪”. */
export const ppsqm = (value: number | null | undefined): string =>
  value === null || value === undefined ? "—" : `${formatNumber(value)} ₪`;

/** שינוי באחוזים עם סימן — „+8%”. */
export const pct = (value: number | null | undefined): string =>
  value === null || value === undefined ? "—" : value > 0 ? `+${value}%` : `${value}%`;

/** תיאור קצר של העסקה בשורה אחת — לקוראי מסך ולתיאור הטבלה. */
function dealSummary(deal: MarketDealDto): string {
  return [
    formatDate(deal.date),
    MARKET_NATURE_GROUP_LABELS[deal.group],
    deal.rooms !== null ? `${deal.rooms} חדרים` : null,
    deal.areaSqm !== null ? `${deal.areaSqm} מ"ר` : null,
    ils(deal.amountIls),
  ]
    .filter((part): part is string => part !== null)
    .join(", ");
}

/**
 * טבלת עסקאות.
 *
 * ‎`caption` חובה: טבלה בלי כיתוב היא „טבלה” לקורא מסך, ושלוש כאלה
 * בכרטיס אחד אינן ניתנות להבחנה (ת"י 5568). הגלילה האופקית בתוך
 * מסגרת משלה — הטבלה רחבה מטלפון, והעמוד עצמו אינו נגלל הצידה.
 */
export function DealsTable({
  deals,
  caption,
  showSettlement = false,
  showParcel = false,
  emptyText = "אין עסקאות להצגה",
}: {
  deals: readonly MarketDealDto[];
  caption: string;
  showSettlement?: boolean;
  showParcel?: boolean;
  emptyText?: string;
}) {
  if (deals.length === 0) {
    return (
      <p className="m-0" style={{ color: "var(--color-text-muted)" }}>
        {emptyText}
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--color-border)" }} tabIndex={0} role="region" aria-label={caption}>
      <table className="w-full" style={{ fontSize: "var(--type-body-sm)" }}>
        <caption className="mv-visually-hidden">{caption}</caption>
        <thead style={{ background: "var(--color-table-head)" }}>
          <tr>
            <th scope="col" className="p-2 text-start">תאריך</th>
            {showSettlement ? <th scope="col" className="p-2 text-start">יישוב</th> : null}
            <th scope="col" className="p-2 text-start">סוג</th>
            <th scope="col" className="p-2 text-start">חדרים</th>
            <th scope="col" className="p-2 text-start">שטח</th>
            <th scope="col" className="p-2 text-start">מחיר</th>
            <th scope="col" className="p-2 text-start">למ&quot;ר</th>
            <th scope="col" className="p-2 text-start">שנת בנייה</th>
            {showParcel ? <th scope="col" className="p-2 text-start">גוש/חלקה</th> : null}
            <th scope="col" className="p-2 text-start">הערה</th>
          </tr>
        </thead>
        <tbody>
          {deals.map((deal) => (
            <tr key={deal.id} className="border-t" style={{ borderColor: "var(--color-row-border)" }} aria-label={dealSummary(deal)}>
              <td className="whitespace-nowrap p-2">{formatDate(deal.date)}</td>
              {showSettlement ? <td className="p-2">{deal.settlement ?? "—"}</td> : null}
              <td className="p-2">{deal.nature || MARKET_NATURE_GROUP_LABELS[deal.group]}</td>
              <td className="p-2">{deal.rooms ?? "—"}</td>
              <td className="whitespace-nowrap p-2">{deal.areaSqm !== null ? `${deal.areaSqm} מ"ר` : "—"}</td>
              <td className="whitespace-nowrap p-2 font-semibold">{ils(deal.amountIls)}</td>
              <td className="whitespace-nowrap p-2">{ppsqm(deal.ppsqm)}</td>
              <td className="p-2">{deal.yearBuilt ?? "—"}</td>
              {showParcel ? (
                <td className="whitespace-nowrap p-2">
                  {deal.gush}/{deal.helka}
                  {deal.subParcel !== null ? `/${deal.subParcel}` : ""}
                </td>
              ) : null}
              <td className="p-2">
                {deal.flags
                  .filter((flag) => flag !== "noArea" && flag !== "noRooms")
                  .map((flag) => (
                    <span key={flag} className="mv-tag me-1" style={{ background: "var(--color-field)", color: "var(--color-text-soft)" }}>
                      {MARKET_FLAG_LABELS[flag]}
                    </span>
                  ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * מחיר מבוקש מול השוק — גלולה אחת, צבע אחד לכל מצב.
 *
 * ירוק ל„מתחת לשוק” כי זו הזדמנות לקונה; כתום ל„מעל” כי זו שיחה
 * שצריך לנהל עם הבעלים — לא אדום: מחיר גבוה אינו תקלה.
 */
export function PositionPill({ position }: { position: MarketPosition }) {
  const domain =
    position.kind === "below" ? "mv-domain-green" : position.kind === "above" ? "mv-domain-peach" : "mv-domain-blue";
  const text =
    position.kind === "below"
      ? `מתחת לשוק ${pct(position.diffPct)}`
      : position.kind === "above"
        ? `מעל השוק ${pct(position.diffPct)}`
        : `בטווח השוק (${pct(position.diffPct)})`;
  return <span className={`mv-pill ${domain}`}>{text}</span>;
}

/** ייחוס המקור — בכל מסך שמציג נתון מהמאגר. */
export function MarketAttribution({ text }: { text: string }) {
  return (
    <p className="m-0 mt-3" style={{ color: "var(--color-text-muted)", fontSize: "var(--type-caption)" }}>
      {text}
    </p>
  );
}

/**
 * כמה מהיישוב כבר נקלט — „עדיין לא” אינו „אין עסקאות”.
 *
 * בשבוע הראשון אחרי ההפעלה המאגר מתמלא יישוב אחר יישוב. בלי השורה
 * הזו, מתווך בעיר שעוד לא נקלטה רואה „אין עסקאות דומות” ומסיק שהשוק
 * שם מת.
 */
export function FreshnessNote({ freshness }: { freshness: MarketFreshnessDto | null }) {
  if (!freshness) return null;
  if (freshness.status === "pending" || freshness.status === "backfill") {
    return (
      <p className="m-0" role="status" style={{ color: "var(--color-warning)", fontSize: "var(--type-caption-lg)" }}>
        {freshness.coveragePct !== null && freshness.coveragePct > 0
          ? `המערכת מורידה ברקע את העסקאות של היישוב הזה מרשות המסים — ${freshness.coveragePct}% כבר הורדו. ההשוואה תתעדכן לבד כשזה יסתיים.`
          : "העסקאות של היישוב הזה עוד לא הורדו מרשות המסים — המערכת מורידה אותן ברקע, יישוב אחרי יישוב. ההשוואה תופיע כאן לבד."}
      </p>
    );
  }
  return freshness.syncedThrough ? (
    <p className="m-0" style={{ color: "var(--color-text-muted)", fontSize: "var(--type-caption)" }}>
      עסקאות עד {formatDate(freshness.syncedThrough)}. דיווחים על שלושת החודשים האחרונים עוד מגיעים.
    </p>
  ) : null;
}

/**
 * תגית קומפקטית לרשימות — רק כשיש מה לומר.
 *
 * „בטווח השוק” אינו מוצג ברשימה: תגית על כל שורה היא תגית על אף
 * שורה. נשארים רק שני המקרים שמזמינים פעולה — הזדמנות לקונה, או שיחה
 * עם בעלים על מחיר.
 */
export function MarketChip({
  market,
}: {
  market?: { position: "below" | "within" | "above"; diffPct: number; sample: number } | undefined;
}) {
  if (!market || market.position === "within") return null;
  const below = market.position === "below";
  return (
    <span
      className={`mv-pill ${below ? "mv-domain-green" : "mv-domain-peach"}`}
      title={`לפי ${market.sample} עסקאות דומות`}
    >
      {below ? "מתחת לשוק" : "מעל השוק"} {pct(market.diffPct)}
    </span>
  );
}
