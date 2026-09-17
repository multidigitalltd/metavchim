"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatIsraeliNumber } from "@metavchim/shared";
import { PROPERTY_TYPE_LABELS } from "@/lib/format";
import { ApiError, apiGet, apiList, apiPost } from "@/lib/api";
import { ConfirmDialog } from "../confirm-dialog";
import { IconSearch } from "../icons";
import { textMatches } from "../list-controls";
import { Notice } from "../notice";

/**
 * ‎**„העלה לרשת” — מתוך אזור הרשת, ולא רק מרשימת הכרטיסים.**
 *
 * ## למה זה נולד
 *
 * ‏הפרסום לרשת היה קיים בשני מקומות בלבד: כרטיס בודד (אזור
 * ‏„שיתוף פעולה”), ופעולה מרוכזת על שורות שסומנו ברשימת הקונים או
 * ‏הנכסים. שניהם דורשים לצאת מאזור הרשת, למצוא את הכרטיסים, לסמן,
 * ‏ולחזור — בזמן שהשאלה „מה יש לי להעלות” נשאלת **כשמסתכלים על
 * ‏הרשת** (בקשת המשתמש).
 *
 * ‏עכשיו יש כפתור בראש כל כיוון, והוא פותח את הרשימה כאן: חיפוש
 * ‏חופשי, סימון של כמה שרוצים, והעלאה אחת.
 *
 * ## למה רכיב אחד לשני הכיוונים
 *
 * ‏קונה ונכס הם אותה פעולה בדיוק מול אותה נקודת קצה מרוכזת, ורק
 * ‏אוצר המילים שונה. שני קבצים כמעט זהים היו נפרדים בעדכון הראשון
 * ‏— אותו נימוק שכבר תועד ב-`NetworkShareSection`.
 *
 * ## מה **לא** קורה כאן
 *
 * ‏אין כאן תיאור ואין עריכת עמלה. ההעלאה המרוכזת מפרסמת בברירת
 * ‏המחדל (50/50, והתיאור נלקח מהכרטיס) — בדיוק כמו הפעולה המרוכזת
 * ‏שכבר קיימת ברשימות, ומאותה נקודת קצה. מי שרוצה לנסח תנאים
 * ‏לכרטיס מסוים עושה זאת בכרטיס עצמו, ושם זה גם נראה נכון.
 */

/** ‏מה שהרשימה צריכה מכל שורה — המשותף לשני הכיוונים. */
interface PickRow {
  id: string;
  title: string;
  subtitle: string;
  /**
   * ‏מה שמחפשים בו מעבר למה שמוצג — הטלפון של הקונה.
   *
   * ‏הוא אינו בשורה (הרשימה הזו מפרסמת לרשת, ומספר טלפון על המסך
   * ‏הוא PII שאין בו צורך), אבל מתווך מחפש לפי מה שיש לו ביד —
   * ‏ולרוב זה המספר.
   */
  search?: string;
}

interface BuyerRow {
  id: string;
  contact: { name: string; phone?: string };
  requirements: { cities: string[]; budgetMaxAgorot?: number; roomsMin?: number };
}

interface PropertyRow {
  id: string;
  propertyType?: string;
  city?: string;
  neighborhood?: string;
  street?: string;
  rooms?: number;
  priceAgorot?: number;
}

const COPY = {
  buyer: {
    open: "העלה קונה לרשת",
    title: "העלאת קונים לרשת",
    search: "חיפוש קונה — שם, עיר או טלפון",
    empty: "לא נמצאו קונים",
    hint: "הקונים שייבחרו יפורסמו כביקוש אנונימי: בלי שם, בלי טלפון ועם תקציב מעוגל, בחלוקת עמלה 50/50.",
    confirm: (n: number) => `להעלות ${n === 1 ? "קונה אחד" : `${n} קונים`} לרשת`,
    done: (n: number) => `${n === 1 ? "קונה אחד פורסם" : `${n} קונים פורסמו`} לרשת`,
    path: "/collaboration/share/bulk",
    body: (ids: string[]) => ({ buyerIds: ids }),
    list: "/buyers",
  },
  property: {
    open: "העלה נכס לרשת",
    title: "העלאת נכסים לרשת",
    search: "חיפוש נכס — כתובת, עיר או סוג",
    empty: "לא נמצאו נכסים",
    hint: "הנכסים שייבחרו יפורסמו בלי כתובת מדויקת ובלי פרטי בעלים, בחלוקת עמלה 50/50.",
    confirm: (n: number) => `להעלות ${n === 1 ? "נכס אחד" : `${n} נכסים`} לרשת`,
    done: (n: number) => `${n === 1 ? "נכס אחד פורסם" : `${n} נכסים פורסמו`} לרשת`,
    path: "/collaboration/listings/bulk",
    body: (ids: string[]) => ({ propertyIds: ids }),
    list: "/properties",
  },
} as const;

