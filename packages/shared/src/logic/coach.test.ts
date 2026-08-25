import { describe, expect, it } from "vitest";
import {
  buildRecommendations,
  recommendationCapability,
  recommendationHref,
  type CoachSignals,
} from "./coach.js";
import type { Capability } from "../rbac.js";

const empty: CoachSignals = {
  hotBuyersWithoutOffer: 0,
  propertiesWithUnsentMatches: [],
  hesitatingOffers: [],
  urgentLeads: [],
  incompleteProperties: [],
  pastViewingsWithoutOutcome: [],
  staleLeads: [],
  todayAppointments: [],
  overdueTasks: [],
  pendingCoopOffers: 0,
};

const ID = "01KYJHBB71E85DWX3NDPJ5BYZY";

describe("buildRecommendations — עוזר המכירות החכם", () => {
  it("אין אותות ⇒ אין המלצות", () => {
    expect(buildRecommendations(empty)).toEqual([]);
  });

  it("ליד שממתין מעל ה-SLA עוקף אפילו ליד שסומן דחוף", () => {
    // ליד מתקרר בשעות; כל שאר ההמלצות יכולות להמתין
    const recs = buildRecommendations({
      ...empty,
      urgentLeads: [{ leadId: ID, contactName: "יעקב כהן" }],
      staleLeads: [{ leadId: ID, contactName: "משה לוי", hoursWaiting: 5 }],
    });
    expect(recs[0]?.type).toBe("stale_lead");
    expect(recs[0]?.title).toContain("מעל 5 שעות");
  });

  it("זמן ההמתנה מנוסח כזמן ולא כמספר גולמי", () => {
    const wait = (hoursWaiting: number): string =>
      buildRecommendations({ ...empty, staleLeads: [{ leadId: ID, contactName: "לקוח", hoursWaiting }] })[0]!
        .title;
    expect(wait(0.5)).toContain("פחות משעה");
    expect(wait(30)).toContain("מאתמול");
    expect(wait(80)).toContain("3 ימים");
  });

  it("פגישות היום והצעות שת\"פ ממתינות מופיעות בראש הרשימה", () => {
    const recs = buildRecommendations({
      ...empty,
      todayAppointments: [
        { appointmentId: ID, title: "סיור בדירה", startsAt: new Date("2026-08-13T14:30:00") },
      ],
      pendingCoopOffers: 2,
      incompleteProperties: [{ propertyId: ID, title: "דירה", missingCount: 2 }],
    });
    expect(recs[0]?.type).toBe("today_appointment");
    expect(recs[1]?.type).toBe("pending_coop_offers");
    expect(recs[1]?.title).toContain("2 הצעות");
  });

  it("משימה באיחור אומרת בכמה", () => {
    const recs = buildRecommendations({
      ...empty,
      overdueTasks: [{ taskId: ID, title: "להתקשר למוכר", daysLate: 1 }],
    });
    expect(recs[0]?.title).toContain("באיחור של יום");
  });

  it("ליד דחוף מקבל את העדיפות הגבוהה ביותר", () => {
    const recs = buildRecommendations({
      ...empty,
      urgentLeads: [{ leadId: ID, contactName: "יעקב כהן" }],
      incompleteProperties: [{ propertyId: ID, title: "דירה", missingCount: 2 }],
    });
    expect(recs[0]?.type).toBe("urgent_lead");
    expect(recs[0]?.title).toContain("יעקב כהן");
  });

  it("קונה מתלבט (פתח 3 פעמים) — ההמלצה מהאפיון §14", () => {
    const recs = buildRecommendations({
      ...empty,
      hesitatingOffers: [{ offerId: ID, propertyTitle: "דירת 4 חדרים", openCount: 3 }],
    });
    expect(recs[0]?.type).toBe("hesitating_buyer");
    expect(recs[0]?.title).toContain("3 פעמים");
  });

  it("בוחר את הנכס עם הכי הרבה קונים ממתינים", () => {
    const recs = buildRecommendations({
      ...empty,
      propertiesWithUnsentMatches: [
        { propertyId: "a", title: "נכס א", matchCount: 5 },
        { propertyId: ID, title: "נכס ב", matchCount: 23 },
      ],
    });
    const match = recs.find((r) => r.type === "unsent_matches");
    expect(match?.title).toContain("23");
    expect(match?.entityId).toBe(ID);
  });

  it("ההמלצות ממוינות לפי עדיפות יורדת", () => {
    const recs = buildRecommendations({
      ...empty,
      urgentLeads: [{ leadId: ID, contactName: "א" }],
      hotBuyersWithoutOffer: 3,
      incompleteProperties: [{ propertyId: ID, title: "נכס", missingCount: 1 }],
    });
    const priorities = recs.map((r) => r.priority);
    expect(priorities).toEqual([...priorities].sort((a, b) => b - a));
  });
});

/*
 * ‎**כל אות דולק בבת אחת** — כדי שכל סוג המלצה שהפונקציה מסוגלת
 * לייצר ייוצג בפועל. זה מה שהופך את הבדיקה מטה לספירה ולא לדגימה:
 * סוג חדש שייכתב ב-`buildRecommendations` ייכנס לרשימה מעצמו, וייפול
 * אם לא נתנו לו יעד.
 */
const allSignals: CoachSignals = {
  hotBuyersWithoutOffer: 4,
  propertiesWithUnsentMatches: [{ propertyId: ID, title: "נכס", matchCount: 7 }],
  hesitatingOffers: [{ offerId: ID, propertyTitle: "נכס", openCount: 3 }],
  urgentLeads: [{ leadId: ID, contactName: "א" }],
  incompleteProperties: [{ propertyId: ID, title: "נכס", missingCount: 2 }],
  pastViewingsWithoutOutcome: [{ appointmentId: ID, title: "סיור" }],
  staleLeads: [{ leadId: ID, contactName: "ב", hoursWaiting: 5 }],
  todayAppointments: [{ appointmentId: ID, title: "פגישה", startsAt: new Date() }],
  overdueTasks: [{ taskId: ID, title: "משימה", daysLate: 2 }],
  pendingCoopOffers: 5,
};

