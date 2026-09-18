import { Injectable, OnModuleDestroy, UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import IORedis from "ioredis";
import { loadEnv } from "../../config/env";

/**
 * ‏מסירת כניסה מהדפדפן אל האפליקציה לנייד — קוד חד-פעמי.
 *
 * ‏סבב ה-OAuth מול Google מתנהל בדפדפן של המכשיר (Custom Tab) ונגמר
 * ‏בשרת. לדפדפן הזה יש עוגייה — לאפליקציה אין. הגשר הוא קוד אקראי
 * ‏שהשרת שולח לאפליקציה בכתובת החזרה (`metavchim://auth/google`),
 * ‏והאפליקציה ממירה אותו ל-Session בקריאה משלה. כך ה-Session נולד
 * ‏לבקשה של האפליקציה (עם ה-IP וה-User-Agent שלה), ומה שנוסע בכתובת
 * ‏— שדפדפן שומר בהיסטוריה ושאפליקציה אחרת יכולה לתפוס — מת בתוך
 * ‏דקה ופעם אחת.
 *
 * ‏ב-Redis ולא במסד, מאותה סיבה כמו קוד האימייל (`LoginOtpService`):
 * ‏רשומה שחיה דקה ונמחקת בשימוש היא בדיוק מה ש-`EX` נותן בחינם. נשמר
 * ‏רק ה-SHA-256 של הקוד — מי שקורא את Redis אינו יכול להשתמש בו.
 */

const HANDOFF_TTL_SECONDS = 60;

interface HandoffRecord {
  /** ‏הכתובת ש-Google אימת. ההמרה מאמתת מחדש שהחשבון קיים ופעיל. */
  email: string;
}

@Injectable()
export class MobileHandoffService implements OnModuleDestroy {
  private readonly redis: IORedis;

  constructor() {
    this.redis = new IORedis(loadEnv().REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: false });
    this.redis.on("error", () => {
      /* נרשם באזהרות — אין קריסה על ניתוק Redis */
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }

  private static key(code: string): string {
    return `mobile-handoff:${createHash("sha256").update(code).digest("hex")}`;
  }

  /** ‏קוד חדש לכתובת מאומתת — תקף לדקה, לשימוש אחד. */
  async issue(email: string): Promise<string> {
    const code = randomBytes(32).toString("base64url");
    const record: HandoffRecord = { email };
    await this.redis.set(MobileHandoffService.key(code), JSON.stringify(record), "EX", HANDOFF_TTL_SECONDS);
    return code;
  }

  /**
   * ‏המרה — מחזירה את הכתובת ומוחקת את הקוד באותה פעולה (`GETDEL`),
   * ‏כך ששתי בקשות מקבילות עם אותו קוד אינן מקבלות שני Sessions.
   */
  async redeem(code: string): Promise<string> {
    const raw = await this.redis.getdel(MobileHandoffService.key(code));
    if (raw === null) {
      throw new UnauthorizedException("ההתחברות עם Google פגה — נסו שוב");
    }
    const record = JSON.parse(raw) as HandoffRecord;
    return record.email;
  }
}
