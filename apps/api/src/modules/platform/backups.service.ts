import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { readFile, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  backupKind,
  isSafeBackupName,
  NEVER_RAN,
  protectedBackupName,
  summarizeBackups,
  type BackupFile,
  type BackupHealth,
  type RestoreDrill,
} from "@metavchim/shared";
import { loadEnv } from "../../config/env";
import { callUpdaterAgent, updaterFailure } from "./updater-agent";

/** מצב הסנכרון החיצוני כפי שקונטיינר ה-offsite כותב אותו. */
export interface OffsiteStatus {
  configured: boolean;
  bucket?: string;
  state?: "ok" | "failed" | "skipped";
  message?: string;
  lastAttemptAt?: string;
  lastSuccessAt?: string | null;
  remoteFiles?: number | null;
  remoteBytes?: number | null;
}

export interface BackupsOverview {
  /** false בפיתוח, או כשתיקיית הגיבויים לא מופתה לקונטיינר. */
  available: boolean;
  files: BackupFile[];
  health: BackupHealth;
  offsite: OffsiteStatus;
  /**
   * תרגיל השחזור האחרון — **הראיה שהגיבוי בר-שחזור.**
   *
   * רשימת קבצים מוכיחה שנכתב משהו, לא שאפשר לשחזר ממנו. הערך כאן
   * מגיע מ-`verify.json` שסקריפט הגיבוי כותב אחרי שהוא משחזר את
   * הדאמפ האחרון למסד זמני וסופר בו טבלאות.
   */
  drill: RestoreDrill;
  /** הדאמפ האחרון של המסד — מוגן ממחיקה מהממשק. */
  protectedName: string | null;
  /** האם סוכן העדכון מוגדר; בלעדיו אין שחזור מהמסך. */
  restoreAvailable: boolean;
}

/** מצב ריצת גיבוי ידני; אין לו שם קובץ — הוא נקבע בזמן ההרצה. */
export interface BackupRunStatus {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  ok: boolean | null;
  message: string | null;
}

export interface RestoreStatus {
  running: boolean;
  name: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  ok: boolean | null;
  message: string | null;
}

/**
 * גיבויים — תצוגה, מחיקה ושחזור ממסך הפלטפורמה.
 *
 * חלוקת האחריות מכוונת: הקריאה והמחיקה נעשות כאן, ישירות על התיקייה
 * הממופה. השחזור — לא. שחזור מחייב עצירה של שירותי האפליקציה, כלומר
 * של התהליך הזה עצמו, ולכן הוא מועבר לסוכן העדכון שרץ לצדנו
 * (infra/updater) ושורד את ההפעלה מחדש.
 */
@Injectable()
export class BackupsService {
  private readonly logger = new Logger(BackupsService.name);

  private get dir(): string {
    return loadEnv().BACKUP_PATH;
  }

  async overview(): Promise<BackupsOverview> {
    const env = loadEnv();
    const files = await this.listFiles();
    const restoreAvailable = env.UPDATER_URL !== undefined && env.UPDATE_SECRET !== undefined;
    return {
      available: files !== null,
      files: files ?? [],
      health: summarizeBackups(files ?? [], new Date()),
      offsite: await this.offsiteStatus(),
      drill: await this.restoreDrill(),
      protectedName: protectedBackupName(files ?? []),
      restoreAvailable,
    };
  }

  /** null = התיקייה לא מופתה (פיתוח); [] = מופתה אך ריקה. */
  private async listFiles(): Promise<BackupFile[] | null> {
    let entries: string[];
    try {
      entries = await readdir(this.dir);
    } catch {
      return null;
    }

    const files: BackupFile[] = [];
    for (const name of entries) {
      const kind = backupKind(name);
      if (kind === null) continue; // קבצים זמניים ‎*.tmp‎ ומה שאינו גיבוי
      try {
        const info = await stat(join(this.dir, name));
        if (!info.isFile()) continue;
        files.push({
          name,
          kind,
          sizeBytes: info.size,
          createdAt: info.mtime.toISOString(),
        });
      } catch {
        // נמחק בין הקריאה ל-stat (ניקוי שמירה) — פשוט לא ברשימה
      }
    }
    files.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return files;
  }

  private async offsiteStatus(): Promise<OffsiteStatus> {
    try {
      const raw = await readFile(join(loadEnv().OFFSITE_STATE_PATH, "status.json"), "utf8");
      const parsed = JSON.parse(raw) as Omit<OffsiteStatus, "configured">;
      return { configured: true, ...parsed };
    } catch {
      // אין קובץ מצב ⇒ פרופיל offsite לא פעיל, או שעוד לא הסתיים מחזור ראשון
      return { configured: false };
    }
  }

