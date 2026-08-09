import { describe, expect, it } from "vitest";
import { MAX_SIGNATURE_CHARS, isSignatureDataUrl } from "./signature-image.js";

const png = (chars: number): string => `data:image/png;base64,${"A".repeat(chars)}`;

describe("isSignatureDataUrl", () => {
  it("PNG בגודל סביר מתקבל", () => {
    expect(isSignatureDataUrl(png(2000))).toBe(true);
  });

  it("ריפוד base64 חוקי", () => {
    expect(isSignatureDataUrl(`${png(1998)}==`)).toBe(true);
  });

  it("SVG נדחה — הוא מסמך שמריץ סקריפטים", () => {
    expect(isSignatureDataUrl("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=")).toBe(false);
  });

  it("תווים מחוץ ל-base64 נדחים — הם מה שמאפשר לצאת מהתכונה", () => {
    expect(isSignatureDataUrl(`data:image/png;base64,${"A".repeat(200)}"><img`)).toBe(false);
  });

  it("גדול מדי נדחה — הקלט ציבורי", () => {
    expect(isSignatureDataUrl(png(MAX_SIGNATURE_CHARS))).toBe(false);
  });

  it("קטן מדי נדחה — קנבס שלא נגעו בו", () => {
    expect(isSignatureDataUrl(png(10))).toBe(false);
  });

  it("מחרוזת שאינה data URL בכלל", () => {
    expect(isSignatureDataUrl("https://example.com/sig.png")).toBe(false);
  });
});
