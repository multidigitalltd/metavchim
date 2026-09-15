import { describe, expect, it } from "vitest";
import {
  WhatsappSeatGrantError,
  whatsappSeatGrant,
  whatsappSeatIsBillable,
  whatsappSeatOriginLabel,
} from "./whatsapp-seat-grant.js";

const NOW = new Date("2026-03-10T09:00:00.000Z");

describe("whatsappSeatGrant", () => {
  it("בחינם — לא מחויב ולא נגמר", () => {
    expect(whatsappSeatGrant({ mode: "free", now: NOW })).toEqual({
      origin: "granted",
      monthlyAgorot: 0,
      currentPeriodEnd: null,
      billingAnchorDay: null,
    });
  });

  it("ניסיון — לא מחויב, ונגמר בתאריך שנקבע", () => {
    const endsAt = new Date("2026-04-10T20:59:59.000Z");
    const grant = whatsappSeatGrant({ mode: "trial", now: NOW, endsAt });
    expect(grant.origin).toBe("granted");
    expect(grant.monthlyAgorot).toBe(0);
    expect(grant.currentPeriodEnd).toEqual(endsAt);
  });

  it("ניסיון בלי תאריך, או עם תאריך שעבר — נדחה", () => {
    expect(() => whatsappSeatGrant({ mode: "trial", now: NOW })).toThrow(WhatsappSeatGrantError);
    expect(() =>
      whatsappSeatGrant({ mode: "trial", now: NOW, endsAt: new Date("2026-03-01T00:00:00.000Z") }),
    ).toThrow(/כבר עבר/u);
  });

  it("בתשלום — התקופה הראשונה ניתנת, והחיוב מתחיל בסופה", () => {
    const grant = whatsappSeatGrant({ mode: "billed", now: NOW, monthlyAgorot: 3900 });
    expect(grant.origin).toBe("purchased");
    expect(grant.monthlyAgorot).toBe(3900);
    expect(grant.currentPeriodEnd?.toISOString()).toBe("2026-04-10T09:00:00.000Z");
    // עוגן היום — בלעדיו מקום שנפתח ב-31 בחודש היה מתקצר אחרי פברואר
    expect(grant.billingAnchorDay).toBe(10);
  });

  it("בתשלום בלי מחיר, או במחיר לא תקין — נדחה", () => {
    for (const monthlyAgorot of [undefined, null, 0, -100, 12.5]) {
      expect(() =>
        whatsappSeatGrant({ mode: "billed", now: NOW, monthlyAgorot: monthlyAgorot as number }),
      ).toThrow(WhatsappSeatGrantError);
    }
  });

  /*
   * ‎**זו הטענה שמונעת חיוב של מתנה.** מקום ניסיון חייב תאריך סיום
   * כדי שמשהו יסגור אותו, וסורק החידושים אוסף כל שורה שהתאריך שלה
   * עבר. בלי ההבחנה הזאת הוא היה מנסה לחייב כרטיס על מקום שניתן
   * בחינם, בסכום אפס, בכל שעה.
   */
  it("מה שהוענק אינו נגבה — גם כשיש לו תאריך סיום", () => {
    const trial = whatsappSeatGrant({
      mode: "trial",
      now: NOW,
      endsAt: new Date("2026-04-10T00:00:00.000Z"),
    });
    expect(trial.currentPeriodEnd).not.toBeNull();
    expect(whatsappSeatIsBillable(trial)).toBe(false);
    expect(whatsappSeatIsBillable(whatsappSeatGrant({ mode: "free", now: NOW }))).toBe(false);
    expect(
      whatsappSeatIsBillable(whatsappSeatGrant({ mode: "billed", now: NOW, monthlyAgorot: 3900 })),
    ).toBe(true);
  });
});

describe("whatsappSeatOriginLabel", () => {
  it("מבחין בין הענקה, ניסיון ותשלום", () => {
    expect(
      whatsappSeatOriginLabel({ origin: "granted", monthlyAgorot: 0, currentPeriodEnd: null }),
    ).toBe("הוענק — ללא חיוב");
    expect(
      whatsappSeatOriginLabel({
        origin: "granted",
        monthlyAgorot: 0,
        currentPeriodEnd: new Date("2026-04-10T00:00:00.000Z"),
      }),
    ).toBe("ניסיון — ללא חיוב");
    expect(
      whatsappSeatOriginLabel({ origin: "purchased", monthlyAgorot: 3900, currentPeriodEnd: null }),
    ).toBe("בתשלום");
  });
});
