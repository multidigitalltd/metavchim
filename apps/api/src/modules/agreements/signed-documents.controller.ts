import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { z } from "zod";
import { DOCUMENT_KINDS, IdSchema, MAX_DOCUMENT_BYTES } from "@metavchim/shared";
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
    /** ‎YYYY-MM-DD — מה שהמתווך הקליד בשדה התאריך */
    signedOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u, "תאריך לא תקין")
      .optional(),
    signerName: z.string().min(2).max(120).optional(),
    note: z.string().max(500).optional(),
    /** שם הקובץ כפי שהדפדפן מסר — מנוקה בשירות (`safeFileName`) */
    fileName: z.string().max(300).optional(),
  })
  .strict();

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
    return this.documents.upload(file?.buffer ?? Buffer.alloc(0), {
      contactId: body.contactId,
      kind: body.kind,
      ...(body.propertyId !== undefined ? { propertyId: body.propertyId } : {}),
      ...(body.fileName !== undefined ? { fileName: body.fileName } : {}),
      /*
       * ‎`T00:00:00Z` ולא `new Date("2026-08-26")` בלבד — אותה
       * מחרוזת, אבל המפורשת אומרת מה נשמר. העמודה היא DATE, והשעה
       * נזרקת בכל מקרה.
       */
      ...(body.signedOn !== undefined ? { signedOn: new Date(`${body.signedOn}T00:00:00Z`) } : {}),
      ...(body.signerName !== undefined ? { signerName: body.signerName } : {}),
      ...(body.note !== undefined ? { note: body.note } : {}),
    });
  }

  @Get("signed-documents/contact/:contactId")
  @RequireCapability("buyers.view_own")
  list(
    @Param("contactId", IdParam) contactId: string,
  ): Promise<SignedDocumentDto[]> {
    return this.documents.listForContact(contactId);
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
    const obj = await this.documents.getRaw(id);
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
