import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Injectable } from "@nestjs/common";
import { DiscoveryModule, DiscoveryService, MetadataScanner, Reflector } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { describe, expect, it, vi } from "vitest";
import { Sweep, SweepScheduler, sweepLeaseMs, type SweepOptions } from "./sweeps";

/**
 * ‎**המתזמן של הסבבים — מתי, ומי.** החכירה עצמה נבדקת מול Postgres
 * ‏אמיתי ב-`sweeps.int.test.ts`; כאן — מה שהמתזמן עושה עם התשובה.
 */

function scheduler(claim: () => Promise<unknown[]>): SweepScheduler {
  const prisma = { $queryRaw: claim, $executeRaw: async () => 1 };
  return new SweepScheduler({} as never, {} as never, {} as never, prisma as never);
}

const HELD: () => Promise<unknown[]> = async () => [];
const FREE: () => Promise<unknown[]> = async () => [{ holder: "me" }];
const OPTIONS: SweepOptions = { name: "test-sweep", everyMs: 60 * 60 * 1000 };

describe("‏סבב אחד", () => {
  it("‏חכירה פנויה — הסבב רץ", async () => {
    let ran = 0;
    expect(await scheduler(FREE).runOnce(OPTIONS, async () => (ran += 1))).toBe(true);
    expect(ran).toBe(1);
  });

  it("‏מופע אחר מחזיק את הסבב — מדלגים", async () => {
    let ran = 0;
    expect(await scheduler(HELD).runOnce(OPTIONS, async () => (ran += 1))).toBe(false);
    expect(ran).toBe(0);
  });

  it("‏סבב שעוד רץ בתהליך הזה אינו מתחיל שוב", async () => {
    const sweeps = scheduler(FREE);
    let release!: () => void;
    const first = sweeps.runOnce(OPTIONS, () => new Promise<void>((done) => (release = done)));
    await new Promise((resolve) => setImmediate(resolve));
    expect(await sweeps.runOnce(OPTIONS, async () => undefined)).toBe(false);
    release();
    expect(await first).toBe(true);
    expect(await sweeps.runOnce(OPTIONS, async () => undefined), "ואחרי שסיים — שוב").toBe(true);
  });

  it("‏סבב שנכשל אינו זורק, והבא אחריו רץ", async () => {
    const sweeps = scheduler(FREE);
    await expect(
      sweeps.runOnce(OPTIONS, async () => {
        throw new Error("boom");
      }),
    ).resolves.toBe(true);
    let ran = false;
    await sweeps.runOnce(OPTIONS, async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it("‏סבב של המופע עצמו — רץ בלי חכירה, גם כשמופע אחר מחזיק שם", async () => {
    let ran = 0;
    const own = { ...OPTIONS, perInstance: true };
    expect(await scheduler(HELD).runOnce(own, async () => (ran += 1))).toBe(true);
    expect(ran).toBe(1);
  });

  it("‏מסד שאינו עונה על החכירה אינו עוצר את הסבב — כמו לפני המנגנון", async () => {
    let ran = false;
    const sweeps = scheduler(async () => {
      throw new Error("db down");
    });
    expect(
      await sweeps.runOnce(OPTIONS, async () => {
        ran = true;
      }),
    ).toBe(true);
    expect(ran).toBe(true);
  });
});

describe("‏מי שדילג מנסה שוב כשהחכירה פגה (ביקורת Codex, P2)", () => {
  /** ‏מסד מדומה: התפיסה לפי `held`, והחכירה הקיימת פגה בעוד `expiresInMs`. */
  function standby(state: { held: boolean; expiresInMs: number }): SweepScheduler {
    const prisma = {
      $queryRaw: async (strings: TemplateStringsArray) =>
        strings.join("").includes("RETURNING")
          ? state.held
            ? []
            : [{ holder: "me" }]
          : [{ ms: state.expiresInMs }],
      $executeRaw: async () => 1,
    };
    return new SweepScheduler({} as never, {} as never, {} as never, prisma as never);
  }

  it("‏המחזיק נעלם — הסבב רץ כשהחכירה פגה, ולא בעוד תקופה שלמה", async () => {
    vi.useFakeTimers();
    try {
      const state = { held: true, expiresInMs: 5_000 };
      const sweeps = standby(state);
      let ran = 0;
      expect(await sweeps.runOnce(OPTIONS, async () => (ran += 1))).toBe(false);
      state.held = false;
      await vi.advanceTimersByTimeAsync(5_500);
      expect(ran, "עוד לפני תום החכירה ושנייה").toBe(0);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(ran).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("‏ניסיון שהיה נוחת אחרי הטיק הרגיל — אינו נקבע", async () => {
    vi.useFakeTimers();
    try {
      const state = { held: true, expiresInMs: OPTIONS.everyMs };
      const sweeps = standby(state);
      let ran = 0;
      await sweeps.runOnce(OPTIONS, async () => (ran += 1));
      state.held = false;
      await vi.advanceTimersByTimeAsync(OPTIONS.everyMs + 5_000);
      expect(ran).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("‏דילוג חוזר אינו מערים ניסיונות — אחד לכל סבב", async () => {
    vi.useFakeTimers();
    try {
      const state = { held: true, expiresInMs: 5_000 };
      const sweeps = standby(state);
      let ran = 0;
      for (let i = 0; i < 3; i += 1) await sweeps.runOnce(OPTIONS, async () => (ran += 1));
      state.held = false;
      await vi.advanceTimersByTimeAsync(10_000);
      expect(ran).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("‏משך החכירה", () => {
  it("‏כמעט תקופה שלמה — כך שהמחזיק עצמו אינו מדלג על הסבב הבא שלו", () => {
    expect(sweepLeaseMs(60 * 60 * 1000)).toBe(59 * 60 * 1000);
    expect(sweepLeaseMs(10 * 60 * 1000)).toBe(9 * 60 * 1000);
    expect(sweepLeaseMs(5 * 60 * 1000)).toBe(4.5 * 60 * 1000);
    expect(sweepLeaseMs(500)).toBe(1_000);
  });
});

@Injectable()
class FirstFake {
  calls = 0;
  @Sweep({ name: "first-fake", everyMs: 1_000, firstDelayMs: 10 })
  async tick(): Promise<void> {
    this.calls += 1;
  }
  async notASweep(): Promise<void> {}
}

@Injectable()
class SecondFake {
  @Sweep({ name: "second-fake", everyMs: 2_000 })
  private async tick(): Promise<void> {}
}

@Injectable()
class Duplicate {
  @Sweep({ name: "first-fake", everyMs: 1_000 })
  async tick(): Promise<void> {}
}

/*
 * ‏ספקים אמיתיים במודול אמיתי, כדי שהגילוי יעבור דרך Nest עצמו. המתזמן
 * ‏נבנה ידנית: vitest אינו פולט metadata של טיפוסי הבנאי, ולכן הזרקה
 * ‏לפי טיפוס אינה זמינה כאן (`verify:boot` בודק את החיווט בבנייה האמיתית).
 */
async function discovered(providers: unknown[]): Promise<SweepScheduler> {
  const module = await Test.createTestingModule({
    imports: [DiscoveryModule],
    providers: providers as never[],
  }).compile();
  return new SweepScheduler(
    module.get(DiscoveryService),
    new MetadataScanner(),
    new Reflector(),
    {} as never,
  );
}

describe("‏מציאת הסבבים", () => {
  it("‏כל מתודה שסומנה, ורק היא — גם פרטית — ונקראת על המופע שלה", async () => {
    const sweeps = (await discovered([FirstFake, SecondFake])).discover();
    expect(sweeps.map((sweep) => sweep.options.name).sort()).toEqual(["first-fake", "second-fake"]);
    const first = sweeps.find((sweep) => sweep.options.name === "first-fake");
    expect(first?.options).toEqual({ name: "first-fake", everyMs: 1_000, firstDelayMs: 10 });
    await first?.run();
  });

  it("‏שני סבבים באותו שם — שגיאה בעלייה, ולא סבב שלעולם אינו רץ", async () => {
    const sweeps = await discovered([FirstFake, Duplicate]);
    expect(() => sweeps.discover()).toThrow(/first-fake/u);
  });
});

/*
 * ‎**מנגנון אחד — ונשאר אחד.** טיימר מחזורי חדש בשירות היה מחזיר
 * ‏בדיוק את מה שהמנגנון החליף: סבב בלי חכירה, שרץ בכל מופע.
 */
describe("‏אין טיימרים מחזוריים מחוץ למתזמן", () => {
  const SRC = join(import.meta.dirname, "..");
  const ALLOWED: Record<string, string> = {
    "core/sweeps.ts": "המתזמן עצמו",
    "core/outbox-dispatcher.service.ts":
      "דגימה כל שתי שניות, בטוחה בין מופעים מעצמה (FOR UPDATE SKIP LOCKED)",
    "modules/platform/disk-space.service.ts": "הדיסק הוא של המכונה — כל מופע בודק את שלו",
  };

  function sources(dir: string, rel = ""): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) return sources(join(dir, entry.name), path);
      return entry.name.endsWith(".ts") && !/\.(test|int\.test|testkit)\.ts$/u.test(entry.name)
        ? [path]
        : [];
    });
  }

  it("‏setInterval רק במקומות שיש להם נימוק", () => {
    const offenders = sources(SRC).filter(
      (path) => ALLOWED[path] === undefined && readFileSync(join(SRC, path), "utf8").includes("setInterval("),
    );
    expect(offenders, "השתמשו ב-@Sweep (core/sweeps.ts)").toEqual([]);
  });

  it("‏ורשימת החריגים אינה מתיישנת", () => {
    for (const path of Object.keys(ALLOWED)) {
      expect(readFileSync(join(SRC, path), "utf8"), path).toContain("setInterval(");
    }
  });
});
