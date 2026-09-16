import { BadRequestException, Injectable } from "@nestjs/common";
import { z } from "zod";
import {
  BOARD_VISIBILITY_KEY,
  PHOTO_LOGO_OVERLAY_KEY,
  boardOpenToAgents,
  photoLogoOverlayOn,
} from "@metavchim/shared";
import { AuditService } from "../../core/audit.service";
import { lockTenantRow } from "../../common/locks";
import { TenantContext } from "../../common/tenant-context";
import { PrismaService } from "../../core/prisma.service";

/**
 * ‎**הגדרות המשרד — קריאה, ומסלול כתיבה אחד.**
 *
 * ## ‏למה זה יצא מהבקר
 *
 * ‏הכתיבה ישבה **בתוך** `settings.controller.ts`, ולכן הדרך היחידה
 * ‏אליה הייתה נתיב HTTP. מרגע שמנהל יכול לכבות „פרסום אוטומטי
 * ‏לרשת” מהוואטסאפ יש מסלול שני — והסוכן אינו עובר בבקרים.
 *
 * ‏עותק שני של הלולאה היה מדלג בשקט על ארבעה כללים שאינם נראים
 * ‏בקריאה מהירה:
 *
 * - ‎`lockTenantRow` — `settings` הוא מסמך JSON אחד, ולכן עדכון של
 *   ‏שדה בודד הוא קריאה של הכול וכתיבה של הכול. שתי בקשות מקבילות
 *   ‏בלי הנעילה מוחקות זו את זו בלי שגיאה.
 * - ‏מחרוזת ריקה **מוחקת** את המפתח, ו-`false` מוחק אותו — כדי
 *   ‏שתבנית ההסכם תראה „חסר” ולא תדפיס רישיון ריק.
 * - ‎`autoEmailOffersSince` — נקבע במעבר לדלוק ונמחק בכיבוי. בלעדיו
 *   ‏הדלקה של הדגל מפציצה את כל ההיסטוריה של המשרד בהצעות.
 * - ‎`autoEmailOffersCursor` — נמחק יחד איתו, אחרת הדלקה מחדש
 *   ‏מדלגת על ההתאמות החדשות עד סיבוב מלא.
 *
 * ‏הקוד כאן זהה למה שהיה; הבקר מאציל.
 */
