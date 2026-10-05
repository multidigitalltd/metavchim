import { BuyerMaturitySchema, type BuyerMaturity } from "@metavchim/shared";

/**
 * ‎**צבעי הבשלות — מקור אחד לכל מסך שמציג גלולה.**
 *
 * ‏כרטיס הקונה, רשימת הקונים וההתאמות בכרטיס הנכס החזיקו כל אחד
 * ‏עותק של אותה טבלה, ודרגה חדשה הייתה נכנסת לאחד ונשכחת בשני.
 * ‏ה-`Record` על `BuyerMaturity` אוכף שכל ערך בסכימה צבוע.
 */
const TONES: Record<BuyerMaturity, { fg: string; bg: string }> = {
  very_hot: { fg: "var(--color-danger)", bg: "var(--color-danger-soft)" },
  hot: { fg: "var(--domain-amber-fg)", bg: "var(--domain-amber-bg)" },
  interested: { fg: "var(--color-success)", bg: "var(--color-success-soft)" },
  not_ripe: { fg: "var(--chip-neutral-fg)", bg: "var(--chip-neutral-bg)" },
  /* ‏רקע אדום מלא — „לא רלוונטי” נבדל ממבט מ„חם מאוד” שעל רקע אדום בהיר */
  not_relevant: { fg: "var(--color-on-danger)", bg: "var(--color-danger)" },
};

export function maturityTone(maturity: string): { fg: string; bg: string } {
  return (TONES as Partial<Record<string, { fg: string; bg: string }>>)[maturity] ?? TONES.not_ripe;
}

/** ‏סדר המיון — מהחם אל הקר, ו„לא רלוונטי” בסוף. */
export const MATURITY_ORDER: readonly string[] = BuyerMaturitySchema.options;
