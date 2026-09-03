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
  /*
   * ‏ההישג השבועי — נופל בכוונה כל עוד מסך המנטור מוסתר. `/mentor`
   * מציג „בקרוב”, והמסך הבנוי מחכה ב-`mentor-screen.tsx` בלי ניתוב;
   * ניתוב ההתראה לשם היה שולח את המנהל לעמוד שאין בו ההישג. ביום
   * שהמסך ייחשף מוסיפים את הישות לשתי המפות ומוציאים אותה מכאן.
   */
  "mentor_achievement",
]);

/**
 * ‎**סוגים שנופלים ל-`system` במכוון.**
 *
 * ‏`system` אינה „ברירת מחדל” אלא הקטגוריה שאי אפשר לכבות, ולכן
 * היא נכונה בדיוק לשני דברים: הודעה תפעולית שאסור לפספס, והודעה
 * שאדם כתב. ארבע אלה נמצאו בזכות השער הזה, והן נשארות כפי שהן —
 * אבל עכשיו כהחלטה רשומה ולא כשתיקה.
 */
const SYSTEM_BY_DESIGN = new Set([
  // הקרדיטים שלך פגים — כסף, ולא נושא שמכבים
  "credits_expiring",
  // הלקוח ענה לתזכורת הסיור — הודעה מאדם, כמו `mentor_feedback`
  "viewing_reminder_reply",
  // מקום בדיסק אוזל — התראה תפעולית למנהלי הפלטפורמה
  "platform_disk_low",
  // שולחן הפלטפורמה שינה חיבור של המשרד — פעולה שנעשתה עליו, לא על ידו
  "integration_platform_change",
]);

function tsFilesIn(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFilesIn(full));
    else if (/\.ts$/u.test(entry.name) && !/\.test\.ts$/u.test(entry.name)) out.push(full);
  }
  return out;
}

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

/* ==================== המפה של הווב ==================== */

/**
 * ‎**שתי מפות ניתוב, ולכן שני מקומות להתפצל — וזה בדיוק מה שקרה.**
 *
 * ‎`ENTITY_ROUTES` בחבילה המשותפת מנתבת את התראת הדחיפה ואת ההודעה
 * בוואטסאפ. ‏`notification-links.ts` בווב מנתבת את **הפעמון ומסך
 * ההתראות**. הן נכתבו בנפרד, ובבדיקה הזו נמצא ששש ישויות היו
 * בראשונה ולא בשנייה — ביניהן `coop_deal`: „הודעה חדשה בחדר עסקה”
 * הובילה לחדר בוואטסאפ, ובפעמון נחתה ברשימת ההתראות (בקשת
 * המשתמש). ‏`shared_lead` היה הפוך — בווב ולא במשותפת.
 *
 * ‏אי אפשר לאחד אותן: לווב יש `needs` (יכולות) שאין לה מקום בהודעת
 * וואטסאפ, ולמשותפת יש מזהים שנבנים אחרת. מה שכן אפשר הוא לדרוש
 * שהן **מכסות את אותן ישויות** — ומי שמוסיף סוג חדש בצד אחד יידע
 * מיד שהשני מחכה.
 */
const webPath = join(root, "apps/web/src/lib/notification-links.ts");
const webSrc = stripComments(readFileSync(webPath, "utf8"));
const webTypes = [...webSrc.matchAll(/case "([a-z_]+)":/gu)].map((m) => m[1]);
if (webTypes.length === 0) {
  errors.push("‏לא נמצאה אף ישות ב-notification-links.ts — הביטוי שקורא אותה התיישן");
}
const onlyShared = entityTypes.filter((t) => !webTypes.includes(t));
const onlyWeb = webTypes.filter((t) => !entityTypes.includes(t));
for (const type of onlyShared) {
  errors.push(
    `‏${type} מנותבת בהתראת הדחיפה ולא בפעמון — הלחיצה בפעמון תנחת ברשימת ההתראות (notification-links.ts)`,
  );
}
for (const type of onlyWeb) {
  errors.push(
    `‏${type} מנותבת בפעמון ולא בהתראת הדחיפה — ההודעה בוואטסאפ תנחת בדשבורד (web-push.ts)`,
  );
}

