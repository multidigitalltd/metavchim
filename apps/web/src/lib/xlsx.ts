import { xlsxToCsv as sharedXlsxToCsv } from "@metavchim/shared";

/**
 * ‎xlsx ⟵ CSV‎ בדפדפן.
 *
 * כל הלוגיקה (ZIP, מחרוזות משותפות, יישור תאים חסרים) יושבת ב-shared
 * ומכוסה בבדיקות; כאן רק היכולת שתלויה בדפדפן — פריסת deflate דרך
 * ‎DecompressionStream‎ המובנה. בלי ספרייה חיצונית: התלות המקובלת
 * (SheetJS) היא ענק עם היסטוריית אבטחה בעייתית, והדפדפן כבר יודע
 * לפרוס בעצמו.
 */
export async function xlsxFileToCsv(buf: ArrayBuffer): Promise<string> {
  return sharedXlsxToCsv(new Uint8Array(buf), async (data) => {
    const stream = new Blob([data.slice()])
      .stream()
      .pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  });
}
