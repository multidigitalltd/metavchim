"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@metavchim/ui";
import { parsePropertiesCsv, type ParsedRow } from "@metavchim/shared";
import { ApiError, apiPost } from "@/lib/api";
import { formatPrice, PROPERTY_TYPE_LABELS } from "@/lib/format";
import { useRequireAuth } from "@/lib/use-auth";

interface ImportResult {
  created: number;
  failed: { row: number; error: string }[];
}

const MAX_ROWS = 500;

const SAMPLE_CSV = [
  "עיר,שכונה,רחוב,חדרים,שטח,קומה,מחיר,סוג,כותרת",
  "בני ברק,פרדס כץ,רבי עקיבא,4,95,3,2650000,דירה,דירה מרווחת במיקום מרכזי",
  "ירושלים,רמות,הרב שך,3.5,88,0,3200000,דירת גן,דירת גן עם כניסה פרטית",
].join("\n");

export default function ImportPage() {
  const { loading: authLoading } = useRequireAuth();
  const [csv, setCsv] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => {
    if (csv.trim() === "") return { rows: [] as ParsedRow[], unmappedHeaders: [] as string[] };
    try {
      return parsePropertiesCsv(csv);
    } catch {
      return { rows: [] as ParsedRow[], unmappedHeaders: [] as string[] };
    }
  }, [csv]);

  const tooMany = parsed.rows.length > MAX_ROWS;

  function onFile(event: React.ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    if (!file) return;
    setResult(null);
    setError(null);
    const reader = new FileReader();
    reader.onload = () => setCsv(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => setError("קריאת הקובץ נכשלה");
    reader.readAsText(file, "utf-8");
  }

  async function onSubmit(): Promise<void> {
    setSubmitting(true);
    setResult(null);
    setError(null);
    try {
      const rows = parsed.rows.map((r) =>
        r.marketingTitle === undefined ? r.fields : { ...r.fields, marketingTitle: r.marketingTitle },
      );
      const res = await apiPost<ImportResult>("/import/properties", { rows });
      setResult(res);
    } catch (err) {
      if (err instanceof ApiError && err.issues.length > 0) {
        setError(`הנתונים לא עברו ולידציה: ${err.issues.map((i) => i.message).join("; ")}`);
      } else {
        setError(err instanceof Error ? err.message : "הייבוא נכשל");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (authLoading) return <p aria-live="polite">טוען…</p>;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">ייבוא נכסים מקובץ</h1>
        <Link href="/properties" className="underline">
          ← חזרה לנכסים
        </Link>
      </div>

      <p className="mb-4" style={{ color: "var(--color-text-muted)" }}>
        העלו קובץ CSV (או הדביקו נתונים) כדי לייבא נכסים קיימים בבת אחת. הכותרות בעברית ממופות
        אוטומטית — עיר, שכונה, רחוב, חדרים, שטח, קומה, מחיר, סוג, כותרת. עד {MAX_ROWS} נכסים בייבוא.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label
          className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <span>📄 בחרו קובץ CSV</span>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="mv-visually-hidden"
            onChange={onFile}
          />
        </label>
        <Button
          variant="secondary"
          onClick={() => {
            setCsv(SAMPLE_CSV);
            setResult(null);
            setError(null);
          }}
        >
          טענו דוגמה
        </Button>
      </div>

      <label htmlFor="csv-input" className="mb-1 block font-medium">
        נתוני CSV
      </label>
      <textarea
        id="csv-input"
        value={csv}
        onChange={(e) => {
          setCsv(e.target.value);
          setResult(null);
          setError(null);
        }}
        rows={8}
        dir="ltr"
        className="mb-4 w-full rounded-md border p-3 font-mono text-sm"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        placeholder={SAMPLE_CSV}
        aria-describedby="csv-help"
      />
      <p id="csv-help" className="mv-visually-hidden">
        שורה ראשונה היא כותרות העמודות, כל שורה נוספת היא נכס. מפרידים בפסיקים.
      </p>

      {parsed.unmappedHeaders.length > 0 ? (
        <p
          role="status"
          className="mb-4 rounded-md p-3"
          style={{ background: "var(--color-warning-bg, #fef3c7)", color: "var(--color-text)" }}
        >
          ⚠️ כותרות שלא זוהו ולא ייובאו: {parsed.unmappedHeaders.join(", ")}
        </p>
      ) : null}

      {tooMany ? (
        <p role="alert" className="mb-4" style={{ color: "var(--color-danger)" }}>
          נמצאו {parsed.rows.length} שורות — המקסימום הוא {MAX_ROWS}. חלקו את הקובץ.
        </p>
      ) : null}

      {parsed.rows.length > 0 ? (
        <>
          <h2 className="mb-2 text-lg font-semibold">
            תצוגה מקדימה — {parsed.rows.length} נכסים
          </h2>
          <div className="mb-4 overflow-x-auto rounded-xl border" style={{ borderColor: "var(--color-border)" }}>
            <table className="w-full text-start">
              <caption className="mv-visually-hidden">תצוגה מקדימה של הנכסים שיובאו מהקובץ</caption>
              <thead style={{ background: "var(--color-surface)" }}>
                <tr>
                  <th scope="col" className="p-2 text-start">#</th>
                  <th scope="col" className="p-2 text-start">עיר</th>
                  <th scope="col" className="p-2 text-start">רחוב</th>
                  <th scope="col" className="p-2 text-start">סוג</th>
                  <th scope="col" className="p-2 text-start">חדרים</th>
                  <th scope="col" className="p-2 text-start">מחיר</th>
                </tr>
              </thead>
              <tbody>
                {parsed.rows.slice(0, 20).map((r, i) => (
                  <tr key={i} className="border-t" style={{ borderColor: "var(--color-border)" }}>
                    <td className="p-2">{i + 1}</td>
                    <td className="p-2">{r.fields.city ?? "—"}</td>
                    <td className="p-2">{r.fields.street ?? "—"}</td>
                    <td className="p-2">
                      {r.fields.propertyType ? PROPERTY_TYPE_LABELS[r.fields.propertyType] : "—"}
                    </td>
                    <td className="p-2">{r.fields.rooms ?? "—"}</td>
                    <td className="p-2">{formatPrice(r.fields.priceAgorot)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {parsed.rows.length > 20 ? (
            <p className="mb-4 text-sm" style={{ color: "var(--color-text-muted)" }}>
              מוצגות 20 השורות הראשונות; כולן ייובאו בלחיצה.
            </p>
          ) : null}
        </>
      ) : null}

      <Button onClick={onSubmit} disabled={submitting || parsed.rows.length === 0 || tooMany}>
        {submitting ? "מייבא…" : `ייבא ${parsed.rows.length} נכסים`}
      </Button>

      {error ? (
        <p role="alert" className="mt-4" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : null}

      {result ? (
        <div
          role="status"
          className="mt-4 rounded-xl border p-4"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <p className="mb-2 font-semibold" style={{ color: "var(--color-success)" }}>
            ✓ יובאו {result.created} נכסים כטיוטה.
          </p>
          {result.failed.length > 0 ? (
            <>
              <p className="mb-1" style={{ color: "var(--color-danger)" }}>
                {result.failed.length} שורות נכשלו:
              </p>
              <ul className="list-inside list-disc text-sm">
                {result.failed.map((f) => (
                  <li key={f.row}>
                    שורה {f.row}: {f.error}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <div className="mt-3">
            <Link href="/properties">
              <Button variant="secondary">צפו בנכסים שיובאו</Button>
            </Link>
          </div>
        </div>
      ) : null}
    </>
  );
}
