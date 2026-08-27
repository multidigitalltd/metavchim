import { GoneException, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { PrismaService } from "./prisma.service";

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

  constructor(private readonly prisma: PrismaService) {
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

  /**
   * העלאת אובייקט — **ושער המחיקה של המשרד, בנקודה אחת.**
   *
   * מחיקת משרד אוספת את מפתחות ה-S3 ואז מוחקת את השורות שמכירות
   * אותם. העלאה שרצה במקביל מסתיימת באחד משני סידורים, ושניהם
   * משאירים קובץ של לקוח אחרי שהמשרד ביקש להימחק (#258).
   *
   * ‎**כאן ולא בכל נתיב העלאה בנפרד.** דגל שכל קורא „זוכר לבדוק” הוא
   * דגל שהקורא השמיני ישכח — והמשטח כבר גדל מחמש טבלאות לשבע מאז
   * שהנושא נכתב. זו הנקודה היחידה שכל העלאה עוברת בה, ולכן טבלה
   * שתיכתב בעוד שנה מקבלת את הכלל בלי לדעת עליו.
   *
   * ‎**הבדיקה אחרי ההעלאה, ולא לפניה — וזה העיקר.** בדיקה מקדימה
   * מצמצמת את החלון ואינה סוגרת אותו: היא יכולה לעבור שבריר שנייה
   * לפני שהדגל נקבע, וההעלאה שאחריה משאירה אובייקט שאיש לא יאסוף.
   * בדיקה שאחרי ההעלאה הופכת את הכיוון: אם הדגל נקבע עד אליה,
   * המעלה **מוחק את מה שהעלה בעצמו**; ואם לא נקבע עד אליה, האובייקט
   * קיים לפני שהדגל נקבע ולכן לפני האיסוף שבא אחריו.
   *
   * ‎`tenantId: null` = קובץ שאינו של משרד (פנייה מאדם שאינו לקוח).
   * מפורש ולא ברירת מחדל: „שכחתי להעביר” ו„אין משרד” חייבים להיראות
   * שונה בקריאה.
   */
  async put(
    key: string,
    body: Buffer,
    contentType: string,
    tenantId: string | null,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
    if (tenantId === null) return;
    if (await this.acceptsFiles(tenantId)) return;
    /*
     * מוחקים את מה שהעלינו. כשל במחיקה אינו מסתיר את הכשל בהעלאה —
     * הוא מדווח, וההעלאה נדחית בכל מקרה; אובייקט שנשאר כאן ייאסף
     * בסריקה של האחסון ולא יופיע בשום מסך, כי אין שורה שמצביעה
     * עליו.
     */
    try {
      await this.delete(key);
    } catch (error) {
      this.logger.error(`מחיקת אובייקט שהועלה למשרד שנמחק נכשלה: ${(error as Error).message}`);
    }
    throw new GoneException("המשרד נמחק — לא ניתן להעלות אליו קבצים");
  }

  /**
   * האם המשרד עדיין מקבל קבצים.
   *
   * ‎**בלי מטמון, בכוונה.** ערך שנשמר לשנייה אחת פותח מחדש בדיוק את
   * החלון שהשער הזה בא לסגור, והמחיר — קריאת אינדקס אחת להעלאה —
   * זניח מול העלאה של קובץ.
   *
   * משרד שאיננו אינו מקבל קבצים: `null` מהשאילתה הוא „נמחק כבר”,
   * לא „לא ידוע”.
   */
  private async acceptsFiles(tenantId: string): Promise<boolean> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { filesLockedAt: true },
    });
    return tenant !== null && tenant.filesLockedAt === null;
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
