import { describe, expect, it } from "vitest";
import type { PlanCatalogService } from "../../core/plan-catalog.service";
import type { PrismaService, TenantTx } from "../../core/prisma.service";
import { MentorReviewService } from "./mentor-review.service";
import { MentorSignalsService } from "./mentor-signals.service";

const TENANT = "01TENANTAAAAAAAAAAAAAAAAAA";
const USER = "01USERAAAAAAAAAAAAAAAAAAAA";
// ראשון 2026-09-06 00:00 שעון ישראל
const WEEK = new Date("2026-09-05T21:00:00.000Z");

describe("MentorReviewService.dueWeeks — מתי מסכמים", () => {
  it("לפני מוצאי שבת 20:00 — השבוע הנוכחי עוד לא; שבוע שעבר מושלם עד שלישי", () => {
    // שני 07/09 10:00 ישראל
    const monday = MentorReviewService.dueWeeks(
      new Date("2026-09-07T07:00:00.000Z"),
    );
    expect(monday.map((d) => d.toISOString())).toEqual([
      "2026-08-29T21:00:00.000Z",
    ]);
    // רביעי — שבוע שעבר כבר לא מושלם
    expect(
      MentorReviewService.dueWeeks(new Date("2026-09-09T07:00:00.000Z")),
    ).toEqual([]);
  });

  it("מוצאי שבת 20:00 ישראל — השבוע הנוכחי; 19:59 — עדיין לא", () => {
    // שבת 12/09 20:00 ישראל = 17:00Z (קיץ)
    const at = MentorReviewService.dueWeeks(
      new Date("2026-09-12T17:00:00.000Z"),
    );
    expect(at.map((d) => d.toISOString())).toContain(WEEK.toISOString());
    const before = MentorReviewService.dueWeeks(
      new Date("2026-09-12T16:59:00.000Z"),
    );
    expect(before.map((d) => d.toISOString())).not.toContain(
      WEEK.toISOString(),
    );
  });
});

/** בסיס מזויף: רק מה שהסיכום נוגע בו, עם ספירות קבועות. */
function fakeTx(counts: {
  deals?: number;
  offers?: number;
  viewings?: number;
  leads?: number;
  buyers?: number;
  properties?: number;
  calls?: number;
  fastLeads?: number;
  followups?: number;
  medianMinutes?: number | null;
  missedUnreturned?: number;
  goals?: {
    id: string;
    metric: string;
    period: string;
    target: number;
    why: string | null;
    intention: string | null;
    createdAt: Date;
    endedAt: Date | null;
  }[];
  wins?: { kind: string; title: string }[];
  previousReviews?: {
    weekStart: Date;
    body: unknown;
    commitment?: string | null;
  }[];
}) {
  const created: Record<string, unknown>[] = [];
  const notifications: unknown[] = [];
  /** הערכים של כל התראה שנכתבה — סוג, כותרת, גוף, מפתח — לפי סדר ההצבה */
  const notified: unknown[][] = [];
  /** הערכים של כל הצלחה שנרשמה ב-`mentor_wins` */
  const winsInserted: unknown[][] = [];
  /** רעיון הבוקר שנשמר על המשתמש — למשוב מוואטסאפ */
  const lastIdeas: unknown[][] = [];
  const tx = {
    $executeRaw: async (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => {
      const sql = strings.join("?");
      if (sql.includes("INSERT INTO notifications")) {
        notifications.push(sql);
        notified.push(values);
        return 1;
      }
      if (sql.includes("INSERT INTO mentor_wins")) {
        winsInserted.push(values);
        return 1;
      }
      if (sql.includes("lastIdea")) {
        lastIdeas.push(values);
        return 1;
      }
      return 0;
    },
    user: {
      findFirst: async () => ({ name: "דנה כהן" }),
    },
    // שאילתות גולמיות לפי הטבלה שהן סופרות — הצעות, שיחות, לידים מהירים, מעקבים, חציון
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      if (sql.includes("percentile_cont"))
        return [{ median: counts.medianMinutes ?? null }];
      if (sql.includes("FROM calls") && sql.includes("NOT EXISTS"))
        return [{ n: BigInt(counts.missedUnreturned ?? 0) }];
      if (sql.includes("FROM calls")) return [{ n: BigInt(counts.calls ?? 0) }];
      if (sql.includes("FROM leads"))
        return [{ n: BigInt(counts.fastLeads ?? 0) }];
      if (sql.includes("FROM tasks"))
        return [{ n: BigInt(counts.followups ?? 0) }];
      return [{ n: BigInt(counts.offers ?? 0) }];
    },
    mentorWin: {
      count: async () => counts.deals ?? 0,
      findMany: async () => counts.wins ?? [],
    },
    appointment: { count: async () => counts.viewings ?? 0 },
    lead: { count: async () => counts.leads ?? 0 },
    buyer: { count: async () => counts.buyers ?? 0 },
    auditLog: {
      count: async (args: { where: { action?: string } }) =>
        args.where.action === "property.create" ? (counts.properties ?? 0) : 0,
    },
    mentorGoal: {
      findMany: async (args?: { where?: { endedAt?: unknown } }) =>
        (counts.goals ?? []).filter(
          (g) => args?.where?.endedAt !== null || g.endedAt === null,
        ),
    },
    mentorReview: {
      findMany: async () => counts.previousReviews ?? [],
      findFirst: async (args: { where: { weekStart?: Date } }) =>
        (counts.previousReviews ?? []).find(
          (r) => r.weekStart.getTime() === args.where.weekStart?.getTime(),
        ) ?? null,
      create: async (args: { data: Record<string, unknown> }) => {
        created.push(args.data);
        return args.data;
      },
    },
  };
  return {
    tx: tx as unknown as TenantTx,
    created,
    notifications,
    notified,
    winsInserted,
    lastIdeas,
  };
}

