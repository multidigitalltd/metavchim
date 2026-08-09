import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { loadEnv } from "../config/env";
import { PlatformSettingsService } from "./platform-settings.service";

/**
 * קארדקום — יצירת דף תשלום ואימות תוצאה.
 *
 * שתי החלטות שקובעות את כל השאר:
 *
 * **1. פרטי הכרטיס לא עוברים במערכת.** אנחנו מבקשים מקארדקום דף
 * תשלום מתארח (LowProfile) ומפנים אליו את הדפדפן. המשרד מקליד את
 * מספר הכרטיס בדף של קארדקום. המשמעות: אין אצלנו PAN, לא בזיכרון,
 * לא בלוג ולא בגיבוי — וזה מוציא את המערכת מרוב היקף ה-PCI.
 *
 * **2. הוובהוק אינו מקור אמת.** קארדקום לא חותם את ההודעה שהוא
 * שולח, כלומר כל מי שיודע את הכתובת יכול לשלוח "שולם". לכן ההודעה
 * משמשת **טריגר בלבד**, והתשובה היחידה שנחשבת היא זו שאנחנו מושכים
 * מקארדקום ביוזמתנו (`GetLpResult`) על מזהה שאנחנו יצרנו. בלי
 * ההפרדה הזו כל אחד היה מפעיל לעצמו מנוי בחינם בבקשת POST אחת.
 *
 * האישורים נשמרים ב-platform_settings (מוצפנים, נשלטים מהמסך), עם
 * נפילה למשתני סביבה — אותו דפוס בדיוק כמו Postmark ווואטסאפ.
 */

const API_BASE = "https://secure.cardcom.solutions/api/v11";
const ILS = 1;

/** מה שצריך כדי לדבר עם קארדקום. חסר אחד מהם ⇒ הסליקה כבויה. */
export interface CardcomCredentials {
  terminalNumber: number;
  apiName: string;
  apiPassword: string;
}

export interface CreatePaymentPageInput {
  /** המזהה שלנו לעסקה — חוזר אלינו ב-ReturnValue ומקשר בחזרה לתשלום. */
  reference: string;
  amountAgorot: number;
  productName: string;
  successUrl: string;
  failureUrl: string;
  webhookUrl: string;
  /** לחיוב חוזר: מבקשים גם טוקן, לא רק חיוב חד-פעמי. */
  createToken: boolean;
}

export interface PaymentPage {
  lowProfileId: string;
  url: string;
}

/** תוצאת עסקה כפי ש**נמשכה** מקארדקום — לא כפי שהוובהוק טען. */
export interface VerifiedPayment {
  paid: boolean;
  /** המזהה שלנו כפי שהוחזר; חוסר התאמה פוסל את התוצאה. */
  reference: string | null;
  amountAgorot: number | null;
  transactionId: string | null;
  token: string | null;
  cardLast4: string | null;
  cardExpiry: string | null;
  /** תיאור הכישלון מקארדקום — לתמיכה */
  message: string;
}

interface LowProfileCreateResponse {
  ResponseCode?: number;
  Description?: string;
  LowProfileId?: string;
  Url?: string;
}

interface LowProfileResultResponse {
  ResponseCode?: number;
  Description?: string;
  ReturnValue?: string;
  TranzactionInfo?: {
    ResponseCode?: number;
    Amount?: number;
    TranzactionId?: number;
    Last4CardDigits?: number;
    CardMonth?: number;
    CardYear?: number;
  } | null;
  TokenInfo?: { Token?: string } | null;
}

@Injectable()
export class CardcomService {
  private readonly logger = new Logger(CardcomService.name);

  constructor(private readonly settings: PlatformSettingsService) {}

  /**
   * האישורים, או `null` כשהסליקה לא הוגדרה.
   *
   * `null` ולא חריגה: מערכת בפיתוח ומערכת שטרם הוגדרה צריכות לעלות
   * ולעבוד, והמסך מציג "הסליקה טרם הופעלה" במקום כפתור שנופל.
   */
  async credentials(): Promise<CardcomCredentials | null> {
    const env = loadEnv();
    const terminalRaw =
      (await this.settings.get("cardcomTerminalNumber")) ?? env.CARDCOM_TERMINAL_NUMBER;
    const apiName = (await this.settings.get("cardcomApiName")) ?? env.CARDCOM_API_NAME;
    const apiPassword =
      (await this.settings.get("cardcomApiPassword")) ?? env.CARDCOM_API_PASSWORD;

    if (!terminalRaw || !apiName || !apiPassword) return null;
    const terminalNumber = Number(terminalRaw);
    if (!Number.isInteger(terminalNumber) || terminalNumber <= 0) {
      this.logger.warn("מספר המסוף של קארדקום אינו מספר — הסליקה כבויה");
      return null;
    }
    return { terminalNumber, apiName, apiPassword };
  }

