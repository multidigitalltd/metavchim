import { afterEach, describe, expect, it } from "vitest";
import { ServerErrorDigestService, ServerErrorLogger, serverErrors } from "./server-errors";

/**
 * ‎**ספירת השגיאות והסיכום היומי.** הכתיבה עצמה מול Postgres אמיתי —
 * ‏ב-`server-errors.int.test.ts`; כאן: מה נספר, ומתי יוצא מייל.
 */

afterEach(() => {
  serverErrors.drain();
});

/** ‏יומן שקט — סופר בלי להדפיס. */
const quiet = (): ServerErrorLogger => new ServerErrorLogger({ logLevels: [] });

describe("‏היומן סופר כל שגיאה", () => {
  it("‏ההקשר הוא המקור, והחתימה בלי מזהים ומספרים", () => {
    quiet().error("הנכס 01JTENANT0000000000000000A נכשל אחרי 3 ניסיונות", undefined, "RecordingFetchService");
    expect(serverErrors.drain()).toMatchObject([
      { source: "RecordingFetchService", signature: "הנכס <id> נכשל אחרי # ניסיונות", count: 1 },
    ]);
  });

  it("‏אותה תקלה עם מזהים אחרים — שורה אחת עם מונה", () => {
    const logger = quiet();
    logger.error("user 01JTENANT0000000000000000A not found", "stack", "AuthService");
    logger.error("user 01K9ZQ7Y3M4N5P6R8S0T1V2W3X not found", "stack", "AuthService");
    const [bucket, ...rest] = serverErrors.drain();
    expect(rest).toEqual([]);
    expect(bucket?.count).toBe(2);
  });

  it("‏חריגה ולא מחרוזת — ההודעה שלה; ובלי הקשר — הקשר היומן", () => {
    new ServerErrorLogger("Bootstrap", { logLevels: [] }).error(new Error("db down"));
    expect(serverErrors.drain()).toMatchObject([{ source: "Bootstrap", signature: "db down" }]);
  });

  it("‏סערה של שגיאות שונות — המונה חסום, והעודף נספר בשורה אחת", () => {
    const logger = quiet();
    for (let i = 0; i < 250; i += 1) logger.error(`boom`, undefined, `Source${String.fromCharCode(65 + (i % 26))}${i}`);
    const buckets = serverErrors.drain();
    expect(buckets).toHaveLength(201);
    expect(buckets.find((bucket) => bucket.source === "server-errors")?.count).toBe(50);
  });
});

function harness(options: { failWrites?: number; rows?: unknown[]; sent?: number } = {}) {
  const writes: string[] = [];
  let failures = options.failWrites ?? 0;
  const notices: { subject: string }[] = [];
  const prisma = {
    $executeRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      if (sql.includes("INSERT INTO server_errors") && failures > 0) {
        failures -= 1;
        throw new Error("db down");
      }
      writes.push(sql.replace(/\s+/gu, " ").trim());
      return 1;
    },
    $queryRaw: async () => options.rows ?? [],
  };
  const notifier = {
    notify: async (notice: { subject: string }) => {
      notices.push(notice);
      return { sent: options.sent ?? 1, failed: 0 };
    },
  };
  return {
    service: new ServerErrorDigestService(prisma as never, notifier as never),
    writes,
    notices,
  };
}

describe("‏הכתיבה לטבלה", () => {
  it("‏כיבוי מסודר כותב את מה שנספר מאז הכתיבה האחרונה", async () => {
    const { service, writes } = harness();
    quiet().error("boom", undefined, "X");
    await service.beforeApplicationShutdown();
    expect(writes.filter((sql) => sql.startsWith("INSERT INTO server_errors"))).toHaveLength(1);
  });

  it("‏כתיבה שנכשלה מחזירה את הספירה, והבאה כותבת אותה", async () => {
    const { service, writes } = harness({ failWrites: 1 });
    quiet().error("boom", undefined, "X");
    await service.flush();
    expect(writes).toEqual([]);
    await service.flush();
    expect(writes.filter((sql) => sql.startsWith("INSERT INTO server_errors"))).toHaveLength(1);
  });
});

/** ‏08:00 בישראל ב-1.10 — 05:00Z בשעון קיץ. */
const MORNING = new Date("2026-10-01T05:00:00.000Z");
/** ‏06:00 בישראל — לפני שעת הסיכום. */
const DAWN = new Date("2026-10-01T03:00:00.000Z");
const ROW = {
  source: "Sweeps",
  signature: "הסבב recording-fetch נכשל",
  count: 3,
  first_at: new Date("2026-09-30T05:00:00Z"),
  last_at: new Date("2026-09-30T09:00:00Z"),
};

describe("‏הסיכום היומי", () => {
  it("‏לפני 07:00 — רק ניקוי, בלי מייל", async () => {
    const { service, notices, writes } = harness({ rows: [ROW] });
    await service.digest(DAWN);
    expect(notices).toEqual([]);
    expect(writes.some((sql) => sql.startsWith("DELETE FROM server_errors"))).toBe(true);
  });

  it("‏בבוקר, עם שגיאות מאתמול — מייל אחד עם התאריך והסכום", async () => {
    const { service, notices } = harness({ rows: [ROW] });
    await service.digest(MORNING);
    expect(notices.map((notice) => notice.subject)).toEqual(["שגיאות שרת ב-30.9.2026: 3"]);
  });

  it("‏בלי שגיאות — בלי מייל", async () => {
    const { service, notices } = harness({ rows: [] });
    await service.digest(MORNING);
    expect(notices).toEqual([]);
  });

  it("‏מייל שלא הגיע לאיש — השורות משתחררות לסבב הבא", async () => {
    const { service, writes } = harness({ rows: [ROW], sent: 0 });
    await service.digest(MORNING);
    expect(writes.some((sql) => sql.startsWith("UPDATE server_errors SET notified_at = NULL"))).toBe(true);
  });
});
