import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { ulid } from "ulid";
import {
  TELEPHONY_PROVIDERS,
  canonicalVirtualNumber,
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
 * ## ומה עם המספרים הווירטואליים
 *
 * השולחן נוגע גם בטבלת `virtual_numbers` — המספר, שמו והסוכן
 * שמקבל את הלידים ממנו — וברשימת **הצוות** של המשרד (מזהה ושם
 * בלבד) כדי שיהיה את מי לבחור. שניהם הגדרות של המשרד ולא נתונים
 * של לקוחותיו: הם אותה שכבה בדיוק כמו הספק ושם המשתמש שלו, ומאותה
 * סיבה נתקעים בה. משרד שכל סוכן בו מקבל מספר נפרד מהמרכזייה מבקש
 * מהפלטפורמה לחבר את המספרים לסוכנים, ובלי המסלול הזה התשובה
 * הייתה שוב „פתחו לנו גישת תמיכה”.
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

/** המספרים של משרד והצוות שאפשר לשייך אליו — למסך השולחן. */
export interface DeskVirtualNumbers {
  numbers: {
    id: string;
    phone: string;
    label: string;
    assignedToUserId: string | null;
    isActive: boolean;
  }[];
  users: { id: string; name: string }[];
}

/**
 * שורה אחת בשמירה. עם `id` — עדכון של שדות שנשלחו בלבד; בלי — יצירה.
 * שדה שאינו מופיע (`undefined`) אינו נכתב, ולכן שינוי מקביל של
 * המשרד בשדה השני שורד.
 */
export interface DeskVirtualNumberInput {
  id?: string;
  phone: string;
  label?: string;
  assignedToUserId?: string | null;
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

  /* ==================== מספרים וירטואליים ==================== */

  /**
   * המספרים של המשרד והצוות שאפשר לשייך אליו.
   *
   * הצוות מגיע עם מזהה ושם בלבד, ורק הפעילים: סוכן שהושבת אינו
   * יעד לשיוך, ושיוך אליו היה מייצר לידים שאף סוכן פעיל אינו רואה
   * (אותה בדיקה שהניתוב עצמו עושה בזמן הכתיבה).
   */
  async virtualNumbers(tenantId: string): Promise<DeskVirtualNumbers> {
    await this.agencyName(tenantId);
    const [rows, users] = await this.prisma.withExplicitTenant(tenantId, (tx) =>
      Promise.all([
        tx.virtualNumber.findMany({
          where: { tenantId },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            phone: true,
            label: true,
            assignedToUserId: true,
            isActive: true,
          },
        }),
        tx.user.findMany({
          where: { tenantId, isActive: true },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        }),
      ]),
    );
    /*
     * שיוך לסוכן שהושבת חוזר כ-`null` — **כי זה מה שהוא בפועל.**
     *
     * הניתוב מאמת את הסוכן בזמן הכתיבה ונופל ל-null כשאינו פעיל,
     * ולכן „משויך למושבת” ו„לערימה המשותפת” הם אותו דבר לכל שיחה
     * שתגיע. להחזיר את המזהה הישן היה מציג במסך בחירה ריקה, ושמירה
     * של השורה הייתה נדחית על „סוכן לא פעיל” שאיש לא בחר בו
     * (ביקורת Codex).
     */
    const active = new Set(users.map((user) => user.id));
    const numbers = rows.map((row) => ({
      ...row,
      assignedToUserId:
        row.assignedToUserId !== null && active.has(row.assignedToUserId)
          ? row.assignedToUserId
          : null,
    }));
    return { numbers, users };
  }

  /**
   * שיוך מספרים לסוכנים בשם המשרד — **שמירה אחת לכל הרשימה.**
   *
   * שורה קיימת מזוהה לפי המזהה שלה ומתעדכנת בשדות שנשלחו בלבד;
   * שורה חדשה (בלי מזהה) נוצרת. כך מנהל הפלטפורמה ממלא טבלה אחת
   * של „מספר ← סוכן” ולוחץ פעם אחת, ולא מנהל בנפרד יצירה ועדכון.
   *
   * השורה כולה בטרנזקציה אחת ועם רישום אחד ביומן והתראה אחת: עשרה
   * מספרים לעשרה סוכנים הם פעולה אחת של המשרד, לא עשר.
   *
   * **המסך שולח רק שורות שהשתנו.** שליחת הטבלה כולה הייתה דורסת
   * שיוך שמנהל המשרד שינה בין הטעינה לשמירה — בשקט, ובלי שאיש
   * התכוון (ביקורת Codex). השרת אינו יכול להבחין בין „לא נגעתי”
   * ל„בחרתי את אותו ערך”, ולכן ההבחנה נעשית אצל מי שיודע: הלקוח.
   *
   * מה **לא** נשמר כאן: נכס, מקור ליד וכיבוי. אלה בחירות של המשרד
   * על הקמפיינים שלו; השולחן פותר את החיבור הטכני בלבד.
   */
  async assignVirtualNumbers(
    tenantId: string,
    entries: DeskVirtualNumberInput[],
  ): Promise<{ ok: true; saved: number }> {
    const agency = await this.agencyName(tenantId);
    const adminEmail = await this.adminEmail();

    /*
     * הנרמול והדחייה **לפני** הטרנזקציה, על כל הרשימה: הודעה
     * ששמה את המספר הפגום עדיפה על גלגול-אחורה אחרי חצי רשימה.
     * מספר של שורה קיימת אינו משתנה כאן, ולכן רק שורות חדשות
     * מנורמלות ונבדקות לכפילות.
     */
    const creations = entries.filter((entry) => entry.id === undefined);
    const updates = entries.filter((entry): entry is DeskVirtualNumberInput & { id: string } =>
      entry.id !== undefined,
    );
    const canonical = creations.map((entry) => {
      const phone = canonicalVirtualNumber(entry.phone);
      if (phone === "") {
        throw new BadRequestException(`המספר ${entry.phone} אינו מספר טלפון ישראלי תקין`);
      }
      return { ...entry, phone };
    });
    const seen = new Set<string>();
    for (const entry of canonical) {
      if (seen.has(entry.phone)) {
        throw new BadRequestException(`המספר ${entry.phone} מופיע פעמיים ברשימה`);
      }
      seen.add(entry.phone);
    }

    await this.prisma.withExplicitTenant(tenantId, async (tx) => {
      /*
       * הסוכנים מאומתים מול המשרד **הזה** ופעילים. מזהה של סוכן
       * ממשרד אחר היה עובר את הסכמה ונשמר בשקט — ואז מנתב לידים
       * לאדם שאינו קיים במשרד.
       */
      const wanted = [
        ...new Set(
          entries
            .map((entry) => entry.assignedToUserId)
            .filter((id): id is string => typeof id === "string"),
        ),
      ];
      const users =
        wanted.length === 0
          ? []
          : await tx.user.findMany({
              where: { tenantId, isActive: true, id: { in: wanted } },
              select: { id: true, name: true },
            });
      const byId = new Map(users.map((user) => [user.id, user.name]));
      const missing = wanted.find((id) => !byId.has(id));
      if (missing !== undefined) {
        throw new BadRequestException("אחד הסוכנים שנבחרו אינו פעיל במשרד הזה");
      }

      /*
       * **עדכון לפי מזהה, ולא לפי מספר.** שורה שהמשרד מחק בין
       * הטעינה לשמירה אינה נוצרת מחדש בשקט עם ניתוב שהוא הסיר
       * בכוונה — היא נדחית, והמסך נטען מחדש (ביקורת Codex).
       *
       * ורק השדות שנשלחו נכתבים: שם שלא נגעו בו אינו דורס שם
       * שהמשרד שינה בינתיים, וכך גם הסוכן.
       */
      for (const entry of updates) {
        const label = entry.label?.trim();
        const data = {
          ...(label !== undefined && label !== "" ? { label } : {}),
          ...(entry.assignedToUserId !== undefined
            ? { assignedToUserId: entry.assignedToUserId }
            : {}),
        };
        if (Object.keys(data).length === 0) continue;
        const changed = await tx.virtualNumber.updateMany({
          where: { id: entry.id, tenantId },
          data,
        });
        if (changed.count === 0) {
          throw new BadRequestException(
            `המספר ${entry.phone} כבר אינו קיים אצל המשרד — טענו את הרשימה מחדש`,
          );
        }
      }

      /*
       * יצירה רק למספר שאינו קיים: מספר שכבר מוגדר אצל המשרד נדחה
       * במקום להתעדכן בשקט מתחת לשורה שהמשרד מכיר.
       */
      for (const entry of canonical) {
        const existing = await tx.virtualNumber.findFirst({
          where: { tenantId, phone: entry.phone },
          select: { id: true },
        });
        if (existing) {
          throw new BadRequestException(`המספר ${entry.phone} כבר מוגדר אצל המשרד`);
        }
        const label = entry.label?.trim() ?? "";
        await tx.virtualNumber.create({
          data: {
            id: ulid(),
            tenantId,
            phone: entry.phone,
            label: label !== "" ? label : `מספר ${entry.phone}`,
            assignedToUserId: entry.assignedToUserId ?? null,
            // אין משתמש של המשרד שיצר — מי שפעל רשום ביומן
            createdBy: null,
          },
        });
      }

      await this.recordAssignmentsForOffice(tx, tenantId, {
        adminEmail,
        agency,
        assignments: [...updates, ...canonical].map((entry) => ({
          phone: entry.phone,
          ...(entry.label !== undefined && entry.label.trim() !== ""
            ? { label: entry.label.trim() }
            : {}),
          ...(entry.assignedToUserId !== undefined
            ? {
                agent:
                  entry.assignedToUserId === null
                    ? null
                    : (byId.get(entry.assignedToUserId) ?? null),
              }
            : {}),
        })),
      });
    });
    return { ok: true, saved: entries.length };
  }

  /**
   * מחיקת מספר וירטואלי בשם המשרד.
   *
   * מוציאה את ההגדרה בלבד — **ההיסטוריה שורדת**: כל שיחה מחזיקה את
   * המספר ואת שמו כצילום, בדיוק כמו במחיקה ממסך המשרד. חיוב חודשי
   * שנפתח על המספר אינו נסגר מכאן; הוא נסגר במסך ההשכרות.
   */
  async deleteVirtualNumber(tenantId: string, numberId: string): Promise<{ ok: true }> {
    await this.agencyName(tenantId);
    const adminEmail = await this.adminEmail();
    await this.prisma.withExplicitTenant(tenantId, async (tx) => {
      const row = await tx.virtualNumber.findFirst({
        where: { id: numberId, tenantId },
        select: { phone: true, label: true },
      });
      if (row === null) {
        throw new BadRequestException("המספר כבר אינו קיים אצל המשרד — טענו את הרשימה מחדש");
      }
      await tx.virtualNumber.deleteMany({ where: { id: numberId, tenantId } });
      await tx.auditLog.create({
        data: {
          id: ulid(),
          tenantId,
          userId: null,
          action: "virtual_number.platform_delete",
          entityType: "virtual_number",
          entityId: numberId,
          metadata: { platformAdmin: adminEmail, phone: row.phone, label: row.label } as object,
        },
      });
      await tx.notification.create({
        data: {
          id: ulid(),
          tenantId,
          userId: null,
          type: "integration_platform_change",
          title: "מנהל הפלטפורמה מחק מספר וירטואלי",
          body: `${row.label} (${row.phone}) הוסר על ידי ${adminEmail}. השיחות שכבר נקלטו נשמרות.`,
          entityType: "virtual_number",
          entityId: tenantId,
        },
      });
    });
    return { ok: true };
  }

  /**
   * היומן וההתראה על שיוך — אצל המשרד, כמו על חיבור המרכזייה.
   *
   * ה-`metadata` נושא את הרשימה עצמה (מספר ← מה השתנה בו): זה מה
   * שמנהל המשרד יקרא כשישאל „מי שינה את הניתוב של המספר של דוד”.
   */
  private async recordAssignmentsForOffice(
    tx: TenantTx,
    tenantId: string,
    what: {
      adminEmail: string;
      agency: string;
      /** לכל שורה: מה שהשתנה בה בלבד — שם, סוכן (null = ערימה), או שניהם. */
      assignments: { phone: string; agent?: string | null; label?: string }[];
    },
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        id: ulid(),
        tenantId,
        userId: null,
        action: "virtual_number.platform_assign",
        entityType: "virtual_number",
        entityId: tenantId,
        metadata: {
          platformAdmin: what.adminEmail,
          assignments: what.assignments,
        } as object,
      },
    });
    await tx.notification.create({
      data: {
        id: ulid(),
        tenantId,
        userId: null,
        type: "integration_platform_change",
        title: "מנהל הפלטפורמה שייך מספרים וירטואליים לסוכנים",
        body: `${what.assignments.length} מספרים עודכנו על ידי ${what.adminEmail}. הפירוט ביומן הפעילות של המשרד.`,
        entityType: "virtual_number",
        entityId: tenantId,
      },
    });
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
