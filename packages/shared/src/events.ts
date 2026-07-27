import { z } from "zod";
import { IdSchema } from "./schemas/common.js";

/**
 * חוזי אירועי הדומיין — האמת היחידה לשמות ול-Payload.
 * כל אירוע נכתב ל-Outbox באותה טרנזקציה עם השינוי, ומופץ ע"י Worker.
 */
export const DomainEvents = {
  "lead.created": z.object({
    leadId: IdSchema,
    tenantId: IdSchema,
    source: z.string(),
    requiresHuman: z.boolean(),
  }),
  "call.summarized": z.object({
    leadId: IdSchema,
    tenantId: IdSchema,
    interactionId: IdSchema,
  }),
  "voice_intake.parsed": z.object({
    intakeId: IdSchema,
    tenantId: IdSchema,
    missingFields: z.array(z.string()),
  }),
  "property.ready": z.object({
    propertyId: IdSchema,
    tenantId: IdSchema,
    readinessScore: z.number().int(),
  }),
  "property.updated": z.object({
    propertyId: IdSchema,
    tenantId: IdSchema,
    changedFields: z.array(z.string()),
  }),
  "buyer.updated": z.object({
    buyerId: IdSchema,
    tenantId: IdSchema,
    changedFields: z.array(z.string()),
  }),
  "matches.computed": z.object({
    tenantId: IdSchema,
    propertyId: IdSchema.optional(),
    buyerId: IdSchema.optional(),
    matchCount: z.number().int(),
  }),
  "offer.sent": z.object({ offerId: IdSchema, tenantId: IdSchema }),
  "offer.opened": z.object({ offerId: IdSchema, tenantId: IdSchema, openCount: z.number().int() }),
  "offer.interested": z.object({ offerId: IdSchema, tenantId: IdSchema }),
  "appointment.scheduled": z.object({
    appointmentId: IdSchema,
    tenantId: IdSchema,
    startsAt: z.coerce.date(),
  }),
} as const;

export type DomainEventName = keyof typeof DomainEvents;

export type DomainEventPayload<E extends DomainEventName> = z.infer<(typeof DomainEvents)[E]>;

export interface DomainEventEnvelope<E extends DomainEventName = DomainEventName> {
  id: string;
  name: E;
  tenantId: string;
  payload: DomainEventPayload<E>;
  occurredAt: string;
}