describe("recommendationHref — לכל המלצה יש לאן ללחוץ", () => {
  /*
   * הבדיקה המרכזית. השורה הראשונה בדשבורד מקבלת את הכפתור הראשי,
   * ולכן המלצה בלי יעד היא הכרזה „זה הדבר לעשות עכשיו” שאי אפשר
   * לפעול לפיה. ארבעה סוגים נשברו כך — שלושה מצרפים בלי `entityId`
   * ו-`hesitating_buyer` שנושא `entityType: "offer"`.
   */
  it("כל סוג שהסוכן מסוגל לייצר מקבל יעד", () => {
    const recs = buildRecommendations(allSignals);
    const without = recs.filter((r) => recommendationHref(r) === null).map((r) => r.type);
    expect(without).toEqual([]);
  });

  it("עשרת הסוגים אכן נבדקו — אחרת הבדיקה שמעל ריקה", () => {
    const types = new Set(buildRecommendations(allSignals).map((r) => r.type));
    expect(types).toEqual(
      new Set([
        "stale_lead",
        "today_appointment",
        "urgent_lead",
        "pending_coop_offers",
        "hesitating_buyer",
        "overdue_task",
        "unsent_matches",
        "hot_buyers_idle",
        "viewing_followup",
        "incomplete_property",
      ]),
    );
  });

  it("המלצה מצרפת מגיעה ליעד המרוכז ולא לכרטיס", () => {
    const recs = buildRecommendations(allSignals);
    const href = (type: string): string | null =>
      recommendationHref(recs.find((r) => r.type === type)!);
    expect(href("pending_coop_offers")).toBe("/collaboration");
    expect(href("overdue_task")).toBe("/tasks");
    expect(href("hot_buyers_idle")).toBe("/buyers");
    // נושא `entityId` אך אין מסך להצעה בודדת
    expect(href("hesitating_buyer")).toBe("/offers");
  });

  it("המלצה על ישות מגיעה לכרטיס שלה", () => {
    const recs = buildRecommendations(allSignals);
    const href = (type: string): string | null =>
      recommendationHref(recs.find((r) => r.type === type)!);
    expect(href("stale_lead")).toBe(`/leads/${ID}`);
    expect(href("unsent_matches")).toBe(`/properties/${ID}`);
    expect(href("today_appointment")).toBe("/calendar");
  });

  it("סוג שאינו מוכר ואין לו ישות — אין יעד, ולא ניחוש", () => {
    expect(recommendationHref({ priority: 1, type: "מומצא", title: "", body: "" })).toBeNull();
  });
});

/*
 * ‎**היכולת נמדדת לפי הפעולה, לא לפי המסך.**
 *
 * ‎`/coach/recommendations` יושב מאחורי `matches.view`, והיעדים
 * שאליהם הוא מפנה דורשים יכולות אחרות. הגרסה הראשונה של המפה
 * נגזרה מקידומת ה-href, כלומר ענתה „האם מותר לו לראות את המסך” —
 * שאלה אחרת מ„האם מותר לו לעשות את מה שביקשנו”. שתיהן מתלכדות רק
 * כשההמלצה היא לקרוא; ברגע שהיא מבקשת לשלוח או לערוך, הן נפרדות,
 * והסוכן מקבל הזמנה לפעולה שתחזיר לו 403.
 */
describe("recommendationCapability — היכולת שהפעולה דורשת", () => {
  it("כל סוג שהסוכן מייצר נושא יכולת — אין המלצה בלי דרישה", () => {
    const recs = buildRecommendations(allSignals);
    const without = recs.filter((r) => recommendationCapability(r) === null).map((r) => r.type);
    expect(without).toEqual([]);
  });

  it("„לשלוח הצעות” דורש offers.send ולא properties.view", () => {
    const recs = buildRecommendations(allSignals);
    const cap = (type: string): Capability | null =>
      recommendationCapability(recs.find((r) => r.type === type)!);
    /* שתי ההמלצות שמבקשות לשלוח — אחת מכרטיס הנכס, אחת מההצעה */
    expect(cap("unsent_matches")).toBe("offers.send");
    expect(cap("hesitating_buyer")).toBe("offers.send");
  });

  it("„להשלים פרטים” היא עריכה, לא צפייה", () => {
    const recs = buildRecommendations(allSignals);
    expect(recommendationCapability(recs.find((r) => r.type === "incomplete_property")!)).toBe(
      "properties.edit",
    );
  });

  it("המלצות קריאה נשארות ביכולת הקריאה", () => {
    const recs = buildRecommendations(allSignals);
    const cap = (type: string): Capability | null =>
      recommendationCapability(recs.find((r) => r.type === type)!);
    expect(cap("stale_lead")).toBe("leads.view_own");
    expect(cap("urgent_lead")).toBe("leads.view_own");
    expect(cap("hot_buyers_idle")).toBe("buyers.view_own");
    expect(cap("pending_coop_offers")).toBe("collaboration.offer");
    expect(cap("today_appointment")).toBe("calendar.manage");
    expect(cap("overdue_task")).toBe("calendar.manage");
    expect(cap("viewing_followup")).toBe("calendar.manage");
  });

  it("סוג שאינו מוכר — אין דרישה מומצאת", () => {
    expect(recommendationCapability({ priority: 1, type: "מומצא", title: "", body: "" })).toBeNull();
  });
});
