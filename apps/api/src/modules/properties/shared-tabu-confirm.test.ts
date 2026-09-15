import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TenantContext } from "../../common/tenant-context";
import type { PrismaService } from "../../core/prisma.service";
import { PropertiesService } from "./properties.service";
import { fieldsToColumns } from "./property.mapper";

/**
 * ‎**„מי כבר נשאל” — ולא מצב שלישי בעמודה.**
 *
 * ‏מנוע ההתאמות **פוסל** נכס בטאבו משותף מקונה שסירב. נכס שרשום
 * ‏במשותף ולא סומן נקרא `false`, ולכן הוא מוצע דווקא למי שאמר
 * ‏„לא”. ‎`NULL` בדגל עצמו לא היה פותר: או שהוא נקרא כ„לא” ושום
 * ‏דבר לא משתנה, או שהוא חוסם — וכל המאגר הקיים מפסיק להיות מוצע.
 *
 * ‏לכן החותמת נפרדת מהדגל, וזו הטענה שנשמרת כאן: **מה שכותב אותה
 * ‏הוא תשובה, ולא שמירה.** חותמת שאפשר לקבל בטעות אינה עדות, והמסך
 * ‏שנשען עליה היה מתרוקן בלי שאיש בדק דבר.
 */

const TENANT = "01TENANTAAAAAAAAAAAAAAAAAA";
const PROP = "01PROPAAAAAAAAAAAAAAAAAAAA";

interface Call {
  model: string;
  method: string;
  args: Record<string, unknown>;
}

function serviceFor(
  rows: Record<string, unknown>[],
  current: Record<string, unknown> | null = { propertyType: null },
): { service: PropertiesService; calls: Call[] } {
  const calls: Call[] = [];
  const model = (name: string): unknown =>
    new Proxy(
      {},
      {
        get: (_t, method: string) => (args: Record<string, unknown>) => {
          calls.push({ model: name, method, args: args ?? {} });
          if (name === "property" && method === "findMany") return Promise.resolve(rows);
          if (name === "property" && method === "findFirst") return Promise.resolve(current);
          if (method === "count") return Promise.resolve(7);
          if (method === "findMany") return Promise.resolve([]);
          if (method === "findFirst" || method === "findUnique") return Promise.resolve(null);
          return Promise.resolve({ count: 1 });
        },
      },
    );
  const models: Record<string, unknown> = {};
  const tx = new Proxy(
    {},
    {
      get: (_t, name: string) => {
        if (name.startsWith("$")) return () => Promise.resolve([]);
        models[name] ??= model(name);
        return models[name];
      },
    },
  );
  const prisma = {
    withTenant: (run: (tx: unknown) => Promise<unknown>) => run(tx),
  } as unknown as PrismaService;
  const none = {} as never;
  return {
    service: new PropertiesService(
      prisma,
      none,
      none,
      { recomputeForProperty: () => Promise.resolve() } as never,
      none,
      none,
      none,
      none,
      none,
      none,
      none,
      none,
    ),
    calls,
  };
}

function asAgent<T>(fn: () => T): T {
  return TenantContext.run(
    {
      tenantId: TENANT,
      userId: "01MEAAAAAAAAAAAAAAAAAAAAAA",
      capabilities: new Set(["properties.view", "properties.edit"]),
      billingOnly: false,
    } as never,
    fn,
  );
}

describe("‏רשימת מה שטרם נבדק", () => {
  it("‏שואלת על חותמת ריקה — ולא על ערך הדגל", async () => {
    const { service, calls } = serviceFor([]);
    await asAgent(() => service.sharedTabuReview(50));
    const where = (calls[0]?.args as { where: Record<string, unknown> }).where;
    expect(where).toEqual({ tenantId: TENANT, deletedAt: null, sharedTabuConfirmedAt: null });
    /* ‏„מסומן כלא-משותף” אינו קריטריון: השאלה היא מי נשאל */
    expect(where["sharedTabu"]).toBeUndefined();
  });

  /*
   * ‏המונה הוא כמה **נשאר**, לא כמה הוחזרו: מסך שאומר „50” על
   * ‏אלף שורות מבטיח עבודה של דקה ומספק שעה.
   */
  it("‏מחזירה את המונה המלא לצד העמוד", async () => {
    const { service } = serviceFor([]);
    const res = await asAgent(() => service.sharedTabuReview(50));
    expect(res.remaining).toBe(7);
    expect(res.items).toEqual([]);
  });

  /*
   * ‎**הערך המוצג הוא מה שהמנוע קורא** — הדגל **או** הסוג הישן.
   * ‏שורה שסוגה הוא הייצוג הישן מוצגת כ„משותף”, אחרת המסך היה
   * ‏שואל שאלה שסותרת את מה שכבר קורה בהתאמות.
   */
  it("‏מציגה את הסוג הישן כמשותף, גם כשהדגל כבוי", async () => {
    const { service } = serviceFor([
      {
        id: PROP,
        city: "בני ברק",
        street: null,
        houseNumber: null,
        propertyType: "shared_tabu",
        priceAgorot: null,
        sharedTabu: false,
        updatedAt: new Date(),
      },
    ]);
    const res = await asAgent(() => service.sharedTabuReview(50));
    expect(res.items[0]?.sharedTabu).toBe(true);
  });
});

