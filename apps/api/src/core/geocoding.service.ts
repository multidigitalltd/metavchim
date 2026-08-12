import { Injectable, Logger } from "@nestjs/common";
import { itmToWgs84, isWithinIsrael, type LatLon } from "@metavchim/shared";
import { PlatformSettingsService } from "./platform-settings.service";

/**
 * פענוח כתובות — שני הכיוונים, מאחורי יציאה אחת.
 *
 * **טקסט ← מפה וגם מפה ← טקסט.** סוכן מקליד כתובת והנכס נוחת על
 * המפה; סוכן גורר סיכה והכתובת מתמלאת. שני הכיוונים הם אותה עבודה
 * מבחינת המשתמש, ולכן הם אותו ממשק כאן.
 *
 * **הספק הוא הגדרה, לא הנחה.** הקוד שקורא לשירות הזה אינו יודע מי
 * עונה לו. זה מה שמאפשר להתחיל עם ספק אחד ולעבור לאחר — למשל למפ"י
 * כשהרישוי יאושר — בלי לגעת במסכים או בסכימה.
 *
 * **ברירת המחדל היא `none`.** כל עוד לא נבחר ספק, השירות מחזיר
 * "אינו זמין" ואינו פונה לאיש. פנייה לשירות חיצוני היא החלטה
 * שמקבלים במפורש, לא ברירת מחדל ששוכחים.
 *
 * מה שנשמר אצלנו הוא **קו רוחב ואורך בלבד** — נתון גיאומטרי, לא
 * תוכן של ספק. ההמרה מרשת ישראל נעשית כאן, בקצה.
 */

export type GeocodingProvider = "none" | "govmap" | "mapbox";

export interface GeocodeResult extends LatLon {
  /** הכתובת כפי שהספק מכיר אותה — זה מה שנכנס לשדה הטקסט. */
  label: string;
}

const TIMEOUT_MS = 6000;

@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);

  constructor(private readonly platformSettings: PlatformSettingsService) {}

  async provider(): Promise<GeocodingProvider> {
    const value = (await this.platformSettings.get("geocodingProvider")) ?? "none";
    return value === "govmap" || value === "mapbox" ? value : "none";
  }

  /**
   * יכולות הספק הפעיל.
   *
   * הכיוון ההפוך אינו מובן מאליו: החיפוש הציבורי של מפ"י מפענח
   * כתובת לנקודה ולא להפך. מסך שמבטיח "גרור והכתובת תתמלא" מול ספק
   * שאינו יודע לעשות זאת הוא הבטחה שבורה — ולכן היכולות נאמרות
   * למסך במפורש, והוא מסתיר את מה שאינו נתמך.
   */
  async capabilities(): Promise<{ forward: boolean; reverse: boolean }> {
    switch (await this.provider()) {
      case "govmap":
        return { forward: true, reverse: false };
      case "mapbox":
        return { forward: true, reverse: true };
      default:
        return { forward: false, reverse: false };
    }
  }

  /** טקסט ← נקודה. רשימה ריקה = לא נמצא או שאין ספק. */
  async search(query: string): Promise<GeocodeResult[]> {
    const text = query.trim();
    if (text.length < 2) return [];
    try {
      switch (await this.provider()) {
        case "govmap":
          return await this.searchGovmap(text);
        case "mapbox":
          return await this.searchMapbox(text);
        default:
          return [];
      }
    } catch (error) {
      // כשל של ספק חיצוני אינו שובר קליטת נכס — הסוכן יסמן ידנית
      this.logger.warn(`פענוח כתובת נכשל: ${String(error)}`);
      return [];
    }
  }

  /** נקודה ← טקסט. `undefined` = הספק אינו תומך או שלא נמצא. */
  async reverse(point: LatLon): Promise<string | undefined> {
    if (!isWithinIsrael(point)) return undefined;
    try {
      if ((await this.provider()) !== "mapbox") return undefined;
      return await this.reverseMapbox(point);
    } catch (error) {
      this.logger.warn(`פענוח הפוך נכשל: ${String(error)}`);
      return undefined;
    }
  }

  /* ---------- מפ"י / GovMap ---------- */

  /**
   * החיפוש הציבורי של GovMap. מחזיר רשת ישראל, ולכן ההמרה כאן.
   *
   * שלוש קבוצות תוצאה מעניינות אותנו — כתובת, רחוב ושכונה — והן
   * מוצגות בסדר הזה: מי שמקליד כתובת מלאה רוצה את הבית, לא את
   * השכונה שמסביבו.
   */
  private async searchGovmap(query: string): Promise<GeocodeResult[]> {
    const url =
      "https://es.govmap.gov.il/TldSearch/api/DetailsByQuery" +
      `?query=${encodeURIComponent(query)}&lyrs=276549&gid=govmap`;
    const body = (await this.fetchJson(url)) as {
      data?: Record<string, { ResultLable?: string; X?: number; Y?: number }[]>;
    };
    const groups = body.data ?? {};
    const ordered = ["ADDRESS", "STREET", "NEIGHBORHOOD"];
    const results: GeocodeResult[] = [];
    for (const key of [...ordered, ...Object.keys(groups).filter((k) => !ordered.includes(k))]) {
      for (const row of groups[key] ?? []) {
        if (typeof row.X !== "number" || typeof row.Y !== "number") continue;
        const point = itmToWgs84({ x: row.X, y: row.Y });
        // רשת ביטחון: תוצאה שנפלה מחוץ לארץ פירושה שדות שהתחלפו
        if (!isWithinIsrael(point)) continue;
        results.push({ ...point, label: (row.ResultLable ?? query).trim() });
        if (results.length >= 8) return results;
      }
    }
    return results;
  }

  /* ---------- Mapbox ---------- */

  private async searchMapbox(query: string): Promise<GeocodeResult[]> {
    const token = await this.platformSettings.get("mapboxToken");
    if (!token) return [];
    const url =
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
      `?access_token=${token}&country=il&language=he&limit=8`;
    const body = (await this.fetchJson(url)) as {
      features?: { place_name?: string; center?: [number, number] }[];
    };
    return (body.features ?? [])
      .filter((f) => Array.isArray(f.center))
      .map((f) => ({
        lon: f.center![0],
        lat: f.center![1],
        label: (f.place_name ?? query).trim(),
      }))
      .filter((r) => isWithinIsrael(r));
  }

  private async reverseMapbox(point: LatLon): Promise<string | undefined> {
    const token = await this.platformSettings.get("mapboxToken");
    if (!token) return undefined;
    const url =
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${point.lon},${point.lat}.json` +
      `?access_token=${token}&language=he&limit=1`;
    const body = (await this.fetchJson(url)) as { features?: { place_name?: string }[] };
    return body.features?.[0]?.place_name?.trim();
  }

  /**
   * קריאה חיצונית עם תקרת זמן.
   *
   * בלי התקרה, שירות חיצוני שנתקע היה תולה את שמירת הנכס — והסוכן
   * היה מסיק שהמערכת נשברה. עדיף בלי הצעות מאשר בלי שמירה.
   */
  private async fetchJson(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }
}
