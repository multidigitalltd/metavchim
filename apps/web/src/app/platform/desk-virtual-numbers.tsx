"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@metavchim/ui";
import { ApiError, apiDelete, apiGet, apiList, apiPost } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { Notice } from "../notice";

/**
 * שיוך מספרים וירטואליים לסוכנים — **מהשולחן, בלי להיכנס למשרד.**
 *
 * ## למה זה כאן
 *
 * משרד שכל סוכן בו מקבל מספר נפרד מהמרכזייה מבקש מהפלטפורמה לחבר
 * את המספרים לסוכנים. עד עכשיו התשובה הייתה „מנהל המשרד ייכנס
 * להגדרות ויבחר סוכן לכל מספר” — וזה בדיוק הצעד הטכני שבו משרדים
 * נתקעים, כמו חיבור המרכזייה עצמה.
 *
 * ## מה המסך עושה
 *
 * טבלה אחת: כל המספרים של המשרד, ולכל אחד בחירת סוכן ושם. מספר
 * שאינו קיים עדיין מתווסף בשורה חדשה. **שמירה אחת** שולחת את
 * השורות שהשתנו — השרת מעדכן את הקיימים ויוצר את החסרים — ומייצרת
 * אצל המשרד רישום אחד ביומן והתראה אחת.
 *
 * **רק שורות שהשתנו, ולא הטבלה כולה.** כל שורה מחזיקה את מה שנטען
 * מהשרת, והשמירה משווה אליו. שליחת הכול הייתה דורסת שיוך שמנהל
 * המשרד שינה בינתיים בשורה שכאן איש לא נגע בה — בשקט (ביקורת
 * Codex). זה גם מה שמשאיר את תקרת מאה השורות בשרת רחוקה מכל
 * שימוש אמיתי.
 *
 * הרכיב ממוענן מחדש לכל משרד (`key={agencyId}` אצל ההורה), ולכן
 * אין מצב שבו טבלה של משרד אחד נשלחת למשרד אחר. דגל ה-`live`
 * מכסה את מה שנותר: תשובה שחוזרת אחרי שהרכיב כבר ירד.
 *
 * ## חיוב חודשי ומחיקה
 *
 * ליד כל מספר קיים מוצג החיוב החודשי שפתוח עליו, אם יש — שורת
 * השכרה עם `origin: "platform"` — או כפתור לפתוח אחד. החיוב נגבה
 * בכרטיס השמור של המשרד באותו סורק של השכרות מ-015. מחיקת מספר
 * מוציאה את ההגדרה בלבד; חיוב פתוח נסגר במסך ההשכרות, בכוונה
 * בנפרד: מחיקת ניתוב בטעות לא אמורה לבטל גם גבייה.
 */

interface DeskNumber {
  id: string;
  phone: string;
  label: string;
  assignedToUserId: string | null;
  isActive: boolean;
}

interface DeskVirtualNumbers {
  numbers: DeskNumber[];
  users: { id: string; name: string }[];
}

/** שורת חיוב/השכרה של המשרד, כפי שמסך ההשכרות מקבל אותה. */
interface ChargeRow {
  id: string;
  number: string;
  numberDisplay: string;
  monthlyAgorot: number;
  status: string;
  origin: string;
}

const CHARGE_STATUS: Record<string, string> = {
  active: "פעיל",
  past_due: "חיוב נכשל",
  cancelled: "בוטל — עד סוף התקופה",
  pending: "ממתין לתשלום",
};

/** ‎+972XXXXXXXXX → 0XXXXXXXXX — הצורה שבה שורות ההשכרה שומרות מספר. */
function localDigits(phone: string): string {
  return phone.startsWith("+972") ? `0${phone.slice(4)}` : phone;
}

/** שורה בטופס — קיימת (עם `id`) או חדשה (בלי). */
interface Row {
  id: string | null;
  phone: string;
  label: string;
  assignedToUserId: string;
  isActive: boolean;
  /** מה שנטען מהשרת — הבסיס להשוואת „האם השורה השתנתה”. */
  initial: { label: string; assignedToUserId: string } | null;
}

/** שורה נשלחת רק אם היא חדשה עם מספר, או קיימת ושונה ממה שנטען. */
function isDirty(row: Row): boolean {
  if (row.id === null) return row.phone.trim() !== "";
  if (row.initial === null) return true;
  return (
    row.label.trim() !== row.initial.label || row.assignedToUserId !== row.initial.assignedToUserId
  );
}

