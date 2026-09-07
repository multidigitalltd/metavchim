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
  /*
   * ‏חלון לפני ההרכבה, ולא „מהתנאי הפותח”: הניסוח הקודם חתך מ-
   * ‎`{property.sharedTabu`, ולכן הוא נשבר ברגע שהתנאי הזה הוחלף
   * ‏ב-`partnershipApplies` — כלומר חסם את התיקון שהוא בא להגן
   * ‏עליו. תשיעית בסבב הזה.
   */
  const guard = page.slice(Math.max(0, mount - 500), mount);
  /*
   * ‎**„שידוך שייך לנכס הזה” — אותה שאלה שהשרת שואל** (ביקורת
   * ‏Codex, P2). התנאי בדק `sharedTabu` בלבד, ולכן נכס שנמכר, נכס
   * ‏להשכרה או נכס בלי מחיר קיבלו מקטע שאומר „לא נמצאו שני לקוחות
   * ‏מתאימים” — בזמן שהחישוב מעולם לא רץ. „אין תוצאה” ו„לא
   * ‏רלוונטי” הם שני מסרים שונים.
   */
  if (!guard.includes("partnershipApplies(property)")) {
    console.error(
      `✗ ${PROPERTY_PAGE}: התנאי אינו שואל את partnershipApplies — המסך והשרת ייפרדו`,
    );
    failed = true;
  } else if (guard.includes("property.sharedTabu === true &&")) {
    console.error(`✗ ${PROPERTY_PAGE}: נותרה בדיקה ידנית של הדגל לצד הפונקציה`);
    failed = true;
  } else if (!guard.includes('can(user, "matches.view")')) {
    /*
     * ‎`/matches/property/:id/partners` מוגן ב-`matches.view`, ובלי
     * ‏הבדיקה כאן משרד שהסיר אותה מסוכן קיבל את המקטע וכל בקשה
     * ‏חזרה 403 — „טעינת השותפויות נכשלה” על מקטע שלא היה אמור
     * ‏להופיע אצלו כלל.
     */
    console.error(
      `✗ ${PROPERTY_PAGE}: מקטע השותפויות מורכב בלי לבדוק matches.view — הנתיב דורש אותה`,
    );
    failed = true;
  } else if (
    !guard.includes('can(user, "buyers.view_own")') ||
    !guard.includes('can(user, "buyers.view_all")')
  ) {
    /*
     * ‏שני הענפים, ולא אחד: המקטע מבקש שמות של קונים, ולכן הוא
     * ‏מותנה במודול הקונים — ומי שרואה את **כל** הקונים רואה גם
     * ‏את אלה שלו. ענף שיישמט מוציא מהמקטע בדיוק את מי שיש לו
     * ‏יותר גישה, לא פחות.
     *
     * ‏הבדיקה הזו הייתה עד עכשיו גם ב-`verify:layout`, ושם היא
     * ‏נצמדה ל-`property.sharedTabu === true` — כלומר חסמה את
     * ‏המעבר ל-`partnershipApplies`. שני שערים ששואלים על אותו
     * ‏תנאי הם בדיוק הכפילות שהם אמורים למנוע, ולכן התנאי נשאל
     * ‏כאן בלבד; שם נשארה ההכרעה על **המיקום**.
     */
    console.error(`✗ ${PROPERTY_PAGE}: המקטע מורכב בלי שער מודול הקונים`);
    failed = true;
  } else {
    console.log(`✓ ${PROPERTY_PAGE} (מקטע השותפויות)`);
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
/*
 * ‎**וטופס הגיוס הוא הרביעי, וטופס המוכר הוא החמישי** (ביקורת
 * ‏Codex, P1 ואז P1 שוב).
 *
 * ‏טופס הגיוס נבנה מאותו בורר סוגים, ולכן ברגע ש-`shared_tabu` ירד
 * ‏ממנו הוא נשאר בלי שום דרך לרשום את העובדה: שורה חדשה לא יכלה
 * ‏לסמן, ועריכה של שורה ותיקה נפלה לאפשרות הראשונה ומחקה את
 * ‏הסימון בשקט. ההמרה יצרה נכס רגיל — והוא הוצע לקונים שסירבו
 * ‏במפורש.
 *
 * ‏טופס המוכר הציבורי הוא **הטופס היחיד שאדם שאינו מתווך ממלא**,
 * ‏ולכן נשכח פעמיים: כאן ובסכימה שמאחוריו. `IntakeService.draftFor`
 * ‏יוצר ממנו טיוטת נכס שנכנסת להתאמות מיד, וללא השאלה היא נשאה את
 * ‏ברירת המחדל של הטבלה — כלומר **טענה** רישום נפרד — והוצעה
 * ‏לקונים שסירבו למושאע במפורש.
 *
 * ‏הרשימה היא כל הטענה: השדה נוסף לשניים משלושה, ואז לשלושה
 * ‏מארבעה, ואז לארבעה מחמישה. מי שיוסיף טופס שישי ייפול כאן.
 */

/**
 * ‎**שתי צורות, ולא שתי בדיקות מועתקות.**
 *
 * ‏הטפסים הפנימיים נשלחים כ-`FormData` (`name=` בשדה, `f.get` בשליחה),
 * ‏והטופס הציבורי הוא רכיב מבוקר שבונה גוף JSON מ-`useState`. אלה
 * ‏שתי מכניקות אמיתיות, ולכן שני ביטויים — אבל כל אחד מוגדר **פעם
 * ‏אחת** כאן, והרשימה למטה רק אומרת לאיזו צורה כל טופס שייך.
 */
const FORM_SHAPES = {
  formData: {
    asks: /name="sharedTabu"/u,
    sends: /sharedTabu:\s*(?:f|form)\.get\("sharedTabu"\)/u,
  },
  controlled: {
    asks: /setSharedTabu\(/u,
    sends: /\{ sharedTabu \}/u,
  },
};

const PROPERTY_FORMS = [
  { shape: "formData", parts: ["app", "properties", "new", "page.tsx"] },
  { shape: "formData", parts: ["app", "properties", "[id]", "edit", "page.tsx"] },
  { shape: "formData", parts: ["app", "properties", "recruitment", "target-form.tsx"] },
  { shape: "controlled", parts: ["app", "f", "[token]", "seller-form.tsx"] },
];
for (const { shape, parts } of PROPERTY_FORMS) {
  const file = join(import.meta.dirname, "..", "src", ...parts);
  const body = readFileSync(file, "utf8");
  const { asks, sends } = FORM_SHAPES[shape];
  if (!asks.test(body)) {
    console.error(`✗ ${file}: הטופס אינו שואל על רישום משותף`);
    failed = true;
  } else if (!sends.test(body)) {
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

/**
 * ‎**רק מי שעורך שורה קיימת מוסר `keep`** — מסכי היצירה אינם רשאים.
 *
 * ‏טופס הגיוס הוא **גם** יצירה וגם עריכה (רכיב אחד, עם `initial`
 * ‏או בלעדיו), ולכן הוא ברשימה כמותר: שורה ותיקה שנרשמה בסוג
 * ‏הוותיק חייבת להמשיך למצוא אותו בבורר, אחרת שמירה סתמית משנה
 * ‏את הסיווג. את ההסבה עושה התיבה שלידו.
 *
 * ‏הרשימה היא קובץ-אחר-קובץ, ולכן טופס שאינו בה אינו נבדק כלל —
 * ‏וזה בדיוק איך שטופס הגיוס נשאר בחוץ.
 */
const KEEP_USERS = [
  [["app", "properties", "[id]", "edit", "page.tsx"], true],
  [["app", "properties", "recruitment", "target-form.tsx"], true],
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
