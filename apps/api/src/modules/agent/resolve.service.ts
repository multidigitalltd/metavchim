import { Injectable } from "@nestjs/common";
import {
  agentAction,
  agentFieldLabel,
  formatFieldValue,
  normalizePhone,
  parseHebrewDateTime,
  PhoneSchema,
  resolvePlaces,
  type AgentCandidate,
  type AgentField,
  type AgentProposal,
} from "@metavchim/shared";
import { BuyersService } from "../buyers/buyers.service";
import { SearchService } from "../search/search.service";
import type { Interpretation } from "./interpret.service";

/**
 * מה שהמודל **אינו** מכריע — והקוד כן.
 *
 * ## שלושת הדברים שמודל שפה אינו יכול לדעת
 *
 * **1. תאריכים.** „יום שלישי הקרוב” דורש לוח שנה, אזור זמן וידיעה
 * מה היום. מודל שמנחש כאן נשמע משכנע וטועה בשקט, והמתווך מגלה זאת
 * כשהלקוח לא מגיע. `parseHebrewDateTime` מחשב בשעון ירושלים.
 *
 * **2. מה קיים במאגר.** המודל אינו רואה את הנתונים של המשרד. הוא
 * מוסר את **הביטוי** שנאמר — „שרה”, „הדירה בהרב שך” — והקוד מחפש
 * אותו. שם שאינו במאגר עוצר את הפעולה במקום להיעלם ממנה.
 *
 * **3. אילו מקומות באמת רלוונטיים.** המודל מזהה שמות מקומות בישראל
 * טוב יותר מכל רשימה שנתחזק, אבל אינו יודע אם למשרד יש שם משהו.
 * `resolvePlaces` משווה מול אוצר המילים האמיתי בהשוואה סלחנית.
 *
 * ## למה מקום שלא נמצא הוא אזהרה ולא השמטה
 *
 * זה היה הבאג המקורי של הסוכן: מיקום שלא זוהה פשוט לא נכנס
 * לשאילתה, והמתווך קיבל את **כל** הקונים בארץ בתור „התשובה”.
 * הרשימה נראית סבירה ואין בה שום סימן שהשאלה שלו נשמטה. תשובה
 * שנראית מלאה ואינה קשורה לשאלה גרועה מתשובה ריקה.
 */

@Injectable()
export class AgentResolveService {
  constructor(
    private readonly buyers: BuyersService,
    private readonly search: SearchService,
  ) {}

  async toProposal(
    transcript: string,
    interpretation: Interpretation,
  ): Promise<AgentProposal> {
    const action = agentAction(interpretation.actionId);
    if (!action) {
      return {
        actionId: "unknown",
        title: "לא הבנתי",
        risk: "read",
        summary: "",
        fields: [],
        missing: [],
        warnings: interpretation.unmapped,
        ...(interpretation.clarify ? { clarify: interpretation.clarify } : {}),
        fallback: interpretation.fallback,
      };
    }

    const params = { ...interpretation.params };
    const warnings: string[] = [];
    const resolvedKeys = new Set<string>();

    await this.resolveCities(params, warnings, resolvedKeys);
    this.resolvePhones(params, warnings, resolvedKeys);
    this.resolveDates(action.id, transcript, params, resolvedKeys);
    this.applyKindDefault(action.id, transcript, params, resolvedKeys);

    const candidates = await this.resolveEntity(action.id, params);

    for (const key of interpretation.rejected) {
      warnings.push(`לא הצלחתי לקרוא את הערך של „${agentFieldLabel(action.id, key)}”`);
    }
    for (const item of interpretation.unmapped) {
      warnings.push(`נאמר ולא שויך לשדה: ${item}`);
    }

    const fields = this.toFields(action.id, params, interpretation, resolvedKeys);

    return {
      actionId: action.id,
      title: action.title,
      risk: action.risk,
      summary: summarize(action.id, params),
      fields,
      missing: this.missingFields(action.id, params),
      warnings,
      ...(candidates ? { candidates } : {}),
      ...(interpretation.clarify ? { clarify: interpretation.clarify } : {}),
      fallback: interpretation.fallback,
    };
  }

