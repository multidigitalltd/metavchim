"use client";

import { createContext, useContext, useEffect, useState } from "react";
import {
  CAPITAL_GAINS_RATE_PERCENT,
  capitalGains,
  commissionBreakdown,
  DEFAULT_TAX_TABLES,
  DEFAULT_VAT_PERCENT,
  monthlyPayment,
  perSqmGapPercent,
  pricePerSqmAgorot,
  type PerSqmBenchmark,
  purchaseTax,
  rentalYieldPercent,
  shekelsLabel,
  type TaxBracket,
  type TaxTables,
} from "@metavchim/shared";
import { apiGet, apiPatch, ApiError } from "@/lib/api";
import { useRequireAuth } from "@/lib/use-auth";
import { formatNumber } from "@/lib/format";
import { IconBank, IconBanknote, IconCoins, IconKey, IconRuler } from "../icons";
import { Notice } from "../notice";

/**
 * מחשבוני המקצוע — רצים במסך, בלי שרת (docs/16).
 *
 * החישובים בחבילה המשותפת ובדוקים שם; כאן רק שדות ותוצאה. מס
 * הרכישה הוא היחיד שנשען על נתון שמשתנה בחוק, ולכן המדרגות שלו
 * מוצגות עם שנת הפרסום **וניתנות לעריכה** — מחשבון שמציג מספר
 * מהשנה שעברה כאמת מוחלטת מזיק יותר ממחשבון שאין בו.
 */

function num(value: string): number {
  const parsed = Number(value.replace(/[^\d.]/gu, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function Field({ label, value, onChange, suffix }: { label: string; value: string; onChange: (v: string) => void; suffix?: string }) {
  return (
    <label className="flex flex-col gap-1 text-[length:var(--type-caption)] font-semibold">
      {label}
      <span className="flex items-center gap-2">
        <input className="mv-control mv-ltr" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} />
        {suffix ? <span className="text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-muted)" }}>{suffix}</span> : null}
      </span>
    </label>
  );
}

function Result({ label, value }: { label: string; value: string }) {
  return (
    <div className="mv-forum-result">
      <span className="mv-forum-result__label">{label}</span>
      <span className="mv-forum-result__value mv-ltr">{value}</span>
    </div>
  );
}

function Calc({ title, icon, domain, children }: { title: string; icon: React.ReactNode; domain: string; children: React.ReactNode }) {
  return (
    <section className="mv-card mv-card--pad" aria-label={title}>
      <div className={`mv-card-head ${domain}`}>
        <span className="mv-tile" aria-hidden="true">{icon}</span>
        <h3 className="mv-card-head__title m-0">{title}</h3>
      </div>
      {children}
    </section>
  );
}

/**
 * ‏טבלאות המס — נתון שמשתנה בחוק מדי ינואר. נשמרות בפלטפורמה: כל
 * ‏משתמש קורא את אותם מספרים, ורק מנהל הפלטפורמה מעדכן (במקום,
 * ‏מתוך המחשבון). משרד אינו „מתקן” מדרגות לעצמו — מספר מס שכל
 * ‏משרד עורך בנפרד הוא מספר בלי מקור.
 */
const TaxTablesContext = createContext<{
  tables: TaxTables;
  canEdit: boolean;
  save: (next: TaxTables) => Promise<void>;
}>({ tables: DEFAULT_TAX_TABLES, canEdit: false, save: async () => undefined });

export function Calculators() {
  const { user } = useRequireAuth();
  const [tables, setTables] = useState<TaxTables>(DEFAULT_TAX_TABLES);
  useEffect(() => {
    apiGet<TaxTables>("/forum/tax-tables").then(setTables).catch(() => setTables(DEFAULT_TAX_TABLES));
  }, []);
  const save = async (next: TaxTables): Promise<void> => {
    setTables(await apiPatch<TaxTables>("/platform/tax-tables", next));
  };
  return (
    <TaxTablesContext.Provider value={{ tables, canEdit: user?.isPlatformAdmin === true, save }}>
      <div className="grid gap-3 lg:grid-cols-2">
        <Commission />
        <Mortgage />
        <Yield />
        <PurchaseTax />
        <CapitalGains />
        <Area />
      </div>
    </TaxTablesContext.Provider>
  );
}

