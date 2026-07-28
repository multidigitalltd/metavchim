import { z } from "zod";
import { IdSchema } from "./common.js";

export const TenantPlanSchema = z.enum(["basic", "pro", "agency", "enterprise"]);
export type TenantPlan = z.infer<typeof TenantPlanSchema>;

export const TenantStatusSchema = z.enum(["active", "trial", "suspended", "churned"]);

export const TenantSchema = z.object({
  id: IdSchema,
  name: z.string().min(2).max(120),
  plan: TenantPlanSchema,
  status: TenantStatusSchema,
  settings: z
    .object({
      locale: z.enum(["he"]).default("he"),
      timezone: z.string().default("Asia/Jerusalem"),
      businessHours: z
        .object({ start: z.string(), end: z.string() })
        .optional(),
    })
    .default({ locale: "he", timezone: "Asia/Jerusalem" }),
  createdAt: z.coerce.date(),
});
export type Tenant = z.infer<typeof TenantSchema>;
