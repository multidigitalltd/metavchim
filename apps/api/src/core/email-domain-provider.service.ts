import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { loadEnv } from "../config/env";
import { PlatformSettingsService } from "./platform-settings.service";

/**
 * ניהול דומיין אצל ספק האימייל — שכבת הפשטה (docs/05 §0).
 *
 * המשרד מביא דומיין; מי שמנפיק עבורו את רשומות ה-DNS (DKIM,
 * Return-Path), בודק שהן פורסמו וחותם את ההודעות בפועל הוא ספק
 * האימייל החיצוני. הליבה מדברת עם הממשק הזה בלבד — החלפת ספק
 * (Resend, SES) נוגעת בקובץ הזה ולא במסכי ההגדרות ולא בשליחה.
 *
 * הספק הממומש: Postmark, דרך ה-Account API — אותו חשבון שכבר שולח
 * את מיילי המערכת. טוקן ה-Account (לא טוקן השרת!) הוא סוד פלטפורמה
 * ולעולם אינו נחשף למשרדים: הם רואים רק את רשומות ה-DNS של עצמם.
 */

/** רשומות הדומיין כפי שהספק הנפיק אותן, ומצב האימות אצלו. */
export interface ProviderDomain {
  /** מזהה הדומיין אצל הספק — נשמר אצלנו לאימות ולמחיקה. */
  providerDomainId: string;
  dkimHost: string;
  dkimValue: string;
  returnPathHost: string;
  returnPathValue: string;
  dkimVerified: boolean;
  returnPathVerified: boolean;
}

/**
 * הדומיין כבר רשום אצל הספק — אצל משרד אחר בחשבון הזה, או בחשבון
 * Postmark אחר לגמרי. מוחזר כשגיאת קלט ולא כתקלה: זה מצב שהמנהל
 * יכול להבין ולפעול לגביו (לפנות לתמיכה), לא באג.
 */
export class DomainAlreadyClaimedError extends BadRequestException {}

const API_BASE = "https://api.postmarkapp.com";

/** צורת התשובה של Postmark על דומיין — השדות שאנחנו קוראים בלבד. */
interface PostmarkDomainResponse {
  ID: number;
  DKIMHost?: string;
  DKIMTextValue?: string;
  DKIMPendingHost?: string;
  DKIMPendingTextValue?: string;
  DKIMVerified?: boolean;
  ReturnPathDomain?: string;
  ReturnPathDomainCNAMEValue?: string;
  ReturnPathDomainVerified?: boolean;
}

@Injectable()
export class EmailDomainProviderService {
  private readonly logger = new Logger(EmailDomainProviderService.name);

  constructor(private readonly platformSettings: PlatformSettingsService) {}

  private async accountToken(): Promise<string | null> {
    return (
      (await this.platformSettings.get("postmarkAccountToken")) ??
      loadEnv().POSTMARK_ACCOUNT_TOKEN ??
      null
    );
  }

  /**
   * האם הפיצ'ר זמין בכלל — בלי טוקן Account אין את מי לבקש רשומות.
   * המסך מציג את זה כ"טרם הופעל בפלטפורמה" ולא כטופס שנכשל.
   */
  async isConfigured(): Promise<boolean> {
    return (await this.accountToken()) !== null;
  }

  /**
   * רישום דומיין חדש אצל הספק והחזרת הרשומות לפרסום.
   *
   * ‏Return-Path מוגדר במפורש (`pm-bounces.<domain>`) ולא נסמך על
   * ברירת המחדל של הספק: הרשומה מוצגת למנהל להעתקה, וחייבת להיות
   * זהה בתצוגה ובאימות.
   */
  async createDomain(domain: string): Promise<ProviderDomain> {
    const body = { Name: domain, ReturnPathDomain: `pm-bounces.${domain}` };
    const res = await this.request("POST", "/domains", body);
    return this.toProviderDomain(res, domain);
  }

  /** מצב עדכני של דומיין קיים — למסך שנטען מחדש אחרי זמן. */
  async getDomain(providerDomainId: string): Promise<ProviderDomain> {
    const res = await this.request("GET", `/domains/${providerDomainId}`);
    return this.toProviderDomain(res);
  }