function service(): MentorReviewService {
  return new MentorReviewService(
    {} as unknown as PrismaService,
    {} as unknown as PlanCatalogService,
    new MentorSignalsService(),
  );
}

describe("MentorReviewService.generateForUser — הסיכום כפי שנשמר", () => {
  it("שבוע ריק בלי יעדים — שקט: לא נכתב סיכום ולא יוצאת התראה", async () => {
    const { tx, created, notifications } = fakeTx({});
    const written = await service().generateForUser(
      tx,
      TENANT,
      USER,
      new Date("2026-01-01"),
      WEEK,
    );
    expect(written).toBe(false);
    expect(created).toEqual([]);
    expect(notifications).toEqual([]);
  });

  it("יעד שהושג + עסקה — סיכום חוגג, גוף עם allGoalsMet, והתראה בלי פוש-רעש", async () => {
    const { tx, created, notifications } = fakeTx({
      offers: 6,
      deals: 1,
      wins: [{ kind: "deal_closed", title: "הרצל 12, רעננה" }],
      goals: [
        {
          id: "01GOALAAAAAAAAAAAAAAAAAAAA",
          metric: "offers_sent",
          period: "week",
          target: 5,
          why: null,
          intention: null,
          createdAt: new Date("2026-08-01"),
          endedAt: null,
        },
      ],
    });
    const written = await service().generateForUser(
      tx,
      TENANT,
      USER,
      new Date("2026-01-01"),
      WEEK,
    );
    expect(written).toBe(true);
    const row = created[0]!;
    expect(row["mood"]).toBe("celebrate");
    expect(row["weekStart"]).toEqual(WEEK);
    const body = row["body"] as {
      allGoalsMet: boolean;
      paragraphs: string[];
      goals: { pace: string }[];
    };
    expect(body.allGoalsMet).toBe(true);
    expect(body.goals[0]?.pace).toBe("done");
    expect(body.paragraphs[0]).toContain("סגרת את הרצל 12, רעננה");
    expect(notifications).toHaveLength(1);
  });

  it("הרצף נספר משבועות עוקבים בלבד — שבוע חסר שובר אותו", async () => {
    const twoBack = new Date("2026-08-22T21:00:00.000Z");
    const { tx, created } = fakeTx({
      offers: 5,
      goals: [
        {
          id: "01GOALAAAAAAAAAAAAAAAAAAAA",
          metric: "offers_sent",
          period: "week",
          target: 5,
          why: null,
          intention: null,
          createdAt: new Date("2026-08-01"),
          endedAt: null,
        },
      ],
      // שבוע שעבר חסר; שבועיים אחורה הושג — לא נספר
      previousReviews: [{ weekStart: twoBack, body: { allGoalsMet: true } }],
    });
    await service().generateForUser(
      tx,
      TENANT,
      USER,
      new Date("2026-01-01"),
      WEEK,
    );
    expect(created[0]?.["headline"]).toBe(
      "כל היעדים של השבוע הושגו — כל הכבוד לך",
    );
  });

  it("רצף של שלושה שבועות עוקבים נאמר בכותרת", async () => {
    const goals = [
      {
        id: "01GOALAAAAAAAAAAAAAAAAAAAA",
        metric: "offers_sent",
        period: "week",
        target: 5,
        why: null,
        intention: null,
        createdAt: new Date("2026-08-01"),
        endedAt: null,
      },
    ];
    const { tx, created } = fakeTx({
      offers: 5,
      goals,
      previousReviews: [
        {
          weekStart: new Date("2026-08-29T21:00:00.000Z"),
          body: { allGoalsMet: true },
        },
        {
          weekStart: new Date("2026-08-22T21:00:00.000Z"),
          body: { allGoalsMet: true },
        },
        {
          weekStart: new Date("2026-08-15T21:00:00.000Z"),
          body: { allGoalsMet: false },
        },
      ],
    });
    await service().generateForUser(
      tx,
      TENANT,
      USER,
      new Date("2026-01-01"),
      WEEK,
    );
    expect(created[0]?.["headline"]).toBe(
      "3 שבועות רצופים שכל היעדים שלך מושגים",
    );
  });

  it("מתווך שהצטרף השבוע אינו מקבל השוואה לשבוע שעבר", async () => {
    const { tx, created } = fakeTx({
      offers: 3,
      goals: [
        {
          id: "01GOALAAAAAAAAAAAAAAAAAAAA",
          metric: "offers_sent",
          period: "week",
          target: 5,
          why: null,
          intention: null,
          createdAt: WEEK,
          endedAt: null,
        },
      ],
    });
    await service().generateForUser(
      tx,
      TENANT,
      USER,
      new Date("2026-09-07"),
      WEEK,
    );
    const body = created[0]?.["body"] as { paragraphs: string[] };
    expect(body.paragraphs.join(" ")).not.toContain("שבוע שעבר");
    // בסוף השבוע: 3 מתוך 5 הוא „חסרו”, לא „עוד יש זמן”
    expect(body.paragraphs.join(" ")).toContain("חסרו 2 הצעות");
  });
});

