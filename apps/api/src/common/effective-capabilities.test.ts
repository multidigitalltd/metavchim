import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { effectiveCapabilities } from "@metavchim/shared";
import { SettingsController } from "../modules/settings/settings.controller";
import { TenantContext } from "./tenant-context";

/**
 * ‎**„מי רשאי למה” — ניסוח אחד, ולא חמישה.**
 *
 * ## ‏מה זה שומר
 *
 * ‏היכולות בפועל הן שלוש שכבות: התפקיד, חריגי המנהל, וחסימות
 * ‏המודולים של המשרד. הצירוף הזה נדרש בחמישה מקומות — כניסה
 * ‏למערכת, העוזר שבוואטסאפ, שער ההתראות, סבב ההתראות של העובד,
 * ‏ומסך ההרשאות — וכל אחד מהם החזיק עותק משלו.
 *
 * ‏ואחד מהם כבר היה שגוי: מסך ההרשאות הציג „היכולות בפועל” בלי
 * ‏שכבת החסימות, כלומר אמר למנהל שלסוכן יש יכולת שהפלטפורמה חסמה
 * ‏למשרד. מסך שכל תפקידו לענות על השאלה הזו ענה עליה לא נכון.
 *
 * ## ‏ולמה זה קריטי דווקא בעוזר ה-AI
 *
 * ‏העוזר רץ **כמשתמש שהפעיל אותו** — אין לו תפקיד משלו, אין לו
 * ‏קבוצת יכולות משלו, ואין לו מסלול נתונים משלו. הקבוצה הזו היא כל
 * ‏מה שמפריד בינו לבין הנתונים של סוכן אחר או של משרד אחר, ולכן
 * ‏עותק שנפרד שם הוא עוזר שרואה יותר מהאדם ששאל אותו.
 */

const API_SRC = new URL("..", import.meta.url).pathname;
const WORKERS_SRC = new URL("../../../workers/src", import.meta.url).pathname;

function sourceFiles(dir: string, prefix = ""): { name: string; code: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(join(dir, entry.name), rel);
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) return [];
    return [{ name: rel, code: readFileSync(join(dir, entry.name), "utf8") }];
  });
}

const FILES = [...sourceFiles(API_SRC), ...sourceFiles(WORKERS_SRC)];

