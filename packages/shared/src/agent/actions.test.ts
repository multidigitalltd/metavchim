import { describe, expect, it } from "vitest";
import {
  AGENT_ACTIONS,
  AGENT_ACTION_IDS,
  agentAction,
  agentFieldLabel,
  isReadOnlyAction,
} from "./actions";
import { CAPABILITIES } from "../rbac";
import { fieldDescription } from "./field-spec";
import {
  actionParamsZod,
  interpretJsonSchema,
  narrowParams,
  InterpretResponseSchema,
} from "./schema";
import { buildInterpretPrompt } from "./prompt";

/*
 * הבדיקות כאן אינן על התנהגות אלא על **מבנה**: הן מה שהופך את
 * הקטלוג למקור אמת יחיד במקום לרשימה שמישהו צריך לזכור לסנכרן.
 */
describe("קטלוג הפעולות — שלמות מבנית", () => {
  it("לכל מזהה בקטלוג יש הגדרה, ולהפך", () => {
    expect(AGENT_ACTIONS.map((a) => a.id).sort()).toEqual([...AGENT_ACTION_IDS].sort());
    for (const id of AGENT_ACTION_IDS) expect(agentAction(id)).toBeDefined();
  });

  /*
   * הבדיקה שמונעת את הכשל החמור ביותר: פעולה בלי שער.
   *
   * `capability` מוקלד כ-`Capability`, אבל טיפוס אינו מונע העתקה של
   * שם יכולת שהוסר מהקטלוג בעתיד. כאן זה נבדק מול הרשימה החיה.
   */
  it("לכל פעולה יש יכולת קיימת", () => {
    for (const action of AGENT_ACTIONS) {
      expect(CAPABILITIES, `${action.id}`).toContain(action.capability);
    }
  });

  /*
   * הכלל השני של הארכיטקטורה, כבדיקה ולא כהערה: אין פעולות
   * הרסניות. הצעה מתמלול שגוי יכולה במקרה הגרוע לבקש רשומה מיותרת,
   * ולא למחוק רשומה שאי אפשר להחזיר.
   */
  it("אין פעולה הרסנית בקטלוג", () => {
    for (const action of AGENT_ACTIONS) {
      expect(action.id).not.toMatch(/delete|remove|cancel|purge|archive/u);
      expect(action.capability).not.toMatch(/\.delete$/u);
    }
  });

  it("לכל פעולה יש דוגמאות בעברית — מודל בלי דוגמאות מנחש", () => {
    for (const action of AGENT_ACTIONS) {
      expect(action.examples.length, action.id).toBeGreaterThanOrEqual(3);
      for (const example of action.examples) {
        expect(example, action.id).toMatch(/[א-ת]/u);
      }
    }
  });

  it("אין שדות כפולים בתוך אותה פעולה", () => {
    for (const action of AGENT_ACTIONS) {
      const keys = action.fields.map((f) => f.key);
      expect(new Set(keys).size, action.id).toBe(keys.length);
    }
  });

  /*
   * סכימת Gemini אינה תומכת ב-`oneOf`, ולכן כל השדות מאוחדים
   * לאובייקט אחד ומפתח מופיע בו פעם אחת. אם שתי פעולות מצהירות על
   * אותו מפתח אחרת, אחת מהן תקבל בסכימה תיאור של האחרת — והמודל
   * ימלא אותו לפי ההגדרה הלא נכונה, בשקט.
   */
  it("מפתח שמופיע בכמה פעולות מוצהר זהה בכולן", () => {
    const seen = new Map<string, { description: string; owner: string }>();
    for (const action of AGENT_ACTIONS) {
      for (const field of action.fields) {
        const description = fieldDescription(field);
        const previous = seen.get(field.key);
        if (previous === undefined) {
          seen.set(field.key, { description, owner: action.id });
          continue;
        }
        expect(description, `${field.key}: ${previous.owner} מול ${action.id}`).toBe(
          previous.description,
        );
      }
    }
  });

  it("תוויות — שדה מוכר מקבל את שלו, ולא מוכר חוזר כמפתח", () => {
    expect(agentFieldLabel("create_buyer", "roomsMin")).toBe("חדרים — מינימום");
    expect(agentFieldLabel("create_property", "entryDate")).toBe("תאריך כניסה");
    expect(agentFieldLabel("create_buyer", "nonsense")).toBe("nonsense");
  });

  it("רק שאילתות מסומנות לקריאה בלבד", () => {
    expect(isReadOnlyAction("find_buyers")).toBe(true);
    expect(isReadOnlyAction("show_matches")).toBe(true);
    expect(isReadOnlyAction("create_buyer")).toBe(false);
    expect(isReadOnlyAction("send_offer")).toBe(false);
  });
});

