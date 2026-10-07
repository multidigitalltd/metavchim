import { afterEach, describe, expect, it, vi } from "vitest";
import { describeFetchFailure, fetchFailureCode, resilientFetch } from "./outbound-fetch";

/** ‏כמו שזורק `fetch` של Node: TypeError, והסיבה ב-`cause`. */
function networkError(code: string): TypeError {
  return new TypeError("fetch failed", { cause: Object.assign(new Error(code), { code }) });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function run(fetchMock: ReturnType<typeof vi.fn>, idempotent: boolean): Promise<unknown> {
  vi.stubGlobal("fetch", fetchMock);
  vi.useFakeTimers();
  const pending = resilientFetch("https://example.test", { method: "GET" }, { idempotent, timeoutMs: 1000 }).then(
    (res) => res,
    (error: unknown) => error,
  );
  await vi.runAllTimersAsync();
  return pending;
}

describe("resilientFetch — תקלת רשת חולפת", () => {
  it("ניתוק בקריאה אידמפוטנטית — נשלח שוב ומצליח", async () => {
    const ok = new Response("{}");
    const fetchMock = vi.fn().mockRejectedValueOnce(networkError("ECONNRESET")).mockResolvedValueOnce(ok);
    expect(await run(fetchMock, true)).toBe(ok);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ניתוק בקריאה שאינה אידמפוטנטית — לא נשלח שוב", async () => {
    const fetchMock = vi.fn().mockRejectedValue(networkError("ECONNRESET"));
    expect(await run(fetchMock, false)).toBeInstanceOf(TypeError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("חיבור שלא נוצר — בטוח לשלוח שוב גם כשאינה אידמפוטנטית", async () => {
    const ok = new Response("{}");
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(networkError("UND_ERR_CONNECT_TIMEOUT"))
      .mockResolvedValueOnce(ok);
    expect(await run(fetchMock, false)).toBe(ok);
  });

  it("לכל היותר שני ניסיונות חוזרים — ואז התקלה עצמה", async () => {
    const fetchMock = vi.fn().mockRejectedValue(networkError("EAI_AGAIN"));
    expect(await run(fetchMock, true)).toBeInstanceOf(TypeError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("תם הזמן ושגיאה שאינה רשת — לא נשלחים שוב", async () => {
    const timeout = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    const fetchMock = vi.fn().mockRejectedValue(timeout);
    expect(await run(fetchMock, true)).toBe(timeout);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("describeFetchFailure — הסיבה בהודעה", () => {
  it("הקוד מתוך `cause`", () => {
    expect(fetchFailureCode(networkError("ECONNRESET"))).toBe("ECONNRESET");
    expect(describeFetchFailure(networkError("ECONNRESET"))).toBe("fetch failed (ECONNRESET)");
  });

  it("ניסיון לשתי משפחות כתובות — הקוד של הראשון", () => {
    const aggregate = Object.assign(new AggregateError([Object.assign(new Error("x"), { code: "ETIMEDOUT" })]), {});
    expect(fetchFailureCode(new TypeError("fetch failed", { cause: aggregate }))).toBe("ETIMEDOUT");
  });

  it("תם הזמן — נאמר במפורש", () => {
    const timeout = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    expect(describeFetchFailure(timeout)).toBe("תם הזמן להמתנה לתשובה");
  });
});
