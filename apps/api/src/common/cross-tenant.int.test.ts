import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * בידוד הדיירים — **נבדק מול מסד אמיתי, לא מול הקוד שמעליו.**
 *
 * ## מה זה מוסיף על `rls-access.test.ts`
 *
 * הבדיקה המבנית שלצידה אוסרת על קוד לגשת ל-Prisma בלי הקשר דייר.
 * היא בודקת את הכתיבה שלנו. היא אינה יכולה לבדוק את הדבר שהיא
 * מסתמכת עליו: שמדיניות ה-RLS **במסד** באמת חוסמת. פוליסה עם תנאי
 * שגוי, `FORCE` שנשכח, או טבלה חדשה בלי פוליסה כלל — כל אלה עוברים
 * את הבדיקה המבנית בהצלחה מלאה.
 *
 * כאן מרימים מסד, מריצים את כל המיגרציות, שותלים נתונים לשני
 * דיירים, ומנסים — **כתפקיד האפליקציה עצמו** — לקרוא, לעדכן ולמחוק
 * את השורות של הדייר השני.
 *
 * ## למה דווקא כתפקיד האפליקציה
 *
 * זה התפקיד שה-API מתחבר איתו בייצור. בדיקה כבעלים הייתה מודדת
 * משהו אחר: לבעלים יש `FORCE ROW LEVEL SECURITY` אבל גם הרשאות
 * אחרות, ובמסד שבו הבעלים הוא Superuser (כמו אצלנו) הוא עוקף
 * פוליסות לגמרי. כלומר בדיקה כבעלים הייתה מדווחת "עבר" על מסד
 * פרוץ לחלוטין.
 *
 * ## למה זה נבדק על **כל** טבלה ולא על מדגם
 *
 * רשימה ידנית של טבלאות רגישות היא רשימה שמישהו ישכח לעדכן, וטבלה
 * חדשה שנוספת בלי פוליסה היא בדיוק הכשל שאיש לא יגלה. הרשימה נגזרת
 * מקטלוג המסד בזמן ריצה: כל טבלה עם `tenant_id` נבדקת, ומי שאינה
 * מוגנת חייבת להופיע ברשימת החריגים המנומקת שלמטה.
 *
 * ## למה זה לא רץ ב-`pnpm test`
 *
 * הוא דורש Postgres. בדיקות היחידה חייבות להישאר מיידיות ובלי
 * תשתית, אחרת מפסיקים להריץ אותן. הסוויטה הזו רצה ב-`pnpm test:rls`
 * ובמשימת CI נפרדת.
 */

/**
 * טבלאות שיש להן `tenant_id` ובכל זאת אינן תחת RLS — **וזה נכון.**
 *
 * לכל אחת אותה סיבה במהות: היא נקראת ברגע שבו עדיין אין דייר לדעת
 * מיהו, כלומר הפוליסה הייתה חוסמת את השאילתה שמגלה את הדייר. מי
 * שמוסיף כאן שורה חייב להסביר למה, וההסבר צריך להיות מהסוג הזה.
 */
const RLS_EXEMPT: Readonly<Record<string, string>> = {
  // ההתחברות מחפשת משתמש לפי אימייל, לפני שידוע לאיזה משרד הוא שייך
  users: "נקראת באימות, לפני שיש הקשר דייר",
  // הפועל קורא את התור של כל הדיירים יחד
  outbox_events: "תור יוצא שנצרך ע\"י ה-Worker חוצה-דיירים",
  // מסך הפלטפורמה והחיוב עובדים על פני כל המשרדים
  subscriptions: "ניהול מנויים ברמת הפלטפורמה",
  payments: "סליקה וחיוב ברמת הפלטפורמה",
  // נקראות גם בזרימת הוובהוק של קארדקום — נתיב ציבורי בלי הקשר דייר
  subscription_offers: "הצעות מנוי בלינק — סליקה ברמת הפלטפורמה, כמו payments",
  rented_numbers: "השכרת מספרים מ-015 — מופעלת מהוובהוק ונסרקת חוצה-דיירים, כמו payments",
  // הנתיב הציבורי מקבל מפתח וממנו מגלה את הדייר
  lead_webhooks: "מפתח הקליטה הציבורי הוא מה שמזהה את הדייר",
  email_reply_tokens: "הטוקן שבכתובת ה-Reply-To הוא מה שמזהה את הדייר בתשובה נכנסת",
  telephony_webhook_hits: "יומן קליטה שנכתב לפני זיהוי הדייר",
  // הוובהוק מקבל מספר וממנו מגלה את המשתמש ואת המשרד שלו
  whatsapp_links: "הקישור עצמו הוא מה שמזהה את הדייר בערוץ הוואטסאפ",
};

