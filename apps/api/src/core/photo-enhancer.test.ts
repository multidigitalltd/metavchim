import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { UnreadablePhotoError, blurPhotoRegions, enhancePhoto } from "./photo-enhancer";

/* ‏עיבוד תמונות אמיתי: תחת הסוויטה המלאה המעבד משותף, ו-5 שניות אינן מספיקות */
const SLOW = { timeout: 60_000 };

/**
 * ‏תמונות סינתטיות ולא קבצים בריפו: מדרון אופקי (כדי שמתיחת
 * ‏הניגודיות תהיה מוגדרת) בגודל שדורש כיווץ, עם דגל סיבוב.
 */
async function gradientJpeg(width: number, height: number, orientation?: number): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = 40 + Math.round((x / width) * 160);
      const at = (y * width + x) * 3;
      raw[at] = value;
      raw[at + 1] = value;
      raw[at + 2] = value;
    }
  }
  let pipeline = sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 90 });
  if (orientation !== undefined) pipeline = pipeline.withMetadata({ orientation });
  return pipeline.toBuffer();
}

async function pixelAt(image: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const { data } = await sharp(image)
    .extract({ left: x, top: y, width: 1, height: 1 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return [data[0]!, data[1]!, data[2]!];
}

describe("enhancePhoto", () => {
  it("מכווץ ל-2000 בצלע הארוכה, מיישר לפי EXIF, יוצא WebP בלי מטא-דאטה", SLOW, async () => {
    const input = await gradientJpeg(2400, 1600, 6);
    const out = await enhancePhoto(input);
    const meta = await sharp(out.buffer).metadata();
    expect(meta.format).toBe("webp");
    /* ‏סיבוב 90° הופך 2400×1600 ל-1600×2400, והצלע הארוכה נכנסת ב-2000 */
    expect(out.width).toBe(1333);
    expect(out.height).toBe(2000);
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    expect(out.buffer.length).toBeLessThan(input.length);
  });

  it("תמונה קטנה אינה מוגדלת", SLOW, async () => {
    const out = await enhancePhoto(await gradientJpeg(640, 480));
    expect([out.width, out.height]).toEqual([640, 480]);
  });

  it("הלוגו מוטבע בפינה הימנית-תחתונה, ולוגו פגום אינו מפיל את התמונה", SLOW, async () => {
    const logo = await sharp({ create: { width: 200, height: 100, channels: 3, background: "#ff0000" } })
      .png()
      .toBuffer();
    const out = await enhancePhoto(await gradientJpeg(1000, 800), { logo });
    const [r, g, b] = await pixelAt(out.buffer, out.width - 40, out.height - 40);
    expect(r).toBeGreaterThan(180);
    expect(g).toBeLessThan(90);
    expect(b).toBeLessThan(90);
    /* ‏הפינה הנגדית נשארת מדרון אפור */
    const [r2, g2] = await pixelAt(out.buffer, 30, 30);
    expect(Math.abs(r2 - g2)).toBeLessThan(12);

    const broken = await enhancePhoto(await gradientJpeg(600, 400), { logo: Buffer.from("not an image") });
    expect(broken.width).toBe(600);
  });

  it("קובץ שאינו תמונה נדחה בשגיאה מזוהה", SLOW, async () => {
    await expect(enhancePhoto(Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]))).rejects.toBeInstanceOf(
      UnreadablePhotoError,
    );
  });
});

describe("blurPhotoRegions", () => {
  it("מטשטש את המלבן ומשאיר את השאר חד", SLOW, async () => {
    /* ‏חצי שמאלי שחור, חצי ימני לבן — קצה חד באמצע */
    const width = 800;
    const height = 400;
    const raw = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const value = x < width / 2 ? 0 : 255;
        raw.fill(value, (y * width + x) * 3, (y * width + x) * 3 + 3);
      }
    }
    const input = await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
    const out = await blurPhotoRegions(input, [{ x: 0.4, y: 0, w: 0.2, h: 0.5 }]);
    expect(out.width).toBe(width);
    /* ‏בתוך המלבן: הקצה נמרח לאפור */
    const [inside] = await pixelAt(out.buffer, width / 2 - 2, 100);
    expect(inside).toBeGreaterThan(40);
    expect(inside).toBeLessThan(215);
    /* ‏מחוץ למלבן (למטה): הקצה נשאר חד */
    const [outsideLeft] = await pixelAt(out.buffer, width / 2 - 2, 350);
    const [outsideRight] = await pixelAt(out.buffer, width / 2 + 2, 350);
    expect(outsideLeft).toBeLessThan(20);
    expect(outsideRight).toBeGreaterThan(235);
  });

  it("מלבנים מחוץ לתמונה מדולגים והתמונה נשמרת כמות שהיא", SLOW, async () => {
    const out = await blurPhotoRegions(await gradientJpeg(300, 200), [{ x: 1, y: 1, w: 0.5, h: 0.5 }]);
    expect([out.width, out.height]).toEqual([300, 200]);
  });
});
