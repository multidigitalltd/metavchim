"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  MAX_TWINS_PER_PROPERTY,
  PAGE_LIMIT_MAX,
  propertyHeadline,
  TWIN_NOTE_MAX,
} from "@metavchim/shared";
import { ApiError, API_BASE, apiDelete, apiGet, apiPost } from "@/lib/api";
import { formatPrice, PROPERTY_TYPE_LABELS, STATUS_LABELS } from "@/lib/format";
import { ConfirmDialog } from "../../confirm-dialog";
import { IconHome, IconPlus, IconSearch, IconX } from "../../icons";
import { LoadError } from "../../load-error";
import { Notice } from "../../notice";

/**
 * נכסים תאומים — „עוד כמה כאלה יש לי”.
 *
 * ## מתי זה נקרא
 *
 * לקוח על הקו, מתעניין בדירה אחת. המתווך יודע שיש לו עוד שתיים
 * באותו סגנון, אבל בזמן השיחה הוא צריך להיזכר בהן — ולעיתים קרובות
 * לא נזכר. הקישור מוגדר מראש, ברגע רגוע, ומופיע כאן כשהוא על הקו.
 *
 * ## למה כל כרטיס מראה מחיר, חדרים וקומה
 *
 * זה לא אינדקס אלא **דף הצעה בשיחה**. שם הרחוב לבדו מחייב לפתוח
 * כרטיס נוסף בזמן שהלקוח מחכה, וזה בדיוק מה שהלשונית באה לחסוך.
 *
 * ## למה הקשר מופיע גם בכרטיס השני
 *
 * הצהרה ש„שתי הדירות מתאימות לאותו לקוח” נכונה לשני הכיוונים. מי
 * שהגדיר מכאן אינו מצפה להגדיר שוב בכרטיס השני, ומי שייכנס לשם
 * ולא ימצא את הקשר יסיק שהמערכת שכחה.
 */

export interface TwinRow {
  id: string;
  headline: string;
  propertyType?: string;
  dealType?: string;
  rooms?: number;
  areaSqm?: number;
  floor?: number;
  priceAgorot?: number;
  status: string;
  marketingTitle?: string;
  thumbnailUrl?: string;
  note?: string;
  linkedAt: string;
}

/** נכס בבורר — מה שנדרש כדי לזהות אותו ולסנן אותו. */
interface PickerRow {
  id: string;
  city?: string;
  neighborhood?: string;
  street?: string;
  houseNumber?: string;
  rooms?: number;
  priceAgorot?: number;
  status: string;
  thumbnailUrl?: string;
}

/**
 * כמה נכסים נטענים לבורר. הרשימה מסוננת בדפדפן — ראו `visible`.
 *
 * 100 הוא **התקרה ש-`/properties` מקבל**, לא מספר שנבחר לנוחות.
 * הערך הקודם היה 200, והסכימה שם היא `.strict()` עם `max(100)` —
 * כלומר כל פתיחה של הבורר נדחתה בשער ולא הגיעה לשירות בכלל, והבורר
 * מעולם לא הציג נכס אחד. `PAGE_LIMIT_MAX` הוא מקור האמת, כדי
 * שהשניים לא יוכלו להיפרד שוב.
 */
const PICKER_LIMIT = PAGE_LIMIT_MAX;