const TENANT_A = "01TENANTAAAAAAAAAAAAAAAAAA";
const TENANT_B = "01TENANTBBBBBBBBBBBBBBBBBB";
/** אות אחת שמבדילה בין השורות של שני הדיירים גם בעמודה קצרה. */
const MARK: Readonly<Record<string, string>> = { [TENANT_A]: "A", [TENANT_B]: "B" };

/**
 * ערכים שהמחולל אינו יכול להסיק — **וכל אחד מהם מנומק.**
 *
 * המחולל מכסה טיפוסים ורשימות ערכים סגורות. מה שהוא אינו יכול
 * לנחש הוא אילוץ שמדבר על **יחס בין עמודות**. כאן מספיקה שורה
 * אחת, והשער שלמטה יצעק אם תיווצר טבלה כזו ולא תטופל.
 */
const SEED_OVERRIDES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  // `interaction_exactly_one_parent`: אינטראקציה תלויה בליד או בקונה,
  // ובדיוק באחד מהם. שניהם NULL — וזה בדיוק מה שממלא רק חובה נותן.
  interactions: { lead_id: "'01SEEDLEADAAAAAAAAAAAAAAAA'" },
  /*
   * `property_twins_canonical_order`: הזוג נשמר בסדר קנוני
   * (`property_a_id` < `property_b_id`), ולכן שני מזהים זהים —
   * מה שהמחולל הגנרי מייצר לשתי עמודות מאותו טיפוס — מפרים אותו.
   */
  property_twins: {
    property_a_id: "'01SEEDTWINAAAAAAAAAAAAAAAA'",
    property_b_id: "'01SEEDTWINBBBBBBBBBBBBBBBB'",
  },
  /*
   * `intake_requests_card_required`: קישור לכרטיס חייב להצביע על
   * כרטיס ועל איש קשר; רק `subject = 'open'` מתחיל בלעדיהם. המחולל
   * בוחר את הערך הראשון שה-CHECK מתיר (`lead`), ומשאיר את שתי
   * העמודות הנילות ריקות — כלומר בדיוק את הצירוף שאינו חוקי.
   */
  intake_requests: {
    subject_id: "'01SEEDINTAKESUBJECTAAAAAAA'",
    contact_id: "'01SEEDINTAKECONTACTAAAAAAA'",
  },
};

interface Column {
  name: string;
  type: string;
  nullable: boolean;
  hasDefault: boolean;
  maxLength: number | null;
  udtName: string;
}

let owner: PrismaClient;
let app: PrismaClient;
/** כל טבלה עם `tenant_id`, ומה מצב ה-RLS שלה בפועל. */
let tenantTables: { name: string; forced: boolean }[] = [];
/** הטבלאות שנשתלו בהצלחה — עליהן הבדיקות מדווחות. */
const seeded: string[] = [];
/** למי מהן יש `updated_at`, כלומר עמודה שבטוח לנסות לכתוב אליה. */
let withUpdatedAt = new Set<string>();

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      `${name} חסר. הסוויטה הזו דורשת Postgres אמיתי — ראו docs/04 §בידוד דיירים.`,
    );
  }
  return value;
}

/**
 * ערך דמה לעמודה, לפי הטיפוס שלה.
 *
 * השתילה גנרית בכוונה: היא חייבת לכסות כל טבלה, כולל טבלה שתיווצר
 * מחר. מה שנשתל חסר משמעות עסקית — הבדיקה שואלת רק "האם דייר אחד
 * רואה שורה של השני", ולזה מספיקה שורה תקינה מבחינת טיפוסים.
 */
