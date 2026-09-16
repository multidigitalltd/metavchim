import { z } from "zod";
import { IdSchema } from "./common.js";
import { OPEN_HOUSE_MAX_CAPACITY, OPEN_HOUSE_MAX_HOURS, OPEN_HOUSE_SLOT_MINUTES } from "../logic/open-house.js";

const IsoDate = z.string().datetime({ offset: true });

/** ‏אורך האירוע — שני רגעים מוחלטים (ISO עם אזור), לא שעון המכשיר */
function spanMs(v: { startsAt: string; endsAt: string }): number {
  return new Date(v.endsAt).getTime() - new Date(v.startsAt).getTime();
}

/** ‏יצירת אירוע — המתווך. */
export const OpenHouseCreateSchema = z
  .object({
    startsAt: IsoDate,
    endsAt: IsoDate,
    slotMinutes: z.union(OPEN_HOUSE_SLOT_MINUTES.map((m) => z.literal(m)) as [z.ZodLiteral<number>, z.ZodLiteral<number>, ...z.ZodLiteral<number>[]]),
    /** ‏מקומות למשבצת; `null` = בלי הגבלה */
    slotCapacity: z.number().int().min(1).max(OPEN_HOUSE_MAX_CAPACITY).nullable().default(null),
  })
  .refine((v) => spanMs(v) > 0, { message: "שעת הסיום חייבת להיות אחרי ההתחלה", path: ["endsAt"] })
  .refine((v) => spanMs(v) <= OPEN_HOUSE_MAX_HOURS * 3_600_000, {
    message: `בית פתוח נמשך עד ${OPEN_HOUSE_MAX_HOURS} שעות`,
    path: ["endsAt"],
  })
  .refine((v) => spanMs(v) / 60_000 >= v.slotMinutes, {
    message: "האירוע קצר ממשבצת אחת",
    path: ["slotMinutes"],
  });
export type OpenHouseCreate = z.infer<typeof OpenHouseCreateSchema>;

export const OpenHouseStatusUpdateSchema = z.object({ status: z.enum(["done", "cancelled"]) });
export type OpenHouseStatusUpdate = z.infer<typeof OpenHouseStatusUpdateSchema>;

/** ‏הרשמה מהדף הציבורי. */
export const OpenHouseRegisterSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(9).max(20),
  slotAt: IsoDate,
  /** honeypot */
  website: z.string().max(200).optional(),
});
export type OpenHouseRegister = z.infer<typeof OpenHouseRegisterSchema>;

/** ‏מבקר שהגיע בלי להירשם — המתווך רושם בשטח. */
export const OpenHouseWalkInSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(9).max(20),
  slotAt: IsoDate.optional(),
});
export type OpenHouseWalkIn = z.infer<typeof OpenHouseWalkInSchema>;

export const OpenHouseVisitorUpdateSchema = z.object({ arrived: z.boolean() });
export type OpenHouseVisitorUpdate = z.infer<typeof OpenHouseVisitorUpdateSchema>;

export const OpenHouseIdParams = z.object({ id: IdSchema, ohId: IdSchema });
