import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../core/prisma.service";
import { FunnelStageService } from "./funnel-stage.service";

/**
 * ‎**שורה שנערכה במסך, ומה שקורה כשהיא אינה תקפה.**
 *
 * ‏`funnel_stages` נערכת בממשק, ועמודות `track`, `clock`, `audience`
 * ו-`channels` הן טקסט במסד. `toDef` היא הגבול שבו טקסט חופשי הופך
 * להגדרה שהמנוע המשותף מכיר — וכל החלטה שם היא החלטה על **למי
 * ההודעה יוצאת**, לא על נוחות טיפוסים.
 *
 * ‏הבדיקה כאן עוברת דרך `forTrack`, כי זו הדלת היחידה לשירות. מה
 * שנבדק הוא ההבחנה שקל לאבד בעריכה: ערוץ לא מוכר **בודד** מצמצם
 * ולכן מושמט, אבל **אפס ערוצים** אינם צמצום — הם שלב מופעל שאי
 * אפשר לשלוח, ו-`nextFunnelStage` אינו בודק ערוצים. הוא היה בוחר
 * אותו שוב ושוב וחוסם את השלבים שאחריו עד שיפוג.
 */

type Row = {
  key: string;
  track: string;
  clock: string;
  offsetDays: number;
  audience: string[];
  channels: string[];
  enabled: boolean;
};

function row(over: Partial<Row> = {}): Row {
  return {
    key: "welcome",
    track: "conversion",
    clock: "funnel",
    offsetDays: 0,
    audience: ["always"],
    channels: ["email", "whatsapp"],
    enabled: true,
    ...over,
  };
}

function serviceFor(rows: Row[]): FunnelStageService {
  const prisma = {
    funnelStage: {
      findMany: async () => rows,
    },
  } as unknown as PrismaService;
  return new FunnelStageService(prisma);
}

describe("FunnelStageService — שורה שאינה תקפה", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it("שורה תקינה עוברת כמות שהיא", async () => {
    const defs = await serviceFor([row()]).forTrack("conversion");
    expect(defs).toHaveLength(1);
    expect(defs[0]).toMatchObject({
      key: "welcome",
      track: "conversion",
      clock: "funnel",
      audience: ["always"],
      channels: ["email", "whatsapp"],
      enabled: true,
    });
  });

  /*
   * ‏החצי השני של הכלל, ובלעדיו הבדיקה שאחריו הייתה עוברת גם על
   * „כל ערוץ לא מוכר פוסל את השלב” — שינוי שקט שהיה מבטל שלבים
   * שלמים בגלל ערוץ אחד שהוסר בשדרוג.
   */
  it("ערוץ לא מוכר בודד מושמט, והשלב נשאר עם מה שנותר", async () => {
    const defs = await serviceFor([row({ channels: ["email", "carrier_pigeon"] })]).forTrack(
      "conversion",
    );
    expect(defs).toHaveLength(1);
    expect(defs[0]?.channels).toEqual(["email"]);
  });

  it("שלב שכל ערוציו אינם מוכרים מושמט — ולא נשאר עם רשימה ריקה", async () => {
    const defs = await serviceFor([row({ channels: ["carrier_pigeon", "fax"] })]).forTrack(
      "conversion",
    );
    expect(defs).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("לא נותר ערוץ שליחה מוכר"));
  });

  /*
   * ‏`channels` היא מערך עם ברירת מחדל ריקה במסד: שלב שנוצר במסך
   * ולא נבחר לו ערוץ מגיע לכאן כך, בלי שאיש „שיבש” דבר.
   */
  it("שלב שנוצר בלי ערוץ כלל מושמט", async () => {
    const defs = await serviceFor([row({ channels: [] })]).forTrack("conversion");
    expect(defs).toEqual([]);
  });

  /*
   * ‏השלב הפסול אינו מפיל את המסלול: השלבים שאחריו נשארים, ורק הוא
   * נעלם. אחרת תקלה בשורה אחת הייתה משתיקה את הרצף כולו.
   */
  it("שלב פסול נופל לבדו — השאר נשארים", async () => {
    const defs = await serviceFor([
      row({ key: "a" }),
      row({ key: "b", channels: [] }),
      row({ key: "c" }),
    ]).forTrack("conversion");
    expect(defs.map((d) => d.key)).toEqual(["a", "c"]);
  });

  it("תנאי קהל לא מוכר פוסל את השלב", async () => {
    const defs = await serviceFor([row({ audience: ["always", "owns_a_yacht"] })]).forTrack(
      "conversion",
    );
    expect(defs).toEqual([]);
  });

  it("שעון לא מוכר פוסל את השלב", async () => {
    const defs = await serviceFor([row({ clock: "lunar" })]).forTrack("conversion");
    expect(defs).toEqual([]);
  });
});