describe("סכימת המודל", () => {
  it("מונה את כל הפעולות ואת unknown", () => {
    const schema = interpretJsonSchema() as {
      properties: { action: { enum: string[] } };
    };
    expect(schema.properties.action.enum).toContain("unknown");
    for (const id of AGENT_ACTION_IDS) {
      expect(schema.properties.action.enum).toContain(id);
    }
  });

  it("כל שדה בקטלוג מופיע בסכימה", () => {
    const schema = interpretJsonSchema() as {
      properties: { params: { properties: Record<string, unknown> } };
    };
    for (const action of AGENT_ACTIONS) {
      for (const field of action.fields) {
        expect(schema.properties.params.properties, field.key).toHaveProperty(field.key);
      }
    }
  });

  /*
   * ‎enum‎ בסכימה הוא מה שמונע מהמודל להמציא ערך. בלעדיו הוא מחזיר
   * „דירה” במקום `apartment` והשדה נופל בוולידציה — כלומר המשתמש
   * מאבד שדה שנאמר במפורש.
   */
  it("שדה בחירה נושא את רשימת הערכים", () => {
    const schema = interpretJsonSchema() as {
      properties: { params: { properties: Record<string, { enum?: string[] }> } };
    };
    expect(schema.properties.params.properties["propertyType"]?.enum).toContain("penthouse");
  });
});

describe("צמצום לפעולה שנבחרה", () => {
  const buyer = agentAction("create_buyer")!;

  it("שדה ששייך לפעולה אחרת נזרק", () => {
    const { params } = narrowParams(buyer, {
      name: "משה כהן",
      // שייך ל-create_property בלבד
      totalFloors: 6,
    });
    expect(params).toEqual({ name: "משה כהן" });
  });

  /*
   * הכלל שמונע „לא הבנתי” על משפט שהובן כמעט כולו: שדה פגום יורד
   * ומדווח, ושאר ההצעה שורדת.
   */
  it("שדה פגום יורד ומדווח — ההצעה שורדת", () => {
    const { params, rejected } = narrowParams(buyer, {
      name: "משה כהן",
      roomsMin: 3.7, // אינו כפולה של חצי
      budgetMaxShekels: 2_300_000,
    });
    expect(params).toEqual({ name: "משה כהן", budgetMaxShekels: 2_300_000 });
    expect(rejected).toEqual(["roomsMin"]);
  });

  it("רשימה ריקה אינה ערך", () => {
    const { params } = narrowParams(buyer, { name: "דנה", cities: [] });
    expect(params).toEqual({ name: "דנה" });
  });

  it("ערך מחוץ לרשימת הבחירה נפסל ולא מתורגם", () => {
    const { params, rejected } = narrowParams(buyer, { maturity: "רותח" });
    expect(params).toEqual({});
    expect(rejected).toEqual(["maturity"]);
  });

  /* הכול אופציונלי — משפט אחד אינו טופס, וחוסר אינו שגיאה */
  it("סכימת הפרמטרים מקבלת אובייקט ריק", () => {
    expect(actionParamsZod(buyer).safeParse({}).success).toBe(true);
  });

  it("תשובה בלי params נקראת כתשובה ריקה ולא ככשל", () => {
    const parsed = InterpretResponseSchema.safeParse({ action: "search" });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.params).toEqual({});
  });

  /*
   * מצב ה-JSON החופשי (המודל דחה את הסכימה, קרה בפרודקשן): מודלים
   * כותבים null בשדה ריק, מחזירים מחרוזת במקום רשימה, וממציאים צעד
   * עם פעולה לא קיימת. אף אחת מהסטיות האלה לא מפילה את ההצעה —
   * רק action קשיח.
   */
  describe("סלחנות למצב ה-JSON החופשי", () => {
    it("null בשדות עזר אינו מפיל את הפענוח", () => {
      const parsed = InterpretResponseSchema.safeParse({
        action: "search",
        params: { query: "קונים בגבעתיים" },
        evidence: null,
        unmapped: null,
        clarify: null,
        steps: null,
      });
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.steps).toEqual([]);
      expect(parsed.success && parsed.data.clarify).toBeUndefined();
    });

    it("unmapped כמחרוזת בודדת הופך לרשימה, וערכים שאינם מחרוזת מסוננים", () => {
      const parsed = InterpretResponseSchema.safeParse({
        action: "search",
        unmapped: "נאמר גם משהו על חניה",
        evidence: { query: "קונים", rooms: 4 },
      });
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.unmapped).toEqual(["נאמר גם משהו על חניה"]);
      expect(parsed.success && parsed.data.evidence).toEqual({ query: "קונים" });
    });

    it("צעד עם פעולה מומצאת נזרק בלי להפיל את הצעד התקין", () => {
      const parsed = InterpretResponseSchema.safeParse({
        action: "create_buyer",
        params: { name: "משה" },
        steps: [
          { action: "fly_to_moon", params: {} },
          { action: "add_note", params: { text: "הערה" }, dateText: null },
        ],
      });
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.steps).toHaveLength(1);
      expect(parsed.success && parsed.data.steps[0]?.action).toBe("add_note");
    });

    it("action חסר או מומצא עדיין נכשל — בלעדיו אין מה להציע", () => {
      expect(InterpretResponseSchema.safeParse({ params: {} }).success).toBe(false);
      expect(InterpretResponseSchema.safeParse({ action: "do_magic" }).success).toBe(false);
    });
  });
});