function dummyValue(column: Column, tenantId: string): string {
  if (column.name === "tenant_id") return `'${tenantId}'`;
  const type = column.type.toLowerCase();
  if (type === "array") return "'{}'";
  if (type === "jsonb" || type === "json") return `'{}'::${type}`;
  if (type === "boolean") return "false";
  if (type === "uuid") return "gen_random_uuid()";
  if (/int|numeric|decimal|real|double/u.test(type)) return "1";
  if (/timestamp|date|time/u.test(type)) return "now()";
  if (type === "bytea") return "'\\x00'::bytea";
  if (type === "user-defined") {
    // ENUM — הערך הראשון בקטלוג הוא ערך חוקי בהגדרה
    return `(SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
             WHERE t.typname = '${column.udtName}' ORDER BY e.enumsortorder LIMIT 1)::"${column.udtName}"`;
  }
  /*
   * טקסט: ייחודי פר-דייר כדי שאינדקסים ייחודיים לא יתנגשו בין שתי
   * השורות, וקצוץ לאורך המוגדר בעמודה — `VARCHAR(10)` דוחה מחרוזת
   * ארוכה יותר גם בשתילה.
   *
   * **סימן הדייר וסימן העמודה בראש המחרוזת**, ולא בסופה. כשהם
   * בסוף, קיצוץ ל-26 תווים מוחק בדיוק אותם: שתי עמודות שונות
   * קיבלו את אותו ערך, ואילוץ מסוג `a <> b` נפל על שתילה שנראית
   * תקינה. זה קרה בפועל.
   */
  const unique = `${MARK[tenantId] ?? "X"}-${column.name}-${tenantId}`.replace(
    /[^\w-]/gu,
    "",
  );
  const value = column.maxLength === null ? unique : unique.slice(0, column.maxLength);
  return `'${value}'`;
}

/**
 * ערך חוקי לעמודה שיש עליה `CHECK (col = ANY (ARRAY[...]))`.
 *
 * זו הצורה שבה Prisma מבטא רשימת ערכים סגורה בלי ENUM, והיא נפוצה
 * כאן (`effect`, `status`, `kind`). בלי הקריאה הזו כל טבלה כזו
 * הייתה נופלת בשתילה ונשארת בלי בדיקה — כלומר בלי הגנה.
 */
function allowedByCheck(defs: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const def of defs) {
    const match =
      /\(?\(?"?(\w+)"?\)?(?:::text)?\s*=\s*ANY\s*\(\(?ARRAY\[([^\]]+)\]/u.exec(def);
    if (!match) continue;
    const first = /'([^']*)'/u.exec(match[2]!);
    if (first) out[match[1]!] = `'${first[1]!}'`;
  }
  return out;
}

