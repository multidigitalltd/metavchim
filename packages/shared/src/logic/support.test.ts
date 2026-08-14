import { describe, expect, it } from "vitest";
import {
  redactUrl,
  sanitizeSupportContext,
  supportAreaFromPath,
  triageTicket,
  trimEvidence,
} from "./support.js";

describe("redactUrl", () => {
  it("מסתיר את מה שחיפשו — שם לקוח בכתובת אינו נשמר בפנייה", () => {
    expect(redactUrl("/search?q=משה לוי")).toBe("/search?q=…");
  });

  it("שומר את הנתיב — בלעדיו אין מה לחקור", () => {
    expect(redactUrl("/properties/01KZZ")).toBe("/properties/01KZZ");
  });

  it("פרמטרים תפעוליים נשמרים כמו שהם", () => {
    expect(redactUrl("/settings?tab=billing")).toBe("/settings?tab=billing");
  });

  it("פרמטר שלא ברשימת ההיתר מוסתר גם כשהוא נראה תמים", () => {
    expect(redactUrl("/buyers?phone=0501234567&tab=all")).toBe("/buyers?phone=…&tab=all");
  });
});

describe("supportAreaFromPath", () => {
  it("כרטיס נכס שייך לנכסים", () => {
    expect(supportAreaFromPath("/properties/01KZZ")).toBe("נכסים");
  });

  it("מסך המנוי מופרד מניהול המשרד — הוא יעד טיפול אחר", () => {
    expect(supportAreaFromPath("/settings/billing")).toBe("מנוי ותשלום");
    expect(supportAreaFromPath("/settings")).toBe("ניהול המשרד");
  });

  it("שורש = דשבורד, ולא 'כללי'", () => {
    expect(supportAreaFromPath("/")).toBe("דשבורד");
    expect(supportAreaFromPath(undefined)).toBe("דשבורד");
  });
});

describe("triageTicket", () => {
  it("שגיאת שרת בזמן הפנייה הופכת תקלה לחוסמת", () => {
    const t = triageTicket("bug", {
      path: "/properties",
      failedRequests: ["500 GET /properties"],
    });
    expect(t.severity).toBe("blocking");
    expect(t.hints.some((h) => h.includes("שגיאת שרת"))).toBe(true);
  });

  it("תקלה בלי ראיות נשארת תקלה רגילה ולא חוסמת", () => {
    expect(triageTicket("bug", { path: "/buyers" }).severity).toBe("error");
  });

  it("הצעה לשיפור לעולם אינה חוסמת — גם כשנכשלה בקשה ברקע", () => {
    const t = triageTicket("idea", { path: "/", failedRequests: ["500 GET /coach"] });
    expect(t.severity).toBe("normal");
  });

  it("403 מזוהה כהרשאה ולא כקריסה", () => {
    const t = triageTicket("bug", { path: "/reports", failedRequests: ["403 GET /analytics"] });
    expect(t.severity).toBe("error");
    expect(t.hints.some((h) => h.includes("הרשאה"))).toBe(true);
  });

  it("בלי שום שגיאה — נאמר במפורש שזו התנהגות ולא קריסה", () => {
    const t = triageTicket("bug", { path: "/" });
    expect(t.hints.some((h) => h.includes("לא נרשמו שגיאות"))).toBe(true);
  });
});

describe("trimEvidence", () => {
  it("שומר את האחרונות — הן אלה שקרו לפני הלחיצה", () => {
    expect(trimEvidence(["a", "b", "c"], 2)).toEqual(["b", "c"]);
  });
});

describe("sanitizeSupportContext", () => {
  it("מנקה גם את הכתובות שבתוך הראיות, לא רק את הנתיב", () => {
    const out = sanitizeSupportContext({
      path: "/search?q=דנה",
      failedRequests: ["500 GET /search?q=דנה"],
      breadcrumbs: ["/buyers?name=דנה"],
    });
    expect(out.path).toBe("/search?q=…");
    expect(out.failedRequests).toEqual(["500 GET /search?q=…"]);
    expect(out.breadcrumbs).toEqual(["/buyers?name=…"]);
  });

  it("שדות ריקים אינם נשמרים כמערכים ריקים", () => {
    expect(sanitizeSupportContext({ path: "/" })).toEqual({ path: "/" });
  });
});
