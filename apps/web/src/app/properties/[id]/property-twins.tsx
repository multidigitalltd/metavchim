"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  MAX_TWINS_PER_PROPERTY,
  PAGE_LIMIT_MAX,
  propertyHeadline,
  twinBatchRejectionReason,
  TWIN_NOTE_MAX,
  type PropertyStatus,
} from "@metavchim/shared";
import { ApiError, API_BASE, apiDelete, apiGet, apiPost, apiList } from "@/lib/api";
import { formatPrice, PROPERTY_TYPE_LABELS, STATUS_LABELS } from "@/lib/format";
import { ConfirmDialog } from "../../confirm-dialog";
import { IconHome, IconPlus, IconSearch, IconX } from "../../icons";
import { LoadError } from "../../load-error";
import { Notice } from "../../notice";

/**
 * נכסים תואמים — „עוד כמה כאלה יש לי”.
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
  /*
   * הטיפוס מהחבילה, כדי שמפת התוויות תוכל להיות ממצה: סטטוס חדש
   * בסכמה ייפול בקומפילציה במקום להיות מוצג כמפתח באנגלית.
   */
  status: PropertyStatus;
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
  /*
   * הטיפוס מהחבילה, כדי שמפת התוויות תוכל להיות ממצה: סטטוס חדש
   * בסכמה ייפול בקומפילציה במקום להיות מוצג כמפתח באנגלית.
   */
  status: PropertyStatus;
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
  /** ‏מה שסומן בבורר — לפי סדר הלחיצה, כדי שדיווח הכישלון יהיה יציב */
  const [chosen, setChosen] = useState<string[]>([]);
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
       * אומרת „לא הגדרת נכסים תואמים” על סמך כשל רשת, וזו הצהרה שאין
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
    setChosen([]);
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
      setOptions(apiList(page.items, "items"));
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
   * לחיפוש. נכס שכבר סומן כתואם נשאר מוסתר ולא מוצג „מסומן” — רשימה
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

  /**
   * ‎**סימון כמה נכסים בבת אחת** (בקשת המשתמש).
   *
   * ‏מי שמסמן „עוד כמה כאלה” מתכוון לרוב ליותר מאחד, ופתיחת הבורר
   * ‏מחדש לכל נכס — עם החיפוש שמתאפס וההערה שנכתבת שוב — היא
   * ‏העבודה הידנית שהלשונית הזו נבנתה כדי לחסוך.
   *
   * ## ‏התקרה נבדקת לפני, לא תוך כדי
   *
   * ‎`twinBatchRejectionReason` שואל „האם יש מקום לכולם”. בלעדיו
   * ‏חמישה נבחרים כשיש מקום לשניים היו נשמרים חלקית, והמתווך היה
   * ‏מגלה זאת מהרשימה. אותה פונקציה של השרת, ולא כלל שני לצידה.
   *
   * ## ‏וכישלון חלקי נאמר, ולא נבלע
   *
   * ‏השרת בודק כל קשר בנפרד — גם לנכס **השני** יש תקרה משלו, והוא
   * ‏יכול לרדת לארכיון בין הטעינה לשמירה. „השמירה נכשלה” אחרי
   * ‏ששלושה מתוך חמישה נשמרו הוא שקר, ולכן מה שנשמר נספר ומה
   * ‏שנכשל נאמר בשמו. החלון נשאר פתוח כל עוד נשאר מה לתקן.
   */
  async function add(): Promise<void> {
    /*
     * הודעה ולא שתיקה. `ConfirmDialog` שאינו מקבל `onConfirm` מחליף
     * את כפתור האישור בכפתור **סגירה** שנושא את אותה תווית — כלומר
     * „סימון כנכס תואם” היה סוגר את החלון בלי לסמן דבר. כפתור שעושה
     * ההפך ממה שכתוב עליו גרוע מכפתור שאומר מה חסר.
     */
    if (chosen.length === 0) {
      setError("בחרו נכס מהרשימה כדי לסמן אותו כנכס תואם.");
      return;
    }
    const overLimit = twinBatchRejectionReason(twins?.length ?? 0, chosen.length);
    if (overLimit !== null) {
      setError(overLimit);
      return;
    }
    setBusy(true);
    setError(null);
    const failed: string[] = [];
    const saved: string[] = [];
    /*
     * ‏בזה אחר זה ולא במקביל: התקרה נבדקת בשרת בתוך טרנזקציה לכל
     * ‏בקשה, ושליחה מקבילה הייתה יכולה לעבור אותה יחד ולהיכשל על
     * ‏האחרון בלי סיבה שהמתווך יכול להבין.
     */
    for (const id of chosen) {
      try {
        await apiPost<TwinRow>(`/properties/${propertyId}/twins`, {
          twinId: id,
          ...(note.trim() !== "" ? { note: note.trim() } : {}),
        });
        saved.push(id);
      } catch (err: unknown) {
        const row = options?.find((option) => option.id === id);
        const label = row === undefined ? "נכס" : propertyHeadline(row);
        failed.push(
          `${label} — ${err instanceof ApiError ? err.message : "השמירה נכשלה"}`,
        );
      }
    }
    /*
     * טעינה מחדש ולא הוספה לרשימה בזיכרון: השרת הוא שקובע מה
     * מוצג (נכס שירד לארכיון בינתיים אינו מוצג), והוא גם מקור
     * המיון.
     */
    if (saved.length > 0) await load();
    setBusy(false);
    if (failed.length === 0) {
      setPickerOpen(false);
      return;
    }
    /*
     * ‎**מה שנשמר יורד מהבחירה — לפי הרשימה שנאספה כאן.**
     *
     * ‏לא לפי `linkedIds`: הוא נגזר מ-`twins` שנתפס בסגירה של
     * ‏הרינדור הזה, ולכן הוא עדיין הישן גם אחרי `load()`. הלחיצה
     * ‏הבאה על „סימון” הייתה מנסה לשמור שוב את מה שכבר נשמר.
     */
    setChosen((prev) => prev.filter((id) => !saved.includes(id)));
    setError(
      saved.length === 0
        ? failed.join(" · ")
        : `${saved.length} נשמרו. ${failed.length === 1 ? "אחד לא" : `${failed.length} לא`}: ${failed.join(" · ")}`,
    );
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
            נכסים תואמים
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
                ? `הגעתם ל-${MAX_TWINS_PER_PROPERTY} נכסים תואמים`
                : undefined
            }
            onClick={() => void openPicker()}
          >
            <IconPlus s={16} /> הוסף נכס תואם
          </button>
        ) : null}
      </div>

      {atLimit ? (
        <p
          className="m-0 mt-3 text-[length:var(--type-caption-lg)] font-semibold"
          style={{ color: "var(--color-text-muted)" }}
        >
          סימנתם {MAX_TWINS_PER_PROPERTY} נכסים תואמים — המקסימום. הסירו
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
          עדיין לא סימנתם נכסים תואמים לנכס הזה.
          {canEdit
            ? " לחצו „הוסף נכס תואם” ובחרו מהמאגר שלכם."
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
                        aria-label={`הסרת ${twin.headline} מהנכסים התואמים`}
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
        title="הוספת נכסים תואמים"
        /* ‏הכיתוב נוקב במספר — לחיצה על „סימון” לא תפתיע בכמה נשמרו */
        confirmLabel={
          chosen.length > 1 ? `סימון ${chosen.length} נכסים` : "סימון כנכס תואם"
        }
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
        <p
          className="m-0 mt-1 text-[length:var(--type-caption)]"
          style={{ color: "var(--color-text-muted)" }}
        >
          אפשר לסמן כמה נכסים — לחיצה נוספת על מסומן מבטלת אותו.
        </p>
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
              ? "אין במאגר נכס נוסף שאפשר לסמן כנכס תואם."
              : "לא נמצא נכס שתואם לחיפוש."}
          </p>
        ) : (
          <ul
            className="m-0 mt-3 max-h-64 list-none overflow-y-auto p-0"
            role="listbox"
            aria-multiselectable="true"
            aria-label="הנכסים שלכם"
          >
            {visible.map((row) => {
              const selected = chosen.includes(row.id);
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
                    onClick={() =>
                      setChosen((prev) =>
                        prev.includes(row.id)
                          ? prev.filter((id) => id !== row.id)
                          : [...prev, row.id],
                      )
                    }
                  >
                    {/* ‏הסימון נראה גם כשהצבע אינו מספיק — ובחירה מרובה חייבת אותו */}
                    <span aria-hidden="true" style={{ width: 14 }}>
                      {selected ? "✓" : ""}
                    </span>
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
          למה הם תואמים? <span className="font-normal">(רשות)</span>
        </label>
        {chosen.length > 1 ? (
          <p
            className="m-0 mt-1 text-[length:var(--type-caption)]"
            style={{ color: "var(--color-text-muted)" }}
          >
            {/* ‏אותה הערה נשמרת על כל אחד מהקשרים שנוצרים עכשיו */}
            ההערה תיכתב על כל {chosen.length} הקשרים.
          </p>
        ) : null}
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
        title="הסרת נכס תואם"
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
