"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { ConfirmDialog } from "./confirm-dialog";
import { Notice } from "./notice";

/**
 * ‎**„שליחת הצעת נכס” — חלון אחד לשני הכיוונים.**
 *
 * ‏מכרטיס הנכס בוחרים קונים; מכרטיס הקונה בוחרים נכסים. זו אותה
 * ‏פעולה — **(נכסים × קונים) ⇐ מייל** — ולכן אותו חלון, אותו
 * ‏חיפוש, אותו „סמן הכל”, ואותו סיכום בסוף. שני חלונות היו נפרדים
 * ‏ביום שאחד מהם מתוקן.
 *
 * ‏מה שבאמת שונה בין הצדדים הוא **שורה אחת ברשימה**: לקונה יכולה
 * ‏להיות סיבה שלא יקבל (אין מייל, הסיר את עצמו) ולנכס אין. לכן
 * ‏השורה מיוצגת כאן כטיפוס אחד עם הערה אופציונלית, ולא כשני
 * ‏רכיבים.
 */

/** ‏שורה לבחירה — עם הסיבה שבגללה אולי אי אפשר לבחור בה. */
interface PickRow {
  id: string;
  name: string;
  /** ‏מה שמונע בחירה, בשפת המשתמש. `null` = אפשר לבחור. */
  blocked: string | null;
}

interface PitchResult {
  sent: number;
  skippedNoEmail: number;
  skippedOptedOut: number;
  failed: number;
}

interface BuyerRow {
  buyerId: string;
  name: string;
  state: "ready" | "no_email" | "opted_out";
}

interface PropertyRow {
  id: string;
  city?: string;
  neighborhood?: string;
  street?: string;
  rooms?: number;
  marketingTitle?: string;
}

const BLOCKED_TEXT: Record<BuyerRow["state"], string | null> = {
  ready: null,
  no_email: "אין מייל בכרטיס",
  opted_out: "הסיר את עצמו מדיוור",
};

function propertyName(row: PropertyRow): string {
  if (row.marketingTitle !== undefined && row.marketingTitle !== "") return row.marketingTitle;
  const where = [row.street, row.neighborhood, row.city].filter(Boolean).join(", ");
  const rooms = row.rooms !== undefined ? `${row.rooms} חדרים` : "";
  return [rooms, where].filter(Boolean).join(" · ") || "נכס ללא כתובת";
}

/**
 * ‏סיכום השליחה — **מה שלא יצא נאמר, ולא רק מה שיצא.**
 *
 * ‏„נשלח ל-7” אחרי שסומנו עשרה הוא בדיוק הדיווח שגורם לסוכן
 * ‏להאמין ששלושה קיבלו.
 */
function resultText(result: PitchResult): string {
  const parts = [`נשלחו ${result.sent} הודעות`];
  if (result.skippedNoEmail > 0) parts.push(`${result.skippedNoEmail} ללא מייל בכרטיס`);
  if (result.skippedOptedOut > 0) parts.push(`${result.skippedOptedOut} הוסרו מדיוור`);
  if (result.failed > 0) parts.push(`${result.failed} נכשלו`);
  return parts.join(" · ");
}

