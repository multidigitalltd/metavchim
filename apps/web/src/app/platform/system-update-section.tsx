"use client";

import { useEffect, useState } from "react";
import { Button } from "@metavchim/ui";
import {
  SERVICE_LABEL,
  shortVersion,
  versionAlignment,
  type ServiceKey,
  type ServiceVersion,
} from "@metavchim/shared";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { Notice } from "../notice";

/**
 * ‏תוצאת ריצת עדכון, כפי שהסוכן מדווח — ראו `UpdateRunStatus`
 * ב-`updater-agent.ts`. אותה צורה כמו מצב השחזור והגיבוי.
 *
 * ‎`stage` הוא ההבדל שמכוון את התיקון: כישלון ב-`pull` פירושו ששום
 * ‏שירות לא הוחלף, וכישלון ב-`up` הוא בדיוק המצב שבו חלק עלו וחלק
 * ‏לא — כלומר זה שהטבלה שמעל מדווחת עליו.
 */
interface UpdateRunStatus {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  ok: boolean | null;
  message: string | null;
  stage: "pull" | "up" | null;
}

/*
 * ‎**כמה זמן ממתינים לסוכן ששותק, לפני שאומרים את זה.**
 *
 * ‏שגיאות רשת בזמן עדכון צפויות: `compose up` מרים את ה-API ואת
 * ‏ה-web מחדש, כלומר בדיוק את מי ששואלים. אבל החלון הזה קצר —
 * ‏דקה או שתיים, כולל המיגרציות שה-API מריץ בעלייה.
 *
 * ‏מעבר לו זו כבר אינה הרמה מחדש אלא תקלה (סוד שאינו תואם, סוכן
 * ‏שאינו עולה), וספינר שאינו נגמר הוא אותה שתיקה שהמסך הזה בא
 * ‏לתקן — רק בניסוח חדש. נספרים סבבים ולא זמן, כי קריאת שעון
 * ‏המכשיר אסורה כאן.
 */
const POLL_MS = 4000;
const SILENT_POLLS_LIMIT = 75; /* ‎75 × 4ש׳ = חמש דקות */

interface SystemInfo {
  version: string;
  updateAvailable: boolean;
  /** אופציונלי: שרת ותיק שטרם עודכן אינו מחזיר את השדה. */
  services?: ServiceVersion[];
  /** אופציונלי, מאותה סיבה — שרת שטרם עודכן אינו מדווח דיסק. */
  disk?: DiskInfo;
}

interface DiskInfo {
  /** null = הניטור כבוי או שהנתיב אינו נגיש */
  freeBytes: number | null;
  totalBytes: number | null;
  thresholdBytes: number;
  low: boolean;
}

const GB = 1024 ** 3;
const gb = (bytes: number): string => (bytes / GB).toFixed(1);

/**
 * מצב הדיסק — **מוצג תמיד, לא רק כשהוא נמוך.**
 *
 * „כמה נשאר” הוא מה שמפעיל הפלטפורמה בא לבדוק, ומספר שמופיע רק
 * כשכבר מאוחר אינו ניטור אלא הודעת אבל. כשהוא יורד מתחת לסף הוא
 * מקבל צבע וטקסט פעולה — מה לעשות, לא רק שיש בעיה.
 */
function DiskRow({ disk }: { disk: DiskInfo }) {
  if (disk.freeBytes === null || disk.totalBytes === null) {
    return (
      <p className="mt-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
        ניטור הדיסק אינו פעיל בשרת הזה.
      </p>
    );
  }
  const usedPct = Math.round(((disk.totalBytes - disk.freeBytes) / disk.totalBytes) * 100);
  return (
    <div className="mt-3 border-t pt-3" style={{ borderColor: "var(--color-border)" }}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">מקום בדיסק</span>
        <span
          className="text-sm"
          style={{ color: disk.low ? "var(--color-danger)" : "var(--color-text-muted)" }}
        >
          {gb(disk.freeBytes)}GB פנויים מתוך {gb(disk.totalBytes)}GB ({usedPct}% בשימוש)
        </span>
      </div>
      {disk.low ? (
        <p role="alert" className="mt-2 text-sm" style={{ color: "var(--color-danger)" }}>
          ⚠️ המקום הפנוי ירד מתחת ל-{gb(disk.thresholdBytes)}GB. הריצו{" "}
          <code>docker image prune -f</code> בשרת, או מחקו גיבויים ישנים. כשהדיסק
          נגמר בסיס הנתונים מפסיק לכתוב והגיבוי מדלג בשקט.
        </p>
      ) : null}
    </div>
  );
}

