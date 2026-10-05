import {
  formatIsraeliNumber,
  formatJerusalemDate,
  formatJerusalemTime,
  jerusalemDayLabel,
} from "@metavchim/shared";

/** ‏מחיר באגורות → „₪ 2,450,000”. */
export function formatPrice(agorot: number | undefined | null): string {
  if (agorot === undefined || agorot === null) return "";
  return `₪ ${formatIsraeliNumber(Math.round(agorot / 100))}`;
}

/** ‏טווח תקציב — „₪ 1.5M–2M” נשאר למסכי הדוחות; כאן המספרים המלאים. */
export function formatBudget(min?: number, max?: number): string {
  if (min === undefined && max === undefined) return "לא צוין";
  if (min !== undefined && max !== undefined)
    return `${formatPrice(min)} – ${formatPrice(max)}`;
  if (max !== undefined) return `עד ${formatPrice(max)}`;
  return `מ-${formatPrice(min)}`;
}

/**
 * ‏מועד בשעון ישראל: „היום 14:30”, „מחר 09:00”, אחרת „24.08.2026 14:30”.
 * ‏היום הישראלי ולא היום של המכשיר — כמו בכל המערכת (docs/06).
 */
export function formatWhen(iso: string, now: Date): string {
  const at = new Date(iso);
  const day = jerusalemDayLabel(at);
  const today = jerusalemDayLabel(now);
  const tomorrow = jerusalemDayLabel(
    new Date(now.getTime() + 24 * 60 * 60 * 1000),
  );
  const time = formatJerusalemTime(at);
  if (day === today) return `היום ${time}`;
  if (day === tomorrow) return `מחר ${time}`;
  return `${formatJerusalemDate(at)} ${time}`;
}

export function formatDate(iso: string): string {
  return formatJerusalemDate(new Date(iso));
}

export function roomsLabel(rooms: number | undefined): string {
  if (rooms === undefined) return "";
  return `${formatIsraeliNumber(rooms)} חד׳`;
}

/** ‏שקלים (כפי שמקלידים) → אגורות (כפי שנשמר). `undefined` על שדה ריק או לא-מספר. */
export function shekelsInputToAgorot(text: string): number | undefined {
  const digits = text.replace(/[^\d.]/gu, "");
  if (digits === "") return undefined;
  const value = Number(digits);
  return Number.isFinite(value) ? Math.round(value * 100) : undefined;
}

/** ‏אגורות → טקסט שקלים לשדה קלט, בלי מפרידי אלפים. */
export function agorotToShekelsInput(agorot: number | undefined): string {
  return agorot === undefined ? "" : String(Math.round(agorot / 100));
}

/** ‏טקסט → מספר, `undefined` כשריק או לא מספר. */
export function numberInput(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * ‏תאריך שהוקלד — „15.10.2026”, „15/10/2026” או „2026-10-15” — ל-`YYYY-MM-DD`.
 * ‏`null` כשאינו תאריך בלוח (30.02 נדחה, לא מתגלגל).
 */
export function dateInput(text: string): string | null {
  const t = text.trim();
  let y: number, m: number, d: number;
  const dmy = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/u.exec(t);
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(t);
  if (dmy) [d, m, y] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3])];
  else if (ymd) [y, m, d] = [Number(ymd[1]), Number(ymd[2]), Number(ymd[3])];
  else return null;
  const iso = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const check = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(check.getTime()) ||
    check.toISOString().slice(0, 10) !== iso
    ? null
    : iso;
}

/** ‏ISO מהשרת → „15.10.2026” לשדה קלט; ריק כשאין. */
export function dateToInput(iso: string | undefined): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return formatJerusalemDate(at);
}
