"use client";

import { useEffect, useState } from "react";
import { Button } from "@metavchim/ui";
import { apiDelete, apiGet, apiPut, ApiError } from "@/lib/api";

/**
 * נוסחי ההסכמים של המשרד — הזמנה בכתב והסכם בלעדיות.
 *
 * משרד שלא נוגע מקבל נוסח ברירת מחדל שמתמלא אוטומטית בפרטיו. משרד
 * שמדביק נוסח משלו מקבל אזהרה אם השמיט פרט חובה מתקנות המתווכים —
 * אזהרה ולא חסימה, כי לעורך הדין של המשרד יש מילה אחרונה על הנוסח.
 */

interface TemplateDto {
  kind: "brokerage" | "exclusivity";
  label: string;
  body: string;
  customized: boolean;
  missingRequired: string[];
  updatedAt?: string;
}

const PLACEHOLDER_HELP = [
  "{{שם_המשרד}}",
  "{{מספר_רישיון_תיווך}}",
  "{{שם_הלקוח}}",
  "{{תעודת_זהות_הלקוח}}",
  "{{תיאור_הנכס}}",
  "{{מחיר_משוער}}",
  "{{דמי_תיווך}}",
  "{{מועד_תשלום}}",
  "{{תקופת_בלעדיות}}",
];

export function AgreementTemplatesSection() {
  const [templates, setTemplates] = useState<TemplateDto[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load(): void {
    apiGet<TemplateDto[]>("/settings/agreement-templates")
      .then((rows) => {
        setTemplates(rows);
        setDrafts(Object.fromEntries(rows.map((row) => [row.kind, row.body])));
      })
      .catch(() => undefined);
  }

  useEffect(load, []);

  async function save(kind: string): Promise<void> {
    setBusy(kind);
    setMessage(null);
    setError(null);
    try {
      await apiPut(`/settings/agreement-templates/${kind}`, { body: drafts[kind] ?? "" });
      setMessage("✓ הנוסח נשמר");
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "השמירה נכשלה");
    } finally {
      setBusy(null);
    }
  }

  async function reset(kind: string): Promise<void> {
    if (!window.confirm("לשחזר את נוסח ברירת המחדל? הנוסח שהזנתם יימחק.")) return;
    setBusy(kind);
    setMessage(null);
    setError(null);
    try {
      await apiDelete(`/settings/agreement-templates/${kind}`);
      setMessage("✓ הנוסח שוחזר לברירת המחדל");
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "השחזור נכשל");
    } finally {
      setBusy(null);
    }
  }

  if (!templates) return null;

  return (
    <section aria-labelledby="agreements-heading" className="mv-list-card px-5 py-[17px]">
      <h2 id="agreements-heading" className="m-0 mb-1" style={{ fontSize: 15.5, fontWeight: 800 }}>
        נוסחי הסכמים
      </h2>
      <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
        הנוסחים נשלחים ללקוח לחתימה. מי שלא משנה דבר מקבל נוסח ברירת מחדל
        שמתמלא אוטומטית בפרטי המשרד ובפרטי הלקוח והנכס.
      </p>

      {message ? (
        <p
          role="status"
          className="mb-3 rounded-lg border p-3"
          style={{ borderColor: "var(--color-success)", background: "var(--color-surface)" }}
        >
          {message}
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="mb-3 rounded-lg border p-3"
          style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}
        >
          {error}
        </p>
      ) : null}

      {templates.map((template) => (
        <div
          key={template.kind}
          className="mb-4 rounded-xl border p-4"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">{template.label}</h3>
            <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>
              {template.customized ? "נוסח מותאם" : "נוסח ברירת מחדל"}
            </span>
          </div>

          {template.missingRequired.length > 0 ? (
            <p
              role="alert"
              className="mb-3 rounded-lg border p-3 text-sm"
              style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}
            >
              ⚠ בנוסח חסרים פרטים שתקנות המתווכים במקרקעין מחייבות בהזמנה
              בכתב: {template.missingRequired.map((f) => f.replace(/_/gu, " ")).join(", ")}.
              הזמנה שחסר בה פרט חובה עלולה לפגוע בזכות לדמי תיווך.
            </p>
          ) : null}

          <label htmlFor={`tpl-${template.kind}`} className="mb-1 block font-medium">
            נוסח ההסכם
          </label>
          <textarea
            id={`tpl-${template.kind}`}
            value={drafts[template.kind] ?? ""}
            onChange={(event) =>
              setDrafts((prev) => ({ ...prev, [template.kind]: event.target.value }))
            }
            rows={14}
            spellCheck={false}
            className="w-full rounded-lg border px-3 py-2.5 font-mono text-sm"
            style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
          />

          <details className="mt-2">
            <summary className="cursor-pointer text-sm" style={{ color: "var(--color-text-muted)" }}>
              שדות שהמערכת ממלאת אוטומטית
            </summary>
            <p className="mt-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
              כל שדה כזה מוחלף בערך האמיתי בעת שליחת ההסכם ללקוח:
            </p>
            <ul className="mt-1 flex flex-wrap gap-2">
              {PLACEHOLDER_HELP.map((name) => (
                <li key={name}>
                  <code
                    dir="ltr"
                    className="rounded px-1 text-sm"
                    style={{ background: "var(--color-bg)" }}
                  >
                    {name}
                  </code>
                </li>
              ))}
            </ul>
          </details>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={busy !== null || drafts[template.kind] === template.body}
              onClick={() => void save(template.kind)}
            >
              {busy === template.kind ? "שומר…" : "שמור נוסח"}
            </Button>
            {template.customized ? (
              <Button
                type="button"
                variant="secondary"
                disabled={busy !== null}
                onClick={() => void reset(template.kind)}
              >
                שחזר לברירת המחדל
              </Button>
            ) : null}
          </div>
        </div>
      ))}

      <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
        הנוסחים נבנו לפי פרטי החובה שבתקנות המתווכים במקרקעין (פרטי הזמנה
        בכתב), התשנ"ז-1997 — אך אינם ייעוץ משפטי. מומלץ שעורך דין יעבור על
        הנוסח לפני שימוש מסחרי.
      </p>
    </section>
  );
}
