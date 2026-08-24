import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { ulid } from "ulid";
import {
  build015DialUrl,
  callAction,
  describeCall,
  incomingCallTitle,
  missedCallTitle,
  parse015DialResponse,
  parseTelephonyEvent,
  resolveAutomationSettings,
  diagnosticFields,
  safeDiagnosticKeys,
  telephonyParseIssue,
  telephonyProvider,
  mergeIntegrationSecrets,
  mergeLegacySecretsIntoConfig,
  telephonySecretKeys,
  softphoneGap,
  softphoneOfficeReady,
  normalizePhone,
  canonicalVirtualNumber,
  leadSourceFor,
  matchVirtualNumber,
  type SoftphoneConfig,
  type SoftphoneGap,
  type VirtualNumberRule,
} from "@metavchim/shared";
import { lockProviderCall } from "../../common/locks";
import { notifyOnce } from "../../common/notify-once";
import { assertContactAccess } from "../../common/ownership";
import { TenantContext } from "../../common/tenant-context";
import { AuditService } from "../../core/audit.service";
import { CryptoService } from "../../core/crypto.service";
import { PlanCatalogService } from "../../core/plan-catalog.service";
import { PlatformSettingsService } from "../../core/platform-settings.service";
import { PrismaService } from "../../core/prisma.service";
import { ContactsService } from "../contacts/contacts.service";
import { IntakeService } from "../intake/intake.service";
import { WhatsAppSendService } from "../messaging/whatsapp-send.service";
import {
  TelephonyWebhookLogService,
  type TelephonyWebhookOutcome,
} from "./webhook-log.service";
import { loadEnv } from "../../config/env";

/**
 * חיבור מרכזיית הטלפון של המשרד.
 *
 * המשרד מחבר ספק ומקבל כתובת Webhook ייחודית משלו; המרכזייה דוחפת
 * אליה אירועי שיחה. **המשרד נגזר מהמפתח שבכתובת ולעולם לא מגוף
 * הבקשה** — אותה משמעת של קליטת הלידים מהאתר, ומאותה סיבה: הנתיב
 * ציבורי, וכל שדה בגוף הבקשה הוא קלט של גורם לא מזוהה.
 *
 * ההחלטה מה לעשות עם כל אירוע יושבת ב-packages/shared (telephony.ts)
 * ומכוסה בבדיקות; כאן רק הביצוע.
 */
@Injectable()
export class TelephonyService {
  private readonly logger = new Logger(TelephonyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly plans: PlanCatalogService,
    private readonly contacts: ContactsService,
    private readonly webhookLog: TelephonyWebhookLogService,
    private readonly intake: IntakeService,
    private readonly waSend: WhatsAppSendService,
    private readonly platformSettings: PlatformSettingsService,
  ) {}

  /**
   * צורת המפתח שאנחנו מייצרים: `randomBytes(24).toString("base64url")`.
   *
   * הבדיקה חוסכת שאילתה על כל זבל שמגיע לנתיב הציבורי, אבל אינה
   * שער אבטחה — היא רצה **אחרי** רישום ביומן, כי מפתח משובש הוא
   * בדיוק הממצא שמחפשים כשמרכזייה "לא שולחת כלום".
   */
  private static readonly WEBHOOK_KEY_SHAPE = /^[A-Za-z0-9_-]{20,64}$/u;

  private webhookUrl(key: string): string {
    return `${loadEnv().WEB_ORIGIN}/api/v1/public/telephony/${key}`;
  }

