import { Injectable, Logger } from "@nestjs/common";
import {
  build015AvailableNumbersUrl,
  build015DescriptionUrl,
  build015NumberAvailableUrl,
  build015PurchaseUrl,
  build015ReleaseUrl,
  parse015AvailableNumbers,
  parse015Envelope,
  type Pbx015Auth,
  type Pbx015Response,
} from "@metavchim/shared";
import { PlatformSettingsService } from "./platform-settings.service";

/**
 * חשבון 015 של הפלטפורמה — קניית מספרים, שחרורם, ורשימת הפנויים.
 *
 * זה **אינו** החיבור של המשרד למרכזייה שלו (זה יושב בהגדרות המשרד,
 * ב-`telephony`): כאן האישורים של הפלטפורמה עצמה, שמהחשבון שלה
 * נשכרים המספרים. שני החשבונות לעולם אינם מתערבבים.
 *
 * בניית הכתובות ופענוח התשובות ב-`@metavchim/shared`
 * (`number-rental.ts`) — נבדקים בלי רשת; כאן רק ה-fetch עצמו,
 * עם timeout, ועם לוג שאינו כולל את הסיסמה.
 */
@Injectable()
export class Pbx015NumbersService {
  private readonly logger = new Logger(Pbx015NumbersService.name);

  constructor(private readonly settings: PlatformSettingsService) {}

  private async auth(): Promise<Pbx015Auth | null> {
    const [username, password] = await Promise.all([
      this.settings.get("pbx015AuthUsername"),
      this.settings.get("pbx015AuthPassword"),
    ]);
    if (!username || !password) return null;
    return { authUsername: username, authPassword: password };
  }

  async ingroup(): Promise<string | null> {
    const value = await this.settings.get("pbx015Ingroup");
    return value && /^\d{1,12}$/u.test(value) ? value : null;
  }

  /** המחיר החודשי שהוגדר, באגורות. null = טרם הוגדר, ההשכרה כבויה. */
  async monthlyPriceAgorot(): Promise<number | null> {
    const raw = await this.settings.get("virtualNumberMonthlyAgorot");
    if (raw === undefined) return null;
    const value = Number(raw);
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  /** ההשכרה פעילה רק כשיש אישורים, קבוצה ומחיר — שלושתם. */
  async isConfigured(): Promise<boolean> {
    return (
      (await this.auth()) !== null &&
      (await this.ingroup()) !== null &&
      (await this.monthlyPriceAgorot()) !== null
    );
  }

  /**
   * קריאה אל 015 — JSON פנימה, מעטפת מפוענחת החוצה.
   *
   * הכתובת נושאת את הסיסמה (כך ה-API שלהם בנוי), ולכן הלוג לעולם
   * אינו כותב אותה — רק את שם הפעולה.
   */
  private async call(action: string, url: string): Promise<Pbx015Response> {
    let body: unknown;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      body = await res.json().catch(() => null);
      /*
       * המעטפת היא ההכרעה, לא קוד ה-HTTP: התיעוד מחזיר את הקוד גם
       * בגוף, וכשהשניים חלוקים — הגוף אומר מה באמת קרה לבקשה.
       */
      const parsed = parse015Envelope(body);
      if (!parsed.ok) {
        this.logger.warn(`015 ${action}: ${parsed.code || res.status} ${parsed.message}`);
      }
      return parsed;
    } catch (error) {
      this.logger.error(`015 ${action} נכשל ברשת: ${String(error)}`);
      return { ok: false, code: "", message: "הפנייה לספק נכשלה" };
    }
  }

  /** המספרים הפנויים לרכישה — מה שהמשרד רואה ובוחר מתוכו. */
  async availableNumbers(count = 20): Promise<string[]> {
    const auth = await this.auth();
    const ingroup = await this.ingroup();
    if (!auth || !ingroup) return [];
    const url = build015AvailableNumbersUrl(auth, { ingroup, count });
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      const body: unknown = await res.json().catch(() => null);
      return parse015AvailableNumbers(body);
    } catch (error) {
      this.logger.error(`015 available/list נכשל: ${String(error)}`);
      return [];
    }
  }

  /** האם המספר עדיין פנוי — נבדק שוב ברגע האמת, לפני התפיסה. */
  async isNumberAvailable(number: string): Promise<boolean> {
    const auth = await this.auth();
    if (!auth) return false;
    return (await this.call("available/get", build015NumberAvailableUrl(auth, number))).ok;
  }

  /** תפיסת המספר לחשבון הפלטפורמה. */
  async purchase(number: string): Promise<Pbx015Response> {
    const auth = await this.auth();
    if (!auth) return { ok: false, code: "", message: "אישורי 015 אינם מוגדרים" };
    return this.call("purchase", build015PurchaseUrl(auth, number));
  }

  /** שחרור מספר שההשכרה שלו הסתיימה. */
  async release(number: string): Promise<Pbx015Response> {
    const auth = await this.auth();
    if (!auth) return { ok: false, code: "", message: "אישורי 015 אינם מוגדרים" };
    return this.call("delete", build015ReleaseUrl(auth, number));
  }

  /**
   * כתיבת שם המשרד על המספר אצל 015 — מיטבי מאמץ.
   *
   * זה מה שהופך את הטיפול הידני לנוח: מנהל שפותח את ממשק 015 רואה
   * ליד כל מספר של מי הוא. כישלון כאן אינו מפיל את הרכישה.
   */
  async setDescription(number: string, description: string): Promise<void> {
    const auth = await this.auth();
    if (!auth) return;
    await this.call(
      "update/description",
      build015DescriptionUrl(auth, { number, description: description.slice(0, 100) }),
    );
  }
}
