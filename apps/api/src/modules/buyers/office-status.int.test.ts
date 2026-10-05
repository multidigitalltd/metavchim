import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_OFFICE_STATUSES, type OfficeBuyerStatus } from "@metavchim/shared";
import {
  readOfficeStatuses,
  writeOfficeStatuses,
} from "../../common/office-buyer-statuses";

/**
 * ‎**סטטוס המשרד על כרטיס הקונה — מול מסד אמיתי.**
 *
 * ## מה כאן ולא בבדיקת יחידה
 *
 * ההחלטות עצמן (איזה סטטוס שורד שינוי דרגה, מה נרשם בציר, מתי מחיקה
 * הופכת להסתרה) הן קוד טהור ונבדקות ב-`buyer-status.test.ts` בלי
 * מסד. מה שדורש מסד הוא בדיוק מה שהקומפיילר אינו רואה:
 *
 * 1. ‎**העמודה קיימת ומקבלת את מה שכותבים לה.** מיגרציה שלא רצה, שם
 *    עמודה שגוי, או אורך שאינו מספיק מתגלים רק בזמן ריצה.
 * 2. ‎**הסינון לפי סטטוס באמת מסנן** — זו שאילתת ה-`where` שהרשימה
 *    מריצה, ולא העתק שלה.
 * 3. ‎**הכתיבה להגדרות אינה דורסת הגדרות אחרות.** הרשימה חולקת
 *    אובייקט JSON אחד עם כל שאר הגדרות המשרד, ו„קריאה-שינוי-כתיבה”
 *    שגויה הייתה מוחקת את שם המשרד או את מדיניות הרשת — בשקט.
 */