describe("‏התשובה", () => {
  /**
   * ‎**היא אינה כותבת שורה משלה — היא קוראת ל-`update`**
   * ‏(ביקורת Codex, שני P1 שהם אותה תקלה).
   *
   * ‏הניסוח הראשון כתב את השורה ישירות, ולכן דילג על מה שהעדכון
   * ‏הרגיל עושה **אחרי** הכתיבה: חישוב ההתאמות מחדש וסנכרון
   * ‏המודעות המפורסמות. נכס שאושר כ„משותף” המשיך להיות מוצע
   * ‏לקונה שסירב ולהתפרסם למשרדים אחרים כלא-משותף.
   *
   * ‏הבדיקה היא על **התפר**: מה נמסר לעדכון. מה שהעדכון עושה עם
   * ‏זה כבר נבדק אצלו, ושכפול הטענה כאן היה יוצר בדיוק את המקור
   * ‏הכפול שהתיקון מסלק.
   */
  it("‏מוסרת לעדכון הרגיל את הדגל ואת „נשאל”", async () => {
    const { service } = serviceFor([]);
    const seen: unknown[] = [];
    (service as unknown as { update: unknown }).update = async (...args: unknown[]) => {
      seen.push(args);
      return undefined;
    };
    await asAgent(() => service.confirmSharedTabu(PROP, true));
    expect(seen).toHaveLength(1);
    expect((seen[0] as unknown[])[0]).toBe(PROP);
    expect((seen[0] as unknown[])[1]).toEqual({ sharedTabu: true, sharedTabuAnswered: true });
  });

  it("‏וכיבוי נמסר כערך ולא כהיעדר", async () => {
    const { service } = serviceFor([]);
    const seen: unknown[] = [];
    (service as unknown as { update: unknown }).update = async (...args: unknown[]) => {
      seen.push(args);
      return undefined;
    };
    await asAgent(() => service.confirmSharedTabu(PROP, false));
    expect((seen[0] as unknown[])[1]).toEqual({ sharedTabu: false, sharedTabuAnswered: true });
  });

  /*
   * ‏„לא משותף” על שורה שסוגה הוא הייצוג הישן פורש גם את הסוג —
   * ‏אחרת `isSharedTabuProperty` היה מחזיר `true` בקריאה הבאה,
   * ‏והתשובה הייתה מתהפכת מעצמה. הכלל חי ב-`fieldsToColumns`,
   * ‏ומכיוון שהתשובה עוברת דרך `update` היא מקבלת אותו — כולל
   * ‏מסירת השורה השמורה — בלי ניסוח שני.
   */
  it("‏והמיפוי המשותף עדיין פורש את הסוג הישן", () => {
    const columns = fieldsToColumns({ sharedTabu: false }, { propertyType: "shared_tabu" });
    expect(columns.sharedTabu).toBe(false);
    expect(columns.propertyType).toBeNull();
  });
});

/**
 * ‎**ומה שהעדכון עושה אחרי הכתיבה — כי זה מה שהתשובה קונה בכך
 * ‏שהיא עוברת דרכו.**
 *
 * ‏שער מבני: הטענה היא שהעדכון **הוא** המקום שבו שני האפקטים
 * ‏קורים. אם הם ייצאו ממנו, התשובה תדלג עליהם שוב בשקט — וזו
 * ‏בדיוק הצורה שבה התיקון הזה יכול להיעלם.
 */
const SERVICE_SOURCE = readFileSync(join(__dirname, "properties.service.ts"), "utf8");

/**
 * ‏גוף המתודה: מהחתימה ועד הסוגר הסוגר בהזחה של שני רווחים.
 *
 * ‏חיתוך „עד המתודה הבאה שאני זוכר” נשבר בשקט ברגע שמתודה נוספת
 * ‏נכנסת ביניהן — וזה בדיוק מה שקרה כאן: הטענה „היצירה אינה נוגעת
 * ‏בחותמת” נבדקה על קטע שכלל גם את הרשימה וגם את התשובה, ששתיהן
 * ‏נוגעות בה בצדק.
 */
