import { Injectable, OnModuleDestroy, UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import IORedis from "ioredis";
import { loadEnv } from "../../config/env";

/**
 * ‏מסירת כניסה בין הדפדפן לאפליקציה לנייד — קוד חד-פעמי, בשני הכיוונים.
 *
 * ‏**מהדפדפן אל האפליקציה (Google).** סבב ה-OAuth מתנהל בדפדפן של
 * ‏המכשיר (Custom Tab) ונגמר בשרת. לדפדפן הזה יש עוגייה — לאפליקציה
 * ‏אין. הגשר הוא קוד אקראי שהשרת שולח לאפליקציה בכתובת החזרה
 * ‏(`metavchim://auth/google`), והאפליקציה ממירה אותו ל-Session בקריאה
 * ‏משלה. כך ה-Session נולד לבקשה של האפליקציה עצמה, ומה שנוסע בכתובת
 * ‏— שדפדפן שומר בהיסטוריה ושאפליקציה אחרת יכולה לתפוס — מת בתוך דקה
 * ‏ופעם אחת.
 *
 * ‏**מהאפליקציה אל הדפדפן המוטמע (מסכי ה-web).** האפליקציה מציגה את
 * ‏המסכים שאין לה גרסה נייטיבית שלהם בתוך WebView, וה-web מדבר עם
 * ‏ה-API בעוגייה. האפליקציה מבקשת קוד (עם ה-Bearer שלה), ה-WebView
 * ‏פותח כתובת עם הקוד, והשרת שם את **אותו** Session בעוגייה. אותו
 * ‏Session ולא חדש — בכוונה: שער „חיבור אחד לחשבון” ב-web היה רואה
 * ‏חיבור שני ודורש לנתק את האפליקציה מתוך עצמה.
 *
 * ‏ב-Redis ולא במסד, מאותה סיבה כמו קוד האימייל (`LoginOtpService`):
 * ‏רשומה שחיה דקה ונמחקת בשימוש היא בדיוק מה ש-`EX` נותן בחינם. נשמר
 * ‏רק ה-SHA-256 של הקוד — מי שקורא את Redis אינו יכול להשתמש בו.
 * ‏הרשומה של הכיוון השני נושאת את טוקן ה-Session עצמו, ולכן דווקא שם
 * ‏הדקה והשימוש היחיד הם כל ההגנה; הקוד לעולם אינו נרשם ביומן.
 */

const HANDOFF_TTL_SECONDS = 60;

/**
 * ‏שני סוגי רשומות, ושדה `kind` שמונע החלפה ביניהן: קוד שנולד
 * ‏ל-Google אינו יכול לפתוח עוגייה, ולהפך.
 */
type HandoffRecord =
  /** ‏המשתמש ש-Google אימת. ההמרה מאמתת מחדש שהחשבון קיים ופעיל. */
  | { kind: "google"; userId: string }
  /** ‏טוקן ה-Session של האפליקציה — ייכנס לעוגייה של ה-WebView. */
  | { kind: "web"; token: string };

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

  private async issue(record: HandoffRecord): Promise<string> {
    const code = randomBytes(32).toString("base64url");
    await this.redis.set(MobileHandoffService.key(code), JSON.stringify(record), "EX", HANDOFF_TTL_SECONDS);
    return code;
  }

  /**
   * ‏המרה — מחזירה את הרשומה ומוחקת את הקוד באותה פעולה (`GETDEL`),
   * ‏כך ששתי בקשות מקבילות עם אותו קוד אינן מקבלות שתי תשובות.
   */
  private async redeem<K extends HandoffRecord["kind"]>(
    code: string,
    kind: K,
    expiredMessage: string,
  ): Promise<Extract<HandoffRecord, { kind: K }>> {
    const raw = await this.redis.getdel(MobileHandoffService.key(code));
    if (raw === null) throw new UnauthorizedException(expiredMessage);
    const record = JSON.parse(raw) as HandoffRecord;
    if (record.kind !== kind) throw new UnauthorizedException(expiredMessage);
    return record as Extract<HandoffRecord, { kind: K }>;
  }

  /** ‏קוד למשתמש ש-Google אימת — תקף לדקה, לשימוש אחד. */
  issueGoogle(userId: string): Promise<string> {
    return this.issue({ kind: "google", userId });
  }

  /** ‏מזהה המשתמש שהקוד נולד לו; 401 על קוד שפג, נוצל, או מסוג אחר. */
  async redeemGoogle(code: string): Promise<string> {
    const record = await this.redeem(code, "google", "ההתחברות עם Google פגה — נסו שוב");
    return record.userId;
  }

  /** ‏קוד שיכניס את ה-Session של האפליקציה לעוגיית ה-WebView. */
  issueWebSession(token: string): Promise<string> {
    return this.issue({ kind: "web", token });
  }

  /** ‏הטוקן שהקוד נושא; 401 על קוד שפג, נוצל, או מסוג אחר. */
  async redeemWebSession(code: string): Promise<string> {
    const record = await this.redeem(code, "web", "הקישור לאפליקציה פג — פתחו את המסך מחדש");
    return record.token;
  }
}