/**
 * ‏תקרת הטעינה — אותה מאה של שאר הרשימות.
 *
 * ‏מעבר לזה החיפוש הוא התשובה, ולכן הוא רץ **בשרת**: סינון בדפדפן
 * ‏על מאה שורות היה מוצא רק בתוך המאה שנטענה, כלומר „לא נמצא” על
 * ‏קונה שקיים.
 */
const LIMIT = 100;

const shekels = (agorot: number): string => formatIsraeliNumber(Math.round(agorot / 100));

function buyerRow(row: BuyerRow): PickRow {
  const parts = [
    row.requirements.cities.length > 0 ? row.requirements.cities.join(", ") : null,
    row.requirements.roomsMin === undefined ? null : `מ-${row.requirements.roomsMin} חדרים`,
    row.requirements.budgetMaxAgorot === undefined
      ? null
      : `עד ${shekels(row.requirements.budgetMaxAgorot)} ₪`,
  ].filter((part): part is string => part !== null);
  return {
    id: row.id,
    title: row.contact.name,
    subtitle: parts.join(" · "),
    ...(row.contact.phone === undefined ? {} : { search: row.contact.phone }),
  };
}

function propertyRow(row: PropertyRow): PickRow {
  const where = [row.street, row.neighborhood, row.city]
    .filter((part): part is string => typeof part === "string" && part !== "")
    .join(", ");
  /*
   * ‏סוג הנכס נשמר באנגלית (`apartment`) והמסך מבטיח חיפוש בעברית
   * ‏— אותו תרגום בדיוק שכבר יושב בסינון הנכסים בשרת. בלעדיו
   * ‏„דירה” לא היה מוצא דירה.
   */
  const typeLabel =
    row.propertyType === undefined ? null : (PROPERTY_TYPE_LABELS[row.propertyType] ?? null);
  const parts = [
    typeLabel,
    row.rooms === undefined ? null : `${formatIsraeliNumber(row.rooms)} חדרים`,
    row.priceAgorot === undefined ? null : `${shekels(row.priceAgorot)} ₪`,
  ].filter((part): part is string => part !== null);
  return {
    id: row.id,
    title: where === "" ? "נכס ללא כתובת" : where,
    subtitle: parts.join(" · "),
  };
}