function Thumb({ url, size }: { url?: string | undefined; size: number }) {
  const style = { width: size, height: size } as const;
  if (url !== undefined && url !== "") {
    // img רגיל בכוונה: מוזרם דרך ה-API, לא לאופטימיזציית Next
    return (
      <img
        src={API_BASE + url}
        alt=""
        className="shrink-0 rounded-lg object-cover"
        style={style}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-lg"
      style={{
        ...style,
        background: "var(--color-field)",
        color: "var(--color-text-muted)",
      }}
    >
      <IconHome s={Math.round(size / 2.6)} />
    </span>
  );
}

/** שורת הפרטים מתחת לכותרת — רק מה שיש. */
function detailLine(twin: TwinRow): string {
  return [
    twin.propertyType !== undefined
      ? (PROPERTY_TYPE_LABELS[twin.propertyType] ?? twin.propertyType)
      : undefined,
    twin.areaSqm !== undefined ? `${twin.areaSqm} מ״ר` : undefined,
    twin.floor !== undefined ? `קומה ${twin.floor}` : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join(" · ");
}

export function PropertyTwins({
  propertyId,
  canEdit,
  onCountChange,
}: {
  propertyId: string;
  canEdit: boolean;
  /** המונה שעל הלשונית — הכרטיס מציג אותו לצד התווית. */
  onCountChange?: (count: number) => void;
}) {
  const [twins, setTwins] = useState<TwinRow[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [options, setOptions] = useState<PickerRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<TwinRow | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const rows = await apiGet<TwinRow[]>(`/properties/${propertyId}/twins`);
      setTwins(rows);
      setLoadFailed(false);
    } catch {
      /*
       * `twins` נשאר `null` — „לא ידוע”. רשימה ריקה כאן הייתה
       * אומרת „לא הגדרת תאומים” על סמך כשל רשת, וזו הצהרה שאין
       * לנו עליה מידע.
       */
      setLoadFailed(true);
    }
  }, [propertyId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (twins !== null) onCountChange?.(twins.length);
  }, [twins, onCountChange]);

  /** נטען פעם אחת בפתיחת הבורר — לא בכל הקלדה. הסינון בדפדפן. */
  const openPicker = useCallback(async (): Promise<void> => {
    setPickerOpen(true);
    setQuery("");
    setChosen(null);
    setNote("");
    setError(null);
    /*
     * טעינה שנכשלה נשארת ניתנת לניסיון חוזר.
     *
     * הגרסה הקודמת כתבה `[]` לתוך `options` בכשל, ומכיוון שהפתיחה
     * מדלגת על הטעינה כש-`options` אינו `null`, סגירה ופתיחה מחדש
     * כבר לא ניסו שוב — הרשימה נשארה ריקה עד רענון העמוד, מתחת
     * להודעה שאומרת „נסו שוב”. `null` הוא „לא ידוע”, וכשל משאיר
     * אותו „לא ידוע”.
     */
    if (options !== null) return;
    try {
      const page = await apiGet<{ items: PickerRow[] }>(
        `/properties?limit=${PICKER_LIMIT}`,
      );
      setOptions(page.items);
    } catch {
      setError("לא הצלחנו לטעון את רשימת הנכסים — סגרו ופתחו שוב.");
    }
  }, [options]);

  const linkedIds = useMemo(
    () => new Set((twins ?? []).map((twin) => twin.id)),
    [twins],
  );

  /**
   * מה שמוצג בבורר: לא הנכס עצמו, לא מי שכבר מסומן, ורק מה שתואם
   * לחיפוש. נכס שכבר תאום נשאר מוסתר ולא מוצג „מסומן” — רשימה
   * שמציגה שורות שאי אפשר לבחור בהן מבזבזת את זמן הסריקה.
   */
  const visible = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/u).filter(Boolean);
    return (options ?? [])
      .filter((row) => row.id !== propertyId && !linkedIds.has(row.id))
      .filter((row) => {
        if (terms.length === 0) return true;
        const haystack = [row.street, row.neighborhood, row.city]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return terms.every((term) => haystack.includes(term));
      });
  }, [options, query, propertyId, linkedIds]);

  async function add(): Promise<void> {
    /*
     * הודעה ולא שתיקה. `ConfirmDialog` שאינו מקבל `onConfirm` מחליף
     * את כפתור האישור בכפתור **סגירה** שנושא את אותה תווית — כלומר
     * „סימון כתאום” היה סוגר את החלון בלי לסמן דבר. כפתור שעושה
     * ההפך ממה שכתוב עליו גרוע מכפתור שאומר מה חסר.
     */
    if (chosen === null) {
      setError("בחרו נכס מהרשימה כדי לסמן אותו כתאום.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiPost<TwinRow>(`/properties/${propertyId}/twins`, {
        twinId: chosen,
        ...(note.trim() !== "" ? { note: note.trim() } : {}),
      });
      /*
       * טעינה מחדש ולא הוספה לרשימה בזיכרון: השרת הוא שקובע מה
       * מוצג (נכס שירד לארכיון בינתיים אינו מוצג), והוא גם מקור
       * המיון.
       */
      await load();
      setPickerOpen(false);
    } catch (err: unknown) {
      setError(
        err instanceof ApiError ? err.message : "השמירה נכשלה — נסו שוב.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(twin: TwinRow): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await apiDelete(`/properties/${propertyId}/twins/${twin.id}`);
      await load();
      setRemoving(null);
    } catch (err: unknown) {
      setError(
        err instanceof ApiError ? err.message : "ההסרה נכשלה — נסו שוב.",
      );
    } finally {
      setBusy(false);
    }
  }

  const atLimit = (twins?.length ?? 0) >= MAX_TWINS_PER_PROPERTY;

  return (
    <section className="mv-list-card px-[22px] py-[18px]" aria-labelledby="twins-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            id="twins-heading"
            className="m-0"
            style={{ fontSize: "calc(16.5 / 16 * 1rem)", fontWeight: 800 }}
          >
            נכסים תאומים
          </h2>
          <p
            className="m-0 mt-1 text-[length:var(--type-caption-lg)] leading-relaxed"
            style={{ color: "var(--color-text-muted)" }}
          >
            נכסים מהמאגר שלכם שמתאימים לאותו סוג לקוח. בשיחה על הנכס
            הזה תוכלו להציע אותם מיד, בלי לחפש.
          </p>
        </div>
        {canEdit ? (
          <button
            type="button"
            className="mv-btn-action"
            disabled={atLimit}
            title={
              atLimit
                ? `הגעתם ל-${MAX_TWINS_PER_PROPERTY} נכסים תאומים`
                : undefined
            }
            onClick={() => void openPicker()}
          >
            <IconPlus s={16} /> הוסף נכס תאום
          </button>
        ) : null}
      </div>

      {atLimit ? (
        <p
          className="m-0 mt-3 text-[length:var(--type-caption-lg)] font-semibold"
          style={{ color: "var(--color-text-muted)" }}
        >
          סימנתם {MAX_TWINS_PER_PROPERTY} נכסים תאומים — המקסימום. הסירו
          אחד כדי להוסיף אחר.
        </p>
      ) : null}

      {/*
        רק כששני החלונות סגורים. `dialog` מודאלי יושב מעל העמוד, ולכן
        הודעת שגיאה שנשארת כאן בזמן שחלון פתוח היא הודעה שאיש לא רואה
        — והמשתמש נשאר עם „לא קרה כלום” במקום עם הסיבה.
      */}
      {error !== null && !pickerOpen && removing === null ? (
        <Notice tone="danger" onClose={() => setError(null)}>
          {error}
        </Notice>
      ) : null}

      {loadFailed ? (
        <LoadError onRetry={() => void load()} />
      ) : twins === null ? (
        <p className="mt-4" style={{ color: "var(--color-text-muted)" }}>
          טוען…
        </p>
      ) : twins.length === 0 ? (
        <p
          className="m-0 mt-4 rounded-xl border p-4 text-[length:var(--type-body-sm)]"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-field)",
            color: "var(--color-text-muted)",
          }}
        >
          עדיין לא סימנתם נכסים תאומים לנכס הזה.
          {canEdit
            ? " לחצו „הוסף נכס תאום” ובחרו מהמאגר שלכם."
            : ""}
        </p>
      ) : (
        <ul className="m-0 mt-4 grid list-none gap-3 p-0 md:[grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
          {twins.map((twin) => (
            <li
              key={twin.id}
              className="rounded-xl border p-3"
              style={{
                borderColor: "var(--color-border)",
                background: "var(--color-surface)",
              }}
            >
              <div className="flex gap-3">
                <Thumb url={twin.thumbnailUrl} size={72} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-2">
                    <Link
                      href={`/properties/${twin.id}`}
                      className="grow font-bold underline"
                    >
                      {twin.headline}
                    </Link>
                    {canEdit ? (
                      <button
                        type="button"
                        className="mv-btn-plain"
                        aria-label={`הסרת ${twin.headline} מהנכסים התאומים`}
                        onClick={() => setRemoving(twin)}
                      >
                        <IconX s={14} />
                      </button>
                    ) : null}
                  </div>
                  <p
                    className="m-0 mt-1 text-[length:var(--type-caption)]"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    {detailLine(twin) || "אין פרטים נוספים"}
                  </p>
                  <p className="m-0 mt-1 text-[length:var(--type-body-sm)] font-bold">
                    {twin.priceAgorot !== undefined
                      ? formatPrice(twin.priceAgorot)
                      : "מחיר לא צוין"}
                    <span
                      className="mv-tag ms-2"
                      style={{
                        background: "var(--color-field)",
                        color: "var(--color-text-muted)",
                      }}
                    >
                      {STATUS_LABELS[twin.status] ?? twin.status}
                    </span>
                  </p>
                  {twin.note !== undefined ? (
                    <p
                      className="m-0 mt-1.5 text-[length:var(--type-caption)] leading-relaxed"
                      style={{ color: "var(--color-text-soft)" }}
                    >
                      {twin.note}
                    </p>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* ------------------------------------------------------------
          הבורר — מתוך הנכסים של המשרד
          ------------------------------------------------------------ */}
      <ConfirmDialog
        open={pickerOpen}
        title="הוספת נכס תאום"
        confirmLabel="סימון כתאום"
        busy={busy}
        onConfirm={() => void add()}
        onClose={() => {
          setPickerOpen(false);
          setError(null);
        }}
      >
        <label htmlFor="twin-search" className="block text-[length:var(--type-caption-lg)] font-semibold">
          חיפוש בנכסים שלכם
        </label>
        <div className="mt-1 flex items-center gap-2">
          <IconSearch s={16} />
          <input
            id="twin-search"
            className="mv-field grow"
            value={query}
            placeholder="רחוב, שכונה או עיר"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {options === null ? (
          <p className="mt-3" style={{ color: "var(--color-text-muted)" }}>
            {/* הכשל עצמו מוצג בהודעת השגיאה; כאן לא טוענים שהרשימה ריקה */}
            {error === null ? "טוען את הנכסים…" : "הרשימה לא נטענה."}
          </p>
        ) : visible.length === 0 ? (
          <p
            className="m-0 mt-3 text-[length:var(--type-caption-lg)]"
            style={{ color: "var(--color-text-muted)" }}
          >
            {/*
              שתי סיבות שונות לרשימה ריקה, ואסור לערבב ביניהן: „אין
              עוד נכסים” ו„החיפוש לא מצא” מובילים לפעולות שונות.
            */}
            {query.trim() === ""
              ? "אין במאגר נכס נוסף שאפשר לסמן כתאום."
              : "לא נמצא נכס שתואם לחיפוש."}
          </p>
        ) : (
          <ul
            className="m-0 mt-3 max-h-64 list-none overflow-y-auto p-0"
            role="listbox"
            aria-label="הנכסים שלכם"
          >
            {visible.map((row) => {
              const selected = chosen === row.id;
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className="flex w-full items-center gap-3 rounded-lg border p-2 text-start"
                    style={{
                      marginBottom: 6,
                      borderColor: selected
                        ? "var(--color-primary)"
                        : "var(--color-input-border)",
                      background: selected
                        ? "var(--color-primary-soft)"
                        : "var(--color-surface)",
                    }}
                    onClick={() => setChosen(row.id)}
                  >
                    <Thumb url={row.thumbnailUrl} size={44} />
                    <span className="min-w-0 grow">
                      <span className="block truncate font-semibold">
                        {propertyHeadline({
                          street: row.street,
                          houseNumber: row.houseNumber,
                          neighborhood: row.neighborhood,
                          city: row.city,
                          rooms: row.rooms,
                        })}
                      </span>
                      <span
                        className="block text-[length:var(--type-caption)]"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        {row.priceAgorot !== undefined
                          ? formatPrice(row.priceAgorot)
                          : "מחיר לא צוין"}{" "}
                        · {STATUS_LABELS[row.status] ?? row.status}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <label
          htmlFor="twin-note"
          className="mt-3 block text-[length:var(--type-caption-lg)] font-semibold"
        >
          למה הם תאומים? <span className="font-normal">(רשות)</span>
        </label>
        <input
          id="twin-note"
          className="mv-field mt-1 w-full"
          value={note}
          maxLength={TWIN_NOTE_MAX}
          placeholder="למשל: אותו בניין, קומה גבוהה יותר"
          onChange={(e) => setNote(e.target.value)}
        />

        {error !== null ? <Notice tone="danger">{error}</Notice> : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={removing !== null}
        title="הסרת נכס תאום"
        tone="danger"
        confirmLabel="הסרה"
        busy={busy}
        onConfirm={
          removing === null ? undefined : () => void remove(removing)
        }
        onClose={() => setRemoving(null)}
      >
        <p className="m-0">
          הקישור בין הנכסים יוסר — גם מהכרטיס של{" "}
          <b>{removing?.headline}</b>. הנכסים עצמם אינם משתנים.
        </p>
        {error !== null ? <Notice tone="danger">{error}</Notice> : null}
      </ConfirmDialog>
    </section>
  );
}