beforeAll(async () => {
  const ownerUrl = requiredEnv("DIRECT_DATABASE_URL");
  const appUrl = requiredEnv("APP_DATABASE_URL");
  owner = new PrismaClient({ datasources: { db: { url: ownerUrl } } });
  app = new PrismaClient({ datasources: { db: { url: appUrl } } });

  /* ---------- 1. אילו טבלאות נושאות דייר, ומה מצב ההגנה שלהן ---------- */
  tenantTables = await owner.$queryRawUnsafe<{ name: string; forced: boolean }[]>(`
    SELECT c.relname AS name,
           (c.relrowsecurity AND c.relforcerowsecurity) AS forced
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND EXISTS (
             SELECT 1 FROM information_schema.columns col
              WHERE col.table_schema = 'public'
                AND col.table_name = c.relname
                AND col.column_name = 'tenant_id')
     ORDER BY c.relname`);

  const updatedAtRows = await owner.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'updated_at'`,
  );
  withUpdatedAt = new Set(updatedAtRows.map((r) => r.table_name));

  /* ---------- 2. שתילת שורה לכל דייר בכל טבלה מוגנת ---------- */
  for (const table of tenantTables.filter((t) => t.forced)) {
    const columns = await owner.$queryRawUnsafe<Column[]>(
      `SELECT column_name AS name,
              data_type AS type,
              is_nullable = 'YES' AS nullable,
              column_default IS NOT NULL AS "hasDefault",
              character_maximum_length AS "maxLength",
              udt_name AS "udtName"
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1`,
      table.name,
    );
    const checks = await owner.$queryRawUnsafe<{ def: string }[]>(
      `SELECT pg_get_constraintdef(oid) AS def
         FROM pg_constraint
        WHERE conrelid = $1::regclass AND contype = 'c'`,
      table.name,
    );
    const fixed = {
      ...allowedByCheck(checks.map((c) => c.def)),
      ...(SEED_OVERRIDES[table.name] ?? {}),
    };
    /*
     * מה שחייבים למלא: לא-null בלי ברירת מחדל, תמיד `tenant_id`,
     * וגם כל עמודה שיש לה ערך כפוי — גם אם היא nullable. עמודה
     * שנשארת NULL אינה מפרה `CHECK` על ערך, אבל כן מפרה אילוץ
     * שמדבר על היחס בין שתי עמודות.
     */
    const needed = columns.filter(
      (c) =>
        c.name === "tenant_id" ||
        (!c.nullable && !c.hasDefault) ||
        fixed[c.name] !== undefined,
    );
    try {
      await owner.$transaction(async (tx) => {
        /*
         * שני מתגים, ושניהם נחוצים כדי לשתול גנרית:
         *
         * `session_replication_role` מכבה טריגרים של מפתחות זרים,
         * ובלעדיו כל שתילה הייתה דורשת לבנות עץ תלויות שלם רק כדי
         * להכניס שורה אחת.
         *
         * `row_security = off` — הבעלים כפוף ל-FORCE, ובלי הכיבוי
         * הוא לא היה יכול לשתול את השורות שהבדיקה אמורה לנסות
         * לקרוא. שניהם מקומיים לטרנזקציה ואינם נוגעים בתפקיד
         * האפליקציה, שהוא הנבדק.
         */
        await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
        await tx.$executeRawUnsafe(`SET LOCAL row_security = off`);
        /*
         * ניקוי לפני שתילה — **הסוויטה חייבת להיות ניתנת להרצה
         * חוזרת.** טבלה שמפתחה הראשי הוא `tenant_id` לבדו
         * (`referral_reputation`) התנגשה בהרצה השנייה, והכישלון
         * נראה כמו "טבלה שלא נבדקה" ולא כמו "שארית מהרצה קודמת".
         */
        await tx.$executeRawUnsafe(
          `DELETE FROM "${table.name}" WHERE tenant_id IN ('${TENANT_A}', '${TENANT_B}')`,
        );
        for (const tenantId of [TENANT_A, TENANT_B]) {
          const names = needed.map((c) => `"${c.name}"`).join(", ");
          const values = needed
            .map((c) => fixed[c.name] ?? dummyValue(c, tenantId))
            .join(", ");
          await tx.$executeRawUnsafe(
            `INSERT INTO "${table.name}" (${names}) VALUES (${values})`,
          );
        }
      });
      seeded.push(table.name);
    } catch {
      /*
       * טבלה שהשתילה הגנרית לא הצליחה בה (אילוץ CHECK, טיפוס
       * חריג) אינה מפילה את הסוויטה — היא פשוט לא תיבדק, והבדיקה
       * הראשונה למטה **תיכשל** אם נשארו כאלה. אין כאן בליעה
       * שקטה: החוסר מדווח בשמו.
       */
    }
  }
}, 120_000);

afterAll(async () => {
  await owner?.$disconnect();
  await app?.$disconnect();
});

/** מריץ שאילתה כתפקיד האפליקציה, עם או בלי הקשר דייר. */
async function asTenant<T>(
  tenantId: string | null,
  run: (tx: PrismaClient) => Promise<T>,
): Promise<T> {
  return app.$transaction(async (tx) => {
    if (tenantId !== null) {
      await tx.$executeRawUnsafe(
        `SELECT set_config('app.tenant_id', '${tenantId}', true)`,
      );
    }
    return run(tx as unknown as PrismaClient);
  });
}

async function countWhere(
  tx: PrismaClient,
  table: string,
  where: string,
): Promise<number> {
  const rows = await tx.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*) AS n FROM "${table}" WHERE ${where}`,
  );
  return Number(rows[0]?.n ?? 0n);
}

