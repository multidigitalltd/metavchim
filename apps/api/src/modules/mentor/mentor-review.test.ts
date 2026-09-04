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
  const tx = {
    $executeRaw: async (strings: TemplateStringsArray) => {
      if (strings.join("").includes("INSERT INTO notifications")) {
        notifications.push(strings.join("?"));
        return 1;
      }
      return 0;
    },
    $queryRaw: async () => [{ n: BigInt(counts.offers ?? 0) }],
    mentorWin: {
      count: async () => counts.deals ?? 0,
      findMany: async () => counts.wins ?? [],
    },
    appointment: { count: async () => counts.viewings ?? 0 },
    lead: { count: async () => counts.leads ?? 0 },
    buyer: { count: async () => counts.buyers ?? 0 },
    auditLog: { count: async () => counts.properties ?? 0 },
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
  return { tx: tx as unknown as TenantTx, created, notifications };
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
    expect(body.paragraphs[0]).toContain("סגרתם את הרצל 12, רעננה");
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
    expect(created[0]?.["headline"]).toBe("כל היעדים של השבוע הושגו");
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
    expect(created[0]?.["headline"]).toBe("3 שבועות רצופים שכל היעדים מושגים");
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
    expect(body.paragraphs[0]).toBe("התחייבתם ל5 הצעות בשבוע — ועמדתם בזה.");
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
    expect(body.paragraphs[0]).toContain(
      "התחייבתם ל5 הצעות בשבוע. הפעם לא יצא",
    );
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
    expect(body.paragraphs.join(" ")).not.toContain("התחייבתם");
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
    expect(body.paragraphs.join(" ")).not.toContain("התחייבתם");
  });
});
