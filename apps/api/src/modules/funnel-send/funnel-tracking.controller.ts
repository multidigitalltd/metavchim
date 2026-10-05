import { Controller, Get, Param, Res } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import { PublicTokenSchema } from "../../common/zod-validation.pipe";
import { Public } from "../../common/auth.decorators";
import { loadEnv } from "../../config/env";
import { PrismaService } from "../../core/prisma.service";

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
 * ‏תמונה, ולחיצה עליו עדיין מובילה למערכת. מה שלא נמצא פשוט לא נרשם.
 *
 * ‎**היעד של לחיצה נבנה מהשלב, לא מהבקשה** — המקור של המערכת ועוד
 * ‏הנתיב היחסי שנשמר בשלב. אין כאן פרמטר שאפשר להפוך להפניה החוצה.
 */
@Controller("public/funnel")
export class FunnelTrackingController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  @Get("o/:token")
  async open(@Param("token") token: string, @Res() res: Response): Promise<void> {
    if (PublicTokenSchema.safeParse(token).success) {
      await this.prisma.withFunnelAdmin((tx) =>
        tx.funnelMessage.updateMany({
          where: { token, openedAt: null },
          data: { openedAt: new Date() },
        }),
      );
    }
    res.setHeader("Content-Type", "image/gif");
    res.setHeader("Cache-Control", "no-store");
    res.end(PIXEL);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  @Get("c/:token")
  async click(@Param("token") token: string, @Res() res: Response): Promise<void> {
    const origin = loadEnv().WEB_ORIGIN;
    let target = origin;
    if (PublicTokenSchema.safeParse(token).success) {
      const now = new Date();
      const path = await this.prisma.withFunnelAdmin(async (tx) => {
        const message = await tx.funnelMessage.findUnique({
          where: { token },
          select: { id: true, track: true, stageKey: true, openedAt: true, clickedAt: true },
        });
        if (message === null) return null;
        if (message.clickedAt === null) {
          await tx.funnelMessage.update({
            where: { id: message.id },
            // ‏לחיצה היא גם פתיחה — גם כשהפיקסל נחסם
            data: { clickedAt: now, ...(message.openedAt === null ? { openedAt: now } : {}) },
          });
        }
        const stage = await tx.funnelStage.findUnique({
          where: { track_key: { track: message.track, key: message.stageKey } },
          select: { ctaPath: true },
        });
        return stage?.ctaPath ?? null;
      });
      // ‏אותו כלל של שמירת הנוסח: נתיב יחסי בלבד
      if (path !== null && path.startsWith("/") && !path.startsWith("//")) target = `${origin}${path}`;
    }
    res.redirect(302, target);
  }
}
