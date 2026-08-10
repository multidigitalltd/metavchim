/**
 * Seed לפיתוח מקומי בלבד — יוצר שתי סוכנויות (לבדיקות Cross-Tenant) עם
 * משתמש Owner בכל אחת. לעולם לא רץ בפרודקשן (נחסם לפי NODE_ENV).
 */
import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";
import { ulid } from "ulid";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  if (process.env["NODE_ENV"] === "production") {
    throw new Error("Seed אסור בפרודקשן");
  }

  const password = await argon2.hash("Demo1234!", { type: argon2.argon2id });

  const tenants = [
    { name: "משרד הדגמה א׳", email: "demo-a@metavchim.local" },
    { name: "משרד הדגמה ב׳", email: "demo-b@metavchim.local" },
  ];

  for (const t of tenants) {
    const existing = await prisma.user.findUnique({ where: { email: t.email } });
    if (existing) continue;

    const tenantId = ulid();
    await prisma.tenant.create({
      data: { id: tenantId, name: t.name, plan: "pro", status: "active" },
    });
    await prisma.user.create({
      data: {
        id: ulid(),
        tenantId,
        name: "דנה כהן",
        email: t.email,
        passwordHash: password,
        role: "owner",
      },
    });
    console.warn(`✓ ${t.name} — ${t.email} / Demo1234!`);
  }
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
