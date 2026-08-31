/**
 * כל התראה חייבת לנחות על מסך שקיים.
 *
 * ## הכשל שהשער הזה מונע
 *
 * ‎`ENTITY_ROUTES` ב-`web-push.ts` היא הטבלה שקובעת לאן מובילה
 * לחיצה על התראה — בדפדפן, ובוואטסאפ גם בשורת הקישור וגם בכפתור
 * התבנית. היא **מחרוזות**, ולכן שום טיפוס ושום בדיקת יחידה אינם
 * יודעים אם המסך בצד השני קיים.
 *
 * ומה שקרה בפועל היה שני כשלים שונים, ושניהם שקטים:
 *
 * 1. ‎**נתיב שאינו קיים.** שלוש שורות ייצרו `/offers/<id>`,
 *    ‎`/matches/<id>` ו-`/collaboration/<id>` — לשלוש הישויות יש
 *    מסך רשימה בלבד. הלחיצה נחתה על 404.
 * 2. ‎**ישות שאינה בטבלה כלל.** `coop_deal` נכתבת בשלוש התראות,
 *    ובראשן זו שמבשרת למתווך שהציע שהצד השני אישר. בלי שורה
 *    בטבלה `notificationUrl` מחזירה `"/"`, ו-`formatNotifyMessage`
 *    מדלגת על שורת הקישור בדיוק כשהיא `"/"` — כלומר ההודעה
 *    בוואטסאפ בישרה שנפתח חדר עסקה ולא אמרה איפה הוא.
 *
 * שתי הטענות למטה הן בדיוק שני הכשלים האלה.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const errors = [];

/* ==================== הטבלה עצמה ==================== */

const srcPath = join(root, "packages/shared/src/logic/web-push.ts");
const src = readFileSync(srcPath, "utf8");

/*
 * המפתחות נקראים מהמקור, והכתובות מהבנייה: `ENTITY_ROUTES` אינה
 * מיוצאת, ושכפול הלוגיקה כאן היה שער שעובר גם כשהמקור השתנה.
 */
const table = /const ENTITY_ROUTES[^{]*\{([\s\S]*?)\n\};/u.exec(src);
if (table === null) {
  console.error("✗ לא נמצאה הטבלה ENTITY_ROUTES ב-web-push.ts");
  process.exit(1);
}
const entityTypes = [...table[1].matchAll(/^\s{2}([a-z_]+):/gmu)].map((m) => m[1]);
if (entityTypes.length === 0) {
  console.error("✗ הטבלה ENTITY_ROUTES ריקה — הביטוי שקורא אותה כנראה התיישן");
  process.exit(1);
}

const distPath = join(root, "packages/shared/dist/logic/web-push.js");
if (statSync(distPath).mtimeMs < statSync(srcPath).mtimeMs) {
  console.error("✗ הבנייה של shared ישנה מהמקור — הריצו pnpm build לפני השער");
  process.exit(1);
}
const { notificationUrl } = await import(distPath);

/* ==================== עץ הנתיבים של Next ==================== */

/**
 * כל נתיב שיש לו `page.tsx`, כרשימת מקטעים. מקטע `[x]` תופס כל ערך —
 * זה בדיוק מה שהופך `/buyers/<id>` לתקין ו-`/offers/<id>` ללא.
 */
function routes(dir, prefix = []) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && /^page\.[jt]sx?$/u.test(entry.name)) found.push(prefix);
    // `_` ו-`.` אינם נתיבים אצל Next; `@` הוא חריץ מקביל ולא מסך
    else if (entry.isDirectory() && !/^[_.@]/u.test(entry.name)) {
      found.push(...routes(join(dir, entry.name), [...prefix, entry.name]));
    }
  }
  return found;
}
const appRoutes = routes(join(root, "apps/web/src/app"));

function resolves(path) {
  const segments = path.split("/").filter((s) => s !== "");
  return appRoutes.some(
    (route) =>
      route.length === segments.length &&
      route.every((seg, i) => seg === segments[i] || /^\[.+\]$/u.test(seg)),
  );
}

/* ==================== 1. כל כתובת שהטבלה מייצרת קיימת ==================== */

