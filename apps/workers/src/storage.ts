import { type Job } from "bullmq";
import { DeleteObjectCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { z } from "zod";

const s3 = new S3Client({
  endpoint: process.env["S3_ENDPOINT"] ?? "http://localhost:9000",
  region: process.env["S3_REGION"] ?? "us-east-1",
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env["S3_ACCESS_KEY"] ?? "",
    secretAccessKey: process.env["S3_SECRET_KEY"] ?? "",
  },
});
const CleanupJobSchema = z.object({
  tenantId: z.string(),
  s3Key: z.string().max(512),
});

/** קריאת אובייקט מהאחסון אל הזיכרון — להזנת שירות התמלול. */
export async function storageGet(key: string): Promise<Buffer> {
  const res = await s3.send(
    new GetObjectCommand({
      Bucket: process.env["S3_BUCKET"] ?? "metavchim",
      Key: key,
    }),
  );
  const bytes = await res.Body?.transformToByteArray();
  if (!bytes) throw new Error(`empty object: ${key}`);
  return Buffer.from(bytes);
}

/**
 * ניקוי אובייקט אחסון שמחיקתו נכשלה ב-Request (ביקורת Codex, PR #12):
 * DeleteObject אידמפוטנטי — מפתח שכבר נמחק מסתיים בהצלחה; BullMQ מנסה
 * שוב עם Backoff עד 10 פעמים.
 */
export async function processCleanup(job: Job): Promise<void> {
  const { s3Key } = CleanupJobSchema.parse(job.data);
  await s3.send(
    new DeleteObjectCommand({
      Bucket: process.env["S3_BUCKET"] ?? "metavchim",
      Key: s3Key,
    }),
  );
}
