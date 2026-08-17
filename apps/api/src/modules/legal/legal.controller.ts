import { Controller, Get } from "@nestjs/common";
import { Public } from "../../common/auth.decorators";
import { PlatformSettingsService } from "../../core/platform-settings.service";

/**
 * המסמכים המשפטיים כפי שבעלת הפלטפורמה ערכה אותם.
 *
 * ציבורי בכוונה: מדיניות פרטיות ותנאי שימוש חייבים להיות קריאים בלי
 * התחברות — גם למי ששוקל להירשם, גם לרגולטור, וגם לסורק של Meta
 * שבודק את פרטי החברה מול בקשת אימות העסק. נתיב מאחורי Session היה
 * הופך את שלושתם לבלתי אפשריים.
 *
 * מה שמוחזר כאן הוא **רק מה שנערך בפועל**. שדה שלא נגעו בו חוזר
 * `null`, והעמוד משתמש בנוסח שבקוד. כך אין שני מקורות אמת לאותו
 * טקסט, ומסמך שנמחק בטעות מהמסך חוזר לנוסח תקין במקום להישאר ריק.
 */
@Controller("legal")
export class LegalController {
  constructor(private readonly settings: PlatformSettingsService) {}

  @Public()
  @Get()
  async current(): Promise<{
    operator: string | null;
    companyId: string | null;
    address: string | null;
    privacyEmail: string | null;
    accessibilityEmail: string | null;
    supportEmail: string | null;
    updatedAt: string | null;
    termsText: string | null;
    privacyText: string | null;
  }> {
    // מחרוזת ריקה ו-null הם אותו דבר כאן: "לא נערך". השוואה מפורשת
    // ולא ‎|| null‎, כדי ששדה שנשמר ריק בכוונה לא ייראה כערך תקין.
    const read = async (
      key: Parameters<PlatformSettingsService["get"]>[0],
    ): Promise<string | null> => {
      const value = await this.settings.get(key);
      return value !== undefined && value !== "" ? value : null;
    };

    return {
      operator: await read("legalOperator"),
      companyId: await read("legalCompanyId"),
      address: await read("legalAddress"),
      privacyEmail: await read("legalPrivacyEmail"),
      accessibilityEmail: await read("legalAccessibilityEmail"),
      // אותה כתובת שמשמשת את תור התמיכה — לא מפתח נפרד שיסתור אותה
      supportEmail: await read("supportEmail"),
      updatedAt: await read("legalUpdatedAt"),
      termsText: await read("legalTermsText"),
      privacyText: await read("legalPrivacyText"),
    };
  }
}
