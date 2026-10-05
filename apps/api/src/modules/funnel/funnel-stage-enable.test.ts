import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../core/prisma.service";
import { FunnelStageService } from "./funnel-stage.service";

/**
 * ‎**הדלקת שלב נבדקת בשרת — לא רק מוסתרת במסך.**
 *
 * ‏שלב שכבר יוצא ממנגנון אחר, או שהמייל שלו ריק, נדחה גם כשהבקשה
 * ‏עוקפת את המסך. כיבוי מותר תמיד.
 */

const ROW: {
  id: string;
  track: string;
  clock: string;
  key: string;
  title: string;
  enabled: boolean;
  emailSubject: string | null;
  emailHeading: string | null;
  emailBody: string | null;
  ctaLabel: string | null;
  ctaPath: string | null;
  whatsappTemplate: string | null;
} = {
  id: "01STAGEAAAAAAAAAAAAAAAAAAA",
  track: "conversion",
  clock: "funnel",
  key: "d1_empty_screen",
  title: "יום 1",
  enabled: false,
  emailSubject: "נושא",
  emailHeading: null,
  emailBody: "גוף",
  ctaLabel: null,
  ctaPath: null,
  whatsappTemplate: null,
};

function service(row: typeof ROW) {
  const update = vi.fn(() => Promise.resolve({}));
  const lock = vi.fn(() => Promise.resolve([]));
  const tx = {
    $queryRaw: lock,
    funnelStage: { findUnique: vi.fn(() => Promise.resolve(row)), update },
  };
  const prisma = {
    $transaction: (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
  } as unknown as PrismaService;
  return { stages: new FunnelStageService(prisma), update, lock };
}

const COPY = {
  emailSubject: "נושא",
  emailHeading: "",
  emailBody: "גוף",
  ctaLabel: "",
  ctaPath: "",
};

describe("הדלקת שלב", () => {
  it("שלב תקין נדלק — והשורה ננעלת לפני הבדיקה", async () => {
    const { stages, update, lock } = service(ROW);
    await stages.setEnabled(ROW.id, true);
    expect(lock).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({ where: { id: ROW.id }, data: { enabled: true } });
  });

  it("שלב שעון הניסיון נדחה, ודבר אינו נכתב", async () => {
    const { stages, update } = service({ ...ROW, clock: "trial", key: "trial_heads_up" });
    await expect(stages.setEnabled(ROW.id, true)).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it("כיבוי מותר גם לשלב חסום", async () => {
    const { stages, update } = service({ ...ROW, emailBody: null, enabled: true });
    await stages.setEnabled(ROW.id, false);
    expect(update).toHaveBeenCalledWith({ where: { id: ROW.id }, data: { enabled: false } });
  });

  it("שלב דלוק — מחיקת גוף המייל נדחית, ושינוי נוסח רגיל עובר", async () => {
    const { stages, update } = service({ ...ROW, enabled: true });
    await expect(stages.updateCopy(ROW.id, { ...COPY, emailBody: " " })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(update).not.toHaveBeenCalled();
    await stages.updateCopy(ROW.id, { ...COPY, emailBody: "גוף חדש" });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("שלב כבוי — אפשר לרוקן את הנוסח", async () => {
    const { stages, update, lock } = service(ROW);
    await stages.updateCopy(ROW.id, { ...COPY, emailBody: "" });
    expect(lock).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
  });
});
