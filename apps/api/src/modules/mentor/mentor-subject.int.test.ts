import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mentorSubjectFacts, mentorSubjectLines } from "@metavchim/shared";
import { MentorSignalsService } from "./mentor-signals.service";
import { CryptoService } from "../../core/crypto.service";
import type { TenantTx } from "../../core/prisma.service";

/**
 * ‎**הכרטיס שמצורף לשיחה עם המנטור — מול מסד אמיתי.**
 *
 * ## ‏מה כאן ולא בבדיקת יחידה
 *
 * ‏הניסוח עצמו (איך נראית שורת העובדות, מה נאמר כשאין מגע, איפה
 * ‏משפט הגבול) הוא קוד טהור ונבדק ב-`mentor-subject.test.ts` בלי
 * ‏מסד. מה שדורש מסד הוא בדיוק מה שהקומפיילר אינו רואה:
 *
 * 1. ‎**הסינון באמת מסנן.** ‎`owner_user_id` ו-`agent_user_id`
 *    ‏הם `where` שרץ, ולא הצהרה. עמית באותו משרד הוא המקרה
 *    ‏המסוכן: ‎RLS **מאשר** אותו, כי `tenant_id` זהה. אם התנאי
 *    ‏אינו שם, שום שכבה אחרת לא תעצור.
 * 2. ‎**העובדות נספרות מהטבלאות הנכונות** — סיור שבוטל אינו סיור,
 *    ‏ופתק מערכת אינו „מגע”.
 * 3. ‎**מה שיוצא אינו נושא פרטי קשר.** נבדק על הפלט עצמו, כי מה
 *    ‏שאין בו אינו יכול להגיע למודל.
 */

/*
 * ‎**הבדיקה מספקת לעצמה את המפתחות, ולא נשענת על סביבת המפעיל.**
 *
 * ‎`CryptoService` קורא ל-`loadEnv()`, שדורש את **כל** תצורת
 * ‏האפליקציה. אצלי היא מוגדרת ולכן הכול עבר; משימת ה-CI מגדירה
 * ‏כתובות מסד בלבד, ושם הבדיקה נפלה עוד לפני שהריצה התחילה.
 *
 * ‏זה בדיוק סוג הבדיקה שעוברת אצלי ונשברת אצל כולם, ולכן היא
 * ‏מסתפקת עכשיו בעצמה. `??=` ולא השמה: מי שכן הגדיר סביבה מריץ
 * ‏אותה כפי שהיא.
 *
 * ‏המפתח נוצר בכל ריצה ואינו נשמר בשום מקום — הוא מצפין ומפענח
 * ‏בתוך אותו תהליך, וזה כל מה שהבדיקה צריכה ממנו.
 */
process.env.WEB_ORIGIN ??= "http://localhost:3000";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.DATA_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
process.env.PHONE_HASH_KEY ??= randomBytes(32).toString("hex");

const TENANT = "01SUBJTENANTAAAAAAAAAAAAAA";
const MINE = "01SUBJUSERMINEAAAAAAAAAAAA";
const PEER = "01SUBJUSERPEERAAAAAAAAAAAA";
const CONTACT_MINE = "01SUBJCONTACTMINEAAAAAAAAA";
const CONTACT_PEER = "01SUBJCONTACTPEERAAAAAAAAA";
const BUYER_MINE = "01SUBJBUYERMINEAAAAAAAAAAA";
const BUYER_PEER = "01SUBJBUYERPEERAAAAAAAAAAA";
const PROP_MINE = "01SUBJPROPMINEAAAAAAAAAAAA";
const PROP_PEER = "01SUBJPROPPEERAAAAAAAAAAAA";

const NOW = new Date("2026-09-09T09:00:00.000Z");
const PHONE = "+972500000001";