describe("MentorReviewService.nudgeWindow — רביעי 12:00 עד שישי 12:00", () => {
  it("שלישי בערב — סגור; רביעי 12:00 ישראל — פתוח; שישי 12:00 — סגור", () => {
    expect(
      MentorReviewService.nudgeWindow(new Date("2026-09-08T18:00:00.000Z")),
    ).toBeNull();
    // רביעי 09/09 12:00 ישראל = 09:00Z (קיץ)
    expect(
      MentorReviewService.nudgeWindow(
        new Date("2026-09-09T09:00:00.000Z"),
      )?.toISOString(),
    ).toBe(WEEK.toISOString());
    expect(
      MentorReviewService.nudgeWindow(new Date("2026-09-09T08:59:00.000Z")),
    ).toBeNull();
    expect(
      MentorReviewService.nudgeWindow(
        new Date("2026-09-11T08:59:00.000Z"),
      )?.toISOString(),
    ).toBe(WEEK.toISOString());
    expect(
      MentorReviewService.nudgeWindow(new Date("2026-09-11T09:00:00.000Z")),
    ).toBeNull();
  });
});

describe("MentorReviewService.nudgeForUser — דחיפה רק כשמאחור", () => {
  // רביעי 09/09 13:00 ישראל
  const wednesday = new Date("2026-09-09T10:00:00.000Z");
  const weekGoal = {
    id: "01GOALAAAAAAAAAAAAAAAAAAAA",
    metric: "offers_sent",
    period: "week",
    target: 10,
    why: "הדירה של הילדים",
    intention: "כל בוקר ב-11:00 שולח הצעות",
    createdAt: new Date("2026-08-01"),
    endedAt: null,
  };

  it("בקצב ⇒ שום התראה", async () => {
    const { tx, notifications } = fakeTx({ offers: 5, goals: [weekGoal] });
    expect(
      await service().nudgeForUser(tx, TENANT, USER, WEEK, wednesday),
    ).toBe(false);
    expect(notifications).toEqual([]);
  });

  it("מאחור ⇒ התראת mentor_nudge אחת עם מפתח לשבוע, התוכנית וה„למה”", async () => {
    const { tx, notifications } = fakeTx({ offers: 1, goals: [weekGoal] });
    expect(
      await service().nudgeForUser(tx, TENANT, USER, WEEK, wednesday),
    ).toBe(true);
    expect(notifications).toHaveLength(1);
    const sql = String(notifications[0]);
    expect(sql).toContain("INSERT INTO notifications");
  });
});

