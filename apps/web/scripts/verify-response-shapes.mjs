/**
 * ‎**מה שהמסך מבקש מול מה שהבקר באמת מחזיר.**
 *
 * ## התקלה שהשער הזה נולד ממנה
 *
 * ‎`apiGet<{ items: OfferRow[] }>("/offers")` הוא **הצהרה על נתיב**,
 * ואיש אינו משווה אותה לבקר. `GET /offers` מחזיר מערך, לא
 * ‎`{ items }`, ולכן `r.items` היה `undefined` — תמיד. המונה „הצעות
 * ממתינות” בדשבורד הראה אפס מאז ומתמיד, ושום דבר לא נראה שבור:
 * ההגנה הישנה (`?? []`) הפכה שדה חסר לרשימה ריקה סבירה למראה.
 *
 * האימות (`apiList`) חשף את זה כתקלת טעינה — אבל בזמן ריצה, אצל
 * המשתמש, כדיווח תקלה. כאן זה נתפס בבנייה.
 *
 * ## למה הקומפיילר ולא ביטויים רגולריים
 *
 * הגרסה הראשונה של השער הזה קראה חתימות בטקסט, ו**שלוש טעויות שלה
 * נתפסו בבדיקת שבירה ולא בקריאה**: ‏`{ id: string }[]` סווג כאובייקט
 * כי נבדקה תחילית לפני סיומת; חיפוש בחלון תווים אחרי `@Get` שייך
 * למסלול את החתימה של מתודה **אחרת**; ו-`@Controller()` בלי ארגומנט
 * נדחה כתחילית חסרה — כלומר בקר ההצעות דולג כולו, **והשער עבר
 * בשלווה על הבאג שנכתב בשבילו**.
 *
 * וגם אחרי שלושת התיקונים נותרו נתיבים שלא נפתרו: `Page<T>`,
 * ‎`ReturnType<Service["m"]>` וכל טיפוס בעל שם. ביניהם שלוש הקריאות
 * המרכזיות של הדשבורד — כלומר הנתיבים שהכי חשוב לבדוק היו בדיוק
 * אלה שהשער לא ידע לקרוא.
 *
 * הקומפיילר פותר את כולם, ואינו מנחש אף אחד.
 */

import { readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";

const ts = createRequire(import.meta.url)("typescript");

const WEB = fileURLToPath(new URL("../src", import.meta.url));
const API = fileURLToPath(new URL("../../api/src", import.meta.url));

const walk = (dir, match, out = []) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, match, out);
    else if (match.test(name)) out.push(path);
  }
  return out;
};

/** תוכנית טיפוסים לחבילה — לפתרון טיפוסים בלבד, בלי בדיקת שגיאות. */
const programFor = (root, files) => {
  const configPath = join(dirname(root), "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config ?? {}, ts.sys, dirname(root));
  return ts.createProgram(files, { ...parsed.options, noEmit: true });
};

/**
 * עטוף, מערך, או `null` כשאין הכרעה.
 *
 * ‎`Promise<X>` נפרם קודם: הבקר מחזיר הבטחה, והמסך מקבל את תוכנה.
 */
const classify = (checker, type, depth = 0) => {
  if (type === undefined || depth > 4) return null;
  if (checker.isArrayType(type) || checker.isTupleType(type)) return "array";
  if (type.symbol?.name === "Promise") {
    return classify(checker, checker.getTypeArguments(type)[0], depth + 1);
  }
  if ((type.flags & ts.TypeFlags.Object) !== 0 && type.getProperties().length > 0) {
    return "object";
  }
  return null;
};

/** הדקורטור המבוקש על צומת, עם הארגומנט המחרוזתי שלו (ריק = ללא). */
const decoratorOf = (node, name) => {
  for (const decorator of ts.getDecorators?.(node) ?? []) {
    const call = decorator.expression;
    if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression)) continue;
    if (call.expression.text !== name) continue;
    const first = call.arguments[0];
    return first !== undefined && ts.isStringLiteral(first) ? first.text : "";
  }
  return null;
};

/* 1 · מה כל נתיב מחזיר, כפי שהקומפיילר פותר אותו */
const apiFiles = walk(API, /\.controller\.ts$/u);
const apiProgram = programFor(API, apiFiles);
const apiChecker = apiProgram.getTypeChecker();

const returns = new Map();
const ambiguous = new Set();
for (const file of apiFiles) {
  const source = apiProgram.getSourceFile(file);
  if (source === undefined) continue;
  ts.forEachChild(source, (node) => {
    if (!ts.isClassDeclaration(node)) return;
    const prefix = decoratorOf(node, "Controller");
    if (prefix === null) return;
    for (const member of node.members) {
      if (!ts.isMethodDeclaration(member)) continue;
      const route = decoratorOf(member, "Get");
      // מסלול עם פרמטר לעולם אינו נקרא כמחרוזת קבועה מהמסך
      if (route === null || route.includes(":")) continue;
      const path = `/${[prefix, route].filter((part) => part !== "").join("/")}`;
      const shape = classify(
        apiChecker,
        apiChecker.getSignatureFromDeclaration(member)?.getReturnType(),
      );
      if (shape === null) continue;
      if (returns.has(path) && returns.get(path) !== shape) ambiguous.add(path);
      returns.set(path, shape);
    }
  });
}

/* 2 · מה המסך מצהיר עליו בכל קריאה */
const webFiles = walk(WEB, /\.tsx?$/u);
const webProgram = programFor(WEB, webFiles);
const webChecker = webProgram.getTypeChecker();

const problems = [];
const unresolved = new Set();
let checked = 0;
for (const file of webFiles) {
  const source = webProgram.getSourceFile(file);
  if (source === undefined) continue;
  const visit = (node) => {
    const typeArgument = node.typeArguments?.[0];
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "apiGet" &&
      typeArgument !== undefined
    ) {
      const literal = node.arguments[0];
      /*
       * רק נתיב קבוע. נתיב שנבנה מתבנית עם משתנה אינו ידוע כאן,
       * וניחוש שלו הוא בדיוק סוג האזהרה שמלמדת להתעלם מהשער.
       */
      const raw =
        literal !== undefined &&
        (ts.isStringLiteral(literal) || ts.isNoSubstitutionTemplateLiteral(literal))
          ? literal.text
          : null;
      if (raw !== null) {
        const path = raw.split("?")[0].replace(/\/$/u, "");
        const want = classify(webChecker, webChecker.getTypeFromTypeNode(typeArgument));
        if (want !== null) {
          if (ambiguous.has(path) || !returns.has(path)) unresolved.add(path);
          else {
            checked += 1;
            const got = returns.get(path);
            if (want !== got) {
              problems.push(
                `${relative(WEB, file)}: ‏${path} — המסך מבקש ${
                  want === "object" ? "אובייקט עטוף" : "מערך"
                } והשרת מחזיר ${got === "object" ? "אובייקט עטוף" : "מערך"}`,
              );
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

if (problems.length > 0) {
  console.error("✗ צורת התשובה שהמסך מצהיר עליה אינה מה שהשרת מחזיר:\n");
  for (const problem of problems) console.error(`  · ${problem}`);
  console.error(
    "\n‎`apiGet<T>` הוא הצהרה ולא ולידציה: שדה שאינו קיים חוזר undefined, והמסך מציג מספר שגוי בלי להיראות שבור.",
  );
  process.exit(1);
}

console.log(
  `✓ ${checked} קריאות הושוו מול טיפוס ההחזרה של הבקר · ${unresolved.size} נתיבים לא נפתרו בבקר ולכן דולגו`,
);