  async isConfigured(): Promise<boolean> {
    return (await this.credentials()) !== null;
  }

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      this.logger.error(`קארדקום אינו נגיש (${path}): ${String(error)}`);
      throw new ServiceUnavailableException("שירות הסליקה אינו זמין כרגע");
    }
    if (!res.ok) {
      this.logger.error(`קארדקום החזיר ${res.status} על ${path}`);
      throw new ServiceUnavailableException("שירות הסליקה החזיר שגיאה");
    }
    return (await res.json()) as T;
  }

  /**
   * דף תשלום חדש.
   *
   * הסכום נשלח בשקלים כי זה מה שקארדקום מצפה לו, והמערכת מחזיקה
   * אגורות — ההמרה נעשית כאן, במקום אחד, ולא בכל קורא.
   */
  async createPaymentPage(input: CreatePaymentPageInput): Promise<PaymentPage> {
    const creds = await this.credentials();
    if (creds === null) throw new ServiceUnavailableException("הסליקה טרם הופעלה במערכת");

    const payload = {
      TerminalNumber: creds.terminalNumber,
      ApiName: creds.apiName,
      ReturnValue: input.reference,
      Amount: input.amountAgorot / 100,
      ISOCoinId: ILS,
      Operation: input.createToken ? "ChargeAndCreateToken" : "ChargeOnly",
      Language: "he",
      SuccessRedirectUrl: input.successUrl,
      FailedRedirectUrl: input.failureUrl,
      WebHookUrl: input.webhookUrl,
      ProductName: input.productName,
    };

    const res = await this.post<LowProfileCreateResponse>("/LowProfile/Create", payload);
    if (res.ResponseCode !== 0 || !res.Url || !res.LowProfileId) {
      this.logger.error(`יצירת דף תשלום נכשלה: ${res.ResponseCode} ${res.Description ?? ""}`);
      throw new ServiceUnavailableException("פתיחת דף התשלום נכשלה");
    }
    return { lowProfileId: res.LowProfileId, url: res.Url };
  }

  /**
   * מה קרה בפועל עם דף תשלום — **הקריאה היחידה שסומכים עליה**.
   *
   * נקראת עם מזהה שאנחנו שמרנו, מול קארדקום, בערוץ מאומת. הוובהוק
   * רק אומר "לך תבדוק"; מה שכתוב בגופו אינו נכנס לכאן ואינו משפיע
   * על התשובה.
   */
  async verify(lowProfileId: string): Promise<VerifiedPayment> {
    const creds = await this.credentials();
    if (creds === null) throw new ServiceUnavailableException("הסליקה טרם הופעלה במערכת");

    const res = await this.post<LowProfileResultResponse>("/LowProfile/GetLpResult", {
      TerminalNumber: creds.terminalNumber,
      ApiName: creds.apiName,
      ApiPassword: creds.apiPassword,
      LowProfileId: lowProfileId,
    });

    const tran = res.TranzactionInfo ?? null;
    // שני קודים ולא אחד: העסקה יכולה להיכשל בתוך דף שנפתח בהצלחה
    const paid = res.ResponseCode === 0 && tran !== null && tran.ResponseCode === 0;

    return {
      paid,
      reference: typeof res.ReturnValue === "string" && res.ReturnValue !== "" ? res.ReturnValue : null,
      // הסכום חוזר בשקלים; מוחזר לאגורות ומעוגל כדי שלא ייווצר שבר
      amountAgorot: typeof tran?.Amount === "number" ? Math.round(tran.Amount * 100) : null,
      transactionId: typeof tran?.TranzactionId === "number" ? String(tran.TranzactionId) : null,
      token: typeof res.TokenInfo?.Token === "string" ? res.TokenInfo.Token : null,
      cardLast4:
        typeof tran?.Last4CardDigits === "number"
          ? String(tran.Last4CardDigits).padStart(4, "0")
          : null,
      cardExpiry:
        typeof tran?.CardMonth === "number" && typeof tran?.CardYear === "number"
          ? `${String(tran.CardMonth).padStart(2, "0")}/${String(tran.CardYear).slice(-2)}`
          : null,
      message: res.Description ?? "",
    };
  }
}
