"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@metavchim/ui";
import {
  summarizeRestoreDrill,
  type BackupFile,
  type BackupHealth,
  type RestoreDrill,
} from "@metavchim/shared";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

/**
 * גיבויים — **בעל הפלטפורמה בלבד**.
 *
 * המסך עונה על שלוש שאלות בזו אחר זו: האם יש גיבוי טרי, האם הוא יושב
 * גם מחוץ לשרת, ומה עושים כשצריך לחזור אחורה. השחזור מוצג אחרון
 * ובאדום בכוונה — הוא מחליף את הנתונים של כל המשרדים יחד.
 */

interface OffsiteStatus {
  configured: boolean;
  bucket?: string;
  state?: "ok" | "failed" | "skipped";
  message?: string;
  lastAttemptAt?: string;
  lastSuccessAt?: string | null;
  remoteFiles?: number | null;
  remoteBytes?: number | null;
}

interface Overview {
  available: boolean;
  files: BackupFile[];
  health: BackupHealth;
  offsite: OffsiteStatus;
  drill: RestoreDrill;
  protectedName: string | null;
  restoreAvailable: boolean;
}

interface RestoreStatus {
  running: boolean;
  name: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  ok: boolean | null;
  message: string | null;
}

const LEVEL_COLOR: Record<BackupHealth["level"], string> = {
  ok: "var(--color-success)",
  warn: "var(--color-warning)",
  danger: "var(--color-danger)",
};

const LEVEL_ICON: Record<BackupHealth["level"], string> = {
  ok: "✓",
  warn: "!",
  danger: "✗",
};

