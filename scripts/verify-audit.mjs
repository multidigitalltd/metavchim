#!/usr/bin/env node
/**
 * סריקת תלויות (`pnpm audit`) — עמידה לתקלות של רישום npm.
 *
 * ## למה לא `pnpm audit` ישירות
 *
 * `pnpm audit` שואל את `registry.npmjs.org/-/npm/v1/security/audits/quick`,
 * ונקודת הקצה הזאת נתקעת מדי פעם (שורש הרישום עונה, ה-audit תולה
 * 60 שניות ונכשל ב-`ERR_SOCKET_TIMEOUT`). כשזה קרה, ה-job `verify`
 * כולו — אחרי lint, typecheck, בדיקות, בנייה ושמונה שערים שעברו —
 * נצבע אדום בצעד האחרון, שלוש פעמים על אותו קומיט, ובלי שום קשר
 * לקוד. שער שנופל על תקלה של צד שלישי מלמד להתעלם משערים.
 *
 * ## מה הסקריפט עושה אחרת
 *
 * 1. **מבחין בין שתי תשובות שונות** שעד היום נראו אותו דבר: „יש
 *    פגיעות” (כישלון אמיתי, מיד) ו„הרישום לא ענה” (תקלת רשת — מנסים
 *    שוב, בהמתנה גדלה). ההבחנה לפי הפלט: JSON עם `metadata` הוא
 *    תשובה של הרישום; כל דבר אחר הוא תקלה בדרך אליו.
 * 2. **מנסה שוב** עד `ATTEMPTS` פעמים, עם זמן קצוב ארוך יותר לכל
 *    בקשה. תקלה שנמשכת מעבר לזה היא כישלון — ונאמרת בשמה
 *    („הרישום לא ענה”, לא „נמצאו פגיעות”), כדי שמי שקורא את ה-CI
 *    יידע מה לעשות: להריץ שוב, לא לחפש CVE.
 * 3. **מדפיס את הפגיעות בשמן** — חבילה, חומרה, כותרת וקישור — ולא
 *    רק קוד יציאה.
 *
 * הסף נשאר `high`: פגיעות high ו-critical מפילות, נמוכות מדווחות.
 *
 * ‎`pnpm audit` קורא את `pnpm-lock.yaml` בלבד ואינו צריך
 * ‎`node_modules`, ולכן ה-job שמריץ אותו ב-CI אינו מתקין דבר.
 */
import { spawnSync } from "node:child_process";

/**
 * כמה פעמים לפנות לרישום לפני שמוותרים, וההמתנה ביניהם (שניות,
 * גדלה). ניתנים לדריסה מהסביבה — לבדיקה מקומית מול רישום מת, לא
 * ל-CI: ‎`VERIFY_AUDIT_ATTEMPTS=2 VERIFY_AUDIT_BACKOFF=1,2`.
 */
export const ATTEMPTS = positiveInt(process.env["VERIFY_AUDIT_ATTEMPTS"]) ?? 4;
export const BACKOFF_SECONDS = (
  process.env["VERIFY_AUDIT_BACKOFF"] ?? "30,60,120"
)
  .split(",")
  .map((s) => positiveInt(s.trim()))
  .filter((n) => n !== null);

function positiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}
/** זמן קצוב לבקשה אחת אל הרישום. ברירת המחדל של pnpm — 60 שניות. */
export const FETCH_TIMEOUT_MS = 90_000;
/** החומרות שמפילות את השער. */
export const FAILING_SEVERITIES = new Set(["high", "critical"]);

/**
 * מה אומר פלט של `pnpm audit --json`.
 *
 * - `vulnerable` — הרישום ענה ויש פגיעות מעל הסף.
 * - `clean` — הרישום ענה ואין.
 * - `unreachable` — הרישום לא ענה (או ענה בדבר שאינו דוח).
 *
 * פונקציה טהורה, כדי שאפשר לבדוק אותה בלי רשת.
 */
