import { describe, expect, it } from "vitest";
import {
  DOCUMENT_KINDS,
  DOCUMENT_KIND_LABELS,
  documentUnlocksOffers,
  formatFileSize,
  safeFileName,
  sniffDocumentType,
} from "./signed-documents.js";

/** בתים ראשונים של קובץ, מרופדים עד אורך שהזיהוי דורש. */
function header(bytes: number[], length = 32): Uint8Array {
  const buf = new Uint8Array(length);
  buf.set(bytes.slice(0, length));
  return buf;
}

function ftyp(brand: string): Uint8Array {
  const buf = new Uint8Array(32);
  buf.set([0, 0, 0, 0x18], 0);
  buf.set([..."ftyp"].map((c) => c.charCodeAt(0)), 4);
  buf.set([...brand].map((c) => c.charCodeAt(0)), 8);
  return buf;
}

describe("documentUnlocksOffers", () => {
  it("הזמנה בכתב ובלעדיות הן הצהרה על הסכם חתום", () => {
    expect(documentUnlocksOffers("brokerage")).toBe(true);
    expect(documentUnlocksOffers("exclusivity")).toBe(true);
  });

  it("„מסמך אחר” אינו טוען דבר ואינו פותח את שער ההצעות", () => {
    expect(documentUnlocksOffers("other")).toBe(false);
  });

  /*
   * הגבול נבדק מבחוץ ולא רק מבפנים: ערך שהגיע מהרשת ואינו אחד
   * משלושת הסוגים לא ייחשב בטעות כהסכם חתום.
   */
  it("ערך שאינו סוג מוכר אינו פותח דבר", () => {
    for (const value of ["", "BROKERAGE", "signed", "agreement", "brokerage "]) {
      expect(documentUnlocksOffers(value)).toBe(false);
    }
  });

  it("לכל סוג יש תווית, ואין תווית לסוג שאינו קיים", () => {
    expect(Object.keys(DOCUMENT_KIND_LABELS).sort()).toEqual([...DOCUMENT_KINDS].sort());
  });
});

describe("sniffDocumentType", () => {
  it("מזהה סריקה וצילום לפי הבתים עצמם", () => {
    expect(sniffDocumentType(header([0x25, 0x50, 0x44, 0x46, 0x2d]))?.ext).toBe("pdf");
    expect(sniffDocumentType(header([0xff, 0xd8, 0xff]))?.ext).toBe("jpg");
    expect(
      sniffDocumentType(header([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))?.ext,
    ).toBe("png");
    expect(sniffDocumentType(ftyp("heic"))?.ext).toBe("heic");
    expect(sniffDocumentType(ftyp("mif1"))?.ext).toBe("heic");
  });

  it("‏WebP נדרש גם ל-RIFF וגם למותג — RIFF לבדו הוא WAV", () => {
    const riff = header([..."RIFF"].map((c) => c.charCodeAt(0)));
    riff.set([..."WAVE"].map((c) => c.charCodeAt(0)), 8);
    expect(sniffDocumentType(riff)).toBeNull();
    riff.set([..."WEBP"].map((c) => c.charCodeAt(0)), 8);
    expect(sniffDocumentType(riff)?.ext).toBe("webp");
  });

  /*
   * הבדיקה שמכריעה: קובץ מסוכן שהדפדפן הכריז עליו כ-PDF. הזיהוי
   * לפי בתים אינו רואה את ההכרזה בכלל, ולכן דוחה.
   */
  it("דוחה מה שאינו אחד מהם — כולל HTML ו-ZIP שמתחזים", () => {
    const html = header([..."<!DOCTYPE html>"].map((c) => c.charCodeAt(0)));
    expect(sniffDocumentType(html)).toBeNull();
    expect(sniffDocumentType(header([0x50, 0x4b, 0x03, 0x04]))).toBeNull();
    expect(sniffDocumentType(ftyp("qt  "))).toBeNull();
  });

  it("קובץ קצר מהחתימה אינו מזוהה, ולא קורס", () => {
    expect(sniffDocumentType(new Uint8Array(0))).toBeNull();
    expect(sniffDocumentType(new Uint8Array([0x25, 0x50]))).toBeNull();
    expect(sniffDocumentType(header([0xff, 0xd8], 2))).toBeNull();
  });
});

describe("formatFileSize", () => {
  it("קילובייטים עד מגה, ומגה מעליו", () => {
    expect(formatFileSize(900)).toBe("900 B");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(1_468_006)).toBe("1.4 MB");
  });

  it("ערך שאינו מספר תקין מוצג כמקף, לא כ-NaN", () => {
    expect(formatFileSize(Number.NaN)).toBe("—");
    expect(formatFileSize(-1)).toBe("—");
  });
});

describe("safeFileName", () => {
  it("שומר שם עברי קריא", () => {
    expect(safeFileName("הזמנה בכתב חתומה.pdf", "מסמך")).toBe("הזמנה בכתב חתומה.pdf");
  });

  /*
   * שני הדברים שהשם הזה יכול לעשות אם לא ינוקה: לצאת מהתיקייה,
   * ולהזריק כותרת HTTP נוספת לתגובת ההורדה.
   */
  it("מסיר מפרידי נתיב ותווי בקרה", () => {
    expect(safeFileName("../../etc/passwd", "מסמך")).toBe(".. .. etc passwd");
    expect(safeFileName("a\r\nX-Injected: 1", "מסמך")).toBe("a X-Injected: 1");
    expect(safeFileName("a\\b", "מסמך")).toBe("a b");
  });

  it("שם שכולו תווים שהוסרו נופל לברירת המחדל", () => {
    expect(safeFileName("///", "מסמך")).toBe("מסמך");
    expect(safeFileName("   ", "מסמך")).toBe("מסמך");
  });

  it("שם ארוך נחתך", () => {
    expect(safeFileName("א".repeat(400), "מסמך")).toHaveLength(120);
  });
});
