import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ulid } from "ulid";
import {
  bankDetailsRejectionReason,
  maskAccountNumber,
  payoutRequestRejectionReason,
  payoutTransitionRejectionReason,
  shekels,
  type BankDetails,
  type PayoutStatus,
} from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { AuditService } from "../../core/audit.service";
import { CreditEconomyService } from "../../core/credit-economy.service";
import { CryptoService } from "../../core/crypto.service";
import { PrismaService, type TenantTx } from "../../core/prisma.service";

/**
 * משיכת היתרה הכספית.
 *
 * **הכסף יורד מהיתרה ברגע הבקשה ולא ברגע האישור.** משרד שלוחץ פעמיים
 * לפני שהראשונה טופלה היה מקבל את אותו סכום פעמיים, ואת זה מגלים
 * אחרי שההעברה כבר יצאה. דחייה מחזירה את הסכום כתנועה משלה — הספר
 * הוא Append-Only, ואין בו מחיקות.
 */

export interface PayoutBalanceDto {
  balanceAgorot: number;
  /** הסף שמתחתיו לא מושכים, כפי שהוגדר בפלטפורמה. */
  minimumAgorot: number;
  /** סכום שכבר מוחזק בבקשות פתוחות — כלול בירידה מהיתרה. */
  pendingAgorot: number;
}

export interface PayoutRequestDto {
  id: string;
  amountAgorot: number;
  status: PayoutStatus;
  /** ממוסך. הפרטים המלאים נחשפים רק בפתיחת הבקשה בצד הפלטפורמה. */
  accountMasked: string;
  note?: string;
  decisionNote?: string;
  reference?: string;
  createdAt: string;
  decidedAt?: string;
  paidAt?: string;
}

/** מה שהפלטפורמה רואה — כולל פרטי הבנק המלאים ושם המשרד. */
export interface PayoutRequestAdminDto extends PayoutRequestDto {
  tenantId: string;
  tenantName: string;
  bank: BankDetails;
}

