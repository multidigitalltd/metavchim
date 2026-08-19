import { BadRequestException, Injectable } from "@nestjs/common";
import {
  MAX_BURN_CREDITS,
  platformCreditsNet,
  referralBonusCredits,
  summarizePlatformCredits,
  type PlatformCreditSummary,
} from "@metavchim/shared";
import { ulid } from "ulid";
import { PrismaService } from "../../core/prisma.service";
import { CreditEconomyService } from "../../core/credit-economy.service";

/** התמונה המלאה של ההכנסה מהפניות — לא רק היתרה. */
export interface PlatformCreditsReport extends PlatformCreditSummary {
  /** מחיר הקרדיט שלפיו חושבה ההערכה. */
  unitPriceAgorot: number;
  /** קרדיטים שהונפקו כבונוס למי שבחר תמורה בקרדיטים. */
  bonusCreditsIssued: number;
  /** מזומן ששולם למפנים במסלול הכסף. */
  cashPaidAgorot: number;
  /** כמה הפניות נקלטו בכלל. */
  settledReferrals: number;
  /**
   * השורה התחתונה: מה שהוכר, פחות שווי הבונוס שהונפק.
   *
   * שלילי אפשרי — ראו `platformCreditsNet`.
   */
  netAgorot: number;
}

export interface PlatformCreditRow {
  id: string;
  kind: string;
  amount: number;
  recognizedAgorot: number;
  unitPriceAgorot: number;
  sourceTenantName: string | null;
  note: string | null;
  createdAt: Date;
}

/**
 * ספר הקרדיטים של הפלטפורמה.
 *
 * שירות נפרד ולא עוד מתודה בבקר: כאן יושבת ההנהלת חשבונות היחידה
 * במערכת שאין לה דייר, וערבוב שלה בקוד שמניח הקשר דייר הוא בדיוק
 * הדרך שבה מישהו יקרא מכאן לטבלה שכן תחת RLS.
 */
@Injectable()
export class PlatformCreditsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly economy: CreditEconomyService,
  ) {}

  async report(): Promise<PlatformCreditsReport> {
    const economy = await this.economy.current();

    /*
     * הספר נקרא ישירות מ-`prisma` ולא דרך `withTenant`: הטבלה אינה
     * תחת RLS. הבדיקה המבנית ב-`rls-access.test.ts` גוזרת את רשימת
     * הטבלאות מהמיגרציות, ולכן היא יודעת זאת בלי רשימה ידנית.
     */
    const entries = await this.prisma.platformCreditLedger.findMany({
      select: { kind: true, amount: true, recognizedAgorot: true },
    });
    const summary = summarizePlatformCredits(entries, economy.unitPriceAgorot);

    /*
     * הבונוס אינו נשמר בעמודה משלו — הוא נגזר מהשורה, וזו הצורה
     * הנכונה: עמודה נוספת הייתה יכולה לסתור את שלושת המספרים שהיא
     * נגזרת מהם.
     */
    const sold = await this.prisma.withNetworkRead((tx) =>
      tx.sharedLead.findMany({
        where: { status: "sold" },
        select: {
          priceCredits: true,
          platformFeeCredits: true,
          payoutCredits: true,
          payoutAgorot: true,
        },
      }),
    );

    let bonusCreditsIssued = 0;
    let cashPaidAgorot = 0;
    for (const row of sold) {
      bonusCreditsIssued += referralBonusCredits(row);
      cashPaidAgorot += row.payoutAgorot;
    }

    return {
      ...summary,
      unitPriceAgorot: economy.unitPriceAgorot,
      bonusCreditsIssued,
      cashPaidAgorot,
      settledReferrals: sold.length,
      netAgorot: platformCreditsNet({
        recognizedAgorot: summary.recognizedAgorot,
        bonusCreditsIssued,
        unitPriceAgorot: economy.unitPriceAgorot,
      }),
    };
  }

  /** התנועות האחרונות, עם שם המשרד שממנו הגיעה העמלה. */
  async entries(limit: number): Promise<PlatformCreditRow[]> {
    const rows = await this.prisma.platformCreditLedger.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    const tenantIds = [
      ...new Set(rows.map((r) => r.sourceTenantId).filter((id): id is string => id !== null)),
    ];
    const tenants = tenantIds.length
      ? await this.prisma.tenant.findMany({
          where: { id: { in: tenantIds } },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(tenants.map((t) => [t.id, t.name]));

    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      amount: row.amount,
      recognizedAgorot: row.recognizedAgorot,
      unitPriceAgorot: row.unitPriceAgorot,
      sourceTenantName: row.sourceTenantId ? (nameById.get(row.sourceTenantId) ?? null) : null,
      note: row.note,
      createdAt: row.createdAt,
    }));
  }

  /**
   * מחיקת קרדיטים מחשבון הפלטפורמה, והכרה בהכנסה כנגדם.
   *
   * המחיר **מצולם על השורה** ולא נקרא בדיעבד: הוא משתנה מהמסך, ודוח
   * שנשען על המחיר הנוכחי היה משתנה למפרע בכל עדכון תמחור.
   *
   * הקריאה והכתיבה בטרנזקציה אחת עם נעילת הטבלה: שתי מחיקות מקבילות
   * היו קוראות שתיהן את אותה יתרה ועוברות יחד גם כשסכומן גדול ממנה —
   * אותה תקלה בדיוק שנסגרה בהוצאת קרדיטים של משרד.
   */
  async burn(credits: number, note: string | null): Promise<{ recognizedAgorot: number }> {
    if (!Number.isInteger(credits) || credits < 1) {
      throw new BadRequestException("כמות הקרדיטים למחיקה חייבת להיות מספר שלם חיובי");
    }
    if (credits > MAX_BURN_CREDITS) {
      throw new BadRequestException(`אי אפשר למחוק יותר מ-${MAX_BURN_CREDITS} קרדיטים בפעולה אחת`);
    }
    const economy = await this.economy.current();
    const unitPriceAgorot = economy.unitPriceAgorot;

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`LOCK TABLE platform_credit_ledger IN SHARE ROW EXCLUSIVE MODE`;
      const rows = await tx.platformCreditLedger.findMany({ select: { amount: true } });
      const balance = rows.reduce((sum, row) => sum + row.amount, 0);
      if (credits > balance) {
        throw new BadRequestException(
          `בחשבון הפלטפורמה ${balance} קרדיטים — אי אפשר למחוק ${credits}`,
        );
      }
      const recognizedAgorot = credits * unitPriceAgorot;
      await tx.platformCreditLedger.create({
        data: {
          id: ulid(),
          kind: "burn",
          amount: -credits,
          recognizedAgorot,
          unitPriceAgorot,
          note,
        },
      });
      return { recognizedAgorot };
    });
  }
}
