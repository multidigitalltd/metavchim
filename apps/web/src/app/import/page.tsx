"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@metavchim/ui";
import {
  BUYER_TARGET_LABELS,
  LEAD_TARGET_LABELS,
  parseBuyersCsv,
  parseLeadsCsv,
  parsePropertiesCsv,
  PROPERTY_TARGET_LABELS,
  type ParsedBuyerRow,
  type ParsedLeadRow,
  type ParsedRow,
} from "@metavchim/shared";
import { ApiError, apiPost } from "@/lib/api";
import { formatPrice, MATURITY_LABELS, PROPERTY_TYPE_LABELS } from "@/lib/format";
import { useRequireAuth } from "@/lib/use-auth";
import { IconDoc, IconDownload, IconWarning } from "../icons";
import { Notice } from "../notice";

interface ImportResult {
  created: number;
  failed: { row: number; error: string }[];
  /**
   * שורות שנקלטו ויש עליהן מה לומר.
   *
   * מוצגות בנפרד מ-`failed` ובצבע אחר, כי המסקנה הפוכה: שורה
   * שנכשלה דורשת תיקון ושליחה מחדש, ושורה עם אזהרה כבר בפנים
   * ואין מה לעשות איתה עכשיו. אותה רשימה לשתיהן הייתה גורמת
   * למתווך לייבא את הקובץ פעמיים.
   */
  warnings?: { row: number; warning: string }[];
}

/*
 * 250 ולא 500: הערות מוגבלות ל-4,000 תווים לשורה, ואצווה של 500
 * שורות מלאות מתקרבת לתקרת ה-2MB של השרת. 250 משאיר מרווח כפול —
 * "request entity too large" על קובץ לגיטימי לא אמור לחזור.
 */
const MAX_ROWS = 250;

type Mode = "properties" | "buyers" | "leads";

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
  leads: [
    "שם,טלפון,אימייל,עניין,מקור,הודעה",
    '"יוסי לוי",050-1234567,yossi@example.com,קנייה,פייסבוק,"מתעניין בדירות 4 חדרים בבני ברק"',
    '"רות כהן",052-7654321,,מכירה,אתר,"רוצה להעריך את הדירה שלה ברמת גן"',
  ].join("\n"),
};

const MODE_LABELS: Record<Mode, string> = {
  properties: "נכסים",
  buyers: "קונים",
  leads: "לידים",
};

const LEAD_INTENT_LABELS: Record<string, string> = {
  buy: "לקנות",
  sell: "למכור",
  rent_in: "לשכור",
  rent_out: "להשכיר",
  info: "מידע",
};

const MODE_BACK: Record<Mode, string> = {
  properties: "/properties",
  buyers: "/buyers",
  leads: "/leads",
};

/** שדות היעד למיפוי ידני — לכל מסלול הרשימה שלו. */
const TARGET_LABELS: Record<Mode, Record<string, string>> = {
  properties: PROPERTY_TARGET_LABELS,
  buyers: BUYER_TARGET_LABELS,
  leads: LEAD_TARGET_LABELS,
};

/**
 * קובצי התבנית להורדה — **כל** הכותרות שהמערכת מזהה, עם שורת דוגמה.
 * מי שמדביק את הנתונים שלו לתוך התבנית מקבל ייבוא שעובר בפעם הראשונה.
 */
