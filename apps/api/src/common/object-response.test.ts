import { StreamableFile } from "@nestjs/common";
import { Readable } from "node:stream";
import type { Request, Response } from "express";
import { describe, expect, it } from "vitest";
import { objectResponse } from "./object-response";

function fakeRes(): { res: Response; headers: Record<string, string>; status: number | null } {
  const headers: Record<string, string> = {};
  const state = { status: null as number | null };
  const res = {
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
    status: (code: number) => {
      state.status = code;
      return res;
    },
  } as unknown as Response;
  return { res, headers, get status() { return state.status; } };
}

function req(ifNoneMatch?: string): Request {
  return { headers: ifNoneMatch === undefined ? {} : { "if-none-match": ifNoneMatch } } as unknown as Request;
}

describe("objectResponse — תמונה שמשתכתבת במקום", () => {
  it("תמיד no-cache עם ETag, ו-CORP same-site", () => {
    const r = fakeRes();
    const out = objectResponse(req(), r.res, { body: Readable.from([]), contentType: "image/webp", contentLength: 3, etag: '"abc"' }, "private");
    expect(out).toBeInstanceOf(StreamableFile);
    expect(r.headers["Cache-Control"]).toBe("private, no-cache");
    expect(r.headers["ETag"]).toBe('"abc"');
    expect(r.headers["Cross-Origin-Resource-Policy"]).toBe("same-site");
    expect(r.status).toBeNull();
  });

  it("If-None-Match תואם — 304 בלי גוף, והזרם נסגר; גם עם W/ ועם כמה תגים", () => {
    for (const header of ['"abc"', 'W/"abc"', '"zzz", "abc"']) {
      const r = fakeRes();
      let destroyed = false;
      const body = Object.assign(Readable.from([]), { destroy: () => { destroyed = true; } });
      const out = objectResponse(req(header), r.res, { body, etag: '"abc"' }, "public");
      expect(out).toBeUndefined();
      expect(r.status).toBe(304);
      expect(destroyed).toBe(true);
    }
  });

  it("ETag שונה או חסר — 200 עם הגוף", () => {
    const r = fakeRes();
    expect(objectResponse(req('"old"'), r.res, { body: Readable.from([]), etag: '"new"' }, "public")).toBeInstanceOf(StreamableFile);
    const r2 = fakeRes();
    expect(objectResponse(req('"old"'), r2.res, { body: Readable.from([]) }, "public")).toBeInstanceOf(StreamableFile);
    expect(r2.headers["ETag"]).toBeUndefined();
  });
});
