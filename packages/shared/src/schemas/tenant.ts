import * as z from "../zod.js";

export const TenantStatusSchema = z.enum(["active", "trial", "suspended", "churned"]);
