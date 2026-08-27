import { Injectable, Logger } from "@nestjs/common";
import { PlatformSettingsService } from "./platform-settings.service";

/**
 * לינט — הפקת חשבוניות מס קבלה.
 *
 * לקוח דק מול ה-API של לינט (`https://app.linet.org.il/api`). המבנה
 * כאן אינו ניחוש: הוא נגזר מאינטגרציה שכבר רצה בפרודקשן במערכת אחרת
 * של אותו בעלים, ומהפלאגין הרשמי של לינט לווקומרס.
 *
 * ## שלוש עובדות שקובעות את כל הקוד הזה
 *
 * **1. ההזדהות נוסעת בגוף הבקשה.** כל קריאה היא POST שגופו נושא
 * שלישייה: `login_id` (מזהה ה-API), `login_hash` (המפתח) ו-
 * `login_company` (מזהה החברה). אין כותרת Authorization.
 *
 * **2. לינט מחזירה HTTP 200 גם על כישלון.** התשובה עטופה:
 * `{"status":200,"errorCode":0,"body":…}`. הצלחה היא **שני** התנאים
 * יחד — `status === 200` **וגם** `errorCode === 0`. בדיקה של קוד
 * ה-HTTP בלבד, או של `status` בלבד, הייתה מדווחת "החשבונית הופקה"
 * על בקשה שנדחתה — וזה הכשל היקר ביותר האפשרי כאן: תשלום שנגבה,
 * מסמך שלא קיים, ואיש אינו יודע.
 *
 * **3. מסמך שייך לחשבון.** לינט דורשת `account_id`, ולכן לפני כל
 * מסמך מחפשים חשבון לפי אימייל (`/search/account`) ויוצרים אותו אם
 * אינו קיים (`/create/account`).
 *
 * ## מה שונה אצלנו
 *
 * סוג מסמך אחד — **חשבונית מס קבלה** — כי אצלנו הכסף כבר נגבה
 * בכרטיס האשראי כשהמסמך נוצר; כל המשרדים עוסקים החייבים במע"מ, ולכן
 * אין מסלול פטור; והסכום שנגבה **כולל מע"מ**, ולכן השורה נשלחת עם
 * `iItemWithVat: 1` ולינט מפרקת אותה בעצמה — כך סכום המסמך זהה
 * לשקל שנגבה, ולא מתקבל מסמך גדול ב-18% מהחיוב.
 */

/** מה שחוזר ממסמך שהופק. */
export interface LinetDocument {
  documentId: string;
  pdfUrl: string | null;
  allocationNumber: string | null;
}

/** מי מקבל את המסמך. */
export interface LinetCustomer {
  name: string;
  email: string;
  phone?: string | undefined;
}

interface LinetCredentials {
  baseUrl: string;
  loginId: string;
  key: string;
  companyId: string;
}

interface LinetCodes {
  /** קוד סוג המסמך "חשבונית מס קבלה" בחשבון של הפלטפורמה. */
  docType: string;
  /** קוד קטגוריית מע"מ "חייב". */
  vatCatTaxable: string;
  /** קוד אמצעי תשלום "כרטיס אשראי". */
  paymentType: string;
  /** פריט כללי שעליו נרשמות השורות. */
  itemId: string;
}

const DEFAULT_BASE_URL = "https://app.linet.org.il/api";
/** יצירת מסמך אינה פעולה מהירה; הבדיקה מהמסך מקבלת פסק זמן קצר. */
const REQUEST_TIMEOUT_MS = 30_000;
const TEST_TIMEOUT_MS = 12_000;

@Injectable()
export class LinetService {
  private readonly logger = new Logger(LinetService.name);

  constructor(private readonly settings: PlatformSettingsService) {}

  /** האישורים, או `null` כשלינט לא הוגדרה. */
  async credentials(): Promise<LinetCredentials | null> {
    const [loginId, key, companyId, baseUrl] = await Promise.all([
      this.settings.get("linetLoginId"),
      this.settings.get("linetKey"),
      this.settings.get("linetCompanyId"),
      this.settings.get("linetBaseUrl"),
    ]);
    if (!loginId || !key || !companyId) return null;
    return {
      baseUrl: (baseUrl ?? "").trim() || DEFAULT_BASE_URL,
      loginId: loginId.trim(),
      key: key.trim(),
      companyId: companyId.trim(),
    };
  }

