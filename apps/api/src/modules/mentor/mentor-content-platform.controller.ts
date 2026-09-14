import { Body, Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { CONTENT_NOTES_MAX, CONTENT_TITLE_MAX, IdSchema } from "@metavchim/shared";
import { PlatformAdmin } from "../../common/auth.decorators";
import { PlatformAdminGuard } from "../../common/platform-admin.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { MentorContentService, type MentorContentDto } from "./mentor-content.service";

/**
 * ‎**התוכן המשותף — סרטונים ופודקאסטים שכל המשרדים רואים.**
 *
 * ## ‏למה בקר נפרד ולא נתיב נוסף ב-`mentor.controller`
 *
 * ‏הבקר של המנטור חסום ביכולות של משרד; כאן השער הוא **מעל כל
 * ‏הדיירים**. שני סוגי שער על אותה מחלקה הם בדיוק המקום שבו
 * ‏נתיב חדש מקבל בטעות את השער הלא נכון — ולכן מחלקה משלה, עם
 * ‎`PlatformAdminGuard` ברמת המחלקה: נתיב שנוסף כאן חסום כברירת
 * ‏מחדל, ולא „אם זכרו”.
 *
 * ## ‏ולמה במודול המנטור ולא במודול הפלטפורמה
 *
 * ‏השירות יושב כאן, ו-`PlatformAdminGuard` תלוי ב-`Reflector`
 * ‏וב-Prisma הגלובלי בלבד. ייצוא השירות החוצה רק כדי להזיז בקר
 * ‏של ארבע שורות היה מרחיב את שטח הפנים של המודול בלי תמורה.
 */
const PlatformContentSchema = z
  .object({
    title: z.string().trim().min(2).max(CONTENT_TITLE_MAX),
    notes: z.string().trim().max(CONTENT_NOTES_MAX).optional(),
    /*
     * ‏מחרוזת, לא „קוד הטמעה”. `parseContentUrl` בשירות קורא אותה
     * ‏ומחזיר מזהה; שדה שמקבל HTML היה הזרקה למסך של כל מתווך
     * ‏במערכת, ומנהל הפלטפורמה הוא מי שמדביק אותו.
     */
    url: z.string().url().max(2000),
    /* ‏סדר התצוגה. ברירת המחדל בטבלה היא 0, וקטן קודם. */
    sortOrder: z.number().int().min(0).max(9999).optional(),
  })
  .strict();

@Controller("platform")
@UseGuards(PlatformAdminGuard)
@PlatformAdmin()
export class MentorContentPlatformController {
  constructor(private readonly content: MentorContentService) {}

  @Get("mentor-content")
  list(): Promise<MentorContentDto[]> {
    return this.content.listPlatform();
  }

  @Post("mentor-content")
  create(
    @Body(new ZodValidationPipe(PlatformContentSchema))
    body: z.infer<typeof PlatformContentSchema>,
  ): Promise<MentorContentDto> {
    return this.content.createPlatform(body);
  }

  @Delete("mentor-content/:id")
  remove(@Param("id", new ZodValidationPipe(IdSchema)) id: string): Promise<void> {
    return this.content.removePlatform(id);
  }
}