@Injectable()
export class OfficeSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * ‏פרטי המשרד וברירות המחדל שלו, כפי שהם שמורים.
   *
   * ‎`undefined` = לא הוגדר. הבחנה בין „לא הוגדר” ל„ריק” היא מה
   * ‏שמאפשר לתבנית ההסכם לומר „חסר מספר רישיון” במקום להדפיס שורה
   * ‏ריקה במסמך משפטי.
   */
  async read(): Promise<OfficeSettings> {
    const tenantId = TenantContext.current().tenantId;
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, settings: true },
    });
    const settings = (tenant?.settings ?? {}) as Record<string, unknown>;
    const text = (key: string): string | undefined =>
      typeof settings[key] === "string" ? (settings[key] as string) : undefined;
    return {
      name: tenant?.name ?? "",
      licenseNumber: text("licenseNumber"),
      officeAddress: text("officeAddress"),
      officePhone: text("officePhone"),
      defaultCommission: text("defaultCommission"),
      defaultPaymentTerms: text("defaultPaymentTerms"),
      /* ‏חסר = כבוי: מדיניות שמפרסמת נתונים החוצה דורשת הפעלה מפורשת */
      autoShareProperties: settings["autoShareProperties"] === true,
      autoShareBuyers: settings["autoShareBuyers"] === true,
      autoEmailOffers: settings["autoEmailOffers"] === true,
      /*
       * ‎**הקריאה עוברת בכלל המשותף ולא בהשוואה מקומית.**
       *
       * ‏אותו מפתח נקרא גם ב-`/auth/me` וגם בשער של הטבלה.
       * ‏שלוש השוואות עצמאיות הן שלושה מקומות שבהם שם המפתח
       * ‏יכול להשתנות בשתיים בלבד.
       */
      boardVisibleToAgents: boardOpenToAgents(settings),
      /* ‏אותו כלל: המפתח נקרא גם בהעלאת תמונה, ולכן חי בחבילה המשותפת */
      photoLogoOverlay: photoLogoOverlayOn(settings),
    };
  }

  async update(body: OfficeSettingsPatch): Promise<void> {
    const tenantId = TenantContext.current().tenantId;


    /*
     * ‎**הקריאה, השינוי והכתיבה — בטרנזקציה אחת ומתחת לנעילת השורה.**
     *
     * ‎`settings` הוא מסמך JSON אחד, ולכן עדכון של שדה בודד הוא
     * קריאה של הכול וכתיבה של הכול בחזרה. שתי בקשות מקבילות קראו
     * את אותו צילום, וזו שכתבה שנייה מחקה את מה שהראשונה שמרה —
     * בלי שגיאה ובלי שאיש ידע (ביקורת Codex).
     *
     * ולא תרחיש תיאורטי: מסך ההגדרות שולח מתג בכל לחיצה, ושתי
     * לחיצות רצופות מייצרות בדיוק את זה; שתי לשוניות פתוחות מייצרות
     * את זה גם בלי למהר.
     */
    await this.prisma.$transaction(async (tx) => {
    await lockTenantRow(tx, tenantId);
    const current = await tx.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    const settings = {
      ...((current?.settings ?? {}) as Record<string, unknown>),
    };

    /*
     * כל השדות שיושבים ב-settings עוברים באותה לולאה.
     *
     * קודם רק מספר הוואטסאפ המשרדי (שכבר אינו קיים) נכתב, ושלושת פרטי המשרד נבלעו בשקט: הם
     * עברו ולידציה, חזרו ב-GET, ומעולם לא נשמרו. משתמש שמילא מספר
     * רישיון, שמר, וראה "נשמר" — קיבל שדה ריק בטעינה הבאה. שמירה
     * שמדווחת הצלחה ולא כותבת גרועה משדה שלא קיים.
     *
     * מחרוזת ריקה מוחקת את המפתח (ניקוי שדה), ולא שומרת "" —
     * כדי שהתבניות יראו "חסר" ולא ידפיסו רישיון ריק בהסכם.
     */
    const SETTINGS_FIELDS = [
      "licenseNumber",
      "officeAddress",
      "officePhone",
      "defaultCommission",
      "defaultPaymentTerms",
    ] as const;
    let settingsTouched = false;
    for (const field of SETTINGS_FIELDS) {
      const value = body[field];
      if (value === undefined) continue;
      settingsTouched = true;
      if (value === "") delete settings[field];
      else settings[field] = value;
    }

    /*
     * הדגלים הבוליאניים: false מוחק את המפתח ולא שומר false —
     * מאותה סיבה ש-"" מוחק למעלה. חסר = ברירת המחדל (כבוי), ואין
     * טעם לשמור במסד הצהרה על ברירת המחדל.
     */
    const BOOLEAN_FIELDS = [
      "autoShareProperties",
      "autoShareBuyers",
      "autoEmailOffers",
      BOARD_VISIBILITY_KEY,
      PHOTO_LOGO_OVERLAY_KEY,
    ] as const;
    for (const field of BOOLEAN_FIELDS) {
      const value = body[field];
      if (value === undefined) continue;
      settingsTouched = true;
      if (value === false) delete settings[field];
      else settings[field] = true;
    }

    /*
     * חותמת ההפעלה של ההצעות האוטומטיות — נקבעת ב**מעבר** לדלוק
     * ונמחקת בכיבוי. הסורק שולח רק התאמות שחושבו אחריה: משרד ותיק
     * שמדליק את הדגל מתכוון ל"מכאן והלאה", לא ל"הפציצו את כל
     * הלקוחות בכל ההיסטוריה" — וכיבוי-הדלקה מאפס את הקו בכוונה.
     */
    if (body.autoEmailOffers === true && settings["autoEmailOffersSince"] === undefined) {
      settings["autoEmailOffersSince"] = new Date().toISOString();
    }
    if (body.autoEmailOffers === false) {
      delete settings["autoEmailOffersSince"];
      /*
       * ‎**וגם סמן הסריקה — הוא שייך לתקופת ההפעלה שהסתיימה.**
       *
       * הסמן מציין מיקום ברשימת ההתאמות הממוינת לפי ציון. הדלקה
       * מחדש פותחת קו „מכאן והלאה” חדש, וההתאמות החדשות שנוצרות
       * אחריו נכנסות לפי ציון — כלומר **לפני** סמן ישן. בלי האיפוס
       * הזה הן היו מדולגות עד שהסורק יסיים סיבוב שלם, ובמשרד גדול
       * זה המון סבבים (ביקורת Codex).
       */
      delete settings["autoEmailOffersCursor"];
    }

    try {
      await tx.tenant.update({
        where: { id: tenantId },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(settingsTouched ? { settings: settings as object } : {}),
        },
      });
    } catch {
      // מרוץ מול משרד אחר — האינדקס הייחודי ב-DB חסם
      throw new BadRequestException("המספר כבר משויך למשרד אחר");
    }
    });
    await this.prisma.withTenant((tx) =>
      this.audit.record(tx, {
        action: "settings.update",
        entityType: "tenant",
        entityId: tenantId,
        metadata: { changedFields: Object.keys(body) },
      }),
    );
      }
}