describe("MentorReviewService.nudgeForUser — יעד שהוחלף השבוע אינו נבחר", () => {
  const wednesday = new Date("2026-09-09T10:00:00.000Z");
  it("היעד הישן (שהופסק ביום שני) אינו נספר — רק היעד הפעיל", async () => {
    const { tx, notifications } = fakeTx({
      offers: 5,
      goals: [
        {
          id: "01GOALOLDAAAAAAAAAAAAAAAAA",
          metric: "offers_sent",
          period: "week",
          target: 40,
          why: null,
          intention: null,
          createdAt: new Date("2026-08-01"),
          endedAt: new Date("2026-09-07T08:00:00.000Z"),
        },
        {
          id: "01GOALNEWAAAAAAAAAAAAAAAAA",
          metric: "offers_sent",
          period: "week",
          target: 6,
          why: null,
          intention: null,
          createdAt: new Date("2026-09-07T08:00:00.000Z"),
          endedAt: null,
        },
      ],
    });
    // 5 מתוך 6 ביום רביעי — בקצב; 5 מתוך 40 היה „מאחור” ומזכיר יעד שכבר אינו קיים
    expect(
      await service().nudgeForUser(tx, TENANT, USER, WEEK, wednesday),
    ).toBe(false);
    expect(notifications).toEqual([]);
  });
});

