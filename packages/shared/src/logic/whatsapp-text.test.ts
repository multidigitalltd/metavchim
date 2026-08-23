import { describe, expect, it } from "vitest";
import { splitForWhatsApp } from "./whatsapp-text.js";

describe("splitForWhatsApp", () => {
  it("מחזיר הודעה אחת כשהתשובה נכנסת בתקרה", () => {
    expect(splitForWhatsApp("שלום")).toEqual(["שלום"]);
  });

  it("מחזיר מערך ריק על טקסט ריק — אין מה לשלוח", () => {
    expect(splitForWhatsApp("   \n  ")).toEqual([]);
  });

  it("מפצל על גבול שורה ולא באמצע", () => {
    const line = `${"א".repeat(90)}`;
    const text = Array.from({ length: 5 }, () => line).join("\n");
    const chunks = splitForWhatsApp(text, 200);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(200);
      // כל שורה שנשלחה היא שורה שלמה מהמקור
      for (const part of chunk.split("\n")) expect(part).toBe(line);
    }
  });

  it("שומר על כל התוכן כשהוא נכנס בתקרת ההודעות", () => {
    const text = Array.from({ length: 6 }, (_, i) => `שורה ${i}`).join("\n");
    expect(splitForWhatsApp(text, 20).join("\n")).toBe(text);
  });

  it("חותך שורה בודדת ארוכה מהתקרה, על גבול מילה", () => {
    const text = `${"מילה ".repeat(60)}`.trim();
    const chunks = splitForWhatsApp(text, 100);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(100);
    expect(chunks.join(" ").replace(/\s+/gu, " ")).toBe(text);
  });

  it("חותך מילה בודדת שאין בה רווח בכלל", () => {
    const chunks = splitForWhatsApp("א".repeat(250), 100);
    expect(chunks).toHaveLength(3);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(100);
  });

  it("אומר במפורש כשהתשובה נקטעה — לא חותך בשקט", () => {
    const text = Array.from({ length: 200 }, (_, i) => `שורה ${i}`).join("\n");
    const chunks = splitForWhatsApp(text, 120, 2);
    expect(chunks).toHaveLength(2);
    expect(chunks[1]).toContain("ההמשך המלא במסך המערכת");
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(120);
  });

  it("אינו חורג מהתקרה גם כשהתקרה קטנה מסימון הקיטוע", () => {
    const text = Array.from({ length: 40 }, (_, i) => `שורה ${i}`).join("\n");
    for (const chunk of splitForWhatsApp(text, 20, 2)) {
      expect(chunk.length).toBeLessThanOrEqual(20);
    }
  });
});
