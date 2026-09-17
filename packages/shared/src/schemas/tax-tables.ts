import { z } from "zod";

const Bracket = z.object({ upTo: z.number().positive().nullable(), percent: z.number().min(0).max(100) });
const Brackets = z
  .array(Bracket)
  .min(1)
  .max(8)
  .refine((rows) => rows.slice(0, -1).every((row) => row.upTo !== null) && rows[rows.length - 1]!.upTo === null, {
    message: "כל המדרגות עד האחרונה צריכות תקרה, והאחרונה בלי תקרה",
  })
  .refine((rows) => rows.slice(0, -1).every((row, i) => i === 0 || (row.upTo ?? 0) > (rows[i - 1]!.upTo ?? 0)), {
    message: "התקרות צריכות לעלות ממדרגה למדרגה",
  });

/** ‏הטבלאות שמנהל הפלטפורמה מעדכן מדי ינואר — ראו `TaxTables` */
export const TaxTablesSchema = z.object({
  purchase: z.object({ year: z.number().int().min(2020).max(2100), singleHome: Brackets, additionalHome: Brackets }),
  capitalGains: z.object({ year: z.number().int().min(2020).max(2100), singleHomeCeiling: z.number().int().positive() }),
});
export type TaxTablesInput = z.infer<typeof TaxTablesSchema>;
