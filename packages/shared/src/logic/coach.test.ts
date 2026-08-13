import { describe, expect, it } from "vitest";
import { buildRecommendations, type CoachSignals } from "./coach.js";

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