export function PublishToNetworkDialog({
  kind,
  open,
  onClose,
  onPublished,
}: {
  kind: "buyer" | "property";
  open: boolean;
  onClose: () => void;
  /** ‏רענון הפיד אחרי העלאה — מה שהועלה אמור להופיע בו מיד. */
  onPublished: () => void;
}): React.JSX.Element {
  const copy = COPY[kind];
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<PickRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "success" | "warning" | "danger"; text: string } | null>(
    null,
  );

  /*
   * ‎**טעינה אחת, וסינון במסך** — בדיוק כמו ברשימות עצמן.
   *
   * ‏הגרסה הראשונה שלחה את הטקסט לשרת כ-`q`, וזו הייתה טעות
   * ‏שקטה: `GET /buyers` מחפש בהערות, בהערות ה-AI, במקור ובערים
   * ‏בלבד — **לא בשם ולא בטלפון**, כי שניהם מוצפנים במסד. כלומר
   * ‏הקלדת השם שמוצג בשורה הייתה מחזירה רשימה ריקה (ביקורת Codex,
   * ‏P1).
   *
   * ‏מסך הקונים כבר פותר את זה, ובדיוק כך: הוא שולף בלי `q`
   * ‏(`filtersToQuery({ ...filters, q: "" })`) ומסנן ב-`textMatches`
   * ‏על השם, הטלפון והערים — שם הם כבר מפוענחים ב-DTO. אותה דרך
   * ‏כאן, ולא ניסוח שני שלה.
   *
   * ‏ובדרך נעלמת גם הבעיה של תשובה מאוחרת שדורסת תשובה חדשה
   * ‏(ביקורת Codex, P2): אין בקשה לכל הקלדה, יש בקשה אחת לפתיחה.
   */
  const load = useCallback(() => {
    setLoadError(null);
    apiGet<{ items: (BuyerRow | PropertyRow)[] }>(`${copy.list}?limit=${LIMIT}`)
      .then((res) => {
        const items = apiList(res.items, "items");
        setRows(
          kind === "buyer"
            ? items.map((row) => buyerRow(row as BuyerRow))
            : items.map((row) => propertyRow(row as PropertyRow)),
        );
      })
      /*
       * ‎**כישלון אינו רשימה ריקה** (ביקורת Codex, P2).
       *
       * ‏קודם כל שגיאה — נפילה זמנית, 403 על יכולת צפייה שנשללה —
       * ‏התגלגלה ל-`rows = []`, והחלון הודיע „לא נמצאו קונים”. זו
       * ‏אמירה על המאגר, בזמן שהבקשה בכלל לא הצליחה, ואין ממנה
       * ‏דרך חזרה.
       */
      .catch((err: unknown) => {
        setRows(null);
        setLoadError(err instanceof ApiError ? err.message : "טעינת הרשימה נכשלה");
      });
  }, [copy.list, kind]);

  useEffect(() => {
    if (!open) return;
    load();
  }, [open, load]);

  /* ‏חלון שנסגר ונפתח שוב מתחיל נקי — בחירה ישנה היא הפתעה */
  useEffect(() => {
    if (open) return;
    setQ("");
    setRows(null);
    setLoadError(null);
    setPicked(new Set());
    setNote(null);
  }, [open]);

  /*
   * ‏הסינון על מה שכבר נטען: השם והטלפון מפוענחים כאן, והערים
   * ‏ממילא בשורה. `visible` ולא כתיבה מחדש של `rows` — הבחירה
   * ‏שורדת שינוי טקסט, וזה מה שמאפשר לבחור שלושה קונים בשלוש
   * ‏חיפושים.
   */
  const visible = useMemo(
    () => (rows ?? []).filter((row) => textMatches(q, row.title, row.subtitle, row.search)),
    [rows, q],
  );

  function toggle(id: string): void {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function publish(): Promise<void> {
    const ids = [...picked];
    if (ids.length === 0) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await apiPost<{ results: { id: string; ok: boolean; error?: string }[] }>(
        copy.path,
        copy.body(ids),
      );
      const failed = res.results.filter((r) => !r.ok);
      /*
       * ‏הסיבות מאוחדות ולא נערמות: „כבר מפורסם” על שמונה כרטיסים
       * ‏הוא משפט אחד, לא שמונה.
       */
      const reasons = [...new Set(failed.map((r) => r.error ?? "ההעלאה נכשלה"))];
      setNote({
        tone: failed.length === 0 ? "success" : "warning",
        text:
          failed.length === 0
            ? copy.done(res.results.length)
            : `${res.results.length - failed.length} הועלו, ${failed.length} לא — ${reasons.join(" · ")}`,
      });
      setPicked(new Set());
      onPublished();
    } catch {
      setNote({ tone: "danger", text: "ההעלאה לרשת נכשלה — נסו שוב" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      open={open}
      title={copy.title}
      confirmLabel={picked.size === 0 ? "בחרו לפחות אחד" : copy.confirm(picked.size)}
      confirmDisabled={picked.size === 0}
      busy={busy}
      busyLabel="מעלה…"
      onConfirm={() => void publish()}
      onClose={onClose}
    >
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-muted)" }}>
          {copy.hint}
        </p>

        <label className="mv-searchbox">
          <span className="mv-visually-hidden">{copy.search}</span>
          <IconSearch s={18} />
          <input value={q} placeholder={copy.search} onChange={(event) => setQ(event.target.value)} />
        </label>

        {note ? <Notice tone={note.tone}>{note.text}</Notice> : null}

        {loadError !== null ? (
          <div className="flex flex-wrap items-center gap-2">
            <Notice tone="danger">{loadError}</Notice>
            <button type="button" className="mv-btn-plain" onClick={load}>
              נסו שוב
            </button>
          </div>
        ) : rows === null ? (
          <p className="m-0" aria-live="polite">טוען…</p>
        ) : visible.length === 0 ? (
          <p className="m-0" style={{ color: "var(--color-text-muted)" }}>{copy.empty}</p>
        ) : (
          <>
            <ul
              className="m-0 flex max-h-[46vh] list-none flex-col gap-1 overflow-y-auto p-0"
              aria-label={copy.title}
            >
              {visible.map((row) => (
                <li key={row.id}>
                  <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2">
                    <input
                      type="checkbox"
                      checked={picked.has(row.id)}
                      onChange={() => toggle(row.id)}
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{row.title}</span>
                      {row.subtitle === "" ? null : (
                        <span
                          className="block truncate text-[length:var(--type-caption)]"
                          style={{ color: "var(--color-text-muted)" }}
                        >
                          {row.subtitle}
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            {/*
              ‏התקרה נאמרת, כי „לא נמצא” על כרטיס שקיים הוא באג לעין.
              ‏היא נמדדת על מה שנטען ולא על מה שמוצג: הסינון הוא
              ‏מקומי, ולכן „מוצגים 12” אחרי חיפוש אינו אומר שהמאגר
              ‏נגמר.
            */}
            {rows.length === LIMIT ? (
              <p className="m-0 text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
                מוצגים {LIMIT} הראשונים — צמצמו בחיפוש כדי להגיע לשאר.
              </p>
            ) : null}
          </>
        )}
      </div>
    </ConfirmDialog>
  );
}