const KIND_LABELS: Record<BackupFile["kind"], string> = {
  db: "מסד נתונים",
  media: "תמונות",
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ב׳`;
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${Math.round(bytes / 1024)} KB`;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

/** מצב ריצת גיבוי ידני; אין לו שם קובץ — הוא נקבע בזמן ההרצה. */
interface BackupRunStatus {
  running: boolean;
  ok: boolean | null;
  message: string | null;
}

export function BackupsSection() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [restore, setRestore] = useState<RestoreStatus | null>(null);
  const [backupRun, setBackupRun] = useState<BackupRunStatus | null>(null);
  // ה-API יורד באמצע השחזור (הסוכן עוצר אותו) — הדגל מבדיל בין
  // "השרת נפל" לבין "זה בדיוק מה שאמור לקרות עכשיו"
  const restoringRef = useRef(false);

  const load = useCallback(() => {
    apiGet<Overview>("/platform/backups")
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 403) return; // לא מנהל פלטפורמה
        if (!restoringRef.current) setError("טעינת הגיבויים נכשלה");
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /* מעקב אחרי שחזור שרץ — עד שהסוכן מדווח שהסתיים. שגיאות רשת בדרך
     צפויות לגמרי: ה-API כבוי בזמן השחזור וחוזר לאוויר בסופו. */
  useEffect(() => {
    if (restore === null || !restore.running) return;
    const timer = setInterval(() => {
      apiGet<RestoreStatus>("/platform/backups/restore/status")
        .then((s) => {
          setRestore(s);
          if (!s.running) {
            restoringRef.current = false;
            load();
          }
        })
        .catch(() => undefined);
    }, 4000);
    return () => clearInterval(timer);
  }, [restore, load]);

  /* מעקב אחרי גיבוי ידני שרץ. בניגוד לשחזור, המערכת נשארת באוויר —
     ולכן שגיאת רשת כאן היא באמת תקלה ולא חלק מהתהליך. */
  useEffect(() => {
    if (backupRun === null || !backupRun.running) return;
    const timer = setInterval(() => {
      apiGet<BackupRunStatus>("/platform/backups/run/status")
        .then((s) => {
          setBackupRun(s);
          if (!s.running) load();
        })
        .catch(() => undefined);
    }, 3000);
    return () => clearInterval(timer);
  }, [backupRun, load]);

  if (data === null) return null;

  /** "גבה עכשיו" — לפני עדכון גרסה, או כדי לא לחכות לגיבוי היומי. */
  async function onBackupNow() {
    setBusy("backup-now");
    setError(null);
    setNotice(null);
    try {
      await apiPost("/platform/backups/run", {});
      setBackupRun({ running: true, ok: null, message: "מגבה…" });
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "הפעלת הגיבוי נכשלה");
    } finally {
      setBusy(null);
    }
  }

  /*
   * תרגיל לפי דרישה. חולק את מחוון `backupRun` עם הגיבוי הידני כי
   * סוכן העדכון מסרב להריץ את שניהם יחד — מחוון נפרד היה מציג "פנוי"
   * בזמן שהשרת מחזיר 409.
   */
  async function onVerifyNow() {
    setBusy("verify-now");
    setError(null);
    setNotice(null);
    try {
      await apiPost("/platform/backups/verify", {});
      setBackupRun({ running: true, ok: null, message: "בודק שחזור…" });
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "הפעלת התרגיל נכשלה");
    } finally {
      setBusy(null);
    }
  }

  async function onDelete(name: string) {
    if (!window.confirm(`למחוק את הגיבוי ${name}?\n\nהפעולה אינה הפיכה בשרת המקומי.`)) return;
    setBusy(name);
    setError(null);
    setNotice(null);
    try {
      await apiPost("/platform/backups/delete", { name });
      setNotice(`הגיבוי ${name} נמחק`);
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "מחיקת הגיבוי נכשלה");
    } finally {
      setBusy(null);
    }
  }

  async function onRestore(file: BackupFile) {
    const what = file.kind === "db" ? "כל נתוני המערכת" : "כל התמונות במערכת";
    const typed = window.prompt(
      `שחזור מ-${file.name}\n\n` +
        `הפעולה תחליף את ${what} בתוכן הגיבוי, לכל המשרדים יחד, ` +
        `והשירות ירד לכמה דקות.\n` +
        `לפני השחזור יישמר אוטומטית דאמפ בטיחות של המצב הנוכחי.\n\n` +
        `כדי לאשר, הקלידו: שחזר`,
    );
    if (typed?.trim() !== "שחזר") return;

    setBusy(file.name);
    setError(null);
    setNotice(null);
    try {
      await apiPost("/platform/backups/restore", { name: file.name });
      restoringRef.current = true;
      setRestore({
        running: true,
        name: file.name,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        ok: null,
        message: "מתחיל…",
      });
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "הפעלת השחזור נכשלה");
    } finally {
      setBusy(null);
    }
  }

  const { health, offsite, drill } = data;
  const drillState = summarizeRestoreDrill(drill, new Date());

  return (
    <section aria-labelledby="platform-backups-heading" className="mb-8">
      <h2 id="platform-backups-heading" className="mb-1 text-lg font-semibold">
        גיבויים
      </h2>
      <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
        גיבוי מסד נתונים כל 24 שעות, ארכיון תמונות בימי ראשון, וסנכרון אוטומטי
        לאחסון מחוץ לשרת כל 6 שעות. שמירה: 14 יום למסד, 28 לתמונות.
      </p>

      {data.available ? (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="mv-btn-action"
            disabled={busy !== null || backupRun?.running === true || restore?.running === true}
            onClick={() => void onBackupNow()}
          >
            {backupRun?.running ? "מגבה…" : "גבה עכשיו"}
          </button>
          <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>
            {backupRun && !backupRun.running && backupRun.ok !== null
              ? backupRun.ok
                ? "✓ הגיבוי הושלם"
                : `✗ ${backupRun.message ?? "הגיבוי נכשל"}`
              : "יוצר גיבוי מיידי — זהה בפורמט לגיבוי האוטומטי"}
          </span>
        </div>
      ) : null}

      {!data.available ? (
        <div
          className="rounded-xl border p-4 text-sm"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-text-muted)" }}
        >
          תיקיית הגיבויים אינה מחוברת לשירות — זמין רק בסביבת הפרודקשן
          (ראו docs/10-deployment.md).
        </div>
      ) : (
        <>
          {/* ---- חיווי ---- */}
          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            <div
              className="rounded-xl border p-4"
              style={{ borderColor: LEVEL_COLOR[health.level], background: "var(--color-surface)" }}
            >
              <p className="font-semibold" style={{ color: LEVEL_COLOR[health.level] }}>
                {LEVEL_ICON[health.level]} גיבוי מקומי
              </p>
              <p className="mt-1 text-sm">{health.message}</p>
              <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
                {health.count} קבצים · {formatSize(health.totalBytes)}
                {health.latestMediaAt ? ` · תמונות: ${formatDateTime(health.latestMediaAt)}` : ""}
              </p>
            </div>

            <div
              className="rounded-xl border p-4"
              style={{
                borderColor: offsite.configured
                  ? offsite.state === "ok"
                    ? "var(--color-success)"
                    : "var(--color-warning)"
                  : "var(--color-border)",
                background: "var(--color-surface)",
              }}
            >
              <p className="font-semibold">
                {offsite.configured ? (offsite.state === "ok" ? "✓" : "!") : "○"} עותק מחוץ לשרת
              </p>
              {offsite.configured ? (
                <>
                  <p className="mt-1 text-sm">{offsite.message}</p>
                  <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
                    {offsite.lastSuccessAt
                      ? `סונכרן: ${formatDateTime(offsite.lastSuccessAt)}`
                      : "עוד לא הושלם סנכרון"}
                    {typeof offsite.remoteFiles === "number"
                      ? ` · ${offsite.remoteFiles} קבצים ביעד`
                      : ""}
                  </p>
                  {offsite.bucket ? (
                    <p className="mt-1 text-sm" dir="ltr" style={{ color: "var(--color-text-muted)" }}>
                      {offsite.bucket}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
                  לא מופעל — הגיבוי יושב רק על השרת הזה. הפעלה: הוסיפו{" "}
                  <code dir="ltr">offsite</code> ל-<code dir="ltr">COMPOSE_PROFILES</code>.
                </p>
              )}
            </div>
            {/*
              תרגיל השחזור. הכרטיס הזה קיים כי רשימת קבצים מוכיחה
              שנכתב משהו — לא שאפשר לשחזר ממנו. ✓ ירוק ישן נקרא כמו
              ביטחון, ולכן החיווי יורד לפי הוותק ולא רק לפי התוצאה.
            */}
            <div
              className="rounded-xl border p-4 sm:col-span-2"
              style={{ borderColor: LEVEL_COLOR[drillState.level], background: "var(--color-surface)" }}
            >
              <div className="flex flex-wrap items-center gap-3">
                <p className="font-semibold" style={{ color: LEVEL_COLOR[drillState.level] }}>
                  {LEVEL_ICON[drillState.level]} תרגיל שחזור
                </p>
                <button
                  type="button"
                  className="mv-btn-plain ms-auto"
                  disabled={busy !== null || backupRun?.running === true || restore?.running === true}
                  onClick={() => void onVerifyNow()}
                >
                  {backupRun?.running ? "רץ…" : "בדוק שחזור עכשיו"}
                </button>
              </div>
              <p className="mt-1 text-sm">{drillState.headline}</p>
              {drill.file ? (
                <p className="mt-1 text-sm" dir="ltr" style={{ color: "var(--color-text-muted)" }}>
                  {drill.file}
                  {drill.durationMs !== null ? ` · ${Math.round(drill.durationMs / 1000)}s` : ""}
                </p>
              ) : null}
              <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
                הגיבוי האחרון משוחזר למסד בדיקה זמני ונמחק אחריו — זו הראיה
                שהגיבוי בר-שחזור, ולא רק שנכתב.
              </p>
            </div>
          </div>

          {/* ---- שחזור פעיל ---- */}
          {restore !== null ? (
            <div
              role="status"
              className="mb-4 rounded-xl border p-4"
              style={{
                borderColor: restore.ok === false ? "var(--color-danger)" : "var(--color-warning)",
                background: "var(--color-surface)",
              }}
            >
              <p className="font-semibold">
                {restore.running ? "שחזור מתבצע…" : restore.ok ? "✓ השחזור הושלם" : "✗ השחזור נכשל"}
              </p>
              <p className="mt-1 text-sm">{restore.message}</p>
              {restore.running ? (
                <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
                  המערכת אינה זמינה למשתמשים בזמן השחזור. אל תסגרו את החלון.
                </p>
              ) : (
                <Button variant="ghost" className="mt-2" onClick={() => setRestore(null)}>
                  סגור
                </Button>
              )}
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="mb-3 text-sm" style={{ color: "var(--color-danger)" }}>
              {error}
            </p>
          ) : null}
          {notice ? (
            <p role="status" className="mb-3 text-sm">
              {notice}
            </p>
          ) : null}

          {/* ---- רשימה ---- */}
          {data.files.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
              אין עדיין קבצי גיבוי.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--color-border)" }}>
              <table className="w-full">
                <caption className="mv-visually-hidden">קבצי הגיבוי בשרת</caption>
                <thead style={{ background: "var(--color-surface)" }}>
                  <tr>
                    <th scope="col" className="p-3 text-start">קובץ</th>
                    <th scope="col" className="p-3 text-start">סוג</th>
                    <th scope="col" className="p-3 text-start">גודל</th>
                    <th scope="col" className="p-3 text-start">נוצר</th>
                    <th scope="col" className="p-3 text-start">
                      <span className="mv-visually-hidden">פעולות</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.files.map((f) => {
                    const isProtected = f.name === data.protectedName;
                    return (
                      <tr key={f.name} className="border-t" style={{ borderColor: "var(--color-border)" }}>
                        <td className="p-3 font-mono text-sm" dir="ltr">
                          {f.name}
                        </td>
                        <td className="p-3">{KIND_LABELS[f.kind]}</td>
                        <td className="p-3">{formatSize(f.sizeBytes)}</td>
                        <td className="p-3">{formatDateTime(f.createdAt)}</td>
                        <td className="p-3">
                          <div className="flex flex-wrap gap-2">
                            {data.restoreAvailable ? (
                              <Button
                                variant="secondary"
                                disabled={busy !== null || restore?.running === true}
                                onClick={() => void onRestore(f)}
                              >
                                שחזר
                              </Button>
                            ) : null}
                            <Button
                              variant="ghost"
                              disabled={busy !== null || isProtected || restore?.running === true}
                              title={
                                isProtected
                                  ? "הגיבוי האחרון של מסד הנתונים מוגן ממחיקה"
                                  : undefined
                              }
                              onClick={() => void onDelete(f.name)}
                            >
                              {isProtected ? "מוגן" : "מחק"}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