/** ‏המשפט שכל משתמש רואה ליד טבלת מס — והעריכה, רק למנהל הפלטפורמה */
function TaxTableNote({ year, editing, onToggle }: { year: number; editing: boolean; onToggle: () => void }) {
  const { canEdit } = useContext(TaxTablesContext);
  return (
    <p className="mv-form-hint mt-2">
      לפי הפרסום ל-{year}. המספרים מתעדכנים מדי ינואר — נא בדקו מול הפרסום העדכני של רשות המסים לפני שמצטטים ללקוח.
      {canEdit ? (
        <>
          {" "}
          <button type="button" className="underline" onClick={onToggle} aria-expanded={editing}>
            {editing ? "לסגור עריכה" : "לעדכן (מנהל הפלטפורמה)"}
          </button>
        </>
      ) : null}
    </p>
  );
}

function SaveRow({ busy, error, onSave }: { busy: boolean; error: string | null; onSave: () => void }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <button type="button" className="mv-btn-action" disabled={busy} onClick={onSave}>{busy ? "שומר…" : "לשמור לכל המשרדים"}</button>
      {error ? <span style={{ color: "var(--color-danger)" }}>{error}</span> : null}
    </div>
  );
}

/** ‏שמירה עם הטיפול המשותף בשגיאות — לשני מחשבוני המס */
function useTableSave(): { busy: boolean; error: string | null; run: (next: TaxTables) => Promise<boolean> } {
  const { save } = useContext(TaxTablesContext);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (next: TaxTables): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await save(next);
      return true;
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "השמירה נכשלה");
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function Commission() {
  const [price, setPrice] = useState("2000000");
  const [percent, setPercent] = useState("2");
  const [vat, setVat] = useState(String(DEFAULT_VAT_PERCENT));
  const split = commissionBreakdown(Math.round(num(price) * 100), num(percent), num(vat));
  return (
    <Calc title="עמלת תיווך" icon={<IconCoins s={19} />} domain="mv-domain-green">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="מחיר העסקה" value={price} onChange={setPrice} suffix="₪" />
        <Field label="אחוז העמלה" value={percent} onChange={setPercent} suffix="%" />
        <Field label="מע״מ" value={vat} onChange={setVat} suffix="%" />
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <Result label="עמלה לפני מע״מ" value={shekelsLabel(split.netAgorot / 100)} />
        <Result label="מע״מ" value={shekelsLabel(split.vatAgorot / 100)} />
        <Result label="סה״כ ללקוח" value={shekelsLabel(split.grossAgorot / 100)} />
      </div>
    </Calc>
  );
}

function Mortgage() {
  const [principal, setPrincipal] = useState("1000000");
  const [rate, setRate] = useState("5");
  const [years, setYears] = useState("25");
  const monthly = monthlyPayment(Math.round(num(principal) * 100), num(rate), num(years));
  const total = monthly * Math.round(num(years) * 12);
  return (
    <Calc title="החזר חודשי למשכנתה" icon={<IconBank s={19} />} domain="mv-domain-blue">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="סכום ההלוואה" value={principal} onChange={setPrincipal} suffix="₪" />
        <Field label="ריבית שנתית" value={rate} onChange={setRate} suffix="%" />
        <Field label="שנים" value={years} onChange={setYears} />
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Result label="החזר חודשי (שפיצר)" value={shekelsLabel(monthly / 100)} />
        <Result label="סה״כ החזר" value={shekelsLabel(total / 100)} />
      </div>
      <p className="mv-form-hint mt-2">חישוב לריבית קבועה ולא צמודה — הערכה לשיחה עם הלקוח, לא הצעת בנק.</p>
    </Calc>
  );
}

