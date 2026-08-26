import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { z } from "zod";
import {
  DOCUMENT_KINDS,
  documentUnlocksOffers,
  IdSchema,
  MAX_DOCUMENT_BYTES,
  parseSignedOnDate,
} from "@metavchim/shared";
import { RequireCapability } from "../../common/auth.decorators";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import {
  SignedDocumentsService,
  type SignedDocumentDto,
} from "./signed-documents.service";

/**
 * מסמכים שנחתמו על נייר — העלאה, רשימה, הורדה ומחיקה.
 *
 * ## היכולות
 *
 * העלאה ומחיקה תחת `offers.send`, בדיוק כמו יצירת הסכם ושליחתו: זו
 * אותה פעולה מבחינת המשרד — להביא הסכם חתום לתוך התיק — ויכולת
 * חדשה הייתה משאירה את כל המשתמשים הקיימים בלי הרשאה עד שמנהל
 * המשרד יבחין ויעדכן.
 *
 * קריאה תחת `buyers.view_own`, כמו רשימת ההסכמים. בדיקת הבעלות על
 * הלקוח עצמה נעשית בשירות — גם ברשימה וגם בהורדה לפי מזהה.
 */

/*
 * ‎`multipart/form-data` מוסר כל שדה כמחרוזת: אין כאן Date ואין
 * מספר. הסכמה מקבלת מחרוזות וממירה בעצמה, ומה שאינו תאריך תקין
 * נדחה כאן ולא הופך ל-`Invalid Date` שנשמר בשקט.
 */
const UploadSchema = z
  .object({
    contactId: IdSchema,
    kind: z.enum(DOCUMENT_KINDS),
    propertyId: IdSchema.optional(),
    /**
     * ‎YYYY-MM-DD, ו**קיים בלוח השנה**.
     *
     * הרגקס לבדו בדק צורה בלבד: `2026-02-31` גלש בשקט ל-3 במרץ
     * ונשמר כתאריך החתימה, ו-`2026-13-01` הפך ל-`Invalid Date`
     * שכל השוואה עליו היא `false` — כלומר הוא **עבר** את בדיקת
     * „לא עתידי” והגיע למסד (ביקורת Codex). ההמרה עצמה חיה
     * ב-shared ונבדקת שם.
     */
    signedOn: z
      .string()
      .refine((value) => parseSignedOnDate(value) !== null, "תאריך לא תקין")
      .optional(),
    signerName: z.string().min(2).max(120).optional(),
    note: z.string().max(500).optional(),
    /** שם הקובץ כפי שהדפדפן מסר — מנוקה בשירות (`safeFileName`) */
    fileName: z.string().max(300).optional(),
  })
  .strict()
  /*
   * ‎**„מסמך אחר” אינו נושא פרטי חתימה.**
   *
   * הסכמה הרשתה את הצירוף, והוא לא היה תיאורטי: תאריך חתימה על
   * מסמך מסוג `other` הפך אותו לשורה שמחיקת לקוח **שומרת** — ולכן
   * תעודת זהות של לקוח שביקש להימחק הייתה נשארת במסד וב-S3 לנצח
   * (ביקורת Codex). התנאי לשמירה תוקן לפי הסוג, וגם הקלט הזה נחסם:
   * נתון שאין לו משמעות ויש לו תוצאה לא ייכתב מלכתחילה.
   */
  .refine(
    (body) =>
      documentUnlocksOffers(body.kind) ||
      (body.signedOn === undefined && body.signerName === undefined),
    { message: "„מסמך אחר” נשמר בלי פרטי חתימה — בחרו סוג הסכם כדי לציין מי חתם ומתי" },
  )
  /*
   * ‎**הצהרה על הסכם חתום נוקבת בנכס.**
   *
   * ההזמנה בכתב מתארת נכס מסוים, ו-`hasSigned` מחפש חתימה על אותו
   * נכס בדיוק. מסמך שנשמר בלי נכס אינו פותח שום הצעה — ולכן מסך
   * שאמר „אפשר לשלוח הצעות” אחרי העלאה כזו הבטיח פעולה שהמערכת לא
   * ביצעה (ביקורת Codex). זה נאכף כאן ולא רק במסך, כי הבטחה שקרית
   * לא נולדת במסך אלא בשורה שנכתבה.
   */
  .refine((body) => !documentUnlocksOffers(body.kind) || body.propertyId !== undefined, {
    message: "הסכם חתום נוגע לנכס מסוים — בחרו את הנכס שההסכם חל עליו",
  });

const IdParam = new ZodValidationPipe(IdSchema);