/** ‏הגדרות המשרד כפי שהמסך והסוכן קוראים אותן. */
export interface OfficeSettings {
  name: string;
  licenseNumber?: string;
  officeAddress?: string;
  officePhone?: string;
  defaultCommission?: string;
  defaultPaymentTerms?: string;
  autoShareProperties: boolean;
  autoShareBuyers: boolean;
  autoEmailOffers: boolean;
  /** ‏האם „המשרד שלנו” פתוח לסוכנים ולא להנהלה בלבד. */
  boardVisibleToAgents: boolean;
  /** ‏האם הלוגו של המשרד מוטבע על תמונות נכס חדשות. */
  photoLogoOverlay: boolean;
}

/**
 * ‎**מה מותר לשנות — הסכימה שהמסך שולח.**
 *
 * ‏היא חיה כאן ולא בבקר כי **שני** מסלולים עוברים בה עכשיו, וזה
 * ‏הצד שבו הכתיבה קורית. עותק בבקר היה סוטה ממנה ביום שיתווסף
 * ‏שדה — נשמר במסלול אחד ונדחה בשני.
 */
export const OfficeSettingsSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    /* פרטי המשרד שנכנסים לנוסחי ההסכמים. מספר רישיון התיווך הוא
       פרט חובה בהזמנה בכתב לפי חוק המתווכים במקרקעין. */
    licenseNumber: z.union([z.string().max(40), z.literal("")]).optional(),
    officeAddress: z.union([z.string().max(200), z.literal("")]).optional(),
    officePhone: z.union([z.string().max(30), z.literal("")]).optional(),
    /* ברירות המחדל לנוסחי ההסכמים. דמי התיווך ומועד התשלום הם פרטי
       חובה בתקנות, ושער ההחתמה יוצר הסכם בלי שאיש הזין אותם — בלי
       ברירת מחדל ברמת המשרד הוא לא יכול לייצר מסמך תקף כלל. */
    defaultCommission: z.union([z.string().max(80), z.literal("")]).optional(),
    defaultPaymentTerms: z.union([z.string().max(120), z.literal("")]).optional(),
    /*
     * מדיניות הרשת של המשרד: כל נכס/קונה חדש מתפרסם לרשת השיתופים
     * אוטומטית. ההחלטה של מי שמחזיק settings.manage — הסוכן שקולט
     * את הנכס מבצע מדיניות משרד, לא בחירה אישית.
     */
    autoShareProperties: z.boolean().optional(),
    autoShareBuyers: z.boolean().optional(),
    /*
     * הצעות אוטומטיות במייל: התאמה פנימית חדשה וחזקה נשלחת ללקוח
     * בלי שסוכן לחץ. אותו היגיון של מדיניות משרד כמו שכניו למעלה.
     */
    autoEmailOffers: z.boolean().optional(),
    /*
     * ‎**מי רואה את „המשרד שלנו” — הכרעה של בעל הסוכנות.**
     *
     * ‏יושב עם שכניו כאן ולא בנתיב משלו: זו הגדרת משרד כמו כל
     * ‏אחת מהן, ונתיב שני היה עוקף את הנעילה שמגנה על מסמך
     * ‏ה-JSON היחיד — כלומר סימון של התיבה היה יכול למחוק שמירה
     * ‏מקבילה של אחוז העמלה.
     */
    boardVisibleToAgents: z.boolean().optional(),
    /*
     * ‏הלוגו על תמונות הנכס: מדיניות משרד, כמו הפרסום לרשת — הסוכן
     * ‏שמעלה תמונה מבצע אותה. כבוי כברירת מחדל: תמונה של דירה של
     * ‏מוכר עם לוגו עליה היא בחירה, לא ברירת מחדל.
     */
    photoLogoOverlay: z.boolean().optional(),
  })
  .strict();

export type OfficeSettingsPatch = z.infer<typeof OfficeSettingsSchema>;
