"use client";

import { useEffect, useState } from "react";
import { Button } from "@metavchim/ui";
import {
  formatPlanPrice,
  planRejectionReason,
  yearlySavingPercent,
  type PlanDefinition,
} from "@metavchim/shared";
import { apiDelete, apiGet, apiPatch, ApiError } from "@/lib/api";
import { IconCard, IconWarning } from "../icons";

/**
 * הגדרת המסלולים — מה כלול בכל מסלול, כמה הוא עולה ומה המגבלות.
 *
 * עד כה זה היה כתוב בקוד: `@RequirePlan("agency", "enterprise")` על
 * מסך הדוחות, ורשימת מסלולים קבועה בטופס. כלומר פתיחת פיצ'ר למסלול
 * נמוך יותר דרשה שינוי קוד ועליית גרסה. כאן זה סימון תיבה.
 *
 * רשימת הפיצ'רים מגיעה מהשרת ולא נצרבת כאן: היא מה שהקוד באמת אוכף,
 * ומסך עם רשימה משלו היה מאפשר להבטיח פיצ'ר שאין לו אכיפה.
 */

interface FeatureInfo {
  code: string;
  label: string;
  description: string;
}

interface PlansPayload {
  plans: PlanDefinition[];
  features: FeatureInfo[];
  /** כמה משרדים יושבים על כל מסלול — לפני שמצמצמים אותו. */
  usage: Record<string, number>;
}

const inputStyle = { borderColor: "var(--color-border)", background: "var(--color-field)" } as const;

