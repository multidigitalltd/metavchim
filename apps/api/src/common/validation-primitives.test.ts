import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ‎**כלל אימות אחד לכל דבר שחוזר.**
 *
 * ‏מזהה, טוקן ציבורי, אימייל וטלפון נכתבו שוב ושוב בכל בקר — ועותק
 * ‏שנכתב לבד נפרד מהמקור: מזהה בכללי האוטומציה קיבל כל 26 תווים, לא
 * ‏רק ULID; וטלפון בפרופיל ובצוות פסל `(054) 1234567`.
 * ‏המקור: `IdParam` / `PublicTokenParam` ב-`zod-validation.pipe.ts`,
 * ‏ו-`IdSchema` / `EmailSchema` / `OptionalPhoneInputSchema` ב-`@metavchim/shared`.
 */

const ROOT = join(import.meta.dirname, "../../../..");

function sources(dir: string): { path: string; text: string }[] {
  return readdirSync(join(ROOT, dir), { recursive: true, encoding: "utf8" })
    .filter((name) => /\.tsx?$/u.test(name) && !/\.(test|int\.test|testkit)\.ts$/u.test(name))
    .map((name) => ({ path: `${dir}/${name}`, text: readFileSync(join(ROOT, dir, name), "utf8") }));
}

const API = sources("apps/api/src");
const SHARED = sources("packages/shared/src");
const WEB = sources("apps/web/src");

function offenders(
  files: { path: string; text: string }[],
  pattern: RegExp,
  allowed: Record<string, string>,
): string[] {
  return files.filter((file) => allowed[file.path] === undefined && pattern.test(file.text)).map((file) => file.path);
}

describe("כללי אימות משותפים", () => {
  it("מזהה בנתיב — `IdParam` המשותף, לא צינור מקומי", () => {
    expect(
      offenders(API, /const IdParam =|new ZodValidationPipe\(IdSchema\)/u, {
        "apps/api/src/common/zod-validation.pipe.ts": "המקור",
      }),
    ).toEqual([]);
  });

  it("אין הגדרה מקומית של סכמת מזהה", () => {
    expect(offenders(API, /z\.string\(\)\.length\(26\)/u, {})).toEqual([]);
    expect(
      offenders([...API, ...SHARED], /z\.string\(\)\.regex\(\/\^\[0-9A-HJKMNP-TV-Z\]\{26\}\$/u, {
        "packages/shared/src/schemas/common.ts": "המקור — IdSchema",
      }),
    ).toEqual([]);
  });

  it("טוקן ציבורי — `PublicTokenSchema` המשותף", () => {
    expect(
      offenders(API, /\[A-Za-z0-9_-\]\{43\}/u, {
        "apps/api/src/common/zod-validation.pipe.ts": "המקור",
        "apps/api/src/common/session-token.ts": "כותרת Bearer — אותו טוקן בתוך תבנית של כותרת",
      }),
    ).toEqual([]);
  });

  it("טלפון שאדם מקליד — `OptionalPhoneInputSchema` המשותף", () => {
    expect(offenders([...API, ...WEB], /\[\\d\\-\+ \]\{9,20\}/u, {})).toEqual([]);
  });

  it("אימייל — `EmailSchema` המשותף", () => {
    expect(
      offenders([...API, ...SHARED], /z\.string\(\)\.trim\(\)\.email\(\)\.max\(254\)/u, {
        "packages/shared/src/schemas/common.ts": "המקור",
      }),
    ).toEqual([]);
  });
});