describe("MentorReviewService.generateForUser — המחויבות מהשבוע שעבר", () => {
  const prevWeek = new Date("2026-08-29T21:00:00.000Z");
  const offersGoal = {
    id: "01GOALAAAAAAAAAAAAAAAAAAAA",
    metric: "offers_sent",
    period: "week",
    target: 5,
    why: null,
    intention: null,
    createdAt: new Date("2026-08-01"),
    endedAt: null,
  };

  it("התחייב ועמד — הפסקה הראשונה אומרת זאת בשמה", async () => {
    const { tx, created } = fakeTx({
      offers: 5,
      goals: [offersGoal],
      previousReviews: [
        {
          weekStart: prevWeek,
          body: {
            allGoalsMet: false,
            ask: { metric: "offers_sent", period: "week", target: 5 },
          },
          commitment: "accepted",
        },
      ],
    });
    await service().generateForUser(
      tx,
      TENANT,
      USER,
      new Date("2026-01-01"),
      WEEK,
    );
    const body = created[0]?.["body"] as { paragraphs: string[] };
    expect(body.paragraphs[0]).toContain("התחייבת ל5 הצעות בשבוע — ועמדת בזה");
  });

  it("התחייב ולא עמד — עובדה, וההתחייבות נשארת", async () => {
    const { tx, created } = fakeTx({
      offers: 2,
      goals: [offersGoal],
      previousReviews: [
        {
          weekStart: prevWeek,
          body: { ask: { metric: "offers_sent", period: "week", target: 5 } },
          commitment: "accepted",
        },
      ],
    });
    await service().generateForUser(
      tx,
      TENANT,
      USER,
      new Date("2026-01-01"),
      WEEK,
    );
    const body = created[0]?.["body"] as { paragraphs: string[] };
    expect(body.paragraphs[0]).toContain("התחייבת ל5 הצעות בשבוע. הפעם לא יצא");
  });

  it("היעד שהתחייבו אליו הופסק במהלך השבוע — לא נבדק, לא לחיוב ולא לשלילה", async () => {
    const { tx, created } = fakeTx({
      offers: 5,
      goals: [{ ...offersGoal, endedAt: new Date("2026-09-01T10:00:00.000Z") }],
      previousReviews: [
        {
          weekStart: prevWeek,
          body: { ask: { metric: "offers_sent", period: "week", target: 5 } },
          commitment: "accepted",
        },
      ],
    });
    await service().generateForUser(
      tx,
      TENANT,
      USER,
      new Date("2026-01-01"),
      WEEK,
    );
    const body = created[0]?.["body"] as { paragraphs: string[] };
    expect(body.paragraphs.join(" ")).not.toContain("התחייבת");
  });

  it("לא התחייב (או סירב) — אין פסקת מחויבות", async () => {
    const { tx, created } = fakeTx({
      offers: 2,
      goals: [offersGoal],
      previousReviews: [
        {
          weekStart: prevWeek,
          body: { ask: { metric: "offers_sent", period: "week", target: 5 } },
          commitment: "declined",
        },
      ],
    });
    await service().generateForUser(
      tx,
      TENANT,
      USER,
      new Date("2026-01-01"),
      WEEK,
    );
    const body = created[0]?.["body"] as { paragraphs: string[] };
    expect(body.paragraphs.join(" ")).not.toContain("התחייבת");
  });
});

describe("MentorReviewService.generateForUser — הזיכרון הארוך", () => {
  const offersGoal = {
    id: "01GOALAAAAAAAAAAAAAAAAAAAA",
    metric: "offers_sent",
    period: "week",
    target: 5,
    why: null,
    intention: null,
    createdAt: new Date("2026-08-01"),
    endedAt: null,
  };
  const behindBody = {
    goals: [
      {
        metric: "offers_sent",
        period: "week",
        target: 5,
        actual: 1,
        pace: "behind",
      },
    ],
    ask: { metric: "offers_sent", period: "week", target: 5 },
  };

  it("פיגור שחוזר בפעם הרביעית — הסיכום מזכיר מה המתווך אמר בפעמים הקודמות", async () => {
    const { tx, created } = fakeTx({
      offers: 1,
      goals: [offersGoal],
      previousReviews: [
        {
          weekStart: new Date("2026-08-29T21:00:00.000Z"),
          body: behindBody,
          reflectionAnswer: "לא היה זמן",
        },
        {
          weekStart: new Date("2026-08-22T21:00:00.000Z"),
          body: behindBody,
          reflectionAnswer: "לא היו התאמות",
        },
        { weekStart: new Date("2026-08-15T21:00:00.000Z"), body: behindBody },
      ] as never,
    });
    await service().generateForUser(
      tx,
      TENANT,
      USER,
      new Date("2026-01-01"),
      WEEK,
    );
    const body = created[0]?.["body"] as { paragraphs: string[] };
    expect(body.paragraphs.join(" ")).toContain(
      "מאחור ב-3 מתוך 3 השבועות האחרונים. בפעמים הקודמות אמרת: „לא היה זמן”, „לא היו התאמות”",
    );
  });
});

