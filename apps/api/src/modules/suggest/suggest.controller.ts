import { Controller, Get, Query } from "@nestjs/common";
import { z } from "zod";
import { NEIGHBORHOOD_SUGGESTION_LIMIT, suggestNeighborhoods } from "@metavchim/shared";
import { RequireCapability } from "../../common/auth.decorators";
import { PrismaService } from "../../core/prisma.service";
import { neighborhoodVocabulary } from "./neighborhood-vocabulary";

/**
 * ‎**אוצר שמות השכונות של המשרד.**
 *
 * ## למה זה קיים
 *
 * שם שכונה הוא טקסט חופשי, ולכן כל מתווך מקליד את אותה שכונה אחרת:
 * ‎`שיכון ג` ,`שיכון ג'` ,`שכונת שיכון ג׳`. ארבע צורות הן ארבע
 * שכונות שונות בכל חיפוש, סינון ודוח — והמתווך השני אינו יודע
 * שהראשון כבר הקליד אותה.
 *
 * ההסבר על השאילתה עצמה — ולמה אין כאן טבלת אוצר שצריך לסנכרן —
 * יושב לצד השאילתה ב-`neighborhood-vocabulary.ts`.
 */

const QuerySchema = z.object({
  q: z.string().max(80).optional(),
  /** עיר מצמצמת: „שיכון ג'” קיימת בכמה ערים, וזו לא אותה שכונה. */
  city: z.string().max(80).optional(),
});

@Controller("suggest")
export class SuggestController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * השכונות שכבר הוזנו במשרד, מסוננות למה שהוקלד עד כה.
   *
   * ‎**היכולת ולא `AnyAuthenticated`** (ביקורת Codex, P1). הסימון
   * ההוא מיועד לנתיב שכל תוכנו נגזר מהמשתמש עצמו — הפרופיל שלו,
   * ההתראות שלו — וזה מחזיר נתוני משרד. ההצהרה כאן היא מי שממלא
   * את השדות האלה בפועל: מי שיוצר או עורך נכס, ומי שעורך קונה.
   * ‎`viewer` שאינו כותב דבר אינו צריך הצעות השלמה.
   *
   * ‎**ובכוונה בלי צמצום בעלות.** ההצעה היא *אוצר המילים של
   * המשרד*, וזו כל מטרתה: סוכן ב' צריך לראות את הכתיב שסוכן א'
   * כבר השתמש בו, אחרת שניהם ימציאו צורות שונות — כלומר בדיוק
   * הכפילות שהפיצ'ר בא למנוע. מה שנחשף הוא שם מקום, בלי קישור
   * לרשומה, ללקוח או לסוכן.
   */
  @Get("neighborhoods")
  @RequireCapability("properties.create", "properties.edit", "buyers.edit")
  async neighborhoods(@Query() query: unknown): Promise<{ suggestions: string[] }> {
    const { q = "", city } = QuerySchema.parse(query ?? {});
    const cityFilter = city?.trim() ?? "";

    const vocabulary = await this.prisma.withTenant((tx) =>
      neighborhoodVocabulary(tx, cityFilter),
    );
    return { suggestions: suggestNeighborhoods(vocabulary, q, NEIGHBORHOOD_SUGGESTION_LIMIT) };
  }
}
