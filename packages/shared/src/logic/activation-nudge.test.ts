import { describe, expect, it } from "vitest";

import {
  ACTIVATION_NUDGE_MAX_LAG_DAYS,
  ACTIVATION_NUDGE_STAGES,
  activationNudgeDueAt,
  activationNudgeEmail,
  dueActivationNudge,
  hasValidCard,
  type ActivationNudgeStage,
} from "./activation-nudge.js";

const DAY = 24 * 60 * 60 * 1000;
const card = (over: Partial<Parameters<typeof hasValidCard>[0] & object> = {}) => ({
  cardTokenEncrypted: "enc",
  cardMonth: 12,
  cardYear: 2026,
  ...over,
});

describe("כרטיס תקף", () => {
  const now = new Date("2026-08-31T00:00:00.000Z");

  it("כרטיס שמור ובתוקף — תקף", () => {
    expect(hasValidCard(card(), now)).toBe(true);
  });

  it("בלי כרטיס — לא תקף", () => {
    expect(hasValidCard(null, now)).toBe(false);
    expect(hasValidCard(undefined, now)).toBe(false);
    expect(hasValidCard(card({ cardTokenEncrypted: null }), now)).toBe(false);
    expect(hasValidCard(card({ cardTokenEncrypted: "" }), now)).toBe(false);
  });

  /*
   * ‎**„קיים” אינו „תקף”.** שירותי החידוש בודקים קיום בלבד ונותנים
   * לסולק לדחות — נכון שם, כי החיוב הוא רגע האמת. כאן השאלה היא אם
   * יש למה לצפות, ולכרטיס שפג אין.
   */
  it("כרטיס שפג תוקפו אינו תקף", () => {
    expect(hasValidCard(card({ cardMonth: 7, cardYear: 2026 }), now)).toBe(false);
  });

  /* התוקף הוא עד **סוף** חודש התפוגה — כרטיס 08/26 עובד כל אוגוסט */
  it("החודש האחרון נספר במלואו", () => {
    expect(hasValidCard(card({ cardMonth: 8, cardYear: 2026 }), now)).toBe(true);
    expect(
      hasValidCard(card({ cardMonth: 8, cardYear: 2026 }), new Date("2026-09-01T00:00:00.000Z")),
    ).toBe(false);
  });

  /*
   * ‎**שנה דו-ספרתית היא מה שכתוב על הכרטיס.** `26` שנקרא כשנת 26
   * לספירה הופך כל כרטיס לפג — כלומר תזכורת „לא הפעלתם” נשלחת דווקא
   * למי שכן הפעיל.
   */
  it("שנה דו-ספרתית נקראת כמו שנכתבה על הכרטיס", () => {
    expect(hasValidCard(card({ cardMonth: 12, cardYear: 26 }), now)).toBe(true);
    expect(hasValidCard(card({ cardMonth: 1, cardYear: 20 }), now)).toBe(false);
  });

  it("חודש מחוץ לתחום אינו כרטיס", () => {
    expect(hasValidCard(card({ cardMonth: 0 }), now)).toBe(false);
    expect(hasValidCard(card({ cardMonth: 13 }), now)).toBe(false);
  });
});

