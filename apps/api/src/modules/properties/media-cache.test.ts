import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ‎**כל נתיב שמגיש תמונת נכס עונה עם ETag, לא עם שעה של מטמון.**
 *
 * ‏תמונת נכס משתכתבת במקום — טשטוש פנים, שיפור — תחת אותו מפתח.
 * ‏נתיב שמגיש אותה עם `max-age` היה משאיר את הפנים שטושטשו במטמון
 * ‏של הקונה עוד שעה (ביקורת Codex). הנתיבים האלה עוברים דרך
 * ‎`objectResponse`, שקובע `no-cache` + ETag ועונה 304 כשלא השתנה.
 *
 * ‏השער כאן מונה: נתיב תמונה חדש שיכתוב `@Header("Cache-Control",
 * "…max-age…")` ליד `getRaw`/`publicImage`/`photo` ייפול כאן ולא
 * ‏אצל הקונה.
 */
const ROOT = join(import.meta.dirname, "..");
const PHOTO_ROUTES: [string, string[]][] = [
  ["properties/media.controller.ts", ["this.media.getRaw("]],
  ["properties/landing.controller.ts", ["this.landing.publicImage("]],
  ["offers/offers.controller.ts", ["this.offers.publicImage("]],
  ["collaboration/collaboration.controller.ts", ["this.listings.photo(", "this.collaboration.offerPhoto("]],
];

describe("נתיבי תמונות נכס", () => {
  it.each(PHOTO_ROUTES)("%s — כל הגשה של תמונה עוברת ב-objectResponse", (file, calls) => {
    const source = readFileSync(join(ROOT, file), "utf8");
    for (const call of calls) {
      const at = source.indexOf(call);
      expect(at, `${call} חסר`).toBeGreaterThan(-1);
      /* ‏הקריאה לשירות יושבת בתוך objectResponse(...) באותה שורה */
      const line = source.slice(source.lastIndexOf("\n", at) + 1, source.indexOf("\n", at));
      expect(line, `${call} אינו מוגש דרך objectResponse`).toContain("objectResponse(");
      /* ‏ואין max-age בדקורטורים של אותה מתודה */
      const methodStart = source.lastIndexOf("@Get(", at);
      expect(source.slice(methodStart, at)).not.toContain("max-age");
    }
  });
});
