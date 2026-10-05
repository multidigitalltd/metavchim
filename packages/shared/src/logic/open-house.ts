import { shekelsLabel } from "./forum.js";

/**
 * ‏בית פתוח (docs/03 — open_houses).
 *
 * ‏אירוע אחד על נכס, מחולק למשבצות זמן קצרות. מבקר נרשם למשבצת
 * ‏מדף הנחיתה (או מה-QR שעל השלט), ובשטח המתווך מסמן „הגיע” ורושם
 * ‏משוב — אותן שלוש הקשות של סיור רגיל, כי כל מבקר **הוא** סיור:
 * ‏פגישה ביומן מסוג `viewing` שקשורה לאירוע. כך הוא נכנס לדוח
 * ‏למוכר, לסריקת „נכס תקוע” ולתזכורות בלי קוד נוסף.
 */

export const OPEN_HOUSE_SLOT_MINUTES = [15, 20, 30, 45, 60] as const;
export type OpenHouseSlotMinutes = (typeof OPEN_HOUSE_SLOT_MINUTES)[number];
/** ‏אורך מרבי לאירוע — יותר מזה הוא כבר לא „בית פתוח” אלא יום עבודה */
export const OPEN_HOUSE_MAX_HOURS = 6;
export const OPEN_HOUSE_MAX_CAPACITY = 50;
export const OPEN_HOUSE_STATUSES = ["planned", "done", "cancelled"] as const;
export type OpenHouseStatus = (typeof OPEN_HOUSE_STATUSES)[number];
export const OPEN_HOUSE_STATUS_LABELS: Record<OpenHouseStatus, string> = {
  planned: "מתוכנן",
  done: "התקיים",
  cancelled: "בוטל",
};

/** ‏תחילות המשבצות — רק משבצות שמסתיימות בתוך האירוע. */
export function openHouseSlots(startsAt: Date, endsAt: Date, slotMinutes: number): Date[] {
  const out: Date[] = [];
  const step = slotMinutes * 60_000;
  if (step <= 0) return out;
  for (let t = startsAt.getTime(); t + step <= endsAt.getTime(); t += step) out.push(new Date(t));
  return out;
}

export interface SlotAvailability {
  startsAt: string;
  registered: number;
  /** ‏`null` = בלי הגבלה */
  remaining: number | null;
}

/** ‏מצב כל משבצת — כמה נרשמו וכמה מקומות נשארו. */
export function slotAvailability(
  slots: readonly Date[],
  registeredAt: ReadonlyMap<string, number>,
  capacity: number | null,
): SlotAvailability[] {
  return slots.map((slot) => {
    const iso = slot.toISOString();
    const registered = registeredAt.get(iso) ?? 0;
    return { startsAt: iso, registered, remaining: capacity === null ? null : Math.max(0, capacity - registered) };
  });
}

/** ‏האם המועד הוא אחת המשבצות של האירוע. */
export function isOpenHouseSlot(slotAt: Date, startsAt: Date, endsAt: Date, slotMinutes: number): boolean {
  const step = slotMinutes * 60_000;
  const offset = slotAt.getTime() - startsAt.getTime();
  return offset >= 0 && offset % step === 0 && slotAt.getTime() + step <= endsAt.getTime();
}

const DAY = new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", weekday: "long", day: "numeric", month: "numeric" });
const TIME = new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit" });

/** ‏„יום שלישי 22.9, 17:00–19:00” — לשיתוף ולתזכורת. */
export function openHouseWhen(startsAt: Date, endsAt: Date): string {
  return `${DAY.format(startsAt)}, ${TIME.format(startsAt)}–${TIME.format(endsAt)}`;
}

/** ‏הודעת ההזמנה שהמתווך משתף (וואטסאפ / קבוצות). */
export function openHouseInviteMessage(input: {
  propertyLabel: string;
  startsAt: Date;
  endsAt: Date;
  priceAgorot?: number | null;
  url: string;
  officeName: string;
}): string {
  const price = input.priceAgorot === undefined || input.priceAgorot === null ? "" : ` · ${shekelsLabel(input.priceAgorot / 100)}`;
  return [
    `🏠 בית פתוח — ${input.propertyLabel}${price}`,
    openHouseWhen(input.startsAt, input.endsAt),
    "בוחרים שעה ונרשמים כאן:",
    input.url,
    input.officeName,
  ].join("\n");
}

/** ‏תזכורת אישית למי שנרשם — נשלחת מהוואטסאפ של הסוכן. */
export function openHouseReminderMessage(input: {
  name: string;
  propertyLabel: string;
  slotAt: Date;
  officeName: string;
}): string {
  return [
    `שלום ${input.name}, תזכורת לבית הפתוח ב${input.propertyLabel}:`,
    `${DAY.format(input.slotAt)} בשעה ${TIME.format(input.slotAt)}.`,
    `נשמח לראותכם — ${input.officeName}`,
  ].join("\n");
}

/** ‏השורה לדוח למוכר — מספרים בלבד. */
export function openHouseSentence(input: { startsAt: Date; registered: number; arrived: number }): string {
  const day = new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric" }).format(input.startsAt);
  const came = input.arrived === 1 ? "אחד הגיע" : `${input.arrived} הגיעו`;
  const signed = input.registered === 1 ? "נרשם אחד" : `${input.registered} נרשמו`;
  return `בית פתוח ב-${day}: ${signed}, ${came}.`;
}
