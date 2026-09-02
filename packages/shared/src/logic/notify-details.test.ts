import { describe, expect, it } from "vitest";
import {
  appointmentKindLabel,
  canSeeNotifyDetail,
  notifyDetailLines,
  shekelLabel,
  type NotifyDetail,
} from "./notify-details.js";

const AGENT = { userId: "agent1", capabilities: ["buyers.view_own", "leads.view_own"] };
const MANAGER = {
  userId: "boss",
  capabilities: ["buyers.view_all", "leads.view_all", "tasks.view_all", "properties.view"],
};

describe("canSeeNotifyDetail — הרשאה, ולא רק ניסוח", () => {
  const buyerOfSomeoneElse: NotifyDetail = {
    kind: "buyer",
    ownerUserId: "agent2",
    person: { name: "דנה לוי", phone: "050-1111111" },
    budget: null,
    cities: [],
    rooms: null,
  };

  it("קונה של עמית אינו מגיע בהתראה משרדית", () => {
    expect(canSeeNotifyDetail(buyerOfSomeoneElse, AGENT)).toBe(false);
  });

  it("אותו קונה מגיע למי שרואה את כל המשרד", () => {
    expect(canSeeNotifyDetail(buyerOfSomeoneElse, MANAGER)).toBe(true);
  });

  it("הקונה שלי מגיע אליי גם בלי view_all", () => {
    expect(canSeeNotifyDetail({ ...buyerOfSomeoneElse, ownerUserId: "agent1" }, AGENT)).toBe(true);
  });

  it("כרטיס בלי בעלים הוא משרדי ומגיע לכולם", () => {
    expect(canSeeNotifyDetail({ ...buyerOfSomeoneElse, ownerUserId: null }, AGENT)).toBe(true);
  });

  it("הצעה נשענת על הרשאת הקונה, לא על הרשאה משלה", () => {
    const offer: NotifyDetail = {
      kind: "offer",
      ownerUserId: "agent2",
      person: { name: "דנה לוי", phone: "050-1111111" },
      property: null,
      price: null,
      openCount: 1,
      why: null,
    };
    expect(canSeeNotifyDetail(offer, AGENT)).toBe(false);
    expect(canSeeNotifyDetail(offer, MANAGER)).toBe(true);
  });

  it("נכס דורש properties.view — ולסוכן בלעדיה אין פרטים", () => {
    const property: NotifyDetail = {
      kind: "property",
      ownerUserId: null,
      headline: "4 חדרים · הרצל 12, רמת גן",
      price: null,
      people: [],
      why: null,
    };
    expect(canSeeNotifyDetail(property, AGENT)).toBe(false);
    expect(canSeeNotifyDetail(property, MANAGER)).toBe(true);
  });

  it("איש קשר עירום — רק למי שרואה את המשרד כולו", () => {
    const contact: NotifyDetail = {
      kind: "contact",
      ownerUserId: null,
      person: { name: "יוסי", phone: "050-2222222" },
    };
    expect(canSeeNotifyDetail(contact, AGENT)).toBe(false);
    expect(canSeeNotifyDetail(contact, MANAGER)).toBe(true);
  });

  it("משימה שהוטלה עליי גלויה לי, של אחר לא", () => {
    const mine: NotifyDetail = {
      kind: "task",
      ownerUserId: "agent1",
      title: "להתקשר לדני",
      dueAt: null,
      about: null,
    };
    expect(canSeeNotifyDetail(mine, AGENT)).toBe(true);
    expect(canSeeNotifyDetail({ ...mine, ownerUserId: "agent2" }, AGENT)).toBe(false);
  });
});

