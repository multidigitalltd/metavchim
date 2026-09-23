import { describe, expect, it, vi } from "vitest";

const env = { PLATFORM_ADMIN_EMAILS: ["owner@platform.example"] };
vi.mock("../../config/env", () => ({ loadEnv: () => env }));

import { TenantContext } from "../../common/tenant-context";
import { MediaPreviewGuard } from "./media-preview.guard";

/** תצוגה מקדימה — עובר רק מי שברשימת מנהלי הפלטפורמה. */
function guard(email: string | null) {
  const prisma = {
    user: { findUnique: async () => (email === null ? null : { email }) },
  };
  return new MediaPreviewGuard(prisma as never);
}

const asUser = <T>(fn: () => Promise<T>) =>
  TenantContext.run(
    { tenantId: "01TENANT00000000000000000A", userId: "01USER000000000000000000A0", capabilities: new Set(), billingOnly: false },
    fn,
  );

describe("MediaPreviewGuard", () => {
  it("מנהל הפלטפורמה — עובר, בלי תלות ברישיות הכתובת", async () => {
    await expect(asUser(() => guard("Owner@Platform.example").canActivate())).resolves.toBe(true);
  });

  it("משתמש רגיל — „בקרוב”, לא 403 סתמי", async () => {
    await expect(asUser(() => guard("agent@office.example").canActivate())).rejects.toThrow(/בקרוב/u);
  });

  it("בלי רשימת מנהלים — סגור לכולם, ובלי לשאול את המסד", async () => {
    env.PLATFORM_ADMIN_EMAILS = [];
    const prisma = { user: { findUnique: vi.fn() } };
    await expect(asUser(() => new MediaPreviewGuard(prisma as never).canActivate())).rejects.toThrow(/בקרוב/u);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    env.PLATFORM_ADMIN_EMAILS = ["owner@platform.example"];
  });
});
