import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ulid } from "ulid";
import { lockContactPhone, lockIntakeRequest } from "../../common/locks";
import type { TenantTx } from "../../core/prisma.service";

/**
 * הקישור הפתוח הופך לכרטיס — **פעם אחת, מול Postgres אמיתי.**
 *
 * ## למה זו אינה בדיקת יחידה
 *
 * מה שמגן כאן אינו קוד אלא **המסד**: נעילת ייעוץ שמסדרת שתי
 * טרנזקציות בתור, אילוץ ייחודיות על ‎(tenant_id, phone_hash)‎,
 * ותנאי ‎`WHERE subject_id IS NULL`‎ שנבדק תחת אותה נעילה. מוק של
 * Prisma יריץ את שתי „הטרנזקציות” בזו אחר זו ויאשר בדיוק את
 * ההנחה שאנחנו מנסים לבדוק.
 *
 * ## למה זה שווה בדיקה
 *
 * זו הנקודה שבה טעות יוצרת **כרטיסים כפולים בייצור**. לקוח שלוחץ
 * „שליחה” פעמיים בנייד, או שהרשת שלו שולחת את הבקשה שוב, הוא
 * תרחיש יומיומי — ושני כרטיסים לאותו אדם מתגלים רק כשמישהו שואל
 * למה יש שתי שורות באותו שם.
 *
 * ## שלוש הטענות
 *
 * 1. **שתי שליחות במקביל של אותו קישור → כרטיס אחד.** השנייה
 *    רואה את מה שהראשונה כתבה ומצטרפת אליו.
 * 2. **הנעילה על המספר היא מה שמונע את הנפילה.** בלעדיה שתי
 *    יצירות מקבילות של אותו מספר חדש נופלות על האילוץ — ובתוך
 *    טרנזקציה זו אינה שגיאה שאפשר לתפוס אלא ביטול הפנייה כולה
 *    (`25P02`). הבדיקה מריצה את שני המסלולים ומשווה.
 * 3. **`subject_id IS NULL` הוא תנאי התפיסה.** בקשה שכבר מצביעה
 *    על כרטיס אינה מוסטת לכרטיס אחר.
 */

let prisma: PrismaClient;
let owner: PrismaClient;
const TENANT = "01OPENINTAKEAAAAAAAAAAAAAA";
const AGENT = "01OPENINTAKEAGENTAAAAAAAAA";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`חסר משתנה סביבה ${name}`);
  return value;
}

/** הרצה בהקשר דייר, כתפקיד האפליקציה — כמו `withExplicitTenant` בייצור. */
async function asTenant<T>(run: (tx: TenantTx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `SELECT set_config('app.tenant_id', '${TENANT}', true)`,
    );
    return run(tx as unknown as TenantTx);
  });
}

/** בקשת קישור פתוח — בלי כרטיס ובלי איש קשר, כפי ש-`ensureOpen` יוצרת. */
async function openRequest(): Promise<string> {
  const id = ulid();
  await owner.$executeRawUnsafe(
    `INSERT INTO intake_requests
       (id, tenant_id, token, subject, subject_id, contact_id, status, channel,
        created_by, expires_at, created_at, updated_at)
     VALUES ($1, $2, $3, 'open', NULL, NULL, 'sent', 'manual', $4,
             now() + interval '14 days', now(), now())`,
    id,
    TENANT,
    ulid().slice(0, 20) + ulid().slice(0, 23),
    AGENT,
  );
  return id;
}

/**
 * מה ש-`materializeOpen` עושה, בשלד: נעילה, קריאה חוזרת, מיזוג לפי
 * טלפון, ותפיסה מותנית. אותו סדר פעולות ואותה טרנזקציה אחת.
 *
 * `withPhoneLock` הוא הדגל שמאפשר להריץ את **אותו** מסלול גם בלי
 * הנעילה, כדי להראות מה קורה בלעדיה.
 */
