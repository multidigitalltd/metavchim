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

/**
 * ‎**וההמרה שואלת על הנכס, ולא יורשת מהאדם** (ביקורת Codex, P1).
 *
 * ‏`contacts.shared_tabu` הוא עובדה על האדם, ולאדם אחד יכולים
 * ‏להיות כמה לידים. שלוש גרסאות ניסו להעביר אותה לנכס אוטומטית,
 * ‏וכולן נחתו אצל מי שהומר ראשון: נכס רגיל עם אזהרה משפטית שאיש
 * ‏לא אמר עליו, והנכס שבמושאע בלעדיה.
 *
 * ‏מה שנשאר הוא שאלה בטופס, מסומנת מראש לפי הסימון על הלקוח.
 * ‏התיבה היא **כל** התיקון בצד המסך: בלעדיה השרת חוזר לקבל
 * ‏`sharedTabu` ריק בכל המרה, והנתון שנרשם על הלקוח נמחק בשקט
 * ‏בדיוק ברגע שהנכס נוצר. ‎`tsc` לא רואה תיבה שנמחקה.
 */
const CONVERT = join(import.meta.dirname, "..", "src", "app", "leads", "convert-sections.tsx");
const convert = readFileSync(CONVERT, "utf8");
const section = convert.slice(convert.indexOf("export function ConvertToPropertySection("));
if (section.length === 0) {
  console.error(`✗ ${CONVERT}: מקטע ההמרה לנכס נעלם — עדכנו את השער`);
  failed = true;
} else if (!/name="sharedTabu"/u.test(section)) {
  console.error(`✗ ${CONVERT}: טופס ההמרה אינו שואל על רישום משותף`);
  failed = true;
} else if (!/sharedTabu:\s*f\.get\("sharedTabu"\)/u.test(section)) {
  console.error(`✗ ${CONVERT}: התשובה אינה נשלחת לשרת`);
  failed = true;
} else if (!/defaultChecked=\{contactSharedTabu\}/u.test(section)) {
  console.error(
    `✗ ${CONVERT}: התיבה אינה מסומנת מראש מהסימון על הלקוח — הנתון ייעלם בהמרה`,
  );
  failed = true;
} else {
  console.log(`✓ ${CONVERT}`);
}

/**
 * ‎**וכל טופס שיוצר או עורך נכס שואל את השאלה** (ביקורת Codex, P2).
 *
 * ‏הסימון נוסף לעריכה ולהמרה מליד ונשכח במסלול הקליטה הראשי, ואז
 * ‏מתווך שקולט דירה במושאע נאלץ לבחור בין שתי טעויות: לשמור אותה
 * ‏כדירה רגילה בלי העובדה המשפטית, או לבחור בסוג הנכס הישן
 * ‏`shared_tabu` ולאבד את „דירה” — ואז `propertyTypeMatches` פוסל
 * ‏ממנה כל מחפש דירה.
 *
 * ‏רשימה ולא בדיקה בודדת: זו בדיוק התבנית שנשברה — שדה שנוסף
 * ‏לשניים משלושה מסכים.
 */
const PROPERTY_FORMS = [
  ["app", "properties", "new", "page.tsx"],
  ["app", "properties", "[id]", "edit", "page.tsx"],
];
for (const parts of PROPERTY_FORMS) {
  const file = join(import.meta.dirname, "..", "src", ...parts);
  const body = readFileSync(file, "utf8");
  if (!/name="sharedTabu"/u.test(body)) {
    console.error(`✗ ${file}: הטופס אינו שואל על רישום משותף`);
    failed = true;
  } else if (!/sharedTabu:\s*f\.get\("sharedTabu"\)/u.test(body)) {
    console.error(`✗ ${file}: התשובה אינה נשלחת לשרת`);
    failed = true;
  } else {
    console.log(`✓ ${file}`);
  }
}

/**
 * ‎**וניקוי הסינון הוא פעולה אחת, לא שתיים** (ביקורת Codex, P2).
 *
 * ‏במסך הנכסים יש שני כפתורי ניקוי — בראש הרשימה ובמצב הריק —
 * ‏והמסנן החדש נוסף לאחד ולא לשני: מי שסינן לפי רישום בלבד וקיבל
 * ‏רשימה ריקה לחץ על כפתור שמבטיח לנקות, ודבר לא קרה.
 */
