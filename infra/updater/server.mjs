/**
 * סוכן העדכון — שירות זעיר שרץ לצד המערכת על השרת עם גישה ל-Docker
 * של המארח (socket). כפתור "עדכן גרסה" במסך ההגדרות גורם ל-API לקרוא
 * לכאן; הסוכן מושך את תמונות האפליקציה העדכניות מה-Registry ומרים
 * אותן מחדש. הוא לעולם לא מעדכן את עצמו (עדכון הסוכן — ידני, נדיר).
 *
 * הסוכן מטפל גם ב**שחזור מגיבוי**: זו פעולה שחייבת לעצור את שירותי
 * האפליקציה ולהריץ pg_restore, ולכן היא לא יכולה לרוץ בתוך ה-API —
 * הוא היה הורג את עצמו באמצע הבקשה. ה-API רק מפעיל ומדווח.
 *
 * אבטחה: מאזין רק ברשת הפנימית של compose; כל בקשה חייבת סוד משותף
 * (UPDATE_SECRET) בהשוואה קבועת-זמן. פעולה אחת בכל רגע (409 למקביל).
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
/** מי נעצר לפני שחזור — כל מי שכותב לנתונים. MinIO נעצר בנוסף,
 *  ורק בשחזור תמונות, כי אז דורסים את ה-volume שלו. */
const RESTORE_STOP = ["api", "web", "workers"];

if (SECRET.length < 24) {
  console.error("UPDATE_SECRET חסר או קצר מדי — הסוכן לא יעלה");
  process.exit(1);
}

const secretMatches = (candidate) => {
  const a = Buffer.from(String(candidate ?? ""));
  const b = Buffer.from(SECRET);
  return a.length === b.length && timingSafeEqual(a, b);
};

const compose = (args, timeoutMs = 10 * 60 * 1000) =>
  new Promise((resolve, reject) => {
    execFile(
      "docker",
      ["compose", "--project-directory", REPO_DIR, "-f", `${REPO_DIR}/docker-compose.prod.yml`, "--env-file", `${REPO_DIR}/${ENV_FILE}`, ...args],
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => (error ? reject(new Error(`${error.message}\n${stderr}`)) : resolve(stdout)),
    );
  });

/**
 * רשימת היתר לשמות גיבוי — זהה ל-packages/shared/src/logic/backup-file.ts
 * ול-infra/backup/restore.sh. משוכפלת בכוונה: הסוכן הוא קובץ ‎.mjs‎ בלי
 * בנייה, ואסור שהשער האחרון לפני שורת הפקודה יסתמך על מודול חיצוני.
 */
const DB_NAME = /^db_\d{4}-\d{2}-\d{2}_\d{4}(?:_[a-z][a-z-]{0,23})?\.dump$/;
const MEDIA_NAME = /^media_\d{4}-\d{2}-\d{2}_\d{4}(?:_[a-z][a-z-]{0,23})?\.tar\.gz$/;
const backupKind = (name) => (DB_NAME.test(name) ? "db" : MEDIA_NAME.test(name) ? "media" : null);

let updating = false;
let restore = { running: false, name: null, startedAt: null, finishedAt: null, ok: null, message: null };

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

/** קריאת גוף JSON קטן — כל מה שגדול מ-4KB הוא ניסיון להעמיס, לא בקשה. */
const readJson = (req) =>
  new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 4096) {
        req.destroy();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });

async function runUpdate() {
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
}

/**
 * שחזור: דאמפ בטיחות ⟵ עצירת שירותי האפליקציה ⟵ שחזור ⟵ הרמה מחדש.
 *
 * ההרמה מחדש נמצאת ב-finally בכוונה — גם שחזור שנכשל חייב להחזיר את
 * המערכת לאוויר. pg_restore רץ בטרנזקציה אחת (restore.sh), ולכן כישלון
 * משאיר את המסד כפי שהיה, וההרמה מחזירה שירות תקין.
 */
async function runRestore(name, kind) {
  restore = { running: true, name, startedAt: new Date().toISOString(), finishedAt: null, ok: null, message: "מתחיל…" };
  try {
    restore.message = "לוקח דאמפ בטיחות של המצב הנוכחי…";
    console.log("[updater] taking pre-restore safety dump…");
    await compose(["run", "--rm", "restore", "safety-dump"], 30 * 60 * 1000);

    restore.message = "עוצר את שירותי האפליקציה…";
    console.log(`[updater] stopping ${RESTORE_STOP.join(", ")}…`);
    await compose(["stop", ...RESTORE_STOP]);
    if (kind === "media") await compose(["stop", "minio"]);

    restore.message = kind === "db" ? "משחזר את מסד הנתונים…" : "משחזר את אחסון התמונות…";
    console.log(`[updater] restoring ${kind} from ${name}…`);
    await compose(["run", "--rm", "restore", kind, name], 60 * 60 * 1000);

    restore.ok = true;
    restore.message = "השחזור הושלם";
    console.log("[updater] restore finished");
  } catch (error) {
    restore.ok = false;
    // ההודעה מוצגת למנהל הפלטפורמה; הפירוט המלא בלוג של הסוכן
    restore.message = "השחזור נכשל — המצב הקודם נשמר. ראו את הלוג של סוכן העדכון";
    console.error(`[updater] restore failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    try {
      // ה-API מריץ מיגרציות בעלייה — כך גיבוי מגרסה ישנה מיושר לסכימה הנוכחית
      console.log("[updater] bringing services back up…");
      if (kind === "media") await compose(["up", "-d", "minio"]);
      await compose(["up", "-d", ...RESTORE_STOP]);
    } catch (error) {
      restore.ok = false;
      restore.message = "השחזור הסתיים אך הרמת השירותים נכשלה — נדרשת התערבות בשרת";
      console.error(`[updater] failed to bring services back: ${error instanceof Error ? error.message : String(error)}`);
    }
    restore.running = false;
    restore.finishedAt = new Date().toISOString();
  }
}

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    json(res, 200, { ok: true, updating, restoring: restore.running });
    return;
  }

  const needsSecret = req.url !== "/health";
  if (needsSecret && !secretMatches(req.headers["x-update-secret"])) {
    res.writeHead(401);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/restore/status") {
    json(res, 200, restore);
    return;
  }

  if (req.method === "POST" && req.url === "/update") {
    if (updating || restore.running) {
      json(res, 409, { error: "operation already running" });
      return;
    }
    updating = true;
    json(res, 202, { status: "started" });
    void runUpdate();
    return;
  }

  if (req.method === "POST" && req.url === "/restore") {
    void (async () => {
      const body = await readJson(req);
      const name = body && typeof body.name === "string" ? body.name : "";
      const kind = backupKind(name);
      if (kind === null) {
        json(res, 400, { error: "invalid backup name" });
        return;
      }
      if (updating || restore.running) {
        json(res, 409, { error: "operation already running" });
        return;
      }
      json(res, 202, { status: "started" });
      void runRestore(name, kind);
    })();
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => console.log(`[updater] listening on :${PORT}`));
