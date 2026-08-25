import { Injectable } from "@nestjs/common";
import {
  agentAction,
  agentFieldLabel,
  formatFieldValue,
  matchHistoryRef,
  normalizePhone,
  parseHebrewDateTime,
  PhoneSchema,
  resolvePlaces,
  type AgentCandidate,
  type AgentField,
  type AgentHistoryRef,
  type AgentProposal,
} from "@metavchim/shared";
import { BuyersService } from "../buyers/buyers.service";
import { SearchService } from "../search/search.service";
import { TasksService } from "../tasks/tasks.service";
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
    private readonly tasks: TasksService,
  ) {}

  async toProposal(
    transcript: string,
    interpretation: Interpretation,
    /**
     * מקור המועד, כשהוא אינו המשפט המלא: לצעד המשך יש `dateText`
     * משלו ("ביום שישי"), ופענוח המשפט המלא היה נותן לכל הצעדים את
     * אותו תאריך (ביקורת Codex). null = אל תפענח מועד כלל — צעד
     * שלא נאמר לו מועד לא יורש את זה של הצעד הראשי.
     */
    dateSource?: string | null,
    /**
     * ההפניות שהשיחה מכירה — התוויות שהסוכן נתן לרשומות בעדכונים
     * שהוא עצמו שלח. ריק בערוץ המסך: שם אין לסוכן יוזמה.
     */
    refs?: readonly AgentHistoryRef[],
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
        // ברכה/שאלה כללית — תשובה שיחתית במקום "לא הבנתי" יבש
        ...(interpretation.reply ? { reply: interpretation.reply } : {}),
        fallback: interpretation.fallback,
      };
    }

    const params = { ...interpretation.params };
    const warnings: string[] = [];
    const resolvedKeys = new Set<string>();

    await this.resolveCities(params, warnings, resolvedKeys);
    this.resolvePhones(params, warnings, resolvedKeys);
    if (dateSource !== null) {
      /*
       * ‎`dateSource` מוגדר ⟸ צעד המשך, ולו מקור משלו בלבד.
       * ‎`undefined` ⟸ הפעולה הראשית: קודם מילות המועד שהמודל שמע,
       * ואחריהן המשפט המלא כרשת ביטחון.
       */
      this.resolveDates(
        action.id,
        dateSource === undefined ? [interpretation.dateText, transcript] : [dateSource],
        params,
        resolvedKeys,
      );
    }
    this.applyKindDefault(action.id, transcript, params, resolvedKeys);

    const { candidates, chosen, warning } = await this.resolveEntity(action.id, params, refs);
    if (warning !== undefined) warnings.push(warning);

    for (const key of interpretation.rejected) {
      warnings.push(`לא הצלחתי לקרוא את הערך של „${agentFieldLabel(action.id, key)}”`);
    }
    for (const item of interpretation.unmapped) {
      warnings.push(`נאמר ולא שויך לשדה: ${item}`);
    }

    const fields = this.toFields(action.id, params, interpretation, resolvedKeys);
    /*
     * התאמה יחידה שנבחרה אוטומטית **מוצגת** בכרטיס, ולא רק נכנסת
     * לפרמטרים. "תוסיף הערה למשה כהן" שנפתר בשקט למזהה הציג כרטיס
     * שלא אומר אצל מי ההערה תיכתב — והמתווך אישר פעולה עיוורת
     * (דיווח המשתמש). ההצגה כשדה שנפתר, כמו תאריך.
     */
    if (chosen) fields.push(chosen);

    /*
     * צעדי המשך נפתרים כל אחד כהצעה מלאה — אותם תאריכים, טלפונים
     * וערים. ביטוי שמפנה למי שייווצר רק בצעד קודם לא יימצא כאן,
     * וזה בסדר: הפתרון הסופי שלו קורה בזמן הביצוע, אחרי שהרשומה
     * כבר קיימת (ראו AgentExecuteService).
     */
    const followUps: AgentProposal[] = [];
    for (const step of interpretation.steps) {
      const sub = await this.toProposal(
        transcript,
        {
          actionId: step.actionId,
          params: step.params,
          evidence: {},
          unmapped: [],
          rejected: step.rejected,
          fallback: interpretation.fallback,
          steps: [],
        },
        // המועד של הצעד — משלו בלבד; בלי dateText אין תאריך, לא ירושה
        step.dateText ?? null,
        refs,
      );
      /*
       * צעד המשך שדורש בחירה בין רשומות (כמה התאמות, או פעולת
       * alwaysChoose כמו שליחה ללקוח) אינו נכנס לשרשור: הבחירה לא
       * קיימת בכרטיס המשורשר, והצעד היה נכשל רק **אחרי** שהראשי כבר
       * בוצע (ביקורת Codex). הוא יורד עם אזהרה גלויה — לא בשקט.
       * רשימת מועמדים ריקה נשארת: כנראה הרשומה תיווצר בצעד קודם,
       * והפתרון קורה בזמן הביצוע.
       */
      if (sub.candidates !== undefined && sub.candidates.options.length > 0) {
        warnings.push(
          `„${sub.title}” דורשת בחירה בין רשומות ולכן לא נכללה באישור המשותף — הריצו אותה בנפרד`,
        );
        continue;
      }
      followUps.push(sub);
    }

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
      ...(followUps.length > 0 ? { followUps } : {}),
    };
  }

  /**
   * פתרון ביטוי ⟵ מזהה **בזמן הביצוע** — לצעדי המשך של שרשור.
   *
   * "תוסיף קונה משה ותקבע לו סיור": בזמן ההצעה משה עוד לא קיים,
   * ורק אחרי שהצעד הראשון בוצע יש את מי למצוא. התאמה יחידה נבחרת;
   * ריבוי או היעדר עוצרים עם הודעה ברורה — לא מנחשים. פעולות
   * שמסומנות alwaysChoose (שליחה ללקוח, חשיפה לרשת) לעולם אינן
   * נפתרות כאן אוטומטית — הבחירה המפורשת היא חלק מהפעולה.
   */
  async resolveForExecution(
    actionId: string,
    params: Record<string, unknown>,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const spec = ENTITY_LOOKUP[actionId];
    if (spec === undefined) return { ok: true };
    if (typeof params[spec.idKey] === "string") return { ok: true };
    const phrase = params[spec.key];
    if (typeof phrase !== "string" || phrase.trim().length < 2) return { ok: true };
    if (spec.alwaysChoose) {
      return {
        ok: false,
        message: `„${agentAction(actionId)?.title ?? actionId}” דורשת בחירה מפורשת — פתחו את הפעולה בנפרד ובחרו את הרשומה`,
      };
    }
    const options = await this.candidatesFor(spec.kind, phrase.trim());
    if (options.length === 1) {
      params[spec.idKey] = options[0]!.id;
      return { ok: true };
    }
    /*
     * ביטוי אופציונלי שלא נפתר אינו מפיל את הצעד. „תוסיף קונה משה
     * ותזכיר לי להתקשר אליו מחר” — אם „אליו” לא נפתר, התזכורת עדיין
     * צריכה להיווצר: אי-קישור אינו סיבה לאבד את התזכורת עצמה.
     */
    if (spec.optional) return { ok: true };
    if (options.length === 0) {
      return { ok: false, message: `לא נמצא „${phrase}” במאגר` };
    }
    return {
      ok: false,
      message: `נמצאו כמה רשומות ל„${phrase}” — פתחו את הפעולה בנפרד ובחרו ביניהן`,
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
   * המועד — **החישוב** תמיד מהמנוע שלנו, לעולם לא מהמודל.
   *
   * `timeExplicit=false` אומר שנאמר יום בלי שעה ונבחרה 10:00. זה
   * נאמר במפורש בכרטיס, כי „מחר” שהופך ל-10:00 בלי להודיע הוא
   * פגישה שנקבעה בשעה שאיש לא אמר.
   *
   * ## מה כן עבר למודל, ולמה
   *
   * עד כה גם **הזיהוי** היה כאן: המנוע סרק את המשפט המלא וחיפש בו
   * תבניות. כלומר דווקא בחלק שדורש הבנת שפה המודל הודר, וכל ניסוח
   * שהתבניות לא צפו נפל בשקט — „עוד שעה” בלי בי"ת, פיסוק שנדבק
   * למילה, „תתקשר עוד פעם בעוד שעה” שנעצר על „עוד פעם”. כל אחד
   * מהם היה ממצא אמיתי, וכל אחד דרש תבנית נוספת. זו מלחמת התשה
   * שאי אפשר לנצח בה, כי אין רשימה סופית של דרכים לומר „מחר”.
   *
   * עכשיו המודל מסמן **אילו מילים** הן המועד (`dateText`), והמנוע
   * מחשב מהן — לוח שנה ואזור זמן נשארים דטרמיניסטיים ובדיקים.
   *
   * המקורות נוסו לפי הסדר, והראשון שנפתר מנצח. המשפט המלא נשאר
   * אחרון: כשהמודל אינו זמין ומנוע החוקים הכריע, `dateText` אינו
   * קיים כלל — והנתיב הישן חייב להמשיך לעבוד.
   */
  private resolveDates(
    actionId: string,
    sources: readonly (string | undefined)[],
    params: Record<string, unknown>,
    resolved: Set<string>,
  ): void {
    const key = DATE_FIELD[actionId];
    if (key === undefined) return;
    // רגע אחד לכל המקורות: „עוד שעה” אינו אמור לזוז בין ניסיונות
    const now = new Date();
    for (const source of sources) {
      if (source === undefined || source.trim() === "") continue;
      const parsed = parseHebrewDateTime(source, now);
      if (!parsed.date) continue;
      params[key] = parsed.date.toISOString();
      params["__timeExplicit"] = parsed.timeExplicit;
      resolved.add(key);
      return;
    }
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
    refs?: readonly AgentHistoryRef[],
  ): Promise<{
    candidates?: AgentProposal["candidates"];
    chosen?: AgentField;
    warning?: string;
  }> {
    const spec = ENTITY_LOOKUP[actionId];
    if (spec === undefined) return {};
    const phrase = params[spec.key];
    /*
     * „תראה לי את הכרטיס המלא” — פעולה שמכוונת לרשומה קיימת, בלי
     * לומר לאיזו. עד כה זה החזיר `{}`: בלי מועמדים ובלי שדה חסר,
     * כלומר הצעה שנראית שלמה, והכישלון („לא נבחר כרטיס”) הגיע רק
     * אחרי האישור (ביקורת Codex).
     *
     * רשימה ריקה חוסמת את האישור במסך, וזה הכלל לכל פעולה
     * שמכוונת לרשומה — לא רק לשתי החדשות.
     *
     * `optional` הוא היוצא מן הכלל: „תזכיר לי מחר לקנות חלב” היא
     * תזכורת תקינה לחלוטין בלי שום כרטיס, וחסימה שם הייתה הופכת
     * את הפעולה השכיחה ביותר לבלתי אפשרית.
     */
    if (typeof phrase !== "string" || phrase.trim().length < 2) {
      if (spec.optional) return {};
      return {
        candidates: {
          key: spec.key,
          idKey: spec.idKey,
          label: spec.label,
          options: [],
          reason: "unsaid",
        },
      };
    }

    /*
     * ההפניה **לפני** החיפוש.
     *
     * „תזכיר לי להתקשר אליו” אחרי עדכון על שיחה שלא נענתה מגיע
     * מהמודל עם התווית שהפרומפט נתן לו (`⟪הליד מהעדכון⟫`). חיפוש
     * טקסט חופשי אחריה לעולם לא ימצא דבר — היא אינה שם של אף אחד
     * — ולכן הפתרון הוא כאן, מול מה שהסוכן עצמו זוכר ששלח.
     *
     * המזהה מגיע מהזיכרון של אותה שיחה בלבד, כלומר מרשומה שכבר
     * נשלחה למשתמש הזה. `alwaysChoose` נשאר מחוץ לזה: פעולה שיוצאת
     * ללקוח דורשת בחירה מפורשת גם כשההקשר ברור.
     */
    const ref = spec.alwaysChoose ? null : matchHistoryRef(refs, phrase);
    const refId = ref ? entityRefId(spec.kind, ref) : null;
    if (ref && refId) {
      params[spec.idKey] = refId;
      return {
        chosen: {
          key: spec.idKey,
          label: spec.label,
          value: refId,
          display: ref.label,
          source: "resolved",
        },
      };
    }

    const options = await this.candidatesFor(spec.kind, phrase.trim());

    if (options.length === 0) {
      /*
       * בפעולה אופציונלית ביטוי שלא נמצא אינו עוצר — הוא נאמר,
       * ולכן גם אינו נעלם בשקט. התזכורת נוצרת בלי קישור, והאזהרה
       * אומרת בדיוק את זה.
       */
      if (spec.optional) {
        return { warning: `„${phrase.trim()}” לא נמצא במאגר — ${spec.label} יישאר ריק` };
      }
      return {
        candidates: {
          key: spec.key,
          idKey: spec.idKey,
          label: spec.label,
          options: [],
          reason: "not_found",
        },
      };
    }
    if (options.length === 1 && !spec.alwaysChoose) {
      const match = options[0]!;
      params[spec.idKey] = match.id;
      return {
        chosen: {
          key: spec.idKey,
          label: spec.label,
          value: match.id,
          display: [match.label, match.detail].filter(Boolean).join(" — "),
          source: "resolved",
        },
      };
    }
    /*
     * כמה מועמדים בפעולה אופציונלית: אין למי להציג בחירה בלי לחסום
     * את הפעולה כולה, ולכן הקישור יורד — עם אזהרה. ניחוש בין
     * שניים היה קושר את התזכורת לכרטיס הלא נכון, וזה גרוע מלא
     * לקשור בכלל.
     */
    if (spec.optional) {
      return {
        warning: `„${phrase.trim()}” מתאים ליותר מכרטיס אחד — ${spec.label} יישאר ריק`,
      };
    }
    return { candidates: { key: spec.key, idKey: spec.idKey, label: spec.label, options } };
  }

  /** מועמדים לביטוי, לפי סוג הרשומה שהפעולה מדברת עליה. */
  private async candidatesFor(kind: LookupKind, phrase: string): Promise<AgentCandidate[]> {
    /*
     * משימות אינן בחיפוש הגלובלי — הן נמצאות לפי מילים מכותרת
     * המשימות הפתוחות. סגירה מדברת תמיד על משימה פתוחה, ולכן
     * ההיצע מצומצם מראש למה שאפשר בכלל לסגור.
     */
    if (kind === "task") {
      const needle = phrase.toLowerCase();
      return (await this.tasks.list({ status: "open" }))
        .filter((task) => task.title.toLowerCase().includes(needle))
        .slice(0, 8)
        .map((task) => ({
          id: task.id,
          label: task.title,
          ...(task.entityLabel ? { detail: task.entityLabel } : {}),
        }));
    }

    const results = await this.search.search(phrase);
    if (kind === "buyer") {
      return results.buyers.slice(0, 8).map((b) => ({
        id: b.id,
        label: b.name,
        ...(b.cities.length > 0 ? { detail: b.cities.join(" / ") } : {}),
      }));
    }
    if (kind === "lead") {
      return results.leads.slice(0, 8).map((l) => ({ id: l.id, label: l.name }));
    }
    if (kind === "card") {
      /*
       * "הכרטיס של שרה" יכול להיות קונה או ליד, וההכרעה היא של
       * המתווך — לכן שני הסוגים מוצעים יחד, והמזהה נושא את הסוג
       * (`buyer:.. / lead:..`) כדי שהביצוע יידע לאן ההערה הולכת.
       */
      return [
        ...results.buyers.slice(0, 5).map((b) => ({
          id: `buyer:${b.id}`,
          label: b.name,
          detail: b.cities.length > 0 ? `קונה — ${b.cities.join(" / ")}` : "קונה",
        })),
        ...results.leads.slice(0, 5).map((l) => ({
          id: `lead:${l.id}`,
          label: l.name,
          detail: "ליד",
        })),
      ];
    }
    return results.properties.slice(0, 8).map((p) => ({
      id: p.id,
      label:
        p.marketingTitle ??
        [p.street, p.neighborhood, p.city].filter(Boolean).join(", ") ??
        p.id,
      ...(p.city ? { detail: p.city } : {}),
    }));
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
  // "מה יש לי ביומן מחר" — היום שנשאל עליו
  show_schedule: "day",
};

type LookupKind = "buyer" | "property" | "lead" | "task" | "card";

/**
 * צורת המזהה שהפעולה מצפה לה, לפי סוג החיפוש.
 *
 * `card` מקבץ קונים ולידים תחת ביטוי אחד, ולכן המזהה שלו נושא גם
 * את הסוג (`lead:01J…`) — הביצוע צריך לדעת לאן ההערה הולכת. שאר
 * הסוגים מקבלים מזהה חשוף. `null` = ההפניה אינה מתאימה לפעולה
 * הזו (למשל נכס בפעולה שמדברת על קונה), וההחלטה חוזרת לחיפוש.
 */
function entityRefId(kind: LookupKind, ref: AgentHistoryRef): string | null {
  if (kind === "card") {
    return ref.entityType === "buyer" || ref.entityType === "lead"
      ? `${ref.entityType}:${ref.entityId}`
      : null;
  }
  return kind === ref.entityType ? ref.entityId : null;
}

const ENTITY_LOOKUP: Record<
  string,
  {
    key: string;
    idKey: string;
    label: string;
    kind: LookupKind;
    alwaysChoose?: boolean;
    /**
     * הביטוי משפר את הפעולה ואינו תנאי לה. חסר, לא נמצא, או מתאים
     * לכמה — הפעולה ממשיכה בלי קישור, עם אזהרה גלויה.
     */
    optional?: boolean;
  }
> = {
  update_buyer: { key: "buyerPhrase", idKey: "buyerId", label: "איזה קונה", kind: "buyer" },
  update_property: {
    key: "propertyPhrase",
    idKey: "propertyId",
    label: "איזה נכס",
    kind: "property",
  },
  complete_task: { key: "taskPhrase", idKey: "taskId", label: "איזו משימה", kind: "task" },
  /*
   * „קשור ל” היה שדה מת: המודל התבקש למלא אותו, הוא הוצג בכרטיס,
   * ואיש לא קרא אותו — התזכורת נוצרה תמיד בלי שיוך. כאן הוא הופך
   * לקישור אמיתי, וזה גם מה שנותן ל„תזכיר לי להתקשר אליו” לאן
   * להצביע.
   */
  create_task: {
    key: "relatedPhrase",
    idKey: "relatedId",
    label: "קשור ל",
    kind: "card",
    optional: true,
  },
  add_note: { key: "cardPhrase", idKey: "cardId", label: "לאיזה כרטיס", kind: "card" },
  show_card: { key: "cardPhrase", idKey: "cardId", label: "איזה כרטיס", kind: "card" },
  play_recording: { key: "cardPhrase", idKey: "cardId", label: "שיחה עם מי", kind: "card" },
  update_lead_status: { key: "leadPhrase", idKey: "leadId", label: "איזה ליד", kind: "lead" },
  share_property: {
    key: "propertyPhrase",
    idKey: "propertyId",
    label: "איזה נכס לשתף",
    kind: "property",
    // חשיפה לרשת בין-משרדית — בחירה מפורשת תמיד, כמו שליחה ללקוח
    alwaysChoose: true,
  },
  share_buyer: {
    key: "buyerPhrase",
    idKey: "buyerId",
    label: "איזה קונה לשתף",
    kind: "buyer",
    alwaysChoose: true,
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
  /*
   * בפעולות שמכוונות לרשומה קיימת, הביטוי המזהה הוא ההשלמה החשובה
   * ביותר: בלעדיו הביצוע ייכשל ב"לא נבחר…" רק אחרי האישור. עדיף
   * שהכרטיס יאמר מראש מה חסר.
   */
  add_note: ["cardPhrase", "note"],
  update_lead_status: ["leadPhrase", "leadStatus"],
  update_buyer: ["buyerPhrase"],
  update_property: ["propertyPhrase"],
  complete_task: ["taskPhrase"],
  send_offer: ["buyerPhrase", "propertyPhrase"],
  share_property: ["propertyPhrase"],
  share_buyer: ["buyerPhrase"],
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
    case "add_note":
      return typeof params["cardPhrase"] === "string"
        ? `הערה אצל ${params["cardPhrase"]}`
        : "הוספת הערה";
    case "update_lead_status":
      return typeof params["leadPhrase"] === "string"
        ? `עדכון הליד של ${params["leadPhrase"]}`
        : "עדכון סטטוס ליד";
    case "complete_task":
      return typeof params["taskPhrase"] === "string"
        ? `סגירת המשימה „${params["taskPhrase"]}”`
        : "סגירת משימה";
    case "search":
      return typeof params["query"] === "string" ? `חיפוש: ${params["query"]}` : "חיפוש";
    default:
      return "";
  }
}
