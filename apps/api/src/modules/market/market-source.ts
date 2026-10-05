import { z } from "zod";

/**
 * ‎**מקור העסקאות — מאחורי ממשק, כמו כל ספק במערכת** (docs/05 §0).
 *
 * המימוש הראשון הוא ה-API הציבורי של „גרסאות לעם” (over.org.il), שמגרד
 * את אתר רשות המסים ומצליב אותו עם שכבת החלקות. מימוש שני — מול רשות
 * המסים ישירות, או קליטת קובץ מלא — הוא מחלקה נוספת שעונה על אותו
 * ממשק, והסנכרון אינו משתנה.
 *
 * ## כל תשובה עוברת Zod, ותשובה שאינה בצורה הצפויה עוצרת הכול
 *
 * ‎**לא „מדלגים על שורה פגומה”.** שינוי בצורת המקור (שדה ששינה שם,
 * מספר שהפך למחרוזת) נראה בשורה הראשונה ובכל שורה אחריה. דילוג שקט
 * היה מכניס מאגר שלם של אפסים, או מסנכרן „בהצלחה” אפס עסקאות במשך
 * חודש. `MarketSourceFormatError` עוצר את הסנכרון ומופיע במסך הפלטפורמה
 * עם הנתיב והשדה — כך מגלים את זה ביום ולא ברבעון.
 */

/* ============================================================
   שגיאות — לפי מה שהסנכרון צריך לעשות איתן
   ============================================================ */

/** המקור ביקש להאט (429) או חסם זמנית. עוצרים את הסבב וממשיכים בבא. */
export class MarketSourceRateLimitError extends Error {
  constructor(public readonly status: number) {
    super(`המקור ביקש להאט (HTTP ${status})`);
  }
}

/** תקלה זמנית — רשת, timeout, ‏5xx. ניסיון חוזר הגיוני. */
export class MarketSourceTransientError extends Error {}

/** תשובה בצורה שאינה מוכרת. עוצרים את כל הסנכרון — זה לא יתוקן מעצמו. */
export class MarketSourceFormatError extends Error {
  constructor(path: string, detail: string) {
    super(`צורת התשובה של המקור השתנתה (${path}): ${detail}`.slice(0, 290));
  }
}

/* ============================================================
   צורות התשובה — נגזרות מתשובות אמיתיות שנבדקו
   ============================================================ */

/** מספר שהמקור מחזיר לפעמים כמחרוזת ("11359", "1.000"), או ריק. */
const looseNumber = z.preprocess((value) => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : Number.NaN;
  }
  return Number.NaN;
}, z.number().nullable());

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);

const StatsSchema = z.object({
  deals: z.number().int().nonnegative(),
  first_deal: isoDate.nullable(),
  last_deal: isoDate.nullable(),
  settlements: z.number().int().nonnegative(),
});

const SettlementsSchema = z.object({
  data: z.array(
    z.object({
      settlement: z.string(),
      settlement_code: looseNumber,
      deals: z.number().int().nonnegative(),
      last_deal: isoDate.nullable(),
    }),
  ),
});

const NaturesSchema = z.object({
  data: z.array(z.object({ nature: z.string().nullable(), deals: z.number().int().nonnegative() })),
});

const DealRowSchema = z.object({
  date: isoDate,
  amount: looseNumber,
  nature: z.string().nullable(),
  area_sqm: looseNumber,
  rooms: looseNumber,
  year_built: looseNumber,
  portion_fraction: looseNumber.optional(),
  portion: looseNumber.optional(),
  sub_parcel: looseNumber,
  settlement: z.string().nullable(),
  settlement_code: looseNumber,
  gush: looseNumber,
  helka: looseNumber,
});

