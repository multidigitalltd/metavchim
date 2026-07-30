/**
 * הקמת הסוכנות הראשונה בפרודקשן — פעם אחת, מתוך קונטיינר ה-API:
 *
 *   docker compose -f docker-compose.prod.yml --env-file .env.production \
 *     exec api node dist/scripts/bootstrap.js "שם המשרד" owner@example.com "שם הבעלים"
 *
 * יוצר Tenant + משתמש Owner עם סיסמה זמנית אקראית שמודפסת פעם אחת —
 * מחליפים אותה מיד אחרי ההתחברות הראשונה (מסך "החלפת סיסמה").
 * ה-Seed של הפיתוח חסום בפרודקשן בכוונה; זה המסלול הרשמי היחיד.
 */
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";
import { ulid } from "ulid";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const [agencyName, email, ownerName] = process.argv.slice(2);
  if (!agencyName || !email || !ownerName) {
    throw new Error('שימוש: bootstrap.js "שם המשרד" owner@example.com "שם הבעלים"');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) throw new Error(`אימייל לא תקין: ${email}`);

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) throw new Error(`כבר קיים משתמש עם האימייל ${email}`);

  const password = randomBytes(12).toString("base64url");
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  const tenantId = ulid();
  await prisma.$transaction([
    prisma.tenant.create({ data: { id: tenantId, name: agencyName, plan: "pro", status: "active" } }),
    prisma.user.create({
      data: { id: ulid(), tenantId, name: ownerName, email, passwordHash, role: "owner" },
    }),
  ]);

  console.warn(`✓ הסוכנות "${agencyName}" הוקמה`);
  console.warn(`  התחברות: ${email}`);
  console.warn(`  סיסמה זמנית (מוצגת פעם אחת — החליפו מיד): ${password}`);
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