function Yield() {
  const [price, setPrice] = useState("1500000");
  const [rent, setRent] = useState("4500");
  const percent = rentalYieldPercent(Math.round(num(price) * 100), Math.round(num(rent) * 100));
  return (
    <Calc title="תשואה מהשכרה" icon={<IconKey s={19} />} domain="mv-domain-amber">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="מחיר הנכס" value={price} onChange={setPrice} suffix="₪" />
        <Field label="שכר דירה חודשי" value={rent} onChange={setRent} suffix="₪" />
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Result label="תשואה שנתית ברוטו" value={percent === null ? "—" : `${percent}%`} />
        <Result label="שכירות בשנה" value={shekelsLabel(num(rent) * 12)} />
      </div>
    </Calc>
  );
}

function PurchaseTax() {
  const { tables } = useContext(TaxTablesContext);
  const [price, setPrice] = useState("2500000");
  const [single, setSingle] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TaxTables["purchase"] | null>(null);
  const { busy, error, run } = useTableSave();
  const active = single ? tables.purchase.singleHome : tables.purchase.additionalHome;
  const tax = purchaseTax(num(price), active);
  const list: "singleHome" | "additionalHome" = single ? "singleHome" : "additionalHome";

  function setBracket(index: number, patch: Partial<TaxBracket>): void {
    setDraft((prev) => {
      const base = prev ?? tables.purchase;
      return { ...base, [list]: base[list].map((b, i) => (i === index ? { ...b, ...patch } : b)) };
    });
  }
  const shown = (draft ?? tables.purchase)[list];

  return (
    <Calc title="מס רכישה" icon={<IconBanknote s={19} />} domain="mv-domain-violet">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="מחיר הדירה" value={price} onChange={setPrice} suffix="₪" />
        <div className="flex flex-col gap-1 text-[length:var(--type-caption)] font-semibold">
          סוג הרוכש
          <div className="mv-seg" role="group" aria-label="סוג הרוכש">
            <button type="button" aria-pressed={single} onClick={() => setSingle(true)}>דירה יחידה</button>
            <button type="button" aria-pressed={!single} onClick={() => setSingle(false)}>דירה נוספת</button>
          </div>
        </div>
      </div>
      <div className="mt-3">
        <Result label="מס רכישה משוער" value={shekelsLabel(tax)} />
      </div>
      <TaxTableNote year={tables.purchase.year} editing={editing} onToggle={() => { setEditing((v) => !v); setDraft(null); }} />
      {editing ? (
        <div className="mt-2">
          <Field label="שנת הפרסום" value={String((draft ?? tables.purchase).year)} onChange={(v) => setDraft((prev) => ({ ...(prev ?? tables.purchase), year: num(v) }))} />
          <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0" aria-label={single ? "מדרגות מס — דירה יחידה" : "מדרגות מס — דירה נוספת"}>
            {shown.map((bracket, i) => (
              <li key={i} className="grid grid-cols-2 gap-2">
                <Field
                  label={bracket.upTo === null ? "מעל המדרגה הקודמת" : "עד (₪)"}
                  value={bracket.upTo === null ? "" : String(bracket.upTo)}
                  onChange={(v) => setBracket(i, { upTo: v.trim() === "" ? null : num(v) })}
                />
                <Field label="אחוז" value={String(bracket.percent)} onChange={(v) => setBracket(i, { percent: num(v) })} suffix="%" />
              </li>
            ))}
          </ul>
          <SaveRow
            busy={busy}
            error={error}
            onSave={() => {
              void run({ ...tables, purchase: draft ?? tables.purchase }).then((ok) => {
                if (ok) {
                  setEditing(false);
                  setDraft(null);
                }
              });
            }}
          />
        </div>
      ) : null}
    </Calc>
  );
}

/**
 * ‏מס שבח — ההערכה שהכי שואלים עליה, והכי צריך להיזהר בה. הכללים
 * ‏ב-`capitalGains` בחבילה המשותפת; כאן רק הקלט, התוצאה וההסתייגות.
 */