/**
 * ‎**קבועים מיוצאים שערכם מחרוזת — `type: DEMAND_MATCH_NOTIFICATION_TYPE`.**
 *
 * ‏בלי זה השער רואה רק `type: "..."` מילולי, ומפספס בדיוק את הכתיבות
 * שעברו לקבוע — כולל זו שבגללה הוא נכתב. נבדק במוטציה: הסרת
 * ‎`coop_demand_match` מ-`TYPE_CATEGORY` עברה בשקט עד שהפתרון הזה
 * נוסף.
 */
const stringConstants = new Map();
for (const file of tsFilesIn(join(root, "packages/shared/src"))) {
  for (const match of readFileSync(file, "utf8").matchAll(
    /export const ([A-Z][A-Z0-9_]*)\s*(?::\s*[\w<>[\].| ]+)?=\s*"([a-z_]+)"/gu,
  )) {
    stringConstants.set(match[1], match[2]);
  }
}

/**
 * ‏ערך `type:` — מחרוזת מילולית או קבוע מיוצא. `null` כשאינו ידוע.
 *
 * ‎**נקודה היא תו חוקי בשם סוג.** ‏`task.due` נכתב ב-`apps/workers`,
 * ומחלקת התווים הראשונה כאן דחתה אותו — כלומר השער דילג עליו בשקט,
 * והוא גם לא היה ב-`TYPE_CATEGORY` (ביקורת Codex). שער שמסנן את מה
 * שהוא אמור לבדוק ירוק תמיד.
 */
function typeValue(window) {
  const literal = /\btype:\s*"([a-z_][a-z_.]*)"/u.exec(window);
  if (literal !== null) return literal[1];
  const named = /\btype:\s*([A-Z][A-Z0-9_]*)\b/u.exec(window);
  return named === null ? null : (stringConstants.get(named[1]) ?? null);
}

const known = new Set(entityTypes);
const written = new Map();
/**
 * ‏סוג ההתראה (`type`), להבדיל מהישות שאליה היא מצביעה. שתי
 * הרשימות נאספות באותה סריקה כי הן יושבות באותה כתיבה.
 */
