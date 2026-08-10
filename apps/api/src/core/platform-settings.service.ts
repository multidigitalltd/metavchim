import { Injectable, Logger } from "@nestjs/common";
import { CryptoService } from "./crypto.service";
import { PrismaService } from "./prisma.service";

/**
 * הגדרות הפלטפורמה (מפתחות ספקים) — נשלטות ממסך /platform במקום
 * משתני סביבה + SSH. הערכים מוצפנים ב-DB, ומשתני הסביבה נשארים
 * כ-Fallback (סביבה שהוגדרה כבר בשרת ממשיכה לעבוד ללא שינוי).
 *
 * קאש קצר בזיכרון: הגדרות נקראות בכל שליחת מייל/וובהוק, ואין טעם
 * בשאילתה+פענוח בכל פעם. עדכון מהמסך מנקה את הקאש מיידית.
 */

export type PlatformSettingKey =
  | "postmarkServerToken"
  | "emailFrom"
  | "whatsappAppSecret"
  | "whatsappVerifyToken"
  | "loginOtpEnabled"
  | "googleClientId"
  | "googleClientSecret"
  | "geminiApiKey"
  | "geminiModel"
  | "cardcomTerminalNumber"
  | "cardcomApiName"
  | "cardcomApiPassword";

const CACHE_TTL_MS = 30_000;

@Injectable()
export class PlatformSettingsService {
  private readonly logger = new Logger(PlatformSettingsService.name);
  private cache = new Map<string, string | null>();
  private cacheLoadedAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  private async load(): Promise<void> {
    if (Date.now() - this.cacheLoadedAt < CACHE_TTL_MS) return;
    try {
      const rows = await this.prisma.platformSetting.findMany();
      const next = new Map<string, string | null>();
      for (const row of rows) {
        try {
          next.set(row.key, this.crypto.decrypt(row.valueEncrypted));
        } catch {
          // ערך שנשמר עם מפתח הצפנה אחר — מדולג, ה-Fallback לסביבה יתפוס
          this.logger.warn(`פענוח ההגדרה ${row.key} נכשל — מדולגת`);
        }
      }
      this.cache = next;
      this.cacheLoadedAt = Date.now();
    } catch (error) {
      this.logger.warn(`טעינת הגדרות הפלטפורמה נכשלה: ${String(error)}`);
    }
  }

  /**
   * ערך ההגדרה מה-DB, או undefined אם לא הוגדרה שם.
   *
   * ‎trim‎ גם בקריאה: כל הערכים כאן הם מזהים וסודות של ספקים, ורווח
   * שנגרר בהדבקה ונשמר בעבר היה נשלח כמו שהוא — Google מחזיר על זה
   * ‎invalid_client‎ ושובר את ההתחברות. הניקוי בקריאה מתקן גם ערכים
   * מלוכלכים שכבר שמורים, בלי לחכות לשמירה מחדש.
   */
  async get(key: PlatformSettingKey): Promise<string | undefined> {
    await this.load();
    return this.cache.get(key)?.trim() ?? undefined;
  }

  async set(key: PlatformSettingKey, value: string, updatedBy: string): Promise<void> {
    const valueEncrypted = this.crypto.encrypt(value);
    await this.prisma.platformSetting.upsert({
      where: { key },
      create: { key, valueEncrypted, updatedBy },
      update: { valueEncrypted, updatedBy },
    });
    this.cacheLoadedAt = 0; // הקריאה הבאה תטען מחדש
  }

  async remove(key: PlatformSettingKey): Promise<void> {
    await this.prisma.platformSetting.deleteMany({ where: { key } });
    this.cacheLoadedAt = 0;
  }

  /** אילו מפתחות מוגדרים ב-DB — לתצוגת סטטוס בלי לחשוף את הערכים. */
  async configuredKeys(): Promise<PlatformSettingKey[]> {
    await this.load();
    return [...this.cache.keys()].filter((k) => (this.cache.get(k) ?? "") !== "") as PlatformSettingKey[];
  }
}
