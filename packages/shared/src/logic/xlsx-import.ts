/**
 * קריאת ‎.xlsx‎ — בלי תלות חיצונית, ניתן לבדיקה.
 *
 * הקובץ הראשון שמשרד אמיתי ניסה לייבא היה xlsx (ייצוא מה-CRM הקודם
 * שלו, 1,295 לקוחות), ומסך הייבוא קרא אותו כטקסט: xlsx הוא ZIP של
 * XML, והתוצאה הייתה ג'יבריש ואפס שורות.
 *
 * הדרך המקובלת היא ספריית ענק עם היסטוריית אבטחה בעייתית. הדרך כאן:
 * קריאת ה-ZIP ופענוח ה-XML הם קוד שלנו, וה-inflate — החלק היחיד
 * שדורש פלטפורמה — **מוזרק**: הדפדפן נותן DecompressionStream,
 * והבדיקות נותנות zlib. כך הלוגיקה שקל לטעות בה (יישור תאים חסרים,
 * מחרוזות משותפות, ישויות XML) מכוסה בבדיקות אמיתיות.
 *
 * ה-XML נסרק בביטויים רגולריים ולא במפרסר מלא — מותר כאן ורק כאן:
 * הקבצים האלה נוצרים ע"י תוכנה (Excel, Sheets, ייצוא CRM) והמבנה
 * שלהם מכני לחלוטין. זה לא מפרסר XML כללי ואסור שיהפוך לאחד.
 */

/** פריסת deflate-raw — מוזרקת כי היא היכולת היחידה שתלויה בפלטפורמה. */
export type InflateRaw = (data: Uint8Array) => Promise<Uint8Array>;

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
}

/** UTF-8 ידני — ‎TextDecoder‎ אינו חלק מ-ES, והקובץ הזה ניטרלי-פלטפורמה. */
function utf8(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i]!;
    let code: number;
    if (b < 0x80) {
      code = b;
      i += 1;
    } else if (b < 0xe0) {
      code = ((b & 0x1f) << 6) | (bytes[i + 1]! & 0x3f);
      i += 2;
    } else if (b < 0xf0) {
      code = ((b & 0x0f) << 12) | ((bytes[i + 1]! & 0x3f) << 6) | (bytes[i + 2]! & 0x3f);
      i += 3;
    } else {
      code =
        ((b & 0x07) << 18) |
        ((bytes[i + 1]! & 0x3f) << 12) |
        ((bytes[i + 2]! & 0x3f) << 6) |
        (bytes[i + 3]! & 0x3f);
      i += 4;
    }
    out += String.fromCodePoint(code);
  }
  return out;
}

/** הישויות שמחוללי xlsx באמת כותבים — כולל התווית המספרית. */
function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/gu, (_all, body: string) => {
    if (body === "amp") return "&";
    if (body === "lt") return "<";
    if (body === "gt") return ">";
    if (body === "quot") return '"';
    if (body === "apos") return "'";
    const code = body.startsWith("#x") ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : "";
  });
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function readEntries(bytes: Uint8Array): ZipEntry[] {
  const dv = view(bytes);
  /*
   * ה-End-Of-Central-Directory יושב בסוף, לפני הערת סיום שאורכה
   * משתנה — סורקים אחורה עד 64KB לחתימה.
   */
  let eocd = -1;
  const min = Math.max(0, bytes.length - 65_557);
  for (let i = bytes.length - 22; i >= min; i -= 1) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("לא קובץ xlsx תקין");

  const count = dv.getUint16(eocd + 10, true);
  let offset = dv.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (dv.getUint32(offset, true) !== 0x02014b50) break;
    const nameLen = dv.getUint16(offset + 28, true);
    const extraLen = dv.getUint16(offset + 30, true);
    const commentLen = dv.getUint16(offset + 32, true);
    entries.push({
      method: dv.getUint16(offset + 10, true),
      compressedSize: dv.getUint32(offset + 20, true),
      name: utf8(bytes.subarray(offset + 46, offset + 46 + nameLen)),
      localOffset: dv.getUint32(offset + 42, true),
    });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function extract(bytes: Uint8Array, entry: ZipEntry, inflate: InflateRaw): Promise<string> {
  const dv = view(bytes);
  const base = entry.localOffset;
  if (dv.getUint32(base, true) !== 0x04034b50) throw new Error("קובץ xlsx פגום");
  // הכותרת המקומית חוזרת על השם וה-extra; הנתונים מתחילים אחריהם
  const nameLen = dv.getUint16(base + 26, true);
  const extraLen = dv.getUint16(base + 28, true);
  const start = base + 30 + nameLen + extraLen;
  const data = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return utf8(data);
  if (entry.method !== 8) throw new Error("דחיסה לא נתמכת בקובץ");
  return utf8(await inflate(data));
}

/** ‎"AB7"‎ → אינדקס עמודה 27. בלעדיו תא חסר מזיז את כל השורה שמאלה. */
function columnIndex(cellRef: string): number {
  let col = 0;
  for (const ch of cellRef) {
    if (ch < "A" || ch > "Z") break;
    col = col * 26 + (ch.charCodeAt(0) - 64);
  }
  return col - 1;
}

/** כל קטעי ה-t בתוך תא/מחרוזת — מחרוזת עשירה מפוצלת לכמה קטעים. */
function textRuns(xml: string): string {
  let out = "";
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gu)) out += decodeEntities(m[1]!);
  // ‎<t/>‎ ריק פשוט לא תורם כלום
  return out;
}

