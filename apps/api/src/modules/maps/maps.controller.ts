import { Controller, Get } from "@nestjs/common";
import { AnyAuthenticated } from "../../common/auth.decorators";
import { PlatformSettingsService } from "../../core/platform-settings.service";

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
  constructor(private readonly platformSettings: PlatformSettingsService) {}

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
}