  /**
   * שמות מקומות ⟵ מה שקיים אצל המשרד.
   *
   * מקום שנאמר ואין לו אף רשומה מוחזר כאזהרה מפורשת. אם **חלק**
   * מהמקומות נמצאו, הפעולה ממשיכה עליהם וההודאה על השאר נלווית
   * אליה — עצירה מוחלטת על שם אחד שגוי הייתה גרועה מדי.
   */
  private async resolveCities(
    params: Record<string, unknown>,
    warnings: string[],
    resolved: Set<string>,
  ): Promise<void> {
    const spoken = params["cities"];
    if (!Array.isArray(spoken) || spoken.length === 0) return;
    const { matched, unmatched } = resolvePlaces(
      spoken as string[],
      await this.buyers.placeVocabulary(),
    );
    if (unmatched.length > 0) {
      warnings.push(`אין במאגר אף רשומה ב${unmatched.join(" / ")}`);
    }
    /*
     * כשאף מקום לא נמצא, הערים שנאמרו נשמרות כפי שהן ולא נמחקות.
     * ביצירת כרטיס חדש זה תקין לגמרי — הלקוח הראשון בעיר חייב
     * להיכנס איכשהו — ובשאילתה השרת יחזיר תוצאה ריקה, שהיא התשובה
     * הנכונה. מה שאסור הוא למחוק את התנאי בשקט ולהחזיר את הכול.
     */
    if (matched.length > 0) {
      params["cities"] = matched;
      resolved.add("cities");
    }
  }

  /** טלפון ⟵ E.164. מספר שאינו ניתן לנרמול יורד ומדווח. */
  private resolvePhones(
    params: Record<string, unknown>,
    warnings: string[],
    resolved: Set<string>,
  ): void {
    for (const key of ["phone", "ownerPhone"]) {
      const raw = params[key];
      if (typeof raw !== "string" || raw === "") continue;
      const normalized = normalizePhone(raw);
      if (PhoneSchema.safeParse(normalized).success) {
        params[key] = normalized;
        resolved.add(key);
      } else {
        delete params[key];
        warnings.push(`„${raw}” אינו מספר טלפון ישראלי תקין`);
      }
    }
  }

  /**
   * המועד — תמיד מהמנוע שלנו, לעולם לא מהמודל.
   *
   * `timeExplicit=false` אומר שנאמר יום בלי שעה ונבחרה 10:00. זה
   * נאמר במפורש בכרטיס, כי „מחר” שהופך ל-10:00 בלי להודיע הוא
   * פגישה שנקבעה בשעה שאיש לא אמר.
   */
  private resolveDates(
    actionId: string,
    transcript: string,
    params: Record<string, unknown>,
    resolved: Set<string>,
  ): void {
    const key = DATE_FIELD[actionId];
    if (key === undefined) return;
    const parsed = parseHebrewDateTime(transcript, new Date());
    if (!parsed.date) return;
    params[key] = parsed.date.toISOString();
    params["__timeExplicit"] = parsed.timeExplicit;
    resolved.add(key);
  }

  /** סוג הפגישה — מהניסוח, כשהמודל לא אמר. */
  private applyKindDefault(
    actionId: string,
    transcript: string,
    params: Record<string, unknown>,
    resolved: Set<string>,
  ): void {
    if (actionId !== "schedule_appointment" || params["kind"] !== undefined) return;
    params["kind"] = /סיור|ביקור|להראות/u.test(transcript)
      ? "viewing"
      : /שיחה|טלפון|לדבר/u.test(transcript)
        ? "call"
        : "meeting";
    resolved.add("kind");
  }

  /**
   * ביטוי ⟵ רשומה אמיתית.
   *
   * **התאמה יחידה אינה נבחרת אוטומטית בפעולה שיוצאת ללקוח.**
   * „שלח לשרה” כששתי שרה קיימות הוא בדיוק המקרה שבו טעות שקטה
   * מגיעה לאדם הלא נכון, ולכן `send_offer` תמיד מציג בחירה. בפעולות
   * הפנימיות התאמה יחידה נבחרת, כי שם המחיר של טעות הוא עריכה.
   */
  private async resolveEntity(
    actionId: string,
    params: Record<string, unknown>,
  ): Promise<AgentProposal["candidates"] | undefined> {
    const spec = ENTITY_LOOKUP[actionId];
    if (spec === undefined) return undefined;
    const phrase = params[spec.key];
    if (typeof phrase !== "string" || phrase.trim().length < 2) return undefined;

    const results = await this.search.search(phrase.trim());
    const options: AgentCandidate[] =
      spec.kind === "buyer"
        ? results.buyers.slice(0, 8).map((b) => ({
            id: b.id,
            label: b.name,
            ...(b.cities.length > 0 ? { detail: b.cities.join(" / ") } : {}),
          }))
        : results.properties.slice(0, 8).map((p) => ({
            id: p.id,
            label:
              p.marketingTitle ??
              [p.street, p.neighborhood, p.city].filter(Boolean).join(", ") ??
              p.id,
            ...(p.city ? { detail: p.city } : {}),
          }));

    if (options.length === 0) {
      return { key: spec.key, label: spec.label, options: [] };
    }
    if (options.length === 1 && !spec.alwaysChoose) {
      params[spec.idKey] = options[0]!.id;
      return undefined;
    }
    return { key: spec.key, label: spec.label, options };
  }

