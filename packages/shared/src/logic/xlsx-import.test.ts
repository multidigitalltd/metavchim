import { describe, expect, it } from "vitest";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { xlsxToCsv, xlsxToRecords, type InflateRaw } from "./xlsx-import.js";
import { parseBuyersCsv } from "./csv-import-buyers.js";

/*
 * הבדיקות בונות קובצי xlsx אמיתיים — ZIP תקני עם Central Directory —
 * ולא מדמות את הפענוח. inflate מוזרק מ-zlib של Node, בדיוק כפי
 * שהדפדפן מזריק DecompressionStream.
 */

const inflate: InflateRaw = (data) => Promise.resolve(new Uint8Array(inflateRawSync(data)));

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** ZIP מינימלי ותקני: Local headers + Central Directory + EOCD. */
function buildZip(files: { name: string; content: string; deflate?: boolean }[]): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const raw = encoder.encode(file.content);
    const data = file.deflate ? new Uint8Array(deflateRawSync(raw)) : raw;
    const method = file.deflate ? 8 : 0;
    const crc = crc32(raw);

    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, method, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    locals.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, method, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centrals.push(central);

    offset += local.length;
  }
  const centralSize = centrals.reduce((sum, c) => sum + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const total = new Uint8Array(offset + centralSize + 22);
  let pos = 0;
  for (const part of [...locals, ...centrals, eocd]) {
    total.set(part, pos);
    pos += part.length;
  }
  return total;
}

function sheet(rowsXml: string): string {
  return `<?xml version="1.0"?><worksheet><sheetData>${rowsXml}</sheetData></worksheet>`;
}

function sharedStrings(items: string[]): string {
  return `<?xml version="1.0"?><sst>${items.map((s) => `<si><t>${s}</t></si>`).join("")}</sst>`;
}

describe("xlsxToRecords", () => {
  it("קורא גיליון עם מחרוזות משותפות ומספרים", async () => {
    const zip = buildZip([
      { name: "xl/sharedStrings.xml", content: sharedStrings(["שם", "טלפון", "משה כהן"]) },
      {
        name: "xl/worksheets/sheet1.xml",
        content: sheet(
          '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
            '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>0501234567</v></c></row>',
        ),
        deflate: true,
      },
    ]);
    const records = await xlsxToRecords(zip, inflate);
    expect(records).toEqual([
      ["שם", "טלפון"],
      ["משה כהן", "0501234567"],
    ]);
  });

  it("תא חסר אינו מזיז את השורה — היישור לפי ref", async () => {
    /*
     * xlsx משמיט תאים ריקים. ספירה עיוורת הייתה שמה את הטלפון
     * בעמודת השם — ייבוא "מוצלח" עם נתונים שגויים, הגרוע מכישלון.
     */
    const zip = buildZip([
      {
        name: "xl/worksheets/sheet1.xml",
        content: sheet('<row r="5"><c r="A5"><v>1</v></c><c r="D5"><v>4</v></c></row>'),
      },
    ]);
    const records = await xlsxToRecords(zip, inflate);
    expect(records).toEqual([["1", "", "", "4"]]);
  });

  it("inlineStr וישויות XML מפוענחים", async () => {
    const zip = buildZip([
      {
        name: "xl/worksheets/sheet1.xml",
        content: sheet(
          '<row r="1"><c r="A1" t="inlineStr"><is><t>דירה &amp; גינה</t></is></c></row>',
        ),
      },
    ]);
    const records = await xlsxToRecords(zip, inflate);
    expect(records[0]?.[0]).toBe("דירה & גינה");
  });

  it("מחרוזת עשירה שמפוצלת לכמה קטעי t מתאחדת", async () => {
    const zip = buildZip([
      {
        name: "xl/sharedStrings.xml",
        content: '<?xml version="1.0"?><sst><si><r><t>בני </t></r><r><t>ברק</t></r></si></sst>',
      },
      {
        name: "xl/worksheets/sheet1.xml",
        content: sheet('<row r="1"><c r="A1" t="s"><v>0</v></c></row>'),
      },
    ]);
    const records = await xlsxToRecords(zip, inflate);
    expect(records[0]?.[0]).toBe("בני ברק");
  });

  it("קובץ שאינו ZIP נדחה עם שגיאה ברורה", async () => {
    await expect(xlsxToRecords(new TextEncoder().encode("just,a,csv"), inflate)).rejects.toThrow(
      "לא קובץ xlsx",
    );
  });
});

describe("xlsx ⟵ ייבוא קונים, מקצה לקצה", () => {
  it("ייצוא CRM באנגלית נקלט: phoneNumber, contactFullName, customerBudget", async () => {
    /*
     * זה מבנה הקובץ האמיתי שנדחה — ייצוא מהמערכת הקודמת של המשרד,
     * עם כותרות טכניות באנגלית ותאים חסרים באמצע השורה.
     */
    const zip = buildZip([
      {
        name: "xl/sharedStrings.xml",
        content: sharedStrings([
          "phoneNumber",
          "contactFullName",
          "customerBudget",
          "interestedInCitiesDistinct",
          "additionalNotes",
          "contactOrigin",
          "customerSeriousness",
          "+972501234567",
          "משה כהן",
          "בני ברק, רמת גן",
          "מחפש דירה משופצת",
          "פייסבוק",
          "רציני",
        ]),
      },
      {
        name: "xl/worksheets/sheet1.xml",
        content: sheet(
          '<row r="1">' +
            '<c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c>' +
            '<c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c>' +
            '<c r="E1" t="s"><v>4</v></c><c r="F1" t="s"><v>5</v></c>' +
            '<c r="G1" t="s"><v>6</v></c>' +
            "</row>" +
            // שורה עם תאים חסרים (B ריק) — כמו בקובץ האמיתי
            '<row r="2">' +
            '<c r="A2" t="s"><v>7</v></c><c r="B2" t="s"><v>8</v></c>' +
            '<c r="C2"><v>1750000</v></c><c r="D2" t="s"><v>9</v></c>' +
            '<c r="E2" t="s"><v>10</v></c><c r="F2" t="s"><v>11</v></c>' +
            '<c r="G2" t="s"><v>12</v></c>' +
            "</row>",
        ),
        deflate: true,
      },
    ]);
    const csv = await xlsxToCsv(zip, inflate);
    const { rows, unmappedHeaders } = parseBuyersCsv(csv);
    expect(unmappedHeaders).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "משה כהן",
      phone: "+972501234567",
      budgetMaxAgorot: 175_000_000,
      cities: ["בני ברק", "רמת גן"],
      source: "פייסבוק",
      maturity: "hot", // "רציני"
    });
    expect(rows[0]?.agentNotes).toContain("מחפש דירה משופצת");
  });

  it("ערך עם פסיק ומרכאות שורד את מסלול ה-CSV", async () => {
    const zip = buildZip([
      {
        name: "xl/worksheets/sheet1.xml",
        content: sheet(
          '<row r="1"><c r="A1" t="inlineStr"><is><t>הערות</t></is></c></row>' +
            '<row r="2"><c r="A2" t="inlineStr"><is><t>אמר "אולי", נחזור מחר</t></is></c></row>',
        ),
      },
    ]);
    const csv = await xlsxToCsv(zip, inflate);
    const { rows } = parseBuyersCsv(csv);
    expect(rows[0]?.agentNotes).toBe('אמר "אולי", נחזור מחר');
  });
});
