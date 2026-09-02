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
/**
 * התמונה שמריצה את ההרמה-מחדש של הסוכן עצמו.
 *
 * מוצמדת לגרסה ולא ל-latest: זו הפקודה שמרימה את מה שמרים את הכול,
 * והיום שבו `docker:cli` ישבור תאימות אינו היום שבו רוצים לגלות
 * שהעדכון האחרון השאיר את השרת בלי סוכן.
 */
const CLI_IMAGE = process.env.DOCKER_CLI_IMAGE ?? "docker:27-cli";
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

/** קריאה ישירה ל-Docker (בלי compose) — לקונטיינר העזר של עדכון עצמי. */
const docker = (args, timeoutMs = 5 * 60 * 1000) =>
  new Promise((resolve, reject) => {
    execFile("docker", args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) =>
      error ? reject(new Error(`${error.message}\n${stderr}`)) : resolve(stdout),
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
let selfUpdate = { running: false, startedAt: null, message: null };
let restore = { running: false, name: null, startedAt: null, finishedAt: null, ok: null, message: null };
let backup = { running: false, startedAt: null, finishedAt: null, ok: null, message: null };

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

    /*
     * ניקוי התמונות שהעדכון הזה יתם.
     *
     * כל משיכה של `:latest` משאירה את הקודמת בלי תג, ובקצב פריסה
     * יומי זה כ-1GB ליום שנצבר עד שהדיסק מתמלא ואף אחד לא יודע למה.
     *
     * ‎**בלי `-a`, וזו אינה קפדנות יתר.** על אותו מארח רצים שירותים
     * נוספים; `-a` מוחק כל תמונה שאין לה קונטיינר **קיים**, כלומר
     * גם תמונות של שירות של מישהו אחר שכרגע עצור — והוא לא יעלה
     * בלי משיכה מחדש. בלי הדגל נמחקות רק תמונות יתומות (untagged),
     * וזה בדיוק מה שהעדכון ייצר.
     *
     * כישלון כאן אינו מפיל עדכון תקין — הדיסק יתנקה בפעם הבאה.
     */
    try {
      const freed = await docker(["image", "prune", "-f"]);
      console.log(`[updater] ${freed.trim().split("\n").pop() ?? "ניקוי תמונות הושלם"}`);
    } catch (error) {
      console.warn(`[updater] ניקוי תמונות נכשל (לא קריטי): ${error instanceof Error ? error.message : String(error)}`);
    }
    // התמונה של הסוכן עצמו נמשכת **בנפרד ואחרי** העדכון, ולעולם לא
    // מורמת: הרמה מחדש הורגת את התהליך הזה באמצע פקודת ה-compose
    // ומשאירה את השרת בלי סוכן. הכישלון כאן אינו מפיל את העדכון —
    // עדכון תקין של המערכת חשוב מרענון הסוכן.
    try {
      await compose(["pull", "updater"]);
      console.log('[updater] תמונת הסוכן נמשכה. להשלמה: "עדכן את סוכן העדכון" במסך הפלטפורמה');
    } catch (error) {
      console.warn(`[updater] self-image pull failed (לא קריטי): ${error instanceof Error ? error.message : String(error)}`);
    }
  } catch (error) {
    console.error(`[updater] update failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    updating = false;
  }
}

/**
 * עדכון הסוכן עצמו.
 *
 * הסוכן אינו יכול להרים את עצמו: `docker compose up -d updater` רץ
 * **מתוך** הקונטיינר שהוא עומד להחליף, ואם התהליך נהרג בין "עצור
 * את הישן" ל"הפעל את החדש" — השרת נשאר בלי סוכן, כלומר בלי הדבר
 * שמתקן דברים. עד כה הפתרון היה שתי פקודות שמדביקים ב-SSH.
 *
 * במקום זה: קונטיינר עזר חד-פעמי. הוא מקבל את ה-socket ואת תיקיית
 * הריפו, ממתין רגע כדי שהתשובה הזו תספיק לצאת, ואז מרים את הסוכן.
 * הוא **אינו** הסוכן, ולכן החלפת הסוכן אינה נוגעת בו.
 *
 * `-d` ולא המתנה: `docker run` שהיה מחכה לסיום היה נהרג יחד עם
 * הסוכן, וזה בדיוק המרוץ שהקונטיינר בא למנוע.
 */
async function runSelfUpdate() {
  selfUpdate = { running: true, startedAt: new Date().toISOString(), message: "מושך תמונה חדשה…" };
  try {
    await compose(["pull", "updater"]);

    // התמונה של העזר נמשכת מראש ובנפרד: `docker run` שמושך תוך כדי
    // היה נכשל בשרת בלי גישה ל-Docker Hub אחרי שהסוכן כבר סומן
    // לעדכון, והכישלון היה מתגלה רק בלוג.
    selfUpdate.message = "מכין את קונטיינר העזר…";
    await docker(["pull", CLI_IMAGE]);

    const upCommand = [
      "docker compose",
      `--project-directory ${REPO_DIR}`,
      `-f ${REPO_DIR}/docker-compose.prod.yml`,
      `--env-file ${REPO_DIR}/${ENV_FILE}`,
      "up -d updater",
    ].join(" ");

    selfUpdate.message = "מרים את הסוכן מחדש…";
    await docker([
      "run", "--rm", "-d",
      "-v", "/var/run/docker.sock:/var/run/docker.sock",
      // אותו נתיב מוחלט כמו על המארח — כך compose מוצא את הקבצים
      "-v", `${REPO_DIR}:${REPO_DIR}:ro`,
      "-w", REPO_DIR,
      CLI_IMAGE,
      "sh", "-c", `sleep 3; ${upCommand}`,
    ]);

    // מכאן והלאה התהליך הזה חי על זמן שאול — הקונטיינר יוחלף בעוד
    // שלוש שניות. אין `finally` שמנקה כלום: אין למי.
    selfUpdate.message = "הסוכן מתחלף — רעננו בעוד כמה שניות";
    console.log("[updater] self-update handed off to helper container");
  } catch (error) {
    selfUpdate.running = false;
    selfUpdate.message = "עדכון הסוכן נכשל — ראו את הלוג של סוכן העדכון";
    console.error(`[updater] self-update failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * גיבוי ידני — "גבה עכשיו" ממסך הפלטפורמה.
 *
 * מריץ את אותו `backup_once` של שירות הגיבוי המתוזמן, דרך
 * `run.sh once`. אותו קוד ואותו פורמט קובץ בכוונה: גיבוי ידני
 * שנוצר אחרת היה עלול לא להתאים לזרימת השחזור, וזה בדיוק הרגע
 * שבו מגלים את זה — כשצריך לשחזר.
 *
 * `--no-deps` כדי שלא יגרור הרמה של שירותים; ה-DB כבר רץ.
 */
/**
 * תרגיל שחזור לפי דרישה — משחזר את הגיבוי האחרון למסד זמני ומוחק
 * אותו. אותו `verify.sh` שרץ שבועית מתוך שירות הגיבוי, כדי שראיה
 * ידנית וראיה מתוזמנת יהיו אותה בדיקה בדיוק.
 *
 * חולק את מונה ה-`backup` בכוונה: שתי הפעולות נוגעות באותה תיקייה
 * ובאותו מסד, ואין תרחיש שבו כדאי שירוצו יחד.
 */
async function runVerify() {
  backup = { running: true, startedAt: new Date().toISOString(), finishedAt: null, ok: null, message: "בודק שחזור…" };
  try {
    await compose(["run", "--rm", "--no-deps", "backup", "verify"], 30 * 60 * 1000);
    backup.ok = true;
    backup.message = "תרגיל השחזור הצליח";
    console.log("[updater] restore drill finished");
  } catch (error) {
    // הסקריפט כותב את הסיבה ל-verify.json, והמסך קורא משם — כאן רק
    // מסמנים שהריצה הסתיימה בכשל.
    backup.ok = false;
    backup.message = "תרגיל השחזור נכשל — ראו את פירוט הבדיקה במסך";
    console.error(`[updater] restore drill failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    backup.running = false;
    backup.finishedAt = new Date().toISOString();
  }
}

async function runBackup() {
  backup = { running: true, startedAt: new Date().toISOString(), finishedAt: null, ok: null, message: "מגבה…" };
  try {
    // רק "once" — ה-entrypoint של השירות הוא כבר `/bin/sh /backup/run.sh`,
    // ו-`compose run` מחליף את ה-command בלבד. העברת נתיב הסקריפט כאן
    // הייתה מגיעה כ-$1, הבדיקה `$1 = once` הייתה נכשלת, והקונטיינר היה
    // נכנס ללולאה האינסופית של הגיבוי המתוזמן ותקוע עד ה-timeout.
    // אותה צורה בדיוק כמו `run --rm restore safety-dump`.
    await compose(["run", "--rm", "--no-deps", "backup", "once"], 30 * 60 * 1000);
    backup.ok = true;
    backup.message = "הגיבוי הושלם";
    console.log("[updater] manual backup finished");
  } catch (error) {
    backup.ok = false;
    backup.message = "הגיבוי נכשל — ראו את הלוג של סוכן העדכון";
    console.error(`[updater] manual backup failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    backup.running = false;
    backup.finishedAt = new Date().toISOString();
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

  if (req.method === "GET" && req.url === "/backup/status") {
    json(res, 200, backup);
    return;
  }

  if (req.method === "POST" && req.url === "/verify") {
    if (backup.running || restore.running) {
      json(res, 409, { error: "operation already running" });
      return;
    }
    json(res, 202, { status: "started" });
    void runVerify();
    return;
  }

  if (req.method === "POST" && req.url === "/backup") {
    // שחזור וגיבוי לא רצים יחד: שניהם נוגעים באותה תיקייה, ודאמפ
    // שנכתב בזמן שחזור היה מצלם מצב באמצע
    if (backup.running || restore.running) {
      json(res, 409, { error: "operation already running" });
      return;
    }
    json(res, 202, { status: "started" });
    void runBackup();
    return;
  }

  if (req.method === "GET" && req.url === "/update/self/status") {
    json(res, 200, selfUpdate);
    return;
  }

  if (req.method === "POST" && req.url === "/update/self") {
    // לא בזמן עדכון או שחזור: שניהם מריצים פקודות compose ארוכות,
    // והחלפת הסוכן באמצע הייתה הורגת אותן
    if (updating || restore.running || selfUpdate.running) {
      json(res, 409, { error: "operation already running" });
      return;
    }
    json(res, 202, { status: "started" });
    void runSelfUpdate();
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