function CapitalGains() {
  const { tables } = useContext(TaxTablesContext);
  const [purchasePrice, setPurchasePrice] = useState("1500000");
  const [purchaseDate, setPurchaseDate] = useState("2016-01-01");
  const [salePrice, setSalePrice] = useState("2500000");
  const [saleDate, setSaleDate] = useState("2026-01-01");
  const [expenses, setExpenses] = useState("100000");
  const [cpi, setCpi] = useState("0");
  const [single, setSingle] = useState(true);
  const [editing, setEditing] = useState(false);
  const [ceilingDraft, setCeilingDraft] = useState<string | null>(null);
  const [yearDraft, setYearDraft] = useState<string | null>(null);
  const { busy, error, run } = useTableSave();
  const result = capitalGains({
    purchasePriceShekels: num(purchasePrice),
    purchaseDate,
    salePriceShekels: num(salePrice),
    saleDate,
    expensesShekels: num(expenses),
    cpiPercent: num(cpi),
    singleHome: single,
    singleHomeCeilingShekels: tables.capitalGains.singleHomeCeiling,
  });

  return (
    <Calc title="מס שבח (הערכה)" icon={<IconCoins s={19} />} domain="mv-domain-violet">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="מחיר הרכישה" value={purchasePrice} onChange={setPurchasePrice} suffix="₪" />
        <label className="flex flex-col gap-1 text-[length:var(--type-caption)] font-semibold">
          תאריך הרכישה
          <input type="date" className="mv-control" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
        </label>
        <Field label="מחיר המכירה" value={salePrice} onChange={setSalePrice} suffix="₪" />
        <label className="flex flex-col gap-1 text-[length:var(--type-caption)] font-semibold">
          תאריך המכירה
          <input type="date" className="mv-control" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} />
        </label>
        <Field label="הוצאות מוכרות (עו״ד, תיווך, מס רכישה, שיפוץ)" value={expenses} onChange={setExpenses} suffix="₪" />
        <Field label="עליית המדד בין התאריכים (חל על מחיר הרכישה)" value={cpi} onChange={setCpi} suffix="%" />
        <div className="flex flex-col gap-1 text-[length:var(--type-caption)] font-semibold sm:col-span-2">
          הדירה הנמכרת
          <div className="mv-seg" role="group" aria-label="הדירה הנמכרת">
            <button type="button" aria-pressed={single} onClick={() => setSingle(true)}>דירה יחידה</button>
            <button type="button" aria-pressed={!single} onClick={() => setSingle(false)}>דירה נוספת</button>
          </div>
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Result label="שבח ריאלי" value={shekelsLabel(result.realGain)} />
        <Result label={`מס שבח משוער (${CAPITAL_GAINS_RATE_PERCENT}%)`} value={shekelsLabel(result.tax)} />
      </div>
      {result.notes.length > 0 ? (
        <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0 text-[length:var(--type-caption-lg)]" aria-label="איך חושב">
          {result.notes.map((note) => (
            <li key={note} style={{ color: "var(--color-text-soft)" }}>· {note}</li>
          ))}
        </ul>
      ) : null}
      <p className="mv-form-hint mt-2">
        הערכה בלבד: בלי פחת, הוצאות מימון, ירושה ומתנה, ובלי בדיקת תנאי הפטור. לפני שמצטטים ללקוח — הסימולטור של רשות המסים או יועץ מס.
      </p>
      <TaxTableNote
        year={tables.capitalGains.year}
        editing={editing}
        onToggle={() => {
          setEditing((v) => !v);
          setCeilingDraft(null);
          setYearDraft(null);
        }}
      />
      {editing ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <Field label="תקרת הפטור לדירה יחידה" value={ceilingDraft ?? String(tables.capitalGains.singleHomeCeiling)} onChange={setCeilingDraft} suffix="₪" />
          <Field label="שנת הפרסום" value={yearDraft ?? String(tables.capitalGains.year)} onChange={setYearDraft} />
          <div className="sm:col-span-2">
            <SaveRow
              busy={busy}
              error={error}
              onSave={() => {
                void run({
                  ...tables,
                  capitalGains: {
                    year: yearDraft === null ? tables.capitalGains.year : num(yearDraft),
                    singleHomeCeiling: ceilingDraft === null ? tables.capitalGains.singleHomeCeiling : num(ceilingDraft),
                  },
                }).then((ok) => {
                  if (ok) setEditing(false);
                });
              }}
            />
          </div>
        </div>
      ) : null}
    </Calc>
  );
}

