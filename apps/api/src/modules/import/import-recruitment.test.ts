import { describe, expect, it } from "vitest";
import type { BuyersService } from "../buyers/buyers.service";
import type { LeadsService } from "../leads/leads.service";
import type { PropertiesService } from "../properties/properties.service";
import type { RecruitmentService } from "../recruitment/recruitment.service";
import { ImportController } from "./import.controller";

/**
 * ‎**ייבוא גיוס — מה שנקלט, מה שיורד, ומה שמפיל שורה.**
 *
 * ‏שער ההפרדה (`recruitment-separation.test.ts`) שואל **לאן** כותב
 * ‏המסלול. הבדיקה הזו שואלת **מה** נכנס לשם: היא מריצה את המתודה
 * ‏עצמה מול שירות מזויף, ולכן היא תופסת גם שינוי בסכימה שיתחיל
 * ‏לדחות שורות תקינות.
 */
function harness() {
  const created: Record<string, unknown>[] = [];
  const recruitment = {
    create: async (input: Record<string, unknown>) => {
      created.push(input);
      return {} as never;
    },
  } as unknown as RecruitmentService;

  const controller = new ImportController(
    {} as PropertiesService,
    {} as BuyersService,
    {} as LeadsService,
    recruitment,
  );
  return { controller, created };
}

/** ‏שורה מינימלית שהמפרק במסך מייצר ממודעה אמיתית. */
const AD = {
  city: "רעננה",
  street: "אחוזה",
  rooms: 4,
  priceAgorot: 265_000_000,
  source: "yad2",
  sourceUrl: "https://www.yad2.co.il/item/123",
  status: "called",
};

describe("ייבוא נכסים לגיוס", () => {
  it("שורה תקינה נקלטת עם כל השדות", async () => {
    const { controller, created } = harness();

    const result = await controller.importRecruitment({ rows: [AD] });

    expect(result).toMatchObject({ created: 1, failed: [] });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      city: "רעננה",
      priceAgorot: 265_000_000,
      source: "yad2",
      sourceUrl: "https://www.yad2.co.il/item/123",
      status: "called",
    });
  });

  /*
   * ‏שני המקרים למטה הם אותה הכרעה: השדה הפחות חשוב בשורה אינו
   * ‏מפיל את המודעה. מוטציה שתחזיר את הדחייה תיתפס כאן פעמיים —
   * ‏גם ב-`created` וגם בכך שהשדה **אכן ירד** ולא נשמר פסול.
   */
  /*
   * ‏„לא ידוע” אינו ערך מומצא: זו בדיוק העמודה שמתווך ממלא כשהוא
   * ‏מעתיק מודעות מיד2, שם הטלפון מוסתר עד שלוחצים. עמודה שלמה כזו
   * ‏הייתה מפילה את כל הקובץ.
   *
   * ‏שימו לב שהנרמול **סובלני**: `050-123-4567 (נייד)` עובר בשלום,
   * ‏כי הוא מסיר כל מה שאינו ספרה. מה שנופל הוא מה שאין בו מספר
   * ‏ישראלי בכלל.
   */
  it("טלפון בעלים פסול יורד — המודעה נקלטת עם אזהרה", async () => {
    const { controller, created } = harness();

    const result = await controller.importRecruitment({
      rows: [{ ...AD, ownerName: "ישראל ישראלי", ownerPhone: "לא ידוע" }],
    });

    expect(result.created).toBe(1);
    expect(result.failed).toEqual([]);
    expect(result.warnings[0]).toMatchObject({ row: 1 });
    expect(result.warnings[0]?.warning).toContain("טלפון");
    expect(created[0]).not.toHaveProperty("ownerPhone");
    // ‏שם הבעלים כן נשמר: רק השדה הפסול יורד
    expect(created[0]).toMatchObject({ ownerName: "ישראל ישראלי" });
  });

  it("קישור שאינו כתובת יורד — המודעה נקלטת עם אזהרה", async () => {
    const { controller, created } = harness();

    const result = await controller.importRecruitment({
      rows: [{ ...AD, sourceUrl: "מודעה 123 ביד2" }],
    });

    expect(result.created).toBe(1);
    expect(result.failed).toEqual([]);
    expect(result.warnings[0]?.warning).toContain("קישור");
    expect(created[0]).not.toHaveProperty("sourceUrl");
  });

  /*
   * ‏`ftp://` ו-`mailto:` הם כתובת תקינה לפי כל בודק גנרי, ואינם
   * ‏מודעה. הם עברו כאן ונדחו רק בשירות — שם הדחייה מפילה את השורה
   * ‏כולה, כלומר בדיוק מה שהקטע הזה נועד למנוע.
   */
  it.each(["ftp://example.com/x", "mailto:a@b.com", "javascript:alert(1)"])(
    "קישור בסכמה שאינה http(s) יורד ואינו מפיל את השורה — %s",
    async (sourceUrl) => {
      const { controller, created } = harness();

      const result = await controller.importRecruitment({ rows: [{ ...AD, sourceUrl }] });

      expect(result.created).toBe(1);
      expect(result.failed).toEqual([]);
      expect(created[0]).not.toHaveProperty("sourceUrl");
    },
  );

  /**
   * ‎**שורה שנפלה אינה מופיעה גם כ„נקלטה עם אזהרה”.**
   *
   * ‏המסך מציג `warnings` כשורות שנכנסו. שורה עם טלפון פסול *וגם*
   * ‏שדה זר הייתה מופיעה בשתי הרשימות, ואומרת למתווך שהיא בפנים
   * ‏בזמן שהיא בחוץ.
   */
  it("אזהרה על שדה שירד אינה נרשמת לשורה שנפלה", async () => {
    const { controller } = harness();

    const result = await controller.importRecruitment({
      rows: [{ ...AD, ownerPhone: "לא ידוע", marketingTitle: "דירה מרווחת" }],
    });

    expect(result.created).toBe(0);
    expect(result.failed).toHaveLength(1);
    expect(result.warnings).toEqual([]);
  });

  it("טלפון תקין נשמר ואינו מייצר אזהרה — גם כשהוא מלוכלך", async () => {
    const { controller, created } = harness();

    const result = await controller.importRecruitment({
      rows: [{ ...AD, ownerPhone: "050-123-4567 (נייד)" }],
    });

    expect(result.warnings).toEqual([]);
    expect(created[0]).toMatchObject({ ownerPhone: "+972501234567" });
  });

  /*
   * ‏הגבול של ההקלה: שדה שאינו קיים בסכימה **כן** מפיל את השורה.
   * ‏עמודה כמו „כותרת שיווקית” אינה שייכת לגיוס, וקליטה שקטה שלה
   * ‏הייתה אומרת למתווך שהנתון נשמר בזמן שהוא נזרק.
   */
  it("שדה שאינו של גיוס מפיל את השורה במקום להיבלע", async () => {
    const { controller, created } = harness();

    const result = await controller.importRecruitment({
      rows: [{ ...AD, marketingTitle: "דירה מרווחת" }],
    });

    expect(result.created).toBe(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toMatchObject({ row: 1 });
    expect(created).toEqual([]);
  });

  it("שורה שנכשלה אינה עוצרת את הבאות אחריה", async () => {
    const { controller, created } = harness();

    const result = await controller.importRecruitment({
      rows: [{ ...AD, marketingTitle: "x" }, AD],
    });

    expect(result.created).toBe(1);
    expect(result.failed).toEqual([{ row: 1, error: expect.any(String) }]);
    expect(created).toHaveLength(1);
  });
});
