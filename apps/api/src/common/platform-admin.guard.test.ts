import type { ExecutionContext } from "@nestjs/common";
import { ForbiddenException } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlatformAdminGuard as GuardType } from "./platform-admin.guard";
import type { PrismaService } from "../core/prisma.service";

/**
 * השער היחיד שמגן על ניהול הפלטפורמה — הקמת משרדים, שחזור גיבויים
 * ועדכון גרסה על המכונה. עד לסבב הזה ההרשאה נאכפה בשנים-עשר עותקים
 * בתוך הבקר; עכשיו היא יושבת במקום אחד, ולכן טעות בו היא טעות בכולם.
 *
 * `loadEnv()` מוצא את התוצאה במטמון ברמת המודול, ולכן כל תרחיש טוען
 * את גרף המודולים מחדש (`vi.resetModules`) עם סביבה משלו — כולל
 * `TenantContext`, שאחרת היה מגיע מעותק אחר עם AsyncLocalStorage אחר.
 */

const ADMIN = "boss@metavchim.co.il";

const BASE_ENV: Record<string, string> = {
  WEB_ORIGIN: "https://app.example.test",
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  PHONE_HASH_KEY: "x".repeat(32),
};

/** הקשר ריק — לגארד אכפת רק מהמטא-דאטה, שמגיעה מה-Reflector. */
const context = {
  getHandler: () => () => undefined,
  getClass: () => class {},
} as unknown as ExecutionContext;

const touched = new Set<string>();

/**
 * מרכיב גארד טרי מול סביבה נתונה, ומריץ אותו בתוך הקשר דייר.
 * `email` שאינו מוגדר מדמה משתמש שנמחק בין הנפקת ה-Session לבקשה.
 */
async function run(options: {
  required: boolean;
  email?: string;
  adminList?: string;
}): Promise<boolean> {
  for (const [key, value] of Object.entries({
    ...BASE_ENV,
    PLATFORM_ADMIN_EMAILS: options.adminList ?? ADMIN,
  })) {
    process.env[key] = value;
    touched.add(key);
  }
  vi.resetModules();

  const { PlatformAdminGuard } = await import("./platform-admin.guard");
  const { TenantContext } = await import("./tenant-context");

  const reflector = { getAllAndOverride: () => options.required } as unknown as Reflector;
  const prisma = {
    user: {
      findUnique: () => Promise.resolve(options.email === undefined ? null : { email: options.email }),
    },
  } as unknown as PrismaService;
  const guard: GuardType = new PlatformAdminGuard(reflector, prisma);

  return TenantContext.run({ tenantId: "t1", userId: "u1", capabilities: new Set() }, () =>
    guard.canActivate(context),
  );
}

describe("PlatformAdminGuard", () => {
  afterEach(() => {
    for (const key of touched) delete process.env[key];
    touched.clear();
  });

  it("מעביר נתיב שאינו מסומן כניהול פלטפורמה", async () => {
    await expect(run({ required: false })).resolves.toBe(true);
  });

  it("מעביר מנהל פלטפורמה", async () => {
    await expect(run({ required: true, email: ADMIN })).resolves.toBe(true);
  });

  it("חוסם משתמש מחובר שאינו ברשימה", async () => {
    await expect(run({ required: true, email: "agent@office.co.il" })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  // הרשימה מנורמלת לאותיות קטנות בטעינת הסביבה; הכתובת במסד לא בהכרח
  it("משווה כתובת בלי תלות ברישיות", async () => {
    await expect(run({ required: true, email: "BOSS@Metavchim.co.IL" })).resolves.toBe(true);
  });

  it("חוסם כשמשתמש הסשן כבר אינו קיים", async () => {
    await expect(run({ required: true })).rejects.toBeInstanceOf(ForbiddenException);
  });

  // רשימה ריקה = המסך כבוי. אילו הייתה מתפרשת כ"אין הגבלה", התקנה
  // טרייה שטרם הוגדרה בה כתובת מנהל הייתה נפתחת לכל סוכן במשרד.
  it("חוסם את כולם כשאין רשימת מנהלי פלטפורמה", async () => {
    await expect(run({ required: true, email: ADMIN, adminList: "" })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