const inputStyle = {
  borderColor: "var(--color-input-border)",
  background: "var(--color-field)",
} as const;

let nextKey = 0;

export function DeskVirtualNumbers({
  agencyId,
  agencyName,
}: {
  agencyId: string;
  agencyName: string;
}) {
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [rows, setRows] = useState<(Row & { key: string })[]>([]);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  /** חיובים חיים לפי מספר (בספרות מקומיות). */
  const [charges, setCharges] = useState<Map<string, ChargeRow>>(new Map());
  /** השורה שבה פתוח טופס „הוסף חיוב”, והסכום שהוקלד בש"ח. */
  const [charging, setCharging] = useState<{ key: string; shekels: string } | null>(null);
  const mounted = useRef(true);

  function fromServer(res: DeskVirtualNumbers): void {
    setUsers(res.users);
    setRows(
      res.numbers.map((n) => ({
        key: n.id,
        id: n.id,
        phone: n.phone,
        label: n.label,
        assignedToUserId: n.assignedToUserId ?? "",
        isActive: n.isActive,
        initial: { label: n.label, assignedToUserId: n.assignedToUserId ?? "" },
      })),
    );
  }

  /** החיובים החיים של המשרד — שורות שטרם שוחררו. */
  async function loadCharges(): Promise<void> {
    const res = await apiGet<{ rentals: ChargeRow[] }>(
      `/platform/number-rentals?tenantId=${agencyId}`,
    );
    if (!mounted.current) return;
    const next = new Map<string, ChargeRow>();
    for (const row of apiList(res.rentals, "rentals")) {
      if (row.status !== "released") next.set(row.number, row);
    }
    setCharges(next);
  }

  useEffect(() => {
    mounted.current = true;
    let live = true;
    apiGet<DeskVirtualNumbers>(`/platform/agencies/${agencyId}/integrations/virtual-numbers`)
      .then((res) => {
        if (!live) return;
        fromServer(res);
        setLoadedOnce(true);
      })
      .catch(() => {
        if (live) setError("טעינת המספרים נכשלה");
      });
    // כשל בטעינת החיובים אינו מפיל את הטבלה — העמודה פשוט ריקה
    void loadCharges().catch(() => undefined);
    return () => {
      live = false;
      mounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- הרכיב ממוען מחדש לכל משרד
  }, [agencyId]);

  /** מחיקת ההגדרה בלבד — השיחות שנקלטו נשארות, וחיוב פתוח נסגר בנפרד. */
  async function remove(row: Row & { key: string }): Promise<void> {
    if (row.id === null) return;
    const charge = charges.get(localDigits(row.phone));
    const warning = charge
      ? "\n\nשימו לב: על המספר פתוח חיוב חודשי. המחיקה אינה סוגרת אותו — סוגרים אותו במסך ההשכרות."
      : "";
    if (
      !window.confirm(
        `למחוק את המספר ${row.phone} („${row.label}”) אצל ${agencyName}?\n\nהניתוב ייפסק; השיחות שכבר נקלטו נשמרות.${warning}`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await apiDelete(`/platform/agencies/${agencyId}/integrations/virtual-numbers/${row.id}`);
      if (!mounted.current) return;
      setRows((prev) => prev.filter((r) => r.key !== row.key));
      setDone(`המספר ${row.phone} נמחק אצל ${agencyName}. המשרד קיבל התראה.`);
    } catch (err: unknown) {
      if (!mounted.current) return;
      setError(err instanceof ApiError ? err.message : "המחיקה נכשלה");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  /** פתיחת חיוב חודשי על מספר קיים — הסכום בש"ח לפני מע"מ. */
  async function createCharge(row: Row & { key: string }): Promise<void> {
    if (charging === null || charging.key !== row.key) return;
    const shekels = Number(charging.shekels.replace(",", "."));
    if (!Number.isFinite(shekels) || shekels <= 0) {
      setError("הזינו סכום חודשי בש\"ח");
      return;
    }
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await apiPost<{ id: string; number: string; warning: string | null }>(
        "/platform/number-rentals",
        { tenantId: agencyId, phone: row.phone, monthlyAgorot: Math.round(shekels * 100) },
      );
      if (!mounted.current) return;
      setCharging(null);
      setDone(
        `נפתח חיוב של ${formatNumber(shekels)} ₪ לחודש על ${row.phone} אצל ${agencyName}. החודש הראשון ייגבה בסבב הקרוב.` +
          (res.warning ? ` ${res.warning}.` : ""),
      );
      await loadCharges();
    } catch (err: unknown) {
      if (!mounted.current) return;
      setError(err instanceof ApiError ? err.message : "פתיחת החיוב נכשלה");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  function update(key: string, patch: Partial<Row>): void {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function addRow(): void {
    nextKey += 1;
    setRows((prev) => [
      ...prev,
      {
        key: `new-${nextKey}`,
        id: null,
        phone: "",
        label: "",
        assignedToUserId: "",
        isActive: true,
        initial: null,
      },
    ]);
  }

  function removeNewRow(key: string): void {
    setRows((prev) => prev.filter((row) => row.key !== key || row.id !== null));
  }

  async function save(): Promise<void> {
    /*
     * שורה חדשה בלי מספר היא שורה שנפתחה ולא מולאה — מדלגים ולא
     * דוחים. שורה קיימת שלא השתנתה אינה נשלחת כלל — ראו למעלה.
     */
    /*
     * שורה קיימת נשלחת עם המזהה שלה ועם **השדות שהשתנו בלבד**: שם
     * שלא נגעו בו אינו נשלח, וכך אינו דורס שם שהמשרד שינה בינתיים —
     * ובאותו אופן הסוכן (ביקורת Codex). שורה חדשה נשלחת מלאה.
     */
    const numbers = rows.filter(isDirty).map((row) => {
      const assignee = row.assignedToUserId === "" ? null : row.assignedToUserId;
      if (row.id === null || row.initial === null) {
        return { phone: row.phone.trim(), label: row.label.trim(), assignedToUserId: assignee };
      }
      const label = row.label.trim();
      return {
        id: row.id,
        phone: row.phone,
        ...(label !== row.initial.label ? { label } : {}),
        ...(row.assignedToUserId !== row.initial.assignedToUserId
          ? { assignedToUserId: assignee }
          : {}),
      };
    });
    if (numbers.length === 0) {
      setError("אין שינויים לשמירה");
      return;
    }
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await apiPost<{ ok: true; saved: number }>(
        `/platform/agencies/${agencyId}/integrations/virtual-numbers`,
        { numbers },
      );
      if (!mounted.current) return;
      setDone(
        `${res.saved} מספרים נשמרו אצל ${agencyName}. המשרד קיבל התראה, והפעולה רשומה ביומן שלו.`,
      );
      const fresh = await apiGet<DeskVirtualNumbers>(
        `/platform/agencies/${agencyId}/integrations/virtual-numbers`,
      );
      if (!mounted.current) return;
      fromServer(fresh);
    } catch (err: unknown) {
      if (!mounted.current) return;
      setError(err instanceof ApiError ? err.message : "השמירה נכשלה");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <div
      className="mt-4 rounded-lg border p-3"
      style={{ borderColor: "var(--color-border)" }}
      aria-labelledby="desk-virtual-numbers-heading"
      role="group"
    >
      <h3 id="desk-virtual-numbers-heading" className="m-0 mb-1 text-base font-semibold">
        מספרים וירטואליים — שיוך לסוכנים
      </h3>
      <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
        מספר לכל סוכן: שיחה שמגיעה אל המספר פותחת ליד שכבר משויך לו.
        המספרים כאן הם אלה שהמרכזייה של המשרד שולחת בשדה „אל מי חייגו”.
        שם ריק במספר קיים משאיר את השם שהמשרד נתן. חיוב חודשי נגבה בכרטיס
        השמור של המשרד, לפני מע&quot;מ, ומופיע גם ברשימת ההשכרות.
      </p>

      {error ? <Notice tone="danger">{error}</Notice> : null}
      {done ? <Notice tone="success">{done}</Notice> : null}

      {!loadedOnce && error === null ? (
        <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          טוען…
        </p>
      ) : null}

      {loadedOnce ? (
        <>
          {users.length === 0 ? (
            <Notice tone="warning">למשרד הזה אין סוכנים פעילים — אין למי לשייך.</Notice>
          ) : null}

          {rows.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
              למשרד הזה אין עדיין מספרים וירטואליים. הוסיפו שורה לכל מספר.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "var(--color-table-head)" }}>
                    <th scope="col" className="p-2 text-start font-medium">
                      מספר
                    </th>
                    <th scope="col" className="p-2 text-start font-medium">
                      שם
                    </th>
                    <th scope="col" className="p-2 text-start font-medium">
                      סוכן מקבל
                    </th>
                    <th scope="col" className="p-2 text-start font-medium">
                      חיוב חודשי
                    </th>
                    <th scope="col" className="p-2 text-start font-medium">
                      מצב
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.key} style={{ borderTop: "1px solid var(--color-border)" }}>
                      <td className="p-2">
                        {row.id === null ? (
                          <input
                            aria-label="מספר"
                            dir="ltr"
                            placeholder="03-1234567"
                            maxLength={20}
                            value={row.phone}
                            onChange={(e) => update(row.key, { phone: e.target.value })}
                            className="w-full rounded-lg border px-3 py-2"
                            style={inputStyle}
                          />
                        ) : (
                          <span dir="ltr" className="font-mono">
                            {row.phone}
                          </span>
                        )}
                      </td>
                      <td className="p-2">
                        <input
                          aria-label="שם המספר"
                          placeholder={row.id === null ? "המספר של דוד" : "ריק = בלי שינוי"}
                          maxLength={60}
                          value={row.label}
                          onChange={(e) => update(row.key, { label: e.target.value })}
                          className="w-full rounded-lg border px-3 py-2"
                          style={inputStyle}
                        />
                      </td>
                      <td className="p-2">
                        <select
                          aria-label="סוכן מקבל"
                          value={row.assignedToUserId}
                          onChange={(e) => update(row.key, { assignedToUserId: e.target.value })}
                          className="w-full rounded-lg border px-3 py-2"
                          style={inputStyle}
                        >
                          <option value="">לערימה המשותפת</option>
                          {users.map((user) => (
                            <option key={user.id} value={user.id}>
                              {user.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="p-2 whitespace-nowrap">
                        {row.id === null ? (
                          <span style={{ color: "var(--color-text-muted)" }}>אחרי השמירה</span>
                        ) : (
                          (() => {
                            const charge = charges.get(localDigits(row.phone));
                            if (charge) {
                              return (
                                <span>
                                  {formatNumber(charge.monthlyAgorot / 100)} ₪ ·{" "}
                                  {CHARGE_STATUS[charge.status] ?? charge.status}
                                  {charge.origin !== "platform" ? " (השכרה מ-015)" : ""}
                                </span>
                              );
                            }
                            if (charging?.key === row.key) {
                              return (
                                <span className="flex items-center gap-1">
                                  <input
                                    aria-label="סכום חודשי בש״ח לפני מע״מ"
                                    dir="ltr"
                                    inputMode="decimal"
                                    placeholder="20"
                                    value={charging.shekels}
                                    onChange={(e) =>
                                      setCharging({ key: row.key, shekels: e.target.value })
                                    }
                                    className="w-20 rounded-lg border px-2 py-1"
                                    style={inputStyle}
                                  />
                                  <span>₪</span>
                                  <button
                                    type="button"
                                    className="mv-btn-plain"
                                    disabled={busy}
                                    onClick={() => void createCharge(row)}
                                  >
                                    אשר
                                  </button>
                                  <button
                                    type="button"
                                    className="mv-btn-plain"
                                    onClick={() => setCharging(null)}
                                  >
                                    בטל
                                  </button>
                                </span>
                              );
                            }
                            return (
                              <button
                                type="button"
                                className="mv-btn-plain"
                                onClick={() => setCharging({ key: row.key, shekels: "" })}
                              >
                                + הוסף חיוב
                              </button>
                            );
                          })()
                        )}
                      </td>
                      <td className="p-2 whitespace-nowrap">
                        {row.id === null ? (
                          <button
                            type="button"
                            className="mv-btn-plain"
                            onClick={() => removeNewRow(row.key)}
                          >
                            הסר
                          </button>
                        ) : (
                          <span className="flex items-center gap-2">
                            {row.isActive ? (
                              "פעיל"
                            ) : (
                              <span style={{ color: "var(--color-text-muted)" }}>מושבת</span>
                            )}
                            <button
                              type="button"
                              className="mv-btn-plain"
                              disabled={busy}
                              onClick={() => void remove(row)}
                            >
                              מחק
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" className="mv-btn-plain" onClick={addRow}>
              + הוסף מספר
            </button>
            <Button disabled={busy || !rows.some(isDirty)} onClick={() => void save()}>
              {busy ? "שומר…" : "שמור שיוכים עבור המשרד"}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
