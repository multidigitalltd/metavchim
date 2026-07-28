import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * אחסון אובייקטים S3-תואם (MinIO מקומית, S3/R2 בפרודקשן — docs/05).
 * העלאה עוברת דרך ה-API (ולידציה בצד השרת); צפייה ב-URL חתום קצר-מועד,
 * כך שהדפדפן לא זקוק לעוגיית Session מול שרת האחסון.
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

  /** URL צפייה חתום — ברירת מחדל שעה. */
  async signedGetUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: expiresInSeconds,
    });
  }
}
