import { Controller, HttpCode, NotFoundException, Param, Post } from "@nestjs/common";
import { z } from "zod";

import { Public } from "../../common/auth.decorators";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { PrismaService } from "../../core/prisma.service";

/** אותה צורה כמו הטוקנים הציבוריים האחרים: base64url, אורך קבוע. */
const TokenSchema = z.string().min(20).max(64).regex(/^[A-Za-z0-9_-]+$/u);

/**
 * ‎**הסרה מתזכורות ההפעלה — הקישור שבתחתית כל תזכורת.**
 *
 * ## למה נתיב ציבורי
 *
 * חוק התקשורת §30א דורש דרך פשוטה וסבירה להודיע על סירוב.
 * ‏„היכנסו למערכת והסירו” אינה כזו בשום מקרה, ובוודאי לא כאן:
 * ההודעה נשלחת דווקא למי שהחשבון שלו ננעל או עומד להינעל, כלומר
 * למי שאולי כבר אינו יכול להיכנס.
 *
 * ## מה מוגן, ואיך
 *
 * הטוקן אקראי (32 בתים) ויושב בטבלה שאין בה דבר מלבדו וההסרה
 * עצמה — לא שם, לא כתובת ולא סיסמה. הפוליסה ב-RLS חושפת את השורה
 * היחידה שהטוקן שלה הוצג. זו הסיבה שהעמודה אינה על `users`:
 * ‏RLS אינו יודע להגביל עמודות, ופוליסה כזו שם הייתה פותחת את כל
 * שורת המשתמש לטרנזקציה הציבורית.
 *
 * ## ולמה POST ולא GET
 *
 * קישור במייל נפתח גם בידי סורקי אבטחה של ארגונים. `GET` שמסיר
 * היה מסיר אנשים שמעולם לא לחצו. אותה הכרעה בדיוק כמו בהסרה
 * מהצעות הנכסים.
 *
 * ## ובלי תקרה משלו (ביקורת Codex)
 *
 * ‏הנתיב הזה הוא גם יעד כפתור „ביטול הרשמה” של ספק הדואר
 * ‏(`List-Unsubscribe-Post`), ושם הבקשות מגיעות מהתשתית המשותפת של
 * ‏הספק — הרבה נמענים מאותה כתובת. תקרה של עשרים לדקה לכל כתובת
 * ‏הייתה מחזירה 429 להסרות אמיתיות ומשאירה אנשים ברשימה בניגוד
 * ‏לבקשתם. התקרה הכללית לכל כתובת נשארת, כמו בשני נתיבי ההסרה
 * ‏האחרים; ניחוש של טוקן בן 32 בתים אקראיים אינו מעשי בכל קצב.
 */
@Controller()
export class ActivationNudgeController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Post("public/nudge/:token/optout")
  @HttpCode(200)
  async optOut(
    @Param("token", new ZodValidationPipe(TokenSchema)) token: string,
  ): Promise<{ ok: true }> {
    await this.prisma.withPublicNudge(token, async (tx) => {
      /*
       * ‎**אידמפוטנטי, ובכוונה גם אחרי שכבר הוסר.** לחיצה שנייה על
       * אותו קישור — מהמייל שנשמר בתיבה — אינה מזיזה את מועד ההסרה
       * ואינה מחזירה שגיאה. „הקישור אינו תקין” למי שעשה בדיוק את
       * מה שביקשנו ממנו הוא בדיוק ההפך מ„דרך פשוטה וסבירה”.
       */
      const changed = await tx.activationNudgeOptOut.updateMany({
        where: { token, optedOutAt: null },
        data: { optedOutAt: new Date() },
      });
      if (changed.count > 0) return;
      // לא עודכן דבר: או שכבר הוסר, או שהטוקן אינו קיים
      const existing = await tx.activationNudgeOptOut.findFirst({
        where: { token },
        select: { id: true },
      });
      if (existing === null) throw new NotFoundException("הקישור אינו תקין");
    });
    return { ok: true };
  }
}