const writtenTypes = new Map();
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
      const kind = typeValue(window);
      if (kind !== null) writtenTypes.set(kind, file.slice(root.length + 1));

      /*
       * ‎**הצורה שהחלון לבדו לא רואה: `createMany({ data: rows })`.**
       *
       * ‏השורות נבנות בלולאה ונכתבות בבת אחת, ולכן `entityType` יושב
       * מאות שורות **לפני** הקריאה. הסורק דיווח „תקין” על התראה
       * שנכתבת עם ישות שאין לה מסלול — כלומר בדיוק הכשל שהוא קיים
       * כדי למנוע, ובצורה שהולכת ונעשית נפוצה ככל שכתיבות מתקבצות.
       *
       * ‏הסריקה נשארת צרה: רק דחיפות אל **המשתנה עצמו** שנמסר
       * ל-`data`, ולא כל `entityType` בקובץ — רישומי הביקורת
       * ממשיכים להיות מחוץ לתמונה.
       */
      const dataVar = /^notification\.create(?:Many)?\(\s*\{\s*data:\s*([A-Za-z_$][\w$]*)\b/u.exec(
        window,
      );
      if (dataVar === null) continue;
      const pushes = new RegExp(
        String.raw`\b${dataVar[1]}\.push\(`,
        "gu",
      );
      for (const push of text.matchAll(pushes)) {
        const block = text.slice(push.index, push.index + 900);
        const pushed = /entityType:\s*"([a-z_]+)"/u.exec(block);
        if (pushed !== null) written.set(pushed[1], file.slice(root.length + 1));
        const pushedType = typeValue(block);
        if (pushedType !== null) writtenTypes.set(pushedType, file.slice(root.length + 1));
      }
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

/* ============ 3. כל סוג התראה שנכתב נמצא ב-TYPE_CATEGORY ============ */

/**
 * ‎**סוג שאינו במפת הקטגוריות אינו ניטרלי — הוא פשוט לא נשלט.**
 *
 * ‏`notifyCategory` נופלת ל-`"system"`, ו-`system` היא הקטגוריה
 * שאי אפשר לכבות. כלומר סוג חדש שנשכח שם אינו „מקבל ברירת מחדל”:
 * הוא **עוקף את העדפות המשתמש** — מי שכיבה „רשת” ממשיך לקבל
 * התראות רשת.
 *
 * ‏זה כבר קרה פעמיים: שישה סוגי הצעות והתאמות (מתועד בהערה בקובץ
 * עצמו), ואז `coop_demand_match` (ביקורת Codex). ההערה שם הזהירה
 * בדיוק מזה; מה שחסר היה שער.
 *
 * ‏אותה רשימת סוגים שכבר נאספה לטענה הקודמת — היא נסרקת מכל כתיבת
 * התראה בקוד, כולל `createMany` דרך משתנה.
 */
const notifyPath = join(root, "packages/shared/src/logic/whatsapp-notify.ts");
const notifySrc = readFileSync(notifyPath, "utf8");
const categoryBlock = /const TYPE_CATEGORY[^{]*\{([\s\S]*?)\n\};/u.exec(notifySrc);
if (categoryBlock === null) {
  errors.push("‏לא נמצאה TYPE_CATEGORY ב-whatsapp-notify.ts — הביטוי שקורא אותה התיישן");
} else {
  /* ‏מפתח עם נקודה נכתב במרכאות — `"task.due": "tasks"` */
  const categorised = new Set(
    [...categoryBlock[1].matchAll(/^\s{2}"?([a-z_][a-z_.]*)"?:/gmu)].map((m) => m[1]),
  );
  if (categorised.size === 0) {
    errors.push("‏TYPE_CATEGORY נקראה ריקה — הביטוי שקורא אותה כנראה התיישן");
  }
  for (const [type, file] of writtenTypes) {
    if (categorised.has(type) || SYSTEM_BY_DESIGN.has(type)) continue;
    errors.push(
      `‏${type} נכתבת כהתראה (${file}) ואינה ב-TYPE_CATEGORY — היא תיפול ל-system, ` +
        "כלומר תעקוף את מי שכיבה את הקטגוריה שלה",
    );
  }
}

/* ==================== 4. עוגן בכתובת מגיע לאלמנט שמורכב ==================== */

/**
 * ‎**כתובת עם `#` — הכשל שהטענה הראשונה כאן לא ראתה.**
 *
 * ‏הטענה הראשונה חותכת `?` ו-`#` לפני שהיא בודקת שהמסך קיים, וזה
 * נכון: `/settings` אכן קיים. אבל `virtual_number` הצביעה על
 * ‎`/settings#virtual-numbers`, ומסך ההגדרות מפוצל ללשוניות — הוא
 * קורא את העוגן, מחפש אותו ב-`HASH_TABS`, ואם אינו שם **אינו מחליף
 * לשונית כלל**. כלומר הכותרת שאליה כיוון העוגן יושבת בלשונית
 * „חיבורים ומודולים” שלא הורכבה, והלוחץ נשאר על לשונית הצוות
 * (ביקורת Codex). הכתובת קיימת, השער היה ירוק, והקישור מת.
 *
 * שתי הדרישות למטה הן שני החלקים שצריכים להתקיים כדי שעוגן יעבוד:
 * שיש אלמנט עם המזהה הזה, ושהלשונית שמכילה אותו נבחרת.
 */
function webFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...webFiles(full));
    else if (/\.tsx?$/u.test(entry.name)) out.push(full);
  }
  return out;
}
const webSources = webFiles(join(root, "apps/web/src")).map((file) => ({
  file: file.slice(root.length + 1),
  text: readFileSync(file, "utf8"),
}));

