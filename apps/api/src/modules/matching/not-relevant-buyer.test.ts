import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ‎**„לא רלוונטי” — מחוץ לעבודה, בכל מקום שמוביל לקונה.**
 *
 * ‏בקשת המשתמש: קונה שסומן „לא רלוונטי” אינו מקבל התאמות, אינו מייצר
 * ‏התראות או משימות על נכסים, ואינו מתפרסם ברשת. כל אחד מהמסלולים האלה
 * ‏בוחר קונים בשאילתה משלו, ולכן שאילתה אחת שתישכח היא בדיוק המקום שבו
 * ‏המתווך יקבל שוב התראה על קונה שכבר אמר שאינו רלוונטי.
 *
 * ‏בדיקה מבנית, באותו דפוס של `recompute-purge.test.ts`: אין הרנס
 * ‏התנהגותי ל-`MatchingService`, והיא מונעת חזרה לתבנית השגויה בעריכה.
 */

const ROOT = join(import.meta.dirname, "../../../../..");
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");

const MATCHING = read("apps/api/src/modules/matching/matching.service.ts");
const COLLAB = read("apps/api/src/modules/collaboration/collaboration.service.ts");
const BUYERS = read("apps/api/src/modules/buyers/buyers.service.ts");
const LISTINGS = read("apps/api/src/modules/collaboration/listings.service.ts");

function body(source: string, signature: RegExp, end: RegExp): string {
  const start = source.search(signature);
  if (start < 0) return "";
  const rest = source.slice(start);
  const stop = rest.search(end);
  return stop < 0 ? rest : rest.slice(0, stop);
}

const EXCLUDED = "maturity: { not: NOT_RELEVANT_MATURITY }";

describe("קונה „לא רלוונטי”", () => {
  it("אינו מועמד להתאמה של נכס — וההצעות שלו נמחקות באותו סבב", () => {
    const recompute = body(MATCHING, /async recomputeForProperty\(/u, /async recomputeForBuyer\(/u);
    expect(recompute).toContain(EXCLUDED);
    expect(recompute).toContain("buyerId: { notIn: candidates.map((c) => c.id) }");
  });

  it("רענון של הקונה עצמו מוחק את ההצעות הממתינות ואינו מחשב", () => {
    const recompute = body(MATCHING, /async recomputeForBuyer\(/u, /const parsed = BuyerRequirementsSchema/u);
    const guard =
      /if \(buyer\.maturity === NOT_RELEVANT_MATURITY\) \{[\s\S]*?return NO_MATCHES;/u.exec(recompute)?.[0] ?? "";
    expect(guard).toContain("deleteMany");
    expect(guard).toContain('status: "suggested"');
  });

  /* ‏הסינון בבחירה הוא צילום; הכתיבה בודקת שוב תחת נעילה (ביקורת Codex) */
  it("כתיבת התאמה בודקת שוב, נעול, שהקונה עדיין בעבודה", () => {
    const upsert = body(MATCHING, /private async upsertMatch\(/u, /async countAll\(/u);
    const lock = upsert.indexOf("maturity <> ${NOT_RELEVANT_MATURITY}");
    expect(lock).toBeGreaterThan(0);
    expect(upsert.slice(lock, lock + 80)).toContain("FOR SHARE");
    expect(lock).toBeLessThan(upsert.indexOf("tx.match.create("));
  });

  it("אינו נסרק לשותפויות בטאבו משותף", () => {
    expect(body(MATCHING, /const scanWhere = \{/u, /\};/u)).toContain(EXCLUDED);
  });

  it("אינו מתפרסם ברשת, וביקוש פעיל שלו נסגר", () => {
    expect(body(COLLAB, /async shareBuyer\(/u, /async shareBuyersBulk\(/u)).toMatch(
      /buyer\.maturity === NOT_RELEVANT_MATURITY\) \{\s*throw new BadRequestException/u,
    );
    expect(body(COLLAB, /async resyncDemandForBuyer\(/u, /async activeDemandForBuyer\(/u)).toMatch(
      /buyer\.maturity === NOT_RELEVANT_MATURITY\) \{[\s\S]*?status: "closed"/u,
    );
  });

  it("שיתוף נועל את שורת הקונה לפני שהוא קורא את הדרגה", () => {
    const share = body(COLLAB, /async shareBuyer\(/u, /async shareBuyersBulk\(/u);
    const lock = share.indexOf("FOR UPDATE");
    expect(lock).toBeGreaterThan(0);
    expect(lock).toBeLessThan(share.indexOf("buyer.maturity === NOT_RELEVANT_MATURITY"));
  });

  it("אינו מופיע בפיד הנכסים של הרשת, בהצעה לפרסם, ובסבב העוקבים", () => {
    expect(body(LISTINGS, /private inPlayBuyersWhere\(/u, /\n {2}\}/u)).toContain(EXCLUDED);
    expect(body(LISTINGS, /async list\(/u, /async matchesForBuyer\(/u)).toContain("this.inPlayBuyersWhere(tenantId)");
    expect(body(LISTINGS, /async reach\(/u, /\n {2}\}\n/u)).toContain("this.inPlayBuyersWhere(tenantId)");
    expect(LISTINGS).toMatch(/deletedAt: null,\s*\/\*[^*]*\*\/\s*maturity: \{ not: NOT_RELEVANT_MATURITY \},/u);
  });

  it("כרטיס הקונה אינו מציג לו התאמות ברשת, ואינו נשלח למשרד אחר", () => {
    expect(body(LISTINGS, /async matchesForBuyer\(/u, /const listings = /u)).toMatch(
      /buyer\.maturity === NOT_RELEVANT_MATURITY\) return \[\];/u,
    );
    expect(LISTINGS).toMatch(
      /buyer\.maturity === NOT_RELEVANT_MATURITY\) \{\s*throw new BadRequestException\("קונה שסומן „לא רלוונטי” אינו נשלח למשרדים אחרים"\)/u,
    );
  });

  it("מעבר אל „לא רלוונטי” וממנו מחשב את ההתאמות מחדש", () => {
    expect(BUYERS).toMatch(/if \(patch\.requirements \|\| relevanceMoved\) \{/u);
  });

  it("משימות והתראות של העובדים אינן נוצרות עליו", () => {
    for (const job of ["property-market.ts", "offer-followup.ts"]) {
      expect(read(`apps/workers/src/jobs/${job}`), job).toContain(EXCLUDED);
    }
  });
});
