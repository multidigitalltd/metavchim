import { describe, expect, it } from "vitest";
import {
  SERVER_ERROR_DIGEST_TOP,
  SERVER_ERROR_SIGNATURE_MAX,
  serverErrorDigest,
  serverErrorSignature,
  type ServerErrorRow,
} from "./server-errors.js";

describe("serverErrorSignature", () => {
  it("‏אותה תקלה עם מזהים אחרים — אותה חתימה", () => {
    expect(serverErrorSignature("הנכס 01JTENANT0000000000000000A לא נמצא")).toBe(
      serverErrorSignature("הנכס 01K9ZQ7Y3M4N5P6R8S0T1V2W3X לא נמצא"),
    );
    expect(serverErrorSignature("row 3f2b8c1a-1111-4222-8333-944445555666 missing")).toBe(
      "row <id> missing",
    );
  });

  it("‏מספרים, טלפונים וכתובות מייל אינם נשמרים", () => {
    const signature = serverErrorSignature(
      'Unique constraint failed on phone_hash "0501234567" for dana@example.co.il, amount 2400000',
    );
    expect(signature).toBe('Unique constraint failed on phone_hash "#" for <email>, amount #');
    expect(signature).not.toMatch(/\d/u);
  });

  it("‏גיבוב ארוך מוחלף, ומילים רגילות נשארות", () => {
    expect(serverErrorSignature("token deadbeefdeadbeefdeadbeef rejected by Meta")).toBe(
      "token <hex> rejected by Meta",
    );
  });

  it("‏רווחים מכווצים, ואורך חסום", () => {
    expect(serverErrorSignature("  a\n\n  b\t c ")).toBe("a b c");
    expect(serverErrorSignature("x".repeat(1000))).toHaveLength(SERVER_ERROR_SIGNATURE_MAX);
  });
});

const at = (iso: string): Date => new Date(iso);
const row = (over: Partial<ServerErrorRow>): ServerErrorRow => ({
  source: "ExceptionsHandler",
  signature: "boom",
  count: 1,
  firstAt: at("2026-09-30T05:00:00Z"),
  lastAt: at("2026-09-30T05:00:00Z"),
  ...over,
});
const hhmm = (date: Date): string => date.toISOString().slice(11, 16);

describe("serverErrorDigest", () => {
  it("‏הנפוצות למעלה, עם הסכום והתאריך הישראלי בנושא", () => {
    const digest = serverErrorDigest(
      "2026-09-30",
      [row({ source: "A", count: 2, lastAt: at("2026-09-30T06:30:00Z") }), row({ source: "B", count: 5 })],
      hhmm,
    );
    expect(digest.subject).toBe("שגיאות שרת ב-30.9.2026: 7");
    expect(digest.details.map((detail) => detail.label)).toEqual(["5× · B", "2× · A"]);
    expect(digest.details[1]?.value).toBe("boom (05:00–06:30)");
    expect(digest.details[0]?.value).toBe("boom (05:00)");
  });

  it("‏מעבר לרשימה — שורה אחת שסופרת את השאר", () => {
    const rows = Array.from({ length: SERVER_ERROR_DIGEST_TOP + 3 }, (_, i) =>
      row({ source: `S${i}`, count: 1 }),
    );
    const digest = serverErrorDigest("2026-09-30", rows, hhmm);
    expect(digest.details).toHaveLength(SERVER_ERROR_DIGEST_TOP + 1);
    expect(digest.details.at(-1)).toEqual({ label: "3×", value: "עוד 3 סוגים" });
  });
});