@Controller()
export class SignedDocumentsController {
  constructor(private readonly documents: SignedDocumentsService) {}

  @Post("signed-documents")
  @RequireCapability("offers.send")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 } }))
  upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(new ZodValidationPipe(UploadSchema)) body: z.infer<typeof UploadSchema>,
  ): Promise<SignedDocumentDto> {
    const signedOn = body.signedOn === undefined ? null : parseSignedOnDate(body.signedOn);
    return this.documents.upload(file?.buffer ?? Buffer.alloc(0), {
      contactId: body.contactId,
      kind: body.kind,
      ...(body.propertyId !== undefined ? { propertyId: body.propertyId } : {}),
      ...(body.fileName !== undefined ? { fileName: body.fileName } : {}),
      /*
       * אותה פונקציה שהסכמה אימתה איתה, ולא בנייה שנייה מהמחרוזת:
       * שתי קריאות של אותו טקסט הן בדיוק המקום שבו „נבדק” ו„נשמר”
       * מתפצלים.
       */
      ...(signedOn !== null ? { signedOn } : {}),
      ...(body.signerName !== undefined ? { signerName: body.signerName } : {}),
      ...(body.note !== undefined ? { note: body.note } : {}),
    });
  }

  /**
   * ‎`propertyId` מצמצם לנכס אחד — ולשורות בלי נכס, שהן בהכרח
   * „מסמך אחר” ושייכות ללקוח עצמו. בלעדיו סריקת בלעדיות של נכס
   * אחד הופיעה בלשונית של נכס אחר של אותו בעלים (ביקורת Codex).
   */
  @Get("signed-documents/contact/:contactId")
  @RequireCapability("buyers.view_own")
  list(
    @Param("contactId", IdParam) contactId: string,
    @Query("propertyId", new ZodValidationPipe(IdSchema.optional())) propertyId?: string,
  ): Promise<SignedDocumentDto[]> {
    return this.documents.listForContact(contactId, propertyId);
  }

  /**
   * המסמכים ששרדו מחיקת לקוח — ארכיון המשרד.
   *
   * מוצב **לפני** הנתיבים עם הפרמטר כדי ש-"retained" לא ייקלט
   * כמזהה, בדיוק כמו `/agreements/retained`. אותה יכולת ואותו
   * נימוק: לשורה מנותקת אין לקוח שמולו לבדוק בעלות, ולכן השער הוא
   * הרשאת ניהול המשרד.
   */
  @Get("signed-documents/retained")
  @RequireCapability("settings.manage")
  retained(): Promise<SignedDocumentDto[]> {
    return this.documents.listRetained();
  }

  @Get("signed-documents/retained/:id/raw")
  @RequireCapability("settings.manage")
  @Header("Cache-Control", "no-store")
  @Header("X-Content-Type-Options", "nosniff")
  async retainedRaw(@Param("id", IdParam) id: string): Promise<StreamableFile> {
    return this.stream(await this.documents.getRaw(id, { retained: true }));
  }

  /**
   * הקובץ עצמו.
   *
   * ‎`attachment` ולא `inline`: הקובץ הוא PDF או תמונה שהמשתמש העלה,
   * והצגתו בתוך הדפדפן באותו מקור כמו המערכת הופכת אותו לתוכן פעיל
   * שרץ שם. הורדה היא מה שהמתווך רוצה ממסמך חתום בכל מקרה.
   *
   * ‎`no-store` ולא cache: מסמך חתום נושא שם ומספר זהות, ואין סיבה
   * שיישאר בדיסק של הדפדפן אחרי שנסגר.
   */
  @Get("signed-documents/:id/raw")
  @RequireCapability("buyers.view_own")
  @Header("Cache-Control", "no-store")
  @Header("X-Content-Type-Options", "nosniff")
  async raw(@Param("id", IdParam) id: string): Promise<StreamableFile> {
    return this.stream(await this.documents.getRaw(id));
  }

  /** אותה תגובה לשני מסלולי ההורדה — כותרת אחת, לא שתי גרסאות שיסטו. */
  private stream(obj: {
    body: NodeJS.ReadableStream;
    contentType?: string;
    contentLength?: number;
    fileName: string;
  }): StreamableFile {
    return new StreamableFile(obj.body as never, {
      type: obj.contentType ?? "application/octet-stream",
      ...(obj.contentLength !== undefined ? { length: obj.contentLength } : {}),
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(obj.fileName)}`,
    });
  }

  @Delete("signed-documents/:id")
  @RequireCapability("offers.send")
  @HttpCode(204)
  async remove(@Param("id", IdParam) id: string): Promise<void> {
    await this.documents.remove(id);
  }
}