function body(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start, `‏${signature} לא נמצאה`).toBeGreaterThan(-1);
  const end = source.indexOf("\n  }\n", start);
  expect(end, `‏סוף ${signature} לא נמצא`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("‏העדכון הרגיל מרענן התאמות ומודעות", () => {
  const SERVICE = SERVICE_SOURCE;
  const UPDATE = body(SERVICE, "  async update(");

  it("‏חישוב ההתאמות מחדש", () => {
    expect(UPDATE).toContain("recomputeForProperty");
  });

  it("‏וסנכרון המודעות המפורסמות", () => {
    expect(UPDATE).toContain("resyncForProperty");
  });

  it("‏והתשובה עוברת דרכו", () => {
    const at = SERVICE.indexOf("  async confirmSharedTabu(");
    expect(at, "‏התשובה לא נמצאה").toBeGreaterThan(-1);
    /* ‏גוף המתודה בלבד — עד הסוגר הסוגר בהזחה של שני רווחים */
    const confirm = SERVICE.slice(at, SERVICE.indexOf("\n  }\n", at));
    expect(confirm).toContain("this.update(id, { sharedTabu, sharedTabuAnswered: true })");
    /* ‏ואינה כותבת שורה משלה */
    expect(confirm).not.toContain("property.update(");
  });
});

describe("‏מה **אינו** מסמן „נבדק”", () => {
  /*
   * ‎**זו הטענה המרכזית.** טופס העריכה שולח את מצבו המלא כולל
   * ‏התיבה, ולכן אילו השמירה הרגילה הייתה חותמת — הרשימה הייתה
   * ‏מתרוקנת מעצמה עם הזמן בלי שאיש הסתכל על השאלה, והמסך היה
   * ‏מבטיח בדיקה שלא קרתה.
   */
  it("‏המיפוי של טופס העריכה אינו נוגע בחותמת", () => {
    const columns = fieldsToColumns({ sharedTabu: true }, { propertyType: null });
    expect("sharedTabuConfirmedAt" in columns).toBe(false);
  });
});

/**
 * ‎**החותמת מהקליטה נכתבת בטרנזקציה של היצירה** (ביקורת Codex, P1).
 *
 * ‏היא הייתה עדכון שני, אחרי ש-`persist` כבר נסגרה. כישלון בו הפיל
 * ‏את `createFromIntake`, ו-`draftFor` שחרר את המזהה השמור כאילו
 * ‏היצירה נכשלה — בזמן שהנכס קיים. השליחה הבאה הייתה יוצרת נכס
 * ‏שני, והראשון נשאר יתום: בדיוק התקלה שהמזהה-מראש נועד למנוע.
 */
describe("‏קליטה שנשאלה — כתיבה אחת", () => {
  const SERVICE = SERVICE_SOURCE;
  const CREATE = body(SERVICE, "  async createFromIntake(");

  it("‏אין עדכון שני אחרי היצירה", () => {
    expect(CREATE).not.toContain("sharedTabuConfirmedAt");
    expect(CREATE).not.toContain("property.updateMany");
  });

  it("‏והתשובה נוסעת לתוך `persist`", () => {
    expect(CREATE).toContain("sharedTabuConfirmed: input.sharedTabuAnswered");
  });

  /* ‏ושם היא נכתבת באותה `create` של השורה עצמה */
  it("‏ו-`persist` כותבת אותה עם השורה", () => {
    const persist = body(SERVICE, "  private async persist(");
    const at = persist.indexOf("tx.property.create(");
    expect(at, "‏היצירה לא נמצאה").toBeGreaterThan(-1);
    /* ‏עד סוף אובייקט ה-`data` של אותה קריאה */
    const create = persist.slice(at, persist.indexOf("      });", at));
    expect(create).toContain("sharedTabuConfirmedAt: new Date()");
  });
});

/**
 * ‎**ותשובה שהגיעה בשליחה חוזרת היא תשובה** (ביקורת Codex, P2).
 *
 * ‏בעלים שהשאיר את השאלה ריקה וענה עליה בשליחה שנייה קיבל את הערך
 * ‏שמור בשדה — והנכס נשאר בתור הסקירה. החותמת סתרה את מה שהיא
 * ‏אמורה לתאר.
 */
describe("‏שליחה חוזרת של המוכר", () => {
  const INTAKE = readFileSync(join(__dirname, "../intake/intake.service.ts"), "utf8");
  const DRAFT = INTAKE.slice(INTAKE.indexOf("  private async draftFor("));

  it("‏„האם נשאל” מחושב פעם אחת לשני המסלולים", () => {
    expect(DRAFT.split("answers.sharedTabu !== undefined").length - 1).toBe(1);
  });

  it("‏והעדכון של השליחה החוזרת מוסר אותו", () => {
    const resubmit = DRAFT.slice(DRAFT.indexOf("this.properties.update("));
    expect(resubmit.slice(0, 600)).toContain("sharedTabuAnswered");
  });
});
