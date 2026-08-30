import { describe, expect, it } from "vitest";

import { summarizeCall } from "./call-summary.js";
import {
  buildCallIntelPrompt,
  formatRoleTranscript,
  mergeCallIntel,
  parseCallIntel,
  parseRoleTranscript,
  type CallIntelTurn,
} from "./call-intel.js";

/**
 * ‎**מודל שממציא פרט אחד גרוע ממשפט יבש שכולו נכון.**
 *
 * הבדיקות כאן אינן על „האם הפענוח עובד” אלא על **מה נפסל**: זה
 * הצד שקובע אם מתווך יכול להסתמך על מה שהוא רואה מול הלקוח.
 */

const TRANSCRIPT = [
  "שלום, מדבר יוסי ממשרד התיווך. ראיתי שהשארת פנייה.",
  "כן היי, אנחנו מחפשים דירת 4 חדרים ברמת גן, תקציב עד 2500000.",
  "מעולה. יש לכם משכנתה מאושרת?",
  "כן, אישרו לנו. צריך להיכנס תוך שלושה חודשים.",
].join(" ");

const FULL = {
  turns: [
    { role: "agent", text: "שלום, מדבר יוסי ממשרד התיווך. ראיתי שהשארת פנייה." },
    { role: "client", text: "כן היי, אנחנו מחפשים דירת 4 חדרים ברמת גן, תקציב עד 2500000." },
    { role: "agent", text: "מעולה. יש לכם משכנתה מאושרת?" },
    { role: "client", text: "כן, אישרו לנו. צריך להיכנס תוך שלושה חודשים." },
  ],
  summary: "זוג מחפש 4 חדרים ברמת גן עד 2500000, משכנתה מאושרת, כניסה תוך שלושה חודשים.",
  outcome: "interested",
  side: "buyer",
  propertyType: "דירה",
  city: "רמת גן",
  budget: 2_500_000,
  rooms: 4,
  timeline: "תוך שלושה חודשים",
  financing: "משכנתה מאושרת",
};

describe("parseCallIntel — מה שמתקבל", () => {
  it("תורות מתויגות בתפקיד, לא במספר", () => {
    const intel = parseCallIntel(FULL, TRANSCRIPT);
    expect(intel?.turns.map((t) => t.role)).toEqual(["agent", "client", "agent", "client"]);
  });

  it("הצד הוא השדה שמשנה את כל השיחה", () => {
    expect(parseCallIntel(FULL, TRANSCRIPT)?.highlights.side).toBe("buyer");
  });

  it("שדות הנדל\"ן מגיעים במלואם", () => {
    const h = parseCallIntel(FULL, TRANSCRIPT)?.highlights;
    expect(h).toMatchObject({
      budget: 2_500_000,
      rooms: 4,
      city: "רמת גן",
      propertyType: "דירה",
      financing: "משכנתה מאושרת",
      timeline: "תוך שלושה חודשים",
    });
  });

  it("רשימות נחתכות ומנוקות", () => {
    const intel = parseCallIntel(
      { ...FULL, features: ["  מעלית  ", "", "חניה", "א".repeat(200)] },
      TRANSCRIPT,
    );
    expect(intel?.highlights.features?.[0]).toBe("מעלית");
    expect(intel?.highlights.features).toHaveLength(3);
    expect(intel?.highlights.features?.[2]?.length).toBe(60);
  });
});

