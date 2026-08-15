import { describe, expect, it } from "vitest";
import { shortVersion, versionAlignment, type ServiceVersion } from "./service-versions.js";

const v = (api: string | null, web: string | null, workers: string | null): ServiceVersion[] => [
  { key: "api", version: api },
  { key: "web", version: web },
  { key: "workers", version: workers },
];

describe("versionAlignment", () => {
  it("שלושתם על אותה גרסה — מיושר", () => {
    const out = versionAlignment(v("abc", "abc", "abc"));
    expect(out.state).toBe("aligned");
    expect(out.distinct).toBe(1);
  });

  it("ה-web נשאר מאחור — זה בדיוק המקרה שהמסך הישן החמיץ", () => {
    const out = versionAlignment(v("bfd8d0a", "cbba149", "bfd8d0a"));
    expect(out.state).toBe("mismatch");
    expect(out.distinct).toBe(2);
    expect(out.message).toContain("2 גרסאות");
  });

  it("שירות ששותק אינו נספר כפער, אבל גם אינו נחשב תקין", () => {
    const out = versionAlignment(v("abc", "abc", null));
    expect(out.state).toBe("unknown");
    expect(out.silent).toEqual(["workers"]);
    expect(out.distinct).toBe(1);
  });

  it("פער אמיתי גובר על שתיקה — קודם אומרים מה שבור", () => {
    const out = versionAlignment(v("abc", "def", null));
    expect(out.state).toBe("mismatch");
    expect(out.message).toContain("אינו מדווח");
  });

  it("אף אחד לא דיווח — לא מתחזים לידיעה", () => {
    expect(versionAlignment(v(null, null, null)).state).toBe("unknown");
  });
});

describe("shortVersion", () => {
  it("קידומת הקומיט מספיקה לזיהוי", () => {
    expect(shortVersion("bfd8d0a9d80c1234567")).toBe("bfd8d0a9d80c");
  });

  it("גרסת פיתוח נשארת כמו שהיא", () => {
    expect(shortVersion("dev")).toBe("dev");
  });
});
