/**
 * ‎**מסכי הטאבו המשותף מסכימים עם מה שהשרת באמת עושה.**
 *
 * ‏שתי טענות, ולשתיהן אותו כשל: המסך מחליט לפי חצי מהכלל, השרת
 * ‏לפי הכלל כולו, ואף אחד מהם אינו יודע שהם חלוקים.
 *
 * ---
 *
 * ‎**עמדת „טאבו משותף” של קונה נגזרת — בכל מקום, כולל המסך.**
 *
 * ## התקלה שהשער הזה נולד ממנה
 *
 * ‏`requirements.sharedTabu` אינו התשובה המלאה: קונה מדור קודם
 * ‏מבטא את אותה עובדה דרך `propertyTypes: ["shared_tabu"]`, ולכן
 * ‏הכלל נגזר ב-`buyerSharedTabuStance` ולא נקרא מהשדה.
 *
 * ‏הסינון, ההתאמות ושידוך השותפים עברו לגזירה. **טופס העריכה
 * ‏נשאר מאחור** (ביקורת Codex, P2): הוא אתחל את השדה מהערך הגולמי,
 * ‏ולכן על אותו קונה בדיוק המערכת פעלה כ„מוכן” והמסך אמר „טרם
 * ‏נשאל”. המתווך רואה שאלה פתוחה על לקוח שכבר ענה, ושמירה של
 * ‏עריכה אחרת משמרת את הפער.
 *
 * ## למה שער ולא בדיקה
 *
 * ‏אין ב-`web` בדיקות יחידה — רק `tsc` והשערים האלה. והחתימה של
 * ‏`SharedTabuField` מקבלת בדיוק את אותו טיפוס בשני המקרים, ולכן
 * ‏המעבר חזרה לערך הגולמי הוא שינוי **חוקי לחלוטין** מבחינת
 * ‏הטיפוסים. הוא נראה רק כאן.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "src", "app", "buyers");

/** ‏המסכים שמאתחלים את השדה מדרישות קיימות. */
const FORMS = [join(ROOT, "[id]", "edit", "page.tsx")];

let failed = false;
for (const file of FORMS) {
  const source = readFileSync(file, "utf8");
  if (!source.includes("<SharedTabuField")) {
    console.error(`✗ ${file}: שדה העמדה נעלם מהטופס — עדכנו את השער`);
    failed = true;
    continue;
  }
  if (!source.includes("buyerSharedTabuStance(")) {
    console.error(
      `✗ ${file}: העמדה מאותחלת מהערך הגולמי ולא מ-buyerSharedTabuStance()`,
    );
    failed = true;
    continue;
  }
  /*
   * ‏ולא „גם וגם”: אתחול מהשדה הגולמי לצד הגזירה הוא בדיוק המצב
   * ‏שבו אחד מהם מנצח בשקט.
   */
  if (/initial:\s*req\.sharedTabu\b/u.test(source)) {
    console.error(`✗ ${file}: נותר אתחול ישיר מ-req.sharedTabu`);
    failed = true;
    continue;
  }
  console.log(`✓ ${file}`);
}

/**
 * ‎**והמקטע מוצג רק למי שהנתיב שלו ייענה לו** (ביקורת Codex, P2).
 *
 * ‏`/matches/property/:id/partners` מוגן ב-
 * ‎`@RequireCapability("matches.view")`, והתנאי שמרכיב את המקטע
 * ‏בדק את מודול הקונים בלבד. משרד שהסיר `matches.view` מסוכן קיבל
 * ‏את המקטע, וכל בקשה חזרה 403 — כלומר „טעינת השותפויות נכשלה”
 * ‏על מקטע שמעולם לא היה אמור להופיע אצלו.
 */
const PROPERTY_PAGE = join(
  import.meta.dirname,
  "..",
  "src",
  "app",
  "properties",
  "[id]",
  "page.tsx",
);
const page = readFileSync(PROPERTY_PAGE, "utf8");
const mount = page.indexOf("<PartnerSuggestions");
if (mount < 0) {
  console.error(`✗ ${PROPERTY_PAGE}: מקטע השותפויות נעלם — עדכנו את השער`);
  failed = true;
} else {
  /* ‏התנאי שמעל ההרכבה: מהתנאי הפותח ועד תגית הרכיב. */
  const guardStart = page.lastIndexOf("{property.sharedTabu", 0 + mount);
  const guard = guardStart < 0 ? "" : page.slice(guardStart, mount);
  if (!guard.includes('can(user, "matches.view")')) {
    console.error(
      `✗ ${PROPERTY_PAGE}: מקטע השותפויות מורכב בלי לבדוק matches.view — הנתיב דורש אותה`,
    );
    failed = true;
  } else {
    console.log(`✓ ${PROPERTY_PAGE}`);
  }
}

if (failed) process.exit(1);
console.log("מסכי הטאבו המשותף מסכימים עם השרת.");