export function PropertyPitchDialog({
  open,
  onClose,
  side,
  fixedIds,
}: {
  open: boolean;
  onClose: () => void;
  /** ‏מה בוחרים כאן. הצד השני הוא `fixedIds` — הכרטיס שממנו נפתח. */
  side: "buyers" | "properties";
  fixedIds: readonly string[];
}) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<PickRow[] | null>(null);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PitchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (term: string) => {
      const search = term.trim();
      const query = search === "" ? "" : `&q=${encodeURIComponent(search)}`;
      if (side === "buyers") {
        const items = await apiGet<BuyerRow[]>(`/property-pitch/buyers?limit=200${query}`);
        return items.map((row) => ({
          id: row.buyerId,
          name: row.name,
          blocked: BLOCKED_TEXT[row.state],
        }));
      }
      const page = await apiGet<{ items: PropertyRow[] }>(`/properties?limit=200${query}`);
      return page.items.map((row) => ({ id: row.id, name: propertyName(row), blocked: null }));
    },
    [side],
  );

  /*
   * ‏החיפוש רץ בשרת, ולכן כל הקלדה טוענת מחדש. ההשהיה היא מה
   * ‏שמונע בקשה לכל אות; הניקוי מבטל בקשה שכבר אינה רלוונטית.
   */
  useEffect(() => {
    if (!open) return;
    let live = true;
    const timer = setTimeout(() => {
      void load(q)
        .then((items) => {
          if (live) setRows(items);
        })
        .catch(() => {
          if (live) {
            setRows([]);
            setError("טעינת הרשימה נכשלה");
          }
        });
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [open, q, load]);

  /* ‏פתיחה מחדש מתחילה נקי — סימון שנשאר מפעם קודמת נשלח בטעות */
  useEffect(() => {
    if (open) {
      setQ("");
      setChosen(new Set());
      setResult(null);
      setError(null);
    }
  }, [open]);

  /*
   * ‎**„סמן הכל” מסמן רק את מי שאפשר לשלוח אליו.** סימון של מי
   * ‏שאין לו מייל היה מייצר בחירה שהשרת מדלג עליה ממילא, ואז
   * ‏„נשלח ל-12 מתוך 20” בלי שהמסך אמר זאת מראש.
   */
  const selectable = useMemo(
    () => (rows ?? []).filter((row) => row.blocked === null).map((row) => row.id),
    [rows],
  );
  const allChosen = selectable.length > 0 && selectable.every((id) => chosen.has(id));

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const ids = [...chosen];
      const body =
        side === "buyers"
          ? { propertyIds: [...fixedIds], buyerIds: ids }
          : { propertyIds: ids, buyerIds: [...fixedIds] };
      setResult(await apiPost<PitchResult>("/property-pitch/send", body));
    } catch {
      setError("השליחה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  const noun = side === "buyers" ? "קונים" : "נכסים";

  return (
    <ConfirmDialog
      open={open}
      title={side === "buyers" ? "שליחת הצעת נכס" : "הצעת נכס לקונה"}
      confirmLabel={result === null ? `שלח ל-${chosen.size} ${noun}` : "סגור"}
      cancelLabel={result === null ? "ביטול" : null}
      busy={busy}
      busyLabel="שולח…"
      confirmDisabled={result === null && chosen.size === 0}
      onConfirm={result === null ? () => void send() : onClose}
      onClose={onClose}
    >
      {result !== null ? (
        <Notice tone={result.failed > 0 ? "warning" : "success"}>{resultText(result)}</Notice>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="m-0 text-sm" style={{ color: "var(--color-text-muted)" }}>
            {side === "buyers"
              ? "כל קונה שייבחר יקבל מייל עם פרטי הנכס וקישור לדף הנחיתה למילוי פרטים."
              : "הקונה יקבל מייל עם פרטי הנכסים שייבחרו וקישור לדף הנחיתה של כל אחד."}
          </p>
          <input
            className="mv-input"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`חיפוש ${noun}…`}
            aria-label={`חיפוש ${noun}`}
          />
          {error !== null ? <Notice tone="danger">{error}</Notice> : null}
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={allChosen}
              disabled={selectable.length === 0}
              onChange={(e) => setChosen(new Set(e.target.checked ? selectable : []))}
            />
            סמן הכל ({selectable.length})
          </label>
          <ul
            className="m-0 flex max-h-72 list-none flex-col gap-1 overflow-y-auto p-0"
            style={{ borderTop: "1px solid var(--color-border)" }}
          >
            {rows === null ? (
              <li className="py-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                טוען…
              </li>
            ) : rows.length === 0 ? (
              <li className="py-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                לא נמצאו {noun}
              </li>
            ) : (
              rows.map((row) => (
                <li key={row.id}>
                  <label className="flex items-center gap-2 py-1 text-sm">
                    <input
                      type="checkbox"
                      checked={chosen.has(row.id)}
                      disabled={row.blocked !== null}
                      onChange={(e) => {
                        const next = new Set(chosen);
                        if (e.target.checked) next.add(row.id);
                        else next.delete(row.id);
                        setChosen(next);
                      }}
                    />
                    <span>{row.name}</span>
                    {/*
                      ‏הסיבה נאמרת **ליד השם ולפני הבחירה**, ולא
                      ‏מתגלה בסיכום שאחריה.
                    */}
                    {row.blocked !== null ? (
                      <span className="mv-chip" style={{ cursor: "default" }}>
                        {row.blocked}
                      </span>
                    ) : null}
                  </label>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </ConfirmDialog>
  );
}