  async codes(): Promise<LinetCodes | null> {
    const [docType, vatCatTaxable, paymentType, itemId] = await Promise.all([
      this.settings.get("linetDocType"),
      this.settings.get("linetVatCatTaxable"),
      this.settings.get("linetPaymentType"),
      this.settings.get("linetItemId"),
    ]);
    if (!docType || !vatCatTaxable || !paymentType) return null;
    return {
      docType: docType.trim(),
      vatCatTaxable: vatCatTaxable.trim(),
      paymentType: paymentType.trim(),
      // פריט ברירת המחדל בלינט; חשבון שבו הוא אחר מגדיר אותו במסך
      itemId: (itemId ?? "").trim() || "1",
    };
  }

  async isConfigured(): Promise<boolean> {
    return (await this.credentials()) !== null && (await this.codes()) !== null;
  }

  /**
   * מה חסר בהגדרות — **בשמות שמופיעים במסך**.
   *
   * בדיקה מקדימה ולא הסתמכות על השגיאה של לינט: ההודעות שלה על
   * קודים חסרים סתומות ("סוג מסמך לא תקין"), והמפעיל צריך לדעת
   * איזה שדה למלא ואיפה.
   */
  async missingSettings(): Promise<string[]> {
    const [credentials, codes] = await Promise.all([this.credentials(), this.codes()]);
    const missing: string[] = [];
    if (!credentials) {
      const [loginId, key, companyId] = await Promise.all([
        this.settings.get("linetLoginId"),
        this.settings.get("linetKey"),
        this.settings.get("linetCompanyId"),
      ]);
      if (!loginId) missing.push("מזהה API");
      if (!key) missing.push("מפתח API");
      if (!companyId) missing.push("מזהה חברה");
    }
    if (!codes) {
      const [docType, vatCat, paymentType] = await Promise.all([
        this.settings.get("linetDocType"),
        this.settings.get("linetVatCatTaxable"),
        this.settings.get("linetPaymentType"),
      ]);
      if (!docType) missing.push("קוד סוג מסמך");
      if (!vatCat) missing.push('קוד מע"מ — חייב');
      if (!paymentType) missing.push("קוד אמצעי תשלום");
    }
    return missing;
  }

  /**
   * בדיקת חיבור למסך הפלטפורמה — חיפוש חשבון קטן שאינו יוצר דבר.
   *
   * מחזירה גם אזהרה על קודים חסרים: עדיף שהמפעיל יגלה הגדרה חלקית
   * כאן, ולא מחשבונית שנכשלת אחרי שכסף כבר נגבה.
   */
  async testConnection(): Promise<{ ok: boolean; message: string }> {
    const credentials = await this.credentials();
    if (!credentials) return { ok: false, message: "מזהה, מפתח או מזהה חברה חסרים" };
    try {
      const body = await this.post(
        credentials,
        "/search/account",
        { email: "connection-test@metavchim.co.il", type: 0 },
        TEST_TIMEOUT_MS,
      );
      void body;
      const missing = await this.missingSettings();
      return missing.length > 0
        ? { ok: true, message: `ההזדהות תקינה, אך חסרים קודים להפקה: ${missing.join(", ")}` }
        : { ok: true, message: "החיבור ללינט תקין — ההזדהות והקודים מוגדרים" };
    } catch (error) {
      return { ok: false, message: `לינט דחתה: ${errorText(error)}` };
    }
  }

