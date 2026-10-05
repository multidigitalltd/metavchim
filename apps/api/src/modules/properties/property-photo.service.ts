import { Injectable, Logger } from "@nestjs/common";
import { MediaService } from "./media.service";
import { SearchService } from "../search/search.service";

/**
 * ‎**תמונה בוואטסאפ ⟵ נכס שכבר קיים.**
 *
 * ## ‏מה זה פותר
 *
 * ‏המתווך עומד בדירה ומצלם. עד עכשיו הדרך היחידה להכניס את התמונה
 * ‏הייתה לשלוח אותה לעצמו במייל, לפתוח מחשב, למצוא את הנכס ולהעלות
 * ‏— ולכן רוב התמונות פשוט לא נכנסו. נכס בלי תמונות אינו נשלח
 * ‏לאף קונה.
 *
 * ## ‏למה הכיתוב מכריע ולא התמונה
 *
 * ‏אותה תמונה יכולה להיות שתי כוונות: שלט „למכירה” הוא **נכס
 * ‏לגיוס חדש**, וסלון הוא **תמונה לנכס במלאי**. מודל שמנחש לפי
 * ‏מה שהוא רואה טועה על שלט שצולם בתוך דירה, ועל מודעה שצולמה
 * ‏ממסך — ובשני הכיוונים הטעות שקטה. מה שהמתווך כתב הוא מה
 * ‏שהוא התכוון, ולכן ההכרעה על הכיתוב.
 *
 * ## ‏ושתי התאמות הן שאלה
 *
 * ‏„תוסיף לנכס בהרצל” כששני נכסים ברחוב הרצל אינו בקשה שאפשר
 * ‏לבצע. בחירה בשם המתווך הייתה מכניסה תמונה של דירה אחת לכרטיס
 * ‏של אחרת — והוא יגלה את זה כשקונה ישאל למה התמונות לא מתאימות.
 * ‏השירות מחזיר את מה שנמצא, והקורא מבקש כיתוב מדויק יותר.
 *
 * ## ‏מה השירות הזה **לא** עושה
 *
 * ‏אינו כותב למסד בעצמו. `MediaService.upload` הוא המסלול היחיד
 * ‏שמעלה תמונה לנכס — אותו אחד שהמסך קורא לו — ולכן תמונה
 * ‏שנשלחה בוואטסאפ עוברת באותה מכסה, אותה בדיקת פורמט, אותו
 * ‏רענון מוכנות ואותו יומן. מסלול העלאה שני היה מדלג על כולם.
 *
 * ‏והחיפוש הוא `SearchService.search` — אותו אחד שהסוכן מזהה בו
 * ‏נכס מביטוי, ולכן כפוף להיקף הראייה של הסוכן: מי שאינו רואה
 * ‏את הנכס במסך אינו יכול לצרף לו תמונה מהשיחה.
 */
@Injectable()
export class PropertyPhotoService {
  private readonly logger = new Logger(PropertyPhotoService.name);

  constructor(
    private readonly search: SearchService,
    private readonly media: MediaService,
  ) {}

  /**
   * ‏צירוף התמונה לנכס שהביטוי מתאר.
   *
   * ‏התוצאה אומרת מה קרה: `attached` כשצורפה, `none` כשלא נמצא
   * ‏נכס, `many` כששניים ומעלה — והקורא מנסח. `many` נושא את מה
   * ‏שנמצא, כי „יש כמה” בלי לומר אילו אינו שאלה שאפשר לענות
   * ‏עליה.
   */
  async attach(input: {
    phrase: string;
    image: { buffer: Buffer; mimeType: string };
  }): Promise<
    | { outcome: "attached"; label: string }
    | { outcome: "none" }
    | { outcome: "many"; labels: string[] }
  > {
    const phrase = input.phrase.trim();
    if (phrase === "") return { outcome: "none" };

    const found = await this.findProperties(phrase);
    if (found.length === 0) return { outcome: "none" };
    if (found.length > 1) {
      return { outcome: "many", labels: found.slice(0, 5).map((row) => propertyLabel(row)) };
    }

    const property = found[0]!;
    await this.media.upload(property.id, input.image.buffer);
    this.logger.log(`תמונה מוואטסאפ צורפה לנכס ${property.id}`);
    return { outcome: "attached", label: propertyLabel(property) };
  }

  /**
   * ‎**מה שנאמר קודם, ובלי התחילית רק אם לא נמצא דבר.**
   *
   * ‏„תוסיף לנכס בהרצל 12” משאיר „בהרצל 12”, והחיפוש מחפש
   * ‏הכלה — כלומר רחוב ששמור כ„הרצל” לא יימצא. אבל הסרה עיוורת
   * ‏של ה-„ב” הופכת „באר שבע” ל„אר שבע” ו„בני ברק” ל„ני ברק”,
   * ‏ואלה שמות אמיתיים שהמתווך יקליד.
   *
   * ‏הסדר מכריע: מה שנכתב מנוסה כפי שהוא, והחיתוך רץ רק כשהוא
   * ‏לא החזיר דבר — ואז אין מה להפסיד.
   */
  private async findProperties(phrase: string): Promise<PropertyHit[]> {
    const asWritten = (await this.search.search(phrase)).properties;
    if (asWritten.length > 0) return asWritten;

    const stripped = phrase
      .split(" ")
      .map((word) => (/^[בלהמש]\p{Script=Hebrew}{2,}$/u.test(word) ? word.slice(1) : word))
      .join(" ");
    if (stripped === phrase) return [];
    return (await this.search.search(stripped)).properties;
  }
}

/** ‏מה שהחיפוש מחזיר על נכס — רק השדות שנקראים כאן. */
interface PropertyHit {
  id: string;
  marketingTitle?: string | null;
  street?: string | null;
  neighborhood?: string | null;
  city?: string | null;
}

/**
 * ‏הנכס כפי שהוא ייאמר בתשובה.
 *
 * ‏„התמונה נוספה” בלי לומר לאיזה נכס אינו אישור — המתווך שלח
 * ‏שלוש תמונות ברצף, וצריך לדעת שהן הגיעו למקום הנכון.
 */
function propertyLabel(row: {
  marketingTitle?: string | null;
  street?: string | null;
  neighborhood?: string | null;
  city?: string | null;
}): string {
  const parts = [row.street, row.neighborhood, row.city].filter(
    (part): part is string => typeof part === "string" && part.trim() !== "",
  );
  const address = parts.join(", ");
  if (row.marketingTitle !== null && row.marketingTitle !== undefined && row.marketingTitle !== "") {
    return row.marketingTitle;
  }
  return address === "" ? "הנכס" : address;
}
