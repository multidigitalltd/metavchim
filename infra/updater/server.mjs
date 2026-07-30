/**
 * סוכן העדכון — שירות זעיר שרץ לצד המערכת על השרת עם גישה ל-Docker
 * של המארח (socket). כפתור "עדכן גרסה" במסך ההגדרות גורם ל-API לקרוא
 * לכאן; הסוכן מושך את תמונות האפליקציה העדכניות מה-Registry ומרים
 * אותן מחדש. הוא לעולם לא מעדכן את עצמו (עדכון הסוכן — ידני, נדיר).
 *
 * אבטחה: מאזין רק ברשת הפנימית של compose; כל בקשה חייבת סוד משותף
 * (UPDATE_SECRET) בהשוואה קבועת-זמן. עדכון אחד בכל רגע (409 למקביל).
 */
import { execFile } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const PORT = 9944;
const SECRET = process.env.UPDATE_SECRET ?? "";
const REPO_DIR = process.env.REPO_DIR ?? "/srv/repo";
const ENV_FILE = process.env.ENV_FILE ?? ".env.production";
/** רק שירותי האפליקציה מתעדכנים — לא התשתית ולא הסוכן עצמו. */
const SERVICES = ["api", "web", "workers"];

if (SECRET.length < 24) {
  console.error("UPDATE_SECRET חסר או קצר מדי — הסוכן לא יעלה");
  process.exit(1);
}

const secretMatches = (candidate) => {
  const a = Buffer.from(String(candidate ?? ""));
  const b = Buffer.from(SECRET);
  return a.length === b.length && timingSafeEqual(a, b);
};

const compose = (args) =>
  new Promise((resolve, reject) => {
    execFile(
      "docker",
      ["compose", "--project-directory", REPO_DIR, "-f", `${REPO_DIR}/docker-compose.prod.yml`, "--env-file", `${REPO_DIR}/${ENV_FILE}`, ...args],
      { timeout: 10 * 60 * 1000 },
      (error, stdout, stderr) => (error ? reject(new Error(`${error.message}\n${stderr}`)) : resolve(stdout)),
    );
  });

let updating = false;

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, updating }));
    return;
  }
  if (req.method !== "POST" || req.url !== "/update") {
    res.writeHead(404);
    res.end();
    return;
  }
  if (!secretMatches(req.headers["x-update-secret"])) {
    res.writeHead(401);
    res.end();
    return;
  }
  if (updating) {
    res.writeHead(409, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "update already running" }));
    return;
  }
  updating = true;
  res.writeHead(202, { "content-type": "application/json" });
  res.end(JSON.stringify({ status: "started" }));

  // הרצה ברקע — התשובה כבר נשלחה; התקדמות ותקלות נרשמות ללוג הקונטיינר
  void (async () => {
    try {
      console.log(`[updater] pulling ${SERVICES.join(", ")}…`);
      await compose(["pull", ...SERVICES]);
      console.log("[updater] restarting with new images…");
      await compose(["up", "-d", "--no-deps", ...SERVICES]);
      console.log("[updater] update finished");
    } catch (error) {
      console.error(`[updater] update failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      updating = false;
    }
  })();
});

server.listen(PORT, () => console.log(`[updater] listening on :${PORT}`));