describe("MentorReviewService.generateForUser — מהירות מענה ושיחות שמחכות", () => {
  it("החציון והשיחות שלא חזרת אליהן נכנסים לסיכום ולגוף", async () => {
    const { tx, created } = fakeTx({
      offers: 3,
      medianMinutes: 14,
      missedUnreturned: 2,
      goals: [
        {
          id: "01GOALAAAAAAAAAAAAAAAAAAAA",
          metric: "offers_sent",
          period: "week",
          target: 5,
          why: null,
          intention: null,
          createdAt: new Date("2026-08-01"),
          endedAt: null,
        },
      ],
    });
    await service().generateForUser(
      tx,
      TENANT,
      USER,
      new Date("2026-01-01"),
      WEEK,
    );
    const body = created[0]?.["body"] as {
      paragraphs: string[];
      insights?: {
        responseMedianMinutes: number | null;
        missedUnreturned: number;
      };
    };
    expect(body.paragraphs.join(" ")).toContain(
      "זמן המענה שלך ללידים חדשים השבוע: 14 דקות",
    );
    expect(body.paragraphs.join(" ")).toContain(
      "2 שיחות נכנסות לא נענו ולא חזרת אליהן",
    );
    expect(body.insights).toMatchObject({
      responseMedianMinutes: 14,
      missedUnreturned: 2,
    });
  });
});

describe("MentorReviewService.dailyWindow / awake — מתי הבוקר, ומתי חוגגים", () => {
  it("ראשון–שישי 08:00–11:00 שעון ישראל — תאריך היום; מחוץ לחלון ובשבת — null", () => {
    // שני 07/09: 08:00 ישראל = 05:00Z (קיץ)
    expect(
      MentorReviewService.dailyWindow(new Date("2026-09-07T05:00:00.000Z")),
    ).toBe("2026-09-07");
    expect(
      MentorReviewService.dailyWindow(new Date("2026-09-07T04:59:00.000Z")),
    ).toBeNull();
    expect(
      MentorReviewService.dailyWindow(new Date("2026-09-07T08:00:00.000Z")),
    ).toBeNull();
    // שישי — כן; שבת 09:00 — לא
    expect(
      MentorReviewService.dailyWindow(new Date("2026-09-11T06:00:00.000Z")),
    ).toBe("2026-09-11");
    expect(
      MentorReviewService.dailyWindow(new Date("2026-09-12T06:00:00.000Z")),
    ).toBeNull();
  });

  it("חגיגה רק בין 07:00 ל-22:00 שעון ישראל", () => {
    expect(
      MentorReviewService.awake(new Date("2026-09-07T04:00:00.000Z")),
    ).toBe(true);
    expect(
      MentorReviewService.awake(new Date("2026-09-07T03:59:00.000Z")),
    ).toBe(false);
    expect(
      MentorReviewService.awake(new Date("2026-09-07T19:00:00.000Z")),
    ).toBe(false);
  });
});