describe("בידוד דיירים מול מסד אמיתי", () => {
  it("כל טבלה עם tenant_id מוגנת, או מופיעה ברשימת החריגים המנומקת", () => {
    const unprotected = tenantTables
      .filter((t) => !t.forced)
      .map((t) => t.name)
      .filter((name) => RLS_EXEMPT[name] === undefined);
    expect(unprotected, "טבלאות עם tenant_id בלי RLS ובלי נימוק").toEqual([]);

    /*
     * והכיוון ההפוך: חריג שכבר אינו נחוץ. טבלה שהוגנה בינתיים
     * ונשארה ברשימה מרחיבה את החור בלי סיבה, והיא לא הייתה נתפסת
     * ע"י הבדיקה שמעל.
     */
    const stale = Object.keys(RLS_EXEMPT).filter(
      (name) => !tenantTables.some((t) => t.name === name && !t.forced),
    );
    expect(stale, "חריגים שאינם נחוצים עוד").toEqual([]);
  });

  it("השתילה כיסתה את כל הטבלאות המוגנות — אין טבלה שלא נבדקה", () => {
    const protectedTables = tenantTables.filter((t) => t.forced).map((t) => t.name);
    expect(protectedTables.length).toBeGreaterThan(30);
    expect(
      protectedTables.filter((name) => !seeded.includes(name)),
      "טבלאות שלא נשתלו ולכן לא נבדקו בפועל",
    ).toEqual([]);
  });

  it("דייר אינו רואה ולו שורה אחת של דייר אחר", async () => {
    const leaks = await asTenant(TENANT_A, async (tx) => {
      const found: string[] = [];
      for (const table of seeded) {
        const n = await countWhere(tx, table, `tenant_id = '${TENANT_B}'`);
        if (n > 0) found.push(`${table} (${n})`);
      }
      return found;
    });
    expect(leaks, "טבלאות שדלפו בין דיירים").toEqual([]);
  });

  it("ורואה את שלו — כדי שהבדיקה שמעל לא תעבור על מסד ריק", async () => {
    const missing = await asTenant(TENANT_A, async (tx) => {
      const found: string[] = [];
      for (const table of seeded) {
        const n = await countWhere(tx, table, `tenant_id = '${TENANT_A}'`);
        if (n === 0) found.push(table);
      }
      return found;
    });
    expect(missing, "טבלאות שבהן הדייר אינו רואה את עצמו").toEqual([]);
  });

  it("בלי הקשר דייר — אפס שורות בכל טבלה", async () => {
    const visible = await asTenant(null, async (tx) => {
      const found: string[] = [];
      for (const table of seeded) {
        const n = await countWhere(tx, table, "true");
        if (n > 0) found.push(`${table} (${n})`);
      }
      return found;
    });
    expect(visible, "טבלאות שנקראות בלי הקשר דייר").toEqual([]);
  });

  it("קריאת הרשת נפתחת רק בטבלאות שהוגדרו לכך במפורש", async () => {
    const readable = await app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '${TENANT_A}', true)`);
      await tx.$executeRawUnsafe(`SELECT set_config('app.network_read', 'on', true)`);
      const found: string[] = [];
      for (const table of seeded) {
        const n = await countWhere(
          tx as unknown as PrismaClient,
          table,
          `tenant_id = '${TENANT_B}'`,
        );
        if (n > 0) found.push(table);
      }
      return found;
    });
    /*
     * הרשימה סגורה ומוצהרת. הדגל הזה הוא הדרך היחידה לראות נתון
     * של משרד אחר, ולכן טבלה שנכנסת אליו בלי כוונה היא בדיוק
     * הדליפה שהסוויטה מחפשת — והיא לא הייתה נתפסת בשום בדיקה אחרת.
     */
    expect(readable.sort()).toEqual(
      [
        "referral_reputation",
        "referral_reputation_dimensions",
        "shared_demands",
        "shared_leads",
        "shared_listings",
        "tenant_settings",
      ].filter((name) => seeded.includes(name)),
    );
  });
  it("עדכון ומחיקה של שורת דייר אחר אינם נוגעים בכלום", async () => {
    const written: string[] = [];
    const errors: string[] = [];

    /*
     * **טרנזקציה נפרדת לכל טבלה, ושגיאה נספרת ולא נבלעת.**
     *
     * הגרסה הראשונה כאן עשתה בדיוק ההפך, ולכן עברה על מסד פרוץ:
     * שאילתת עזר שגויה הפילה את הטרנזקציה כבר בטבלה הראשונה,
     * ומשם כל משפט נוסף נענה ב-"current transaction is aborted".
     * ה-`catch` תרגם את זה ל-0 שורות מושפעות, כלומר ל-"לא דלף
     * כלום" — הדיווח הכי מרגיע שאפשר, על הבדיקה שאמורה להוכיח
     * שכתיבה חסומה.
     */
    for (const table of seeded) {
      try {
        await asTenant(TENANT_A, async (tx) => {
          if (withUpdatedAt.has(table)) {
            const updated = await tx.$executeRawUnsafe(
              `UPDATE "${table}" SET updated_at = now() WHERE tenant_id = '${TENANT_B}'`,
            );
            if (updated > 0) written.push(`${table} UPDATE (${updated})`);
          }
          const deleted = await tx.$executeRawUnsafe(
            `DELETE FROM "${table}" WHERE tenant_id = '${TENANT_B}'`,
          );
          if (deleted > 0) written.push(`${table} DELETE (${deleted})`);
        });
      } catch (error) {
        errors.push(`${table}: ${String(error).split("\n")[0]}`);
      }
    }

    expect(written, "טבלאות שבהן דייר שינה שורה של אחר").toEqual([]);
    /*
     * השגיאות נבדקות ולא מדולגות. שלוש הטבלאות האלה הן Append-Only
     * **בהרשאות עצמן** — הניסיון נענה ב-"permission denied", וזו
     * שכבת הגנה נוספת ולא כשל. כל שגיאה אחרת פירושה שהבדיקה לא רצה
     * בפועל על אותה טבלה, ואסור שזה ייראה כמו הצלחה.
     *
     * עד כה הרשימה כללה רק את `audit_log`, ולא מפני שכך תוכנן:
     * `create_app_role.sql` רץ **אחרי** המיגרציות ומחזיר GRANT על
     * כל הטבלאות, ולכן ה-REVOKE של שני ספרי הכסף — שנעשה במיגרציות
     * שיצרו אותם — בוטל בשקט בכל הקצאה. הם היו פתוחים לעדכון
     * ולמחיקה בעוד שלושה מקומות בקוד מצהירים שאינם. הרשימה כאן
     * היא מה שיגלה את זה אם יחזור.
     */
    const APPEND_ONLY = ["audit_log", "credit_ledger", "payout_ledger"];
    const unexpected = errors.filter(
      (line) => !APPEND_ONLY.some((table) => line.startsWith(`${table}:`)),
    );
    expect(unexpected, "טבלאות שבהן בדיקת הכתיבה לא רצה בכלל").toEqual([]);
    /*
     * כל אחת מהן חייבת לדחות — לא "לפחות אחת". ספר כסף שההרשאה
     * עליו חזרה בשקט הוא בדיוק הכשל שהתגלה כאן, וספירה מצרפית
     * הייתה ממשיכה לעבור כל עוד `audit_log` לבדו מוגן.
     */
    const rejecting = APPEND_ONLY.filter(
      (table) =>
        !seeded.includes(table) ||
        errors.some((line) => line.startsWith(`${table}:`)),
    );
    expect(rejecting, "טבלה Append-Only שלא דחתה כתיבה").toEqual(APPEND_ONLY);
  });

  it("שורות הדייר השני שרדו — ההוכחה שהחסימה עצרה כתיבה אמיתית", async () => {
    const survivors = await asTenant(TENANT_B, async (tx) =>
      countWhere(tx, seeded[0]!, `tenant_id = '${TENANT_B}'`),
    );
    expect(survivors).toBeGreaterThan(0);
  });

});
