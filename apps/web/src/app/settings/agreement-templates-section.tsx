"use client";

import { useEffect, useRef, useState } from "react";
import {
  PLACEHOLDER_GROUPS,
  PLACEHOLDER_LABELS,
  SAMPLE_AGREEMENT_VALUES,
  renderAgreement,
  type AgreementValues,
} from "@metavchim/shared";
import { Button } from "@metavchim/ui";
import { apiDelete, apiGet, apiPut, ApiError } from "@/lib/api";
import { IconEdit, IconEye, IconWarning } from "../icons";
import { Notice } from "../notice";

/**
 * עורך נוסחי ההסכמים של המשרד.
 *
 * מנהל משרד אינו מפתח. קודם הוא קיבל כאן תיבת טקסט במרווח קבוע,
 * תחביר `{{שם_הלקוח}}` שהיה צריך להקליד בעל פה, ורשימת שדות מקופלת
 * מתחת ל"פירוט" — ואת התוצאה ראה רק כשלקוח אמיתי כבר קיבל את המסמך.
 *
 * שלושה שינויים סוגרים את הפער:
 *   1. לחיצה על שם שדה מזריקה אותו במקום הסמן. התחביר נשאר בקוד.
 *   2. השדות מקובצים לפי *מקור הערך*, כי זו השאלה שנשאלת בפועל —
 *      "מאיפה זה מגיע ומה קורה אם ריק".
 *   3. תצוגה מקדימה עם ערכי דוגמה, כדי לראות את המסמך לפני הלקוח.
 *
 * האזהרה על פרט חובה חסר נשארת אזהרה ולא חסימה — לעורך הדין של
 * המשרד יש מילה אחרונה על הנוסח.
 */

interface TemplateDto {
  kind: "brokerage" | "exclusivity";
  label: string;
  body: string;
  customized: boolean;
  missingRequired: string[];
  updatedAt?: string;
}

/**
 * השדות שמופיעים בנוסח בפועל.
 *
 * אותה תבנית שמנוע הרינדור משתמש בה, כדי שהסימון במסך יסכים תמיד
 * עם מה שיקרה בשליחה.
 */
function usedPlaceholders(template: string): Set<string> {
  const found = new Set<string>();
  for (const match of template.matchAll(/\{\{\s*([\p{L}_]+)\s*\}\}/gu)) {
    if (match[1]) found.add(match[1]);
  }
  return found;
}

