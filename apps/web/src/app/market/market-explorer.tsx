"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MARKET_NATURE_GROUPS,
  MARKET_NATURE_GROUP_LABELS,
  MARKET_ROOM_BUCKETS,
  formatIsraeliNumber,
  marketRoomBucketLabel,
  type MarketDealDto,
  type MarketDealsPageDto,
  type MarketNatureGroup,
  type MarketOverviewDto,
  type MarketParcelDto,
  type MarketProspectingDto,
  type MarketRoomBucket,
  type MarketSettlementDto,
} from "@metavchim/shared";
import { apiGet, apiList } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { EntityTabs, TabPanel, useEntityTab } from "../entity-tabs";
import { LoadError } from "../load-error";
import { DealsTable, MarketAttribution, ils, pct, ppsqm } from "./market-parts";
import { MarketMap } from "./market-map";
import { TrendChart } from "./trend-chart";

/**
 * ‎**נתוני שוק — עסקאות המכר של כל הארץ** (docs/18).
 *
 * לשונית בפורום המקצועי (`/forum?tab=market`), לא פריט בתפריט הראשי —
 * החלטת בעל המוצר. `/market` הישן מפנה לכאן, כך שקישורים קיימים עובדים.
 *
 * המסך שבו מתווך „סתם בודק”: מה קורה בעיר שלו, כמה עולה דירת ארבעה
 * חדרים בשכונה ליד, מה נמכר ברחוב בחודשים האחרונים, ואיפה נבנה
 * פרויקט חדש. הכול מהמאגר המקומי — המסך אינו פונה לשום שירות חיצוני.
 *
 * ## שלוש בחירות למעלה, וכל הלשוניות מכבדות אותן
 *
 * יישוב (או כל הארץ), סוג נכס וגודל. הבחירה נשמרת בכתובת, כדי
 * שקישור „לנתוני השוק בחיפה” מהמנטור או מהסוכן יפתח בדיוק את זה —
 * ומתווך ששולח קישור לעמית שולח את מה שהוא רואה.
 */

interface Scope {
  settlementId: number | null;
  group: MarketNatureGroup;
  rooms: MarketRoomBucket;
}

const DWELLING_GROUPS: MarketNatureGroup[] = ["apartment", "garden", "penthouse", "house"];

function readScope(): Scope & { gush: number | null; helka: number | null } {
  const params = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
  const num = (key: string): number | null => {
    const n = Number(params.get(key));
    return Number.isInteger(n) && n > 0 ? n : null;
  };
  const group = params.get("group");
  const rooms = Number(params.get("rooms"));
  return {
    settlementId: num("settlementId"),
    group: (MARKET_NATURE_GROUPS as readonly string[]).includes(group ?? "") ? (group as MarketNatureGroup) : "apartment",
    rooms: (MARKET_ROOM_BUCKETS as readonly number[]).includes(rooms) ? (rooms as MarketRoomBucket) : 0,
    gush: num("gush"),
    helka: num("helka"),
  };
}

