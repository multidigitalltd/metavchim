import { describe, expect, it, vi } from "vitest";
import { RECORDING_SWEEP_FAIR_SHARE, RECORDING_SWEEP_MAX } from "@metavchim/shared";
import { RecordingFetchService } from "./recording-fetch.service";

/**
 * ‎**התור משותף לכל המשרדים — והחלוקה שלו הייתה „מי שהגיע ראשון”.**
 *
 * ## ‏מה קרה
 *
 * ‎`pending()` מנתה את המשרדים בסדר שהמסד החזיר, ונתנה לכל אחד את
 * ‏**כל התקציב הפנוי**. משרד אחד עם מאה הקלטות ממתינות — אחרי ייבוא
 * ‏היסטורי, למשל — לקח את כל עשרים המקומות בכל סבב, והשאר לא נמשכו
 * ‏כלל עד שהוא סיים.
 *
 * ‏זו הרעבה ולא איטיות: מבחינת המשרד השני שום דבר לא זז, והמסך
 * ‏הבטיח לו „בדרך מהמרכזייה” שעה אחר שעה.
 *
 * ## ‏מה נבדק כאן
 *
 * ‏שלוש התכונות שהמנגנון חייב לקיים **יחד**, וכל אחת מהן נשברת
 * ‏בשורה אחת: הגינות, ניצול מלא, וסיבוב הבכורה.
 */

/** ‏משרד עם `pending` הקלטות ממתינות, לצורך הבדיקה. */
const backlog = (tenantId: string, count: number) =>
  Array.from({ length: count }, (_, index) => ({
    callId: `${tenantId}-call-${index}`,
    tenantId,
  }));

/**
 * ‏שירות עם מסד מדומה ועם `pendingFor` מוחלף: מה שנבדק הוא
 * ‎**החלוקה**, לא השאילתה — וזו בדיוק השכבה שנשברה.
 */
function serviceWith(offices: Record<string, number>): RecordingFetchService {
  const prisma = {
    tenant: {
      findMany: () =>
        Promise.resolve(Object.keys(offices).sort().map((id) => ({ id }))),
    },
  };
  const service = new RecordingFetchService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const served = new Map<string, number>();
  vi.spyOn(
    service as unknown as {
      pendingFor: (t: string, n: number, take: number, exclude?: readonly string[]) => unknown;
    },
    "pendingFor",
  ).mockImplementation((tenantId: string, _now: number, take: number) => {
    const alreadyServed = served.get(tenantId) ?? 0;
    const left = Math.max(0, (offices[tenantId] ?? 0) - alreadyServed);
    const give = Math.min(take, left);
    served.set(tenantId, alreadyServed + give);
    return Promise.resolve(backlog(tenantId, give).slice(0, give));
  });
  return service;
}

const sweep = async (service: RecordingFetchService): Promise<string[]> => {
  const jobs = (await (
    service as unknown as { pending: () => Promise<{ tenantId: string }[]> }
  ).pending()) as { tenantId: string }[];
  return jobs.map((job) => job.tenantId);
};

describe("חלוקת תור ההקלטות בין משרדים", () => {
  /*
   * ‎**התכונה המרכזית.** משרד עם גיבוי ענק ומשרד עם שתי הקלטות —
   * ‏השני חייב להימשך באותו סבב, ולא אחרי שהראשון יסיים.
   */
  it("משרד עם גיבוי ענק אינו מרעיב את השאר", async () => {
    const service = serviceWith({ "01BIG": 500, "01SMALL": 2 });
    const served = await sweep(service);
    expect(served.filter((id) => id === "01SMALL")).toHaveLength(2);
    expect(served.filter((id) => id === "01BIG").length).toBeLessThanOrEqual(
      RECORDING_SWEEP_MAX - 2,
    );
  });

  /*
   * ‎**ואף אחד אינו לוקח הכול לפני שכולם קיבלו.** ארבעה משרדים
   * ‏עמוסים — כל אחד מקבל לכל היותר מנה במעבר הראשון, והתקציב
   * ‏מתחלק ביניהם.
   */
  it("אף משרד אינו חוצה את המנה כשיש מתחרים", async () => {
    const service = serviceWith({ "01A": 100, "01B": 100, "01C": 100, "01D": 100 });
    const served = await sweep(service);
    expect(served).toHaveLength(RECORDING_SWEEP_MAX);
    for (const id of ["01A", "01B", "01C", "01D"]) {
      expect(served.filter((tenant) => tenant === id)).toHaveLength(RECORDING_SWEEP_FAIR_SHARE);
    }
  });

  /*
   * ‎**ומנה שווה אינה הופכת לבזבוז.** משרד יחיד שעובד לבדו מנצל
   * ‏את התקציב כולו — זה מה שמעבר היתרה קיים בשבילו. בלעדיו הוא
   * ‏היה מושך מנה אחת בסבב, וההגינות הייתה עולה למי שאין לו
   * ‏מתחרים כלל.
   */
  it("משרד יחיד מנצל את התקציב כולו", async () => {
    const service = serviceWith({ "01ONLY": 500 });
    expect(await sweep(service)).toHaveLength(RECORDING_SWEEP_MAX);
  });

  /*
   * ‎**והבכורה מתחלפת.** הרשימה יציבה, ולכן בלי הסמן אותו משרד היה
   * ‏ראשון תמיד — וגם חלוקת היתרה הייתה מתחילה ממנו בכל פעם.
   */
  it("מי שפותח את הסבב מתחלף", async () => {
    const service = serviceWith({ "01A": 500, "01B": 500, "01C": 500, "01D": 500 });
    const first = (await sweep(service))[0];
    const second = (await sweep(service))[0];
    expect(second).not.toBe(first);
  });

  /*
   * ‏„נגמרו לו” ו„לא הגיע תורו” הם שני מצבים שונים: משרד שלא מילא
   * ‏את מנתו אינו נשאל שוב, כי אין לו עוד — שאילתה נוספת עליו היא
   * ‏עבודה למסד בלי תוצאה.
   */
  it("משרד שמנתו לא התמלאה אינו נשאל שוב", async () => {
    const service = serviceWith({ "01TINY": 1, "01BIG": 500 });
    const spy = (service as unknown as { pendingFor: ReturnType<typeof vi.fn> }).pendingFor;
    await sweep(service);
    const asked = spy.mock.calls.filter((call: unknown[]) => call[0] === "01TINY");
    expect(asked).toHaveLength(1);
  });
});