const TENANT = "01STATUSTENANTAAAAAAAAAAAA";
/** חיבור שני — נעילה נבדקת רק בין שתי טרנזקציות נפרדות. */
let other: PrismaClient | undefined;
const CONTACT = "01STATUSCONTACTAAAAAAAAAAA";
let owner: PrismaClient | undefined;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} חסר — הבדיקה דורשת מסד אמיתי`);
  return value;
}

/** הקשר הדייר נקבע במפורש, כמו ב-`withTenant`. */
async function inTenant<T>(
  run: (tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]) => Promise<T>,
): Promise<T> {
  return owner!.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return run(tx);
  });
}

const LIST: OfficeBuyerStatus[] = [
  { id: "s1", label: "בבירור צרכים", maturity: "interested", archived: false },
  { id: "s2", label: "בסבב סיורים", maturity: "hot", archived: false },
  { id: "s3", label: "שלב ישן", maturity: "not_ripe", archived: true },
];

beforeAll(async () => {
  owner = new PrismaClient({
    datasources: { db: { url: requiredEnv("DIRECT_DATABASE_URL") } },
  });
  other = new PrismaClient({
    datasources: { db: { url: requiredEnv("DIRECT_DATABASE_URL") } },
  });

  await owner.$executeRaw`
    INSERT INTO tenants (id, name, settings, created_at, updated_at)
    VALUES (${TENANT}, 'משרד סטטוסים', '{"autoShareBuyers": true}'::jsonb, now(), now())
    ON CONFLICT (id) DO NOTHING
  `;
  await owner.$executeRaw`
    INSERT INTO contacts (id, tenant_id, name_encrypted, phone_encrypted, phone_hash, created_at, updated_at)
    VALUES (${CONTACT}, ${TENANT}, 'x', 'y', 'status-hash', now(), now())
    ON CONFLICT (id) DO NOTHING
  `;

  const buyers: [string, string, string | null][] = [
    ["01STATUSBUYERAAAAAAAAAAAAA", "hot", "s2"],
    ["01STATUSBUYERBBBBBBBBBBBBB", "hot", "s2"],
    ["01STATUSBUYERCCCCCCCCCCCCC", "interested", "s1"],
    /* בלי סטטוס — הרוב, וזה תקין: שכבה א' לבדה. */
    ["01STATUSBUYERDDDDDDDDDDDDD", "interested", null],
  ];
  for (const [id, maturity, officeStatus] of buyers) {
    await owner.$executeRaw`
      INSERT INTO buyers (id, tenant_id, contact_id, requirements, deal_type, source,
                          maturity, office_status, created_at, updated_at)
      VALUES (${id}, ${TENANT}, ${CONTACT}, '{}'::jsonb, 'sale', 'manual',
              ${maturity}, ${officeStatus}, now(), now())
      ON CONFLICT (id) DO NOTHING
    `;
  }
});

afterAll(async () => {
  if (owner === undefined) return;
  await owner.$executeRaw`DELETE FROM buyers WHERE tenant_id = ${TENANT}`;
  await owner.$executeRaw`DELETE FROM contacts WHERE tenant_id = ${TENANT}`;
  await owner.$executeRaw`DELETE FROM tenants WHERE id = ${TENANT}`;
  await owner.$disconnect();
  await other?.$disconnect();
});

describe("סטטוס המשרד מול מסד אמיתי", () => {
  /*
   * ‎**הכתיבה חייבת להשאיר את שאר ההגדרות במקומן.** כולן חולקות
   * אובייקט JSON אחד, ולכן `update` שכותב אובייקט חדש היה מוחק את
   * מדיניות הרשת של המשרד בלי שאיש יבחין.
   */
  it("כתיבת הרשימה אינה דורסת הגדרות אחרות", async () => {
    await inTenant((tx) => writeOfficeStatuses(tx, TENANT, LIST));
    const row = await owner!.tenant.findUnique({
      where: { id: TENANT },
      select: { settings: true },
    });
    const settings = row!.settings as Record<string, unknown>;
    expect(settings["autoShareBuyers"]).toBe(true);
    expect(await inTenant((tx) => readOfficeStatuses(tx, TENANT))).toEqual(LIST);
  });

  /* משרד שלא נגע מעולם — ולא משרד שמחק את כולן. */
  it("בלי המפתח בהגדרות מתקבלות ברירות המחדל", async () => {
    await owner!.$executeRaw`
      UPDATE tenants SET settings = settings - 'buyerStatuses' WHERE id = ${TENANT}
    `;
    expect(await inTenant((tx) => readOfficeStatuses(tx, TENANT))).toEqual([
      ...DEFAULT_OFFICE_STATUSES,
    ]);
    await inTenant((tx) => writeOfficeStatuses(tx, TENANT, LIST));
  });

  it("רשימה ריקה נשמרת כריקה ואינה חוזרת לברירות המחדל", async () => {
    await inTenant((tx) => writeOfficeStatuses(tx, TENANT, []));
    expect(await inTenant((tx) => readOfficeStatuses(tx, TENANT))).toEqual([]);
    await inTenant((tx) => writeOfficeStatuses(tx, TENANT, LIST));
  });

  /*
   * ‎**זו שאילתת ה-`where` שרשימת הקונים מריצה**, ולא העתק שלה:
   * העמודה, שם המפה ב-Prisma והאינדקס החלקי נבדקים כאן יחד.
   */
  it("הסינון לפי סטטוס מחזיר בדיוק את מי שנושא אותו", async () => {
    const rows = await inTenant((tx) =>
      tx.buyer.findMany({
        where: { tenantId: TENANT, deletedAt: null, officeStatus: "s2" },
        select: { id: true, maturity: true },
      }),
    );
    expect(rows.map((r) => r.id).sort()).toEqual([
      "01STATUSBUYERAAAAAAAAAAAAA",
      "01STATUSBUYERBBBBBBBBBBBBB",
    ]);
    /* הסטטוס גורר את הדרגה, ולכן הצטלבות איתה אינה יכולה לרוקן. */
    expect(rows.every((r) => r.maturity === "hot")).toBe(true);
  });

  it("כרטיס בלי סטטוס אינו נגרר לשום סינון", async () => {
    const rows = await inTenant((tx) =>
      tx.buyer.findMany({
        where: { tenantId: TENANT, officeStatus: { not: null } },
        select: { id: true },
      }),
    );
    expect(rows).toHaveLength(3);
  });

  /*
   * הבדיקה שמכריעה בין מחיקה להסתרה. שאילתה שגויה כאן הייתה מוחקת
   * סטטוס שכרטיסים נושאים — כלומר הופכת אותם ל„סטטוס לא ידוע”.
   */
  it("ספירת השימוש היא מה שמחליט אם מוחקים או מסתירים", async () => {
    const inUse = await inTenant((tx) =>
      tx.buyer.count({ where: { officeStatus: "s2", deletedAt: null } }),
    );
    const free = await inTenant((tx) =>
      tx.buyer.count({ where: { officeStatus: "s3", deletedAt: null } }),
    );
    expect(inUse).toBe(2);
    expect(free).toBe(0);
  });

  /*
   * ‎**קונה בארכיון עדיין נושא את הסטטוס** (ביקורת Codex).
   *
   * הספירה סיננה `deletedAt: null`, ולכן סטטוס שרק כרטיסים בארכיון
   * נשאו נמחק לגמרי — ושחזור של אחד מהם היה מחזיר כרטיס עם מזהה
   * שאינו נפתר לשום תווית. „היסטוריה נשמרת” חייב לכלול את מה
   * שבארכיון, אחרת הוא לא נשמר.
   */
  it("ספירת השימוש כוללת קונים בארכיון", async () => {
    await owner!.$executeRaw`
      INSERT INTO buyers (id, tenant_id, contact_id, requirements, deal_type, source,
                          maturity, office_status, deleted_at, created_at, updated_at)
      VALUES ('01STATUSBUYERARCHIVEDAAAAA', ${TENANT}, ${CONTACT}, '{}'::jsonb, 'sale', 'manual',
              'hot', 's9', now(), now(), now())
      ON CONFLICT (id) DO NOTHING
    `;
    const all = await inTenant((tx) => tx.buyer.count({ where: { officeStatus: "s9" } }));
    const liveOnly = await inTenant((tx) =>
      tx.buyer.count({ where: { officeStatus: "s9", deletedAt: null } }),
    );
    expect(all).toBe(1);
    /* הגרסה השגויה ספרה כך, וקיבלה „אף אחד לא נושא אותו”. */
    expect(liveOnly).toBe(0);
    await owner!.$executeRaw`DELETE FROM buyers WHERE id = '01STATUSBUYERARCHIVEDAAAAA'`;
  });

  /*
   * ‎**הנעילה נבדקת ולא מונחת.**
   *
   * ‎`NOWAIT` הופך את ההמתנה לשגיאה מיידית, ולכן הבדיקה דטרמיניסטית
   * ואינה תלויה בתזמון: או שהנעילה תפוסה, או שאינה.
   */
  it("FOR UPDATE על שורת המשרד מסדר עריכות הגדרות בתור", async () => {
    let blocked = false;
    await owner!.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM tenants WHERE id = ${TENANT} FOR UPDATE`;
      await other!
        .$queryRaw`SELECT id FROM tenants WHERE id = ${TENANT} FOR UPDATE NOWAIT`
        .then(() => {
          blocked = false;
        })
        .catch(() => {
          blocked = true;
        });
    });
    expect(blocked).toBe(true);
  });

  /*
   * הצד השני של אותו זוג: שיוך סטטוס לשני קונים במקביל **אינו**
   * אמור להסתדר בתור — רק מול עריכת ההגדרות.
   */
  it("FOR SHARE אינו חוסם FOR SHARE, אבל כן חוסם עריכת הגדרות", async () => {
    let shareBlocked = false;
    let updateBlocked = false;
    await owner!.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM tenants WHERE id = ${TENANT} FOR SHARE`;
      await other!
        .$queryRaw`SELECT id FROM tenants WHERE id = ${TENANT} FOR SHARE NOWAIT`
        .catch(() => {
          shareBlocked = true;
        });
      await other!
        .$queryRaw`SELECT id FROM tenants WHERE id = ${TENANT} FOR UPDATE NOWAIT`
        .catch(() => {
          updateBlocked = true;
        });
    });
    expect(shareBlocked).toBe(false);
    expect(updateBlocked).toBe(true);
  });

  it("העמודה מקבלת מזהה באורך המלא ומחזירה אותו כמו שהוא", async () => {
    const long = "a".repeat(24);
    await owner!.$executeRaw`
      UPDATE buyers SET office_status = ${long} WHERE id = '01STATUSBUYERCCCCCCCCCCCCC'
    `;
    const row = await inTenant((tx) =>
      tx.buyer.findUnique({
        where: { id: "01STATUSBUYERCCCCCCCCCCCCC" },
        select: { officeStatus: true },
      }),
    );
    expect(row?.officeStatus).toBe(long);
    await owner!.$executeRaw`
      UPDATE buyers SET office_status = 's1' WHERE id = '01STATUSBUYERCCCCCCCCCCCCC'
    `;
  });
});
