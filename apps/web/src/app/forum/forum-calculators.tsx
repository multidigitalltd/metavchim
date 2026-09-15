"use client";

import { useState } from "react";
import {
  commissionBreakdown,
  DEFAULT_VAT_PERCENT,
  monthlyPayment,
  PURCHASE_TAX_ADDITIONAL_HOME,
  PURCHASE_TAX_SINGLE_HOME,
  PURCHASE_TAX_YEAR,
  purchaseTax,
  rentalYieldPercent,
  shekelsLabel,
  type TaxBracket,
} from "@metavchim/shared";
import { IconBank, IconBanknote, IconCoins, IconKey } from "../icons";

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

export function Calculators() {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Commission />
      <Mortgage />
      <Yield />
      <PurchaseTax />
    </div>
  );
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
  const [price, setPrice] = useState("2500000");
  const [single, setSingle] = useState(true);
  const [brackets, setBrackets] = useState<TaxBracket[]>([...PURCHASE_TAX_SINGLE_HOME]);
  const [editing, setEditing] = useState(false);
  const active = single ? brackets : PURCHASE_TAX_ADDITIONAL_HOME;
  const tax = purchaseTax(num(price), active);

  function setBracket(index: number, patch: Partial<TaxBracket>): void {
    setBrackets((prev) => prev.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  }

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
      <p className="mv-form-hint mt-2">
        לפי מדרגות {PURCHASE_TAX_YEAR}. המדרגות מתעדכנות מדי ינואר — בדקו מול הפרסום העדכני של רשות המסים לפני שמצטטים ללקוח.
        {single ? (
          <>
            {" "}
            <button type="button" className="underline" onClick={() => setEditing((v) => !v)} aria-expanded={editing}>
              {editing ? "לסגור עריכה" : "לעדכן מדרגות"}
            </button>
          </>
        ) : null}
      </p>
      {editing && single ? (
        <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0" aria-label="מדרגות מס — דירה יחידה">
          {brackets.map((bracket, i) => (
            <li key={i} className="grid grid-cols-2 gap-2">
              <Field
                label={bracket.upTo === null ? "מעל המדרגה הקודמת" : `עד (₪)`}
                value={bracket.upTo === null ? "" : String(bracket.upTo)}
                onChange={(v) => setBracket(i, { upTo: v.trim() === "" ? null : num(v) })}
              />
              <Field label="אחוז" value={String(bracket.percent)} onChange={(v) => setBracket(i, { percent: num(v) })} suffix="%" />
            </li>
          ))}
        </ul>
      ) : null}
    </Calc>
  );
}
