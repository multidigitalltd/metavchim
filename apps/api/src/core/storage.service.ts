import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

/**
 * אחסון אובייקטים S3-תואם (MinIO מקומית, S3/R2 בפרודקשן — docs/05).
 *
 * העלאה וצפייה עוברות שתיהן דרך ה-API: הוא מוודא הרשאה ומזרים את
 * הקובץ. **אין כאן חתימת כתובות.** חתימת SigV4 כוללת את ה-Host, ולכן
 * כתובת חתומה שנשלחת לדפדפן נשברת בכל התקנה שבה האחסון יושב על רשת
 * פנימית או מאחורי שער — וזה בדיוק המצב בפרודקשן שלנו. הפונקציה
 * שחתמה כתובות הוסרה כדי שהמסלול הזה לא ייווצר שוב.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    this.bucket = process.env["S3_BUCKET"] ?? "metavchim";
    this.client = new S3Client({
      endpoint: process.env["S3_ENDPOINT"] ?? "http://localhost:9000",
      region: process.env["S3_REGION"] ?? "us-east-1",
      forcePathStyle: true, // נדרש ל-MinIO
      credentials: {
        accessKeyId: process.env["S3_ACCESS_KEY"] ?? "",
        secretAccessKey: process.env["S3_SECRET_KEY"] ?? "",
      },
    });
  }

  /** יצירת ה-Bucket בפיתוח אם חסר — בפרודקשן הוא מסופק מראש (IaC). */
  async onModuleInit(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Bucket "${this.bucket}" נוצר`);
      } catch (error) {
        // אחסון לא זמין ≠ המערכת לא עולה — הפיצ'רים שתלויים בו יחזירו שגיאה ברורה
        this.logger.warn(`אחסון אובייקטים לא זמין: ${(error as Error).message}`);
      }
    }
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /** האם השגיאה היא "האובייקט לא קיים" — להבדיל מכשל תשתית זמני. */
  static isMissingObjectError(error: unknown): boolean {
    const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    return e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404;
  }

  /**
   * קריאת אובייקט להזרמה דרך ה-API — הדפדפן לא מדבר עם שרת האחסון
   * ישירות (בפרודקשן MinIO על רשת פנימית בלבד, ללא כתובת ציבורית).
   */
  async getObject(
    key: string,
  ): Promise<{ body: NodeJS.ReadableStream; contentType?: string; contentLength?: number }> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return {
      body: res.Body as NodeJS.ReadableStream,
      contentType: res.ContentType,
      contentLength: res.ContentLength,
    };
  }
}