export function classifyAudit(stdout, stderr, status) {
  const parsed = parseJson(stdout);
  // ‎`--json` מדפיס גם שגיאות כ-JSON: ‎`{ "error": { code, message } }`
  const error = parsed?.error;
  if (error && typeof error === "object") {
    return {
      kind: "unreachable",
      detail: [error.code, error.message]
        .filter((v) => typeof v === "string" && v !== "")
        .join(": "),
    };
  }
  const report =
    parsed !== null && typeof parsed === "object" && "metadata" in parsed
      ? parsed
      : null;
  if (report === null) {
    return {
      kind: "unreachable",
      detail: firstLine(stderr) || firstLine(stdout) || `exit ${status}`,
    };
  }
  const advisories = Object.values(report.advisories ?? {}).filter((a) =>
    FAILING_SEVERITIES.has(String(a.severity)),
  );
  const counts = report.metadata?.vulnerabilities ?? {};
  const failing = (counts.high ?? 0) + (counts.critical ?? 0);
  if (failing > 0 || advisories.length > 0) {
    return {
      kind: "vulnerable",
      counts,
      advisories: advisories.map((a) => ({
        module: String(a.module_name ?? "?"),
        severity: String(a.severity),
        title: String(a.title ?? ""),
        url: String(a.url ?? ""),
        versions: String(a.vulnerable_versions ?? ""),
      })),
    };
  }
  return { kind: "clean", counts };
}

/** ה-JSON שבפלט — או `null` כשאין כזה (פלט ריק, HTML של שגיאת 5xx). */
function parseJson(stdout) {
  const text = String(stdout ?? "").trim();
  // pnpm עשוי להדפיס אזהרות לפני ה-JSON — לוקחים מהסוגר הראשון
  const start = text.indexOf("{");
  if (start < 0) return null;
  try {
    const parsed = JSON.parse(text.slice(start));
    return parsed !== null && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function firstLine(text) {
  return (
    String(text ?? "")
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l !== "" && !l.startsWith("WARN")) ?? ""
  );
}

function runAudit() {
  return spawnSync("pnpm", ["audit", "--audit-level", "high", "--json"], {
    encoding: "utf8",
    env: {
      ...process.env,
      // pnpm קורא את הגדרות npm מהסביבה — זמן קצוב ארוך יותר לבקשה,
      // והניסיונות החוזרים אצלנו ולא אצלו, כדי שההמתנה תגדל
      npm_config_fetch_timeout: String(FETCH_TIMEOUT_MS),
      npm_config_fetch_retries: "1",
    },
  });
}

function sleep(seconds) {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

async function main() {
  let last = null;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const run = runAudit();
    const result = classifyAudit(run.stdout, run.stderr, run.status);

    if (result.kind === "clean") {
      const c = result.counts;
      console.log(
        `✓ סריקת התלויות נקייה מעל הסף — high ${c.high ?? 0} · critical ${c.critical ?? 0}` +
          ` (moderate ${c.moderate ?? 0} · low ${c.low ?? 0} · info ${c.info ?? 0} — מדווחים, לא חוסמים)`,
      );
      return 0;
    }

    if (result.kind === "vulnerable") {
      console.error(
        `✗ פגיעות מעל הסף (high/critical): ${result.advisories.length}`,
      );
      for (const a of result.advisories) {
        console.error(
          `  ${a.severity.padEnd(8)} ${a.module}${a.versions ? ` (${a.versions})` : ""} — ${a.title}${a.url ? `  ${a.url}` : ""}`,
        );
      }
      console.error(
        "::error::פגיעות תלויות מעל הסף — יש לעדכן או לנעול גרסה (ראו pnpm.overrides ב-package.json)",
      );
      return 1;
    }

    last = result.detail;
    const wait = BACKOFF_SECONDS[attempt - 1];
    console.error(`רישום npm לא ענה (ניסיון ${attempt}/${ATTEMPTS}): ${last}`);
    if (wait !== undefined && attempt < ATTEMPTS) {
      console.error(`  ממתינים ${wait} שניות ומנסים שוב…`);
      await sleep(wait);
    }
  }
  console.error(
    `::error::רישום npm לא ענה ל-${ATTEMPTS} ניסיונות — זו תקלת רשת של הרישום, לא פגיעות. להריץ שוב את ה-job כשהרישום חוזר לענות. פרטים: ${last}`,
  );
  return 1;
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  process.exitCode = await main();
}
