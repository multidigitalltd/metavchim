import { describe, expect, it } from "vitest";
import { routeVoiceCommand, stripCommandPrefix } from "./voice-command.js";

describe("routeVoiceCommand", () => {
  it("מזהה הוספת נכס בניסוח מפורש", () => {
    expect(routeVoiceCommand("תוסיף נכס דירת 3 חדרים בבני ברק").action).toBe("add_property");
  });

  it("מזהה הוספת קונה", () => {
    expect(routeVoiceCommand("רשום קונה חדש משה כהן").action).toBe("add_buyer");
  });

  it("מזהה ליד לפי ניסוח טבעי", () => {
    const command = routeVoiceCommand("דיברתי עם יוסי, מתעניין בדירה");
    expect(command.action).toBe("add_lead");
    expect(command.confidence).toBe("low");
  });

  it("מזהה קביעת פגישה", () => {
    const command = routeVoiceCommand("קבע פגישה מחר בעשר עם משה");
    expect(command.action).toBe("schedule_appointment");
    expect(command.confidence).toBe("high");
  });

  it("מזהה חיפוש ומחזיר את מה שצריך לחפש", () => {
    const command = routeVoiceCommand("חפש את משה כהן");
    expect(command.action).toBe("search");
    expect(command.query).toBe("את משה כהן");
  });

  it("כלל מפורש גובר על ניחוש לפי הקשר", () => {
    // "מחפש דירה" הוא רמז לקונה, אבל "תוסיף נכס" מפורש
    expect(routeVoiceCommand("תוסיף נכס ללקוח שמחפש דירה").action).toBe("add_property");
  });

  it("טקסט שאינו פקודה מסווג כלא ידוע", () => {
    expect(routeVoiceCommand("בוקר טוב").action).toBe("unknown");
  });

  it("מסיר מילות פקודה לפני החילוץ", () => {
    expect(stripCommandPrefix("תוסיף קונה משה כהן 050-1234567")).toBe("משה כהן 050-1234567");
    expect(stripCommandPrefix("קבע פגישה מחר בעשר")).toBe("מחר בעשר");
  });
});
