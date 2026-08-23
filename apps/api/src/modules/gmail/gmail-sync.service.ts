import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { PhoneSchema, normalizeNameForMatch } from "@metavchim/shared";
import { CryptoService } from "../../core/crypto.service";
import { PrismaService } from "../../core/prisma.service";
import { WebLeadService } from "../leads/web-lead.service";
import { GmailService, type GmailLinkRow, type InboundEmail } from "./gmail.service";

/**
 * סורק ה-Gmail — כל רבע שעה, על כל החיבורים הפעילים.
 *
 * מה קורה לכל הודעה נכנסת, לפי הסדר:
 * 1. השולח מוכר (חתימת האימייל תואמת כרטיס) — הפנייה מצטרפת לליד
 *    הפתוח שלו או פותחת ליד חדש על הכרטיס הקיים.
 * 2. השולח לא מוכר אבל בהודעה מזוהה מספר טלפון ישראלי (פורטלים
 *    כמו יד2 שולחים את הטלפון של הפונה בגוף האימייל) — נקלט דרך
 *    אותו מסלול בדיוק כמו טופס האתר, בשם השולח ובמקור "אימייל".
 * 3. אין זיהוי — ההודעה מדולגת ונספרת; המונה מוצג במסך ההגדרות.
 *    כרטיס אינו נוצר בלי טלפון: הטלפון הוא המפתח שכל המערכת בנויה
 *    עליו (כפילויות, וואטסאפ, חיוג), וכרטיס בלעדיו היה רשומה יתומה.
 *
 * הסורק יושב ב-API ולא ב-workers מאותה סיבה כמו סורק היומן: הוא
 * צריך את פרטי הלקוח של Google ואת מפתח ההצפנה.
 */

const TICK_MS = 15 * 60 * 1000;
const BATCH = 20;

/** מספר ישראלי בתוך טקסט חופשי — כולל רווחים ומקפים באמצע. */
const PHONE_IN_TEXT = /0(?:5\d|7\d|[23489])[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}/u;

function extractPhone(text: string): string | null {
  const match = PHONE_IN_TEXT.exec(text);
  if (!match) return null;
  const digits = match[0].replace(/\D/gu, "");
  const normalized = `+972${digits.slice(1)}`;
  return PhoneSchema.safeParse(normalized).success ? normalized : null;
}

