"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";

/**
 * חיפוש גלובלי בשורת הכותרת — לפי קובץ העיצוב: שדה קבוע עם תוצאות
 * נפתחות תחתיו, כל תוצאה עם תג סוג (נכס/קונה/ליד) בצבע משלו.
 * משתמש ב-API החיפוש הקיים (GET /search) עם השהיית הקלדה.
 */

interface SearchResults {
  contact: { id: string; name: string; phone: string } | null;
  properties: {
    id: string;
    city: string | null;
    street: string | null;
    neighborhood: string | null;
    marketingTitle: string | null;
    status: string;
  }[];
  buyers: { id: string; name: string; maturity: string; cities: string[] }[];
  leads: { id: string; name: string; status: string }[];
}

interface Row {
  key: string;
  kind: string;
  fg: string;
  bg: string;
  label: string;
  sub: string;
  href: string;
}

/* צבעי תגי הסוג מקובץ העיצוב; ירוק הטקסט הועמק ל-AA (docs/06 §4) */
const KIND_PROPERTY = { fg: "#0C6E34", bg: "#E5FCEA" };
const KIND_BUYER = { fg: "#7a5c1f", bg: "#f7efdd" };
const KIND_LEAD = { fg: "#3F4742", bg: "#EDEFED" };

const DEBOUNCE_MS = 250;

function toRows(r: SearchResults): Row[] {
  const rows: Row[] = [];
  for (const p of r.properties.slice(0, 3)) {
    rows.push({
      key: `p-${p.id}`,
      kind: "נכס",
      ...KIND_PROPERTY,
      label: p.marketingTitle ?? [p.street, p.city].filter(Boolean).join(", ") ?? "נכס",
      sub: p.neighborhood ?? p.city ?? "",
      href: `/properties/${p.id}`,
    });
  }
  for (const b of r.buyers.slice(0, 3)) {
    rows.push({
      key: `b-${b.id}`,
      kind: "קונה",
      ...KIND_BUYER,
      label: b.name,
      sub: b.cities.slice(0, 2).join(", "),
      href: `/buyers/${b.id}`,
    });
  }
  for (const l of r.leads.slice(0, 2)) {
    rows.push({
      key: `l-${l.id}`,
      kind: "ליד",
      ...KIND_LEAD,
      label: l.name,
      sub: "",
      href: `/leads/${l.id}`,
    });
  }
  return rows;
}

export function TopbarSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const requestSeq = useRef(0);

  useEffect(() => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setRows(null);
      setOpen(false);
      return;
    }
    const seq = ++requestSeq.current;
    const timer = setTimeout(() => {
      apiGet<SearchResults>(`/search?q=${encodeURIComponent(trimmed)}`)
        .then((res) => {
          // תשובה מאוחרת של שאילתה ישנה לא דורסת את העדכנית
          if (seq !== requestSeq.current) return;
          setRows(toRows(res));
          setOpen(true);
        })
        .catch(() => undefined);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q]);

  /* סגירה בלחיצה מחוץ לרכיב וב-ESC */
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent): void => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function go(href: string): void {
    setOpen(false);
    setQ("");
    router.push(href);
  }

  return (
    <div ref={boxRef} className="mv-search">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => {
          if (rows !== null) setOpen(true);
        }}
        placeholder="חיפוש נכס, קונה או ליד…"
        aria-label="חיפוש נכס, קונה או ליד"
        role="combobox"
        aria-expanded={open}
        aria-controls="mv-search-results"
        className="mv-search-input"
      />
      {open && rows !== null ? (
        <div id="mv-search-results" className="mv-search-pop" role="listbox" aria-label="תוצאות חיפוש">
          {rows.length === 0 ? (
            <div className="mv-search-empty">לא נמצאו תוצאות</div>
          ) : (
            rows.map((r) => (
              <button
                key={r.key}
                type="button"
                role="option"
                aria-selected={false}
                className="mv-search-row"
                onClick={() => go(r.href)}
              >
                <span className="mv-search-kind" style={{ color: r.fg, background: r.bg }}>
                  {r.kind}
                </span>
                <span className="mv-search-label">{r.label}</span>
                {r.sub ? <span className="mv-search-sub">{r.sub}</span> : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