/** ‏מ״ר בעברית, עם מפריד אלפים — „85 מ״ר”. */
function sqmLabel(value: number): string {
  return `${formatNumber(Math.round(value))} מ״ר`;
}

interface AreaBenchmarks {
  neighborhood: (PerSqmBenchmark & { label: string }) | null;
  city: (PerSqmBenchmark & { label: string }) | null;
}

/**
 * ‏שטח ומחיר למ״ר — החישוב שנעשה בכל שיחה, ובדרך כלל בראש.
 *
 * ‏ברוטו ונטו: המודעה אומרת 110, הטאבו אומר 92, והלקוח שואל „אז
 * ‏כמה למטר?”. שני המספרים מוצגים זה לצד זה, כי הוויכוח בין קונה
 * ‏למוכר הוא בדיוק על איזה מהם.
 *
 * ‏ההשוואה לשכונה נשענת על **המלאי של המשרד** — אותו ממוצע שכרטיס
 * ‏הנכס מציג, על אותו כלל (לפחות שלושה נכסים באותו סוג עסקה).
 * ‏זה נאמר במסך: מדד של משרד עם שני נכסים בשכונה אינו מדד.
 */
function Area() {
  const [price, setPrice] = useState("2200000");
  const [gross, setGross] = useState("110");
  const [net, setNet] = useState("92");
  const [city, setCity] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [sale, setSale] = useState(true);
  /*
   * ‏התוצאה נשמרת **עם הסינון שביקש אותה**, ומוצגת רק כל עוד הוא לא
   * ‏השתנה: „רמת גן, מכירה” שנשאר על המסך אחרי שהמשתמש הקליד „חיפה”
   * ‏הוא ממוצע של עיר אחרת עם פער שמחושב מולה (ביקורת Codex). אותו
   * ‏כלל מטפל גם בתשובה שמגיעה אחרי שהשדה כבר נערך — היא נשמרת עם
   * ‏המפתח הישן, ולכן אינה מוצגת.
   */
  const [result, setResult] = useState<{ key: string; benchmarks: AreaBenchmarks } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filterKey = `${city.trim()}|${neighborhood.trim()}|${sale ? "sale" : "rent"}`;
  const benchmarks = result !== null && result.key === filterKey ? result.benchmarks : null;

  const priceAgorot = Math.round(num(price) * 100);
  const grossSqm = num(gross);
  const netSqm = num(net);
  const perGross = pricePerSqmAgorot(priceAgorot, grossSqm);
  const perNet = pricePerSqmAgorot(priceAgorot, netSqm);
  const ratio = grossSqm > 0 && netSqm > 0 ? Math.round((netSqm / grossSqm) * 100) : null;
  /* ‏ההשוואה לפי הברוטו — כך רשומים רוב הנכסים במלאי, וכך המודעות */
  const gapNeighborhood = perSqmGapPercent(perGross, benchmarks?.neighborhood ?? null);
  const gapCity = perSqmGapPercent(perGross, benchmarks?.city ?? null);

  async function compare(): Promise<void> {
    if (city.trim() === "") {
      setError("צריך עיר כדי להשוות");
      return;
    }
    setBusy(true);
    setError(null);
    const key = filterKey;
    try {
      const params = new URLSearchParams({ city: city.trim(), dealType: sale ? "sale" : "rent" });
      if (neighborhood.trim() !== "") params.set("neighborhood", neighborhood.trim());
      const data = await apiGet<AreaBenchmarks>(`/properties/benchmarks/per-sqm?${params.toString()}`);
      setResult({ key, benchmarks: data });
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "ההשוואה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  const gapText = (gap: number | null): string =>
    gap === null ? "" : gap === 0 ? " — כמו הממוצע" : gap > 0 ? ` — ${gap}% מעל הממוצע` : ` — ${Math.abs(gap)}% מתחת לממוצע`;

  return (
    <Calc title="שטח ומחיר למ״ר" icon={<IconRuler s={19} />} domain="mv-domain-peach">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="מחיר" value={price} onChange={setPrice} suffix="₪" />
        <Field label="שטח ברוטו" value={gross} onChange={setGross} suffix="מ״ר" />
        <Field label="שטח נטו" value={net} onChange={setNet} suffix="מ״ר" />
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <Result label="למ״ר ברוטו" value={perGross === null ? "—" : shekelsLabel(perGross / 100)} />
        <Result label="למ״ר נטו" value={perNet === null ? "—" : shekelsLabel(perNet / 100)} />
        <Result label="נטו מתוך ברוטו" value={ratio === null ? "—" : `${ratio}%`} />
      </div>

      {/*
        ‏הכפתור יושב מתחת לבורר סוג העסקה ולא מתחת לשדה טקסט: כפתור
        ‏ההכתבה הצף נפתח מתחת לשדה טקסט ממוקד, וכפתור שממוקם שם נלחץ
        ‏דרכו — המשתמש מקליד עיר ולוחץ „להשוות”, ומקבל הכתבה.
      */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-[length:var(--type-caption)] font-semibold">
          עיר
          <input className="mv-control" value={city} onChange={(e) => setCity(e.target.value)} placeholder="למשל: רמת גן" />
        </label>
        <div className="flex flex-col gap-1 text-[length:var(--type-caption)] font-semibold">
          סוג עסקה
          <div className="mv-seg" role="group" aria-label="סוג עסקה להשוואה">
            <button type="button" aria-pressed={sale} onClick={() => setSale(true)}>מכירה</button>
            <button type="button" aria-pressed={!sale} onClick={() => setSale(false)}>השכרה</button>
          </div>
        </div>
        <label className="flex flex-col gap-1 text-[length:var(--type-caption)] font-semibold">
          שכונה (לא חובה)
          <input className="mv-control" value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} placeholder="למשל: מרום נווה" />
        </label>
        <div className="flex flex-col justify-end">
          <button type="button" className="mv-btn-soft" disabled={busy} onClick={() => void compare()}>
            {busy ? "משווה…" : "להשוות למלאי המשרד"}
          </button>
        </div>
      </div>
      <p className="mv-form-hint mt-2">
        הממוצע מחושב מנכסי המשרד באותה עיר ובאותו סוג עסקה — לפחות שלושה נכסים.
      </p>
      {error !== null ? <div className="mt-2"><Notice tone="danger">{error}</Notice></div> : null}
      {benchmarks !== null ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Result
            label={benchmarks.neighborhood === null ? "בשכונה" : `בשכונה (${benchmarks.neighborhood.count} נכסים)`}
            value={benchmarks.neighborhood === null ? "אין מספיק נכסים" : `${shekelsLabel(benchmarks.neighborhood.avgPerSqmAgorot / 100)}${gapText(gapNeighborhood)}`}
          />
          <Result
            label={benchmarks.city === null ? "בעיר" : `בעיר (${benchmarks.city.count} נכסים)`}
            value={benchmarks.city === null ? "אין מספיק נכסים" : `${shekelsLabel(benchmarks.city.avgPerSqmAgorot / 100)}${gapText(gapCity)}`}
          />
        </div>
      ) : null}
      <p className="mv-form-hint mt-2">
        ברוטו כולל חלק יחסי ברכוש המשותף; נטו הוא השטח בתוך הקירות. ההשוואה לפי הברוטו — כך רשומים הנכסים במלאי ובמודעות. {sqmLabel(grossSqm)} ברוטו הם {sqmLabel(netSqm)} נטו כאן.
      </p>
    </Calc>
  );
}
