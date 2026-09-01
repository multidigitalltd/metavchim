import { Injectable, Logger } from "@nestjs/common";
import { ulid } from "ulid";
import { loadEnv } from "../../config/env";
import { CryptoService } from "../../core/crypto.service";
import { PlanCatalogService } from "../../core/plan-catalog.service";
import { PlatformSettingsService } from "../../core/platform-settings.service";
import { PrismaService } from "../../core/prisma.service";

/**
 * חיבור המספר העסקי של משרד דרך Embedded Signup (docs/12, ADR-006).
 *
 * ‎**מה קורה כאן בשלוש שורות:** הפרונט מקבל מ-Meta `code` חד-פעמי
 * בסיום הפופאפ; אנחנו ממירים אותו בשרת ל-token של העסק *של המתווך*,
 * רושמים את האפליקציה שלנו ל-Webhooks של ה-WABA שלו, ושומרים את
 * החיבור. מכאן כל הודעה שמגיעה לקו הזה יודעת לאיזה משרד היא שייכת.
 *
 * ## למה ההמרה חייבת להיות בשרת
 *
 * ההמרה דורשת את ה-App Secret. Secret שמגיע לדפדפן הוא Secret שדלף,
 * ולכן הפרונט מעביר `code` בלבד — ערך חד-פעמי וקצר-מועד שאין בו נזק
 * אם נראה בלוג של הרשת.
 *
 * ## למה `subscribed_apps` היא קריאה נפרדת שאסור לוותר עליה
 *
 * המרה מוצלחת נותנת טוקן, אבל **אינה** מפנה את ההודעות של ה-WABA
 * אלינו. בלי הקריאה הזו החיבור "מצליח", המסך מראה ✓, ואף הודעה לא
 * מגיעה לעולם — כשל שקט שנראה למתווך בדיוק כמו מערכת מקולקלת. לכן
 * כישלון שלה מסומן `status=error` עם הסיבה, ולא נבלע.
 */

const GRAPH_BASE = "https://graph.facebook.com/v23.0";
const REQUEST_TIMEOUT_MS = 15_000;

export interface ConnectionSummary {
  id: string;
  displayPhone: string;
  verifiedName: string | null;
  status: string;
  historyShared: boolean;
  qualityRating: string | null;
  connectedAt: Date;
  disconnectedAt: Date | null;
  disconnectReason: string | null;
}

/** תוצאת חיבור — הסיבה נועדה למסך, ולכן היא בעברית ובלי מונחי Graph. */
export type ConnectResult =
  | { ok: true; connection: ConnectionSummary }
  | { ok: false; reason: string };

@Injectable()
export class WhatsAppConnectionService {
  private readonly logger = new Logger(WhatsAppConnectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly platformSettings: PlatformSettingsService,
    private readonly plans: PlanCatalogService,
  ) {}

  /**
   * מזהה האפליקציה וה-Secret — של **הפלטפורמה**, לא של המתווך.
   * חסרים ⇒ החיבור כבוי לגמרי; אין מצב "פתוח בטעות".
   */
  private async appCredentials(): Promise<{ appId: string; appSecret: string } | null> {
    const env = loadEnv();
    const appId = (await this.platformSettings.get("whatsappAppId")) ?? env.WHATSAPP_APP_ID;
    const appSecret =
      (await this.platformSettings.get("whatsappAppSecret")) ?? env.WHATSAPP_APP_SECRET;
    if (!appId || !appSecret) return null;
    return { appId, appSecret };
  }

  /**
   * ‎`config_id` של Embedded Signup — מה שהפרונט צריך כדי לפתוח את
   * הפופאפ הנכון. ריק = הכפתור במסך מוסתר עם הסבר, ולא נשבר בלחיצה.
   */
  async signupConfig(): Promise<{ appId: string; configId: string } | null> {
    const creds = await this.appCredentials();
    const configId =
      (await this.platformSettings.get("whatsappSignupConfigId")) ??
      loadEnv().WHATSAPP_SIGNUP_CONFIG_ID;
    if (!creds || !configId) return null;
    return { appId: creds.appId, configId };
  }

  /** החיבורים של המשרד — הפעילים ראשונים, לתצוגה במסך ההגדרות. */
  async list(tenantId: string): Promise<ConnectionSummary[]> {
    const rows = await this.prisma.whatsAppBusinessConnection.findMany({
      where: { tenantId },
      orderBy: [{ disconnectedAt: "asc" }, { connectedAt: "desc" }],
      select: {
        id: true,
        displayPhone: true,
        verifiedName: true,
        status: true,
        historyShared: true,
        qualityRating: true,
        connectedAt: true,
        disconnectedAt: true,
        disconnectReason: true,
      },
    });
    return rows;
  }