  /**
   * הפקת חשבונית מס קבלה על תשלום שנגבה.
   *
   * `externalRef` הוא מזהה התשלום שלנו — הוא נשמר על המסמך
   * (`refnum_ext`), וכך אפשר לאתר מסמך שנוצר בניסיון שנקטע לפני
   * שהספקנו לרשום אותו אצלנו.
   */
  async issueTaxInvoiceReceipt(input: {
    customer: LinetCustomer;
    description: string;
    /** הסכום שנגבה, באגורות — כולל מע"מ. */
    grossAgorot: number;
    externalRef: string;
    /** לינט שולחת את המסמך במייל ללקוח. */
    sendEmail: boolean;
  }): Promise<LinetDocument> {
    const credentials = await this.credentials();
    const codes = await this.codes();
    if (!credentials || !codes) {
      throw new Error(`הגדרות לינט חסרות: ${(await this.missingSettings()).join(", ")}`);
    }

    const totalIls = round2(input.grossAgorot / 100);
    const accountId = await this.resolveAccountId(credentials, input.customer);

    const payload: Record<string, unknown> = {
      doctype: codes.docType,
      // 2 = מסמך סופי ולא טיוטה
      status: 2,
      currency_id: "ILS",
      country_id: "IL",
      language: "he_il",
      autoRound: false,
      sendmail: input.sendEmail ? 1 : 0,
      company: input.customer.name,
      email: input.customer.email,
      ...(input.customer.phone ? { phone: input.customer.phone } : {}),
      refnum_ext: input.externalRef,
      docDet: [
        {
          item_id: codes.itemId,
          name: input.description,
          qty: 1,
          line: 1,
          currency_id: "ILS",
          vat_cat_id: codes.vatCatTaxable,
          unit_id: 0,
          iItem: totalIls,
          // הסכום שנגבה כולל מע"מ — לינט מפרקת, לא מוסיפה
          iItemWithVat: 1,
        },
      ],
      // חשבונית מס **קבלה** מתעדת גם את התקבול
      docCheq: [
        {
          type: Number(codes.paymentType),
          currency_id: "ILS",
          sum: totalIls,
          doc_sum: totalIls,
          line: 1,
        },
      ],
      ...(accountId !== null ? { account_id: accountId } : {}),
    };

    const body = await this.post(credentials, "/create/doc", payload, REQUEST_TIMEOUT_MS);
    const documentId = String(
      firstValue(body, ["id", "doc_id", "docId", "docnum", "document_id"]) ?? "",
    );
    if (documentId === "") throw new Error("לינט לא החזירה מזהה מסמך");

    /*
     * הקישור אינו חוזר מהיצירה — מושכים אותו בנפרד, ובמאמץ טוב
     * בלבד: כישלון כאן אינו הופך מסמך שהופק לכישלון, וההורדה במסך
     * מושכת קישור טרי בכל מקרה.
     */
    let pdfUrl = asString(firstValue(body, ["pdf", "pdf_url", "url", "pdfUrl"]));
    if (pdfUrl === null) {
      pdfUrl = await this.documentPdfUrl(documentId).catch(() => null);
    }

    return {
      documentId,
      pdfUrl,
      allocationNumber: asString(
        firstValue(body, ["allocation_number", "allocationNum", "refnum"]),
      ),
    };
  }

  /**
   * קישור להורדת ה-PDF של מסמך.
   *
   * `print/doc/{id}` עם `href: 1` מחזיר כתובת הורדה. הקישור נמשך מחדש
   * בכל הורדה ולא נשמר לנצח — כך מסמך נפתח גם אחרי שהקישור הישן פג.
   */
  async documentPdfUrl(documentId: string): Promise<string | null> {
    const credentials = await this.credentials();
    if (!credentials) return null;
    const body = await this.post(
      credentials,
      `/print/doc/${encodeURIComponent(documentId)}`,
      { href: 1 },
      TEST_TIMEOUT_MS,
    );
    const url = typeof body === "string" ? body : asString(body);
    return url !== null && url.startsWith("http") ? url : null;
  }

  /**
   * מסמך שכבר נוצר עם אותו `refnum_ext` — **הגנה על ניסיון חוזר.**
   *
   * התרחיש: יצירת המסמך הצליחה בלינט, והתהליך נפל לפני שרשמנו אותה
   * אצלנו. בלי החיפוש הזה הניסיון הבא היה מפיק מסמך שני על אותו
   * תשלום — כפילות שמתגלה אצל רואה החשבון ואי אפשר לבטל בשקט.
   *
   * במאמץ טוב: אם החיפוש נכשל או שהמודל אינו תומך בשדה, מחזירים
   * `null` וההפקה ממשיכה כרגיל.
   */
  async findDocumentByExternalRef(externalRef: string): Promise<string | null> {
    const credentials = await this.credentials();
    if (!credentials) return null;
    try {
      const body = await this.post(
        credentials,
        "/search/doc",
        { refnum_ext: externalRef },
        TEST_TIMEOUT_MS,
      );
      const rows = Array.isArray(body) ? body : [];
      const first = rows[0];
      if (typeof first !== "object" || first === null) return null;
      const id = firstValue(first as Record<string, unknown>, ["id", "doc_id", "docId"]);
      return id === null || id === undefined ? null : String(id);
    } catch (error) {
      this.logger.warn(`חיפוש מסמך קיים בלינט נכשל: ${errorText(error)}`);
      return null;
    }
  }

