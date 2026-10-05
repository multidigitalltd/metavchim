#!/usr/bin/env node
/**
 * ‏**טוקני העיצוב של הנייד הם עותק של `globals.css` — והשער הזה מוודא
 * ‏שהעותק לא נפרד.**
 *
 * ‏React Native אינו קורא CSS, ולכן `src/theme.ts` מחזיק את הערכים
 * ‏בקוד. עותק שני של טוקן הוא בדיוק מה שהמסמכים מזהירים מפניו: ביום
 * ‏שמתקנים ניגודיות ב-web (וזה קרה כבר שלוש פעמים), הנייד נשאר עם
 * ‏הצבע הישן — ואיש אינו רואה, כי זה מסך אחר.
 *
 * ‏השער קורא את הערכה הבהירה מה-CSS (ההגדרה הראשונה של כל משתנה)
 * ‏ואת הכהה (המיפוי ב-`:root[data-theme="dark"]` אל `--dk-*`/`--dm-*`),
 * ‏ומשווה לכל טוקן בנייד לפי המיפוי שלמטה. טוקן שאין לו מקור ב-CSS
 * ‏הוא גם כשל: צבע שהומצא בנייד אינו חלק מהמערכת.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const themePath = join(here, "..", "src", "theme.ts");
const cssPath = join(here, "..", "..", "web", "src", "app", "globals.css");

/** ‏טוקן בנייד → משתנה ב-CSS. */
const MAP = {
  bg: "--color-bg",
  surface: "--color-surface",
  surfaceSunken: "--color-surface-sunken",
  text: "--color-text",
  textMuted: "--color-text-muted",
  textSoft: "--color-text-soft",
  primary: "--color-primary",
  primaryAccent: "--color-primary-accent",
  primarySoft: "--color-primary-soft",
  action: "--color-action",
  onAction: "--color-on-action",
  danger: "--color-danger",
  dangerSoft: "--color-danger-soft",
  success: "--color-success",
  successSoft: "--color-success-soft",
  warning: "--color-warning",
  warningBg: "--color-warning-bg",
  amberFg: "--domain-amber-fg",
  border: "--color-border",
  inputBorder: "--color-input-border",
  rowBorder: "--color-row-border",
  chipNeutralFg: "--chip-neutral-fg",
  chipNeutralBg: "--chip-neutral-bg",
  tabActive: "--color-tab-active-bg",
};

const theme = readFileSync(themePath, "utf8");
const css = readFileSync(cssPath, "utf8");

/** ‏הטוקנים של בלוק אחד ב-`theme.ts` — מהכותרת ועד הסוגר הראשון שאחריה. */
function tokensOf(header) {
  const start = theme.indexOf(header);
  if (start < 0) return {};
  const end = /^\}( as const)?;/mu.exec(theme.slice(start));
  const block = theme.slice(start, end ? start + end.index : undefined);
  return Object.fromEntries(
    [...block.matchAll(/^\s*(\w+):\s*"(#[0-9a-fA-F]{6})"/gmu)].map((m) => [
      m[1],
      m[2].toLowerCase(),
    ]),
  );
}
const mobile = tokensOf("export const colors");
const mobileDark = tokensOf("export const darkColors");

/**
 * ‏הערכה הכהה: `:root[data-theme="dark"]` ממפה כל `--color-*` ל-`var(--dk-*)`
 * ‏(או `--dm-*`), והערך עצמו יושב בהגדרה של המשתנה הכהה.
 */
const darkBlockStart = css.indexOf(':root[data-theme="dark"]');
const darkBlock =
  darkBlockStart < 0
    ? ""
    : css.slice(darkBlockStart, css.indexOf("\n}", darkBlockStart));
function cssDarkValue(name) {
  const alias = new RegExp(
    String.raw`^\s*${name}:\s*var\((--[\w-]+)\)`,
    "mu",
  ).exec(darkBlock);
  return alias ? cssValue(alias[1]) : null;
}

/** ‏הערכה הבהירה: ההגדרה הראשונה עם ערך hex — ההגדרות הכהות מפנות ל-`var(--dk-…)`. */
function cssValue(name) {
  const match = new RegExp(
    String.raw`^\s*${name}:\s*(#[0-9a-fA-F]{6})\b`,
    "mu",
  ).exec(css);
  return match ? match[1].toLowerCase() : null;
}

const problems = [];
for (const [token, variable] of Object.entries(MAP)) {
  const ours = mobile[token];
  const theirs = cssValue(variable);
  if (ours === undefined) problems.push(`חסר בנייד: ${token}`);
  else if (theirs === null)
    problems.push(`אין מקור ב-CSS: ${variable} (${token})`);
  else if (ours !== theirs)
    problems.push(`${token}: הנייד ${ours}, ה-CSS ${variable} ${theirs}`);
}
for (const token of Object.keys(mobile)) {
  if (!(token in MAP)) problems.push(`טוקן בלי מקור במיפוי: ${token}`);
}
for (const [token, variable] of Object.entries(MAP)) {
  const ours = mobileDark[token];
  const theirs = cssDarkValue(variable);
  if (ours === undefined) problems.push(`חסר בערכה הכהה בנייד: ${token}`);
  else if (theirs === null)
    problems.push(`אין מקור כהה ב-CSS: ${variable} (${token})`);
  else if (ours !== theirs)
    problems.push(`כהה ${token}: הנייד ${ours}, ה-CSS ${variable} ${theirs}`);
}
for (const token of Object.keys(mobileDark)) {
  if (!(token in MAP)) problems.push(`טוקן כהה בלי מקור במיפוי: ${token}`);
}

if (problems.length > 0) {
  console.error("✗ טוקני העיצוב של הנייד נפרדו מ-globals.css:\n");
  for (const problem of problems) console.error(`  ${problem}`);
  console.error("\n  לתקן ב-apps/mobile/src/theme.ts — המקור הוא ה-CSS.");
  process.exit(1);
}

console.log(
  `✓ ${Object.keys(MAP).length} טוקני עיצוב בנייד תואמים ל-globals.css — בערכה הבהירה ובכהה`,
);
