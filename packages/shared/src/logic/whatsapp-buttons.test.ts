import { describe, expect, it } from "vitest";
import {
  buttonTitle,
  decodeButtonId,
  encodeButtonId,
  fitsInteractive,
  listPayload,
  replyButtonsPayload,
  WA_INTERACTIVE_BODY_MAX,
} from "./whatsapp-buttons.js";

describe("encodeButtonId / decodeButtonId", () => {
  it("מקודד ומפענח פעולה בלי ארגומנט", () => {
    expect(decodeButtonId(encodeButtonId("confirm"))).toEqual({ action: "confirm" });
  });

  it("מקודד ומפענח פעולה עם ארגומנט", () => {
    expect(decodeButtonId(encodeButtonId("pick", "3"))).toEqual({ action: "pick", arg: "3" });
  });

  it("דוחה מזהה שאינו שלנו — לחיצה זרה אינה פקודה", () => {
    expect(decodeButtonId("other:confirm")).toBeNull();
    expect(decodeButtonId("confirm")).toBeNull();
  });

  it("דוחה פעולה שאיננו מכירים", () => {
    expect(decodeButtonId("mv:delete_everything")).toBeNull();
  });

  it("שומר ארגומנט שמכיל נקודתיים", () => {
    expect(decodeButtonId("mv:cmd:show:today")).toEqual({ action: "cmd", arg: "show:today" });
  });
});

describe("buttonTitle", () => {
  it("משאיר כותרת קצרה כמו שהיא", () => {
    expect(buttonTitle("✅ אשר")).toBe("✅ אשר");
  });

  it("חותך כותרת ארוכה מהתקרה של Meta", () => {
    const title = buttonTitle("כותרת ארוכה מאוד שלא נכנסת בעשרים תווים");
    expect(title.length).toBeLessThanOrEqual(20);
    expect(title.endsWith("…")).toBe(true);
  });

  it("מכווץ רווחים ושורות — כותרת היא שורה אחת", () => {
    expect(buttonTitle(" אשר \n עכשיו ")).toBe("אשר עכשיו");
  });
});

describe("fitsInteractive", () => {
  it("גוף סביר נכנס", () => {
    expect(fitsInteractive("שאלה קצרה")).toBe(true);
  });

  it("גוף ארוך מ-1024 אינו נכנס — יורד לטקסט רגיל", () => {
    expect(fitsInteractive("א".repeat(WA_INTERACTIVE_BODY_MAX + 1))).toBe(false);
  });

  it("גוף ריק אינו הודעה", () => {
    expect(fitsInteractive("   ")).toBe(false);
  });
});

describe("replyButtonsPayload", () => {
  it("בונה מטען תקין עם מזהים שאפשר לפענח", () => {
    const payload = replyButtonsPayload("972501234567", "לבצע?", [
      { action: "confirm", title: "✅ אשר" },
      { action: "cancel", title: "❌ בטל" },
    ]) as {
      interactive: { action: { buttons: { reply: { id: string; title: string } }[] } };
    };
    const buttons = payload.interactive.action.buttons;
    expect(buttons).toHaveLength(2);
    expect(decodeButtonId(buttons[0]!.reply.id)).toEqual({ action: "confirm" });
    expect(buttons[1]!.reply.title).toBe("❌ בטל");
  });

  it("לא יותר משלושה כפתורים — Meta דוחה מעבר לזה", () => {
    const payload = replyButtonsPayload("972", "גוף", [
      { action: "pick", arg: "1", title: "א" },
      { action: "pick", arg: "2", title: "ב" },
      { action: "pick", arg: "3", title: "ג" },
      { action: "pick", arg: "4", title: "ד" },
    ]) as { interactive: { action: { buttons: unknown[] } } };
    expect(payload.interactive.action.buttons).toHaveLength(3);
  });
});

describe("listPayload", () => {
  it("בונה שורות עם תיאור מבחין", () => {
    const payload = listPayload("972", "מי מהם?", "בחירה", [
      { action: "pick", arg: "1", title: "משה כהן", description: "גבעתיים · 4 חדרים" },
      { action: "pick", arg: "2", title: "משה כהן", description: "רמת גן · 3 חדרים" },
    ]) as {
      interactive: {
        action: { button: string; sections: { rows: { id: string; description?: string }[] }[] };
      };
    };
    const rows = payload.interactive.action.sections[0]!.rows;
    expect(rows).toHaveLength(2);
    expect(rows[1]!.description).toBe("רמת גן · 3 חדרים");
    expect(decodeButtonId(rows[1]!.id)).toEqual({ action: "pick", arg: "2" });
  });

  it("לא יותר מעשר שורות", () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      action: "pick" as const,
      arg: String(i + 1),
      title: `אפשרות ${i + 1}`,
    }));
    const payload = listPayload("972", "גוף", "בחירה", many) as {
      interactive: { action: { sections: { rows: unknown[] }[] } };
    };
    expect(payload.interactive.action.sections[0]!.rows).toHaveLength(10);
  });
});