  /**
   * מחיקת גיבוי. שני שערים: שם מרשימת ההיתר (חוסם יציאה מהתיקייה),
   * ואיסור על מחיקת הדאמפ האחרון של המסד — כדי שלא תיווצר מצב שבו
   * רצף לחיצות משאיר את המערכת בלי רשת ביטחון מקומית.
   */
  async remove(name: string): Promise<void> {
    if (!isSafeBackupName(name)) throw new BadRequestException("שם קובץ לא חוקי");

    const files = await this.listFiles();
    if (files === null) throw new ServiceUnavailableException("תיקיית הגיבויים אינה זמינה");
    if (!files.some((f) => f.name === name)) throw new NotFoundException("הגיבוי לא נמצא");
    if (protectedBackupName(files) === name) {
      throw new ConflictException(
        "זהו הגיבוי האחרון של מסד הנתונים — לא ניתן למחוק אותו מהממשק",
      );
    }

    await unlink(join(this.dir, name));
    this.logger.warn(`גיבוי נמחק ידנית ממסך הפלטפורמה: ${name}`);
  }

  /** הפעלת שחזור דרך סוכן העדכון. הפעולה אסינכרונית — עוקבים ב-status. */
  async startRestore(name: string): Promise<void> {
    if (!isSafeBackupName(name)) throw new BadRequestException("שם קובץ לא חוקי");

    const files = await this.listFiles();
    if (files === null) throw new ServiceUnavailableException("תיקיית הגיבויים אינה זמינה");
    if (!files.some((f) => f.name === name)) throw new NotFoundException("הגיבוי לא נמצא");

    const res = await this.callAgent("/restore", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.status === 409) throw new ConflictException("פעולה אחרת כבר רצה — המתינו לסיומה");
    if (!res.ok) throw updaterFailure(res);
    this.logger.warn(`שחזור מגיבוי הופעל ממסך הפלטפורמה: ${name}`);
  }

  /**
   * גיבוי ידני — "גבה עכשיו". מריץ את אותו סקריפט של הגיבוי המתוזמן
   * דרך סוכן העדכון, כך שהקובץ שנוצר זהה בפורמט ובשם, ומופיע ברשימה
   * ובשחזור בדיוק כמו גיבוי אוטומטי.
   */
  /**
   * תוצאת תרגיל השחזור. קובץ חסר אינו כשל — הוא "מעולם לא רץ",
   * וההבחנה חשובה: כשל דורש טיפול, והיעדר דורש הפעלה.
   */
  private async restoreDrill(): Promise<RestoreDrill> {
    try {
      const raw = await readFile(join(this.dir, "verify.json"), "utf8");
      return JSON.parse(raw) as RestoreDrill;
    } catch {
      return NEVER_RAN;
    }
  }

  /**
   * הפעלת תרגיל שחזור מיידית.
   *
   * התרגיל רץ מעצמו פעם בשבוע, אבל מבקר שמבקש ראיה לבקרה A.8.13
   * אמור לקבל אותה עכשיו ולא ביום שני. אותו סקריפט בדיוק — כדי
   * שהראיה הידנית והמתוזמנת יהיו אותה בדיקה.
   */
  async startVerify(): Promise<void> {
    const res = await this.callAgent("/verify", { method: "POST" });
    if (res.status === 409) throw new ConflictException("פעולה אחרת כבר רצה — המתינו לסיומה");
    if (!res.ok) throw updaterFailure(res);
    this.logger.log("תרגיל שחזור הופעל ממסך הפלטפורמה");
  }

  async startBackup(): Promise<void> {
    const res = await this.callAgent("/backup", { method: "POST" });
    if (res.status === 409) throw new ConflictException("פעולה אחרת כבר רצה — המתינו לסיומה");
    if (!res.ok) throw updaterFailure(res);
    this.logger.log("גיבוי ידני הופעל ממסך הפלטפורמה");
  }

  async backupStatus(): Promise<BackupRunStatus> {
    const res = await this.callAgent("/backup/status", { method: "GET" });
    if (!res.ok) throw updaterFailure(res);
    return (await res.json()) as BackupRunStatus;
  }

  async restoreStatus(): Promise<RestoreStatus> {
    const res = await this.callAgent("/restore/status", { method: "GET" });
    if (!res.ok) throw updaterFailure(res);
    return (await res.json()) as RestoreStatus;
  }

  private callAgent(path: string, init: RequestInit): Promise<Response> {
    return callUpdaterAgent(path, init);
  }
}
