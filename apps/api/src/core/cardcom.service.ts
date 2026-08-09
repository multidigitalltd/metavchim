import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { loadEnv } from "../config/env";
import { PlatformSettingsService } from "./platform-settings.service";

/**
 * קארדקום v11 — דף תשלום, אימות תוצאה, וחיוב חוזר בטוקן.
 *
 * המימוש כאן נגזר מאינטגרציה שכבר רצה בפרודקשן (kanko-board-manager,
 * `class-kbm-billing.php`) ולא מהתיעוד בלבד. ההבדל חשוב: כמה משדות
 * התשובה יושבים במקום אחר ממה שהתיעוד מרמז, וזה בדיוק סוג הפער
 * שמתגלה רק בעסקה אמיתית.
 *
 * שלוש החלטות שקובעות את השאר:
 *
 * **1. פרטי הכרטיס לא עוברים במערכת.** דף התשלום מתארח אצל קארדקום.
 * אין אצלנו PAN, לא בזיכרון, לא בלוג ולא בגיבוי.
 *
 * **2. הוובהוק אינו מקור אמת.** קארדקום אינו חותם את ההודעה, ולכן
 * ממנה נלקח שדה אחד — `LowProfileId` — וגם הוא רק כדי לשאול את
 * קארדקום מה קרה (`GetLpResult`). ההתאמה לשורה שלנו נעשית **לפי
 * `LowProfileId` ולא לפי `ReturnValue`** — זו אזהרה מפורשת של קארדקום.
 *
 * **3. חיוב חוזר אינו מצריך וובהוק בכלל.** `Transactions/Transaction`
 * עם הטוקן השמור מחזיר תשובה סינכרונית שאומרת אם החיוב עבר. אין דף,
 * אין הפניה, אין המתנה — ולכן החידוש האוטומטי הוא פשוט סורק.
 */

const API_BASE = "https://secure.cardcom.solutions/api/v11";
const ILS = 1;

/** מה שצריך כדי לדבר עם קארדקום. חסר אחד מהם ⇒ הסליקה כבויה. */
export interface CardcomCredentials {
  terminalNumber: number;
  apiName: string;
  /** משמשת **רק** לביטול מסמך (זיכוי). לא נשלחת ב-GetLpResult. */
  apiPassword: string;
}

/** מי משלם — ממלא מראש את הדף ואת גוף החשבונית. */
export interface Payer {
  name: string;
  email: string;
  phone?: string;
}

export interface CreatePaymentPageInput {
  /** המזהה שלנו — חוזר ב-ReturnValue, לניפוי שגיאות בלבד. */
  reference: string;
  amountAgorot: number;
  productName: string;
  successUrl: string;
  failureUrl: string;
  webhookUrl: string;
  /** לחיוב חוזר: מבקשים גם טוקן, לא רק חיוב חד-פעמי. */
  createToken: boolean;
  payer: Payer;
}

export interface PaymentPage {
  lowProfileId: string;
  url: string;
}

/** תוצאת עסקה כפי ש**נמשכה** מקארדקום — לא כפי שהוובהוק טען. */
export interface VerifiedPayment {
  paid: boolean;
  /** המזהה שלנו כפי שהוחזר. לצילוב בלבד — ההתאמה לפי LowProfileId. */
  reference: string | null;
  amountAgorot: number | null;
  transactionId: string | null;
  /** הטוקן לחיוב חוזר, כשביקשנו אותו. */
  token: string | null;
  /** חודש ושנה של תוקף הכרטיס — נדרשים כ-MMYY בחיוב החוזר. */
  cardMonth: number | null;
  cardYear: number | null;
  cardLast4: string | null;
  /** ת"ז של בעל הכרטיס — נדרשת ב-CardOwnerInformation בחיוב החוזר. */
  cardOwnerIdentity: string | null;
  /** החשבונית שקארדקום הפיק — מספרה נדרש לזיכוי. */
  documentType: string | null;
  documentNumber: number | null;
  /** תיאור הכישלון מקארדקום — לתמיכה */
  message: string;
}

/** תוצאת חיוב בטוקן — סינכרונית, בלי וובהוק. */
export interface TokenChargeResult {
  paid: boolean;
  transactionId: string | null;
  documentType: string | null;
  documentNumber: number | null;
  message: string;
}

interface CardcomResponse {
  ResponseCode?: number;
  Description?: string;
  [key: string]: unknown;
}

