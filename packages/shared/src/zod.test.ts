import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as z from "./zod.js";

const SRC = import.meta.dirname;
const sources = (readdirSync(SRC, { recursive: true }) as string[]).filter(
  (file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && file !== "zod.ts",
);

describe("Zod", () => {
  it("רץ בלי הידור קוד — ה-CSP בדפדפן חוסם eval", () => {
    expect(z.config().jitless).toBe(true);
  });

  it("כל קובץ בחבילה מקבל אותו דרך zod.ts", () => {
    const direct = sources.filter((file) => /from "zod"/u.test(readFileSync(join(SRC, file), "utf8")));
    expect(direct).toEqual([]);
  });

  it("zod.ts רשום כקובץ עם תופעת לוואי, כדי שמאגד לא ידלג עליו", () => {
    const pkg = JSON.parse(readFileSync(join(SRC, "../package.json"), "utf8")) as { sideEffects: string[] };
    expect(pkg.sideEffects).toEqual(["./dist/zod.js", "./dist-esm/zod.js"]);
  });
});