async function materialize(
  requestId: string,
  phoneHash: string,
  withPhoneLock = true,
): Promise<string> {
  return asTenant(async (tx) => {
    /*
     * ‎**הנעילה נשארה, ההתממשות-החד-פעמית לא.**
     *
     * ‏קודם ישבה כאן יציאה מוקדמת: „לבקשה כבר יש כרטיס ⇒ החזר
     * ‏אותו”. זה מה שהפך קישור כללי לחד-פעמי — הלקוח השני נחת על
     * ‏הכרטיס של הראשון. הנעילה עצמה עדיין נחוצה, והיא זו שמסדרת
     * ‏שתי שליחות מקבילות של **אותו** אדם.
     */
    await lockIntakeRequest(tx, TENANT, requestId);

    if (withPhoneLock) await lockContactPhone(tx, TENANT, phoneHash);
    const found = await tx.contact.findUnique({
      where: { tenantId_phoneHash: { tenantId: TENANT, phoneHash } },
      select: { id: true },
    });
    const contactId = found?.id ?? ulid();
    if (found === null) {
      await tx.contact.create({
        data: {
          id: contactId,
          tenantId: TENANT,
          nameEncrypted: "שם מוצפן",
          phoneEncrypted: "טלפון מוצפן",
          phoneHash,
        },
      });
    }

    const existing = await tx.buyer.findFirst({
      where: { tenantId: TENANT, contactId, deletedAt: null },
      select: { id: true },
    });
    const buyerId = existing?.id ?? ulid();
    if (existing === null) {
      await tx.buyer.create({
        data: {
          id: buyerId,
          tenantId: TENANT,
          contactId,
          ownerUserId: AGENT,
          cities: [],
          dealType: "sale",
          requirements: { dealType: "sale", cities: [], searchAreas: [] },
          source: "intake_link",
        },
      });
    }
    /*
     * ‏המילוי נרשם על **שורה משלו**, ושורת הקישור אינה נוגעת —
     * ‏בדיוק כמו `recordOpenSubmission` בשירות.
     */
    await tx.intakeRequest.create({
      data: {
        id: ulid(),
        tenantId: TENANT,
        token: ulid().slice(0, 20) + ulid().slice(0, 23),
        subject: "buyer",
        subjectId: buyerId,
        contactId,
        channel: "open_fill",
        expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        status: "submitted",
        submittedAt: new Date(),
      },
    });
    return buyerId;
  });
}

beforeAll(async () => {
  owner = new PrismaClient({
    datasources: { db: { url: requiredEnv("DIRECT_DATABASE_URL") } },
  });
  await owner.$executeRawUnsafe(
    `INSERT INTO tenants (id, name, created_at, updated_at)
     VALUES ('${TENANT}', 'בדיקת קישור פתוח', now(), now())
     ON CONFLICT (id) DO NOTHING`,
  );
  prisma = new PrismaClient({
    datasources: { db: { url: requiredEnv("APP_DATABASE_URL") } },
  });
});

afterAll(async () => {
  await owner.$executeRawUnsafe(`DELETE FROM tenants WHERE id = '${TENANT}'`);
  await owner.$disconnect();
  await prisma.$disconnect();
});