describe("notifyDetailLines — מה שהסוכן צריך כדי לפעול", () => {
  it("ליד: שם, טלפון, נכס ומקור", () => {
    const lines = notifyDetailLines({
      kind: "lead",
      ownerUserId: "agent1",
      person: { name: "דני כהן", phone: "050-1234567" },
      source: "whatsapp",
      summary: "מחפש 4 חדרים ברמת גן",
      property: "4 חדרים · הרצל 12, רמת גן",
    });
    expect(lines[0]).toBe("👤 דני כהן · 050-1234567");
    expect(lines).toContain("🏠 4 חדרים · הרצל 12, רמת גן");
    expect(lines).toContain("📥 מקור: וואטסאפ");
    expect(lines.some((line) => line.includes("מחפש 4 חדרים"))).toBe(true);
  });

  it("מקור שאינו בקטלוג מוצג כמות שהוא ולא נעלם", () => {
    const lines = notifyDetailLines({
      kind: "lead",
      ownerUserId: null,
      person: null,
      source: "yad2",
      summary: null,
      property: null,
    });
    expect(lines).toContain("📥 מקור: yad2");
  });

  it("כרטיס בלי טלפון אינו מייצר נקודה ריקה", () => {
    const lines = notifyDetailLines({
      kind: "lead",
      ownerUserId: null,
      person: { name: "דני כהן", phone: null },
      source: null,
      summary: null,
      property: null,
    });
    expect(lines).toEqual(["👤 דני כהן"]);
  });

  it("הצעה: הקונה, הנכס והמחיר — ומספר פתיחות רק כשהוא סיפור", () => {
    const once = notifyDetailLines({
      kind: "offer",
      ownerUserId: "agent1",
      person: { name: "דנה לוי", phone: "050-1111111" },
      property: "4 חדרים · הרצל 12, רמת גן",
      price: "2,100,000 ₪",
      openCount: 1,
      why: null,
    });
    expect(once.some((line) => line.includes("פתח"))).toBe(false);

    const thrice = notifyDetailLines({
      kind: "offer",
      ownerUserId: "agent1",
      person: { name: "דנה לוי", phone: "050-1111111" },
      property: null,
      price: null,
      openCount: 3,
      why: null,
    });
    expect(thrice).toContain("🔁 פתח 3 פעמים");
  });

  it("נכס עם התאמות: הכתובת, המחיר, הקונים והנימוק", () => {
    const lines = notifyDetailLines({
      kind: "property",
      ownerUserId: null,
      headline: "4 חדרים · הרצל 12, רמת גן",
      price: "2,100,000 ₪",
      people: [
        { name: "דנה לוי", phone: "050-1111111" },
        { name: "רון בר", phone: null },
      ],
      why: "תקציב, אזור ומספר חדרים תואמים",
    });
    expect(lines).toContain("👤 דנה לוי · 050-1111111");
    expect(lines).toContain("👤 רון בר");
    expect(lines).toContain("✨ תקציב, אזור ומספר חדרים תואמים");
  });

  it("נימוק ארוך נקטע — השם והטלפון לעולם לא", () => {
    const lines = notifyDetailLines({
      kind: "property",
      ownerUserId: null,
      headline: "דירה",
      price: null,
      people: [{ name: "דנה לוי", phone: "050-1111111" }],
      why: "א".repeat(400),
    });
    expect(lines).toContain("👤 דנה לוי · 050-1111111");
    const why = lines.find((line) => line.startsWith("✨"));
    expect(why?.length).toBeLessThan(130);
    expect(why?.endsWith("…")).toBe(true);
  });

  it("קונה: הדרישות והתקציב בשורה שאפשר לסרוק", () => {
    const lines = notifyDetailLines({
      kind: "buyer",
      ownerUserId: "agent1",
      person: { name: "דנה לוי", phone: "050-1111111" },
      budget: "עד 2,100,000 ₪",
      cities: ["רמת גן", "גבעתיים"],
      rooms: "3–4 חדרים",
    });
    expect(lines).toContain("🔎 3–4 חדרים · רמת גן, גבעתיים");
    expect(lines).toContain("💰 עד 2,100,000 ₪");
  });

  it("פריט בלי מה לומר מחזיר רשימה ריקה ולא „לא ידוע”", () => {
    expect(
      notifyDetailLines({
        kind: "buyer",
        ownerUserId: null,
        person: null,
        budget: null,
        cities: [],
        rooms: null,
      }),
    ).toEqual([]);
  });
});

describe("תוויות", () => {
  it("שקלים מנוקדים, לא אגורות", () => {
    expect(shekelLabel(210_000_000)).toBe("2,100,000 ₪");
  });

  it("סוג פגישה לא מוכר נופל ל„פגישה” ולא למזהה גולמי", () => {
    expect(appointmentKindLabel("viewing")).toBe("סיור");
    expect(appointmentKindLabel("whatever")).toBe("פגישה");
  });
});