@Injectable()
export class PayoutsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly economy: CreditEconomyService,
    private readonly audit: AuditService,
  ) {}

  /* ============================================================
     צד המשרד
     ============================================================ */

  async balance(): Promise<PayoutBalanceDto> {
    const tenantId = TenantContext.current().tenantId;
    const { payoutMinimumAgorot } = await this.economy.current();
    return this.prisma.withTenant(async (tx) => {
      const balanceAgorot = await this.balanceInTx(tx, tenantId);
      const pending = await tx.payoutRequest.aggregate({
        where: { tenantId, status: { in: ["pending", "approved"] } },
        _sum: { amountAgorot: true },
      });
      return {
        balanceAgorot,
        minimumAgorot: payoutMinimumAgorot,
        pendingAgorot: pending._sum.amountAgorot ?? 0,
      };
    });
  }

  async listMine(): Promise<PayoutRequestDto[]> {
    const tenantId = TenantContext.current().tenantId;
    const rows = await this.prisma.withTenant((tx) =>
      tx.payoutRequest.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    );
    return rows.map((row) => this.toDto(row));
  }

  /**
   * בקשת משיכה חדשה.
   *
   * הנעילה על השורות הקיימות היא ההגנה מפני שתי בקשות מקבילות שקוראות
   * את אותה יתרה לפני ששתיהן מושכות — אותו דפוס בדיוק כמו בהוצאת
   * קרדיטים, ומאותה סיבה: בלעדיה שתיהן עוברות גם כשהסכום המשותף גדול
   * מהיתרה.
   */
  async request(input: {
    amountAgorot: number;
    bank: BankDetails;
    note?: string;
  }): Promise<PayoutRequestDto> {
    const ctx = TenantContext.current();
    const bankProblem = bankDetailsRejectionReason(input.bank);
    if (bankProblem) throw new BadRequestException(bankProblem);
    const { payoutMinimumAgorot } = await this.economy.current();

    const row = await this.prisma.withTenant(async (tx) => {
      await this.lockPayouts(tx, ctx.tenantId);
      const available = await this.balanceInTx(tx, ctx.tenantId);
      const problem = payoutRequestRejectionReason(
        input.amountAgorot,
        available,
        payoutMinimumAgorot,
      );
      if (problem) throw new BadRequestException(problem);

      const id = ulid();
      const created = await tx.payoutRequest.create({
        data: {
          id,
          tenantId: ctx.tenantId,
          amountAgorot: input.amountAgorot,
          status: "pending",
          holderNameEncrypted: this.crypto.encrypt(input.bank.holderName.trim()),
          bankCodeEncrypted: this.crypto.encrypt(input.bank.bankCode.trim()),
          branchEncrypted: this.crypto.encrypt(input.bank.branch.trim()),
          accountNumberEncrypted: this.crypto.encrypt(input.bank.accountNumber.trim()),
          businessIdEncrypted: this.crypto.encrypt(input.bank.businessId.replace(/\D/gu, "")),
          note: input.note?.trim() || null,
          requestedBy: ctx.userId,
        },
      });
      /*
       * החיוב בתוך אותה טרנזקציה. בקשה שנרשמה בלי שהכסף ירד מהיתרה
       * היא בדיוק החלון שבו הלחיצה השנייה עוברת.
       */
      await tx.payoutLedger.create({
        data: {
          id: ulid(),
          tenantId: ctx.tenantId,
          kind: "withdrawal",
          amountAgorot: -input.amountAgorot,
          refId: id,
        },
      });
      await this.audit.record(tx, {
        action: "payout.request",
        entityType: "payout_request",
        entityId: id,
        metadata: { amountAgorot: input.amountAgorot },
      });
      return created;
    });
    return this.toDto(row);
  }

  /* ============================================================
     צד הפלטפורמה — הכול מאחורי PlatformAdminGuard
     ============================================================ */

  /**
   * תור הבקשות.
   *
   * פרטי הבנק מפוענחים כאן: זו הרשימה שממנה מבצעים את ההעברות
   * בפועל, ובלעדיהם היא רשימת מספרים ללא שימוש. מספר החשבון מוצג
   * ממוסך ב-DTO המשותף, והמלא יושב ב-`bank`.
   */
  async listForDesk(status?: PayoutStatus): Promise<PayoutRequestAdminDto[]> {
    const rows = await this.prisma.withPayoutDesk((tx) =>
      tx.payoutRequest.findMany({
        where: status === undefined ? {} : { status },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    );
    const tenants = await this.prisma.tenant.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.tenantId))] } },
      select: { id: true, name: true },
    });
    const names = new Map(tenants.map((t) => [t.id, t.name]));
    return rows.map((row) => ({
      ...this.toDto(row),
      tenantId: row.tenantId,
      tenantName: names.get(row.tenantId) ?? row.tenantId,
      bank: {
        holderName: this.crypto.decrypt(row.holderNameEncrypted),
        bankCode: this.crypto.decrypt(row.bankCodeEncrypted),
        branch: this.crypto.decrypt(row.branchEncrypted),
        accountNumber: this.crypto.decrypt(row.accountNumberEncrypted),
        businessId: this.crypto.decrypt(row.businessIdEncrypted),
      },
    }));
  }

  /**
   * החלטה על בקשה: אישור, דחייה או סימון ששולמה.
   *
   * המעברים המותרים יושבים בטבלה ב-`@metavchim/shared` ולא ב-`if`ים
   * כאן. המעבר המסוכן הוא `paid → paid` — סימון חוזר שמסמן העברה
   * שנייה — והוא פשוט אינו ברשימה.
   *
   * העדכון **מותנה בסטטוס שנקרא**: שני מנהלים שלוחצים יחד לא יבצעו
   * את המעבר פעמיים.
   */
  async decide(
    id: string,
    to: PayoutStatus,
    options: { note?: string; reference?: string },
  ): Promise<PayoutRequestAdminDto> {
    const decidedBy = TenantContext.current().userId;
    const row = await this.prisma.withPayoutDesk(async (tx) => {
      const existing = await tx.payoutRequest.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException("בקשת המשיכה לא נמצאה");
      const problem = payoutTransitionRejectionReason(existing.status as PayoutStatus, to);
      if (problem) throw new ConflictException(problem);
      const reference = (options.reference ?? "").trim();
      if (to === "paid" && reference === "") {
        throw new BadRequestException("אסמכתת ההעברה חובה — בלעדיה \"שולם\" הוא אמירה בלי גיבוי");
      }

      const now = new Date();
      const changed = await tx.payoutRequest.updateMany({
        where: { id, status: existing.status },
        data: {
          status: to,
          // אישור קודם אינו נדרס בסימון התשלום — הוא ההחלטה, וזה הביצוע
          decidedAt: to === "paid" ? existing.decidedAt : now,
          decidedBy: to === "paid" ? existing.decidedBy : decidedBy,
          decisionNote: options.note?.trim() || existing.decisionNote,
          ...(to === "paid" ? { reference, paidAt: now } : {}),
        },
      });
      if (changed.count === 0) {
        throw new ConflictException("הבקשה השתנתה הרגע — רעננו ונסו שוב");
      }

      /*
       * דחייה מחזירה את הכסף ליתרה. תנועה חדשה ולא מחיקה של החיוב:
       * הספר הוא Append-Only, וההיסטוריה של "ביקשו, נדחה, הוחזר"
       * היא בדיוק מה שצריך לראות אחר כך.
       */
      if (to === "rejected") {
        await tx.payoutLedger.create({
          data: {
            id: ulid(),
            tenantId: existing.tenantId,
            kind: "withdrawal_reversed",
            amountAgorot: existing.amountAgorot,
            refId: id,
          },
        });
      }

      /*
       * ההתראה למשרד נכתבת תחת הקשר הדייר שלו, בתוך אותה טרנזקציה.
       * `set_config` תקף פר-משפט, ולכן המעבר בין ההקשרים חוקי כאן —
       * אותו דפוס כמו בקליטת הפניה.
       */
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${existing.tenantId}, true)`;
      const owners = await tx.user.findMany({
        where: { tenantId: existing.tenantId, role: "owner", isActive: true },
        select: { id: true },
      });
      const text = this.decisionText(to, existing.amountAgorot, options.note);
      for (const owner of owners) {
        await tx.notification.create({
          data: {
            id: ulid(),
            tenantId: existing.tenantId,
            userId: owner.id,
            type: "payout_decision",
            title: text.title,
            body: text.body,
            entityType: "payout_request",
            entityId: id,
          },
        });
      }
      /*
       * הרישום ביומן של **המשרד** ולא של הפלטפורמה, עם `userId: null`
       * — אותו דפוס כמו כל פעולת פלטפורמה על משרד. בעל המשרד רואה מי
       * החליט מה על הכסף שלו; בלי זה, אישור ודחייה נראים כמו מצב
       * שהשתנה מעצמו. מזהה המנהל שפעל נשמר במטא-דאטה.
       */
      await tx.auditLog.create({
        data: {
          id: ulid(),
          tenantId: existing.tenantId,
          userId: null,
          action: `platform.payout_${to}`,
          entityType: "payout_request",
          entityId: id,
          metadata: { amountAgorot: existing.amountAgorot, decidedBy },
        },
      });

      const after = await tx.payoutRequest.findUnique({ where: { id } });
      return { row: after!, tenantId: existing.tenantId };
    });

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: row.tenantId },
      select: { name: true },
    });
    return {
      ...this.toDto(row.row),
      tenantId: row.tenantId,
      tenantName: tenant?.name ?? row.tenantId,
      bank: {
        holderName: this.crypto.decrypt(row.row.holderNameEncrypted),
        bankCode: this.crypto.decrypt(row.row.bankCodeEncrypted),
        branch: this.crypto.decrypt(row.row.branchEncrypted),
        accountNumber: this.crypto.decrypt(row.row.accountNumberEncrypted),
        businessId: this.crypto.decrypt(row.row.businessIdEncrypted),
      },
    };
  }

  /* ============================================================
     פנימי
     ============================================================ */

  private decisionText(
    to: PayoutStatus,
    amountAgorot: number,
    note?: string,
  ): { title: string; body: string } {
    const amount = `${shekels(amountAgorot)} ₪`;
    if (to === "approved") {
      return {
        title: "בקשת המשיכה אושרה",
        body: `${amount} אושרו להעברה. ההעברה תתבצע בימים הקרובים, ותקבלו עדכון עם האסמכתה.`,
      };
    }
    if (to === "paid") {
      return { title: "המשיכה בוצעה", body: `${amount} הועברו לחשבון שציינתם.` };
    }
    return {
      title: "בקשת המשיכה נדחתה",
      /* הסכום חוזר ליתרה, וזה הדבר הראשון שרוצים לדעת אחרי "נדחתה". */
      body: `${amount} הוחזרו ליתרה הכספית שלכם.${note ? ` הסיבה: ${note}` : ""}`,
    };
  }

  private async balanceInTx(tx: TenantTx, tenantId: string): Promise<number> {
    const agg = await tx.payoutLedger.aggregate({
      where: { tenantId },
      _sum: { amountAgorot: true },
    });
    return agg._sum.amountAgorot ?? 0;
  }

  /**
   * נעילת המשיכות של המשרד לאורך הטרנזקציה.
   *
   * `pg_advisory_xact_lock` ולא `SELECT … FOR UPDATE`: אין שורה
   * לנעול כשהמשרד מבקש משיכה ראשונה, ונעילת טווח על טבלה ריקה
   * אינה קיימת. המנעול משוחרר בסוף הטרנזקציה בכל מסלול, כולל קריסה.
   */
  private async lockPayouts(tx: TenantTx, tenantId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`payout:${tenantId}`}, 0))`;
  }

  private toDto(row: {
    id: string;
    amountAgorot: number;
    status: string;
    accountNumberEncrypted: string;
    note: string | null;
    decisionNote: string | null;
    reference: string | null;
    createdAt: Date;
    decidedAt: Date | null;
    paidAt: Date | null;
  }): PayoutRequestDto {
    return {
      id: row.id,
      amountAgorot: row.amountAgorot,
      status: row.status as PayoutStatus,
      accountMasked: maskAccountNumber(this.crypto.decrypt(row.accountNumberEncrypted)),
      ...(row.note ? { note: row.note } : {}),
      ...(row.decisionNote ? { decisionNote: row.decisionNote } : {}),
      ...(row.reference ? { reference: row.reference } : {}),
      createdAt: row.createdAt.toISOString(),
      ...(row.decidedAt ? { decidedAt: row.decidedAt.toISOString() } : {}),
      ...(row.paidAt ? { paidAt: row.paidAt.toISOString() } : {}),
    };
  }
}