const TEMPLATE_CSV: Record<Mode, string> = {
  properties: [
    "עיר,שכונה,רחוב,מספר בית,חדרים,שטח,קומה,מתוך קומות,מחיר,סוג עסקה,סוג,מצב,מעלית,חניה,מרפסת,ממד,מחסן,בעל הנכס,טלפון בעלים,סטטוס,כותרת,תיאור,הערות",
    'בני ברק,פרדס כץ,רבי עקיבא,10,3.5,80,2,6,1750000,מכירה,דירה,משופץ,כן,כן,לא,כן,לא,ישראל ישראלי,050-1234567,פעיל,"דירה משופצת ומוארת","קרובה לכל דבר","המפתח אצל השכן"',
  ].join("\n"),
  buyers: [
    // "סטטוס" אינו בתבנית בכוונה: הוא כינוי נרדף ל"בשלות" במפרק,
    // ושתי עמודות שנראות שונות ונכתבות לאותו שדה הן מלכודת שקטה
    "שם,טלפון,אימייל,עיר,שכונות,סוג נכס,סוג עסקה,תקציב,תקציב מינימלי,חדרים מינימום,חדרים מקסימום,שטח מינימלי,מימון,בשלות,מקור,הערות",
    'משה כהן,050-1234567,moshe@example.com,"בני ברק, רמת גן",פרדס כץ,דירה,קנייה,1750000,1500000,3,4,70,אישור עקרוני,חם,פייסבוק,"מחפש דירה משופצת, גמיש בקומה"',
  ].join("\n"),
  leads: [
    "שם,טלפון,אימייל,עניין,מקור,הודעה",
    'יוסי לוי,050-1234567,yossi@example.com,קנייה,פייסבוק,"מתעניין בדירות 4 חדרים בבני ברק"',
  ].join("\n"),
};