  /**
   * בדיקת אימות — הספק ניגש ל-DNS עכשיו ומחזיר את המצב.
   *
   * שתי קריאות נפרדות כי אלה שני endpoints אצל Postmark; כל אחת
   * מחזירה את מצב הדומיין המלא, והאחרונה היא שנשמרת. כישלון אימות
   * אינו שגיאה — הרשומה פשוט עוד לא פורסמה, וזה בדיוק מה שהמסך
   * צריך להראות.
   */
  async verifyDomain(providerDomainId: string): Promise<ProviderDomain> {
    await this.request("PUT", `/domains/${providerDomainId}/verifyDkim`);
    const res = await this.request(
      "PUT",
      `/domains/${providerDomainId}/verifyReturnPath`,
    );
    return this.toProviderDomain(res);
  }

  /**
   * מחיקת הדומיין אצל הספק — בניתוק מהמסך או במחיקת המשרד.
   * ‎404 נבלע: דומיין שכבר אינו קיים שם הוא בדיוק התוצאה הרצויה.
   */
  async deleteDomain(providerDomainId: string): Promise<void> {
    try {
      await this.request("DELETE", `/domains/${providerDomainId}`);
    } catch (error) {
      if (error instanceof BadRequestException) return;
      throw error;
    }
  }

  /**
   * ‏DKIM חדש מגיע בשדות ה-Pending עד שאומת, ואז עובר לשדות
   * הקבועים. הקורא לא צריך להכיר את המנגנון — מוחזר תמיד מה
   * שצריך לפרסם: Pending אם קיים, אחרת הקבוע.
   */
  private toProviderDomain(
    res: PostmarkDomainResponse,
    domain?: string,
  ): ProviderDomain {
    const returnPathHost =
      res.ReturnPathDomain !== undefined && res.ReturnPathDomain !== ""
        ? res.ReturnPathDomain
        : `pm-bounces.${domain ?? ""}`;
    return {
      providerDomainId: String(res.ID),
      dkimHost: res.DKIMPendingHost !== undefined && res.DKIMPendingHost !== ""
        ? res.DKIMPendingHost
        : (res.DKIMHost ?? ""),
      dkimValue:
        res.DKIMPendingTextValue !== undefined && res.DKIMPendingTextValue !== ""
          ? res.DKIMPendingTextValue
          : (res.DKIMTextValue ?? ""),
      returnPathHost,
      returnPathValue: res.ReturnPathDomainCNAMEValue ?? "pm.mtasv.net",
      dkimVerified: res.DKIMVerified === true,
      returnPathVerified: res.ReturnPathDomainVerified === true,
    };
  }

  private async request(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<PostmarkDomainResponse> {
    const token = await this.accountToken();
    if (token === null) {
      throw new ServiceUnavailableException(
        "חיבור דומיין אינו זמין — ספק האימייל טרם הוגדר בפלטפורמה",
      );
    }
    let res: Response;
    try {
      res = await fetch(`${API_BASE}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Postmark-Account-Token": token,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      this.logger.error(`Postmark domains — כשל רשת: ${String(error)}`);
      throw new ServiceUnavailableException(
        "ספק האימייל לא ענה — נסו שוב בעוד רגע",
      );
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      this.logger.error(
        `Postmark domains ${method} ${path} → ${res.status}: ${detail.slice(0, 300)}`,
      );
      /*
       * ‏ErrorCode 503 של Postmark = "domain already exists". זו
       * התנגשות עם חשבון אחר (התנגשות בתוך המערכת נתפסת עוד קודם,
       * באינדקס הייחודי שלנו) — והיא שגיאת קלט שהמנהל צריך לראות,
       * לא תקלה כללית.
       */
      if (res.status < 500) {
        if (detail.includes('"ErrorCode":503') || detail.includes("already exists")) {
          throw new DomainAlreadyClaimedError(
            "הדומיין כבר רשום אצל ספק האימייל — פנו לתמיכה",
          );
        }
        throw new BadRequestException("ספק האימייל דחה את הבקשה — בדקו את הדומיין");
      }
      throw new ServiceUnavailableException(
        "ספק האימייל לא ענה — נסו שוב בעוד רגע",
      );
    }
    // DELETE מחזיר גוף הודעה בלבד — הקוראים אינם משתמשים בו
    return (await res.json().catch(() => ({ ID: 0 }))) as PostmarkDomainResponse;
  }
}