describe("parseCallIntel — מה שנפסל", () => {
  /*
   * תמלול אוטומטי משבש ספרות. מספר שלא נאמר בשיחה הוא המצאה, גם
   * כשהוא נשמע סביר — והוא בדיוק מה שמתווך יצטט ללקוח.
   */
  it("תקציב שלא נאמר בתמלול נזרק", () => {
    const intel = parseCallIntel({ ...FULL, budget: 3_100_000 }, TRANSCRIPT);
    expect(intel?.highlights.budget).toBeUndefined();
  });

  it("מספר מחוץ לטווח שפוי נזרק גם אם נאמר", () => {
    // "140" אפשרי בתמלול, 140 חדרים אינם
    expect(parseCallIntel({ ...FULL, rooms: 140 }, `${TRANSCRIPT} 140`)?.highlights.rooms)
      .toBeUndefined();
  });

  it("סיכום עם מספר שלא נאמר נפסל כולו — ולא מתוקן", () => {
    const intel = parseCallIntel(
      { ...FULL, summary: "מחפש 5 חדרים עד 9000000 בהרצליה." },
      TRANSCRIPT,
    );
    expect(intel?.summary).toBe("");
  });

  /*
   * הבקשה היא לפצל ולתייג, לא לנסח מחדש. תמלול שנכתב מחדש נראה
   * טוב יותר ואינו מה שנאמר — וזה פסול בתיעוד שיחה.
   */
  it("תורות שהן כתיבה מחדש נפסלות", () => {
    const intel = parseCallIntel(
      { ...FULL, turns: [
        { role: "agent", text: "היי" },
        { role: "client", text: "מחפשים דירה" },
      ] },
      TRANSCRIPT,
    );
    expect(intel?.turns).toEqual([]);
  });

  it("תור יחיד אינו הפרדה", () => {
    const intel = parseCallIntel(
      { ...FULL, turns: [{ role: "agent", text: TRANSCRIPT }] },
      TRANSCRIPT,
    );
    expect(intel?.turns).toEqual([]);
  });

  it("תפקיד לא מוכר נופל ל-other ולא מפיל את התור", () => {
    const turns = FULL.turns.map((t, i) => (i === 0 ? { ...t, role: "boss" } : t));
    expect(parseCallIntel({ ...FULL, turns }, TRANSCRIPT)?.turns[0]?.role).toBe("other");
  });

  it("enum שאינו מוכר נזרק, לא מנוחש", () => {
    expect(parseCallIntel({ ...FULL, side: "investor" }, TRANSCRIPT)?.highlights.side)
      .toBeUndefined();
  });

  it("תשובה ריקה או זרה מחזירה null", () => {
    expect(parseCallIntel(null, TRANSCRIPT)).toBeNull();
    expect(parseCallIntel({}, TRANSCRIPT)).toBeNull();
    expect(parseCallIntel("טקסט", TRANSCRIPT)).toBeNull();
  });
});

describe("mergeCallIntel — רשת הביטחון", () => {
  it("בלי מודל, החילוץ הדטרמיניסטי הוא התוצאה", () => {
    const fallback = summarizeCall(TRANSCRIPT);
    const merged = mergeCallIntel(null, fallback);
    expect(merged.summary).toBe(fallback.summary);
    expect(merged.turns).toEqual([]);
  });

  /*
   * מה שהמודל השמיט — בין אם לא ראה ובין אם נפסל בבדיקת המספרים —
   * עדיין שווה משהו. אין סיבה לזרוק אותו.
   */
  it("המודל גובר, והחילוץ ממלא חוסרים", () => {
    const fallback = summarizeCall(TRANSCRIPT);
    expect(fallback.highlights.rooms).toBe(4);
    const merged = mergeCallIntel(
      { turns: [], summary: "", highlights: { side: "buyer" }, suggestedOutcome: null },
      fallback,
    );
    expect(merged.highlights.side).toBe("buyer");
    expect(merged.highlights.rooms).toBe(4);
    expect(merged.summary).toBe(fallback.summary);
    expect(merged.suggestedOutcome).toBe(fallback.suggestedOutcome);
  });
});

describe("הלוך-ושוב של הטקסט שנשמר", () => {
  const turns: CallIntelTurn[] = [
    { role: "agent", text: "שלום" },
    { role: "client", text: "היי" },
    { role: "other", text: "תא קולי" },
  ];

  it("מה שנכתב נקרא בחזרה זהה", () => {
    expect(parseRoleTranscript(formatRoleTranscript(turns))).toEqual(turns);
  });

  it("שורה בלי תווית מצטרפת לתור שלפניה ולא פותחת חדש", () => {
    const parsed = parseRoleTranscript("מתווך: שורה ראשונה\nהמשך של אותו משפט\nלקוח: תשובה");
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.text).toBe("שורה ראשונה\nהמשך של אותו משפט");
  });

  it("טקסט ריק מחזיר רשימה ריקה", () => {
    expect(parseRoleTranscript("   ")).toEqual([]);
  });
});

describe("ההנחיה", () => {
  it("נושאת את התמלול ואת הכלל שאוסר להמציא", () => {
    const prompt = buildCallIntelPrompt(TRANSCRIPT);
    expect(prompt).toContain(TRANSCRIPT);
    expect(prompt).toContain("אל תמציא");
  });

  it("כיוון השיחה נכנס כרמז, וכשאינו ידוע אינו מומצא", () => {
    expect(buildCallIntelPrompt(TRANSCRIPT, { direction: "outbound" })).toContain("השיחה יוצאת");
    const blind = buildCallIntelPrompt(TRANSCRIPT);
    expect(blind).not.toContain("השיחה יוצאת");
    expect(blind).not.toContain("השיחה נכנסת");
  });

  it("שמות שידועים נמסרים כדי שלא ינוחשו", () => {
    const prompt = buildCallIntelPrompt(TRANSCRIPT, { agentName: "יוסי", contactName: "רות" });
    expect(prompt).toContain("שם המתווך: יוסי");
    expect(prompt).toContain("שם הלקוח: רות");
  });
});
