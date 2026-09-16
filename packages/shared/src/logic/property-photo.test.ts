import { describe, expect, it } from "vitest";
import {
  PHOTO_MAX_EDGE,
  blurRectToPixels,
  fitWithin,
  photoLogoOverlayOn,
} from "./property-photo.js";

describe("מלבן טשטוש — משברים לפיקסלים", () => {
  it("רבע מהרוחב וחצי מהגובה על 2000×1000", () => {
    expect(blurRectToPixels({ x: 0.25, y: 0.5, w: 0.25, h: 0.25 }, 2000, 1000)).toEqual({
      left: 500,
      top: 500,
      width: 500,
      height: 250,
    });
  });
  it("מלבן שחורג מהתמונה נגזר לגבולותיה", () => {
    expect(blurRectToPixels({ x: 0.9, y: 0.9, w: 0.5, h: 0.5 }, 1000, 1000)).toEqual({
      left: 900,
      top: 900,
      width: 100,
      height: 100,
    });
  });
  it("מלבן מחוץ לתמונה, או קטן מדי, הוא null ולא שגיאה", () => {
    expect(blurRectToPixels({ x: 1, y: 1, w: 0.2, h: 0.2 }, 1000, 1000)).toBeNull();
    expect(blurRectToPixels({ x: 0.5, y: 0.5, w: 0.001, h: 0.001 }, 1000, 1000)).toBeNull();
    expect(blurRectToPixels({ x: Number.NaN, y: 0, w: 0.5, h: 0.5 }, 0, 0)).toBeNull();
  });
});

describe("גודל התוצאה", () => {
  it("תמונה גדולה נכנסת בתוך הצלע המרבית ושומרת יחס", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: PHOTO_MAX_EDGE, height: 1500 });
    expect(fitWithin(1500, 4500)).toEqual({ width: 667, height: PHOTO_MAX_EDGE });
  });
  it("תמונה קטנה אינה מוגדלת", () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

describe("הטבעת לוגו", () => {
  it("חסר = כבוי; רק true מדליק", () => {
    expect(photoLogoOverlayOn(null)).toBe(false);
    expect(photoLogoOverlayOn({})).toBe(false);
    expect(photoLogoOverlayOn({ photoLogoOverlay: "true" })).toBe(false);
    expect(photoLogoOverlayOn({ photoLogoOverlay: true })).toBe(true);
  });
});