let db: PrismaClient | undefined;
let signals: MentorSignalsService | undefined;
let crypto: CryptoService | undefined;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} חסר — הבדיקה דורשת מסד אמיתי`);
  return value;
}

/** ‏הקשר הדייר נקבע במפורש, כמו ב-`withTenant`. */
async function inTenant<T>(run: (tx: TenantTx) => Promise<T>): Promise<T> {
  return db!.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return run(tx as unknown as TenantTx);
  });
}

/** ‏ימים אחורה מ-`NOW`, לזריעה קריאה. */
function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 86_400_000);
}

beforeAll(async () => {
  db = new PrismaClient({
    datasources: { db: { url: requiredEnv("DIRECT_DATABASE_URL") } },
  });
  crypto = new CryptoService();
  signals = new MentorSignalsService(crypto);

  /*
   * ‎**הסטטוס נזרע כפי שהוא באמת נשמר: מזהה, והתווית בהגדרות.**
   *
   * ‏הגרסה הראשונה הכניסה „בסבב סיורים” היישר לעמודה, ולכן הבדיקה
   * ‏עברה בזמן שהקוד היה שולח למנטור „שלב: s3” על כרטיס אמיתי
   * ‏(ביקורת Codex). זריעה שאינה כמו המציאות מסתירה בדיוק את מה
   * ‏שהיא אמורה לבדוק.
   */
  await db.$executeRaw`
    INSERT INTO tenants (id, name, settings, created_at, updated_at)
    VALUES (${TENANT}, 'משרד כרטיסים',
            ${JSON.stringify({
              buyerStatuses: [
                { id: "s1", label: "בבירור צרכים", maturity: "interested", archived: false },
                { id: "s2", label: "בסבב סיורים", maturity: "hot", archived: false },
              ],
            })}::jsonb,
            now(), now())
    ON CONFLICT (id) DO UPDATE SET settings = EXCLUDED.settings`;
  for (const [id, name] of [
    [MINE, "דנה"],
    [PEER, "יוסי"],
  ] as const) {
    await db.$executeRaw`
      INSERT INTO users (id, tenant_id, email, name, role, password_hash, created_at, updated_at)
      VALUES (${id}, ${TENANT}, ${`${id}@example.test`}, ${name}, 'agent', 'x', now(), now())
      ON CONFLICT (id) DO NOTHING`;
  }
  /*
   * ‎`DO UPDATE` ולא `DO NOTHING`: המפתח נוצר בכל ריצה, ושורה
   * ‏שנשארה מריצה קודמת מוצפנת במפתח אחר — כלומר אינה ניתנת
   * ‏לפענוח. „אידמפוטנטי” כאן פירושו „מסתיים באותו מצב”, ולא
   * ‏„אינו כותב”.
   */
  for (const [id, name] of [
    [CONTACT_MINE, "רותי לוי"],
    [CONTACT_PEER, "אבי כהן"],
  ] as const) {
    await db.$executeRaw`
      INSERT INTO contacts (id, tenant_id, name_encrypted, phone_encrypted, phone_hash, created_at, updated_at)
      VALUES (${id}, ${TENANT}, ${crypto.encrypt(name)}, ${crypto.encrypt(PHONE)},
              ${`subject-hash-${id}`}, now(), now())
      ON CONFLICT (id) DO UPDATE
        SET name_encrypted = EXCLUDED.name_encrypted,
            phone_encrypted = EXCLUDED.phone_encrypted`;
  }
  for (const [id, contact, owner] of [
    [BUYER_MINE, CONTACT_MINE, MINE],
    [BUYER_PEER, CONTACT_PEER, PEER],
  ] as const) {
    await db.$executeRaw`
      INSERT INTO buyers (id, tenant_id, contact_id, owner_user_id, requirements, deal_type,
                          source, maturity, office_status, created_at, updated_at)
      VALUES (${id}, ${TENANT}, ${contact}, ${owner}, '{}'::jsonb, 'sale', 'manual',
              'hot', 's2', ${daysAgo(40)}, now())
      ON CONFLICT (id) DO NOTHING`;
  }
  for (const [id, agent] of [
    [PROP_MINE, MINE],
    [PROP_PEER, PEER],
  ] as const) {
    await db.$executeRaw`
      INSERT INTO properties (id, tenant_id, status, city, street, house_number,
                              rooms, area_sqm, price_agorot, agent_user_id, created_at, updated_at)
      VALUES (${id}, ${TENANT}, 'active', 'תל אביב', 'הרצל', '12',
              4, 95, 240000000, ${agent}, ${daysAgo(61)}, now())
      ON CONFLICT (id) DO NOTHING`;
  }

  /*
   * ‏שני סיורים שהתקיימו ואחד שבוטל. הביטול הוא העיקר: סיור מבוטל
   * ‏שנספר היה אומר למנטור שהקונה זז כשהוא לא זז.
   */
  const viewings: [string, string, number][] = [
    ["01SUBJAPPTAAAAAAAAAAAAAAAA", "completed", 3],
    ["01SUBJAPPTBBBBBBBBBBBBBBBB", "completed", 10],
    ["01SUBJAPPTCCCCCCCCCCCCCCCC", "cancelled", 5],
  ];
  for (const [id, status, ago] of viewings) {
    await db.$executeRaw`
      INSERT INTO appointments (id, tenant_id, buyer_id, property_id, kind, status,
                                starts_at, ends_at, created_at, updated_at)
      VALUES (${id}, ${TENANT}, ${BUYER_MINE}, ${PROP_MINE}, 'viewing', ${status},
              ${daysAgo(ago)}, ${daysAgo(ago)}, now(), now())
      ON CONFLICT (id) DO NOTHING`;
  }

  /*
   * ‏„מגע” הוא מה שאדם עשה. הפתק בן 9 הימים הוא המגע; שינוי
   * ‏הסטטוס של אתמול נכתב על ידי המערכת ואינו נחשב — ואם ייספר,
   * ‏המנטור יאמר „דיברת אתמול” כשאיש לא דיבר.
   */
  const touches: [string, string, number][] = [
    ["01SUBJINTERAAAAAAAAAAAAAAA", "note", 9],
    ["01SUBJINTERBBBBBBBBBBBBBBB", "status_change", 1],
  ];
  for (const [id, kind, ago] of touches) {
    await db.$executeRaw`
      INSERT INTO interactions (id, tenant_id, buyer_id, kind, content, created_at)
      VALUES (${id}, ${TENANT}, ${BUYER_MINE}, ${kind}, 'x', ${daysAgo(ago)})
      ON CONFLICT (id) DO NOTHING`;
  }
});

afterAll(async () => {
  if (db === undefined) return;
  await db.$executeRaw`DELETE FROM mentor_messages WHERE tenant_id = ${TENANT}`;
  await db.$executeRaw`DELETE FROM interactions WHERE tenant_id = ${TENANT}`;
  await db.$executeRaw`DELETE FROM appointments WHERE tenant_id = ${TENANT}`;
  await db.$executeRaw`DELETE FROM properties WHERE tenant_id = ${TENANT}`;
  await db.$executeRaw`DELETE FROM buyers WHERE tenant_id = ${TENANT}`;
  await db.$executeRaw`DELETE FROM contacts WHERE tenant_id = ${TENANT}`;
  await db.$executeRaw`DELETE FROM users WHERE tenant_id = ${TENANT}`;
  await db.$executeRaw`DELETE FROM tenants WHERE id = ${TENANT}`;
  await db.$disconnect();
});

/**
 * ‏הכרטיס הפעיל של שיחה — אותה סמנטיקה כמו `MentorService`.
 *
 * ‏השאילתה על `subject_kind` ולא על `subject_id`: שורת ניתוק נושאת
 * ‏סוג בלי מזהה, ואם לא תיכלל — הגזירה תדלג אחורה.
 */
async function activeOf(
  thread: string,
): Promise<{ kind: string; id: string } | null> {
  const row = await db!.mentorMessage.findFirst({
    where: { tenantId: TENANT, userId: MINE, threadId: thread, subjectKind: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { subjectKind: true, subjectId: true },
  });
  if (row === null || row.subjectId === null || row.subjectKind === null) return null;
  return { kind: row.subjectKind, id: row.subjectId };
}

describe("צירוף כרטיס לשיחה עם המנטור — מול מסד אמיתי", () => {
  it("הכרטיס שלי נטען עם העובדות שלו", async () => {
    const subject = await inTenant((tx) =>
      signals!.subject(tx, TENANT, MINE, "buyer", BUYER_MINE, NOW),
    );
    expect(subject).not.toBeNull();
    expect(subject).toMatchObject({
      kind: "buyer",
      name: "רותי לוי",
      stage: "בסבב סיורים",
      maturity: "hot",
      /* שניים התקיימו, השלישי בוטל */
      viewings: 2,
      offers: 0,
      daysSinceTouch: 9,
      ageDays: 40,
      hasNextStep: false,
    });
  });

  /*
   * ‎**זו הבדיקה שהקובץ קיים בשבילה.** אותו משרד, סוכן אחר: `RLS`
   * ‏מאשר את השורה, ורק תנאי הבעלות בשאילתה עוצר. בלעדיו המנטור
   * ‏של סוכן אחד היה קורא את הכרטיסים של עמיתו — ומחזיר את שמם.
   */
  it("כרטיס של עמית באותו משרד אינו נטען — לא קונה ולא נכס", async () => {
    for (const [kind, id] of [
      ["buyer", BUYER_PEER],
      ["property", PROP_PEER],
    ] as const) {
      expect(
        await inTenant((tx) => signals!.subject(tx, TENANT, MINE, kind, id, NOW)),
      ).toBeNull();
    }
  });

  it("ומה שאינו קיים מחזיר את אותה תשובה בדיוק", async () => {
    /* ‏„של מישהו אחר” ו„אינו קיים” אינם צריכים להיות ניתנים להבחנה */
    expect(
      await inTenant((tx) =>
        signals!.subject(tx, TENANT, MINE, "buyer", "01SUBJNOSUCHAAAAAAAAAAAAAA", NOW),
      ),
    ).toBeNull();
  });

  it("נכס שלי נטען, והמחיר עובר מאגורות לשקלים", async () => {
    const subject = await inTenant((tx) =>
      signals!.subject(tx, TENANT, MINE, "property", PROP_MINE, NOW),
    );
    expect(subject).toMatchObject({
      kind: "property",
      label: "הרצל 12, תל אביב",
      price: 2_400_000,
      rooms: 4,
      size: 95,
      ageDays: 61,
      viewings: 2,
    });
  });

  it("רשימת הבחירה מציעה את שלי בלבד", async () => {
    const buyers = await inTenant((tx) =>
      signals!.subjectOptions(tx, TENANT, MINE, "buyer", "", 20),
    );
    expect(buyers.map((b) => b.id)).toEqual([BUYER_MINE]);
    expect(buyers[0]!.title).toBe("רותי לוי");

    const properties = await inTenant((tx) =>
      signals!.subjectOptions(tx, TENANT, MINE, "property", "", 20),
    );
    expect(properties.map((p) => p.id)).toEqual([PROP_MINE]);
  });

  it("חיפוש בשם עמית אינו מוצא אותו", async () => {
    expect(
      await inTenant((tx) =>
        signals!.subjectOptions(tx, TENANT, MINE, "buyer", "אבי", 20),
      ),
    ).toEqual([]);
  });

  /*
   * ‎**מה שנוסע למודל — נבדק על הפלט, לא על הכוונה.**
   *
   * ‏הטלפון קיים על איש הקשר ומוצפן במסד; השאלה היחידה שמעניינת
   * ‏היא אם הוא הגיע לשורות. מה שאין בהן אינו יכול להופיע בפרומפט.
   */
  /*
   * ‎**„ניתקתי” הוא אמירה שנשמרת, ולא היעדר אמירה.**
   *
   * ‏הכרטיס הפעיל נגזר מההודעה האחרונה בשיחה שאמרה משהו. בלי שורת
   * ‏ניתוק שמורה, הגזירה מדלגת אחורה אל הכרטיס הקודם וההודעה הבאה
   * ‏ממשיכה לשאת את פרטיו — כלומר כפתור „ניתוק” שאינו מנתק
   * ‏(ביקורת Codex, P1).
   */
  it("שורת ניתוק אינה מאפשרת לגזירה לדלג אחורה", async () => {
    const thread = "01SUBJTHREADAAAAAAAAAAAAAA";
    const at = (n: number): Date => new Date(NOW.getTime() - n * 60_000);
    await db!.$executeRaw`
      INSERT INTO mentor_messages (id, tenant_id, user_id, thread_id, role, text,
                                   subject_kind, subject_id, created_at)
      VALUES ('01SUBJMSG1AAAAAAAAAAAAAAAA', ${TENANT}, ${MINE}, ${thread}, 'user', 'עם כרטיס',
              'buyer', ${BUYER_MINE}, ${at(30)})
      ON CONFLICT (id) DO NOTHING`;
    await db!.$executeRaw`
      INSERT INTO mentor_messages (id, tenant_id, user_id, thread_id, role, text,
                                   subject_kind, subject_id, created_at)
      VALUES ('01SUBJMSG2AAAAAAAAAAAAAAAA', ${TENANT}, ${MINE}, ${thread}, 'user', 'בלי אמירה',
              NULL, NULL, ${at(20)})
      ON CONFLICT (id) DO NOTHING`;

    /* ‏עד כאן — הכרטיס עדיין פעיל, כי איש לא ניתק אותו */
    expect(await activeOf(thread)).toEqual({
      kind: "buyer",
      id: BUYER_MINE,
    });

    await db!.$executeRaw`
      INSERT INTO mentor_messages (id, tenant_id, user_id, thread_id, role, text,
                                   subject_kind, subject_id, created_at)
      VALUES ('01SUBJMSG3AAAAAAAAAAAAAAAA', ${TENANT}, ${MINE}, ${thread}, 'user', 'ניתקתי',
              'none', NULL, ${at(10)})
      ON CONFLICT (id) DO NOTHING`;

    /* ‏ומכאן — אין כרטיס, ולא „הכרטיס מלפני שתי הודעות” */
    expect(await activeOf(thread)).toBeNull();
  });

  it("שום פרט קשר אינו יוצא אל הפרומפט", async () => {
    const subject = await inTenant((tx) =>
      signals!.subject(tx, TENANT, MINE, "buyer", BUYER_MINE, NOW),
    );
    const text = [
      ...mentorSubjectFacts(subject!),
      ...mentorSubjectLines(subject!),
    ].join("\n");
    expect(text).not.toContain(PHONE);
    expect(text).not.toContain("500000001");
    expect(text).not.toContain("@");
    /* ‏והמזהה עצמו גם הוא אינו נחוץ שם */
    expect(text).not.toContain(BUYER_MINE);
  });
});
