import assert from "node:assert/strict";
import test from "node:test";
import { classifyAudit } from "./verify-audit.mjs";

const clean = JSON.stringify({
  actions: [],
  advisories: {},
  metadata: {
    vulnerabilities: { info: 0, low: 2, moderate: 1, high: 0, critical: 0 },
  },
});

test("דוח נקי מעל הסף — נקי, גם כשיש low/moderate", () => {
  const r = classifyAudit(clean, "", 0);
  assert.equal(r.kind, "clean");
  assert.equal(r.counts.moderate, 1);
});

test("פגיעות high — כישלון עם שם החבילה, החומרה והקישור", () => {
  const stdout = JSON.stringify({
    advisories: {
      1: {
        module_name: "left-pad",
        severity: "high",
        title: "Prototype pollution",
        url: "https://github.com/advisories/GHSA-x",
        vulnerable_versions: "<1.3.0",
      },
      2: { module_name: "tiny", severity: "low", title: "meh", url: "" },
    },
    metadata: {
      vulnerabilities: { info: 0, low: 1, moderate: 0, high: 1, critical: 0 },
    },
  });
  const r = classifyAudit(stdout, "", 1);
  assert.equal(r.kind, "vulnerable");
  assert.deepEqual(
    r.advisories.map((a) => [a.module, a.severity]),
    [["left-pad", "high"]],
  );
});

test("שגיאת רשת — אינה דוח, ולכן „לא ענה” עם השורה המסבירה", () => {
  const stderr =
    " WARN  POST https://registry.npmjs.org/... error (ERR_SOCKET_TIMEOUT)\n ERR_SOCKET_TIMEOUT  request to https://registry.npmjs.org/-/npm/v1/security/audits/quick failed, reason: Socket timeout\n";
  const r = classifyAudit("", stderr, 1);
  assert.equal(r.kind, "unreachable");
  assert.match(r.detail, /ERR_SOCKET_TIMEOUT/);
  assert.doesNotMatch(r.detail, /^WARN/);
});

test("פלט שאינו JSON (HTML של שגיאת 5xx) — „לא ענה”, לא נקי ולא פגיע", () => {
  const r = classifyAudit("<html>502 Bad Gateway</html>", "", 1);
  assert.equal(r.kind, "unreachable");
});

test("אזהרות לפני ה-JSON אינן שוברות את הפענוח", () => {
  const r = classifyAudit(` WARN  something\n${clean}`, "", 0);
  assert.equal(r.kind, "clean");
});

test("JSON בלי metadata אינו דוח — נופל ל„לא ענה”", () => {
  const r = classifyAudit(JSON.stringify({ error: "rate limited" }), "", 1);
  assert.equal(r.kind, "unreachable");
});

test("שגיאה כ-JSON (כך pnpm --json מדפיס אותה) — „לא ענה” עם הקוד וההודעה", () => {
  const stdout = JSON.stringify({
    error: {
      code: "ERR_SOCKET_TIMEOUT",
      message:
        "request to https://registry.npmjs.org/-/npm/v1/security/audits/quick failed, reason: Socket timeout",
    },
  });
  const r = classifyAudit(stdout, "", 1);
  assert.equal(r.kind, "unreachable");
  assert.equal(
    r.detail,
    "ERR_SOCKET_TIMEOUT: request to https://registry.npmjs.org/-/npm/v1/security/audits/quick failed, reason: Socket timeout",
  );
});