const PROPERTIES_LIST = join(import.meta.dirname, "..", "src", "app", "properties", "page.tsx");
const propertiesList = readFileSync(PROPERTIES_LIST, "utf8");
const clearHandlers = [...propertiesList.matchAll(/setSharedTabu\(""\)/gu)].length;
const clearButtons = [...propertiesList.matchAll(/onClick=\{clearFilters\}/gu)].length;
if (clearHandlers !== 1) {
  console.error(
    `✗ ${PROPERTIES_LIST}: איפוס מסנן הרישום מופיע ${clearHandlers} פעמים — ניקוי אחד לשני הכפתורים`,
  );
  failed = true;
} else if (clearButtons < 2) {
  console.error(`✗ ${PROPERTIES_LIST}: לא כל כפתורי הניקוי עוברים דרך אותה פעולה`);
  failed = true;
} else {
  console.log(`✓ ${PROPERTIES_LIST}`);
}

/**
 * ‎**ובמסך הקונים — כתובת אחת לשליפת הרשימה** (ביקורת Codex, P2).
 *
 * ‏השאילתה נבנתה גם בטעינה הראשונית וגם ברענון שאחרי מחיקה
 * ‏מרובה, ולכן הרענון החזיר קונים בלי סינון העמדה בזמן שהבורר
 * ‏על המסך עדיין הראה אותה.
 */
const BUYERS_LIST = join(import.meta.dirname, "..", "src", "app", "buyers", "page.tsx");
const buyersList = readFileSync(BUYERS_LIST, "utf8");
const urlBuilders = [...buyersList.matchAll(/`\/buyers\?limit=/gu)].length;
if (urlBuilders !== 1) {
  console.error(
    `✗ ${BUYERS_LIST}: כתובת הרשימה נבנית ${urlBuilders} פעמים — מסנן חדש ייכנס לאחת ולא לשנייה`,
  );
  failed = true;
} else if ([...buyersList.matchAll(/buyersListUrl\(/gu)].length < 3) {
  console.error(`✗ ${BUYERS_LIST}: לא כל השליפות עוברות דרך `+"`buyersListUrl`");
  failed = true;
} else {
  console.log(`✓ ${BUYERS_LIST}`);
}

/**
 * ‎**והסוג הישן אינו מוצע יותר כבחירה** (ביקורת Codex, P1).
 *
 * ‎`shared_tabu` אינו סוג מבנה אלא עובדה משפטית, וכל עוד הוא הופיע
 * ‏בבורר, מתווך שבחר בו והשאיר את התיבה החדשה ריקה שלח
 * ‏`propertyType: "shared_tabu"` יחד עם `sharedTabu: false` —
 * ‏ו-`fieldsToColumns` קורא את הצירוף כ„פרישת הייצוג הישן”, כלומר
 * ‏מוחק את שניהם. הסיווג שנבחר נעלם בשקט.
 *
 * ‏בעריכה של שורה שכבר נושאת אותו הוא **חייב** להישאר, אחרת
 * ‏`defaultValue` לא מתאים לשום אפשרות והבורר נופל לראשונה —
 * ‏כלומר שמירה סתמית משנה את הסוג. לכן `keep`, ולכן רק שם.
 */
const TYPE_OPTIONS = join(import.meta.dirname, "..", "src", "app", "property-type-options.tsx");
const typeOptions = readFileSync(TYPE_OPTIONS, "utf8");
if (!/option\.value !== SHARED_TABU_PROPERTY_TYPE \|\| keep === SHARED_TABU_PROPERTY_TYPE/u.test(typeOptions)) {
  console.error(`✗ ${TYPE_OPTIONS}: הסוג הישן מוצע שוב כבחירה`);
  failed = true;
} else {
  console.log(`✓ ${TYPE_OPTIONS}`);
}

/** ‏ורק מסך העריכה מוסר `keep` — מסכי היצירה אינם רשאים. */
const KEEP_USERS = [
  [["app", "properties", "[id]", "edit", "page.tsx"], true],
  [["app", "properties", "new", "page.tsx"], false],
  [["app", "leads", "convert-sections.tsx"], false],
];
for (const [parts, expected] of KEEP_USERS) {
  const file = join(import.meta.dirname, "..", "src", ...parts);
  const body = readFileSync(file, "utf8");
  const passes = /<PropertyTypeOptions\s+keep=/u.test(body);
  if (passes !== expected) {
    console.error(
      expected
        ? `✗ ${file}: הבורר אינו שומר את הערך השמור — שמירה תשנה את הסוג בשקט`
        : `✗ ${file}: מסך יצירה אינו רשאי להציע את הסוג הישן`,
    );
    failed = true;
  } else {
    console.log(`✓ ${file}`);
  }
}

if (failed) process.exit(1);
console.log("מסכי הטאבו המשותף מסכימים עם השרת.");