export async function xlsxToRecords(bytes: Uint8Array, inflate: InflateRaw): Promise<string[][]> {
  const entries = readEntries(bytes);

  // הגיליון הראשון לפי מספר — קובצי ייצוא הם תמיד גיליון אחד
  const sheetEntry = entries
    .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/u.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))[0];
  if (!sheetEntry) throw new Error("לא נמצא גיליון בקובץ");

  const sharedEntry = entries.find((e) => e.name === "xl/sharedStrings.xml");
  const shared: string[] = [];
  if (sharedEntry) {
    const xml = await extract(bytes, sharedEntry, inflate);
    for (const si of xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/gu)) {
      shared.push(textRuns(si[1]!));
    }
  }

  const sheetXml = await extract(bytes, sheetEntry, inflate);
  const records: string[][] = [];
  for (const rowMatch of sheetXml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/gu)) {
    const cells: string[] = [];
    let fallbackCol = 0;
    for (const cellMatch of rowMatch[1]!.matchAll(
      /<c(\s[^>]*)?(?:\/>|>([\s\S]*?)<\/c>)/gu,
    )) {
      const attrs = cellMatch[1] ?? "";
      const inner = cellMatch[2] ?? "";
      /*
       * המיקום מה-ref של התא, לא מסדר ההופעה: xlsx משמיט תאים ריקים,
       * וספירה עיוורת הייתה מזיזה כל ערך אחרי תא ריק עמודה שמאלה —
       * טלפון בעמודת השם, תקציב בעמודת העיר. זה בדיוק הבאג שהופך
       * ייבוא ל"הצליח" עם נתונים שגויים, הגרוע מכל הכישלונות.
       */
      const ref = /\br="([A-Z]+)\d+"/u.exec(attrs)?.[1];
      const col = ref !== undefined ? columnIndex(ref) : fallbackCol;
      fallbackCol = col + 1;

      const type = /\bt="([^"]+)"/u.exec(attrs)?.[1];
      let value = "";
      if (type === "inlineStr") {
        value = textRuns(inner);
      } else {
        const raw = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/u.exec(inner)?.[1] ?? "";
        value = type === "s" ? (shared[Number(decodeEntities(raw))] ?? "") : decodeEntities(raw);
      }
      while (cells.length < col) cells.push("");
      cells[col] = value;
    }
    records.push(cells);
  }
  return records;
}

/** שדה CSV תקני — מרכאות רק כשחייבים, והכפלה של מרכאות פנימיות. */
function csvField(value: string): string {
  return /[",\n\r]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/**
 * ‎xlsx ⟵ CSV‎ — כדי שכל צינור הייבוא הקיים (מיפוי כותרות, ולידציה,
 * תצוגה מקדימה) יעבוד על xlsx בלי לדעת שהוא xlsx. נתיב אחד לשני
 * סוגי קבצים; שני נתיבים היו נפרדים בדיוק בכלל שמישהו יתקן רק באחד.
 */
export async function xlsxToCsv(bytes: Uint8Array, inflate: InflateRaw): Promise<string> {
  const records = await xlsxToRecords(bytes, inflate);
  return records.map((row) => row.map(csvField).join(",")).join("\n");
}
