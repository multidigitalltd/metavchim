import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Inject, Injectable } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type IORedis from "ioredis";
import { describe, expect, it } from "vitest";
import { REDIS, REDIS_PROVIDERS } from "./redis";

/**
 * ‎**חיבור Redis אחד — ונשאר אחד.** ראו `redis.ts`.
 */

@Injectable()
class FirstConsumer {
  constructor(@Inject(REDIS) readonly redis: IORedis) {}
}

@Injectable()
class SecondConsumer {
  constructor(@Inject(REDIS) readonly redis: IORedis) {}
}

function fakeRedis(quit: () => Promise<unknown>) {
  const calls = { quit: 0 };
  const client = {
    quit: async () => {
      calls.quit += 1;
      return quit();
    },
  };
  return { client, calls };
}

async function app(client: unknown) {
  return Test.createTestingModule({ providers: [...REDIS_PROVIDERS, FirstConsumer, SecondConsumer] })
    .overrideProvider(REDIS)
    .useValue(client)
    .compile();
}

describe("‏החיבור המשותף", () => {
  it("‏כל השירותים מקבלים את אותו חיבור", async () => {
    const { client } = fakeRedis(async () => "OK");
    const module = await app(client);
    expect(module.get(FirstConsumer).redis).toBe(client);
    expect(module.get(SecondConsumer).redis).toBe(client);
    await module.close();
  });

  it("‏נסגר פעם אחת בכיבוי", async () => {
    const { client, calls } = fakeRedis(async () => "OK");
    const module = await app(client);
    await module.close();
    expect(calls.quit).toBe(1);
  });

  it("‏סגירה שנכשלה (Redis כבר למטה) אינה מפילה את הכיבוי", async () => {
    const { client, calls } = fakeRedis(async () => {
      throw new Error("Connection is closed.");
    });
    const module = await app(client);
    await expect(module.close()).resolves.toBeUndefined();
    expect(calls.quit).toBe(1);
  });
});

/*
 * ‏חיבור חדש בשירות היה מחזיר בדיוק את מה שהוחלף: עוד חיבור לכל מופע,
 * ‏עוד מאזין שגיאה, עוד סגירה בכיבוי.
 */
describe("‏אין חיבורי Redis מחוץ לחיבור המשותף", () => {
  const SRC = join(import.meta.dirname, "..");
  const ALLOWED: Record<string, string> = {
    "core/redis.ts": "החיבור המשותף עצמו",
    "core/outbox-dispatcher.service.ts":
      "ממתין ל-Redis שנפל במקום להיכשל מהר — אצלו כישלון נספר כניסיון (ראו redis.ts)",
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

  it("‏`new IORedis` רק במקומות שיש להם נימוק", () => {
    const offenders = sources(SRC).filter(
      (path) => ALLOWED[path] === undefined && readFileSync(join(SRC, path), "utf8").includes("new IORedis("),
    );
    expect(offenders, "הזריקו את החיבור המשותף: @Inject(REDIS)").toEqual([]);
  });

  it("‏ורשימת החריגים אינה מתיישנת", () => {
    for (const path of Object.keys(ALLOWED)) {
      expect(readFileSync(join(SRC, path), "utf8"), path).toContain("new IORedis(");
    }
  });
});