describe("קישור פתוח → כרטיס", () => {
  it("שתי שליחות במקביל של אותו קישור יוצרות כרטיס אחד", async () => {
    const request = await openRequest();
    const phoneHash = `hash-${ulid()}`;

    const [first, second] = await Promise.all([
      materialize(request, phoneHash),
      materialize(request, phoneHash),
    ]);

    expect(first).toBe(second);
    const buyers = await owner.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*) FROM buyers WHERE tenant_id = $1 AND contact_id IN
         (SELECT id FROM contacts WHERE tenant_id = $1 AND phone_hash = $2)`,
      TENANT,
      phoneHash,
    );
    expect(Number(buyers[0]!.count)).toBe(1);
  });

  /*
   * ‎**שורת הקישור נשארת קישור.**
   *
   * ‏קודם היא נתפסה בתור השליחה עצמה — `submitted`, התשובות,
   * ‏ו-`subject_id` שמצביע על הכרטיס. זה מה שהפך אותה לחד-פעמית.
   * ‏עכשיו המילוי יושב על שורה משלו, והקישור ממשיך לעבוד.
   */
  it("שורת הקישור אינה נתפסת — היא נשארת פתוחה למילוי הבא", async () => {
    const request = await openRequest();
    const buyerId = await materialize(request, `hash-${ulid()}`);

    const row = await owner.$queryRawUnsafe<
      { subject_id: string | null; contact_id: string | null; status: string }[]
    >(
      `SELECT subject_id, contact_id, status FROM intake_requests WHERE id = $1`,
      request,
    );
    expect(row[0]!.subject_id).toBeNull();
    expect(row[0]!.contact_id).toBeNull();
    expect(row[0]!.status).not.toBe("submitted");

    /* ‏והמילוי עצמו נרשם — על שורה משלו שמצביעה על הכרטיס */
    const fill = await owner.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*) FROM intake_requests
         WHERE tenant_id = $1 AND channel = 'open_fill' AND subject_id = $2`,
      TENANT,
      buyerId,
    );
    expect(Number(fill[0]!.count)).toBe(1);
  });

  /*
   * שני קישורים שונים, אותו מספר — התרחיש של לקוח שקיבל קישור
   * בטעות פעמיים, או שחזר אחרי חצי שנה. הוא אינו אמור לקבל כרטיס
   * שני, וזה מה שהופך את המיזוג לפי טלפון למשמעותי.
   */
  it("שני קישורים שונים מאותו מספר מובילים לאותו כרטיס", async () => {
    const phoneHash = `hash-${ulid()}`;
    const [a, b] = [await openRequest(), await openRequest()];

    const first = await materialize(a, phoneHash);
    const second = await materialize(b, phoneHash);

    expect(second).toBe(first);
  });

  /*
   * ‎**הדבר החמור ביותר שהבאג הזה גרם, ולכן בדיקה משלו.**
   *
   * ‏עמוד הטופס הציבורי בונה את מה שהלקוח רואה משלושה שדות של
   * ‏שורת הקישור: `contact_id` (שם הברכה), `answers` (מילוי מראש
   * ‏של הטופס, כולל שם וטלפון), ו-`submitted_at` („כבר מילאת”).
   * ‏כשהמילוי נתפס על שורת הקישור, שלושתם נשאו את הלקוח הקודם —
   * ‏ולכן הלקוח **הבא** שפתח את אותו קישור קיבל ברכה בשם של מישהו
   * ‏אחר וטופס מלא בפרטים שלו (דיווח המשתמש).
   *
   * ‏הבדיקה על שלושת השדות ולא על התצוגה, כי הם המקור: מה שאין
   * ‏בהם אינו יכול להופיע במסך.
   */
  it("אחרי מילוי, הקישור אינו נושא שום פרט של מי שמילא", async () => {
    const request = await openRequest();
    await materialize(request, `hash-${ulid()}`);

    const row = await owner.$queryRawUnsafe<
      {
        contact_id: string | null;
        answers: unknown;
        submitted_at: Date | null;
        subject_id: string | null;
      }[]
    >(
      `SELECT contact_id, answers, submitted_at, subject_id
         FROM intake_requests WHERE id = $1`,
      request,
    );
    expect(row[0]!.contact_id).toBeNull();
    expect(row[0]!.answers).toBeNull();
    expect(row[0]!.submitted_at).toBeNull();
    expect(row[0]!.subject_id).toBeNull();
  });

  /*
   * ‎**זה הבאג שהמשתמש דיווח עליו, ועכשיו הוא בדיקה.**
   *
   * ‏מתווך שולח קישור אחד לכל הלקוחות שלו. קודם הלקוח השני שמילא
   * ‏נחת על הכרטיס של הראשון ודרס את התשובות שלו — הבדיקה כאן
   * ‏אפילו קיבעה את זה כהתנהגות נכונה. שני אנשים שונים הם שני
   * ‏כרטיסים, נקודה.
   */
  it("שני לקוחות שונים באותו קישור מקבלים שני כרטיסים", async () => {
    const request = await openRequest();
    const first = await materialize(request, `hash-${ulid()}`);
    const second = await materialize(request, `hash-${ulid()}`);
    expect(second).not.toBe(first);
  });

  /*
   * ‏והמשך ישיר: קישור אחד, שלושה לקוחות, שלושה כרטיסים. זה
   * ‏התרחיש בפועל — הודעה אחת בקבוצה, וכל מי שלוחץ נכנס למערכת.
   */
  it("קישור אחד משרת לקוחות רבים", async () => {
    const request = await openRequest();
    const ids = new Set<string>();
    for (let i = 0; i < 3; i += 1) {
      ids.add(await materialize(request, `hash-${ulid()}`));
    }
    expect(ids.size).toBe(3);
  });

  /*
   * ‏אותו אדם ממלא שוב — תיקון, לא לקוח חדש. הכרטיס נשאר אחד,
   * ‏וזו ההבחנה שמפרידה בין „שלחתי שוב” לבין „זה מישהו אחר”.
   */
  it("אותו לקוח שממלא שוב אינו מקבל כרטיס שני", async () => {
    const request = await openRequest();
    const phoneHash = `hash-${ulid()}`;
    const first = await materialize(request, phoneHash);
    const second = await materialize(request, phoneHash);
    expect(second).toBe(first);
  });
});

describe("הנעילה על המספר", () => {
  it("עם נעילה — שתי יצירות מקבילות של אותו מספר מסתדרות בתור", async () => {
    const phoneHash = `hash-${ulid()}`;
    const [a, b] = [await openRequest(), await openRequest()];
    await expect(
      Promise.all([
        materialize(a, phoneHash, true),
        materialize(b, phoneHash, true),
      ]),
    ).resolves.toBeDefined();

    const contacts = await owner.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*) FROM contacts WHERE tenant_id = $1 AND phone_hash = $2`,
      TENANT,
      phoneHash,
    );
    expect(Number(contacts[0]!.count)).toBe(1);
  });

  /**
   * ובלעדיה — הצד השני של אותו מטבע.
   *
   * הבדיקה אינה דורשת שהנפילה תקרה **תמיד**: תזמון הוא תזמון. היא
   * דורשת ששתי היצירות המקבילות יגיעו לאחת משתי תוצאות בלבד —
   * כרטיס אחד, או שגיאת ייחודיות. מה שאסור הוא **שניים**, וזה מה
   * שנבדק. עם הנעילה נשארת רק התוצאה הראשונה.
   */
  it("בלי נעילה — לעולם לא נוצרים שני אנשי קשר לאותו מספר", async () => {
    const phoneHash = `hash-${ulid()}`;
    const [a, b] = [await openRequest(), await openRequest()];
    await Promise.allSettled([
      materialize(a, phoneHash, false),
      materialize(b, phoneHash, false),
    ]);

    const contacts = await owner.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*) FROM contacts WHERE tenant_id = $1 AND phone_hash = $2`,
      TENANT,
      phoneHash,
    );
    expect(Number(contacts[0]!.count)).toBeLessThanOrEqual(1);
  });
});