  /**
   * מזהה החשבון של הלקוח בלינט — נמצא לפי אימייל, ונוצר אם אינו קיים.
   *
   * במאמץ טוב: כישלון מחזיר `null` וההפקה ממשיכה בלי `account_id`,
   * כדי שלינט תאמר בעצמה מה חסר לה במקום שניפול כאן.
   *
   * שים לב — מודל `account` **דוחה** פרמטר `company`; שם העסק נכנס
   * בשדה `name`, ו-`type: 0` הוא לקוח.
   */
  private async resolveAccountId(
    credentials: LinetCredentials,
    customer: LinetCustomer,
  ): Promise<number | null> {
    try {
      const found = await this.post(
        credentials,
        "/search/account",
        { email: customer.email, type: 0 },
        TEST_TIMEOUT_MS,
      );
      const rows = Array.isArray(found) ? found : [];
      const existing = rows[0];
      if (typeof existing === "object" && existing !== null) {
        const id = (existing as Record<string, unknown>)["id"];
        if (id !== undefined && id !== null && Number.isFinite(Number(id))) return Number(id);
      }

      const created = await this.post(
        credentials,
        "/create/account",
        {
          name: customer.name,
          email: customer.email,
          ...(customer.phone ? { phone: customer.phone } : {}),
          country_id: "IL",
          currency_id: "ILS",
          type: 0,
        },
        TEST_TIMEOUT_MS,
      );
      const newId =
        typeof created === "object" && created !== null
          ? (created as Record<string, unknown>)["id"]
          : null;
      return newId !== undefined && newId !== null && Number.isFinite(Number(newId))
        ? Number(newId)
        : null;
    } catch (error) {
      this.logger.warn(`איתור חשבון בלינט נכשל, ממשיכים בלעדיו: ${errorText(error)}`);
      return null;
    }
  }

  /**
   * POST ללינט עם שילוש ההזדהות, ופתיחת המעטפת.
   *
   * זורק על כל כישלון — כולל כישלון שהגיע כ-HTTP 200. ראו את ההסבר
   * בראש הקובץ: זו הנקודה שבה "הצליח" ו"נכשל" נראים זהים.
   */
  private async post(
    credentials: LinetCredentials,
    path: string,
    payload: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${credentials.baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...payload,
          login_id: credentials.loginId,
          login_hash: credentials.key,
          login_company: credentials.companyId,
        }),
        signal: controller.signal,
      });
      const json: unknown = await response.json().catch(() => null);

      // כישלון תעבורה בלי מעטפת בכלל
      if (!response.ok && envelopeField(json, "status") === null) {
        throw new Error(`שגיאת HTTP ${response.status}`);
      }
      if (!envelopeSucceeded(json)) throw new Error(describeError(json));

      const body = envelopeBody(json);
      return body === undefined ? json : body;
    } finally {
      clearTimeout(timer);
    }
  }
}

/* ============================================================
   עוזרים — פתיחת המעטפת של לינט
   ============================================================ */

function envelopeField(json: unknown, key: string): unknown {
  if (typeof json !== "object" || json === null) return null;
  const value = (json as Record<string, unknown>)[key];
  return value === undefined ? null : value;
}

/** הצלחה = `status` 200 **וגם** `errorCode` 0. שדה חסר = ערך ההצלחה. */
function envelopeSucceeded(json: unknown): boolean {
  const status = Number(envelopeField(json, "status") ?? 200);
  const errorCode = Number(envelopeField(json, "errorCode") ?? 0);
  return status === 200 && errorCode === 0;
}

function envelopeBody(json: unknown): unknown {
  if (typeof json !== "object" || json === null) return undefined;
  return (json as Record<string, unknown>)["body"];
}

/**
 * הודעת שגיאה קריאה מתוך מעטפת שנכשלה.
 *
 * כשלי ולידציה מחזירים מפה של `{שדה: [הודעות]}` בגוף; כשלי הזדהות
 * מחזירים מחרוזת ("Unauthorized"). שניהם צריכים להגיע לתמיכה כפי
 * שהם — הודעה כללית הייתה מחייבת לפתוח את הלוג של לינט.
 */
function describeError(json: unknown): string {
  const body = envelopeBody(json);
  if (typeof body === "object" && body !== null && !Array.isArray(body)) {
    const parts = Object.entries(body as Record<string, unknown>).map(([field, messages]) => {
      const text = Array.isArray(messages) ? messages.join(" ") : String(messages);
      return `${field}: ${text}`;
    });
    if (parts.length > 0) return parts.join(" | ").slice(0, 250);
  }
  const message =
    (typeof body === "string" && body) ||
    asString(envelopeField(json, "message")) ||
    asString(envelopeField(json, "text")) ||
    "שגיאה לא ידועה";
  return String(message).slice(0, 250);
}

function firstValue(data: unknown, keys: string[]): unknown {
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim() !== "") return value;
  if (typeof value === "number") return String(value);
  return null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200);
}
