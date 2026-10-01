import { z } from "zod";

export const TenantStatusSchema = z.enum(["active", "trial", "suspended", "churned"]);