describe("איזו תזכורת מגיעה", () => {
  const deadline = new Date("2026-09-10T09:00:00.000Z");
  const at = (offsetDays: number) => new Date(deadline.getTime() + offsetDays * DAY);

  it("לפני החלון — כלום", () => {
    expect(dueActivationNudge({ deadline, sent: [], now: at(-5) })).toBeNull();
  });

  it("יומיים לפני — האזהרה", () => {
    expect(dueActivationNudge({ deadline, sent: [], now: at(-2) })).toBe("heads_up");
  });

  it("ביום עצמו — הודעת הסגירה", () => {
    expect(dueActivationNudge({ deadline, sent: [], now: at(0) })).toBe("closing");
  });

  it("שבוע אחרי — האחרונה", () => {
    expect(dueActivationNudge({ deadline, sent: [], now: at(7) })).toBe("last_call");
  });

  it("מה שכבר נשלח אינו נשלח שוב", () => {
    expect(dueActivationNudge({ deadline, sent: ["closing"], now: at(1) })).toBeNull();
  });

  /*
   * ‎**המאוחרת, ולא המוקדמת.** חשבון שפג לפני עשרה ימים ומעולם לא
   * קיבל דבר אינו אמור לקבל היום „נגמר בעוד יומיים” ומחר את הבא
   * בתור — זה גם שקר וגם נשמע כמו מכונה שהתעוררה.
   */
  it("מי שפספס שלבים מקבל את המתאים למצבו עכשיו, ולא את הראשון", () => {
    expect(dueActivationNudge({ deadline, sent: [], now: at(8) })).toBe("last_call");
  });

  /*
   * ‎**תקרת הפיגור.** ביום הפריסה הראשון יש במסד כל מי שנרשם אי פעם
   * ולא שילם. בלי התקרה כולם מקבלים „הניסיון נגמר” באותו בוקר — גל
   * דיוור לכתובות מתות, והדרך המהירה לשרוף את מוניטין הדומיין.
   */
  it("חשבון שפג מזמן אינו מקבל דבר", () => {
    const late = at(7 + ACTIVATION_NUDGE_MAX_LAG_DAYS + 1);
    expect(dueActivationNudge({ deadline, sent: [], now: late })).toBeNull();
  });

  it("בדיוק בקצה החלון — עדיין נשלח", () => {
    const edge = at(7 + ACTIVATION_NUDGE_MAX_LAG_DAYS);
    expect(dueActivationNudge({ deadline, sent: [], now: edge })).toBe("last_call");
  });

  it("מועדי השליחה מסודרים לפי הסדר שהוגדר", () => {
    const times = ACTIVATION_NUDGE_STAGES.map((s) => activationNudgeDueAt(s, deadline).getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});

describe("נוסח התזכורות", () => {
  const base = {
    ownerName: "דוד",
    tenantName: "תיווך הצפון",
    planName: "מקצועי",
    partnerPlanName: "שותפים",
    billingUrl: "https://app.example.test/billing",
    optOutUrl: "https://app.example.test/nudge-optout/tok",
  };

  /*
   * ‎**קישור ההסרה בכל אחת מהן** — חוק התקשורת §30א דורש דרך פשוטה
   * וסבירה להודיע על סירוב, ובדיוור אוטומטי אין „רוב ההודעות”.
   */
  it("כל שלוש נושאות את קישור ההסרה", () => {
    for (const stage of ACTIVATION_NUDGE_STAGES) {
      const { content } = activationNudgeEmail({ ...base, stage });
      expect(content.footnote, stage).toContain(base.optOutUrl);
    }
  });

  it("כל שלוש אומרות מה נסגר ומה נשאר, ומובילות למסך המנוי", () => {
    for (const stage of ACTIVATION_NUDGE_STAGES) {
      const { subject, content } = activationNudgeEmail({ ...base, stage });
      expect(subject.length, stage).toBeGreaterThan(0);
      const body = content.paragraphs.join(" ");
      expect(body, stage).toContain("שותפים");
      expect(content.button?.url, stage).toBe(base.billingUrl);
    }
  });

  /*
   * ‎**בלי מסלול מוגדר — לא ממציאים לו שם.** ההודעה אומרת מה באמת
   * קורה: החשבון ננעל. שם של מסלול שאינו קיים הוא הבטחה ללקוח.
   */
  it("כשאין מסלול שותפים — ההודעה אינה ממציאה אחד", () => {
    const { content } = activationNudgeEmail({
      ...base,
      partnerPlanName: undefined,
      stage: "closing",
    });
    const body = content.paragraphs.join(" ");
    expect(body).toContain("החשבון עצמו ננעל");
    expect(body).not.toContain("מסלול undefined");
  });

  /* שלוש הודעות זהות אינן שלוש הודעות */
  it("לשלוש נוסחים שונים", () => {
    const subjects = ACTIVATION_NUDGE_STAGES.map(
      (stage: ActivationNudgeStage) => activationNudgeEmail({ ...base, stage }).subject,
    );
    expect(new Set(subjects).size).toBe(ACTIVATION_NUDGE_STAGES.length);
  });
});
