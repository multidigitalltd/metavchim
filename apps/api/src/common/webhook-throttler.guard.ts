import { Injectable } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
} from "@nestjs/throttler";
import type {
  ThrottlerLimitDetail,
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from "@nestjs/throttler";

import { WebhookLogService } from "../modules/webhook-log/webhook-log.service";
import { webhookThrottleTarget, webhookTracker } from "./webhook-throttle";

/** ‏חלון הדחיסה — זהה לחלון המונה, ולכן „הוגבל בדקה הזו”. */
const NOTE_WINDOW_MS = 60_000;
/** ‏מעבר לזה סורקים החוצה חלונות שפגו. גודל, לא זמן — ניקוי עצל. */
const SWEEP_THRESHOLD = 5_000;

/**
 * ‎**דחייה על תקרה נרשמת ביומן — אחרת היא נעלמת בשקט.**
 *
 * ‏השער רץ **לפני** הבקר, ולכן `webhookLog.record` שבתוך השירות
 * ‏לעולם אינו מגיע: פנייה שנדחתה ב-429 לא הותירה שום עקבה. זה
 * ‏בדיוק ההפך מהנימוק שכתוב ב-`TelephonyService.ingest`, שם גם
 * ‏מפתח משובש נרשם **לפני** הדחייה כי „ספק שהוגדרה אצלו כתובת
 * ‏שגויה הוא בדיוק המקרה שהיומן קיים בשבילו”.
 *
 * ‏ובמרכזייה זה הכי כואב: רוב המרכזיות אינן מנסות שוב, ולכן 429
 * ‏פירושו שיחה שאבדה לתמיד — ומי שבא לברר „למה השיחה לא נקלטה”
 * ‏מצא יומן ריק ומערכת שנראית תקינה.
 */
@Injectable()
export class WebhookThrottlerGuard extends ThrottlerGuard {
  /** ‏מתי נרשמה דחייה אחרונה לכל מפתח. */
  private readonly noted = new Map<string, number>();

  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly webhookLog: WebhookLogService,
  ) {
    super(options, storageService, reflector);
  }

  protected override async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    await this.note(context, detail);
    return super.throwThrottlingException(context, detail);
  }

  /**
   * ‎**שורה אחת לכל מפתח בכל חלון — לא אחת לכל בקשה.**
   *
   * ‏הצפה היא בדיוק המצב שבו הדחיות מגיעות באלפים, ורישום כל אחת
   * ‏מהן היה הופך את היומן למגבר של ההצפה: כתיבה למסד על כל בקשה
   * ‏שנדחתה, כלומר בדיוק העומס שהתקרה באה למנוע.
   *
   * ‏מה שצריך לדעת הוא „המפתח הזה נחסם בדקה הזו”, וזו שורה אחת.
   */
  private async note(context: ExecutionContext, detail: ThrottlerLimitDetail): Promise<void> {
    const target = webhookThrottleTarget(context);
    if (target === undefined) return;

    const req = context.switchToHttp().getRequest<{
      params?: Record<string, string>;
      method?: string;
      ip?: string;
    }>();

    /*
     * ‎**איזו תקרה נחצתה — של המשרד, או של הכתובת המשותפת?**
     *
     * ‏ההוק הזה רץ עבור **שני** המונים. כשספק משותף חוצה את תקרת
     * ‏ה-IP הכללית בזמן שהמשרד הזה עדיין הרחק מתחת לשלו, המונה
     * ‏הראשון זורק — וכל השורות היו נרשמות כ„המשרד עבר את התקרה
     * ‏שלו”. מנהל שקורא את זה יוצא לחפש תקלה במרכזייה שלו, ואין
     * ‏שם דבר (ביקורת Codex).
     *
     * ‏ההבחנה נעשית בהשוואה למה שהמונה שלנו **היה מחשב** לבקשה
     * ‏הזו, ולא בניחוש לפי צורת המחרוזת: המונה הכללי מזהה לפי
     * ‏`req.ip` נטו, ושלנו תמיד מוסיף קידומת. שוויון פירושו
     * ‏שהמונה שלנו הוא שזרק.
     */
    const ours = webhookTracker(req, target.param);
    const outcome = detail.tracker === ours ? "rate_limited" : "rate_limited_ip";

    const key = req.params?.[target.param] ?? "";
    const slot = `${target.source}:${key}:${outcome}`;
    const now = Date.now();
    const last = this.noted.get(slot);
    if (last !== undefined && now - last < NOTE_WINDOW_MS) return;

    if (this.noted.size >= SWEEP_THRESHOLD) {
      for (const [at, when] of this.noted) {
        if (now - when >= NOTE_WINDOW_MS) this.noted.delete(at);
      }
    }
    this.noted.set(slot, now);

    await this.webhookLog.record({
      source: target.source,
      outcome,
      /*
       * ‏המשרד אינו ידוע: פתירת המפתח היא עבודת השירות, והשער רץ
       * ‏לפניו. `keyPrefix` הוא מה שמאפשר לזהות במסך על מי מדובר,
       * ‏וזה בדיוק מה שהוא נועד לו.
       */
      tenantId: null,
      key,
      method: req.method === "GET" ? "GET" : "POST",
      /* ‏אין אירוע שנותח, ואין מה לשמור מהגוף של פנייה שנדחתה. */
      payload: {},
    });
  }
}