  private toFields(
    actionId: string,
    params: Record<string, unknown>,
    interpretation: Interpretation,
    resolved: Set<string>,
  ): AgentField[] {
    const action = agentAction(actionId)!;
    const fields: AgentField[] = [];
    for (const spec of action.fields) {
      const value = params[spec.key];
      if (value === undefined) continue;
      const evidence = interpretation.evidence[spec.key];
      fields.push({
        key: spec.key,
        label: spec.label,
        value,
        display: formatFieldValue(spec, value),
        source: resolved.has(spec.key)
          ? "resolved"
          : interpretation.fallback
            ? "rules"
            : "llm",
        ...(evidence ? { evidence } : {}),
      });
    }
    for (const spec of action.resolved ?? []) {
      const value = params[spec.key];
      if (value === undefined) continue;
      fields.push({
        key: spec.key,
        label: spec.label,
        value,
        display: typeof value === "string" ? formatDate(value) : String(value),
        source: "resolved",
      });
    }
    return fields;
  }

  /** מה שהפעולה שווה יותר איתו — השלמות, לא שגיאות. */
  private missingFields(
    actionId: string,
    params: Record<string, unknown>,
  ): { key: string; label: string }[] {
    return (RECOMMENDED[actionId] ?? [])
      .filter((key) => params[key] === undefined)
      .map((key) => ({ key, label: agentFieldLabel(actionId, key) }));
  }
}

/** לאיזה שדה נכנס התאריך שנפתר מהתמלול, לכל פעולה. */
const DATE_FIELD: Record<string, string | undefined> = {
  create_task: "dueAt",
  schedule_appointment: "startsAt",
  create_property: "entryDate",
  update_property: "entryDate",
  create_buyer: "entryBy",
  update_buyer: "entryBy",
};

const ENTITY_LOOKUP: Record<
  string,
  { key: string; idKey: string; label: string; kind: "buyer" | "property"; alwaysChoose?: boolean }
> = {
  update_buyer: { key: "buyerPhrase", idKey: "buyerId", label: "איזה קונה", kind: "buyer" },
  update_property: {
    key: "propertyPhrase",
    idKey: "propertyId",
    label: "איזה נכס",
    kind: "property",
  },
  send_offer: {
    key: "buyerPhrase",
    idKey: "buyerId",
    label: "לאיזה לקוח לשלוח",
    kind: "buyer",
    // פעולה שיוצאת ללקוח — תמיד בחירה מפורשת, גם כשיש התאמה אחת
    alwaysChoose: true,
  },
};

const RECOMMENDED: Record<string, readonly string[]> = {
  create_lead: ["name", "phone"],
  create_buyer: ["name", "phone", "cities", "budgetMaxShekels"],
  create_property: ["city", "propertyType", "dealType", "rooms", "priceShekels"],
  schedule_appointment: ["startsAt"],
  create_task: ["title"],
};

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    dateStyle: "full",
    timeStyle: "short",
  }).format(date);
}

/** משפט אחד שאומר מה עומד לקרות — הכותרת של הכרטיס. */
function summarize(actionId: string, params: Record<string, unknown>): string {
  const name = typeof params["name"] === "string" ? params["name"] : undefined;
  const cities = Array.isArray(params["cities"]) ? (params["cities"] as string[]) : [];
  switch (actionId) {
    case "create_lead":
      return name ? `ליד חדש: ${name}` : "ליד חדש";
    case "create_buyer":
      return [name ?? "קונה חדש", cities.length > 0 ? `מחפש ב${cities.join(" / ")}` : null]
        .filter(Boolean)
        .join(" — ");
    case "create_property": {
      const city = typeof params["city"] === "string" ? params["city"] : null;
      const rooms = params["rooms"];
      return [rooms !== undefined ? `${String(rooms)} חדרים` : "נכס חדש", city]
        .filter(Boolean)
        .join(" ב");
    }
    case "create_task":
      return typeof params["title"] === "string" ? params["title"] : "תזכורת";
    case "search":
      return typeof params["query"] === "string" ? `חיפוש: ${params["query"]}` : "חיפוש";
    default:
      return "";
  }
}