describe("שער: שלוש השכבות נבנות במקום אחד", () => {
  it("יש מה לבדוק", () => {
    expect(FILES.length).toBeGreaterThan(200);
    expect(FILES.some((f) => /\beffectiveCapabilities\s*\(/u.test(f.code))).toBe(true);
  });

  /*
   * ‎`applyBlockedModules` היא השכבה השלישית, והיא נבלעת בשקט: מי
   * ‏שמרכיב את השתיים הראשונות ושוכח אותה מקבל קבוצה **רחבה מדי**,
   * ‏בלי שגיאה ובלי טיפוס שונה. לכן הגבול הוא על השם עצמו.
   */
  it("אף קורא אינו מרכיב את השכבות בעצמו", () => {
    const rebuilders = FILES.filter(
      (file) =>
        /\bapplyBlockedModules\s*\(/u.test(file.code) ||
        /\bresolveCapabilities\s*\(/u.test(file.code),
    ).map((file) => file.name);
    expect(
      rebuilders,
      `בנו את היכולות ידנית במקום דרך effectiveCapabilities: ${rebuilders.join(", ")}`,
    ).toEqual([]);
  });
});

describe("הפונקציה עצמה — שלוש השכבות, בסדר הזה", () => {
  const now = new Date("2026-09-06T12:00:00Z");

  it("התפקיד לבדו", () => {
    const caps = effectiveCapabilities(
      { role: "agent", overrides: [], blockedModules: [] },
      now,
    );
    expect(caps.has("properties.view")).toBe(true);
    expect(caps.has("users.manage")).toBe(false);
  });

  it("וחריג של המנהל מעליו — לשני הכיוונים", () => {
    const granted = effectiveCapabilities(
      {
        role: "agent",
        overrides: [{ capability: "audit.view", effect: "grant", expiresAt: null }],
        blockedModules: [],
      },
      now,
    );
    expect(granted.has("audit.view")).toBe(true);

    const denied = effectiveCapabilities(
      {
        role: "agent",
        overrides: [{ capability: "properties.view", effect: "deny", expiresAt: null }],
        blockedModules: [],
      },
      now,
    );
    expect(denied.has("properties.view")).toBe(false);
  });

  /* ‏חריג שפג אינו חל — הסינון בקריאה ולא בעבודת ניקוי */
  it("וחריג שפג אינו חל", () => {
    const caps = effectiveCapabilities(
      {
        role: "agent",
        overrides: [
          { capability: "audit.view", effect: "grant", expiresAt: new Date("2026-09-01T00:00:00Z") },
        ],
        blockedModules: [],
      },
      now,
    );
    expect(caps.has("audit.view")).toBe(false);
  });

  /*
   * ‎**וזו השכבה שנשכחה במסך ההרשאות.** היא מוחלת אחרונה, ובכוונה:
   * ‏חריג `grant` של מנהל המשרד אינו יכול לפתוח מודול שהפלטפורמה
   * ‏חסמה — אחרת החסימה אינה חסימה.
   */
  it("וחסימת המשרד גוברת גם על חריג שהעניק במפורש", () => {
    const caps = effectiveCapabilities(
      {
        role: "owner",
        overrides: [{ capability: "properties.view", effect: "grant", expiresAt: null }],
        blockedModules: ["properties"],
      },
      now,
    );
    expect(caps.has("properties.view")).toBe(false);
  });

  /* ‏ערך `effect` שאינו „grant” שולל, ולעולם אינו מוסיף בטעות */
  it("ו-effect לא מוכר שולל ואינו מעניק", () => {
    const caps = effectiveCapabilities(
      {
        role: "agent",
        overrides: [{ capability: "properties.view", effect: "מה?", expiresAt: null }],
        blockedModules: [],
      },
      now,
    );
    expect(caps.has("properties.view")).toBe(false);
  });
});

/**
 * ‎**והמסך שכבר היה שגוי — בהתנהגות.**
 *
 * ‏„היכולות בפועל” הוא מה שמנהל המשרד קורא כדי להחליט מה לסוכן
 * ‏מותר. הוא הוצג בלי שכבת חסימות המודולים, ולכן הראה כפעילה יכולת
 * ‏שהפלטפורמה חסמה למשרד — תשובה שגויה במסך שכל תפקידו לענות
 * ‏עליה נכון.
 */
describe("מסך ההרשאות מציג את היכולות בפועל", () => {
  function controllerFor(blockedModules: string[]): SettingsController {
    const controller = Object.create(SettingsController.prototype) as Record<string, unknown>;
    controller["prisma"] = {
      user: {
        findFirst: async () => ({
          id: "01TARGET",
          name: "סוכן",
          role: "agent",
          tenant: { blockedModules },
        }),
      },
      withTenant: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
        fn({ userCapability: { findMany: async () => [] } }),
    };
    return controller as SettingsController;
  }

  function asManager<T>(fn: () => T): T {
    return TenantContext.run(
      {
        tenantId: "01TENANT",
        userId: "01MANAGER",
        capabilities: new Set(["users.manage"] as const),
        billingOnly: false,
      },
      fn,
    );
  }

  it("בלי חסימה — מודול הנכסים מופיע", async () => {
    const dto = await asManager(() => controllerFor([]).userCapabilities("01TARGET"));
    expect(dto.effective).toContain("properties.view");
  });

  it("ועם חסימת המשרד הוא אינו מופיע", async () => {
    const dto = await asManager(() => controllerFor(["properties"]).userCapabilities("01TARGET"));
    expect(dto.effective).not.toContain("properties.view");
  });

  /*
   * ‎**וגם *למה* היא חסרה, ולא רק שהיא חסרה.**
   *
   * ‏שתי שכבות מורידות יכולת מ-`effective`: חריג של מנהל המשרד,
   * ‏וחסימת מודול של הפלטפורמה. בלי להבחין ביניהן המסך הציע „הענק”
   * ‏גם על השנייה — כפתור שפועל על שכבת החריגים, שאינה יכולה לפתוח
   * ‏מה שנחסם מעליה. הבקשה נדחית, והמנהל אינו מבין למה (ביקורת
   * ‏Codex, P2).
   */
  it("והתשובה נושאת את החסימה עצמה, כדי שהמסך ידע להסביר", async () => {
    const blocked = await asManager(() =>
      controllerFor(["properties"]).userCapabilities("01TARGET"),
    );
    expect(blocked.blockedModules).toEqual(["properties"]);

    const open = await asManager(() => controllerFor([]).userCapabilities("01TARGET"));
    expect(open.blockedModules).toEqual([]);
  });
});
