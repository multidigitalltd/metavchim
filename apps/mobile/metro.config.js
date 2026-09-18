/*
 * ‏Metro במונוריפו של pnpm.
 *
 * ‏ברירת המחדל של Metro מחפשת חבילות רק ב-`node_modules` של האפליקציה,
 * ‏ו-`@metavchim/shared` יושבת חבילה-אחות שמקושרת דרך ה-workspace.
 * ‏שורש המאגר נכנס ל-`watchFolders` כדי שהקבצים שלה ייצפו, ותיקיית
 * ‏ה-`node_modules` שבשורש נכנסת לחיפוש כדי שהתלויות שלה (zod) יימצאו.
 *
 * ‏מה שנטען הוא `dist/` של החבילה, כפי ש-`main` שלה מצהיר — ולכן היא
 * ‏חייבת להיבנות לפני Metro, כמו לפני ה-web (ראו README).
 */
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

module.exports = config;
