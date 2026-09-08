/**
 * ‎**`:latest` של כל השירותים מצביע תמיד על אותו קומיט.**
 *
 * ## הכשל שהשער הזה מונע
 *
 * המערכת רצה בשלושה קונטיינרים (api, web, workers) ועוד סוכן העדכון,
 * וכולם נמשכים כ-`:latest`. כל אחד מהם נבנה ב-job נפרד ומסיים בזמן
 * אחר: בשחרור `2c2fd8e` היה הפרש של ארבע דקות וחצי בין `web` לבין
 * ‎`api`. כשכל job הזיז את `:latest` בעצמו, בחלון הזה `:latest` של
 * ‎`web` הצביע על הקומיט החדש ושל `api` על הקודם — ו„עדכן גרסה”
 * שנלחץ בתוכו משך **חצי שחרור**. התוצאה היא בדיוק מה שמסך העדכון
 * מדווח: שתי גרסאות שונות רצות במקביל.
 *
 * וזה לא נגמר בחלון: אם בניית יעד אחד **נכשלה**, השאר כבר הזיזו את
 * ‎`:latest` והוא נשאר על הקומיט הקודם לצמיתות. משיכה חוזרת הייתה
 * מביאה שוב את אותה תמונה ישנה, כלומר „הריצו עדכון” לא היה מתקן.
 *
 * ## מה נטען כאן
 *
 * 1. שום שלב בנייה אינו דוחף `:latest` — התג של הבנייה הוא הקומיט.
 * 2. יש job שמזיז את `:latest`, והוא תלוי (`needs`) בבנייה.
 * 3. ‎**היעדים בשני המקומות זהים.** זו הטענה שקשה לזכור ידנית: יעד
 *    שנוסף למטריצה ולא ללולאת ההזזה היה נבנה בכל שחרור ו-`:latest`
 *    שלו היה קפוא על הקומיט האחרון שקדם להוספה — בשקט מוחלט.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const workflow = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");

const problems = [];

/** שורות הקובץ בלי הערות — הערה שמצטטת `:latest` אינה דחיפה. */
const code = workflow
  .split("\n")
  .filter((line) => !/^\s*#/u.test(line))
  .join("\n");

/*
 * ‎1 · אף שלב בנייה אינו דוחף `:latest`.
 *
 * הבדיקה על `tags:` של `build-push-action` ולא על המחרוזת בכל מקום:
 * ה-compose מושך `:latest` כדין, וזו בדיוק ההבחנה — מותר למשוך,
 * אסור לדחוף מתוך job של יעד יחיד.
 */
for (const match of code.matchAll(/tags:\s*(\|[\s\S]*?\n(?=\s*[a-z-]+:)|.*)/gu)) {
  if (/:latest/u.test(match[1])) {
    problems.push(
      "שלב בנייה דוחף `:latest` — התג של הבנייה הוא הקומיט בלבד, וההזזה שייכת ל-job המרכז",
    );
  }
}

/* ‎2 · יש job שמזיז, והוא תלוי בבנייה. */
const publish = code.match(/\n {2}publish:\n([\s\S]*?)(?=\n {2}[a-z][\w-]*:\n|$)/u);
if (publish === null) {
  problems.push("אין job בשם `publish` שמזיז את `:latest` אחרי שכל התמונות נבנו");
} else {
  if (!/needs:\s*docker\b/u.test(publish[1])) {
    problems.push(
      "‏`publish` אינו `needs: docker` — בלי זה הוא יכול להזיז `:latest` בזמן שיעד עדיין נבנה",
    );
  }
  if (!/imagetools create/u.test(publish[1])) {
    problems.push("‏`publish` אינו מזיז את התג בפועל (`imagetools create` חסר)");
  }
}

/* ‎3 · אותם יעדים בשני המקומות. */
const matrix = code.match(/matrix:\s*\n\s*target:\s*\[([^\]]*)\]/u);
if (matrix === null) {
  problems.push("לא נמצאה מטריצת היעדים ב-job הבנייה");
}
const loop = publish?.[1].match(/for\s+target\s+in\s+([^;\n]+?)\s*;\s*do/u) ?? null;
if (loop === null) {
  problems.push("לא נמצאה לולאת היעדים ב-`publish`");
}
if (matrix !== null && loop !== null) {
  const built = matrix[1].split(",").map((t) => t.trim()).filter(Boolean);
  const moved = loop[1].split(/\s+/u).filter(Boolean);
  const missing = built.filter((t) => !moved.includes(t));
  const extra = moved.filter((t) => !built.includes(t));
  if (missing.length > 0) {
    problems.push(
      `נבנים אך התג הזז שלהם חסר: ${missing.join(", ")} — \`:latest\` שלהם יישאר על קומיט ישן`,
    );
  }
  if (extra.length > 0) {
    problems.push(
      `‏\`publish\` מזיז יעדים שאינם נבנים: ${extra.join(", ")} — ההזזה תיכשל על תג שאינו קיים`,
    );
  }
}

if (problems.length > 0) {
  console.error("\n✗ שחרור התמונות אינו אטומי בין השירותים:\n");
  for (const problem of problems) console.error(`  • ${problem}`);
  console.error(
    "\nכל השירותים נמשכים כ-`:latest` ומתעדכנים יחד. `:latest` שמצביע על שני קומיטים\nשונים פירושו מערכת שרצה בשתי גרסאות — ראו `packages/shared/src/logic/service-versions.ts`.\n",
  );
  process.exit(1);
}

console.log("✓ `:latest` זז לכל היעדים יחד, ורק אחרי שכולם נבנו");
