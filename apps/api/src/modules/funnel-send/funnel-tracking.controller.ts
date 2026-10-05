import { Controller, Get, Logger, Param, Res } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import type { Response } from "express";
import { PublicTokenSchema } from "../../common/zod-validation.pipe";
import { Public } from "../../common/auth.decorators";
import { loadEnv } from "../../config/env";
import { PrismaService, type TenantTx } from "../../core/prisma.service";
import { confirmMessageOut } from "./funnel-report.service";

/** ‏GIF שקוף בגודל נקודה — התשובה לפיקסל הפתיחה, תמיד. */
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

/**
 * ‎**מעקב פתיחה ולחיצה על הודעות מסלול ההמרה — ציבורי, לפי טוקן.**
 *
 * ‏הטוקן אקראי לכל שורת הודעה (`funnel_messages.token`) ולכן אי אפשר
 * ‏לנחש אותו ולזייף „נפתח”. שתי הפעולות **רושמות פעם אחת** — הרגע
 * ‏הראשון נשמר, וטעינה חוזרת אינה מזיזה אותו.
 *
 * ‏שני הנתיבים לעולם אינם נכשלים כלפי הנמען: טוקן שגוי עדיין מקבל
 * ‏תמונה, ולחיצה עליו עדיין מובילה למערכת. מה שלא נמצא פשוט לא נרשם —
 * ‏וגם תקלה במסד אינה הופכת את הכפתור לדף שגיאה (ביקורת Codex): המדידה
 * ‏היא תוספת, והניווט הוא העיקר.
 *
 * ‎**היעד של לחיצה נבנה מהשלב, לא מהבקשה** — המקור של המערכת ועוד
 * ‏הנתיב היחסי שנשמר בשלב. אין כאן פרמטר שאפשר להפוך להפניה החוצה.
 *
 * ‎**בלי תקרה לפי IP** (ביקורת Codex). Gmail טוען את הפיקסל דרך כמה
 * ‏שרתי מתווך, וסורקי דואר ארגוניים פותחים קישורים מכתובת אחת — תקרה
 * ‏משותפת הייתה מחזירה 429 לנמענים אמיתיים, כלומר כפתור שבור. אין כאן
 * ‏מה לנחש (טוקן של 256 סיביות), וכל בקשה עולה לכל היותר קריאה אחת
 * ‏באינדקס וכתיבה אחת בפעם הראשונה; טוקן פסול נדחה לפני המסד.
 */
/**
 * ‎**השורה לפי הטוקן — נעולה עד סוף הרישום** (ביקורת Codex). תפיסה מחדש
 * ‏לכתובת אחרת מחליפה את הטוקן; בלי הנעילה, פתיחה מהמייל הישן הייתה
 * ‏מוצאת את השורה, ואז כותבת על הניסיון החדש אחרי שהטוקן כבר הוחלף.
 * ‏עם הנעילה — מי שבא שני רואה את מה שהראשון כתב, וטוקן ישן לא מוצא דבר.
 */
async function lockByToken(tx: TenantTx, token: string): Promise<{ id: string } | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM funnel_messages WHERE token = ${token} FOR UPDATE`;
  return rows[0] ?? null;
}

@Controller("public/funnel")
export class FunnelTrackingController {
  private readonly logger = new Logger(FunnelTrackingController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @SkipThrottle()
  @Get("o/:token")
  async open(@Param("token") token: string, @Res() res: Response): Promise<void> {
    if (PublicTokenSchema.safeParse(token).success) {
      try {
        const now = new Date();
        await this.prisma.withFunnelAdmin(async (tx) => {
          const message = await lockByToken(tx, token);
          if (message === null) return;
          await tx.funnelMessage.updateMany({
            where: { id: message.id, openedAt: null },
            data: { openedAt: now },
          });
          // ‏נפתחה — כלומר הגיעה, גם אם השליחה נרשמה אצלנו ככושלת
          await confirmMessageOut(tx, message.id, now);
        });
      } catch (error: unknown) {
        this.logger.warn(`רישום פתיחה נכשל: ${String(error)}`);
      }
    }
    res.setHeader("Content-Type", "image/gif");
    res.setHeader("Cache-Control", "no-store");
    res.end(PIXEL);
  }

  @Public()
  @SkipThrottle()
  @Get("c/:token")
  async click(@Param("token") token: string, @Res() res: Response): Promise<void> {
    const origin = loadEnv().WEB_ORIGIN;
    let target = origin;
    if (PublicTokenSchema.safeParse(token).success) {
      let path: string | null = null;
      try {
        path = await this.recordClick(token, new Date());
      } catch (error: unknown) {
        this.logger.warn(`רישום לחיצה נכשל — מפנה למערכת: ${String(error)}`);
      }
      // ‏אותו כלל של שמירת הנוסח: נתיב יחסי בלבד
      if (path !== null && path.startsWith("/") && !path.startsWith("//")) target = `${origin}${path}`;
    }
    res.redirect(302, target);
  }

  /** ‏רושם את הלחיצה (ואת הפתיחה, אם לא נרשמה) ומחזיר את הנתיב של השלב. */
  private async recordClick(token: string, now: Date): Promise<string | null> {
    return this.prisma.withFunnelAdmin(async (tx) => {
      const locked = await lockByToken(tx, token);
      if (locked === null) return null;
      const message = await tx.funnelMessage.findUniqueOrThrow({
        where: { id: locked.id },
        select: { id: true, track: true, stageKey: true, openedAt: true, clickedAt: true },
      });
      if (message.clickedAt === null) {
        await tx.funnelMessage.update({
          where: { id: message.id },
          // ‏לחיצה היא גם פתיחה — גם כשהפיקסל נחסם
          data: { clickedAt: now, ...(message.openedAt === null ? { openedAt: now } : {}) },
        });
      }
      // ‏נלחצה — כלומר הגיעה, גם אם השליחה נרשמה אצלנו ככושלת
      await confirmMessageOut(tx, message.id, now);
      const stage = await tx.funnelStage.findUnique({
        where: { track_key: { track: message.track, key: message.stageKey } },
        select: { ctaPath: true },
      });
      return stage?.ctaPath ?? null;
    });
  }
}
