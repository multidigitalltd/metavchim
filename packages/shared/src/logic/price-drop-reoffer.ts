import { shekelsLabel } from "./forum.js";

/**
 * ‏הצעה חוזרת אחרי הורדת מחיר (docs/03 — properties).
 *
 * ‏מי שביקר ואמר „המחיר גבוה”, ומי שדחה התאמה בגלל המחיר, הם הקונים
 * ‏שהורדת המחיר נועדה בשבילם — והם היחידים שכבר יודעים במה מדובר.
 * ‏פנייה אליהם קודמת לכל התאמה חדשה.
 *
 * ‏החלון: 30 יום. אחרי חודש ההורדה כבר אינה חדשות, והכרטיס חוזר
 * ‏לנקי.
 */

export const PRICE_DROP_REOFFER_WINDOW_DAYS = 30;

export const REOFFER_REASONS = ["said_price_high", "dismissed_on_price"] as const;
export type ReofferReason = (typeof REOFFER_REASONS)[number];
export const REOFFER_REASON_LABELS: Record<ReofferReason, string> = {
  said_price_high: "ביקר ואמר שהמחיר גבוה",
  dismissed_on_price: "דחה את ההתאמה בגלל המחיר",
};

/** ‏האם הורדת המחיר עדיין „חדשות” — בתוך החלון. */
export function priceDropStillFresh(priceChangedAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - priceChangedAt.getTime() <= PRICE_DROP_REOFFER_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * ‏ההודעה לקונה — קצרה, עם שני המספרים, בלי לחץ. הסוכן שולח בעצמו
 * ‏מוואטסאפ; המערכת רק מנסחת.
 */
export function priceDropReofferMessage(input: {
  name?: string | undefined;
  propertyLabel: string;
  fromAgorot: number;
  toAgorot: number;
}): string {
  const greeting = input.name === undefined || input.name.trim() === "" ? "היי," : `היי ${input.name.trim()},`;
  return [
    greeting,
    `${input.propertyLabel} — המחיר ירד מ-${shekelsLabel(input.fromAgorot / 100)} ל-${shekelsLabel(input.toAgorot / 100)}.`,
    "אם זה עדיין רלוונטי, אשמח לתאם ביקור נוסף.",
  ].join("\n");
}
