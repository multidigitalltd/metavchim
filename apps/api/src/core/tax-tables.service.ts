import { Injectable, Logger } from "@nestjs/common";
import { DEFAULT_TAX_TABLES, TaxTablesSchema, type TaxTables, type TaxTablesInput } from "@metavchim/shared";
import { PlatformSettingsService } from "./platform-settings.service";

/**
 * ‏טבלאות המס של המחשבונים — מדרגות מס רכישה ותקרת הפטור במס שבח.
 *
 * ‏נתון שמשתנה בחוק מדי ינואר, ולכן אינו נעול בקוד: מנהל הפלטפורמה
 * ‏מעדכן פעם בשנה, וכל המשרדים רואים את אותם מספרים. משרד אינו
 * ‏עורך אותם — מספר מס שכל משרד „מתקן” לעצמו הוא מספר שאין לו מקור.
 * ‏בלי הגדרה שמורה (או עם JSON פגום) חוזרים לערכים שבקוד.
 */
@Injectable()
export class TaxTablesService {
  private readonly logger = new Logger(TaxTablesService.name);

  constructor(private readonly settings: PlatformSettingsService) {}

  async current(): Promise<TaxTables> {
    const raw = await this.settings.get("taxTables");
    if (raw === undefined || raw === "") return DEFAULT_TAX_TABLES;
    try {
      return TaxTablesSchema.parse(JSON.parse(raw));
    } catch (error) {
      this.logger.warn(`טבלאות המס השמורות פגומות — חוזרים לערכי הקוד: ${String(error)}`);
      return DEFAULT_TAX_TABLES;
    }
  }

  async replace(tables: TaxTablesInput, updatedBy: string): Promise<TaxTables> {
    const parsed = TaxTablesSchema.parse(tables);
    await this.settings.set("taxTables", JSON.stringify(parsed), updatedBy);
    return parsed;
  }
}