  /**
   * סיום Embedded Signup: `code` ⟵ טוקן ⟵ הרשמה ל-Webhooks ⟵ שמירה.
   *
   * ‎**אידמפוטנטי לפי `phone_number_id`**: מתווך שלחץ פעמיים, או רענן
   * באמצע, מעדכן את החיבור הקיים ולא יוצר שני קווים זהים.
   */
  async complete(
    tenantId: string,
    input: { code: string; wabaId: string; phoneNumberId: string },
  ): Promise<ConnectResult> {
    const app = await this.appCredentials();
    if (!app) {
      return {
        ok: false,
        reason: "חיבור וואטסאפ אינו מוגדר בפלטפורמה — פנו למנהל המערכת",
      };
    }

    const token = await this.exchangeCode(app, input.code);
    if (token === null) {
      return {
        ok: false,
        reason: "‏Meta לא אישרה את החיבור. נסו שוב — ואם זה חוזר, התחילו את התהליך מחדש",
      };
    }

    /*
     * פרטי הקו נשלפים לפני השמירה: המספר המוצג והשם המאומת הם מה
     * שהמתווך מזהה במסך. חיבור ששמור בלי מספר מציג "מחובר" בלי לומר
     * *מה* מחובר — וזה בדיוק מה שמייצר פנייה לתמיכה.
     */
    const line = await this.fetchLine(token, input.phoneNumberId);
    if (line === null) {
      return { ok: false, reason: "לא הצלחנו לקרוא את פרטי המספר מ-Meta" };
    }

    /*
     * ההרשמה ל-Webhooks לפני השמירה, ותוצאתה נשמרת: חיבור שנרשם
     * כ„מחובר” בלי שההודעות מנותבות אלינו הוא ההבטחה השקרית היחידה
     * שהמסך הזה יכול לתת.
     */
    const subscribed = await this.subscribeApp(token, input.wabaId);

    const now = new Date();
    const existing = await this.prisma.whatsAppBusinessConnection.findFirst({
      where: { phoneNumberId: input.phoneNumberId, disconnectedAt: null },
      select: { id: true, tenantId: true },
    });

    /*
     * אותו קו אצל משרד אחר — לא נוגעים. זה או ניסיון השתלטות או
     * טעות אמיתית, ובשני המקרים התשובה הנכונה היא לעצור ולומר.
     */
    if (existing && existing.tenantId !== tenantId) {
      this.logger.warn(
        `ניסיון לחבר קו ${input.phoneNumberId} שכבר מחובר למשרד אחר — נדחה`,
      );
      return {
        ok: false,
        reason: "המספר הזה כבר מחובר למשרד אחר במערכת. נתקו אותו שם תחילה",
      };
    }

    const data = {
      tenantId,
      wabaId: input.wabaId,
      phoneNumberId: input.phoneNumberId,
      displayPhone: line.displayPhone,
      verifiedName: line.verifiedName,
      accessTokenEncrypted: this.crypto.encrypt(token),
      status: subscribed ? "pending_history" : "error",
      qualityRating: line.qualityRating,
      connectedAt: now,
      disconnectedAt: null,
      disconnectReason: subscribed ? null : "webhook_subscribe_failed",
    };

    const saved = existing
      ? await this.prisma.whatsAppBusinessConnection.update({
          where: { id: existing.id },
          data,
          select: SUMMARY_SELECT,
        })
      : await this.prisma.whatsAppBusinessConnection.create({
          data: { id: ulid(), ...data },
          select: SUMMARY_SELECT,
        });

    if (!subscribed) {
      this.logger.error(
        `החיבור נשמר אך ההרשמה ל-Webhooks של WABA ${input.wabaId} נכשלה — הודעות לא יגיעו`,
      );
      return {
        ok: false,
        reason:
          "המספר חובר אך Meta לא אישרה את ניתוב ההודעות אלינו. נסו לחבר מחדש בעוד כמה דקות",
      };
    }

    this.logger.log(`קו ${line.displayPhone} חובר למשרד ${tenantId}`);
    return { ok: true, connection: saved };
  }