export function AgreementTemplatesSection() {
  const [templates, setTemplates] = useState<TemplateDto[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const editors = useRef<Record<string, HTMLTextAreaElement | null>>({});

  function load(): void {
    apiGet<TemplateDto[]>("/settings/agreement-templates")
      .then((rows) => {
        setTemplates(rows);
        setDrafts(Object.fromEntries(rows.map((row) => [row.kind, row.body])));
      })
      .catch(() => undefined);
  }

  useEffect(load, []);

  /**
   * הזרקת שדה במקום הסמן.
   *
   * `setRangeText` ולא הרכבת מחרוזת ידנית: הוא משאיר את פעולת הביטול
   * של הדפדפן שלמה, כך ש-Ctrl+Z אחרי הזרקה מתנהג כמצופה.
   */
  function insert(kind: string, name: keyof AgreementValues): void {
    const editor = editors.current[kind];
    if (!editor) return;
    editor.focus();
    editor.setRangeText(`{{${name}}}`, editor.selectionStart, editor.selectionEnd, "end");
    setDrafts((prev) => ({ ...prev, [kind]: editor.value }));
  }

  async function save(kind: string): Promise<void> {
    setBusy(kind);
    setMessage(null);
    setError(null);
    try {
      await apiPut(`/settings/agreement-templates/${kind}`, { body: drafts[kind] ?? "" });
      setMessage("✓ הנוסח נשמר");
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "שמירת הנוסח נכשלה");
    } finally {
      setBusy(null);
    }
  }

  async function reset(kind: string): Promise<void> {
    // אישור לפני מחיקה: הכפתור יושב ליד "שמור נוסח", והפעולה מוחקת
    // לצמיתות נוסח שהמשרד ניסח — כולל טיוטה שטרם נשמרה
    if (!window.confirm("לשחזר את נוסח ברירת המחדל? הנוסח שהזנתם יימחק.")) return;
    setBusy(kind);
    setMessage(null);
    setError(null);
    try {
      await apiDelete(`/settings/agreement-templates/${kind}`);
      setMessage("✓ הנוסח הוחזר לברירת המחדל");
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "השחזור נכשל");
    } finally {
      setBusy(null);
    }
  }

  if (!templates) return null;

  return (
    <section className="mv-list-card px-5 py-[17px]" aria-labelledby="agreements-heading">
      <h2 id="agreements-heading" className="m-0 mb-1" style={{ fontSize: "calc(16.5 / 16 * 1rem)", fontWeight: 800 }}>
        נוסחי הסכמים לחתימה
      </h2>
      <p className="m-0 mb-3 text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-muted)" }}>
        הנוסח שהלקוח יראה ויחתום עליו. אפשר להשאיר את ברירת המחדל, או לערוך —
        לחיצה על שם שדה מוסיפה אותו בתוך הטקסט, ואין צורך להקליד קודים.
      </p>

      {message ? (
        <Notice tone="success">{message}</Notice>
      ) : null}
      {error ? (
        <Notice tone="danger">{error}</Notice>
      ) : null}

      {templates.map((template) => {
        const draft = drafts[template.kind] ?? "";
        const preview = renderAgreement(draft, SAMPLE_AGREEMENT_VALUES);
        // פעם אחת לכל נוסח, ולא פעם לכל שדה
        const used = usedPlaceholders(draft);
        return (
          <div
            key={template.kind}
            className="mb-4 rounded-xl border p-4"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          >
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="m-0 font-semibold">{template.label}</h3>
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
                <IconWarning s={15} /> בנוסח חסרים פרטים שתקנות המתווכים במקרקעין מחייבות בהזמנה בכתב:{" "}
                {template.missingRequired
                  .map((f) => PLACEHOLDER_LABELS[f as keyof AgreementValues] ?? f.replace(/_/gu, " "))
                  .join(", ")}
                . הזמנה שחסר בה פרט חובה עלולה לפגוע בזכות לדמי תיווך — הוסיפו אותם
                מרשימת השדות שלמטה.
              </p>
            ) : null}

            <div className="mb-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                className="mv-btn-plain"
                aria-pressed={previewing === template.kind}
                onClick={() =>
                  setPreviewing(previewing === template.kind ? null : template.kind)
                }
              >
                {previewing === template.kind ? (
                  <><IconEdit s={15} /> חזרה לעריכה</>
                ) : (
                  <><IconEye s={15} /> תצוגה מקדימה</>
                )}
              </button>
            </div>

            {previewing === template.kind ? (
              <>
                <div
                  className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-[13px] border p-4 text-sm"
                  style={{
                    background: "var(--color-field)",
                    borderColor: "var(--color-border)",
                    lineHeight: 1.7,
                  }}
                >
                  {preview.text}
                </div>
                <p className="m-0 mt-2 text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
                  הפרטים כאן בדויים להמחשה. בשליחה אמיתית הם מוחלפים בפרטי המשרד,
                  הלקוח והנכס.
                </p>
              </>
            ) : (
              <>
                <label htmlFor={`tpl-${template.kind}`} className="mb-1 block font-medium">
                  נוסח ההסכם
                </label>
                <textarea
                  id={`tpl-${template.kind}`}
                  ref={(el) => {
                    editors.current[template.kind] = el;
                  }}
                  value={draft}
                  onChange={(event) =>
                    setDrafts((prev) => ({ ...prev, [template.kind]: event.target.value }))
                  }
                  rows={14}
                  spellCheck={false}
                  className="w-full rounded-lg border px-3 py-2.5 text-sm"
                  style={{
                    borderColor: "var(--color-input-border)",
                    background: "var(--color-bg)",
                    lineHeight: 1.7,
                  }}
                />

                <p className="m-0 mb-1 mt-3 text-[length:var(--type-caption-lg)] font-bold">
                  הוספת פרט למסמך — לחצו במקום הרצוי בטקסט ואז על השדה
                </p>
                {PLACEHOLDER_GROUPS.map((group) => (
                  <div key={group.label} className="mt-2">
                    <p className="m-0 text-sm" style={{ color: "var(--color-text-muted)" }}>
                      <strong>{group.label}</strong> · {group.source}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {group.names.map((name) => {
                        const inUse = used.has(name);
                        return (
                          <button
                            key={name}
                            type="button"
                            className="mv-chip"
                            onClick={() => insert(template.kind, name)}
                            title={
                              inUse
                                ? `${PLACEHOLDER_LABELS[name]} — כבר מופיע בנוסח`
                                : `הוספת ${PLACEHOLDER_LABELS[name]} במקום הסמן`
                            }
                          >
                            {inUse ? "✓ " : "+ "}
                            {PLACEHOLDER_LABELS[name]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={busy !== null || draft === template.body}
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
        );
      })}

      <p className="m-0 text-sm" style={{ color: "var(--color-text-muted)" }}>
        הנוסחים נבנו לפי פרטי החובה שבתקנות המתווכים במקרקעין (פרטי הזמנה בכתב),
        התשנ״ז-1997 — אך אינם ייעוץ משפטי. מומלץ שעורך דין יעבור על הנוסח לפני
        שימוש מסחרי.
      </p>
    </section>
  );
}