/** אגורות → שקלים לתצוגה בשדה, ובחזרה בשמירה. */
function toShekels(agorot: number | null): string {
  return agorot === null ? "" : String(agorot / 100);
}
function toAgorot(value: string): number | null {
  const clean = value.replace(/[,\s₪]/gu, "");
  if (clean === "") return null;
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}
/** שדה מגבלה ריק = ללא הגבלה, וזו הכוונה ולא חוסר מידע. */
function toLimit(value: string): number | null {
  const clean = value.trim();
  if (clean === "") return null;
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

/**
 * שדות הגדרת המסלול — משותפים לעריכה וליצירה.
 *
 * שני עותקים של הטופס היו נפרדים בפועל אחרי השינוי הראשון: שדה
 * שנוסף בעריכה ולא ביצירה נשמר כברירת מחדל בלי שאיש יבחין.
 */
function planEditor(
  draft: PlanDefinition,
  setDraft: (next: PlanDefinition) => void,
  features: FeatureInfo[],
  toggleFeature: (code: string) => void,
): React.JSX.Element {
  return (
    <div className="grid gap-2.5">
      <label className="text-xs font-semibold">
        שם המסלול
        <input
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          className="mt-1 w-full rounded-lg border px-2.5 py-2 text-sm font-normal"
          style={inputStyle}
        />
      </label>
      <label className="text-xs font-semibold">
        תיאור — מה המשרד מקבל
        <textarea
          value={draft.description}
          rows={2}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          className="mt-1 w-full rounded-lg border px-2.5 py-2 text-sm font-normal"
          style={inputStyle}
        />
      </label>
      <div className="grid gap-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <label className="text-xs font-semibold">
          ₪ לחודש
          <input
            value={toShekels(draft.monthlyPriceAgorot)}
            inputMode="decimal"
            onChange={(e) =>
              setDraft({ ...draft, monthlyPriceAgorot: toAgorot(e.target.value) ?? 0 })
            }
            className="mt-1 w-full rounded-lg border px-2.5 py-2 text-sm font-normal"
            style={inputStyle}
          />
        </label>
        <label className="text-xs font-semibold">
          ₪ לשנה (ריק = חודשי בלבד)
          <input
            value={toShekels(draft.yearlyPriceAgorot)}
            inputMode="decimal"
            onChange={(e) =>
              setDraft({ ...draft, yearlyPriceAgorot: toAgorot(e.target.value) })
            }
            className="mt-1 w-full rounded-lg border px-2.5 py-2 text-sm font-normal"
            style={inputStyle}
          />
        </label>
        <label className="text-xs font-semibold">
          מקסימום משתמשים (ריק = ללא הגבלה)
          <input
            value={draft.maxUsers === null ? "" : String(draft.maxUsers)}
            inputMode="numeric"
            onChange={(e) => setDraft({ ...draft, maxUsers: toLimit(e.target.value) })}
            className="mt-1 w-full rounded-lg border px-2.5 py-2 text-sm font-normal"
            style={inputStyle}
          />
        </label>
        <label className="text-xs font-semibold">
          מקסימום נכסים (ריק = ללא הגבלה)
          <input
            value={draft.maxProperties === null ? "" : String(draft.maxProperties)}
            inputMode="numeric"
            onChange={(e) =>
              setDraft({ ...draft, maxProperties: toLimit(e.target.value) })
            }
            className="mt-1 w-full rounded-lg border px-2.5 py-2 text-sm font-normal"
            style={inputStyle}
          />
        </label>
        <label className="text-xs font-semibold">
          ימי ניסיון
          <input
            value={String(draft.trialDays)}
            inputMode="numeric"
            onChange={(e) =>
              setDraft({ ...draft, trialDays: Number(e.target.value) || 0 })
            }
            className="mt-1 w-full rounded-lg border px-2.5 py-2 text-sm font-normal"
            style={inputStyle}
          />
        </label>
        <label className="text-xs font-semibold">
          סדר תצוגה
          <input
            value={String(draft.sortOrder)}
            inputMode="numeric"
            onChange={(e) =>
              setDraft({ ...draft, sortOrder: Number(e.target.value) || 0 })
            }
            className="mt-1 w-full rounded-lg border px-2.5 py-2 text-sm font-normal"
            style={inputStyle}
          />
        </label>
      </div>

      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-1 text-xs font-semibold">מה כלול</legend>
        {features.map((feature) => (
          <label key={feature.code} className="mb-1 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={draft.features.includes(
                feature.code as PlanDefinition["features"][number],
              )}
              onChange={() => toggleFeature(feature.code)}
            />
            <span>
              {feature.label}
              <span className="block text-xs" style={{ color: "var(--color-text-muted)" }}>
                {feature.description}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={draft.isPublic}
          onChange={(e) => setDraft({ ...draft, isPublic: e.target.checked })}
        />
        מוצג בדף ההרשמה הציבורי
      </label>
    </div>
  );
}

export function PlansSection({
  onCatalogChange,
}: {
  /**
   * הקטלוג השתנה — ההורה טוען מחדש את בוררי המסלול שלו.
   *
   * בלי זה, מסלול שנוצר עכשיו לא היה מופיע בטופס הקמת המשרד ובבורר
   * ההחלפה עד רענון מלא של הדף — כלומר בדיוק המקום שבו רוצים
   * להשתמש בו (ביקורת Codex).
   */
  onCatalogChange?: () => void;
}): React.JSX.Element {
  const [data, setData] = useState<PlansPayload | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<PlanDefinition | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  /*
   * קוד המסלול נערך רק ביצירה.
   *
   * הוא המפתח הראשי, והוא זה ששמור על כל משרד — שינוי שלו במסלול
   * קיים היה יוצר מסלול חדש ומשאיר את המשרדים מצביעים על קוד שנעלם,
   * כלומר בלי אף פיצ'ר.
   */
  const [creating, setCreating] = useState(false);

  function load(): void {
    apiGet<PlansPayload>("/platform/plans")
      .then(setData)
      .catch(() => setError("טעינת המסלולים נכשלה"));
  }

  useEffect(load, []);

  function startEdit(plan: PlanDefinition): void {
    setCreating(false);
    setEditing(plan.code);
    setDraft({ ...plan, features: [...plan.features] });
    setError(null);
    setSaved(null);
  }

  /**
   * מסלול חדש — הסיבה שהמסלולים הפכו לנתונים מלכתחילה.
   *
   * בלי זה המסך רק עורך את הארבעה שהגיעו עם המערכת, והוספת מסלול
   * עדיין דורשת קריאת API ידנית — כלומר בדיוק מה שהשינוי הזה בא
   * לבטל (ביקורת Codex).
   *
   * ברירות המחדל הן של מסלול צנוע ולא ריק: טופס שמתחיל באפסים מזמין
   * שמירה של מסלול שאי אפשר להשתמש בו.
   */
  function startCreate(): void {
    setEditing(null);
    setCreating(true);
    setError(null);
    setSaved(null);
    setDraft({
      code: "",
      name: "",
      description: "",
      monthlyPriceAgorot: 0,
      yearlyPriceAgorot: null,
      maxUsers: 5,
      maxProperties: 100,
      features: [],
      trialDays: 14,
      isPublic: false,
      sortOrder: (data?.plans.at(-1)?.sortOrder ?? 0) + 10,
    });
  }

  function toggleFeature(code: string): void {
    setDraft((prev) =>
      prev === null
        ? prev
        : {
            ...prev,
            features: prev.features.includes(code as PlanDefinition["features"][number])
              ? prev.features.filter((f) => f !== code)
              : [...prev.features, code as PlanDefinition["features"][number]],
          },
    );
  }

  async function save(): Promise<void> {
    if (draft === null) return;
    /*
     * אותה בדיקה שרצה בשרת, לפני הרשת.
     * לא במקומה — בשרת היא הקובעת — אלא כדי שטעות הקלדה תיעצר עם
     * ההודעה המדויקת במקום 400 כללי.
     */
    if (creating) {
      if (!/^[a-z0-9_]{2,20}$/u.test(draft.code)) {
        setError("קוד מסלול: אותיות לטיניות קטנות, ספרות וקו תחתון (2–20 תווים)");
        return;
      }
      if (data?.plans.some((plan) => plan.code === draft.code)) {
        setError("כבר קיים מסלול עם הקוד הזה");
        return;
      }
    }
    const reason = planRejectionReason(draft);
    if (reason !== null) {
      setError(reason);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { code, ...body } = draft;
      await apiPatch(`/platform/plans/${code}`, body);
      setSaved(code);
      setEditing(null);
      setCreating(false);
      setDraft(null);
      load();
      onCatalogChange?.();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "שמירת המסלול נכשלה");
    } finally {
      setBusy(false);
    }
  }

  /**
   * מחיקת מסלול — עם בחירת מסלול היעד למשרדים שיושבים עליו.
   *
   * היעד נבחר גם כשאין כרגע אף משרד: מסלול ריק היום יכול לקבל משרד
   * בין הלחיצה לאישור, והשרת דורש יעד ממילא. עדיף שאלה אחת מאשר
   * מחיקה שנכשלת אחרי שכבר החליטו.
   */
  async function removePlan(code: string, tenants: number) {
    const others = (data?.plans ?? []).filter((plan) => plan.code !== code);
    if (others.length === 0) return;
    const options = others.map((plan) => `${plan.code} (${plan.name})`).join("، ");
    const moveTo = window.prompt(
      `מחיקת המסלול "${code}".\n\n${
        tenants > 0
          ? `${tenants} משרדים יושבים עליו ויועברו למסלול שתבחרו.`
          : "אין כרגע משרדים על המסלול, אבל יש לבחור יעד להעברה."
      }\n\nהקלידו את קוד מסלול היעד:\n${options}`,
      others[0]?.code ?? "",
    );
    if (moveTo === null) return;
    setError(null);
    setBusy(true);
    try {
      await apiDelete(`/platform/plans/${code}`, { moveTo: moveTo.trim() });
      load();
      onCatalogChange?.();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "מחיקת המסלול נכשלה");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="plans-heading"
      className="mb-8 rounded-xl border p-4"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <h2 id="plans-heading" className="mb-1 text-lg font-semibold">
        <IconCard s={16} /> מסלולי מנוי
      </h2>
      <p className="mb-4 text-sm" style={{ color: "var(--color-text-muted)" }}>
        מה כלול בכל מסלול, כמה הוא עולה ומה המגבלות. השינוי נכנס לתוקף מיד לכל
        המשרדים שיושבים על המסלול.
      </p>

      {error ? (
        <p role="alert" className="mb-3 text-sm" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="mb-3 text-sm font-bold" style={{ color: "var(--color-primary)" }}>
          ✓ המסלול נשמר
        </p>
      ) : null}

      {data !== null && !creating ? (
        <button type="button" className="mv-btn-plain mb-3" onClick={startCreate}>
          + מסלול חדש
        </button>
      ) : null}

      {creating && draft !== null ? (
        <article
          className="mb-3 rounded-xl border p-3.5"
          style={{ borderColor: "var(--color-primary-accent)", background: "var(--color-bg)" }}
        >
          <h3 className="m-0 mb-2" style={{ fontSize: 15, fontWeight: 800 }}>
            מסלול חדש
          </h3>
          <label className="mb-2.5 block text-xs font-semibold">
            קוד מסלול (לטינית, קבוע — לא ניתן לשינוי אחר כך)
            <input
              value={draft.code}
              dir="ltr"
              placeholder="premium"
              onChange={(e) => setDraft({ ...draft, code: e.target.value.trim().toLowerCase() })}
              className="mt-1 w-full rounded-lg border px-2.5 py-2 text-sm font-normal"
              style={inputStyle}
            />
          </label>
          {planEditor(draft, setDraft, data?.features ?? [], toggleFeature)}
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Button onClick={() => void save()} disabled={busy}>
              {busy ? "שומר…" : "צור מסלול"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setCreating(false);
                setDraft(null);
                setError(null);
              }}
            >
              ביטול
            </Button>
          </div>
        </article>
      ) : null}

      {data === null ? (
        <p aria-live="polite">טוען…</p>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
          {data.plans.map((plan) => {
            const saving = yearlySavingPercent(plan);
            const tenants = data.usage[plan.code] ?? 0;
            const isEditing = editing === plan.code && draft !== null;
            return (
              <article
                key={plan.code}
                className="rounded-xl border p-3.5"
                style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
              >
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="m-0" style={{ fontSize: 15, fontWeight: 800 }}>
                    {isEditing ? draft.name : plan.name}{" "}
                    <span dir="ltr" className="font-mono text-xs" style={{ color: "var(--color-text-muted)" }}>
                      {plan.code}
                    </span>
                  </h3>
                  <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                    {tenants === 0 ? "אין משרדים" : `${tenants} משרדים`}
                  </span>
                </div>

                {!isEditing ? (
                  <>
                    <p className="m-0 mb-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                      {plan.description || "—"}
                    </p>
                    <p className="m-0 mb-2 text-sm">
                      <strong>{formatPlanPrice(plan.monthlyPriceAgorot)}</strong> לחודש
                      {plan.yearlyPriceAgorot !== null ? (
                        <>
                          {" · "}
                          {formatPlanPrice(plan.yearlyPriceAgorot)} לשנה
                          {saving !== null ? ` (חיסכון ${saving}%)` : ""}
                        </>
                      ) : null}
                    </p>
                    <p className="m-0 mb-2 text-sm">
                      {plan.maxUsers === null ? "משתמשים ללא הגבלה" : `עד ${plan.maxUsers} משתמשים`}
                      {" · "}
                      {plan.maxProperties === null
                        ? "נכסים ללא הגבלה"
                        : `עד ${plan.maxProperties} נכסים`}
                    </p>
                    <ul className="m-0 mb-2 list-none p-0 text-sm">
                      {data.features.map((feature) => {
                        const included = plan.features.includes(
                          feature.code as PlanDefinition["features"][number],
                        );
                        return (
                          <li
                            key={feature.code}
                            style={{ color: included ? undefined : "var(--color-text-muted)" }}
                          >
                            {included ? "✓" : "—"} {feature.label}
                          </li>
                        );
                      })}
                    </ul>
                    <p className="m-0 mb-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
                      {plan.trialDays > 0 ? `${plan.trialDays} ימי ניסיון` : "בלי תקופת ניסיון"}
                      {" · "}
                      {plan.isPublic ? "מוצג בדף ההרשמה" : "לא מוצג בדף ההרשמה"}
                    </p>
                    {/*
                      מסלול ציבורי בלי ימי ניסיון לא יופיע בהרשמה בפועל:
                      ההרשמה פותחת משרד בסטטוס ניסיון, והתפוגה היא מה
                      שמגביל אותו. בלי ימים לא היה תאריך תפוגה כלל.
                    */}
                    {plan.isPublic && plan.trialDays === 0 ? (
                      <p className="m-0 mb-2 text-xs" style={{ color: "#8a6414" }}>
                        <IconWarning s={15} /> בלי ימי ניסיון המסלול לא יופיע בדף ההרשמה. הוא עדיין ניתן
                        לרכישה ממסך המנוי של משרד קיים.
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      <Button variant="ghost" onClick={() => startEdit(plan)}>
                        ערוך
                      </Button>
                      {/*
                        המחיקה מוצגת רק כשיש לאן להעביר. מסלול אחרון
                        אינו נמחק — מערכת בלי אף מסלול אינה מצב תקין,
                        וגם השרת דוחה את זה.
                      */}
                      {data.plans.length > 1 ? (
                        <Button variant="ghost" onClick={() => void removePlan(plan.code, tenants)}>
                          <span style={{ color: "var(--color-danger)" }}>מחק</span>
                        </Button>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <div className="grid gap-2.5">
                    {planEditor(draft, setDraft, data.features, toggleFeature)}
                    {tenants > 0 ? (
                      <p className="m-0 text-xs" style={{ color: "var(--color-text-muted)" }}>
                        <IconWarning s={15} /> {tenants} משרדים יושבים על המסלול — צמצום פיצ׳רים או מגבלות ישפיע
                        עליהם מיד.
                      </p>
                    ) : null}

                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => void save()} disabled={busy}>
                        {busy ? "שומר…" : "שמור"}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setEditing(null);
                          setDraft(null);
                          setError(null);
                        }}
                      >
                        ביטול
                      </Button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