const note = (entityType, entityId) => ({
  type: "check",
  title: "",
  body: null,
  entityType,
  entityId,
});

for (const entityType of entityTypes) {
  for (const entityId of ["01HQ0000000000000000000001", null]) {
    const url = notificationUrl(note(entityType, entityId));
    /*
     * `"/"` על ישות שכן רשומה פירושו שהבנייה והמקור אינם מדברים על
     * אותה טבלה — כלומר השער היה בודק קוד שאינו רץ.
     */
    if (url === "/") {
      errors.push(`‏${entityType} רשומה בטבלה אבל notificationUrl מחזירה עליה "/"`);
      continue;
    }
    // שאילתה ועוגן אינם חלק מהנתיב שצריך להתקיים
    const path = url.split(/[?#]/u)[0];
    if (!resolves(path)) {
      const withId = entityId === null ? "בלי מזהה" : "עם מזהה";
      errors.push(`‏${entityType} ${withId} מקשרת ל-${url} — אין מסך כזה ב-apps/web/src/app`);
    }
  }
}

/* ==================== 2. כל ישות שנכתבת בהתראה נמצאת בטבלה ==================== */

/**
 * ישויות שנופלות לדשבורד **במודע**: לאף אחת מהן אין מסך שמציג
 * פריט בודד, והמזהה שנשמר אינו של נכס או של לקוח שאפשר לנווט
 * אליו. רשימה מפורשת ולא שתיקה: מי שיוסיף התראה חדשה יידרש
 * להחליט לאן היא מובילה, במקום לגלות אחרי חודשיים שהיא לא מובילה
 * לשום מקום.
 */
const FALLBACK_BY_DESIGN = new Set([
  "credit_batch", // מנת קרדיטים שעומדת לפוג — אין מסך למנה בודדת
  "exclusivity", // המזהה הוא של הבלעדיות ולא של הנכס
  "payout_request", // בקשת משיכה — נצפית ברשימת התשלומים
]);

const sources = [join(root, "apps/api/src"), join(root, "apps/workers/src")];

function tsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFiles(full));
    else if (/\.ts$/u.test(entry.name) && !/\.test\.ts$/u.test(entry.name)) out.push(full);
  }
  return out;
}

/** הערות אינן קוד — ראו את הקורא למטה. */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");
}

const known = new Set(entityTypes);
const written = new Map();
for (const dir of sources) {
  for (const file of tsFiles(dir)) {
    /*
     * ‏בלי הערות: ההסבר שליד השדה מזכיר `entityType: "open"` כדי
     * לספר למה **לא** כותבים אותו, וסורק שקורא הערות היה מדווח על
     * הערך שהתיעוד מזהיר מפניו.
     */
    const text = stripComments(readFileSync(file, "utf8"));
    /*
     * החלון שאחרי `notification.create` ולא כל הקובץ: `entityType`
     * מופיע גם ברישומי הביקורת, ואלה אינם מקשרים לשום מסך.
     */
    for (const match of text.matchAll(/notification\.create(?:Many)?\(/gu)) {
      const window = text.slice(match.index, match.index + 900);
      const entity = /entityType:\s*"([a-z_]+)"/u.exec(window);
      if (entity !== null) written.set(entity[1], file.slice(root.length + 1));
    }
  }
}
if (written.size === 0) {
  errors.push("לא נמצאה אף כתיבת התראה בקוד — הביטוי שסורק אותן כנראה התיישן");
}
for (const [entityType, file] of written) {
  if (known.has(entityType) || FALLBACK_BY_DESIGN.has(entityType)) continue;
  errors.push(
    `‏${entityType} נכתבת כהתראה (${file}) ואינה בטבלה — הלחיצה עליה תנחת בדשבורד`,
  );
}

/* ==================== התוצאה ==================== */

if (errors.length > 0) {
  console.error("✗ יעדי ההתראות:");
  for (const error of errors) console.error(`  • ${error}`);
  process.exit(1);
}
console.log(
  `✓ ${entityTypes.length} ישויות בטבלה נוחתות על מסכים קיימים, ו-${written.size} סוגי התראות מכוסים`,
);