@Injectable()
export class GmailSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GmailSyncService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gmail: GmailService,
    private readonly crypto: CryptoService,
    private readonly webLeads: WebLeadService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.syncAll();
    } catch (err) {
      this.logger.error(`סבב Gmail נכשל: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.running = false;
    }
  }

  private async syncAll(): Promise<void> {
    if (!(await this.gmail.isConfigured())) return;
    const tenants = await this.prisma.tenant.findMany({
      where: { status: { in: ["active", "trial"] } },
      select: { id: true },
    });
    for (const tenant of tenants) {
      const links = await this.prisma.withExplicitTenant(tenant.id, (tx) =>
        tx.gmailLink.findMany({ orderBy: { lastSyncAt: "asc" }, take: BATCH }),
      );
      for (const link of links) {
        try {
          await this.processLink(link);
        } catch (err) {
          const message = err instanceof Error ? err.message : "שגיאה לא צפויה";
          await this.gmail
            .markSynced(link, { error: message.slice(0, 300) })
            .catch(() => undefined);
        }
      }
    }
  }

  /** סנכרון ידני — הכפתור "משוך עכשיו" במסך ההגדרות. */
  async syncOne(
    tenantId: string,
    userId: string,
  ): Promise<{ imported: number; skipped: number }> {
    const link = await this.gmail.linkFor(tenantId, userId);
    if (!link) return { imported: 0, skipped: 0 };
    return this.processLink(link);
  }

  private async processLink(link: GmailLinkRow): Promise<{ imported: number; skipped: number }> {
    await this.backfillEmailHashes(link.tenantId);
    const messages = await this.gmail.newInboundMessages(link);

    let imported = 0;
    let skipped = 0;
    let cursor = Number(link.lastInternalMs);
    let failure: string | null = null;

    /*
     * ההודעות ממוינות מהישנה לחדשה והסמן מתקדם אחרי כל אחת — גם אם
     * הודעה באמצע נכשלת, מה שכבר נקלט לא ייקלט שוב בסבב הבא
     * (ביקורת Codex). הודעה שנכשלה נספרת כדילוג והסמן ממשיך:
     * הודעה רעילה אחת לא חוסמת את התיבה לנצח.
     */
    for (const message of messages) {
      try {
        const handled = await this.handleMessage(link, message);
        if (handled) imported += 1;
        else skipped += 1;
      } catch (err) {
        skipped += 1;
        failure = (err instanceof Error ? err.message : "שגיאה בקליטת הודעה").slice(0, 300);
        this.logger.warn(`הודעת Gmail ${message.id} נכשלה: ${failure}`);
      }
      cursor = Math.max(cursor, message.internalMs);
    }

    await this.gmail.markSynced(link, {
      lastInternalMs: cursor,
      error: failure,
      skippedDelta: skipped,
    });
    if (messages.length > 0) {
      this.logger.log(
        `Gmail (tenant ${link.tenantId}): ${imported} נקלטו, ${skipped} דולגו`,
      );
    }
    return { imported, skipped };
  }

  private async handleMessage(link: GmailLinkRow, message: InboundEmail): Promise<boolean> {
    // הודעות מעצמי (טיוטות שנגררו ל-inbox, תיוגים) — לא לידים
    if (message.fromEmail === link.googleEmail.toLowerCase()) return false;

    const summary = [message.subject, message.snippet].filter(Boolean).join(" — ").slice(0, 1500);

    // 1. שולח מוכר — הכרטיס קיים, הפנייה נקשרת אליו
    const contact = await this.prisma.withExplicitTenant(link.tenantId, (tx) =>
      tx.contact.findFirst({
        where: { tenantId: link.tenantId, emailHash: this.crypto.emailHash(message.fromEmail) },
        select: { id: true },
      }),
    );
    if (contact) {
      await this.webLeads.ingestForContact(link.tenantId, contact.id, {
        message: summary,
        source: "אימייל",
      });
      return true;
    }

    // 2. שולח חדש עם טלפון בהודעה — אותו מסלול כמו טופס האתר
    const phone = extractPhone(`${message.subject} ${message.snippet}`);
    if (phone) {
      const name = normalizeNameForMatch(message.fromName) !== "" ? message.fromName : message.fromEmail;
      await this.webLeads.ingestForTenant(
        link.tenantId,
        // כתובת השולח נשמרת על הכרטיס: בלעדיה ההודעה הבאה מאותה
        // כתובת הייתה נחשבת שוב לשולח לא מוכר, ונקלטת רק אם במקרה
        // יש בה גם טלפון
        { name: name.slice(0, 120), phone, message: summary, email: message.fromEmail },
        "אימייל",
      );
      return true;
    }

    // 3. אין זיהוי — דילוג שקוף (נספר ומוצג במסך)
    return false;
  }

  /**
   * השלמת חתימות אימייל לכרטיסים קיימים — ההצפנה בשכבת האפליקציה,
   * ולכן המיגרציה לא יכלה למלא את העמודה. אותו דפוס כמו name_hash.
   */
  private async backfillEmailHashes(tenantId: string, limit = 300): Promise<void> {
    await this.prisma.withExplicitTenant(tenantId, async (tx) => {
      const rows = await tx.contact.findMany({
        where: { tenantId, emailEncrypted: { not: null }, emailHash: null },
        take: limit,
        select: { id: true, emailEncrypted: true },
      });
      for (const row of rows) {
        const email = this.crypto.decrypt(row.emailEncrypted!).trim().toLowerCase();
        await tx.contact.update({
          where: { id: row.id },
          data: { emailHash: this.crypto.emailHash(email) },
        });
      }
    });
  }
}
