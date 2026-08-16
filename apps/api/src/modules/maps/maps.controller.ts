import { Controller, Get, Query } from "@nestjs/common";
import { DEFAULT_MAP_STYLE_URL } from "@metavchim/shared";
import { z } from "zod";
import { AnyAuthenticated } from "../../common/auth.decorators";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { GeocodingService, type GeocodeResult } from "../../core/geocoding.service";
import { PlatformSettingsService } from "../../core/platform-settings.service";

/** נקודה על המפה — הגבולות הם שפיות, לא גבולות מדינה. */
const PointSchema = z
  .object({
    lat: z.coerce.number().min(-90).max(90),
    lon: z.coerce.number().min(-180).max(180),
  })
  .strict();

const SearchSchema = z.object({ q: z.string().trim().min(2).max(120) }).strict();

/*
 * ברירת המחדל חיה ב-packages/shared: גם מדיניות אבטחת התוכן של
 * האתר צריכה להתיר את אותו מארח, ושני עותקים שנפרדים זה מזה
 * מסתיימים במפה שנחסמת בשקט.
 */
const DEFAULT_MAP_STYLE = DEFAULT_MAP_STYLE_URL;

/**
 * הגדרת המפה לאפליקציה.
 *
 * הטוקן נמסר מהשרת ולא נצרב בבנייה של המסך: החלפת ספק אריחים או
 * החלפת טוקן שנחשף היא שינוי הגדרה, לא פריסה מחדש.
 *
 * `AnyAuthenticated` ולא ציבורי: הטוקן ציבורי מעצם טיבו (הדפדפן שולח
 * אותו בכל בקשת אריח), אבל אין סיבה לפרסם אותו למי שאינו משתמש —
 * זה רק מזמין שימוש על חשבון המכסה שלנו.
 */
@Controller("maps")
export class MapsController {
  constructor(
    private readonly platformSettings: PlatformSettingsService,
    private readonly geocoding: GeocodingService,
  ) {}

  /**
   * סגנון האריחים.
   *
   * **המפה עובדת בלי מפתח, וזה תיקון ולא ויתור.** קודם הוחזר כאן
   * סגנון של Mapbox, ו-MapLibre אינה יודעת לפענח את הפרוטוקול
   * `mapbox://` שהוא מפנה אליו פנימית — ולכן המפה נטענה ריקה בזמן
   * שפענוח הכתובות (REST רגיל) דווקא עבד. זה גם היה שימוש באריחים
   * מחוץ ל-SDK של הספק, כלומר נגד תנאיו.
   *
   * הכתובת ניתנת להחלפה מהפלטפורמה: מעבר למפ"י או לכל מקור אחר הוא
   * שינוי הגדרה. התנאי היחיד הוא שהסגנון יהיה תקן MapLibre — כלומר
   * שכל הכתובות בתוכו הן HTTPS רגיל.
   */
  @AnyAuthenticated()
  @Get("config")
  async config(): Promise<{ configured: boolean; token?: string; styleUrl?: string }> {
    /*
     * `get()` מחזיר `undefined` כשההגדרה מעולם לא נשמרה — לא `null`.
     * בדיקה שדוחה `null` בלבד הייתה מחזירה `styleUrl` ריק בהתקנה
     * טרייה, כלומר בדיוק במקרה שברירת המחדל נועדה לו, והמפה הייתה
     * נשארת ריקה למרות התיקון.
     */
    const custom = await this.platformSettings.get("mapStyleUrl");
    return {
      configured: true,
      styleUrl: custom !== undefined && custom !== "" ? custom : DEFAULT_MAP_STYLE,
    };
  }

  /**
   * מה הספק הפעיל יודע לעשות.
   *
   * המסך שואל לפני שהוא מבטיח: כפתור "מלא כתובת מהסיכה" מול ספק
   * שאינו מפענח הפוך הוא כפתור שנכשל בלחיצה, וזה גרוע מכפתור שאינו
   * קיים.
   */
  @AnyAuthenticated()
  @Get("capabilities")
  async capabilities(): Promise<{ forward: boolean; reverse: boolean }> {
    return this.geocoding.capabilities();
  }

  /** טקסט ← נקודות. רשימה ריקה כשאין ספק או שלא נמצא. */
  @AnyAuthenticated()
  @Get("geocode")
  async geocode(
    @Query(new ZodValidationPipe(SearchSchema)) query: { q: string },
  ): Promise<{ results: GeocodeResult[] }> {
    return { results: await this.geocoding.search(query.q) };
  }

  /** נקודה ← טקסט. `label` חסר = הספק אינו תומך או שלא נמצא. */
  @AnyAuthenticated()
  @Get("reverse")
  async reverse(
    @Query(new ZodValidationPipe(PointSchema)) point: { lat: number; lon: number },
  ): Promise<{ label?: string }> {
    const label = await this.geocoding.reverse(point);
    return label === undefined ? {} : { label };
  }
}
