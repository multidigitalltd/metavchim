import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { ulid } from "ulid";
import {
  callAction,
  describeCall,
  incomingCallTitle,
  parseTelephonyEvent,
  telephonyProvider,
} from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { AuditService } from "../../core/audit.service";
import { CryptoService } from "../../core/crypto.service";
import { PlanCatalogService } from "../../core/plan-catalog.service";
import { PrismaService } from "../../core/prisma.service";
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly plans: PlanCatalogService,
  ) {}

  private webhookUrl(key: string): string {
    return `${loadEnv().WEB_ORIGIN}/api/v1/public/telephony/${key}`;
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
  }> {
    const tenantId = TenantContext.current().tenantId;
    const row = await this.prisma.withTenant((tx) =>
      tx.integration.findFirst({ where: { tenantId, kind: "telephony" } }),
    );
    if (!row) return { connected: false, clickToDial: false, config: {} };
    const provider = telephonyProvider(row.provider);
    return {
      connected: true,
      provider: row.provider,
      providerLabel: provider?.label ?? row.provider,
      status: row.status,
      // הכתובת עצמה אינה סוד — היא חסרת ערך בלי המפתח שכבר בתוכה,
      // ומנהל המשרד חייב אותה כדי להזין אותה במרכזייה שלו
      webhookUrl: this.webhookUrl(row.webhookKey),
      lastEventAt: row.lastEventAt ?? undefined,
      clickToDial: provider?.clickToDial ?? false,
      config: (row.config ?? {}) as Record<string, unknown>,
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
        select: { id: true, secretsEncrypted: true },
      });
      const secretsGiven = Object.keys(input.secrets).length > 0;
      const secretsEncrypted = secretsGiven
        ? this.crypto.encrypt(JSON.stringify(input.secrets))
        : (existing?.secretsEncrypted ?? null);

      if (existing) {
        await tx.integration.updateMany({
          where: { id: existing.id, tenantId },
          data: {
            provider: input.provider,
            status: "active",
            config: input.config,
            secretsEncrypted,
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
    if (!event) return; // חסר מספר או מזהה — אין מה לעשות איתו

    const tenantId = integration.tenantId;
    await this.prisma.withExplicitTenant(tenantId, async (tx) => {
      await tx.integration.updateMany({
        where: { id: integration.id, tenantId },
        data: { lastEventAt: new Date() },
      });

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
