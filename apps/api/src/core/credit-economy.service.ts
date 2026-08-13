import { Injectable, Logger } from "@nestjs/common";
import {
  DEFAULT_CREDIT_ECONOMY,
  MAX_CREDIT_BONUS_PERCENT,
  MAX_CREDIT_EXPIRY_MONTHS,
  MAX_CREDIT_PACKAGES,
  MAX_CREDIT_UNIT_PRICE_AGOROT,
  MAX_ECONOMY_FEE_PERCENT,
  MAX_INITIAL_GRANT_CREDITS,
  MAX_PAYOUT_MINIMUM_AGOROT,
  creditPackageRejectionReason,
  resolveNumericSetting,
  type CreditEconomy,
  type CreditPackage,
} from "@metavchim/shared";
import { PlatformSettingsService } from "./platform-settings.service";

/**
 * כלכלת הקרדיטים כפי שהפלטפורמה הגדירה אותה.
 *
 * **אין כאן מחיר אחד קשיח.** כל מספר נקרא מההגדרות, וברירות המחדל
 * שבקוד הן רשת ביטחון בלבד — מה שקורה לפני שמישהו נגע במסך, וכשערך
 * שמור התגלה כפסול. תמחור של רשת דו-צדדית מתכייל תוך כדי תנועה, ולכן
 * שינוי מחיר אינו אמור להיות גרסה חדשה.
 *
 * אותו דפוס בדיוק כמו `LeadPricingService` ו-`PlanCatalogService`:
 * קוראים **מעל** ברירות המחדל ולא במקומן.
 */
@Injectable()
export class CreditEconomyService {
  private readonly logger = new Logger(CreditEconomyService.name);

  constructor(private readonly platformSettings: PlatformSettingsService) {}

  async current(): Promise<CreditEconomy> {
    const [unit, packages, bonus, feeCredits, feeCash, payoutMin, expiry, grant] =
      await Promise.all([
        this.platformSettings.get("creditUnitPriceAgorot"),
        this.platformSettings.get("creditPackages"),
        this.platformSettings.get("creditBonusPercent"),
        this.platformSettings.get("creditFeeCreditsPercent"),
        this.platformSettings.get("creditFeeCashPercent"),
        this.platformSettings.get("creditPayoutMinimumAgorot"),
        this.platformSettings.get("creditExpiryMonths"),
        this.platformSettings.get("creditInitialGrant"),
      ]);

    return {
      unitPriceAgorot: resolveNumericSetting(unit, DEFAULT_CREDIT_ECONOMY.unitPriceAgorot, {
        min: 1,
        max: MAX_CREDIT_UNIT_PRICE_AGOROT,
      }),
      packages: this.parsePackages(packages),
      creditBonusPercent: resolveNumericSetting(
        bonus,
        DEFAULT_CREDIT_ECONOMY.creditBonusPercent,
        { max: MAX_CREDIT_BONUS_PERCENT },
      ),
      feeCreditsPercent: resolveNumericSetting(
        feeCredits,
        DEFAULT_CREDIT_ECONOMY.feeCreditsPercent,
        { max: MAX_ECONOMY_FEE_PERCENT },
      ),
      feeCashPercent: resolveNumericSetting(feeCash, DEFAULT_CREDIT_ECONOMY.feeCashPercent, {
        max: MAX_ECONOMY_FEE_PERCENT,
      }),
      payoutMinimumAgorot: resolveNumericSetting(
        payoutMin,
        DEFAULT_CREDIT_ECONOMY.payoutMinimumAgorot,
        { max: MAX_PAYOUT_MINIMUM_AGOROT },
      ),
      expiryMonths: resolveNumericSetting(expiry, DEFAULT_CREDIT_ECONOMY.expiryMonths, {
        max: MAX_CREDIT_EXPIRY_MONTHS,
      }),
      initialGrantCredits: resolveNumericSetting(
        grant,
        DEFAULT_CREDIT_ECONOMY.initialGrantCredits,
        { max: MAX_INITIAL_GRANT_CREDITS },
      ),
    };
  }

  /**
   * החבילות נשמרות כ-JSON בהגדרה אחת.
   *
   * טבלה ייעודית לרשימה של עד שמונה זוגות מספרים היא מיגרציה ומודל
   * שלמים בלי שהם קונים דבר. מה שכן קונה משהו הוא שהקריאה לא תיפול
   * על תוכן פגום: כל חבילה נבדקת, ומה שאינו תקין נזרק ואינו מוצע
   * למכירה — מחיר שנשמר שגוי לא יגבה כסף.
   */
  private parsePackages(raw: string | undefined): CreditPackage[] {
    if (raw === undefined || raw.trim() === "") return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.logger.warn("חבילות הקרדיטים אינן JSON תקין — נמכר ביחידות בלבד");
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is CreditPackage => {
        if (typeof item !== "object" || item === null) return false;
        const pkg = item as Partial<CreditPackage>;
        if (typeof pkg.credits !== "number" || typeof pkg.priceAgorot !== "number") return false;
        return creditPackageRejectionReason(pkg as CreditPackage) === null;
      })
      .slice(0, MAX_CREDIT_PACKAGES)
      .sort((a, b) => a.credits - b.credits);
  }
}
