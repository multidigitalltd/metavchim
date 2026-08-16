import { describe, expect, it } from "vitest";
import {
  DRILL_DANGER_DAYS,
  DRILL_WARN_DAYS,
  NEVER_RAN,
  summarizeRestoreDrill,
  type RestoreDrill,
} from "./restore-drill.js";

const NOW = new Date("2026-08-16T12:00:00Z");
const daysAgo = (n: number): string => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const ok = (over: Partial<RestoreDrill> = {}): RestoreDrill => ({
  state: "ok",
  at: daysAgo(1),
  file: "db_2026-08-15_0300.dump",
  tables: 48,
  tenants: 2,
  durationMs: 4200,
  message: "שוחזר בהצלחה",
  ...over,
});

describe("summarizeRestoreDrill", () => {
  it("מעולם לא רץ אינו 'תקין' — הוא היעדר ידיעה", () => {
    const out = summarizeRestoreDrill(NEVER_RAN, NOW);
    expect(out.level).toBe("warn");
    expect(out.ageDays).toBeNull();
    expect(out.headline).toContain("מעולם לא רץ");
  });

  it("תרגיל טרי שהצליח — תקין, עם המספרים שמוכיחים שגם הנתונים שרדו", () => {
    const out = summarizeRestoreDrill(ok(), NOW);
    expect(out.level).toBe("ok");
    expect(out.ageDays).toBe(1);
    expect(out.headline).toContain("48 טבלאות");
    expect(out.headline).toContain("2 משרדים");
  });

  it("כשל הוא המצב הדחוף, גם אם הוא מאתמול", () => {
    const out = summarizeRestoreDrill(ok({ state: "failed", message: "pg_restore יצא בשגיאה" }), NOW);
    expect(out.level).toBe("danger");
    expect(out.headline).toContain("pg_restore יצא בשגיאה");
  });

  it("הצלחה ישנה יורדת לאזהרה — התרגיל השבועי כנראה אינו רץ", () => {
    const out = summarizeRestoreDrill(ok({ at: daysAgo(DRILL_WARN_DAYS) }), NOW);
    expect(out.level).toBe("warn");
    expect(out.headline).toContain("אינו רץ");
  });

  it("הצלחה ישנה מאוד היא סכנה — היא אינה מעידה על הגיבוי הנוכחי", () => {
    const out = summarizeRestoreDrill(ok({ at: daysAgo(DRILL_DANGER_DAYS) }), NOW);
    expect(out.level).toBe("danger");
    expect(out.headline).toContain("ישן מכדי");
  });

  it("יום לפני הסף עדיין תקין — הגבול נבדק ולא מונח", () => {
    expect(summarizeRestoreDrill(ok({ at: daysAgo(DRILL_WARN_DAYS - 1) }), NOW).level).toBe("ok");
    expect(summarizeRestoreDrill(ok({ at: daysAgo(DRILL_DANGER_DAYS - 1) }), NOW).level).toBe("warn");
  });

  it("תרגיל של היום נאמר במילים ולא כ'לפני 0 ימים'", () => {
    const out = summarizeRestoreDrill(ok({ at: daysAgo(0) }), NOW);
    expect(out.headline).toContain("היום");
    expect(out.headline).not.toContain("0 ימים");
  });
});