  /**
   * ניתוק — **הסוד נמחק, השורה נשארת.**
   *
   * "היה מחובר ונותק" הוא מידע שהמשרד צריך לראות; מחיקת השורה הייתה
   * מציגה "מעולם לא חובר". מנגד, טוקן חי של עסק שכבר לא איתנו אינו
   * דבר שמחזיקים — ולכן העמודה Nullable והניתוק מרוקן אותה.
   */
  async disconnect(tenantId: string, connectionId: string, reason: string): Promise<boolean> {
    const row = await this.prisma.whatsAppBusinessConnection.findFirst({
      where: { id: connectionId, tenantId, disconnectedAt: null },
      select: { id: true, wabaId: true, accessTokenEncrypted: true },
    });
    if (!row) return false;

    /*
     * ביטול ההרשמה אצל Meta לפני מחיקת הטוקן — אחריה אין במה לקרוא.
     * ‏best-effort: מתווך שניתק אצלו קודם מחזיר שגיאה כאן, וזה עדיין
     * ניתוק תקין מבחינתנו.
     */
    if (row.accessTokenEncrypted) {
      const token = this.safeDecrypt(row.accessTokenEncrypted);
      if (token) await this.unsubscribeApp(token, row.wabaId);
    }

    await this.prisma.whatsAppBusinessConnection.update({
      where: { id: row.id },
      data: {
        accessTokenEncrypted: null,
        status: "disconnected",
        disconnectedAt: new Date(),
        disconnectReason: reason.slice(0, 40),
      },
    });
    this.logger.log(`חיבור ${connectionId} נותק (${reason})`);
    return true;
  }

  /**
   * החיבור שאליו שייך קו — נתיב ה-Webhook, לפני שהדייר ידוע.
   * ‏null = הודעה לקו שאינו מוכר לנו.
   */
  async byPhoneNumberId(phoneNumberId: string): Promise<{
    id: string;
    tenantId: string;
    status: string;
  } | null> {
    return this.prisma.whatsAppBusinessConnection.findFirst({
      where: { phoneNumberId, disconnectedAt: null },
      select: { id: true, tenantId: true, status: true },
    });
  }

  /** אישורי השליחה של קו מסוים — לבוט ולתשובות על הקו של המשרד. */
  async credentialsFor(
    connectionId: string,
  ): Promise<{ token: string; phoneNumberId: string } | null> {
    const row = await this.prisma.whatsAppBusinessConnection.findFirst({
      where: { id: connectionId, disconnectedAt: null },
      select: { accessTokenEncrypted: true, phoneNumberId: true },
    });
    if (!row?.accessTokenEncrypted) return null;
    const token = this.safeDecrypt(row.accessTokenEncrypted);
    return token ? { token, phoneNumberId: row.phoneNumberId } : null;
  }

  /**
   * עדכון מצב שהגיע מ-Meta ב-`account_update` — ניתוק מהטלפון, שינוי
   * דירוג איכות, חסימה. מגיע מהוובהוק ולכן אינו זורק לעולם.
   */
  async applyAccountUpdate(
    phoneNumberId: string,
    update: { event?: string; qualityRating?: string },
  ): Promise<void> {
    const row = await this.prisma.whatsAppBusinessConnection.findFirst({
      where: { phoneNumberId, disconnectedAt: null },
      select: { id: true },
    });
    if (!row) return;

    /*
     * ‏Meta מדווחת על ניתוק בכמה שמות אירוע. כולם אומרים אותו דבר:
     * הקו כבר לא שלנו, ולכן הטוקן נמחק כמו בניתוק יזום.
     */
    const disconnected =
      update.event !== undefined &&
      ["DISABLED_UPDATE", "ACCOUNT_DELETED", "PARTNER_REMOVED", "ACCOUNT_RESTRICTION"].includes(
        update.event,
      );

    await this.prisma.whatsAppBusinessConnection.update({
      where: { id: row.id },
      data: {
        ...(update.qualityRating ? { qualityRating: update.qualityRating.slice(0, 10) } : {}),
        ...(disconnected
          ? {
              accessTokenEncrypted: null,
              status: "disconnected",
              disconnectedAt: new Date(),
              disconnectReason: (update.event ?? "meta_update").slice(0, 40),
            }
          : {}),
      },
    });
    if (disconnected) {
      this.logger.warn(`קו ${phoneNumberId} נותק על ידי Meta (${update.event ?? "לא צוין"})`);
    }
  }

  /**
   * ‎**האם מותר לבוט לענות ללקוח בשם המשרד הזה — השער היחיד.**
   *
   * ## למה השער כאן ולא ב-Controller
   *
   * ‎`@RequireFeature` שומר על נתיבי HTTP, והבוט אינו נתיב HTTP: הוא
   * נובע מהודעה נכנסת בוובהוק **ציבורי**, שבו אין מסלול, אין משתמש
   * ואין דקורטור שיבדוק. בלי שער בשכבת השירות, „פיצ'ר בתשלום” היה
   * שורה בקטלוג המסלולים שדבר אינו אוכף.
   *
   * ## מה **לא** נשמר כאן
   *
   * חיבור המספר, קליטת הפניות כלידים, ציר הזמן והדי האפליקציה —
   * כולם פתוחים לכל מסלול, בכוונה: Meta אינה מחייבת על הודעות
   * נכנסות, והחיוב על היוצאות הוא של המשרד מולה. מה שעולה לנו הוא
   * קריאת ה-LLM שמנסחת תשובה, ורק היא נגבית.
   */
  async botAllowed(tenantId: string): Promise<boolean> {
    return this.plans.tenantHasFeature(tenantId, "whatsapp_bot");
  }