const SearchSchema = z.object({
  data: z.array(DealRowSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  sort: z.string(),
});

const PointSchema = z.object({ lat: z.number(), lon: z.number() });

const ParcelIdentitySchema = z.object({
  gush: looseNumber,
  helka: looseNumber,
  settlement: z.object({ code: looseNumber, name: z.string().nullable() }).nullable().optional(),
  point: PointSchema.nullable().optional(),
  streets: z.array(z.string()).nullable().optional(),
});

const StatAreaSchema = z
  .object({
    yishuv_stat: looseNumber.optional(),
    code: looseNumber.optional(),
    socio: z.object({ eshkol: looseNumber.optional() }).nullable().optional(),
  })
  .nullable()
  .optional();

const ParcelRecordSchema = z.object({
  identity: ParcelIdentitySchema,
  stat_area: StatAreaSchema,
  point: PointSchema.nullable().optional(),
});

const ParcelsSchema = z.object({ data: z.array(ParcelRecordSchema) });

/* ============================================================
   הצורה שלנו — מה שהסנכרון מקבל
   ============================================================ */

export interface SourceStats {
  deals: number;
  firstDeal: string | null;
  lastDeal: string | null;
  settlements: number;
}

export interface SourceSettlement {
  name: string;
  code: number | null;
  deals: number;
  lastDeal: string | null;
}

export interface SourceDeal {
  date: string;
  amountIls: number;
  nature: string;
  areaSqm: number | null;
  rooms: number | null;
  yearBuilt: number | null;
  portion: number | null;
  subParcel: number | null;
  settlement: string | null;
  gush: number;
  helka: number;
}

export interface SourceDealPage {
  deals: SourceDeal[];
  /** כמה החזיר המקור בפועל — תקרה בצד השרת קובעת אם יש עוד. */
  pageSize: number;
  /**
   * גודל העמוד שהמקור החיל בפועל, כשהוא מדווח עליו. שרת שמקצץ את
   * ‎`limit` מחזיר עמודים מלאים קטנים מהמבוקש — הם אינם סוף הנתונים.
   */
  limit?: number;
}

export interface SourceParcel {
  gush: number;
  helka: number;
  settlementCode: number | null;
  statArea: number | null;
  socioEshkol: number | null;
  lat: number | null;
  lon: number | null;
  street: string | null;
}

export interface MarketSource {
  readonly name: string;
  stats(): Promise<SourceStats>;
  settlements(): Promise<SourceSettlement[]>;
  natures(): Promise<string[]>;
  /** עסקאות ביישוב מתאריך, מהישנה לחדשה. */
  dealsSince(settlement: string, dateFrom: string, offset: number, limit: number): Promise<SourceDealPage>;
  /** החלקה שבנקודה — זיהוי גוש-חלקה לנכס של משרד. */
  parcelAt(lat: number, lon: number): Promise<SourceParcel | null>;
  /** פרטי חלקה — מיקום ואזור סטטיסטי, למפה ולהשוואה ברמת השכונה. */
  parcel(gush: number, helka: number): Promise<SourceParcel | null>;
}

/* ============================================================
   מימוש — over.org.il
   ============================================================ */

/** תקרת התוצאות של חיפוש אחד במקור (`total_capped`). מעליה — חלון תאריכים חדש. */
export const SOURCE_SEARCH_CAP = 10_000;

const REQUEST_TIMEOUT_MS = 30_000;

/*
 * מזדהים בשם ובכתובת — שירות ציבורי שמתנדבים מפעילים צריך לדעת מי
 * פונה אליו ואיך ליצור קשר, ולא לראות עוד בוט אנונימי.
 */
const USER_AGENT = "metavchim-market-sync/1.0 (+https://github.com/multidigitalltd/metavchim)";

const rooms = (value: number | null): number | null =>
  // ‎`NUMERIC(3,1)` — מספר חדרים מעל 99 הוא בניין, לא דירה
  value !== null && value > 0 && value < 100 ? Math.round(value * 2) / 2 : null;

const positiveInt = (value: number | null): number | null =>
  value !== null && Number.isFinite(value) && value > 0 ? Math.round(value) : null;

/** גבול עמודת `INTEGER` — ערך מעליו הוא הקלדה שגויה, ושורה אחת כזו הייתה מפילה את כל העמוד. */
const INT4_MAX = 2_147_483_647;
const int4 = (value: number | null): number | null => (value !== null && value <= INT4_MAX ? value : null);

function toParcel(record: z.infer<typeof ParcelRecordSchema>): SourceParcel | null {
  const gush = positiveInt(record.identity.gush);
  const helka = positiveInt(record.identity.helka);
  if (gush === null || helka === null) return null;
  const point = record.identity.point ?? record.point ?? null;
  return {
    gush,
    helka,
    settlementCode: positiveInt(record.identity.settlement?.code ?? null),
    statArea: positiveInt(record.stat_area?.yishuv_stat ?? null),
    socioEshkol: positiveInt(record.stat_area?.socio?.eshkol ?? null),
    lat: point?.lat ?? null,
    lon: point?.lon ?? null,
    street: record.identity.streets?.[0]?.slice(0, 80) ?? null,
  };
}

export class OverOrgIlSource implements MarketSource {
  readonly name = "over.org.il";
  /** כמה בקשות יצאו — לרישום הסבב במסך הפלטפורמה. */
  requests = 0;

  constructor(private readonly baseUrl: string) {}

  /*
   * ‎`S extends ZodTypeAny` ולא `ZodType<T>`: האחרון מסיק את T מצד
   * הקלט, ולשדות עם `preprocess` הקלט הוא `unknown`.
   */
  private async get<S extends z.ZodTypeAny>(path: string, schema: S): Promise<z.infer<S>> {
    this.requests += 1;
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        headers: { Accept: "application/json", "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error: unknown) {
      throw new MarketSourceTransientError(`הפנייה למקור נכשלה: ${String(error)}`);
    }
    if (response.status === 429 || response.status === 403) {
      throw new MarketSourceRateLimitError(response.status);
    }
    if (response.status >= 500) throw new MarketSourceTransientError(`המקור החזיר ${response.status}`);
    if (response.status === 404) {
      // „אין כזה” הוא תשובה תקינה רק לנתיב שהצורה שלו מתירה null (חלקה)
      const empty = schema.safeParse(null);
      if (empty.success) return empty.data as z.infer<S>;
      throw new MarketSourceFormatError(path.split("?")[0] ?? path, "HTTP 404");
    }
    if (!response.ok) throw new MarketSourceFormatError(path, `HTTP ${response.status}`);

    const body: unknown = await response.json().catch(() => undefined);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new MarketSourceFormatError(path.split("?")[0] ?? path, `${issue?.path.join(".") ?? ""} ${issue?.message ?? ""}`);
    }
    return parsed.data as z.infer<S>;
  }

  async stats(): Promise<SourceStats> {
    const body = await this.get("/deals/stats", StatsSchema);
    return {
      deals: body.deals,
      firstDeal: body.first_deal,
      lastDeal: body.last_deal,
      settlements: body.settlements,
    };
  }

  async settlements(): Promise<SourceSettlement[]> {
    const body = await this.get("/deals/settlements", SettlementsSchema);
    return body.data
      .filter((row) => row.settlement.trim() !== "")
      .map((row) => ({
        name: row.settlement.trim().slice(0, 80),
        code: positiveInt(row.settlement_code),
        deals: row.deals,
        lastDeal: row.last_deal,
      }));
  }

  async natures(): Promise<string[]> {
    const body = await this.get("/deals/natures", NaturesSchema);
    return body.data.map((row) => row.nature?.trim() ?? "").filter((name) => name !== "");
  }

  async dealsSince(settlement: string, dateFrom: string, offset: number, limit: number): Promise<SourceDealPage> {
    const query = new URLSearchParams({
      settlement,
      date_from: dateFrom,
      sort: "date_asc",
      limit: String(limit),
      offset: String(offset),
    });
    const path = `/deals/search?${query.toString()}`;
    const body = await this.get(path, SearchSchema);

    /*
     * ‎**הסנכרון כולו נשען על המיון מהישנה לחדשה** — הסמן מתקדם לפי
     * התאריך האחרון בעמוד. מקור שמתעלם מ-`sort` ומחזיר מהחדשה היה
     * גורם לסמן לקפוץ להיום אחרי עמוד אחד, ולמאגר להיראות „מסונכרן”
     * עם עשרות עסקאות מתוך אלפים. בודקים גם את ההד וגם את הסדר בפועל.
     */
    if (body.sort !== "date_asc") {
      throw new MarketSourceFormatError("/deals/search", `המקור אינו ממיין מהישנה לחדשה (sort=${body.sort})`);
    }
    for (let i = 1; i < body.data.length; i += 1) {
      if (body.data[i]!.date < body.data[i - 1]!.date) {
        throw new MarketSourceFormatError("/deals/search", "העסקאות אינן ממוינות לפי תאריך");
      }
    }

    const deals: SourceDeal[] = [];
    for (const row of body.data) {
      const gush = int4(positiveInt(row.gush));
      const helka = int4(positiveInt(row.helka));
      const amount = positiveInt(row.amount);
      // עסקה בלי גוש, חלקה או סכום אינה ניתנת לקישור או להשוואה
      if (gush === null || helka === null || amount === null) continue;
      const portion = row.portion_fraction ?? row.portion ?? null;
      deals.push({
        date: row.date,
        amountIls: amount,
        nature: (row.nature ?? "").trim().slice(0, 60),
        areaSqm: int4(positiveInt(row.area_sqm)),
        rooms: rooms(row.rooms),
        yearBuilt: row.year_built !== null && row.year_built > 1800 && row.year_built < 2200 ? Math.round(row.year_built) : null,
        portion: portion !== null && portion > 0 && portion <= 1 ? Math.round(portion * 1000) / 1000 : null,
        subParcel: row.sub_parcel !== null && row.sub_parcel >= 0 ? int4(Math.round(row.sub_parcel)) : null,
        settlement: row.settlement?.trim().slice(0, 80) ?? null,
        gush,
        helka,
      });
    }
    return { deals, pageSize: body.data.length, limit: body.limit };
  }

  async parcelAt(lat: number, lon: number): Promise<SourceParcel | null> {
    const query = new URLSearchParams({
      lat: lat.toFixed(6),
      lon: lon.toFixed(6),
      fields: "identity,stat_area",
    });
    const body = await this.get(`/nadlan/lookup?${query.toString()}`, ParcelsSchema.nullable());
    const first = body?.data[0];
    if (!first) return null;
    const parcel = toParcel(first);
    // ‎`lookup` מחזיר את החלקה שהנקודה נופלת בה — הנקודה עצמה היא המיקום
    return parcel ? { ...parcel, lat: parcel.lat ?? lat, lon: parcel.lon ?? lon } : null;
  }

  async parcel(gush: number, helka: number): Promise<SourceParcel | null> {
    const body = await this.get(
      `/nadlan/parcel/${gush}/${helka}?geometry=false&fields=identity,stat_area`,
      ParcelsSchema.nullable(),
    );
    const first = body?.data[0];
    return first ? toParcel(first) : null;
  }
}

export const DEFAULT_MARKET_SOURCE_URL = "https://www.over.org.il/api";
