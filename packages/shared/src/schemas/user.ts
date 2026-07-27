import { z } from "zod";
import { IdSchema, PhoneSchema } from "./common.js";

export const UserRoleSchema = z.enum(["owner", "admin", "agent", "assistant", "viewer"]);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const UserSchema = z.object({
  id: IdSchema,
  tenantId: IdSchema,
  name: z.string().min(2).max(120),
  email: z.string().email(),
  phone: PhoneSchema.optional(),
  role: UserRoleSchema,
  isActive: z.boolean().default(true),
  createdAt: z.coerce.date(),
});
export type User = z.infer<typeof UserSchema>;