/**
 * גרסת קונטיינר ה-web, מהקונטיינר עצמו.
 *
 * `fetch` רגיל ולא `apiGet`: הכתובת חייבת להיות **המקור של הדף**
 * ולא כתובת ה-API. זו כל הנקודה — אנחנו שואלים את השרת ששלח את
 * הדף הזה איזו גרסה הוא.
 */
async function webVersion(): Promise<string | null> {
  try {
    const res = await fetch("/version", { cache: "no-store" });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (typeof body === "object" && body !== null && "version" in body) {
      const value = (body as { version: unknown }).version;
      return typeof value === "string" ? value : null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * עדכון גרסה — **בעל הפלטפורמה בלבד**.
 *
 * העדכון מרים מחדש את השירות כולו, ולכן הוא חל בבת אחת על כל המשרדים
 * שרצים על השרת. מנהל משרד יחיד לא אמור להחזיק בכפתור כזה; המשתמשים
 * האחרים מקבלים רק את באנר "מה חדש" אחרי שהעדכון כבר עלה.
 */
export function SystemUpdateSection() {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [web, setWeb] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /*
   * ‏מצב ריצת העדכון, כפי שהסוכן מדווח אותו. `null` = לא הפעלנו
   * ‏עדכון במסך הזה; זה אינו „הצליח” ואינו „נכשל”.
   */
  const [run, setRun] = useState<UpdateRunStatus | null>(null);
  const [agentBusy, setAgentBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<SystemInfo>("/platform/system")
      .then(setInfo)
      .catch(() => undefined);
    void webVersion().then(setWeb);
    /*
     * ‎**התשובה חייבת לשרוד את הרענון שהעדכון עצמו גורם.**
     *
     * ‏העדכון מחליף את קונטיינר ה-web, כלומר את הדף הזה. מי שממתין
     * ‏מולו יראה שגיאה ויטען מחדש — ואם המצב יושב רק בזיכרון של
     * ‏הרכיב, „מה עלה בגורל העדכון” נמחק בדיוק ברגע שבו הוא נחוץ.
     * ‏הסוכן הוא קונטיינר נפרד ששורד את ההחלפה, ולכן הוא זוכר.
     *
     * ‎`startedAt === null` = מעולם לא רצה עדכון; אין מה להציג.
     */
    apiGet<UpdateRunStatus>("/platform/system/update/status")
      .then((status) => {
        if (status.startedAt === null) return;
        setRun(status);
        if (status.running) setBusy(true);
      })
      .catch(() => undefined);
  }, []);

  /*
   * ‎**מעקב אחרי העדכון עד שהסוכן אומר שהסתיים.**
   *
   * ‏שגיאות רשת כאן צפויות ולכן נבלעות: העדכון מרים את ה-API ואת
   * ‏ה-web מחדש, כלומר בדיוק הדבר שאנחנו שואלים אותו נעלם לרגע.
   * ‏הסוכן הוא קונטיינר נפרד ששורד את זה, ולכן הוא זה שמחזיק את
   * ‏התשובה — אותו הסדר בדיוק כמו מעקב השחזור.
   *
   * ‏כשהריצה נגמרת נטענות גם הגרסאות מחדש: התשובה על „מה עלה בגורל
   * ‏העדכון” והטבלה שמראה מה רץ בפועל חייבות להתחדש יחד, אחרת המסך
   * ‏אומר „הושלם” מעל טבלה שעדיין מציגה את הישן.
   */
  const updateRunning = run?.running === true;
  useEffect(() => {
    if (!updateRunning) return;
    let alive = true;
    /* ‏סבבים רצופים שבהם לא התקבלה תשובה, והמשפט האחרון שכן התקבל. */
    let silent = 0;
    let lastError: string | null = null;
    const finish = () => {
      setBusy(false);
      apiGet<SystemInfo>("/platform/system").then(setInfo).catch(() => undefined);
      void webVersion().then(setWeb);
    };
    const poll = () => {
      apiGet<UpdateRunStatus>("/platform/system/update/status")
        .then((status) => {
          if (!alive) return;
          silent = 0;
          setRun(status);
          if (!status.running) finish();
        })
        .catch((err: unknown) => {
          if (!alive) return;
          /*
           * ‏הודעת השרת נשמרת רק כשה-API **באמת ענה** — כלומר כשגוף
           * ‏השגיאה היה JSON משלנו. בזמן ההרמה מחדש ה-API מת ושער
           * ‏ה-HTTPS עונה במקומו 502 בלי גוף כזה, וההודעה שנבנית
           * ‏ממנו היא „שגיאה לא צפויה” — משפט שגרוע מהכללי שלנו,
           * ‏כי הוא לא אומר לאן להסתכל.
           */
          lastError =
            err instanceof ApiError && "message" in err.body ? err.message : null;
          silent += 1;
          if (silent < SILENT_POLLS_LIMIT) return;
          setRun({
            running: false,
            startedAt: null,
            finishedAt: null,
            ok: false,
            message:
              lastError ??
              "סוכן העדכון אינו עונה כבר כמה דקות. בדקו בטבלה למעלה איזו גרסה רצה בפועל, ואת הלוג של הסוכן.",
            stage: null,
          });
          finish();
        });
    };
    /* מיד, ולא בעוד ארבע שניות — ההודעה הראשונה צריכה להיות של הסוכן. */
    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [updateRunning]);

  if (!info) return null;

  /*
   * ה-web תמיד ברשימה, גם כשלא ענה — שירות שנעלם מהטבלה נראה כאילו
   * אינו קיים, וזה בדיוק ההפך מהמידע שצריך למסור.
   */
  const ORDER: ServiceKey[] = ["api", "web", "workers"];
  const services: ServiceVersion[] = [
    ...(info.services ?? [{ key: "api", version: info.version }]),
    { key: "web", version: web },
  ];
  services.sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
  const alignment = versionAlignment(services);
  const stateColor =
    alignment.state === "mismatch"
      ? "var(--color-danger)"
      : alignment.state === "aligned"
        ? "var(--color-success)"
        : "var(--color-text-muted)";

  function update(): void {
    if (
      !window.confirm(
        "לעדכן את המערכת לגרסה האחרונה?\n\nהעדכון חל על כל המשרדים במערכת, והשירות יתרענן למשך כדקה.",
      )
    ) {
      return;
    }
    setBusy(true);
    setMessage(null);
    setError(null);
    setRun(null);
    apiPost<{ status: string }>("/platform/system/update", {})
      .then(() => {
        /*
         * ‎**„הופעל” אינו „הצליח”.**
         *
         * ‏עד כה זו הייתה ההודעה האחרונה שהמסך אמר אי פעם: הבקשה
         * ‏יצאה, וזהו. עדכון שנכשל — משיכה שנדחתה, שירות שלא עלה —
         * ‏נראה בדיוק כמו עדכון שהצליח, והסיבה נשארה בלוג של
         * ‏קונטיינר שאיש אינו פותח. עכשיו זו הודעת **ביניים**,
         * ‏והתוצאה מגיעה מהסוכן.
         */
        setRun({
          running: true,
          startedAt: null,
          finishedAt: null,
          ok: null,
          /* ‏`null` בכוונה: המשפט מגיע מהסוכן בשאילתה הראשונה. */
          message: null,
          stage: null,
        });
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : "העדכון נכשל — נסו שוב");
        setBusy(false);
      });
  }

  /**
   * עדכון סוכן העדכון עצמו.
   *
   * הסוכן אינו מתעדכן עם המערכת — הוא מריץ את פקודת ההרמה, ואינו
   * יכול להרים את עצמו בלי להסתכן בהריגת התהליך באמצע. עד כה זו
   * הייתה פקודה שמדביקים ב-SSH; עכשיו הוא מעביר את ההחלפה לקונטיינר
   * עזר חד-פעמי, ומכאן זה כפתור.
   *
   * הוא נשאר **נפרד** מ"עדכן לגרסה האחרונה": כישלון בהחלפת הסוכן
   * לא אמור להפיל עדכון מערכת תקין.
   */
  function updateAgent(): void {
    if (
      !window.confirm(
        "לעדכן את סוכן העדכון?\n\nהסוכן יוחלף תוך כמה שניות. המערכת עצמה אינה מושפעת.",
      )
    ) {
      return;
    }
    setAgentBusy(true);
    setMessage(null);
    setError(null);
    apiPost<{ status: string }>("/platform/system/update-agent", {})
      .then(() => {
        setMessage("סוכן העדכון מתחלף — המתינו כמה שניות ורעננו. המערכת עצמה ממשיכה לרוץ.");
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : "עדכון הסוכן נכשל");
      })
      .finally(() => setAgentBusy(false));
  }

  return (
    <section aria-labelledby="platform-system-heading" className="mb-8">
      <h2 id="platform-system-heading" className="mb-1 text-lg font-semibold">
        גרסת המערכת
      </h2>
      <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
        העדכון חל על כל המשרדים בפלטפורמה בבת אחת. המשתמשים לא צריכים לעשות דבר —
        הם יראו באנר "מה חדש" בכניסה הבאה.
      </p>

      <div
        className="rounded-xl border p-4"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      >
        {/*
          שלוש שורות ולא מספר אחד. שירות שאינו מדווח מקבל שורה משלו
          עם "אינו מדווח" — היעדר מידע נאמר, ולא מוסתר מאחורי הגרסה
          של שירות אחר.
        */}
        <table className="w-full text-sm">
          <caption className="mv-visually-hidden">גרסה מותקנת בכל שירות</caption>
          <tbody>
            {services.map((s) => (
              <tr key={s.key}>
                <th scope="row" className="py-0.5 pe-3 text-start font-normal" style={{ color: "var(--color-text-muted)" }}>
                  {SERVICE_LABEL[s.key]}
                </th>
                <td className="py-0.5">
                  {s.version === null ? (
                    <span style={{ color: "var(--color-text-muted)" }}>אינו מדווח</span>
                  ) : (
                    <code dir="ltr">{shortVersion(s.version)}</code>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-sm" style={{ color: stateColor }} aria-live="polite">
          {alignment.message}
        </p>
        {info.disk ? <DiskRow disk={info.disk} /> : null}
        {info.updateAvailable ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={update} disabled={busy || agentBusy}>
              {busy ? "מעדכן…" : "משוך ועדכן לגרסה האחרונה"}
            </Button>
            {/*
              נפרד ומשני: הסוכן מתעדכן לעיתים רחוקות, ורק כשפעולה
              חדשה מוחזרת ממנו כ-404 ("הסוכן ישן מהמערכת").
            */}
            <Button variant="ghost" onClick={updateAgent} disabled={busy || agentBusy}>
              {agentBusy ? "מחליף…" : "עדכן את סוכן העדכון"}
            </Button>
          </div>
        ) : (
          <p className="mt-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
            עדכון מרחוק זמין רק בסביבת הפרודקשן (ראו docs/10-deployment.md)
          </p>
        )}
        {/*
          ‎**שלושה מצבים לעדכון, ולא שניים.**

          ‏„רץ” אינו „הצליח”, ו„נכשל” הוא הודעה שצריכה להישאר על
          ‏המסך עד שקוראים אותה. הטון נגזר מ-`ok`: `null` בזמן
          ‏שרץ, ואחר כך הצלחה או כישלון — ובשני המקרים המשפט מגיע
          ‏מהסוכן ולא ממה שהמסך מקווה שקרה.

          ‏שעת הסיום נאמרת כי הסוכן זוכר גם ריצה של אתמול: בלעדיה
          ‏„העדכון נכשל” על טעינה טרייה נקרא כאילו זה קרה עכשיו.
        */}
        {run !== null ? (
          <Notice tone={run.ok === null ? "info" : run.ok ? "success" : "danger"}>
            {run.message ?? (run.running ? "העדכון רץ…" : "העדכון הסתיים")}
            {run.ok === true ? " — רעננו את הדף כדי לקבל את הממשק החדש." : null}
            {run.finishedAt !== null ? ` (${formatDateTime(run.finishedAt)})` : null}
          </Notice>
        ) : null}
        {message ? (
          <Notice tone="success">{message}</Notice>
        ) : null}
        {error ? (
          <Notice tone="danger">{error}</Notice>
        ) : null}
      </div>
    </section>
  );
}
