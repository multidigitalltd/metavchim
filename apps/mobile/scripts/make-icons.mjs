#!/usr/bin/env node
/**
 * ‏האייקונים של האפליקציה — נוצרים מקוד, בלי תלות חיצונית.
 *
 * ‏סימן הבית בצבע הפעולה על הרקע הראשי של המערכת (אותם טוקנים כמו
 * ‏ב-`globals.css`). קובץ שנוצר מקוד אפשר לשחזר ולשנות בלי כלי
 * ‏עיצוב; כשתגיע חבילת מיתוג, הקבצים ב-`assets/` פשוט מוחלפים.
 *
 *   node scripts/make-icons.mjs
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");
mkdirSync(OUT, { recursive: true });

const PRIMARY = [0x0c, 0x6e, 0x34];
const ACTION = [0x70, 0xee, 0x91];
const WHITE = [0xff, 0xff, 0xff];

function crc32(buf) {
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n += 1) {
    let c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** ‏נקודה בתוך מצולע — קרן אופקית, מספר חיתוכים אי-זוגי. */
function inside(polygon, x, y) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/**
 * ‏הבית: גג משולש, גוף, ודלת בצבע הרקע. הקואורדינטות יחסיות (0–1),
 * ‏ולכן אותו סימן מצויר בכל גודל. `scale` מכווץ את הסימן לתוך
 * ‏„האזור הבטוח” של אייקון אדפטיבי (המערכת חותכת את השוליים).
 */
function houseShapes(scale) {
  const s = (v) => 0.5 + (v - 0.5) * scale;
  const roof = [
    [s(0.5), s(0.18)],
    [s(0.88), s(0.52)],
    [s(0.12), s(0.52)],
  ];
  const body = [
    [s(0.22), s(0.5)],
    [s(0.78), s(0.5)],
    [s(0.78), s(0.84)],
    [s(0.22), s(0.84)],
  ];
  const door = [
    [s(0.43), s(0.62)],
    [s(0.57), s(0.62)],
    [s(0.57), s(0.84)],
    [s(0.43), s(0.84)],
  ];
  return { roof, body, door };
}

/**
 * ‏PNG. `background` null = שקוף (RGBA), אחרת RGB אטום. הקצוות
 * ‏מוחלקים בדגימת-על 3×3 — אייקון בלי החלקה נראה משונן בכל גודל.
 */
function png({ size, background, mark, scale }) {
  const alpha = background === null;
  const channels = alpha ? 4 : 3;
  const row = size * channels + 1;
  const raw = Buffer.alloc(row * size);
  const { roof, body, door } = houseShapes(scale);
  const SS = 3;
  for (let y = 0; y < size; y += 1) {
    raw[y * row] = 0;
    for (let x = 0; x < size; x += 1) {
      let cover = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const px = (x + (sx + 0.5) / SS) / size;
          const py = (y + (sy + 0.5) / SS) / size;
          const onMark =
            (inside(roof, px, py) || inside(body, px, py)) && !inside(door, px, py);
          if (onMark) cover += 1;
        }
      }
      const a = cover / (SS * SS);
      const o = y * row + 1 + x * channels;
      if (alpha) {
        raw[o] = mark[0];
        raw[o + 1] = mark[1];
        raw[o + 2] = mark[2];
        raw[o + 3] = Math.round(a * 255);
      } else {
        for (let c = 0; c < 3; c += 1) {
          raw[o + c] = Math.round(background[c] * (1 - a) + mark[c] * a);
        }
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = alpha ? 6 : 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const files = {
  // ‏אייקון iOS ורשימת האפליקציות — הסימן ממלא את הריבוע
  "icon.png": png({ size: 1024, background: PRIMARY, mark: ACTION, scale: 1 }),
  // ‏אנדרואיד אדפטיבי — הרקע מהתצורה, הסימן בתוך האזור הבטוח
  "adaptive-icon.png": png({ size: 1024, background: null, mark: ACTION, scale: 0.66 }),
  // ‏מסך הפתיחה — הרקע מהתצורה, סימן קטן במרכז
  "splash.png": png({ size: 1024, background: null, mark: ACTION, scale: 0.4 }),
  // ‏אייקון ההתראה באנדרואיד — לבן על שקוף בלבד; הצבע מגיע מהתצורה
  "notification-icon.png": png({ size: 96, background: null, mark: WHITE, scale: 0.9 }),
};

for (const [name, data] of Object.entries(files)) {
  writeFileSync(join(OUT, name), data);
  console.log(`✓ assets/${name} (${data.length} bytes)`);
}
