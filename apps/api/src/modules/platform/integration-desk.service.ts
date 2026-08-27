import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { ulid } from "ulid";
import {
  TELEPHONY_PROVIDERS,
  mergeIntegrationSecrets,
  mergeLegacySecretsIntoConfig,
  telephonyProvider,
  telephonySecretKeys,
} from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { CryptoService } from "../../core/crypto.service";
import { PrismaService } from "../../core/prisma.service";
import type { TenantTx } from "../../core/prisma.service";
import { loadEnv } from "../../config/env";

/**
 * שולחן החיבורים — **עזרה טכנית בלי גישה למאגר.**
 *
 * ## הבעיה
 *
 * חיבור מרכזייה הוא הצעד הטכני היחיד שהמשרד עושה לבד, והוא זה
 * שהכי הרבה משרדים נתקעים בו: שם משתמש של ספק, כתובת Webhook
 * שצריך להדביק במקום הנכון, שדה שהמרכזייה שולחת בשם אחר. עד היום
 * הדרך היחידה שמנהל הפלטפורמה יכול היה לעזור הייתה
 * **`support-session`** — כלומר לבקש מהמשרד לפתוח חלון גישה, ואז
 * להיכנס כמשתמש שלו: עם הלידים, הלקוחות, ההקלטות והכספים. פתרון
 * טכני שדורש את מפתחות הבית.
 *
 * ## הגבול
 *
 * ההפרדה כאן היא **לפי סוג הנתונים ולא לפי זהות**. אין סשן, אין
 * התחזות ואין עוגייה: הקוד ניגש דרך `withExplicitTenant` אל טבלת
 * `integrations` בלבד — הטבלה שבה יושבים הספק, ההגדרות שאינן סוד,
 * מפתח ה-Webhook והאבחון. אין ממנה נתיב ל-`contacts`, ל-`leads`,
 * ל-`calls` או ל-`messages`, ו-RLS ממשיך לאכוף שכל שאילתה כאן
 * מוגבלת למשרד שנבחר.
 *
 * הגבול הזה **נאכף במבחן מבני** (`integration-desk-scope.test.ts`):
 * הרשימה הלבנה של הטבלאות נגזרת מהקובץ הזה עצמו, כך ששינוי עתידי
 * שירחיב את הגישה ייפול בבדיקה ולא יעבור בשקט.
 *
 * ## ומה עם הסודות
 *
 * סיסמת ספק נכתבת ולא נקראת — בדיוק כמו למנהל המשרד עצמו. מה
 * שחוזר למסך הוא **שמות** המפתחות ששמורים, לא הערכים.
 *
 * ## ולמה זה לא "כוח פלטפורמה"
 *
 * כל פעולה כאן נרשמת ביומן הביקורת **של המשרד** ומייצרת התראה
 * לבעליו. השקיפות היא התחליף להסכמה-מראש: המשרד אינו צריך למסור
 * מפתחות כדי לקבל עזרה, והוא כן רואה בדיוק מה נעשה, מתי, ועל ידי
 * מי.
 */

/** מה שחוזר למסך על חיבור המרכזייה של משרד. */
export interface DeskTelephonyStatus {
  connected: boolean;
  provider?: string;
  providerLabel?: string;
  status?: string;
  /** הכתובת שהמרכזייה פונה אליה. חסרת ערך בלי המפתח שכבר בתוכה. */
  webhookUrl?: string;
  lastEventAt?: Date;
  lastEventKeys?: string;
  lastEventOk?: boolean;
  lastEventIssue?: string;
  /** שמות הסודות ששמורים — לעולם לא הערכים. */
  secretsSet: string[];
  config: Record<string, unknown>;
}