describe("הפרומפט", () => {
  const context = {
    nowText: "יום רביעי, 20 באוגוסט 2026, 10:00",
    allowedActions: [...AGENT_ACTION_IDS],
  };

  it("מונה כל פעולה מותרת עם שדותיה", () => {
    const prompt = buildInterpretPrompt("תוסיף קונה", context);
    for (const action of AGENT_ACTIONS) {
      expect(prompt).toContain(action.id);
      expect(prompt).toContain(action.title);
    }
    expect(prompt).toContain("budgetMaxShekels");
  });

  /*
   * הבדיקה שמגנה על החוויה: פעולה שאין אליה הרשאה לא מוזכרת, ולכן
   * המודל אינו מציע אותה והמתווך אינו מקבל „אין לך הרשאה” על ניסוח
   * סביר לגמרי.
   */
  it("פעולה שאין אליה הרשאה אינה מוזכרת כלל", () => {
    const prompt = buildInterpretPrompt("שלח את הדירה למשה", {
      ...context,
      allowedActions: ["search", "find_buyers"],
    });
    expect(prompt).not.toContain("send_offer");
    expect(prompt).not.toContain("propertyPhrase");
    expect(prompt).toContain("find_buyers");
  });

  it("אוסר על המודל להחזיר תאריכים ומסביר למה", () => {
    const prompt = buildInterpretPrompt("קבע פגישה מחר", context);
    expect(prompt).toContain("אל תחזיר תאריכים");
    expect(prompt).toContain(context.nowText);
  });

  it("תיקון להצעה קודמת מבקש לשמור על אותה פעולה", () => {
    const prompt = buildInterpretPrompt("לא, 4 חדרים", {
      ...context,
      prior: { action: "create_buyer", params: { roomsMin: 3 } },
    });
    expect(prompt).toContain("תיקון להצעה קודמת");
    expect(prompt).toContain('"create_buyer"');
  });

  /* מרכאות בתמלול סוגרות את המחרוזת ומבלבלות את המודל */
  it("מרכאות בתמלול אינן שוברות את המבנה", () => {
    const prompt = buildInterpretPrompt('הדירה ב"הרב שך"', context);
    expect(prompt).toContain("הדירה ב'הרב שך'");
  });
});
