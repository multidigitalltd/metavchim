"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@metavchim/ui";
import {
  parseBuyersCsv,
  parsePropertiesCsv,
  type ParsedBuyerRow,
  type ParsedRow,
} from "@metavchim/shared";
import { ApiError, apiPost } from "@/lib/api";
import { formatPrice, MATURITY_LABELS, PROPERTY_TYPE_LABELS } from "@/lib/format";
import { useRequireAuth } from "@/lib/use-auth";

interface ImportResult {
  created: number;
  failed: { row: number; error: string }[];
}

/*
 * 250 ולא 500: הערות מוגבלות ל-4,000 תווים לשורה, ואצווה של 500
 * שורות מלאות מתקרבת לתקרת ה-2MB של השרת. 250 משאיר מרווח כפול —
 * "request entity too large" על קובץ לגיטימי לא אמור לחזור.
 */
const MAX_ROWS = 250;

type Mode = "properties" | "buyers";

const SAMPLES: Record<Mode, string> = {
  properties: [
    "עיר,שכונה,רחוב,חדרים,שטח,קומה,מחיר,סוג,כותרת",
    "בני ברק,פרדס כץ,רבי עקיבא,4,95,3,2650000,דירה,דירה מרווחת במיקום מרכזי",
    "ירושלים,רמות,הרב שך,3.5,88,0,3200000,דירת גן,דירת גן עם כניסה פרטית",
  ].join("\n"),
  buyers: [
    "שם,טלפון,ערים,סוג עסקה,תקציב,חדרים,בשלות,מימון",
    '"ישראל ישראלי",050-1234567,"תל אביב; רמת גן",קנייה,2500000,3.5,חם,אישור עקרוני',
    '"דנה כהן",052-7654321,חיפה,השכרה,6000,2,מתעניין,מזומן',
  ].join("\n"),
};

const MODE_LABELS: Record<Mode, string> = { properties: "נכסים", buyers: "קונים" };


/**
 * קובצי התבנית להורדה — **כל** הכותרות שהמערכת מזהה, עם שורת דוגמה.
 * מי שמדביק את הנתונים שלו לתוך התבנית מקבל ייבוא שעובר בפעם הראשונה.
 */
const TEMPLATE_CSV: Record<Mode, string> = {
  properties: [
    "עיר,שכונה,רחוב,חדרים,שטח,קומה,מחיר,סוג,סטטוס,כותרת",
    'בני ברק,פרדס כץ,רבי עקיבא 10,3.5,80,2,1750000,דירה,פעיל,"דירה משופצת ומוארת"',
  ].join("\n"),
  buyers: [
    "שם,טלפון,עיר,סוג עסקה,תקציב,תקציב מינימלי,חדרים מינימום,חדרים מקסימום,מימון,בשלות,סטטוס,מקור,הערות",
    'משה כהן,050-1234567,"בני ברק, רמת גן",קנייה,1750000,1500000,3,4,אישור עקרוני,חם,פעיל,פייסבוק,"מחפש דירה משופצת, גמיש בקומה"',
  ].join("\n"),
};