@Injectable()
export class IntegrationDeskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /** קטלוג הספקים — כדי שהמסך לא יצרוך נתיב ששייך למשרד. */
  providers(): typeof TELEPHONY_PROVIDERS {
    return TELEPHONY_PROVIDERS;
  }

  private webhookUrl(key: string): string {
    return `${loadEnv().WEB_ORIGIN}/api/v1/public/telephony/${key}`;
  }

  /** גוש סודות פגום מחזיר ריק — מסך שלא נפתח גם לא מתקן כלום. */
  private readSecrets(encrypted: string | null): Record<string, string> {
    if (!encrypted) return {};
    try {
      const parsed: unknown = JSON.parse(this.crypto.decrypt(encrypted));
      return typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, string>)
        : {};
    } catch {
      return {};
    }
  }

  /**
   * שם המשרד — כדי שהמסך יאמר על מי מדובר.
   *
   * `tenants` אינה טבלת נתונים של לקוחות: היא הרשומה של המשרד
   * עצמו, ומנהל הפלטפורמה רואה אותה ממילא ברשימת המשרדים.
   */
  async agencyName(tenantId: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true },
    });
    if (!tenant) throw new NotFoundException("משרד לא נמצא");
    return tenant.name;
  }

  async telephonyStatus(tenantId: string): Promise<DeskTelephonyStatus> {
    await this.agencyName(tenantId);
    const row = await this.prisma.withExplicitTenant(tenantId, (tx) =>
      tx.integration.findFirst({ where: { tenantId, kind: "telephony" } }),
    );
    if (!row) return { connected: false, secretsSet: [], config: {} };
    const provider = telephonyProvider(row.provider);
    const stored = this.readSecrets(row.secretsEncrypted);
    const secretKeys = provider ? telephonySecretKeys(provider) : [];
    return {
      connected: true,
      provider: row.provider,
      providerLabel: provider?.label ?? row.provider,
      status: row.status,
      webhookUrl: this.webhookUrl(row.webhookKey),
      secretsSet: secretKeys.filter((key) => (stored[key] ?? "").trim() !== ""),
      ...(row.lastEventAt ? { lastEventAt: row.lastEventAt } : {}),
      ...(row.lastEventKeys ? { lastEventKeys: row.lastEventKeys } : {}),
      ...(row.lastEventOk !== null ? { lastEventOk: row.lastEventOk } : {}),
      ...(row.lastEventIssue ? { lastEventIssue: row.lastEventIssue } : {}),
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
   * חיבור או עדכון בשם המשרד.
   *
   * הסודות ממוזגים לפי מפתח ולא מוחלפים כגוש — אותה משמעת כמו
   * במסך של המשרד עצמו, ומאותה סיבה: שמירה שמילאה רק שדה אחד
   * הייתה מוחקת את השאר בשקט.
   */
  async saveTelephony(
    tenantId: string,
    input: { provider: string; config: Record<string, string>; secrets: Record<string, string> },
  ): Promise<{ ok: true }> {
    const agency = await this.agencyName(tenantId);
    const provider = telephonyProvider(input.provider);
    if (!provider) throw new BadRequestException("ספק לא מוכר");
    const adminEmail = await this.adminEmail();

    await this.prisma.withExplicitTenant(tenantId, async (tx) => {
      const existing = await tx.integration.findFirst({
        where: { tenantId, kind: "telephony" },
        select: { id: true, secretsEncrypted: true, provider: true },
      });
      const providerChanged = existing !== null && existing.provider !== input.provider;
      const merged = mergeIntegrationSecrets(
        this.readSecrets(existing?.secretsEncrypted ?? null),
        input.secrets,
        telephonySecretKeys(provider),
        { providerChanged },
      );
      const secretsEncrypted =
        Object.keys(merged).length > 0 ? this.crypto.encrypt(JSON.stringify(merged)) : null;

      if (existing) {
        await tx.integration.updateMany({
          where: { id: existing.id, tenantId },
          data: {
            provider: input.provider,
            status: "active",
            config: input.config,
            secretsEncrypted,
            // החלפת ספק מאפסת את האבחון — אחרת האירוע של הספק הקודם
            // נקרא כהוכחה שהחדש עובד
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
            webhookKey: randomBytes(24).toString("base64url"),
          },
        });
      }

      await this.recordForOffice(tx, tenantId, {
        action: existing ? "integration.platform_update" : "integration.platform_connect",
        adminEmail,
        provider: input.provider,
        // שמות בלבד: איזה סודות הוחלפו, לא מה הוזן
        secretKeys: Object.keys(input.secrets).filter((key) => input.secrets[key] !== ""),
        agency,
      });
    });
    return { ok: true };
  }

  /** האימייל של מי שפועל — מה שהופך "מנהל הפלטפורמה" לשם. */
  private async adminEmail(): Promise<string> {
    const admin = await this.prisma.user.findUnique({
      where: { id: TenantContext.current().userId },
      select: { email: true },
    });
    return admin?.email ?? "platform";
  }

  /**
   * היומן וההתראה — **אצל המשרד, לא אצל הפלטפורמה.**
   *
   * `userId: null` כי לא משתמש של המשרד פעל כאן; מי שפעל מופיע
   * במפורש ב-`metadata`. ההתראה היא לכל המשרד (`userId: null`)
   * ולא לבעלים בלבד: מי שמנסה לחבר מרכזייה הוא לעיתים קרובות מנהל
   * הסניף ולא הבעלים, והוא זה שצריך לדעת שההגדרה זזה מתחת לידיו.
   */
  private async recordForOffice(
    tx: TenantTx,
    tenantId: string,
    what: {
      action: string;
      adminEmail: string;
      provider: string;
      secretKeys: string[];
      agency: string;
    },
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        id: ulid(),
        tenantId,
        userId: null,
        action: what.action,
        entityType: "integration",
        entityId: tenantId,
        metadata: {
          kind: "telephony",
          provider: what.provider,
          platformAdmin: what.adminEmail,
          secretsChanged: what.secretKeys,
        } as object,
      },
    });
    await tx.notification.create({
      data: {
        id: ulid(),
        tenantId,
        userId: null,
        type: "integration_platform_change",
        title: "מנהל הפלטפורמה עדכן את חיבור המרכזייה",
        body: `העדכון נעשה על ידי ${what.adminEmail} וכתוב ביומן הפעילות של המשרד.`,
        entityType: "integration",
        entityId: tenantId,
      },
    });
  }
}
