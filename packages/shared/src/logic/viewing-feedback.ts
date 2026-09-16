/**
 * משוב מביקור — מה אמר הקונה, בשלוש הקשות (docs/03 — appointments).
 *
 * ## למה שלוש שאלות סגורות ולא טקסט
 *
 * הדבר היחיד שמוריד מחיר בלי ויכוח הוא „שישה מתוך שמונה אמרו שהמחיר
 * גבוה”. משפט חופשי אינו נספר; ומה שאינו נספר אינו נאמר למוכר.
 * לכן שלוש שאלות עם תשובות סגורות, שאפשר לענות עליהן בדרך חזרה
 * לרכב — ובוואטסאפ, בכפתורים.
 *
 * ## מה יוצא למוכר ומה לא
 *
 * הסיכום המספרי בלבד („6 אמרו שהמחיר גבוה”) — בלי מי, ובלי המשפט
 * החופשי שהסוכן כתב ב-`notes`, שנשאר פנימי. הטיפוס הסלר-פייסינג
 * ‎(`ViewingFeedbackRow`) נושא רק את שלושת הערכים הסגורים, כמו
 * ‎`OwnerAppointmentRow` — אין שדה שאפשר לשכוח לנקות.
 */

export const VIEWING_PRICE_FEEDBACK = ["high", "fair", "low"] as const;
export type ViewingPriceFeedback = (typeof VIEWING_PRICE_FEEDBACK)[number];
export const VIEWING_PRICE_LABELS: Record<ViewingPriceFeedback, string> = {
  high: "המחיר גבוה",
  fair: "המחיר הוגן",
  low: "המחיר נמוך",
};

export const VIEWING_CONDITION_FEEDBACK = ["good", "needs_work"] as const;
export type ViewingConditionFeedback = (typeof VIEWING_CONDITION_FEEDBACK)[number];
export const VIEWING_CONDITION_LABELS: Record<ViewingConditionFeedback, string> = {
  good: "המצב טוב",
  needs_work: "דורש שיפוץ",
};

export const VIEWING_FIT_FEEDBACK = ["fits", "location", "size", "layout"] as const;
export type ViewingFitFeedback = (typeof VIEWING_FIT_FEEDBACK)[number];
export const VIEWING_FIT_LABELS: Record<ViewingFitFeedback, string> = {
  fits: "מתאים לו",
  location: "המיקום לא מתאים",
  size: "הגודל לא מתאים",
  layout: "התכנון לא מתאים",
};

/** שלוש התשובות של ביקור אחד — כל אחת יכולה לחסר. */
export interface ViewingFeedbackRow {
  price: string | null;
  condition: string | null;
  fit: string | null;
}

export interface ViewingFeedbackSummary {
  /** ביקורים שיש בהם לפחות תשובה אחת */
  withFeedback: number;
  price: Record<ViewingPriceFeedback, number>;
  condition: Record<ViewingConditionFeedback, number>;
  fit: Record<ViewingFitFeedback, number>;
}

function isOneOf<T extends string>(list: readonly T[], value: string | null): value is T {
  return value !== null && (list as readonly string[]).includes(value);
}

/** ספירה טהורה — ערך שאינו ברשימה נופל ואינו נספר. */
export function summarizeViewingFeedback(rows: readonly ViewingFeedbackRow[]): ViewingFeedbackSummary {
  const summary: ViewingFeedbackSummary = {
    withFeedback: 0,
    price: { high: 0, fair: 0, low: 0 },
    condition: { good: 0, needs_work: 0 },
    fit: { fits: 0, location: 0, size: 0, layout: 0 },
  };
  for (const row of rows) {
    let any = false;
    if (isOneOf(VIEWING_PRICE_FEEDBACK, row.price)) {
      summary.price[row.price] += 1;
      any = true;
    }
    if (isOneOf(VIEWING_CONDITION_FEEDBACK, row.condition)) {
      summary.condition[row.condition] += 1;
      any = true;
    }
    if (isOneOf(VIEWING_FIT_FEEDBACK, row.fit)) {
      summary.fit[row.fit] += 1;
      any = true;
    }
    if (any) summary.withFeedback += 1;
  }
  return summary;
}

function count(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : `${n} ${plural}`;
}

