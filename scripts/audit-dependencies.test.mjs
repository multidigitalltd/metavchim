/**
 * ‏הבדיקה של שער התלויות.
 *
 * ‏שער שמבדיל בין „לא הגענו לשרת” ל„נמצאה פגיעות” חייב בדיקה משלו,
 * כי הטעות שלו שקטה בשני הכיוונים: אם הוא יסווג ממצא אמיתי ככשל
 * רשת הוא יעבור על פגיעות, ואם הוא יסווג כשל לא-מוכר ככשל רשת הוא
 * יעבור על כל דבר. שני הכיוונים נבדקים כאן.
 *
 * הבדיקה אינה נוגעת ברשת: `classifyAudit` היא פונקציה טהורה על
 * הפלט, ובדיוק בשביל זה היא הופרדה.
 */

import assert from "node:assert/strict";
import { classifyAudit, blockingCount } from "./audit-dependencies.mjs";

const cases = [];
function check(name, run) {
  try {
    run();
    cases.push({ name, ok: true });
  } catch (err) {
    cases.push({ name, ok: false, err });
  }
}

/** דוח אמיתי, בפורמט ש-`pnpm audit --json` מחזיר. */
function report(vulnerabilities) {
  return JSON.stringify({
    actions: [],
    advisories: {},
    metadata: { vulnerabilities, dependencies: 1, devDependencies: 0, totalDependencies: 1 },
  });
}

const CLEAN = { info: 0, low: 2, moderate: 1, high: 0, critical: 0 };
const DIRTY = { info: 0, low: 0, moderate: 0, high: 1, critical: 0 };

/* ---- דוח שהתקבל ---- */

check("דוח נקי מסווג כדוח, ואין בו חוסמות", () => {
  const result = classifyAudit(report(CLEAN), "");
  assert.equal(result.kind, "report");
  assert.equal(blockingCount(result.report), 0);
});

check("פגיעות high נספרת כחוסמת", () => {
  const result = classifyAudit(report(DIRTY), "");
  assert.equal(result.kind, "report");
  assert.equal(blockingCount(result.report), 1);
});

check("critical נספרת גם היא", () => {
  const result = classifyAudit(report({ ...CLEAN, critical: 2 }), "");
  assert.equal(blockingCount(result.report), 2);
});

check("אזהרת pnpm לפני ה-JSON אינה מונעת את הפירוק", () => {
  const noisy = ` WARN  Issue while reading pnpm-workspace.yaml\n${report(DIRTY)}`;
  const result = classifyAudit(noisy, "");
  assert.equal(result.kind, "report");
  assert.equal(blockingCount(result.report), 1);
});

/* ---- כשל רשת ---- */

check("ERR_SOCKET_TIMEOUT מסווג כרשת ולא כדוח נקי", () => {
  const stderr = [
    " WARN  POST https://registry.npmjs.org/-/npm/v1/security/audits/quick error (ERR_SOCKET_TIMEOUT).",
    " ERR_SOCKET_TIMEOUT  request to https://registry.npmjs.org/-/npm/v1/security/audits/quick failed, reason: Socket timeout",
  ].join("\n");
  assert.equal(classifyAudit("", stderr).kind, "network");
});

check("ENOTFOUND מסווג כרשת", () => {
  assert.equal(classifyAudit("", "FetchError: ... ENOTFOUND registry.npmjs.org").kind, "network");
});

/* ---- מה שאסור להיבלע ---- */

check("שגיאה שאינה מוכרת אינה נחשבת רשת", () => {
  const result = classifyAudit("", "ERR_PNPM_LOCKFILE_BREAKING_CHANGE  Lockfile is broken");
  assert.equal(result.kind, "unknown");
});

check("פלט ריק לגמרי אינו נחשב רשת", () => {
  assert.equal(classifyAudit("", "").kind, "unknown");
});

check("JSON שאינו דוח אינו נקרא כדוח ריק", () => {
  /*
    ‏זה המקרה המסוכן: הודעת שגיאה בפורמט JSON. בלי בדיקת
    ‎`metadata.vulnerabilities` היא הייתה מתפרשת כדוח שאין בו
    פגיעויות — כלומר השער היה עובר בשקט.
  */
  const result = classifyAudit(JSON.stringify({ error: { code: "E500" } }), "");
  assert.notEqual(result.kind, "report");
});

/* ---- תוצאה ---- */

const failed = cases.filter((c) => !c.ok);
for (const c of cases) console.log(`${c.ok ? "✓" : "✗"} ${c.name}`);
if (failed.length > 0) {
  for (const c of failed) console.error(`\n✗ ${c.name}\n${c.err?.message ?? c.err}`);
  process.exit(1);
}
console.log(`\n✓ ${cases.length} בדיקות על סיווג תוצאת הסריקה`);
