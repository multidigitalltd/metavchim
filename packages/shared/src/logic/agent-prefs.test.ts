import { describe, expect, it } from "vitest";
import { parseAgentPrefs } from "./agent-prefs.js";

describe("העדפות הסוכן — פירוק סלחני", () => {
  it("ערך שמור חוזר", () => {
    expect(parseAgentPrefs({ agent: { propertiesOrder: "price_asc" } })).toEqual({
      propertiesOrder: "price_asc",
    });
  });

  it("צורה לא מוכרת = ברירות מחדל, לא קריסה", () => {
    expect(parseAgentPrefs(null)).toEqual({});
    expect(parseAgentPrefs({ agent: "garbage" })).toEqual({});
    // ערך שאינו ברשימה הסגורה אינו הופך להעדפה — עמודת JSON חופשית
    expect(parseAgentPrefs({ agent: { propertiesOrder: "by_vibes" } })).toEqual({});
  });

  it("העדפות של מסכים אחרים באותה עמודה אינן מפריעות", () => {
    expect(
      parseAgentPrefs({ dismissedPanels: ["x"], agent: { propertiesOrder: "newest" } }),
    ).toEqual({ propertiesOrder: "newest" });
  });
});