/** קריאת מספר מאובייקט לא-מהימן. */
function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function obj(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * שדה שקארדקום מחזיר לפעמים ברמה העליונה ולפעמים בתוך אובייקט משנה.
 *
 * הקריאה הכפולה אינה זהירות-יתר: המימוש שרץ בפרודקשן קורא
 * `TranzactionId` ברמה העליונה, בעוד שהתיעוד מציג אותו בתוך
 * `TranzactionInfo`. שתי הצורות נצפו, ומי שקורא רק אחת מהן מקבל
 * `undefined` בשקט — כלומר עסקה שנראית חסרת מזהה.
 */
function pick(root: Record<string, unknown>, nested: Record<string, unknown>, key: string): unknown {
  return nested[key] ?? root[key];
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
      (await this.settings.get("cardcomApiPassword")) ?? env.CARDCOM_API_PASSWORD ?? "";

    if (!terminalRaw || !apiName) return null;
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

  private async post<T extends CardcomResponse>(
    path: string,
    body: Record<string, unknown>,
    timeoutMs = 25_000,
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
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
   * גוף המסמך שנשלח עם כל עסקה.
   *
   * `DocumentTypeToCreate: "Auto"` פירושו **"לפי הגדרות המסוף"**, ולא
   * "הפק חשבונית". במסוף שאינו מוגדר להפקת מסמכים — וזה המצב אצלנו,
   * החשבוניות מופקות במערכת אחרת — לא נוצר מסמך, ו-`DocumentInfo`
   * חוזר ריק. זה תקין ומכוון.
   *
   * הבלוק נשאר בכל זאת משתי סיבות: הוא נושא את פרטי הלקוח לתצוגה
   * בעסקה בממשק של קארדקום, והיום שבו יוחלט להפיק חשבוניות שם דורש
   * הדלקה במסוף בלבד ולא שינוי קוד.
   *
   * `UnitCost × Quantity` **חייב** להסתכם בדיוק ב-`Amount`; אחרת
   * קארדקום דוחה את הבקשה — גם כשאין מסמך.
   */
  private document(payer: Payer, productName: string, amountNis: number): Record<string, unknown> {
    return {
      DocumentTypeToCreate: "Auto",
      IsAllowEditDocument: true,
      Name: payer.name,
      Email: payer.email,
      Mobile: payer.phone ?? "",
      Language: "he",
      Products: [{ Description: productName, UnitCost: amountNis, Quantity: 1 }],
    };
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

    const amountNis = Math.round(input.amountAgorot) / 100;
    const res = await this.post("/LowProfile/Create", {
      TerminalNumber: creds.terminalNumber,
      ApiName: creds.apiName,
      ReturnValue: input.reference,
      Amount: amountNis,
      ISOCoinId: ILS,
      Operation: input.createToken ? "ChargeAndCreateToken" : "ChargeOnly",
      Language: "he",
      SuccessRedirectUrl: input.successUrl,
      FailedRedirectUrl: input.failureUrl,
      WebHookUrl: input.webhookUrl,
      ProductName: input.productName,
      // מילוי מראש — פחות הקלדה בדף שאיננו שולטים בעיצובו
      UIDefinition: {
        CardOwnerNameValue: input.payer.name,
        CardOwnerEmailValue: input.payer.email,
        CardOwnerPhoneValue: input.payer.phone ?? "",
      },
      Document: this.document(input.payer, input.productName, amountNis),
    });

    const url = str(res["Url"]);
    const lowProfileId = str(res["LowProfileId"]);
    if (res.ResponseCode !== 0 || url === null || lowProfileId === null) {
      this.logger.error(`יצירת דף תשלום נכשלה: ${res.ResponseCode} ${res.Description ?? ""}`);
      throw new ServiceUnavailableException("פתיחת דף התשלום נכשלה");
    }
    return { lowProfileId, url };
  }

  /**
   * מה קרה בפועל עם דף תשלום — **הקריאה היחידה שסומכים עליה**.
   *
   * נקראת עם מזהה שאנחנו שמרנו, מול קארדקום, בערוץ מאומת. הוובהוק
   * רק אומר "לך תבדוק"; מה שכתוב בגופו אינו נכנס לכאן.
   *
   * הבקשה **אינה כוללת ApiPassword** — זה מה שהמימוש שרץ בפרודקשן
   * שולח, והסיסמה משמשת רק לביטול מסמך. פסק זמן קצר עם ניסיון חוזר,
   * כי זו קריאה שחוסמת תשובה למשתמש שממתין מול המסך.
   */
  async verify(lowProfileId: string): Promise<VerifiedPayment> {
    const creds = await this.credentials();
    if (creds === null) throw new ServiceUnavailableException("הסליקה טרם הופעלה במערכת");

    const body = {
      TerminalNumber: creds.terminalNumber,
      ApiName: creds.apiName,
      LowProfileId: lowProfileId,
    };
    let res: CardcomResponse;
    try {
      res = await this.post("/LowProfile/GetLpResult", body, 5_000);
    } catch {
      res = await this.post("/LowProfile/GetLpResult", body, 5_000);
    }

    const tran = obj(res["TranzactionInfo"]);
    const token = obj(res["TokenInfo"]);
    const doc = obj(res["DocumentInfo"]);

    // שני קודים ולא אחד: העסקה יכולה להיכשל בתוך דף שנפתח בהצלחה.
    // כשאין קוד פנימי כלל נופלים על החיצוני — היעדרו אינו כישלון.
    const innerCode = num(tran["ResponseCode"]);
    const paid = res.ResponseCode === 0 && (innerCode === null || innerCode === 0);

    const amountNis = num(pick(res, tran, "Amount"));
    const last4 = pick(res, tran, "Last4CardDigits");
    const month = num(pick(res, token, "CardMonth")) ?? num(tran["CardMonth"]);
    const year = num(pick(res, token, "CardYear")) ?? num(tran["CardYear"]);

    return {
      paid,
      reference: str(res["ReturnValue"]),
      // הסכום חוזר בשקלים; מוחזר לאגורות ומעוגל כדי שלא ייווצר שבר
      amountAgorot: amountNis === null ? null : Math.round(amountNis * 100),
      transactionId:
        str(pick(res, tran, "TranzactionId")) ?? num(pick(res, tran, "TranzactionId"))?.toString() ?? null,
      token: str(token["Token"]),
      cardMonth: month,
      cardYear: year,
      cardLast4:
        typeof last4 === "number"
          ? String(last4).padStart(4, "0")
          : typeof last4 === "string" && last4 !== ""
            ? last4.slice(-4)
            : null,
      cardOwnerIdentity: str(token["CardOwnerIdentityNumber"]),
      documentType: str(doc["DocumentType"]),
      documentNumber: num(doc["DocumentNumber"]),
      message: res.Description ?? "",
    };
  }

  /**
   * חיוב בטוקן שמור — **בלי דף תשלום ובלי וובהוק**.
   *
   * זו הנקודה שהופכת את החידוש האוטומטי לפשוט: התשובה סינכרונית
   * ואומרת מיד אם החיוב עבר, ולכן הסורק שמחדש מנויים אינו צריך
   * להמתין לשום דבר.
   *
   * `CardExpirationMMYY` הוא בדיוק ארבע ספרות מרופדות באפסים. שנה
   * דו-ספרתית וארבע-ספרתית שתיהן נתמכות בקלט; מה שנשלח הוא תמיד
   * שתי הספרות האחרונות.
   */
  async chargeToken(input: {
    token: string;
    amountAgorot: number;
    cardMonth: number;
    cardYear: number;
    cardOwnerIdentity?: string | null;
    productName: string;
    payer: Payer;
  }): Promise<TokenChargeResult> {
    const creds = await this.credentials();
    if (creds === null) throw new ServiceUnavailableException("הסליקה טרם הופעלה במערכת");

    const amountNis = Math.round(input.amountAgorot) / 100;
    const mm = String(input.cardMonth).padStart(2, "0");
    const yy = String(input.cardYear > 99 ? input.cardYear % 100 : input.cardYear).padStart(2, "0");

    const res = await this.post("/Transactions/Transaction", {
      TerminalNumber: creds.terminalNumber,
      ApiName: creds.apiName,
      Amount: amountNis,
      Token: input.token,
      CardExpirationMMYY: `${mm}${yy}`,
      NumOfPayments: 1,
      ISOCoinId: ILS,
      CardOwnerInformation: {
        FullName: input.payer.name,
        IdentityNumber: input.cardOwnerIdentity ?? "",
        CardOwnerEmail: input.payer.email,
      },
      Document: this.document(input.payer, input.productName, amountNis),
    });

    const transactionId = num(res["TranzactionId"]);
    return {
      paid: res.ResponseCode === 0 && transactionId !== null && transactionId > 0,
      transactionId: transactionId === null ? null : String(transactionId),
      documentType: str(res["DocumentType"]),
      documentNumber: num(res["DocumentNumber"]),
      message: res.Description ?? "",
    };
  }
}
