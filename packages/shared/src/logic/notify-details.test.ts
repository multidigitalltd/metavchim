import { describe, expect, it } from "vitest";
import {
  appointmentKindLabel,
  canSeeNotifyDetail,
  notifyDetailLines,
  shekelLabel,
  type NotifyDetail,
} from "./notify-details.js";

const AGENT = { userId: "agent1", capabilities: ["buyers.view_own", "leads.view_own"] };
/** סוכן שהגישה שלו נשללה במפורש — `UserCapability` עם effect: deny. */
const REVOKED = { userId: "agent1", capabilities: [] as string[] };
const MANAGER = {
  userId: "boss",
  capabilities: ["buyers.view_all", "leads.view_all", "tasks.view_all", "properties.view"],
};

/** רוב הבדיקות כאן על הניסוח, לא על ההרשאה — הן רואות הכול. */
const linesFor = (detail: NotifyDetail): string[] => notifyDetailLines(detail, MANAGER);

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

  /*
   * ‎`ownershipFilter` משווה מזהה, ו-NULL אינו שווה לאיש: קונה בלי
   * בעלים אינו „של כולם” אלא בלתי נראה. אותו כלל של המסך.
   */
  it("קונה בלי בעלים אינו „של כולם” אלא בלתי נראה", () => {
    expect(canSeeNotifyDetail({ ...buyerOfSomeoneElse, ownerUserId: null }, AGENT)).toBe(false);
    expect(canSeeNotifyDetail({ ...buyerOfSomeoneElse, ownerUserId: null }, MANAGER)).toBe(true);
  });

  /*
   * ‎**ליד הוא ההפך מקונה כאן**, ובכוונה: ליד בלי סוכן משויך הוא
   * הערימה המשותפת, וכל מי שיש לו `leads.view_own` רואה אותו.
   */
  it("ליד בלי סוכן משויך הוא הערימה המשותפת", () => {
    const pooled: NotifyDetail = {
      kind: "lead",
      ownerUserId: null,
      person: { name: "דני כהן", phone: "050-1234567" },
      source: null,
      summary: null,
      property: null,
    };
    expect(canSeeNotifyDetail(pooled, AGENT)).toBe(true);
  });

  /*
   * ‎`view_own` ניתנת לשלילה פר-משתמש, והזכאות לוואטסאפ אינה
   * תלויה בה. בלי הבדיקה הזו סוכן שהגישה שלו נשללה היה ממשיך
   * לקבל שמות וטלפונים בהודעה בזמן שהמסך אומר לו „אין הרשאה”.
   */
  it("בעלות בלי ההרשאה עצמה אינה מספיקה", () => {
    expect(canSeeNotifyDetail({ ...buyerOfSomeoneElse, ownerUserId: "agent1" }, REVOKED)).toBe(
      false,
    );
    const myLead: NotifyDetail = {
      kind: "lead",
      ownerUserId: "agent1",
      person: { name: "דני", phone: null },
      source: null,
      summary: null,
      property: null,
    };
    expect(canSeeNotifyDetail(myLead, AGENT)).toBe(true);
    expect(canSeeNotifyDetail(myLead, REVOKED)).toBe(false);
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
    const lines = linesFor({
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
    const lines = linesFor({
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
    const lines = linesFor({
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
    const once = linesFor({
      kind: "offer",
      ownerUserId: "agent1",
      person: { name: "דנה לוי", phone: "050-1111111" },
      property: "4 חדרים · הרצל 12, רמת גן",
      price: "2,100,000 ₪",
      openCount: 1,
      why: null,
    });
    expect(once.some((line) => line.includes("פתח"))).toBe(false);

    const thrice = linesFor({
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

  const propertyWithMatches: NotifyDetail = {
    kind: "property",
    ownerUserId: null,
    headline: "4 חדרים · הרצל 12, רמת גן",
    price: "2,100,000 ₪",
    people: [
      { person: { name: "דנה לוי", phone: "050-1111111" }, ownerUserId: "agent1" },
      { person: { name: "רון בר", phone: null }, ownerUserId: "agent2" },
    ],
    why: "תקציב, אזור ומספר חדרים תואמים",
  };

  it("נכס עם התאמות: הכתובת, המחיר, הקונים והנימוק", () => {
    const lines = notifyDetailLines(propertyWithMatches, MANAGER);
    expect(lines).toContain("👤 דנה לוי · 050-1111111");
    expect(lines).toContain("👤 רון בר");
    expect(lines).toContain("✨ תקציב, אזור ומספר חדרים תואמים");
  });

  /*
   * ‎**`properties.view` מתיר את הנכס, לא את הקונים שלו.**
   *
   * ‏המסך מסנן את ההתאמות ב-`ownershipFilter("buyers.view_all",
   * "ownerUserId")` לפני שהוא מציג שם. התראה משרדית על התאמה
   * הייתה הערוץ שבו סוכן מקבל את הטלפון של הקונה של עמיתו.
   */
  it("הנכס אינו מכשיר את הקונים שלו — כל אחד נבדק בנפרד", () => {
    const lines = notifyDetailLines(propertyWithMatches, {
      userId: "agent1",
      capabilities: ["properties.view", "buyers.view_own"],
    });
    expect(lines).toContain("🏠 4 חדרים · הרצל 12, רמת גן");
    expect(lines).toContain("👤 דנה לוי · 050-1111111");
    expect(lines, "הקונה של עמית").not.toContain("👤 רון בר");
  });

  it("נימוק ארוך נקטע — השם והטלפון לעולם לא", () => {
    const lines = notifyDetailLines(
      {
        kind: "property",
        ownerUserId: null,
        headline: "דירה",
        price: null,
        people: [{ person: { name: "דנה לוי", phone: "050-1111111" }, ownerUserId: null }],
        why: "א".repeat(400),
      },
      MANAGER,
    );
    expect(lines).toContain("👤 דנה לוי · 050-1111111");
    const why = lines.find((line) => line.startsWith("✨"));
    expect(why?.length).toBeLessThan(130);
    expect(why?.endsWith("…")).toBe(true);
  });

  it("קונה: הדרישות והתקציב בשורה שאפשר לסרוק", () => {
    const lines = linesFor({
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
      linesFor({
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