export default function ImportPage() {
  const { loading: authLoading } = useRequireAuth();
  const [mode, setMode] = useState<Mode>("properties");
  const [csv, setCsv] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => {
    if (csv.trim() === "") {
      return { propertyRows: [] as ParsedRow[], buyerRows: [] as ParsedBuyerRow[], unmappedHeaders: [] as string[] };
    }
    try {
      if (mode === "properties") {
        const { rows, unmappedHeaders } = parsePropertiesCsv(csv);
        return { propertyRows: rows, buyerRows: [], unmappedHeaders };
      }
      const { rows, unmappedHeaders } = parseBuyersCsv(csv);
      return { propertyRows: [], buyerRows: rows, unmappedHeaders };
    } catch {
      return { propertyRows: [], buyerRows: [], unmappedHeaders: [] };
    }
  }, [csv, mode]);

  const rowCount = mode === "properties" ? parsed.propertyRows.length : parsed.buyerRows.length;
  // קבצים גדולים נשלחים באצוות של 500 — התקרה כאן היא רק רשת ביטחון בדפדפן
  const tooMany = rowCount > 10_000;

  function reset(): void {
    setResult(null);
    setError(null);
  }

  function onFile(event: React.ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    if (!file) return;
    reset();
    /*
     * xlsx נקרא כקובץ בינארי ומומר ל-CSV; קריאתו כטקסט — מה שקרה
     * קודם — נותנת ג'יבריש ואפס שורות, בלי שום הסבר. רוב המשרדים
     * מייצאים מהמערכת הקודמת שלהם דווקא xlsx.
     */
    if (/\.xlsx$/iu.test(file.name)) {
      file
        .arrayBuffer()
        .then((buf) => import("@/lib/xlsx").then((m) => m.xlsxFileToCsv(buf)))
        .then(setCsv)
        .catch(() => setError("קריאת קובץ ה-xlsx נכשלה — אפשר לשמור אותו כ-CSV ולנסות שוב"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setCsv(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => setError("קריאת הקובץ נכשלה");
    reader.readAsText(file, "utf-8");
  }

  async function onSubmit(): Promise<void> {
    setSubmitting(true);
    reset();
    try {
      const rows: unknown[] =
        mode === "properties"
          ? parsed.propertyRows.map((r) => ({
              ...r.fields,
              ...(r.marketingTitle === undefined ? {} : { marketingTitle: r.marketingTitle }),
              ...(r.status === undefined ? {} : { status: r.status }),
            }))
          : parsed.buyerRows;

      // קובץ מיוצא יכול להכיל אלפי שורות — נשלח באצוות בגודל שהשרת מקבל,
      // עם צבירת תוצאות והיסט מספרי שורות כך שהדיווח נשאר מול הקובץ המקורי.
      const total: ImportResult = { created: 0, failed: [] };
      for (let offset = 0; offset < rows.length; offset += MAX_ROWS) {
        const batch = rows.slice(offset, offset + MAX_ROWS);
        const res = await apiPost<ImportResult>(`/import/${mode}`, { rows: batch });
        total.created += res.created;
        total.failed.push(...res.failed.map((f) => ({ ...f, row: f.row + offset })));
      }
      setResult(total);
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
        <h1 className="text-2xl font-bold">ייבוא נתונים מקובץ</h1>
        <Link href={mode === "properties" ? "/properties" : "/buyers"} className="underline">
          ← חזרה ל{MODE_LABELS[mode]}
        </Link>
      </div>

      <div role="radiogroup" aria-label="מה מייבאים" className="mb-4 flex gap-2">
        {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            disabled={submitting}
            onClick={() => {
              setMode(m);
              setCsv("");
              reset();
            }}
            className="rounded-md border px-4 py-2 font-medium disabled:opacity-60"
            style={{
              borderColor: "var(--color-border)",
              background: mode === m ? "var(--color-primary)" : "var(--color-surface)",
              color: mode === m ? "var(--color-primary-contrast, #fff)" : "inherit",
            }}
          >
            {MODE_LABELS[m]}
          </button>
        ))}
      </div>

      <p className="mb-4" style={{ color: "var(--color-text-muted)" }}>
        {mode === "properties"
          ? "העלו קובץ CSV כדי לייבא נכסים קיימים בבת אחת. כותרות בעברית ממופות אוטומטית — עיר, שכונה, רחוב, חדרים, שטח, קומה, מחיר, סוג, כותרת."
          : "העלו קובץ CSV של לקוחות מחפשים. כותרות: שם, טלפון, ערים (מופרדות ב-;), סוג עסקה, תקציב, חדרים, בשלות, מימון, הערות. טלפונים מנורמלים אוטומטית."}{" "}
        קבצים גדולים נשלחים אוטומטית באצוות של {MAX_ROWS}.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label
          className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <span>📄 בחרו קובץ CSV</span>
          <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="mv-visually-hidden" onChange={onFile} />
        </label>
        {/*
          הורדה ולא רק טעינה למסך: המתווך פותח את הקובץ באקסל, רואה
          את כל הכותרות שהמערכת מכירה, ומדביק את הנתונים שלו לתוכן —
          זו הדרך הבטוחה ביותר לקובץ שעובר בפעם הראשונה.
        */}
        <Button
          variant="secondary"
          onClick={() => {
            const blob = new Blob(["\uFEFF" + TEMPLATE_CSV[mode]], {
              type: "text/csv;charset=utf-8",
            });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = mode === "properties" ? "תבנית-נכסים.csv" : "תבנית-לקוחות.csv";
            a.click();
            URL.revokeObjectURL(a.href);
          }}
        >
          ⬇️ הורדת קובץ לדוגמה (כל הכותרות)
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setCsv(SAMPLES[mode]);
            reset();
          }}
        >
          טענו דוגמה למסך
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
          reset();
        }}
        rows={8}
        dir="ltr"
        className="mb-4 w-full rounded-md border p-3 font-mono text-sm"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        placeholder={SAMPLES[mode]}
        aria-describedby="csv-help"
      />
      <p id="csv-help" className="mv-visually-hidden">
        שורה ראשונה היא כותרות העמודות, כל שורה נוספת היא רשומה. מפרידים בפסיקים.
      </p>

      {parsed.unmappedHeaders.length > 0 ? (
        /*
          alert ולא status, ובולט: עמודה שנזרקת בשקט היא נתונים
          שהמתווך בטוח שנכנסו — והוא מגלה את החוסר חודש אחרי, מול
          לקוח. ליד האזהרה כתוב גם **מה עושים**, לא רק מה קרה.
        */
        <div
          role="alert"
          className="mb-4 rounded-xl border-2 p-4"
          style={{ borderColor: "var(--color-warning, #d97706)", background: "var(--color-warning-bg, #fef3c7)", color: "var(--color-text)" }}
        >
          <p className="m-0 mb-1 font-bold" style={{ fontSize: 15 }}>
            ⚠️ {parsed.unmappedHeaders.length} עמודות לא זוהו — הנתונים שבהן לא ייובאו
          </p>
          <p className="m-0 mb-2 text-sm" dir="ltr">
            {parsed.unmappedHeaders.join(" · ")}
          </p>
          <p className="m-0 text-sm">
            <b>איך מתקנים:</b> הורידו את קובץ הדוגמה (הכפתור למעלה) וראו את שמות
            העמודות שהמערכת מכירה. שינוי שם עמודה בקובץ שלכם לשם מוכר — והיא תיובא.
            עמודות שאינן רלוונטיות אפשר להשאיר; הן פשוט ידולגו.
          </p>
        </div>
      ) : null}

      {tooMany ? (
        <p role="alert" className="mb-4" style={{ color: "var(--color-danger)" }}>
          נמצאו {rowCount} שורות — המקסימום בייבוא אחד הוא 10,000. חלקו את הקובץ.
        </p>
      ) : null}

      {rowCount > 0 ? (
        <>
          <h2 className="mb-2 text-lg font-semibold">
            תצוגה מקדימה — {rowCount} {MODE_LABELS[mode]}
          </h2>
          <div
            className="mb-4 overflow-x-auto rounded-xl border"
            style={{ borderColor: "var(--color-border)" }}
          >
            {mode === "properties" ? (
              <table className="w-full text-start">
                <caption className="mv-visually-hidden">תצוגה מקדימה של הנכסים שיובאו</caption>
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
                  {parsed.propertyRows.slice(0, 20).map((r, i) => (
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
            ) : (
              <table className="w-full text-start">
                <caption className="mv-visually-hidden">תצוגה מקדימה של הקונים שיובאו</caption>
                <thead style={{ background: "var(--color-surface)" }}>
                  <tr>
                    <th scope="col" className="p-2 text-start">#</th>
                    <th scope="col" className="p-2 text-start">שם</th>
                    <th scope="col" className="p-2 text-start">טלפון</th>
                    <th scope="col" className="p-2 text-start">ערים</th>
                    <th scope="col" className="p-2 text-start">תקציב</th>
                    <th scope="col" className="p-2 text-start">בשלות</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.buyerRows.slice(0, 20).map((r, i) => (
                    <tr key={i} className="border-t" style={{ borderColor: "var(--color-border)" }}>
                      <td className="p-2">{i + 1}</td>
                      <td className="p-2">{r.name ?? "—"}</td>
                      <td className="p-2" dir="ltr">{r.phone ?? "—"}</td>
                      <td className="p-2">{r.cities.join(", ") || "—"}</td>
                      <td className="p-2">{formatPrice(r.budgetMaxAgorot)}</td>
                      <td className="p-2">{r.maturity ? MATURITY_LABELS[r.maturity] : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {rowCount > 20 ? (
            <p className="mb-4 text-sm" style={{ color: "var(--color-text-muted)" }}>
              מוצגות 20 השורות הראשונות; כולן ייובאו בלחיצה.
            </p>
          ) : null}
        </>
      ) : null}

      <Button onClick={onSubmit} disabled={submitting || rowCount === 0 || tooMany}>
        {submitting ? "מייבא…" : `ייבא ${rowCount} ${MODE_LABELS[mode]}`}
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
            ✓ יובאו {result.created} {MODE_LABELS[mode]}.
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
            <Link href={mode === "properties" ? "/properties" : "/buyers"}>
              <Button variant="secondary">צפו ב{MODE_LABELS[mode]} שיובאו</Button>
            </Link>
          </div>
        </div>
      ) : null}
    </>
  );
}