/** קובץ ה-`page.tsx` שמאחורי נתיב, כדי לקרוא ממנו את `HASH_TABS`. */
function pageFile(path) {
  const segments = path.split("/").filter((s) => s !== "");
  const route = appRoutes.find(
    (candidate) =>
      candidate.length === segments.length &&
      candidate.every((seg, i) => seg === segments[i] || /^\[.+\]$/u.test(seg)),
  );
  if (route === undefined) return null;
  const dir = join(root, "apps/web/src/app", ...route);
  const page = readdirSync(dir).find((name) => /^page\.[jt]sx?$/u.test(name));
  return page === undefined ? null : join(dir, page);
}

/*
 * שני המקורות יחד: הכתובת של הפוש נבנית מהבנייה, וזו של הפעמון היא
 * מחרוזת במקור. עוגן שבור באחת מהן שבור לגמרי — ולכן שתיהן נבדקות
 * באותה טענה, ולא רק זו שבה הכשל נמצא.
 */
const anchored = new Map();
const anchorFound = (url, where) => {
  const sources = anchored.get(url) ?? new Set();
  sources.add(where);
  anchored.set(url, sources);
};
for (const entityType of entityTypes) {
  const url = notificationUrl(note(entityType, "01HQ0000000000000000000001"));
  if (url.includes("#")) anchorFound(url, `web-push.ts (${entityType})`);
}
for (const match of webSrc.matchAll(/href:\s*[`"']([^`"']*#[^`"']+)[`"']/gu)) {
  anchorFound(match[1], "notification-links.ts");
}

for (const [url, sources] of anchored) {
  const where = [...sources].join(", ");
  const [path, anchor] = url.split("#");
  const holder = webSources.find(({ text }) => text.includes(`id="${anchor}"`));
  if (holder === undefined) {
    errors.push(
      `‏${url} (${where}) — אין ב-apps/web/src אלמנט עם id="${anchor}", והגלילה לא תמצא לאן`,
    );
    continue;
  }
  const page = pageFile(path);
  if (page === null) continue;
  const pageSrc = readFileSync(page, "utf8");
  const tabs = /const HASH_TABS[^{]*\{([\s\S]*?)\n\};/u.exec(pageSrc);
  // מסך שאינו מפוצל ללשוניות מרכיב את הכל תמיד — העוגן עובד כמו שהוא
  if (tabs === null) continue;
  const keys = [...tabs[1].matchAll(/^\s{2}"?([a-z][\w-]*)"?:/gmu)].map((m) => m[1]);
  if (keys.length === 0) {
    errors.push("‏לא נקרא אף מפתח מ-HASH_TABS — הביטוי שקורא אותה התיישן");
    continue;
  }
  if (!keys.includes(anchor)) {
    errors.push(
      `‏${url} (${where}) — ‎"${anchor}" אינו ב-HASH_TABS של ${page.slice(root.length + 1)}, ` +
        `ולכן הלשונית שמכילה את ${holder.file} לא תיבחר והלוחץ יישאר בלשונית הראשונה`,
    );
  }
}

/* ==================== התוצאה ==================== */

if (errors.length > 0) {
  console.error("✗ יעדי ההתראות:");
  for (const error of errors) console.error(`  • ${error}`);
  process.exit(1);
}
console.log(
  `✓ ${entityTypes.length} ישויות בטבלה נוחתות על מסכים קיימים, ${written.size} סוגי התראות מכוסים, ושתי מפות הניתוב מסכימות`,
);
