import "./env.js";
import IORedis from "ioredis";
import { PrismaClient } from "@prisma/client";

/** ‏החיבורים של התהליך — Redis אחד ו-Prisma אחד, משותפים לכל המשימות. */
export const connection = new IORedis(
  process.env["REDIS_URL"] ?? "redis://localhost:6379",
  {
    maxRetriesPerRequest: null,
  },
);
export const prisma = new PrismaClient();
