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
  parse015DialResponse,
  parseTelephonyEvent,
  safeDiagnosticKeys,
  telephonyParseIssue,
  telephonyProvider,
  mergeIntegrationSecrets,
  mergeLegacySecretsIntoConfig,
  telephonySecretKeys,
} from "@metavchim/shared";
import { assertContactAccess } from "../../common/ownership";
import { TenantContext } from "../../common/tenant-context";
import { AuditService } from "../../core/audit.service";
import { CryptoService } from "../../core/crypto.service";
import { PlanCatalogService } from "../../core/plan-catalog.service";
import { PrismaService } from "../../core/prisma.service";
import { ContactsService } from "../contacts/contacts.service";
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
  ) {}

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
  async ingest(key: string, payload: Record<string, unknown>): Promise<void> {
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
    // מפתח לא מוכר — אותה שגיאה גנרית כמו בקליטת הלידים; לא מאשרים
    // קיום או אי-קיום של מפתחות
    if (!integration || integration.status !== "active") throw new NotFoundException("לא נמצא");

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
      throw new NotFoundException("לא נמצא");
    }

    const event = parseTelephonyEvent(payload);
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
     * `safeDiagnosticKeys` ולא `Object.keys` גולמי: ספק עם מפתחות
     * דינמיים יכול לשלוח `{"0501234567": "..."}`, וכך מספר הלקוח היה
     * נשמר בעמודה גלויה ונכתב ללוג — בדיוק מה שההצפנה בכל שאר
     * המערכת מונעת (ביקורת Codex).
     */
    await this.prisma.withExplicitTenant(tenantId, async (tx) => {
      await tx.integration.updateMany({
        where: { id: integration.id, tenantId },
        data: {
          lastEventAt: new Date(),
          lastEventKeys: safeDiagnosticKeys(Object.keys(payload)),
          lastEventOk: event !== null,
          lastEventIssue: event === null ? telephonyParseIssue(payload) : null,
        },
      });
    });
    if (!event) {
      this.logger.warn(
        `אירוע מרכזייה שלא זוהה (${integration.tenantId}): ${telephonyParseIssue(payload) ?? "לא ידוע"}. ` +
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
       * בדיקת הכפילות רצה לפני הפיצול לענפים, ולא רק במסלול הרישום.
       *
       * ספק ששולח שוב אירוע צלצול — כי לא קיבל 200, או סתם — היה
       * מייצר התראה נוספת על אותה שיחה בכל שליחה (ביקורת Codex).
       */
      const seen = await tx.call.findFirst({
        where: { tenantId, providerCallId: event.providerCallId },
        select: { id: true, outcome: true },
      });

      if (action.notify) {
        if (seen) return; // כבר טופל — לא מתריעים פעמיים
        /*
         * ההתראה נכתבת לכל המשרד (userId = null) ולא לסוכן מסוים:
         * השלוחה שהמרכזייה מדווחת עליה היא של המכשיר שמצלצל, ואין
         * לנו מיפוי אמין ממנה למשתמש. עדיף שכולם יראו מי מתקשר מאשר
         * שההתראה תגיע לאדם הלא נכון.
         */
        await tx.notification.create({
          data: {
            id: ulid(),
            tenantId,
            userId: null,
            type: "incoming_call",
            title: incomingCallTitle(contactName, event.peerPhone),
            body: contact ? null : "מספר שאינו מוכר במערכת",
            entityType: contact ? "contact" : null,
            entityId: contact?.id ?? null,
          },
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
      let contactId = contact?.id ?? null;
      let leadId: string | null = null;
      if (action.createLead) {
        const opened = await this.openLeadForUnknownCaller(tx, tenantId, event.peerPhone, phoneHash);
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
          occurredAt: new Date(),
          // שיחה שלא נענתה נשארת בלי משך. עיגול כלפי מעלה היה מציג
          // "דקה אחת" על שיחה שהסיכום שלה אומר שלא נענתה כלל.
          durationMinutes:
            event.type === "missed" || event.durationSeconds === undefined
              ? null
              : Math.max(1, Math.round(event.durationSeconds / 60)),
          outcome: event.type === "missed" ? "missed" : "answered",
          summary: describeCall(event),
        },
      });
    });
  }

  /**
   * מספר לא מוכר שדיברו איתו בפועל — ליד חדש.
   *
   * השם נשמר כמספר עצמו: אין לנו שם, והמצאת "לקוח מהטלפון" הייתה
   * מייצרת כרטיסים שאי אפשר לחפש. המתווך משלים את השם מהשיחה.
   */
  private async openLeadForUnknownCaller(
    tx: Parameters<Parameters<PrismaService["withExplicitTenant"]>[1]>[0],
    tenantId: string,
    phone: string,
    phoneHash: string,
  ): Promise<{ contactId: string; leadId: string }> {
    const contact = await tx.contact.create({
      data: {
        id: ulid(),
        tenantId,
        nameEncrypted: this.crypto.encrypt(phone),
        phoneEncrypted: this.crypto.encrypt(phone),
        phoneHash,
      },
      select: { id: true },
    });
    const leadId = ulid();
    await tx.lead.create({
      data: {
        id: leadId,
        tenantId,
        contactId: contact.id,
        source: "phone",
        status: "new",
        summary: "נפתח אוטומטית משיחה נכנסת ממספר שאינו מוכר",
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
        payload: { leadId, tenantId, source: "phone" },
      },
    });
    return { contactId: contact.id, leadId };
  }
}