export default function ImportPage() {
  const { loading: authLoading } = useRequireAuth();
  const [mode, setMode] = useState<Mode>("properties");
  const [csv, setCsv] = useState("");
  /** מיפוי ידני: כותרת מהקובץ ⟵ שדה יעד. גובר על הזיהוי האוטומטי. */
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => {
    const empty = {
      propertyRows: [] as ParsedRow[],
      buyerRows: [] as ParsedBuyerRow[],
      leadRows: [] as ParsedLeadRow[],
      unmappedHeaders: [] as string[],
    };
    if (csv.trim() === "") return empty;
    try {
      if (mode === "properties") {
        const { rows, unmappedHeaders } = parsePropertiesCsv(csv, overrides);
        return { ...empty, propertyRows: rows, unmappedHeaders };
      }
      if (mode === "buyers") {
        const { rows, unmappedHeaders } = parseBuyersCsv(csv, overrides);
        return { ...empty, buyerRows: rows, unmappedHeaders };
      }
      const { rows, unmappedHeaders } = parseLeadsCsv(csv, overrides);
      return { ...empty, leadRows: rows, unmappedHeaders };
    } catch {
      return empty;
    }
  }, [csv, mode, overrides]);

  const rowCount =
    mode === "properties"
      ? parsed.propertyRows.length
      : mode === "buyers"
        ? parsed.buyerRows.length
        : parsed.leadRows.length;

  /**
   * העמודות שמוצגות באזור המיפוי הידני: מה שלא זוהה + מה שכבר מופה
   * ידנית. עמודה שמופתה נעלמת מרשימת ה"לא זוהו" של המפרק, ובלי
   * האיחוד הזה לא הייתה דרך לתקן בחירה שגויה.
   */
  const mappableHeaders = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const header of parsed.unmappedHeaders) {
      if (!seen.has(header.trim())) {
        seen.add(header.trim());
        list.push(header);
      }
    }
    for (const [header, target] of Object.entries(overrides)) {
      if (target !== "" && !seen.has(header)) {
        seen.add(header);
        list.push(header);
      }
    }
    return list;
  }, [parsed.unmappedHeaders, overrides]);
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
    setOverrides({});
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
              ...(r.marketingDescription === undefined
                ? {}
                : { marketingDescription: r.marketingDescription }),
              ...(r.internalNotes === undefined ? {} : { internalNotes: r.internalNotes }),
              ...(r.ownerName === undefined ? {} : { ownerName: r.ownerName }),
              ...(r.ownerPhone === undefined ? {} : { ownerPhone: r.ownerPhone }),
              ...(r.status === undefined ? {} : { status: r.status }),
            }))
          : mode === "buyers"
            ? parsed.buyerRows
            : parsed.leadRows;

      /*
       * האצוות נחתכות לפי **בייטים**, לא לפי מספר שורות.
       *
       * מספר קבוע נראה בטוח עד שקובץ חוקי לגמרי — הערות במקסימום,
       * עברית (שני בייטים לתו) — עובר את תקרת השרת, וה-413 נופל על
       * אצווה מאוחרת אחרי שהקודמות כבר נקלטו: ייבוא חלקי, הגרוע
       * מכל התוצאות (ביקורת Codex). מגה-בייט לאצווה = חצי מהתקרה.
       */
      const encoder = new TextEncoder();
      const BATCH_BYTES = 1_000_000;
      const batches: { start: number; rows: typeof rows }[] = [];
      let current: typeof rows = [];
      let currentBytes = 0;
      let start = 0;
      rows.forEach((row, i) => {
        const size = encoder.encode(JSON.stringify(row)).length + 1;
        if (current.length > 0 && (currentBytes + size > BATCH_BYTES || current.length >= MAX_ROWS)) {
          batches.push({ start, rows: current });
          current = [];
          currentBytes = 0;
          start = i;
        }
        current.push(row);
        currentBytes += size;
      });
      if (current.length > 0) batches.push({ start, rows: current });

      const total: ImportResult = { created: 0, failed: [], warnings: [] };
      for (const batch of batches) {
        const res = await apiPost<ImportResult>(`/import/${mode}`, { rows: batch.rows });
        total.created += res.created;
        total.failed.push(...res.failed.map((f) => ({ ...f, row: f.row + batch.start })));
        /*
         * גם האזהרות מצטברות — קודם הן נזרקו מכל אצווה שאינה
         * הראשונה, ומתווך עם קובץ גדול לא ראה "אין תקציב" או
         * "הלקוח כבר קיים" על רוב השורות.
         */
        total.warnings!.push(
          ...(res.warnings ?? []).map((w) => ({ ...w, row: w.row + batch.start })),
        );
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
        <Link href={MODE_BACK[mode]} className="underline">
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
              setOverrides({});
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
          ? "העלו קובץ אקסל או CSV כדי לייבא נכסים קיימים בבת אחת. כותרות בעברית ובאנגלית ממופות אוטומטית — כתובת, חדרים, מחיר, סוג עסקה, מאפיינים, בעל הנכס ועוד. עמודה שלא זוהתה אפשר למפות ידנית."
          : mode === "buyers"
            ? "העלו קובץ אקסל או CSV של לקוחות מחפשים. כותרות: שם, טלפון, אימייל, ערים, שכונות, סוג נכס, סוג עסקה, תקציב, חדרים, בשלות, מימון, הערות. טלפונים מנורמלים אוטומטית."
            : "העלו קובץ אקסל או CSV של פניות — מדף פייסבוק, מדוח קמפיין או מהמערכת הקודמת. לקוח שכבר קיים במערכת לא ייפתח פעמיים: הפנייה תצורף לליד הפתוח שלו."}{" "}
        קבצים גדולים נשלחים אוטומטית באצוות של {MAX_ROWS}.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label
          className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <span><IconDoc s={15} /> בחרו קובץ CSV</span>
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
          <IconDownload s={15} /> הורדת קובץ לדוגמה (כל הכותרות)
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

      {mappableHeaders.length > 0 ? (
        /*
          alert ולא status, ובולט: עמודה שנזרקת בשקט היא נתונים
          שהמתווך בטוח שנכנסו — והוא מגלה את החוסר חודש אחרי, מול
          לקוח. ליד האזהרה יש גם **פתרון בלחיצה**, לא רק דיווח.
        */
        <div
          role="alert"
          className="mb-4 rounded-xl border-2 p-4"
          style={{ borderColor: "var(--color-warning, #d97706)", background: "var(--color-warning-bg, #fef3c7)", color: "var(--color-text)" }}
        >
          <p className="m-0 mb-1 font-bold" style={{ fontSize: 16 }}>
            <IconWarning s={15} />{" "}
            {parsed.unmappedHeaders.length > 0
              ? `${parsed.unmappedHeaders.length} עמודות לא זוהו — הנתונים שבהן לא ייובאו`
              : "כל העמודות מופו — אפשר לשנות את המיפוי הידני"}
          </p>
          {/*
            מיפוי ידני במקום "לכו תתקנו את הקובץ": המתווך בוחר ליד כל
            עמודה לא מזוהה לאיזה שדה היא שייכת, והתצוגה המקדימה
            מתעדכנת מיד. אין צורך לפתוח את אקסל ולשנות כותרות.
          */}
          <ul className="m-0 mb-2 flex list-none flex-col gap-2 p-0">
            {mappableHeaders.map((header) => (
              <li key={header} className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm" dir="ltr">{header}</span>
                <span aria-hidden>←</span>
                <select
                  aria-label={`לאיזה שדה שייכת העמודה ${header}`}
                  className="rounded-md border px-2 py-1 text-sm"
                  style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
                  value={overrides[header.trim()] ?? ""}
                  onChange={(e) => {
                    const value = e.target.value;
                    setOverrides((prev) => ({ ...prev, [header.trim()]: value }));
                    reset();
                  }}
                >
                  <option value="">לא לייבא את העמודה</option>
                  {Object.entries(TARGET_LABELS[mode]).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
          <p className="m-0 text-sm">
            בחרו שדה יעד לכל עמודה שחשובה לכם — או השאירו "לא לייבא" והיא תדולג.
          </p>
        </div>
      ) : null}

      {tooMany ? (
        <Notice tone="danger">נמצאו {rowCount} שורות — המקסימום בייבוא אחד הוא 10,000. חלקו את הקובץ.</Notice>
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
            ) : mode === "leads" ? (
              <table className="w-full text-start">
                <caption className="mv-visually-hidden">תצוגה מקדימה של הלידים שיובאו</caption>
                <thead style={{ background: "var(--color-surface)" }}>
                  <tr>
                    <th scope="col" className="p-2 text-start">#</th>
                    <th scope="col" className="p-2 text-start">שם</th>
                    <th scope="col" className="p-2 text-start">טלפון</th>
                    <th scope="col" className="p-2 text-start">אימייל</th>
                    <th scope="col" className="p-2 text-start">עניין</th>
                    <th scope="col" className="p-2 text-start">מקור</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.leadRows.slice(0, 20).map((r, i) => (
                    <tr key={i} className="border-t" style={{ borderColor: "var(--color-border)" }}>
                      <td className="p-2">{i + 1}</td>
                      <td className="p-2">{r.name ?? "—"}</td>
                      <td className="p-2" dir="ltr">{r.phone ?? "—"}</td>
                      <td className="p-2" dir="ltr">{r.email ?? "—"}</td>
                      <td className="p-2">{LEAD_INTENT_LABELS[r.intent ?? ""] ?? "—"}</td>
                      <td className="p-2">{r.source ?? "—"}</td>
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
                      {/* "—" הוא חסר; כאן חסר הוא מצב תקין ולכן נאמר במפורש */}
                      <td className="p-2">
                        {r.budgetMaxAgorot === undefined ? (
                          <span style={{ color: "var(--color-text-muted)" }}>לא צוין</span>
                        ) : (
                          formatPrice(r.budgetMaxAgorot)
                        )}
                      </td>
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
        <Notice tone="danger">{error}</Notice>
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
          {result.warnings !== undefined && result.warnings.length > 0 ? (
            <>
              <p
                className="mt-2 mb-1"
                style={{ color: "var(--color-warning, #b45309)" }}
              >
                <IconWarning s={14} /> {result.warnings.length} שורות נקלטו עם הערה:
              </p>
              <ul className="list-inside list-disc text-sm">
                {result.warnings.map((w) => (
                  <li key={`${w.row}-${w.warning}`}>
                    שורה {w.row}: {w.warning}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <div className="mt-3">
            <Link href={MODE_BACK[mode]}>
              <Button variant="secondary">צפו ב{MODE_LABELS[mode]} שיובאו</Button>
            </Link>
          </div>
        </div>
      ) : null}
    </>
  );
}