function writeScope(scope: Scope): void {
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of [
    ["settlementId", scope.settlementId === null ? null : String(scope.settlementId)],
    ["group", scope.group === "apartment" ? null : scope.group],
    ["rooms", scope.rooms === 0 ? null : String(scope.rooms)],
  ] as const) {
    if (value === null) params.delete(key);
    else params.set(key, value);
  }
  const query = params.toString();
  window.history.replaceState({}, "", query ? `?${query}` : window.location.pathname);
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="mv-stat-tile">
      <dt style={{ color: "var(--color-text-muted)" }}>{label}</dt>
      <dd className="m-0" style={{ fontSize: "calc(22 / 16 * 1rem)", fontWeight: 800 }}>
        {value}
      </dd>
      {hint ? (
        <p className="m-0" style={{ color: "var(--color-text-muted)" }}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/* ============================================================
   סקירה
   ============================================================ */

/** השנה שנבחרה בסקירה — מהכתובת, כדי שקישור ששולחים לעמית יפתח אותה. */
function readYear(): number | null {
  if (typeof window === "undefined") return null;
  const n = Number(new URLSearchParams(window.location.search).get("year"));
  return Number.isInteger(n) && n >= 1990 ? n : null;
}

function OverviewTab({ scope, onPickSettlement }: { scope: Scope; onPickSettlement: (id: number) => void }) {
  const [data, setData] = useState<MarketOverviewDto | null>(null);
  const [failed, setFailed] = useState(false);
  // ‏`null` = השנה המלאה האחרונה שיש לה נתונים, ולכל יישוב היא עשויה להיות אחרת
  const [year, setYear] = useState<number | null>(readYear);

  const pickYear = (next: number | null) => {
    setYear(next);
    const params = new URLSearchParams(window.location.search);
    if (next === null) params.delete("year");
    else params.set("year", String(next));
    window.history.replaceState({}, "", `?${params.toString()}`);
  };

  const load = useCallback(() => {
    setFailed(false);
    setData(null);
    const query = new URLSearchParams({ group: scope.group, rooms: String(scope.rooms) });
    if (scope.settlementId !== null) query.set("settlementId", String(scope.settlementId));
    if (year !== null) query.set("year", String(year));
    apiGet<MarketOverviewDto>(`/market/overview?${query.toString()}`)
      .then(setData)
      .catch(() => setFailed(true));
  }, [scope, year]);

  useEffect(load, [load]);

  if (failed) return <LoadError message="לא הצלחנו לטעון את נתוני השוק" onRetry={load} />;
  if (!data) return <p aria-live="polite">טוען נתוני שוק…</p>;

  const h = data.headline;
  const where = data.scope.settlement ?? "כל הארץ";
  const kind = `${MARKET_NATURE_GROUP_LABELS[data.scope.group]}${data.scope.rooms === 0 ? "" : `, ${marketRoomBucketLabel(data.scope.rooms)}`}`;
  const recent = data.yearly.slice(-15);

  return (
    <div className="flex flex-col gap-6">
      <p className="m-0" style={{ color: "var(--color-text-muted)", fontSize: "var(--type-caption-lg)" }}>
        במאגר: {formatIsraeliNumber(data.database.deals)} עסקאות
        {data.database.sourceDeals > 0 ? ` מתוך ${formatIsraeliNumber(data.database.sourceDeals)} שרשות המסים פרסמה` : ""}
        {` · ${data.database.settlementsSynced} מתוך ${data.database.settlements} יישובים נקלטו במלואם`}
        {data.database.lastDeal ? ` · עסקה אחרונה ${formatDate(data.database.lastDeal)}` : ""}
      </p>

      {h.year === null ? (
        <p className="m-0">אין עדיין מספיק עסקאות {where === "כל הארץ" ? "" : `ב${where}`} בסגמנט הזה.</p>
      ) : (
        <section aria-labelledby="market-headline">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 id="market-headline" className="m-0 text-lg font-semibold">
              {where} · {kind} · {h.year}
            </h2>
            {data.years.length > 1 ? (
              <label className="flex items-center gap-2" htmlFor="market-year">
                <span className="font-medium">שנה</span>
                <select
                  id="market-year"
                  className="mv-input"
                  value={year !== null && data.years.includes(year) ? String(year) : ""}
                  onChange={(e) => pickYear(e.target.value === "" ? null : Number(e.target.value))}
                >
                  <option value="">האחרונה ({data.years[0]})</option>
                  {data.years.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          <dl className="mv-stat-grid m-0">
            <Tile label="עסקאות" value={h.deals === null ? "—" : formatIsraeliNumber(h.deals)} hint={`${pct(h.dealsChangePct)} מול ${h.year - 1}`} />
            <Tile label="מחיר חציוני" value={ils(h.medianPrice)} />
            <Tile label='חציון למ"ר' value={ppsqm(h.medianPpsqm)} hint={`${pct(h.ppsqmChangePct)} מול ${h.year - 1}`} />
            <Tile label="מכירות מקבלן" value={h.newBuildSharePct === null ? "—" : `${h.newBuildSharePct}%`} hint="מתוך העסקאות בשנה" />
          </dl>
        </section>
      )}

      {recent.length > 1 ? (
        <section className="grid gap-4 lg:grid-cols-2" aria-label="מגמות">
          <div className="mv-card mv-card--pad">
            <h3 className="mv-card-head__title m-0 mb-2">חציון המחיר למ&quot;ר לפי שנה</h3>
            <TrendChart
              title={`חציון המחיר למ"ר לפי שנה — ${where}, ${kind}`}
              points={recent.map((y) => ({ label: String(y.year), value: y.medianPpsqm, partial: y.partial }))}
              format={(v) => `${formatIsraeliNumber(v)} ₪`}
            />
          </div>
          <div className="mv-card mv-card--pad">
            <h3 className="mv-card-head__title m-0 mb-2">מספר עסקאות לפי שנה</h3>
            <TrendChart
              title={`מספר עסקאות לפי שנה — ${where}, ${kind}`}
              points={recent.map((y) => ({ label: String(y.year), value: y.deals, partial: y.partial }))}
              format={(v) => formatIsraeliNumber(v)}
            />
          </div>
        </section>
      ) : null}

      {data.quarterly.length > 1 ? (
        <section className="mv-card mv-card--pad" aria-labelledby="market-quarters">
          <h3 id="market-quarters" className="mv-card-head__title m-0 mb-2">רבעונים אחרונים — חציון למ&quot;ר</h3>
          <TrendChart
            title={`חציון המחיר למ"ר לפי רבעון — ${where}`}
            points={data.quarterly.map((q) => ({ label: `${q.quarter}/${String(q.year).slice(2)}`, value: q.medianPpsqm, partial: q.partial }))}
            format={(v) => `${formatIsraeliNumber(v)} ₪`}
          />
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {data.rooms.length > 0 ? (
          <BreakdownTable caption={`לפי מספר חדרים — ${h.year}`} rows={data.rooms} />
        ) : null}
        {data.groups.length > 0 ? <BreakdownTable caption={`לפי סוג נכס — ${h.year}`} rows={data.groups} /> : null}
      </div>

      {data.topSettlements.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <MoversTable caption="היישובים הפעילים ביותר" rows={data.topSettlements} onPick={onPickSettlement} />
          {data.movers.length > 0 ? (
            <MoversTable caption='השינוי הגדול ביותר במחיר למ"ר (100+ עסקאות)' rows={data.movers} onPick={onPickSettlement} />
          ) : null}
        </div>
      ) : null}

      <MarketAttribution text={data.attribution} />
    </div>
  );
}

function BreakdownTable({ caption, rows }: { caption: string; rows: MarketOverviewDto["rooms"] }) {
  return (
    <div className="mv-card mv-card--pad">
      <h3 className="mv-card-head__title m-0 mb-2">{caption}</h3>
      <table className="w-full" style={{ fontSize: "var(--type-body-sm)" }}>
        <caption className="mv-visually-hidden">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="p-1.5 text-start"></th>
            <th scope="col" className="p-1.5 text-start">עסקאות</th>
            <th scope="col" className="p-1.5 text-start">מחיר חציוני</th>
            <th scope="col" className="p-1.5 text-start">למ&quot;ר</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-t" style={{ borderColor: "var(--color-row-border)" }}>
              <th scope="row" className="p-1.5 text-start font-semibold">{row.label}</th>
              <td className="p-1.5">{formatIsraeliNumber(row.deals)}</td>
              <td className="p-1.5">{ils(row.medianPrice)}</td>
              <td className="p-1.5">{ppsqm(row.medianPpsqm)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MoversTable({
  caption,
  rows,
  onPick,
}: {
  caption: string;
  rows: MarketOverviewDto["topSettlements"];
  onPick: (id: number) => void;
}) {
  return (
    <div className="mv-card mv-card--pad">
      <h3 className="mv-card-head__title m-0 mb-2">{caption}</h3>
      <table className="w-full" style={{ fontSize: "var(--type-body-sm)" }}>
        <caption className="mv-visually-hidden">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="p-1.5 text-start">יישוב</th>
            <th scope="col" className="p-1.5 text-start">עסקאות</th>
            <th scope="col" className="p-1.5 text-start">למ&quot;ר</th>
            <th scope="col" className="p-1.5 text-start">שינוי</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.settlementId} className="border-t" style={{ borderColor: "var(--color-row-border)" }}>
              <th scope="row" className="p-1.5 text-start font-normal">
                <button type="button" className="mv-btn-plain p-0" onClick={() => onPick(row.settlementId)}>
                  {row.name}
                </button>
              </th>
              <td className="p-1.5">{formatIsraeliNumber(row.deals)}</td>
              <td className="p-1.5">{ppsqm(row.medianPpsqm)}</td>
              <td className="p-1.5">{pct(row.changePct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ============================================================
   עסקאות — חיפוש
   ============================================================ */

function DealsTab({ scope }: { scope: Scope }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [items, setItems] = useState<MarketDealDto[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const query = useCallback(
    (after: string | null) => {
      const params = new URLSearchParams({ group: scope.group, limit: "50" });
      if (scope.settlementId !== null) params.set("settlementId", String(scope.settlementId));
      if (scope.rooms !== 0) params.set("rooms", String(scope.rooms));
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (after) params.set("cursor", after);
      return `/market/deals?${params.toString()}`;
    },
    [scope, from, to],
  );

  const load = useCallback(
    (after: string | null) => {
      setBusy(true);
      setFailed(false);
      apiGet<MarketDealsPageDto>(query(after))
        .then((page) => {
          const rows = apiList(page.items, "items");
          setItems((prev) => (after === null ? rows : [...(prev ?? []), ...rows]));
          setCursor(page.nextCursor);
        })
        .catch(() => setFailed(true))
        .finally(() => setBusy(false));
    },
    [query],
  );

  useEffect(() => load(null), [load]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1" htmlFor="deals-from">
          <span className="font-medium">מתאריך</span>
          <input id="deals-from" type="date" className="mv-input" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1" htmlFor="deals-to">
          <span className="font-medium">עד תאריך</span>
          <input id="deals-to" type="date" className="mv-input" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      {failed ? <LoadError message="לא הצלחנו לטעון עסקאות" onRetry={() => load(null)} /> : null}
      {items === null ? (
        <p aria-live="polite">טוען עסקאות…</p>
      ) : (
        <DealsTable deals={items} caption="עסקאות לפי הסינון, מהחדשה לישנה" showSettlement={scope.settlementId === null} showParcel />
      )}
      {cursor ? (
        <button type="button" className="mv-btn-ghost self-start" disabled={busy} onClick={() => load(cursor)}>
          {busy ? "טוען…" : "עוד עסקאות"}
        </button>
      ) : null}
    </div>
  );
}

/* ============================================================
   בניין — גוש וחלקה
   ============================================================ */

function BuildingTab({ initial }: { initial: { gush: number | null; helka: number | null } }) {
  const [gush, setGush] = useState(initial.gush ? String(initial.gush) : "");
  const [helka, setHelka] = useState(initial.helka ? String(initial.helka) : "");
  const [data, setData] = useState<MarketParcelDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback((g: string, h: string) => {
    if (!/^\d{1,6}$/u.test(g) || !/^\d{1,5}$/u.test(h)) {
      setError("גוש וחלקה הם מספרים");
      return;
    }
    setError(null);
    apiGet<MarketParcelDto>(`/market/parcels/${g}/${h}`)
      .then(setData)
      .catch(() => setError("לא הצלחנו לטעון את החלקה"));
  }, []);

  useEffect(() => {
    if (initial.gush && initial.helka) search(String(initial.gush), String(initial.helka));
  }, [initial.gush, initial.helka, search]);

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          search(gush.trim(), helka.trim());
        }}
      >
        <label className="flex flex-col gap-1" htmlFor="b-gush">
          <span className="font-medium">גוש</span>
          <input id="b-gush" className="mv-input" inputMode="numeric" value={gush} onChange={(e) => setGush(e.target.value)} style={{ width: 140 }} />
        </label>
        <label className="flex flex-col gap-1" htmlFor="b-helka">
          <span className="font-medium">חלקה</span>
          <input id="b-helka" className="mv-input" inputMode="numeric" value={helka} onChange={(e) => setHelka(e.target.value)} style={{ width: 140 }} />
        </label>
        <button type="submit" className="mv-btn-primary">
          הצג היסטוריה
        </button>
      </form>
      {error ? (
        <p className="m-0" role="alert" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : null}
      {data ? (
        <section className="mv-card mv-card--pad" aria-labelledby="building-result">
          <h3 id="building-result" className="mv-card-head__title m-0 mb-2">
            גוש {data.gush} חלקה {data.helka}
            {data.street ? ` · ${data.street}` : ""} · {data.total} עסקאות
          </h3>
          {data.socioEshkol !== null ? (
            <p className="m-0 mb-2" style={{ color: "var(--color-text-muted)" }}>
              אשכול חברתי-כלכלי של האזור: {data.socioEshkol} מתוך 10
            </p>
          ) : null}
          <DealsTable deals={data.deals} caption={`עסקאות בגוש ${data.gush} חלקה ${data.helka}`} />
        </section>
      ) : null}
    </div>
  );
}

/* ============================================================
   איתור יזום
   ============================================================ */

function ProspectingTab({ settlementId }: { settlementId: number | null }) {
  const [data, setData] = useState<MarketProspectingDto | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    if (settlementId === null) return;
    setFailed(false);
    setData(null);
    apiGet<MarketProspectingDto>(`/market/prospecting?settlementId=${settlementId}`)
      .then(setData)
      .catch(() => setFailed(true));
  }, [settlementId]);

  useEffect(load, [load]);

  if (settlementId === null) return <p className="m-0">בחרו יישוב למעלה כדי לראות בניינים ופרויקטים.</p>;
  if (failed) return <LoadError message="לא הצלחנו לטעון" onRetry={load} />;
  if (!data) return <p aria-live="polite">טוען…</p>;

  const list = (rows: MarketProspectingDto["turnover"], caption: string, empty: string) =>
    rows.length === 0 ? (
      <p className="m-0" style={{ color: "var(--color-text-muted)" }}>
        {empty}
      </p>
    ) : (
      <table className="w-full" style={{ fontSize: "var(--type-body-sm)" }}>
        <caption className="mv-visually-hidden">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="p-1.5 text-start">גוש/חלקה</th>
            <th scope="col" className="p-1.5 text-start">רחוב</th>
            <th scope="col" className="p-1.5 text-start">עסקאות</th>
            <th scope="col" className="p-1.5 text-start">אחרונה</th>
            <th scope="col" className="p-1.5 text-start">למ&quot;ר</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.gush}-${row.helka}`} className="border-t" style={{ borderColor: "var(--color-row-border)" }}>
              <th scope="row" className="p-1.5 text-start font-normal">
                <a href={`/forum?tab=market&view=building&gush=${row.gush}&helka=${row.helka}`}>
                  {row.gush}/{row.helka}
                </a>
              </th>
              <td className="p-1.5">{row.street ?? "—"}</td>
              <td className="p-1.5">{row.deals}</td>
              <td className="p-1.5">{formatDate(row.lastDeal)}</td>
              <td className="p-1.5">{ppsqm(row.medianPpsqm)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="mv-card mv-card--pad" aria-labelledby="pros-turnover">
        <h3 id="pros-turnover" className="mv-card-head__title m-0 mb-1">בניינים עם תחלופה גבוהה</h3>
        <p className="m-0 mb-2" style={{ color: "var(--color-text-muted)", fontSize: "var(--type-caption-lg)" }}>
          יד שנייה, 24 חודשים אחרונים. בניין שמוכרים בו — שווה להכיר את הדיירים.
        </p>
        {list(data.turnover, "בניינים עם הכי הרבה מכירות יד שנייה", "אין בניינים עם שלוש מכירות ומעלה.")}
      </section>
      <section className="mv-card mv-card--pad" aria-labelledby="pros-projects">
        <h3 id="pros-projects" className="mv-card-head__title m-0 mb-1">פרויקטים חדשים</h3>
        <p className="m-0 mb-2" style={{ color: "var(--color-text-muted)", fontSize: "var(--type-caption-lg)" }}>
          חלקות עם מכירות מקבלן (שנת בנייה אחרי שנת העסקה). מי שקנה על הנייר ימכור בעוד כמה שנים.
        </p>
        {list(data.projects, "חלקות עם מכירות מקבלן", "אין מכירות מקבלן ב-24 החודשים האחרונים.")}
      </section>
    </div>
  );
}

/* ============================================================
   המסך
   ============================================================ */

export function MarketExplorer() {
  const initial = useMemo(readScope, []);
  const [scope, setScope] = useState<Scope>({ settlementId: initial.settlementId, group: initial.group, rooms: initial.rooms });
  const [settlements, setSettlements] = useState<MarketSettlementDto[] | null>(null);
  const [settlementText, setSettlementText] = useState("");
  // ‏`view` ולא `tab`: המסך יושב בתוך לשונית של הפורום, ו-`tab` שלה
  const [tab, selectTab] = useEntityTab(
    ["overview", "deals", "building", "prospecting", "map"],
    initial.gush ? "building" : "overview",
    "view",
  );

  useEffect(() => {
    apiGet<MarketSettlementDto[]>("/market/settlements")
      .then((rows) => setSettlements(apiList(rows, "settlements")))
      .catch(() => setSettlements([]));
  }, []);

  useEffect(() => {
    if (!settlements) return;
    setSettlementText(settlements.find((s) => s.id === scope.settlementId)?.name ?? "");
  }, [settlements, scope.settlementId]);

  const update = (next: Partial<Scope>) => {
    const merged = { ...scope, ...next };
    setScope(merged);
    writeScope(merged);
  };

  const pickSettlementByName = (name: string) => {
    setSettlementText(name);
    const trimmed = name.trim();
    if (trimmed === "") {
      update({ settlementId: null });
      return;
    }
    const hit = settlements?.find((s) => s.name === trimmed);
    if (hit) update({ settlementId: hit.id });
  };

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end gap-3" role="group" aria-label="בחירת יישוב, סוג נכס וגודל">
        <label className="flex flex-col gap-1" htmlFor="market-settlement">
          <span className="font-medium">יישוב</span>
          <input
            id="market-settlement"
            className="mv-input"
            list="market-settlements"
            placeholder="כל הארץ"
            value={settlementText}
            onChange={(e) => pickSettlementByName(e.target.value)}
            style={{ minWidth: 220 }}
          />
          <datalist id="market-settlements">
            {(settlements ?? []).map((s) => (
              <option key={s.id} value={s.name} />
            ))}
          </datalist>
        </label>
        <label className="flex flex-col gap-1" htmlFor="market-group">
          <span className="font-medium">סוג נכס</span>
          <select id="market-group" className="mv-input" value={scope.group} onChange={(e) => update({ group: e.target.value as MarketNatureGroup, rooms: 0 })}>
            {MARKET_NATURE_GROUPS.map((g) => (
              <option key={g} value={g}>
                {MARKET_NATURE_GROUP_LABELS[g]}
              </option>
            ))}
          </select>
        </label>
        {DWELLING_GROUPS.includes(scope.group) ? (
          <label className="flex flex-col gap-1" htmlFor="market-rooms">
            <span className="font-medium">חדרים</span>
            <select
              id="market-rooms"
              className="mv-input"
              value={scope.rooms}
              onChange={(e) => update({ rooms: Number(e.target.value) as MarketRoomBucket })}
            >
              {MARKET_ROOM_BUCKETS.map((b) => (
                <option key={b} value={b}>
                  {marketRoomBucketLabel(b)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {scope.settlementId !== null ? (
          <button type="button" className="mv-btn-plain" onClick={() => update({ settlementId: null })}>
            כל הארץ
          </button>
        ) : null}
      </div>

      <EntityTabs
        label="לשוניות נתוני השוק"
        active={tab}
        onSelect={selectTab}
        tabs={[
          { key: "overview", label: "סקירה" },
          { key: "deals", label: "עסקאות" },
          { key: "building", label: "בניין" },
          { key: "prospecting", label: "איתור" },
          { key: "map", label: "מפה" },
        ]}
      />

      <TabPanel tab="overview" active={tab}>
        <OverviewTab scope={scope} onPickSettlement={(id) => update({ settlementId: id })} />
      </TabPanel>
      <TabPanel tab="deals" active={tab}>
        <DealsTab scope={scope} />
      </TabPanel>
      <TabPanel tab="building" active={tab}>
        <BuildingTab initial={{ gush: initial.gush, helka: initial.helka }} />
      </TabPanel>
      <TabPanel tab="prospecting" active={tab}>
        <ProspectingTab settlementId={scope.settlementId} />
      </TabPanel>
      <TabPanel tab="map" active={tab}>
        {scope.settlementId === null ? (
          <p className="m-0">בחרו יישוב למעלה כדי לראות את מפת העסקאות.</p>
        ) : (
          <MarketMap settlementId={scope.settlementId} group={scope.group} />
        )}
      </TabPanel>
    </>
  );
}