describe("MentorReviewService.dailyForUser — הבוקר של המנטור", () => {
  // שני 07/09 09:00 ישראל
  const monday = new Date("2026-09-07T06:00:00.000Z");
  const weekGoal = {
    id: "01GOALAAAAAAAAAAAAAAAAAAAA",
    metric: "offers_sent",
    period: "week",
    target: 5,
    why: null,
    intention: null,
    createdAt: new Date("2026-08-01"),
    endedAt: null,
  };

  it("עם יעד — התראת mentor_daily אחת, במפתח של היום, בשם, עם אתמול ומה היום שווה", async () => {
    const { tx, notified, lastIdeas } = fakeTx({
      offers: 2,
      calls: 4,
      goals: [weekGoal],
    });
    expect(
      await service().dailyForUser(
        tx,
        TENANT,
        USER,
        "2026-09-07",
        monday,
        "דנה",
      ),
    ).toBe(true);
    expect(notified).toHaveLength(1);
    const values = notified[0]!;
    expect(values).toContain("mentor_daily");
    expect(values).toContain("🌅 היום שלך");
    expect(values).toContain(`mentor_daily:${USER}:2026-09-07`);
    const body = String(values.find((v) => String(v).startsWith("בוקר טוב")));
    expect(body).toContain("בוקר טוב דנה.");
    expect(body).toContain("אתמול:");
    expect(body).toContain("5 הצעות בשבוע: 2 הצעות עד עכשיו.");
    // רעיון מספר המשחק — על מדד המיקוד (הצעות)
    expect(body).toContain("רעיון להיום: ");
    // הרעיון שנשלח נשמר על המשתמש — למשוב מוואטסאפ (docs/14 §7.2)
    expect(lastIdeas).toHaveLength(1);
    const saved = JSON.parse(
      String(lastIdeas[0]!.find((v) => String(v).startsWith("{"))),
    );
    expect(saved.date).toBe("2026-09-07");
    expect(saved.key).toMatch(/^offers_sent:\d$/u);
    expect(body).toContain(saved.text);
  });

  it("סגנון רגוע — בלי הודעת בוקר, גם עם יעד", async () => {
    const { tx, notified } = fakeTx({ offers: 2, calls: 4, goals: [weekGoal] });
    expect(
      await service().dailyForUser(
        tx,
        TENANT,
        USER,
        "2026-09-07",
        monday,
        "דנה",
        {
          name: "נועה",
          style: "calm",
        },
      ),
    ).toBe(false);
    expect(notified).toEqual([]);
  });

  it("בלי יעד ביום שני, בלי שיחה שמחכה ובלי מאמץ אתמול — שקט", async () => {
    const { tx, notified } = fakeTx({});
    expect(
      await service().dailyForUser(tx, TENANT, USER, "2026-09-07", monday),
    ).toBe(false);
    expect(notified).toEqual([]);
  });
});

describe("MentorReviewService.celebrateGoalsForUser — היעד הושג, היום", () => {
  const wednesday = new Date("2026-09-09T10:00:00.000Z");
  const weekGoal = {
    id: "01GOALAAAAAAAAAAAAAAAAAAAA",
    metric: "offers_sent",
    period: "week",
    target: 5,
    why: null,
    intention: null,
    createdAt: new Date("2026-08-01"),
    endedAt: null,
  };

  it("5 מתוך 5 ⇒ הצלחה goal_reached עם מפתח השבוע, וחגיגה בשם עם אותו מפתח", async () => {
    const { tx, winsInserted, notified } = fakeTx({
      offers: 5,
      goals: [weekGoal],
    });
    expect(
      await service().celebrateGoalsForUser(
        tx,
        TENANT,
        USER,
        [weekGoal],
        wednesday,
      ),
    ).toBe(1);
    expect(winsInserted).toHaveLength(1);
    expect(winsInserted[0]).toContain("goal_reached");
    expect(winsInserted[0]).toContain(weekGoal.id);
    expect(winsInserted[0]).toContain("5 הצעות בשבוע");
    // תחילת השבוע הישראלי — 2026-09-06
    expect(winsInserted[0]).toContain("2026-09-06");
    expect(notified).toHaveLength(1);
    expect(notified[0]).toContain("mentor_win");
    expect(notified[0]).toContain("🎯 היעד הושג!");
    expect(notified[0]).toContain(
      `mentor_win:goal_reached:${weekGoal.id}:2026-09-06`,
    );
    // ההתראה נוחתת במסך המנטור — `mentor` הוא הישות שמפות הניתוב מכירות
    expect(notified[0]).toContain("mentor");
    expect(notified[0]).not.toContain("mentor_goal");
    const body = String(notified[0]!.find((v) => String(v).startsWith("דנה")));
    expect(body).toMatch(/^דנה, 5 הצעות בשבוע — הושג\./u);
  });

  it("3 מתוך 5 ⇒ כלום", async () => {
    const { tx, winsInserted, notified } = fakeTx({
      offers: 3,
      goals: [weekGoal],
    });
    expect(
      await service().celebrateGoalsForUser(
        tx,
        TENANT,
        USER,
        [weekGoal],
        wednesday,
      ),
    ).toBe(0);
    expect(winsInserted).toEqual([]);
    expect(notified).toEqual([]);
  });
});