  /** סימון שההיסטוריה הגיעה — מוציא את החיבור ממצב ההמתנה. */
  async markHistory(connectionId: string, shared: boolean): Promise<void> {
    await this.prisma.whatsAppBusinessConnection.updateMany({
      where: { id: connectionId, disconnectedAt: null },
      data: {
        historyShared: shared,
        historySyncedThrough: new Date(),
        status: "connected",
      },
    });
  }

  /**
   * ‎`code` ⟵ טוקן עסקי של המתווך. `null` = Meta סירבה.
   *
   * הטוקן אינו נרשם בלוג בשום מצב — גם לא חלקית. שגיאה מחזירה את
   * הודעת Meta בלבד, מקוצצת.
   */
  private async exchangeCode(
    app: { appId: string; appSecret: string },
    code: string,
  ): Promise<string | null> {
    try {
      const url = new URL(`${GRAPH_BASE}/oauth/access_token`);
      url.searchParams.set("client_id", app.appId);
      url.searchParams.set("client_secret", app.appSecret);
      url.searchParams.set("code", code);
      const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 300);
        this.logger.error(`המרת קוד החיבור נכשלה: HTTP ${res.status} — ${detail}`);
        return null;
      }
      const json = (await res.json()) as { access_token?: unknown };
      return typeof json.access_token === "string" ? json.access_token : null;
    } catch (error) {
      this.logger.error(`המרת קוד החיבור נכשלה: ${String(error)}`);
      return null;
    }
  }

  /** פרטי הקו כפי ש-Meta מציגה אותם — המספר, השם המאומת והדירוג. */
  private async fetchLine(
    token: string,
    phoneNumberId: string,
  ): Promise<{
    displayPhone: string;
    verifiedName: string | null;
    qualityRating: string | null;
  } | null> {
    try {
      const res = await fetch(
        `${GRAPH_BASE}/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating`,
        {
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
      if (!res.ok) {
        this.logger.error(`שליפת פרטי הקו נכשלה: HTTP ${res.status}`);
        return null;
      }
      const json = (await res.json()) as {
        display_phone_number?: string;
        verified_name?: string;
        quality_rating?: string;
      };
      return {
        // ספרות בלבד, כמו בכל מקום אחר בערוץ — Meta מחזירה "+972 50-..."
        displayPhone: (json.display_phone_number ?? "").replace(/\D/gu, "").slice(0, 20),
        verifiedName: json.verified_name?.slice(0, 120) ?? null,
        qualityRating: json.quality_rating?.slice(0, 10) ?? null,
      };
    } catch (error) {
      this.logger.error(`שליפת פרטי הקו נכשלה: ${String(error)}`);
      return null;
    }
  }

  /** מפנה את ה-Webhooks של ה-WABA של המתווך אל האפליקציה שלנו. */
  private async subscribeApp(token: string, wabaId: string): Promise<boolean> {
    try {
      const res = await fetch(`${GRAPH_BASE}/${encodeURIComponent(wabaId)}/subscribed_apps`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 300);
        this.logger.error(`הרשמה ל-Webhooks נכשלה: HTTP ${res.status} — ${detail}`);
        return false;
      }
      return true;
    } catch (error) {
      this.logger.error(`הרשמה ל-Webhooks נכשלה: ${String(error)}`);
      return false;
    }
  }

  private async unsubscribeApp(token: string, wabaId: string): Promise<void> {
    try {
      await fetch(`${GRAPH_BASE}/${encodeURIComponent(wabaId)}/subscribed_apps`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.warn(`ביטול ההרשמה ל-Webhooks נכשל: ${String(error)}`);
    }
  }

  /**
   * פענוח שאינו מפיל את הקורא. ערך שהוצפן במפתח אחר (שחזור בסיס
   * נתונים לסביבה אחרת) מחזיר null — והקורא מתייחס אליו כמו לחיבור
   * בלי טוקן, שזה בדיוק מה שהוא.
   */
  private safeDecrypt(stored: string): string | null {
    try {
      return this.crypto.decrypt(stored);
    } catch {
      this.logger.warn("פענוח טוקן החיבור נכשל — החיבור יטופל כלא-מוגדר");
      return null;
    }
  }
}

const SUMMARY_SELECT = {
  id: true,
  displayPhone: true,
  verifiedName: true,
  status: true,
  historyShared: true,
  qualityRating: true,
  connectedAt: true,
  disconnectedAt: true,
  disconnectReason: true,
} as const;
