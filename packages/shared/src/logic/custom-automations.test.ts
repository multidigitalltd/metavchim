import { describe, expect, it } from "vitest";
import {
  AUTOMATION_TRIGGERS,
  automationTrigger,
  conditionsMatch,
  describeRule,
  ruleRejectionReason,
  type AutomationRuleInput,
} from "./custom-automations.js";

const leadTrigger = automationTrigger("lead.created")!;

const rule = (over: Partial<AutomationRuleInput> = {}): AutomationRuleInput => ({
  name: "כלל",
  enabled: true,
  trigger: "lead.created",
  conditions: [],
  action: {
    kind: "task",
    assignedToUserId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    title: "לחזור ללקוח",
    dueInDays: 1,
  },
  ...over,
});

describe("קטלוג הטריגרים", () => {
  it("כל טריגר נושא שם אירוע ייחודי", () => {
    const events = AUTOMATION_TRIGGERS.map((t) => t.event);
    expect(new Set(events).size).toBe(events.length);
  });

  /*
   * שדה שמוצע לתנאי ואינו קיים בגוף האירוע הוא כלל שלעולם לא
   * יתקיים — ולכן שמות השדות כאן אינם טקסט חופשי.
   */
  it("שדות התנאי נושאים מפתח ותווית", () => {
    for (const trigger of AUTOMATION_TRIGGERS) {
      for (const field of trigger.fields) {
        expect(field.key).not.toBe("");
        expect(field.label).not.toBe("");
      }
    }
  });
});

describe("conditionsMatch", () => {
  it("ללא תנאים — תמיד מתקיים", () => {
    expect(conditionsMatch(leadTrigger, [], { source: "web" })).toBe(true);
  });

  it("שוויון על טקסט", () => {
    const c = [{ field: "source", operator: "eq" as const, value: "whatsapp" }];
    expect(conditionsMatch(leadTrigger, c, { source: "whatsapp" })).toBe(true);
    expect(conditionsMatch(leadTrigger, c, { source: "web" })).toBe(false);
  });

  /*
   * הכלל שקובע את ההתנהגות כשמוסיפים תנאי: מצמצם, לא מרחיב. משרד
   * שמנסח שני תנאים מתכוון לשניהם.
   */
  it("שני תנאים הם וגם — לא או", () => {
    const c = [
      { field: "source", operator: "eq" as const, value: "whatsapp" },
      { field: "requiresHuman", operator: "eq" as const, value: "true" },
    ];
    expect(conditionsMatch(leadTrigger, c, { source: "whatsapp", requiresHuman: true })).toBe(true);
    expect(conditionsMatch(leadTrigger, c, { source: "whatsapp", requiresHuman: false })).toBe(
      false,
    );
  });

  it("השוואה מספרית", () => {
    const matches = automationTrigger("matches.computed")!;
    const c = [{ field: "newMatchCount", operator: "gte" as const, value: "3" }];
    expect(conditionsMatch(matches, c, { newMatchCount: 5 })).toBe(true);
    expect(conditionsMatch(matches, c, { newMatchCount: 2 })).toBe(false);
  });

  it("מכיל / אינו מכיל על רשימה", () => {
    const updated = automationTrigger("property.updated")!;
    const has = [{ field: "changedFields", operator: "contains" as const, value: "priceAgorot" }];
    expect(conditionsMatch(updated, has, { changedFields: ["priceAgorot", "rooms"] })).toBe(true);
    expect(conditionsMatch(updated, has, { changedFields: ["rooms"] })).toBe(false);

    const hasnt = [
      { field: "changedFields", operator: "not_contains" as const, value: "priceAgorot" },
    ];
    expect(conditionsMatch(updated, hasnt, { changedFields: ["rooms"] })).toBe(true);
  });

  /*
   * הכיוון הבטוח בשני מקרי הקצה. כלל פגום שאינו רץ מתגלה כשמישהו
   * שואל למה; כלל פגום שרץ על הכול מציף את המשרד במשימות.
   */
  it("שדה חסר בגוף האירוע אינו מקיים תנאי מספרי", () => {
    const matches = automationTrigger("matches.computed")!;
    const c = [{ field: "newMatchCount", operator: "gte" as const, value: "1" }];
    expect(conditionsMatch(matches, c, {})).toBe(false);
  });

  it("תנאי על שדה שאינו בקטלוג אינו מתקיים", () => {
    const c = [{ field: "nope", operator: "eq" as const, value: "x" }];
    expect(conditionsMatch(leadTrigger, c, { nope: "x" })).toBe(false);
  });

  it("רשימה חסרה נחשבת ריקה", () => {
    const updated = automationTrigger("property.updated")!;
    const c = [{ field: "changedFields", operator: "contains" as const, value: "rooms" }];
    expect(conditionsMatch(updated, c, {})).toBe(false);
  });
});

describe("ruleRejectionReason", () => {
  it("כלל תקין עובר", () => {
    expect(ruleRejectionReason(rule())).toBeNull();
  });

  it("טריגר לא מוכר נדחה", () => {
    expect(ruleRejectionReason(rule({ trigger: "nope.happened" }))).toBe("הטריגר אינו מוכר");
  });

  it("שדה שאינו קיים בטריגר נדחה", () => {
    const reason = ruleRejectionReason(
      rule({ conditions: [{ field: "city", operator: "eq", value: "בני ברק" }] }),
    );
    expect(reason).toContain("city");
  });

  it("אופרטור שאינו מתאים לסוג השדה נדחה", () => {
    const reason = ruleRejectionReason(
      rule({ conditions: [{ field: "source", operator: "gte", value: "3" }] }),
    );
    expect(reason).toContain("אינו מתאים");
  });

  it("ערך לא מספרי בשדה מספרי נדחה", () => {
    const reason = ruleRejectionReason(
      rule({
        trigger: "matches.computed",
        conditions: [{ field: "newMatchCount", operator: "gte", value: "הרבה" }],
      }),
    );
    expect(reason).toContain("מספר");
  });
});

describe("describeRule", () => {
  it("מתאר טריגר ופעולה במשפט אחד", () => {
    expect(describeRule(rule())).toContain("נכנס ליד חדש");
    expect(describeRule(rule())).toContain("לחזור ללקוח");
  });

  it("כולל את התנאים כשיש", () => {
    const text = describeRule(
      rule({ conditions: [{ field: "source", operator: "eq", value: "whatsapp" }] }),
    );
    expect(text).toContain("מקור הליד");
    expect(text).toContain("whatsapp");
  });
});