  /**
   * פענוח גוש הסודות. גוש פגום מחזיר ריק ולא מפיל את המסך — מנהל
   * שלא יכול לפתוח את הגדרות המרכזייה גם לא יכול לתקן אותן.
   */
  private readSecrets(encrypted: string | null): Record<string, string> {
    if (!encrypted) return {};
    try {
      const parsed: unknown = JSON.parse(this.crypto.decrypt(encrypted));
      return typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, string>)
        : {};
    } catch {
      this.logger.error("גוש הסודות של המרכזייה אינו ניתן לפענוח");
      return {};
    }
  }

  /** קיום חיבור מרכזיה בלבד — לבאנר במסך השיחות, בלי שום פרט תצורה. */
  async isConnected(): Promise<boolean> {
    const tenantId = TenantContext.current().tenantId;
    /*
     * זכאות המסלול, ולא רק קיום שורת ההגדרה.
     *
     * שורת האינטגרציה **נשמרת** במעבר מסלול, ולכן משרד שהיה לו
     * חיבור ועבר למסלול בלי מרכזייה ממשיך להיראות „מחובר”. בפועל
     * קליטת הוובהוק דוחה בדיוק את אותה אינטגרציה על אותה בדיקה
     * (`no_feature`), כלומר השירות אינו עובד — והבאנר שמסביר איך
     * לחבר נשאר מוסתר. „מחובר” שמשמעותו „שום שיחה לא נקלטת” הוא
     * בדיוק סוג ההצהרה שהמסך אינו אמור להצהיר (ביקורת Codex).
     */
    if (!(await this.plans.tenantHasFeature(tenantId, "telephony"))) return false;
    const row = await this.prisma.withTenant((tx) =>
      tx.integration.findFirst({
        where: { tenantId, kind: "telephony" },
        select: { id: true },
      }),
    );
    return row !== null;
  }

  /** מצב החיבור כפי שמנהל המשרד רואה אותו — בלי הסודות. */
  async status(): Promise<{
    connected: boolean;
    provider?: string;
    providerLabel?: string;
    status?: string;
    webhookUrl?: string;
    lastEventAt?: Date;
    clickToDial: boolean;
    config: Record<string, unknown>;
    /** שמות השדות באירוע האחרון — לאבחון מיפוי מול הספק. */
    lastEventKeys?: string;
    /** false = אירוע הגיע ולא הובן. שונה לגמרי מ"לא הגיע כלום". */
    lastEventOk?: boolean;
    /** למה לא הובן — מספר חסוי אינו תקלת מיפוי. */
    lastEventIssue?: string;
    /**
     * אילו סודות **שמורים** — שמות המפתחות בלבד, בלי הערכים.
     *
     * בלי זה המסך לא יכול להבדיל בין "סיסמה שמורה, השאירו ריק" לבין
     * "אין סיסמה כלל", ושתיהן נראו זהות: שדה ריק עם אותו placeholder.
     * כך נראה חיבור שנראה תקין וחיוג שנכשל, בלי שום רמז מה חסר.
     */
    secretsSet: string[];
  }> {
    const tenantId = TenantContext.current().tenantId;
    const row = await this.prisma.withTenant((tx) =>
      tx.integration.findFirst({ where: { tenantId, kind: "telephony" } }),
    );
    if (!row) return { connected: false, clickToDial: false, config: {}, secretsSet: [] };
    const provider = telephonyProvider(row.provider);
    const stored = this.readSecrets(row.secretsEncrypted);
    const secretKeys = provider ? telephonySecretKeys(provider) : [];
    return {
      /*
       * רק השמות, ורק של סודות שהספק הנוכחי באמת מכיר. הערכים אינם
       * עוזבים את השרת, גם לא למנהל המשרד.
       */
      secretsSet: secretKeys.filter((key) => (stored[key] ?? "").trim() !== ""),
      connected: true,
      provider: row.provider,
      providerLabel: provider?.label ?? row.provider,
      status: row.status,
      // הכתובת עצמה אינה סוד — היא חסרת ערך בלי המפתח שכבר בתוכה,
      // ומנהל המשרד חייב אותה כדי להזין אותה במרכזייה שלו
      webhookUrl: this.webhookUrl(row.webhookKey),
      lastEventAt: row.lastEventAt ?? undefined,
      ...(row.lastEventKeys ? { lastEventKeys: row.lastEventKeys } : {}),
      ...(row.lastEventOk !== null ? { lastEventOk: row.lastEventOk } : {}),
      ...(row.lastEventIssue ? { lastEventIssue: row.lastEventIssue } : {}),
      clickToDial: provider?.clickToDial ?? false,
      /*
       * שדה שהיה סוד והפך לגלוי נקרא מהמקום שבו הוא באמת שמור. בלי
       * זה הטופס היה מציג שם משתמש ריק לחיבור ותיק, והשמירה הראשונה
       * הייתה מוחקת אותו לתמיד (ביקורת Codex).
       */
      config: provider
        ? mergeLegacySecretsIntoConfig(
            provider,
            (row.config ?? {}) as Record<string, unknown>,
            stored,
          )
        : ((row.config ?? {}) as Record<string, unknown>),
    };
  }

  /**
   * חיבור או עדכון. הסודות נכתבים רק כשנשלחו — עדכון שלוחה לא מוחק
   * את הטוקן, ומנהל שלא רוצה להקליד אותו מחדש לא חייב.
   */
  async connect(input: {
    provider: string;
    config: Record<string, string>;
    secrets: Record<string, string>;
  }): Promise<{ ok: true }> {
    const { tenantId, userId } = TenantContext.current();
    const provider = telephonyProvider(input.provider);
    if (!provider) throw new BadRequestException("ספק לא מוכר");

    await this.prisma.withTenant(async (tx) => {
      const existing = await tx.integration.findFirst({
        where: { tenantId, kind: "telephony" },
        select: { id: true, secretsEncrypted: true, provider: true },
      });
      const providerChanged = existing !== null && existing.provider !== input.provider;

      /*
       * הסודות ממוזגים **לפי מפתח**, לא מוחלפים כגוש.
       *
       * קודם כל שמירה החליפה את הגוש כולו, והמסך אומר "השאירו ריק כדי
       * לא לשנות" — כלומר שדה סוד ריק אינו נשלח. עם סוד אחד זה עבד;
       * עם שניים זה מחק נתונים בשקט: שמירה חוזרת שמילאה רק את שם
       * המשתמש שלחה `{authUsername}` בלבד, והסיסמה נמחקה. המסך המשיך
       * להראות "מחובר", והחיוג ענה "חסרים פרטי ההתחברות" — בלי שאיש
       * נגע בסיסמה. התגלה בשימוש אמיתי.
       */
      const previousSecrets = this.readSecrets(existing?.secretsEncrypted ?? null);
      const merged = mergeIntegrationSecrets(
        previousSecrets,
        input.secrets,
        telephonySecretKeys(provider),
        { providerChanged },
      );
      const secretsEncrypted =
        Object.keys(merged).length > 0 ? this.crypto.encrypt(JSON.stringify(merged)) : null;

      if (existing) {
        /*
         * החלפת ספק מאפסת את האבחון.
         *
         * בלי האיפוס, האירוע האחרון של הספק **הקודם** מוצג כהוכחה
         * שהספק החדש עובד — והמנהל מפסיק לחפש למה שיחות לא נכנסות
         * (ביקורת Codex).
         */
        await tx.integration.updateMany({
          where: { id: existing.id, tenantId },
          data: {
            provider: input.provider,
            status: "active",
            config: input.config,
            secretsEncrypted,
            ...(providerChanged
              ? { lastEventAt: null, lastEventKeys: null, lastEventOk: null, lastEventIssue: null }
              : {}),
          },
        });
      } else {
        await tx.integration.create({
          data: {
            id: ulid(),
            tenantId,
            kind: "telephony",
            provider: input.provider,
            config: input.config,
            secretsEncrypted,
            // 32 תווים — אותו סדר גודל של מפתח קליטת הלידים
            webhookKey: randomBytes(24).toString("base64url"),
            createdBy: userId,
          },
        });
      }
      await this.audit.record(tx, {
        action: "integration.connect",
        entityType: "integration",
        entityId: tenantId,
        metadata: { kind: "telephony", provider: input.provider },
      });
    });
    return { ok: true };
  }

  /**
   * קו ה-SIP האישי של הסוכן — מה שמאפשר לו לדבר מהדפדפן.
   *
   * הקו הוא **של האדם ולא של המשרד**, ולכן הוא נשמר על המשתמש: שיחה
   * נכנסת צריכה לצלצל אצל מי שהיא מיועדת לו. קו אחד משותף היה מחזיר
   * אותנו לבעיה שחיוג בלחיצה בא לפתור.
   *
   * הסיסמה נכתבת רק כשנשלחה — אותו כלל של סודות המרכזייה, ומאותה
   * סיבה: סוכן שמעדכן את שם הקו לא אמור להקליד סיסמה מחדש.
   */
  /**
   * קווי ה-SIP של כל הצוות — למסך הגדרות המרכזייה של מנהל המשרד.
   *
   * הקו מוגדר בידי המנהל ולא בידי כל סוכן: המנהל הוא מי שמקבל את
   * הקווים ממנהל המרכזייה, והוא מקצה אותם — הסוכן רק לוחץ "חבר
   * סופטפון" ועובד. מוחזר האם יש סיסמה, לא הסיסמה עצמה.
   */
  async lines(): Promise<
    { userId: string; name: string; username: string; hasPassword: boolean }[]
  > {
    const { tenantId } = TenantContext.current();
    const users = await this.prisma.user.findMany({
      where: { tenantId, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, sipUsername: true, sipPasswordEncrypted: true },
    });
    return users.map((u) => ({
      userId: u.id,
      name: u.name,
      username: u.sipUsername ?? "",
      hasPassword: u.sipPasswordEncrypted !== null,
    }));
  }

  /** הקצאת קו לסוכן — בידי מנהל המשרד בלבד (נאכף בבקר). */
  async saveLineFor(
    targetUserId: string,
    input: { username?: string; password?: string },
  ): Promise<{ ok: true }> {
    const { tenantId, userId } = TenantContext.current();
    const data: { sipUsername?: string | null; sipPasswordEncrypted?: string | null } = {};
    if (input.username !== undefined) {
      const trimmed = input.username.trim();
      data.sipUsername = trimmed === "" ? null : trimmed;
      /*
       * ניקוי שם הקו מנקה גם את הסיסמה. סיסמה מוצפנת ששייכת לקו
       * שכבר לא קיים היא סוד שנשמר בלי סיבה, ואיש לא יזכור למחוק
       * אותה בנפרד.
       */
      if (trimmed === "") data.sipPasswordEncrypted = null;
    }
    if (input.password !== undefined && input.password.trim() !== "") {
      data.sipPasswordEncrypted = this.crypto.encrypt(input.password.trim());
    }
    if (Object.keys(data).length === 0) return { ok: true };

    await this.prisma.withTenant(async (tx) => {
      // updateMany עם tenantId: משתמש של משרד אחר אינו נגיש גם בטעות
      const updated = await tx.user.updateMany({
        where: { id: targetUserId, tenantId },
        data,
      });
      if (updated.count === 0) throw new NotFoundException("המשתמש לא נמצא");
      await this.audit.record(tx, {
        action: "telephony.line.update",
        entityType: "user",
        entityId: targetUserId,
        metadata: { hasUsername: (data.sipUsername ?? null) !== null, byUserId: userId },
      });
    });
    return { ok: true };
  }

  /**
   * מה שהדפדפן צריך כדי להירשם למרכזייה — **של המשתמש הנוכחי בלבד**.
   *
   * הסיסמה כן מגיעה לדפדפן: ‎SIP over WebSocket‎ מחייב את הלקוח
   * להירשם בעצמו, ואין בפרוטוקול טוקן קצר-מועד שאפשר להנפיק במקומה.
   * לכן היא נשלחת רק לבעליה, רק על חיבור מאומת, ורק כשהמסלול כולל
   * טלפוניה — והיא **לעולם אינה** נשלחת עבור משתמש אחר, גם לא למנהל
   * המשרד. זו הסיבה שאין כאן פרמטר `userId`.
   */
  /**
   * האם להציג את כפתור "חבר סופטפון" — בדיקת צד המשרד בלבד.
   *
   * נשאל בטעינת כל עמוד, ולכן הוא בכוונה לא נוגע בקו האישי ולא
   * מחזיר שום סוד: רק "יש/אין למשרד מרכזייה שדפדפן יכול להתחבר
   * אליה". פרטי הרישום המלאים נשלפים רק בלחיצה על הכפתור עצמו.
   */
  async softphoneAvailability(): Promise<{ available: boolean }> {
    const { tenantId } = TenantContext.current();
    const row = await this.prisma.withTenant((tx) =>
      tx.integration.findFirst({ where: { tenantId, kind: "telephony" } }),
    );
    const config = (row?.config ?? {}) as Record<string, string>;
    return {
      available: softphoneOfficeReady({
        connected: row !== null && row.status === "active",
        wssUrl: config["sipWssUrl"],
        domain: config["sipDomain"],
      }),
    };
  }

  async softphone(): Promise<
    { ready: false; gap: SoftphoneGap } | ({ ready: true } & SoftphoneConfig)
  > {
    const { tenantId, userId } = TenantContext.current();
    const [row, user] = await Promise.all([
      this.prisma.withTenant((tx) =>
        tx.integration.findFirst({ where: { tenantId, kind: "telephony" } }),
      ),
      this.prisma.user.findFirst({
        where: { id: userId, tenantId },
        select: { sipUsername: true, sipPasswordEncrypted: true },
      }),
    ]);
    const config = (row?.config ?? {}) as Record<string, string>;
    const gap = softphoneGap({
      connected: row !== null && row.status === "active",
      wssUrl: config["sipWssUrl"],
      domain: config["sipDomain"],
      username: user?.sipUsername ?? "",
      hasPassword: (user?.sipPasswordEncrypted ?? null) !== null,
    });
    if (gap) return { ready: false, gap };
    return {
      ready: true,
      wssUrl: config["sipWssUrl"]!.trim(),
      domain: config["sipDomain"]!.trim(),
      username: user!.sipUsername!.trim(),
      password: this.crypto.decrypt(user!.sipPasswordEncrypted!),
    };
  }

  /**
   * מי מתקשר — לשיחה נכנסת בסופטפון.
   *
   * הדפדפן מקבל מספר מה-INVITE ולא שם. הפונקציה הזו היא היחידה
   * שיודעת לגשר, והיא **מחזירה שם רק על איש קשר שהמשתמש הזה רשאי
   * לראות** — לא רק של המשרד.
   *
   * ההבחנה הזו היא כל האבטחה של הנתיב. בלי `assertContactAccess`
   * הוא היה עוקף את מסנן הבעלות שכל שאר המערכת אוכפת: סוכן עם
   * `view_own` היה מקבל את שמו של לקוח של סוכן אחר לפי מספר טלפון
   * בלבד, בדיוק ה-IDOR שנסגר בכל נתיבי הכתיבה. מספר שאינו מוכר
   * ומספר שאינו שלי מחזירים את אותה תשובה ריקה — תשובה שונה הייתה
   * מסגירה את עצם קיומו.
   */
  async resolveCaller(phone: string): Promise<{ name?: string; contactId?: string }> {
    const { tenantId } = TenantContext.current();
    const normalized = normalizePhone(phone);
    const phoneHash = this.crypto.phoneHash(normalized);
    return this.prisma.withTenant(async (tx) => {
      const primary = await tx.contact.findFirst({
        where: { tenantId, phoneHash },
        select: { id: true, nameEncrypted: true },
      });
      const secondary = primary
        ? null
        : await tx.contactPhone.findFirst({
            where: { tenantId, phoneHash },
            select: { contact: { select: { id: true, nameEncrypted: true } } },
          });
      const contact = primary ?? secondary?.contact ?? null;
      if (!contact) return {};
      try {
        await assertContactAccess(tx, tenantId, contact.id);
      } catch {
        return {}; // קיים אך לא שלי — כמו מספר לא מוכר, ובכוונה
      }
      return { name: this.crypto.decrypt(contact.nameEncrypted), contactId: contact.id };
    });
  }

  /**
   * חיוג יוצא בלחיצה — 015 בלבד.
   *
   * **המספר לא מגיע מהבקשה.** הקורא נוקב במזהה איש קשר, והמספר
   * נפתר בשרת מתוך הכרטיס שלו. זו אינה קפדנות: נתיב שמקבל מספר
   * חופשי הוא **חייגן פתוח על חשבון המשרד** — מי שמשיג Session של
   * סוכן זוטר יכול לחייג למספרי פרימיום בחו"ל כל הלילה, והחשבון
   * מגיע ללקוח שלנו. הפרמטר `phone` מותר רק כדי לבחור בין המספרים
   * של אותו איש קשר, ונבדק מולם.
   *
   * השיחה מצלצלת קודם **לטלפון של הסוכן** מהפרופיל שלו. קו משרדי
   * אחד לכולם היה מחבר את הלקוח למי שבמקרה הרים.
   */
  async dial(input: { contactId: string; phone?: string }): Promise<{
    ok: boolean;
    callId?: string;
    message: string;
  }> {
    const { tenantId, userId } = TenantContext.current();

    const row = await this.prisma.withTenant((tx) =>
      tx.integration.findFirst({ where: { tenantId, kind: "telephony" } }),
    );
    if (!row || row.status !== "active") {
      throw new BadRequestException("לא מחוברת מרכזייה — חברו אותה בהגדרות המשרד");
    }
    const provider = telephonyProvider(row.provider);
    if (!provider?.clickToDial) {
      throw new BadRequestException(`חיוג יוצא אינו נתמך עבור ${provider?.label ?? row.provider}`);
    }

    const secrets = this.readSecrets(row.secretsEncrypted);
    const config = (row.config ?? {}) as Record<string, string>;
    /*
     * שם המשתמש מ-`config`, עם נפילה-לאחור ל-`secrets`.
     *
     * הוא היה מסומן כסוד ולכן נשמר מוצפן; מרגע שהוא שדה גלוי הוא
     * נשמר ב-`config`. הנפילה-לאחור היא בשביל משרד שחיבר לפני
     * השינוי — בלעדיה החיוג שלו היה נשבר בעדכון גרסה, בלי שנגע בכלום.
     */
    const authUsername = (config["authUsername"] ?? secrets["authUsername"] ?? "").trim();
    const authPassword = (secrets["authPassword"] ?? "").trim();
    /*
     * ההודעה נוקבת ב**שדה החסר**. "חסרים פרטי ההתחברות" שלח את המשתמש
     * למסך שבו שם המשתמש נראה מלא, ולכן לא היה ברור מה בעצם להשלים.
     */
    if (authUsername === "" || authPassword === "") {
      const missing =
        authUsername === "" && authPassword === ""
          ? "שם המשתמש והסיסמה"
          : authUsername === ""
            ? "שם המשתמש"
            : "הסיסמה";
      throw new BadRequestException(
        `חסר ${missing} של 015 — השלימו בהגדרות המשרד, במרכזיית הטלפון`,
      );
    }

    /*
     * המספר של הלקוח — **מהכרטיס**, אחרי בדיקת בעלות. `assertContactAccess`
     * הוא אותו שער של שאר הפעולות: סוכן עם view_own לא מחייג ללקוח
     * של סוכן אחר, בדיוק כפי שאינו רואה אותו.
     */
    const destination = await this.prisma.withTenant(async (tx) => {
      await assertContactAccess(tx, tenantId, input.contactId);
      const phones = await this.contacts.phonesFor(tx, input.contactId);
      if (phones.length === 0) throw new NotFoundException("לאיש הקשר אין מספר טלפון");
      if (input.phone === undefined) return phones[0]!.phone;
      const chosen = phones.find((p) => p.phone === input.phone);
      // מספר שאינו של איש הקשר הזה — לא מחייגים אליו, נקודה
      if (!chosen) throw new BadRequestException("המספר אינו שייך לאיש הקשר");
      return chosen.phone;
    });

    const agent = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { phone: true },
    });
    const agentLine = agent?.phone?.trim() || config["defaultLine"]?.trim() || "";
    if (agentLine === "") {
      throw new BadRequestException(
        /*
         * ההודעה אומרת גם *איפה* לתקן. "החיוג לא יודע לאן לצלצל" הוא
         * תיאור מדויק של התקלה ועדיין משאיר את המשתמש לחפש — והמסך
         * שבו מוסיפים את המספר אינו מסך המרכזייה, אלא הפרופיל.
         */
        "אין טלפון בפרופיל שלכם ולא הוגדר קו ברירת מחדל — החיוג לא יודע לאן לצלצל. " +
          "הוסיפו את מספר הטלפון שלכם במסך הפרופיל, או קו ברירת מחדל בהגדרות המרכזייה.",
      );
    }

    const url = build015DialUrl({
      authUsername,
      authPassword,
      agentLine,
      destination,
      ...(config["callerId"] ? { callerId: config["callerId"] } : {}),
    });

    let body: unknown;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      body = await res.json();
    } catch (error) {
      this.logger.error(`חיוג דרך 015 נכשל: ${String(error)}`);
      throw new ServiceUnavailableException("המרכזייה אינה מגיבה כרגע");
    }

    const result = parse015DialResponse(body);
    await this.prisma.withTenant(async (tx) => {
      await this.audit.record(tx, {
        action: "telephony.dial",
        entityType: "contact",
        entityId: input.contactId,
        metadata: { ok: result.ok, ...(result.callId ? { callId: result.callId } : {}) },
      });
    });
    /*
     * השיחה עצמה **אינה** נרשמת כאן. היא תירשם כשהמרכזייה תדווח
     * שהסתיימה, דרך אותו Webhook של כל שיחה אחרת — רישום כאן היה
     * מייצר שורה כפולה על כל חיוג, ושורה על שיחה שהסוכן לא ענה לה.
     */
    return result;
  }

  /**
   * ניתוק. השורה נמחקת ולא רק מושבתת: המפתח הישן מפסיק לעבוד מיד,
   * ומשרד שיחבר מחדש יקבל כתובת חדשה. חיבור "מושבת" שממשיך לקבל
   * אירועים בשקט הוא בדיוק סוג ההפתעה שאין לה מקום כאן.
   */
  async disconnect(): Promise<{ ok: true }> {
    const tenantId = TenantContext.current().tenantId;
    await this.prisma.withTenant(async (tx) => {
      await tx.integration.deleteMany({ where: { tenantId, kind: "telephony" } });
      await this.audit.record(tx, {
        action: "integration.disconnect",
        entityType: "integration",
        entityId: tenantId,
        metadata: { kind: "telephony" },
      });
    });
    return { ok: true };
  }

  /**
   * קליטת אירוע מהמרכזייה.
   *
   * מחזיר תמיד בהצלחה כשהמפתח תקין, גם כשהאירוע לא הוביל לשום
   * פעולה: מרכזייה שמקבלת שגיאה מנסה שוב ושוב, ואירוע שאנחנו
   * בכוונה מתעלמים ממנו (צלצול חוזר, אירוע שכבר נרשם) אינו כשל.
   */
  async ingest(
    key: string,
    payload: Record<string, unknown>,
    method: "GET" | "POST" = "POST",
  ): Promise<void> {
    /*
     * צורת המפתח נבדקת כאן ולא בשער הנתיב, כדי שגם מפתח קטוע או
     * משובש יירשם ביומן לפני הדחייה. ספק שהוגדרה אצלו כתובת שגויה
     * הוא בדיוק המקרה שהיומן קיים בשבילו, ובדיקה מוקדמת יותר הייתה
     * מחזירה 400 ומשאירה אותו בלתי נראה.
     */
    if (!TelephonyService.WEBHOOK_KEY_SHAPE.test(key)) {
      await this.webhookLog.record({
        outcome: "unknown_key",
        tenantId: null,
        key,
        method,
        payload,
      });
      throw new NotFoundException("לא נמצא");
    }

    /*
     * דרך הפוליסה הציבורית ולא בשאילתה ישירה.
     *
     * הנתיב הזה ציבורי ואין בו הקשר דייר, והטבלה תחת FORCE RLS —
     * שאילתה ישירה הייתה מחזירה אפס שורות **בלי שגיאה**, כל מפתח
     * תקין היה נדחה ב-404, ואף אירוע לא היה נקלט (ביקורת Codex).
     */
    const integration = await this.prisma.withPublicIntegration(key, (tx) =>
      tx.integration.findFirst({
        where: { webhookKey: key },
        select: { tenantId: true, id: true, status: true },
      }),
    );
    /*
     * מפתח לא מוכר — אותה שגיאה גנרית כמו בקליטת הלידים; לא מאשרים
     * קיום או אי-קיום של מפתחות.
     *
     * **אבל נרשם ביומן לפני הזריקה.** קודם הפנייה נעלמה כאן בלי
     * שום עקבה, ומסך האבחון הראה "לא התקבל אף אירוע" בדיוק כמו
     * מרכזייה שמעולם לא פנתה — כלומר שני מצבים שדורשים פעולה הפוכה
     * נראים זהים. התשובה החוצה נשארת גנרית; מה שנרשם הוא פנימי.
     */
    if (!integration || integration.status !== "active") {
      await this.webhookLog.record({
        outcome: integration ? "disabled" : "unknown_key",
        tenantId: integration?.tenantId ?? null,
        key,
        method,
        payload,
      });
      throw new NotFoundException("לא נמצא");
    }

    /*
     * זכאות המסלול — כאן ולא בשער.
     *
     * הנתיב ציבורי ואין בו הקשר דייר, ולכן FeatureGuard מדלג עליו.
     * המשרד נודע רק אחרי שהמפתח נפתר, וזו הנקודה הראשונה שבה אפשר
     * לשאול. בלי הבדיקה, ביטול הפיצ'ר במסלול היה סוגר את מסך
     * ההגדרות אבל משאיר את קליטת השיחות פועלת (ביקורת Codex).
     *
     * אותה שגיאה גנרית של מפתח לא מוכר: הספק החיצוני לא אמור ללמוד
     * מהתשובה דבר על מצב המנוי של הלקוח.
     */
    if (!(await this.plans.tenantHasFeature(integration.tenantId, "telephony"))) {
      /*
       * הסיבה השקטה ביותר מכולן: המפתח תקין, החיבור פעיל, והמסלול
       * פשוט אינו כולל מרכזייה. מבחוץ זה נראה בדיוק כמו כתובת
       * שגויה, ובלי השורה הזו אין שום דרך להבדיל.
       */
      await this.webhookLog.record({
        outcome: "no_feature",
        tenantId: integration.tenantId,
        key,
        method,
        payload,
      });
      throw new NotFoundException("לא נמצא");
    }

    /*
     * הניתוח **לפני** רישום היומן, כדי שהשורה תגיד מה קרה לאירוע.
     *
     * קודם נרשם „התקבלה” כאן ורק אחר כך נותח האירוע, ולכן פנייה
     * שנזרקה שנייה לאחר מכן — למשל בלי מספר מתקשר — נראתה ביומן
     * זהה לפנייה שהפכה לשיחה. מי שבודק „לקוח התקשר ואין רישום”
     * הסתכל בדיוק בעמודה שאינה יכולה לענות לו.
     *
     * `parseTelephonyEvent` הוא חישוב טהור על ה-payload ואינו נוגע
     * במסד, ולכן הזזתו לכאן אינה משנה דבר מלבד מה שהיומן יודע.
     */
    const event = parseTelephonyEvent(payload);
    const issue = event === null ? telephonyParseIssue(payload) : null;
    /*
     * אירוע ביניים אינו שיחה שנרשמה.
     *
     * 015 שולחת שלושה אירועים לשיחה אחת (`Calling` ⟵ `Answer` ⟵
     * `Hangup`), ורק האחרון כותב שורת שיחה. סימון כולם כ„נקלטה
     * כשיחה” היה הופך מרכזייה שמאבדת את ה-`Hangup` לתקינה למראית
     * עין — בדיוק התקלה שהאבחון קיים כדי לחשוף.
     *
     * ההכרעה נשאלת מ-`callAction` עצמה ולא מרשימת סוגים שנכתבת
     * כאן מחדש. ניסיון קודם שלי מנה את `ringing` בלבד ופספס את
     * `answered`, שגם הוא אינו מסיים — כלומר בדיוק אותו באג, סוג
     * אחד הלאה (ביקורת Codex). מי שיוסיף סוג אירוע בעתיד לא יצטרך
     * לזכור את המקום הזה.
     *
     * `knownContact: false` אינו משנה דבר כאן: הוא משפיע על
     * `createLead` בלבד, לא על `logCall`.
     */
    const willLogCall = event !== null && callAction(event, false).logCall;

    /*
     * שורת היומן נכתבת **אחרי** העיבוד, ולא לפניו.
     *
     * כשהיא נכתבה מראש היא הצהירה „נקלטה כשיחה” על סמך כוונה
     * בלבד. עיבוד שנפל אחר כך — חיפוש איש קשר, פתיחת ליד, כתיבת
     * שורת השיחה — השאיר את היומן אומר בדיוק את ההפך ממה שקרה,
     * ודווקא במקרה שבשבילו מסתכלים בו (ביקורת Codex).
     *
     * `finally` ולא `catch` בלבד: הכתיבה חייבת לקרות גם במסלול
     * ה-`return` המוקדם של אירוע שלא זוהה. `record` בולעת שגיאות
     * בעצמה, ולכן היא אינה יכולה להסתיר את החריגה המקורית.
     */
    let outcome: TelephonyWebhookOutcome =
      event === null ? "unparsed" : willLogCall ? "accepted" : "preliminary";
    try {
      const tenantId = integration.tenantId;

      /*
       * **התיעוד נרשם על ההגעה, לא על ההצלחה.**
       *
       * קודם `lastEventAt` נכתב רק אחרי שהאירוע נותח בהצלחה, ולכן
       * מרכזייה ששלחה payload בשמות שדות שאיננו מכירים השאירה את המסך
       * אומר "לא התקבל אף אירוע" — בדיוק כמו מרכזייה שמעולם לא פנתה.
       * שני המצבים דורשים פעולה הפוכה: כתובת שגויה אצל הספק מול מיפוי
       * שדות חסר אצלנו, ובלי ההבחנה אי אפשר לדעת במה מדובר.
       *
       * מסונן תמיד: ספק עם מפתחות דינמיים יכול לשלוח
       * `{"0501234567": "..."}`, וכך מספר הלקוח היה נשמר בעמודה גלויה
       * ונכתב ללוג — בדיוק מה שההצפנה בכל שאר המערכת מונעת (ביקורת
       * Codex).
       *
       * `diagnosticFields` ולא `safeDiagnosticKeys`: השמות לבדם אינם
       * עונים על השאלה שבעל המשרד שואל כאן. „‎direction‎ הגיע” יכול
       * להיות ערך תקין או שדה ריק, ומרכזייה ששולחת תבנית עם
       * placeholder שאינו נתמך שולחת אותו ריק. הכללים על מה מותר
       * להציג זהים — שדות מזהים נשארים שם בלבד — וזה גם הופך את המסך
       * הזה לזהה ליומן הפלטפורמה במקום שני ניסוחים לאותו payload.
       */
      await this.prisma.withExplicitTenant(tenantId, async (tx) => {
        await tx.integration.updateMany({
          where: { id: integration.id, tenantId },
          data: {
            lastEventAt: new Date(),
            lastEventKeys: diagnosticFields(payload),
            lastEventOk: event !== null,
            lastEventIssue: issue,
          },
        });
      });
      if (!event) {
        this.logger.warn(
          `אירוע מרכזייה שלא זוהה (${integration.tenantId}): ${issue ?? "לא ידוע"}. ` +
            `שדות: ${safeDiagnosticKeys(Object.keys(payload))}`,
        );
        return; // חסר מספר או מזהה — אין מה לעשות איתו
      }

      await this.prisma.withExplicitTenant(tenantId, async (tx) => {

        const phoneHash = this.crypto.phoneHash(event.peerPhone);
        /*
         * גם המספרים המשניים של איש הקשר, לא רק הראשי.
         *
         * לקוח שמתקשר מהמספר השני שלו הוא אותו אדם. חיפוש בטבלת
         * contacts בלבד היה מסמן אותו כלא-מוכר, וייצר לו כרטיס שני
         * וליד מיותר — בדיוק מה שתמיכת ריבוי המספרים באה למנוע
         * (ביקורת Codex).
         */
        const primary = await tx.contact.findFirst({
          where: { tenantId, phoneHash },
          select: { id: true, nameEncrypted: true },
        });
        const secondary = primary
          ? null
          : await tx.contactPhone.findFirst({
              where: { tenantId, phoneHash },
              select: { contact: { select: { id: true, nameEncrypted: true } } },
            });
        const contact = primary ?? secondary?.contact ?? null;
        const action = callAction(event, contact !== null);
        const contactName = contact ? this.crypto.decrypt(contact.nameEncrypted) : null;

        /*
         * שתי הגנות שונות מפני אותו אירוע שמגיע פעמיים, כי הן מגינות
         * על שני דברים שונים.
         *
         * **הנעילה** מסדרת שתי פניות מקבילות עם אותו `callid`. בלעדיה
         * הבדיקה למטה היא קרא־ואז־כתוב: שתיהן קוראות „אין שיחה”,
         * ושתיהן כותבות. מרכזייה ששולחת שוב כי לא קיבלה 200 עושה בדיוק
         * את זה.
         *
         * **`seen`** מסתכל על שורת השיחה, וזה מספיק בדיוק למסלול אחד —
         * זה שכותב אותה. במסלול ההתראה על צלצול הוא היה חסר משמעות:
         * שורת השיחה נוצרת רק באירוע המסיים, ולכן `seen` תמיד ריק שם
         * וכל `Calling` חוזר ייצר התראה נוספת. זה מה שגרם לשתי הודעות
         * הוואטסאפ על שיחה נכנסת אחת. ההגנה שם היא מפתח הייחודיות של
         * ההתראה עצמה — ראו `notifyOnce`.
         */
        await lockProviderCall(tx, tenantId, event.providerCallId);
        const seen = await tx.call.findFirst({
          where: { tenantId, providerCallId: event.providerCallId },
          select: { id: true, outcome: true },
        });

        if (action.notify) {
          if (seen) return; // כבר הפכה לשיחה — ההתראה עליה כבר יצאה
          /*
           * ההתראה נכתבת לכל המשרד (userId = null) ולא לסוכן מסוים:
           * השלוחה שהמרכזייה מדווחת עליה היא של המכשיר שמצלצל, ואין
           * לנו מיפוי אמין ממנה למשתמש. עדיף שכולם יראו מי מתקשר מאשר
           * שההתראה תגיע לאדם הלא נכון.
           */
          await notifyOnce(tx, {
            tenantId,
            dedupeKey: `incoming_call:${event.providerCallId}`,
            userId: null,
            type: "incoming_call",
            title: incomingCallTitle(contactName, event.peerPhone),
            body: contact ? null : "מספר שאינו מוכר במערכת",
            entityType: contact ? "contact" : null,
            entityId: contact?.id ?? null,
          });
          return;
        }

        if (!action.logCall || seen) return;

        /*
         * הלקוח והליד נוצרים **לפני** שורת השיחה, ולא אחריה.
         *
         * בסדר ההפוך שורת השיחה נכתבה עם contactId ריק ונשארה כך
         * לתמיד — כלומר הלקוח שנפתח מהשיחה לא היה מקושר לשיחה שיצרה
         * אותו, ומכרטיסו אי אפשר היה להגיע אליה (ביקורת Codex).
         */
        /*
         * ההגדרה של המספר שאליו התקשרו — מקור, סוכן ונכס.
         *
         * נקראת גם כשלא נפתח ליד: היא זולה, והשורה נכתבת בכל מקרה עם
         * `dialedNumber` כדי שדוח הקמפיינים יספור גם שיחות מלקוחות
         * מוכרים. קמפיין שמחזיר לקוח ותיק הוא קמפיין שעבד.
         */
        const virtualNumber = await this.matchVirtualNumber(tx, tenantId, event.dialedNumber);

        let contactId = contact?.id ?? null;
        let leadId: string | null = null;
        if (action.createLead) {
          const opened = await this.openLeadForUnknownCaller(
            tx,
            tenantId,
            event.peerPhone,
            phoneHash,
            virtualNumber,
            event.direction,
            event.callerName,
          );
          contactId = opened.contactId;
          leadId = opened.leadId;
        }

        await tx.call.create({
          data: {
            id: ulid(),
            tenantId,
            direction: event.direction,
            source: "provider",
            providerCallId: event.providerCallId,
            contactId,
            leadId,
            phoneEncrypted: this.crypto.encrypt(event.peerPhone),
            phoneHash,
            // הצד שלנו — הבסיס לדוח "כמה שיחות מכל מספר"; ראו הסכימה
            dialedNumber: event.dialedNumber ?? null,
            /*
             * השם נשמר כצילום ולא כהפניה: ההגדרה יכולה להימחק, וזה
             * לא אמור לשנות את מה שכתוב על שיחה שכבר קרתה.
             */
            dialedLabel: virtualNumber?.label ?? null,
            /*
             * הנכס כצילום, מאותו מקור שממנו נקבע שיוך הליד — ובאותו
             * רגע. השיוך של הליד יכול להשתנות אחר כך, ולכן דוח שנשען
             * עליו היה מייחס שיחות ישנות לנכס חדש (ביקורת Codex).
             *
             * שיחה יוצאת אינה נושאת נכס, מאותו נימוק שהליד שלה אינו
             * נושא: היעד נבחר על ידי הסוכן ולא על ידי מספר שפורסם.
             */
            propertyId:
              event.direction === "outbound" ? null : (virtualNumber?.propertyId ?? null),
            /*
             * שעת השיחה כפי שהמרכזייה דיווחה, ורק בהיעדרה שעת הקליטה.
             *
             * 015 שולח שלושה אירועים לשיחה אחת (`Calling` ⟵ `Answer`
             * ⟵ `Hangup`) שמתפרסים על עשרות שניות, ושולח שוב בניסיון
             * חוזר. `new Date()` רשם את מועד ההודעה האחרונה שהתקבלה
             * ולא את מועד השיחה — שיחה שקרתה ב-8:46:16 נרשמה ב-8:46:59,
             * ובניסיון חוזר שעה אחר כך בשעה אחרת לגמרי.
             */
            occurredAt: event.startedAt ?? new Date(),
            // שיחה שלא נענתה נשארת בלי משך. עיגול כלפי מעלה היה מציג
            // "דקה אחת" על שיחה שהסיכום שלה אומר שלא נענתה כלל.
            durationMinutes:
              event.type === "missed" || event.durationSeconds === undefined
                ? null
                : Math.max(1, Math.round(event.durationSeconds / 60)),
            outcome: event.type === "missed" ? "missed" : "answered",
            summary: describeCall(event),
            // מצביע בלבד בשלב הזה; העובד מושך את האודיו וממיר אותו
            // ל-`recordingKey` שלנו. ראו `RecordingFetchService`.
            providerRecordingPath: event.providerRecordingPath ?? null,
          },
        });

        /*
         * שיחה נכנסת שלא נענתה — התראה משלה.
         *
         * עד כה התריעה המערכת רק על *צלצול*, כלומר בדיוק ברגע שבו
         * המתווך ממילא רואה את הטלפון מצלצל. מי שלא הספיק לענות — או
         * שהיה בפגישה — לא קיבל דבר: השיחה נרשמה ביומן השיחות, ומי
         * שלא פתח אותו לא ידע שלקוח ניסה להשיג אותו. זו ההתראה שהופכת
         * „לא נענתה” לפעולה, והיא מצביעה על הליד/הלקוח כדי שאפשר יהיה
         * לחזור אליו במגע אחד.
         */
        if (event.type === "missed" && event.direction === "inbound") {
          /*
           * הקישור ללקוח — **לפני** ההתראה, כדי שההתראה תוכל לשאת את
           * מה שנשאר לעשות.
           *
           * ההתראה אומרת למתווך שמישהו התקשר; הקישור הוא מה שאומר
           * ל**לקוח** שראינו אותו. השיחה שלא נענתה היא הרגע שבו הוא
           * הכי מחובר לעניין, ורבע שעה אחר כך הוא כבר מתקשר למשרד
           * הבא.
           *
           * בתוך אותה טרנזקציה של קליטת האירוע: בקשה שנוצרה בלי
           * שהשיחה נרשמה היא קישור שאיש לא יודע למה נשלח.
           */
          const pending = await this.offerIntakeAfterMissedCall(
            tx,
            tenantId,
            leadId,
            contactId,
          );

          await notifyOnce(tx, {
            tenantId,
            /*
             * גם כאן מפתח, ולא רק `seen`. שורת השיחה כבר נכתבה בטרנזקציה
             * הזו, אבל היא נראית רק אחרי COMMIT — כלומר שתי פניות
             * מקבילות עדיין יכולות לכתוב שתי התראות. הנעילה מונעת את
             * המרוץ, והמפתח הופך את זה לוודאות שאינה תלויה בה.
             */
            dedupeKey: `call_missed:${event.providerCallId}`,
            // כמו התראת הצלצול: אין מיפוי אמין משלוחה למשתמש
            userId: null,
            type: "call_missed",
            title: missedCallTitle(contactName, event.peerPhone),
            /*
             * נוסח ההזמנה נכנס לגוף ההתראה כשלא נשלח אוטומטית ואין
             * למי לשייך משימה. התראה שאומרת „לא נשלח” בלי לצרף את
             * מה שצריך לשלוח מחייבת חיפוש, וזו בדיוק העבודה
             * שהאוטומציה נועדה לחסוך.
             */
            body: pending ?? (leadId ? "נפתח ליד חדש מהשיחה" : null),
            entityType: leadId ? "lead" : contactId ? "contact" : null,
            entityId: leadId ?? contactId,
          });
        }
      });
    } catch (error) {
      /*
       * הפנייה הגיעה, הובנה — ונפלה אצלנו. זו תוצאה רביעית
       * ולא אחת מהשלוש: המרכזייה תשלח שוב (הבקשה מסתיימת
       * בשגיאה), ומי שקורא את היומן צריך לדעת שהתקלה כאן.
       */
      outcome = "failed";
      throw error;
    } finally {
      await this.webhookLog.record({
        outcome,
        issue,
        tenantId: integration.tenantId,
        key,
        method,
        payload,
      });
    }
  }

  /**
   * שיחה נכנסת שלא נענתה ⇒ קישור לטופס הדרישות.
   *
   * ## שלוש דרגות, מהטובה לפחות טובה
   *
   * 1. **תבנית מאושרת** ⇒ ההודעה יוצאת מעצמה. זו הדרך היחידה
   *    לפנות למי שלא כתב לנו: מחוץ לחלון 24 השעות Meta דוחה טקסט
   *    חופשי, ולקוח שרק **התקשר** מעולם לא כתב.
   * 2. **אין תבנית** ⇒ נפתחת משימה עם ההודעה מוכנה, והמתווך שולח
   *    בלחיצה. זו נפילה מכוונת ולא כשל: מערכת שמבטיחה „נשלח
   *    אוטומטית” ובפועל שותקת גרועה מכזו שאומרת מה נשאר לעשות.
   * 3. **כשל שליחה** ⇒ אותה משימה. הקישור כבר נוצר, ולכן שום
   *    עבודה לא הולכת לאיבוד.
   *
   * כל השרשרת עטופה: תקלה כאן לא תפיל את קליטת האירוע, שאם תיכשל
   * תגרור שליחה חוזרת מהמרכזייה ורישום כפול של השיחה.
   */
  private async offerIntakeAfterMissedCall(
    tx: Parameters<Parameters<PrismaService["withExplicitTenant"]>[1]>[0],
    tenantId: string,
    leadId: string | null,
    contactId: string | null,
  ): Promise<string | null> {
    // בלי ליד אין כרטיס לתלות בו את הדרישות, ובלי איש קשר אין למי לשלוח
    if (leadId === null || contactId === null) return null;
    try {
      const tenant = await tx.tenant.findUnique({
        where: { id: tenantId },
        select: { settings: true },
      });
      const raw = (tenant?.settings ?? {}) as Record<string, unknown>;
      if (!resolveAutomationSettings(raw["automations"])["missed_call_intake"].enabled) {
        return null;
      }

      const created = await this.intake.ensureForMissedCall(
        tx,
        tenantId,
        "lead",
        leadId,
        contactId,
      );
      // כבר יש קישור בתוקף — לקוח שהתקשר שלוש פעמים אינו מקבל שלוש הודעות
      if (created === null) return null;

      const contact = await this.contacts.getById(tx, contactId);
      const template = await this.platformSettings.get("whatsappIntakeTemplate");
      const lang =
        (await this.platformSettings.get("whatsappIntakeTemplateLang")) ?? "he";

      const sent =
        contact !== null && template !== undefined && template !== ""
          ? await this.waSend.sendTemplate(contact.phone, template, lang, [
              created.url,
            ])
          : false;

      if (sent) return "נשלחה ללקוח הודעה עם קישור למילוי מה הוא מחפש";

      /*
       * לא נשלח — ההודעה המוכנה חוזרת לגוף ההתראה.
       *
       * לא משימה: משימה מחייבת בעלים (`assignedToUserId`), ולשיחה
       * נכנסת אין מיפוי אמין משלוחה למשתמש — בדיוק הסיבה שההתראה
       * עצמה נוצרת בלי `userId`. משימה שהייתה מוצמדת למישהו
       * שרירותי הייתה נוחתת אצל מי שלא ענה לשיחה ולא יודע עליה.
       */
      return `לא נשלח אוטומטית (אין תבנית מאושרת). שלחו ללקוח:\n${created.message}`;
    } catch (error: unknown) {
      /*
       * בלוע במתכוון, וברמת `warn` ולא `error`: השיחה נרשמה,
       * ההתראה יצאה, ומה שנכשל הוא תוספת. חריגה כאן הייתה מפילה
       * את קליטת האירוע כולה.
       */
      this.logger.warn(
        `שליחת קישור הטופס אחרי שיחה שלא נענתה נכשלה: ${
          error instanceof Error ? error.message : "שגיאה לא ידועה"
        }`,
      );
      return null;
    }
  }

  /**
   * ההגדרה של המספר שאליו התקשרו, אם יש כזו.
   *
   * שאילתה על המספר עצמו ולא שליפת כל ההגדרות והשוואה בזיכרון:
   * המספר נשמר מנורמל, ו-`canonicalVirtualNumber` מנרמל גם את מה
   * שהמרכזייה שלחה — כך ששני הצדדים נפגשים על אותה צורה.
   * ‎`matchVirtualNumber` נשאר מקור האמת ורץ על התוצאה, כדי
   * ששינוי בכללי ההתאמה יחול כאן בלי לגעת בשאילתה.
   */
  private async matchVirtualNumber(
    tx: Parameters<Parameters<PrismaService["withExplicitTenant"]>[1]>[0],
    tenantId: string,
    dialed: string | undefined,
  ): Promise<VirtualNumberRule | null> {
    const canonical = dialed === undefined ? "" : canonicalVirtualNumber(dialed);
    if (canonical === "") return null;
    const row = await tx.virtualNumber.findFirst({
      where: { tenantId, phone: canonical },
      select: {
        id: true,
        phone: true,
        label: true,
        leadSource: true,
        assignedToUserId: true,
        propertyId: true,
        isActive: true,
      },
    });
    return row === null ? null : matchVirtualNumber(dialed, [row]);
  }

  /**
   * מספר לא מוכר שדיברו איתו בפועל — ליד חדש.
   *
   * השם נשמר כמספר עצמו: אין לנו שם, והמצאת "לקוח מהטלפון" הייתה
   * מייצרת כרטיסים שאי אפשר לחפש. המתווך משלים את השם מהשיחה.
   *
   * כשהשיחה הגיעה למספר וירטואלי, הליד נפתח כבר **עם המקור, הסוכן
   * והנכס** של אותו מספר. זה כל הרעיון: סוכן שפותח את הליד יודע
   * מאיזו מודעה הוא הגיע ועל איזה נכס מדובר, בלי לשאול.
   */
  private async openLeadForUnknownCaller(
    tx: Parameters<Parameters<PrismaService["withExplicitTenant"]>[1]>[0],
    tenantId: string,
    phone: string,
    phoneHash: string,
    virtualNumber: VirtualNumberRule | null,
    direction: "inbound" | "outbound",
    callerName: string | undefined,
  ): Promise<{ contactId: string; leadId: string }> {
    const contact = await tx.contact.create({
      data: {
        id: ulid(),
        tenantId,
        /*
         * שם מהמרכזייה כשיש, והמספר כשאין.
         *
         * 015 שולח `callername`, וזה מה שמפריד בין כרטיס שאפשר
         * לחפש לפי שם לבין כרטיס שנקרא "0501234567". השדה נבלע עד
         * עכשיו. הוא מוצפן כמו כל שם — הוא פרט מזהה של אדם.
         */
        nameEncrypted: this.crypto.encrypt(callerName ?? phone),
        phoneEncrypted: this.crypto.encrypt(phone),
        phoneHash,
      },
      select: { id: true },
    });
    const leadId = ulid();
    /*
     * שיחה יוצאת אינה מגיעה ממספר וירטואלי — הסוכן הוא שיזם אותה,
     * וייחוסה לקמפיין היה מזהם את המדידה. המקור שלה הוא הפעולה
     * עצמה: הסוכן חייג.
     */
    const source =
      direction === "outbound" ? "outbound_call" : virtualNumber === null ? "phone" : leadSourceFor(virtualNumber);
    /*
     * הסוכן מאומת **בזמן הכתיבה** ולא רק בזמן ההגדרה.
     *
     * סוכן שהושבת נשאר בטבלה עם `isActive = false`, ולכן מפתח הזר
     * אינו מאפס את השיוך. בלי הבדיקה כאן כל שיחה למספר הזה הייתה
     * פותחת ליד ששייך למשתמש לא פעיל — כלומר ליד שאף סוכן פעיל
     * עם `leads.view_own` אינו רואה. ליד בלתי נראה גרוע מליד בערימה
     * המשותפת, ולכן הנפילה היא ל-null (ביקורת Codex).
     */
    const assignedToUserId =
      direction === "outbound" ||
      virtualNumber?.assignedToUserId === undefined ||
      virtualNumber?.assignedToUserId === null
        ? null
        : ((
            await tx.user.findFirst({
              where: { id: virtualNumber.assignedToUserId, tenantId, isActive: true },
              select: { id: true },
            })
          )?.id ?? null);
    await tx.lead.create({
      data: {
        id: leadId,
        tenantId,
        contactId: contact.id,
        source,
        status: "new",
        // הסוכן אומת למעלה; הנכס מוגן במפתח זר עם ON DELETE SET NULL
        assignedToUserId,
        propertyId: direction === "outbound" ? null : (virtualNumber?.propertyId ?? null),
        summary:
          direction === "outbound"
            ? "נפתח אוטומטית משיחה יוצאת למספר שאינו מוכר"
            : virtualNumber === null
              ? "נפתח אוטומטית משיחה נכנסת ממספר שאינו מוכר"
              : `נפתח אוטומטית משיחה נכנסת אל ${virtualNumber.label}`,
      },
    });
    /*
     * אירוע lead.created, כמו בכל שאר מסלולי הקליטה.
     *
     * ה-Dispatcher מתזמן ממנו את משימת ה-SLA. בלעדיו ליד שנפתח
     * משיחה היה היחיד שלא מקבל התראת "ליד ממתין" אם אף אחד לא נוגע
     * בו — כלומר בדיוק הליד שהכי קל לשכוח (ביקורת Codex).
     */
    await tx.outboxEvent.create({
      data: {
        id: ulid(),
        tenantId,
        name: "lead.created",
        // המקור האמיתי ולא "phone" קבוע: אוטומציות שמתנות במקור
        // הליד צריכות לראות את הקמפיין, לא את אמצעי ההגעה
        payload: { leadId, tenantId, source },
      },
    });
    return { contactId: contact.id, leadId };
  }
}
