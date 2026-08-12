import { Controller, Get, Query } from "@nestjs/common";
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

  @AnyAuthenticated()
  @Get("config")
  async config(): Promise<{ configured: boolean; token?: string; styleUrl?: string }> {
    const token = await this.platformSettings.get("mapboxToken");
    if (!token) return { configured: false };
    /*
     * סגנון האריחים נבנה כאן ולא במסך.
     *
     * זו הנקודה היחידה שקושרת אותנו לספק — החלפה למפ"י או לכל מקור
     * אחר היא שינוי הכתובת הזו בלבד. הספרייה עצמה (MapLibre) פתוחה
     * ואינה קשורה לאף ספק.
     */
    return {
      configured: true,
      token,
      styleUrl: "mapbox://styles/mapbox/streets-v12",
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
