#!/usr/bin/env node
/**
 * ‎**הסרת כלי ה-CLI של Prisma מעץ פרוס שאינו צריך אותו בזמן ריצה.**
 *
 * ‏‎`@prisma/client` מצהיר על `prisma` ועל `typescript` כ-peer אופציונלי,
 * ‏ו-`pnpm deploy --prod` מתקין אותם יחד איתו — ואיתם המנועים, `effect`
 * ‏ועוד כשלושים חבילות של ה-CLI. ל-Workers הם נחוצים רק כדי לייצר את
 * ‏הקליינט, וזה כבר קרה בשלב הבנייה.
 *
 * ‏מה מוסר **מחושב מהגרף**, לא נכתב ביד: כל חבילה שאפשר להגיע אליה מתלויות
 * ‏הפרודקשן של השירות רק דרך ה-peers האלה. חבילה שגם תלות אחרת צריכה —
 * ‏נשארת. ובסוף העץ נבדק: כל תלות ישירה נטענת, והקליינט נבנה.
 *
 * ‏שימוש: node prune-prisma-cli.mjs <workspace-filter> <deployed-dir>
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const [filter, deployed] = process.argv.slice(2);
if (!filter || !deployed) {
  console.error("usage: prune-prisma-cli.mjs <workspace-filter> <deployed-dir>");
  process.exit(2);
}

const tree = JSON.parse(
  execFileSync("pnpm", ["--filter", filter, "list", "--prod", "--depth", "Infinity", "--json"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }),
)[0];

const OPTIONAL_PEERS = new Set(["prisma", "typescript"]);
/* ‏מה שהשירות מצהיר עליו בעצמו. peer שהותקן אוטומטית ומופיע בשורש
   הרשימה (תלוי בגרסת pnpm) אינו תלות של השירות. */
const declared = new Set(
  Object.keys(JSON.parse(readFileSync(join(deployed, "package.json"), "utf8")).dependencies ?? {}),
);

/** ‏כל החבילות שאפשר להגיע אליהן; עם `skipPeers` — בלי ה-peers של הקליינט. */
function reachable(skipPeers) {
  const seen = new Set();
  const walk = (node, parent) => {
    for (const [name, info] of Object.entries(node.dependencies ?? {})) {
      const peer =
        OPTIONAL_PEERS.has(name) &&
        (parent === "@prisma/client" || (parent === null && !declared.has(name)));
      if (skipPeers && peer) continue;
      const key = `${name}@${info.version}`;
      if (seen.has(key)) continue;
      seen.add(key);
      walk(info, name);
    }
  };
  walk(tree, null);
  return seen;
}

const needed = reachable(true);
const prune = [...reachable(false)].filter((key) => !needed.has(key));

const store = join(deployed, "node_modules", ".pnpm");
const dirs = readdirSync(store);
let removed = 0;
for (const key of prune) {
  const at = key.lastIndexOf("@");
  const prefix = `${key.slice(0, at).replace("/", "+")}@${key.slice(at + 1)}`;
  for (const dir of dirs.filter((d) => d === prefix || d.startsWith(`${prefix}_`))) {
    rmSync(join(store, dir), { recursive: true, force: true });
    removed += 1;
  }
}
console.log(`[prune] ${removed} תיקיות של ה-CLI הוסרו (${prune.length} חבילות)`);

/* ‏ה-CLI עצמו חייב להיעלם. אחרת הבנייה עוברת בשקט עם תמונה שמנה */
const left = readdirSync(store).filter((dir) => dir.startsWith("prisma@"));
if (left.length > 0) {
  console.error(`[prune] ✗ ה-CLI של Prisma נשאר בעץ: ${left.join(", ")}`);
  process.exit(1);
}

/* ‏הבדיקה: כל תלות ישירה נטענת, והקליינט שנוצר נבנה — בלי להתחבר */
execFileSync(
  process.execPath,
  [
    "-e",
    `for (const m of Object.keys(require("./package.json").dependencies)) require(m);
     new (require("@prisma/client").PrismaClient)();`,
  ],
  { cwd: deployed, stdio: "inherit" },
);
console.log("[prune] התלויות נטענות והקליינט נבנה");