/**
 * המשפטים שהמוכר מקבל — רק מה שנאמר, בסדר שמשנה: קודם המחיר.
 *
 * „6 מתוך 8 אמרו שהמחיר גבוה” ולא „75%”: המוכר סופר אנשים, לא
 * אחוזים, ומספר קטן במכנה אומר לו בעצמו כמה זה שווה.
 */
export function viewingFeedbackSentences(summary: ViewingFeedbackSummary): string[] {
  const n = summary.withFeedback;
  if (n === 0) return [];
  const out: string[] = [];
  const of = (k: number): string => `${k} מתוך ${n}`;
  if (summary.price.high > 0) out.push(`${of(summary.price.high)} אמרו שהמחיר גבוה`);
  if (summary.price.fair > 0) out.push(`${of(summary.price.fair)} אמרו שהמחיר הוגן`);
  if (summary.price.low > 0) out.push(`${of(summary.price.low)} אמרו שהמחיר נמוך`);
  if (summary.condition.needs_work > 0) out.push(`${count(summary.condition.needs_work, "אחד ציין", "ציינו")} שהנכס דורש שיפוץ`);
  if (summary.condition.good > 0) out.push(`${count(summary.condition.good, "אחד ציין", "ציינו")} שמצב הנכס טוב`);
  if (summary.fit.location > 0) out.push(`ל${count(summary.fit.location, "אחד", "")}${summary.fit.location === 1 ? "" : " קונים"} המיקום לא התאים`);
  if (summary.fit.size > 0) out.push(`ל${count(summary.fit.size, "אחד", "")}${summary.fit.size === 1 ? "" : " קונים"} הגודל לא התאים`);
  if (summary.fit.layout > 0) out.push(`ל${count(summary.fit.layout, "אחד", "")}${summary.fit.layout === 1 ? "" : " קונים"} התכנון לא התאים`);
  if (summary.fit.fits > 0) out.push(`${count(summary.fit.fits, "אחד אמר", "אמרו")} שהנכס מתאים להם`);
  return out;
}

/* ==================== וואטסאפ — הכפתורים אחרי הסיור ==================== */

export type ViewingFeedbackField = "price" | "condition" | "fit";

const COMMAND_PREFIX = "משוב סיור";
const FEEDBACK_PAYLOAD = /^משוב סיור:\s*(.+?)\s*\[([0-9A-Z]{26}):(price|condition|fit):([a-z_]+)\]\s*$/u;

function labelFor(field: ViewingFeedbackField, value: string): string {
  if (field === "price") return VIEWING_PRICE_LABELS[value as ViewingPriceFeedback] ?? value;
  if (field === "condition") return VIEWING_CONDITION_LABELS[value as ViewingConditionFeedback] ?? value;
  return VIEWING_FIT_LABELS[value as ViewingFitFeedback] ?? value;
}

/**
 * הפקודה שהכפתור שולח — „משוב סיור: המחיר גבוה [01…:price:high]”.
 *
 * הכפתור נושא את הסיור **והתשובה**, ולכן אין מצב שיחה לשמור: כל
 * לחיצה היא כתיבה אחת, גם אם הסוכן עונה על סיור של אתמול אחרי
 * שהגיעה כבר הודעה על סיור של היום (אותו דפוס כמו כפתורי הפורום).
 */
export function viewingFeedbackCommand(appointmentId: string, field: ViewingFeedbackField, value: string): string {
  return `${COMMAND_PREFIX}: ${labelFor(field, value)} [${appointmentId}:${field}:${value}]`;
}

export function parseViewingFeedbackCommand(
  text: string,
): { appointmentId: string; field: ViewingFeedbackField; value: string } | null {
  const match = FEEDBACK_PAYLOAD.exec(text.trim());
  if (match === null) return null;
  const field = match[3] as ViewingFeedbackField;
  const value = match[4]!;
  const valid =
    field === "price"
      ? isOneOf(VIEWING_PRICE_FEEDBACK, value)
      : field === "condition"
        ? isOneOf(VIEWING_CONDITION_FEEDBACK, value)
        : isOneOf(VIEWING_FIT_FEEDBACK, value);
  return valid ? { appointmentId: match[2]!, field, value } : null;
}

/** השאלה הבאה אחרי תשובה — או `null` כשהמשוב שלם. */
export function nextViewingFeedbackField(current: ViewingFeedbackRow): ViewingFeedbackField | null {
  if (current.price === null) return "price";
  if (current.condition === null) return "condition";
  if (current.fit === null) return "fit";
  return null;
}
