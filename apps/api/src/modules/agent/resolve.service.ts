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
import { TenantContext } from "../../common/tenant-context";
import { BuyersService } from "../buyers/buyers.service";
import { CollaborationService } from "../collaboration/collaboration.service";
import { DealRoomService } from "../collaboration/deal-room.service";
import { ListingsService } from "../collaboration/listings.service";
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
    private readonly collaboration: CollaborationService,
    private readonly listings: ListingsService,
    private readonly dealRooms: DealRoomService,
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
      const suggestions = interpretation.suggest.flatMap((id) => {
        const suggested = agentAction(id);
        if (suggested === undefined) return [];
        const example = suggested.examples[0];
        return [
          {
            actionId: suggested.id,
            title: suggested.title,
            ...(example === undefined ? {} : { example }),
          },
        ];
      });
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
        /*
         * ‎**הטקסט מהקטלוג, המזהה מהמודל.**
         *
         * המודל בחר מזהים; הכותרת והדוגמה שהמתווך יקרא הן אלה שכבר
         * נכתבו ונבדקו בקטלוג. כך „אולי התכוונת” אינו משטח שדרכו
         * טקסט של מודל מגיע למסך, ומזהה שאינו בקטלוג פשוט יורד.
         */
        ...(suggestions.length > 0 ? { suggestions } : {}),
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
       *
       * ‎`undefined` ⟸ הפעולה הראשית, ואז **מי שקרא את המשפט הוא
       * שמכריע.** כשהמודל רץ, `dateText` הוא התשובה שלו — גם
       * כשהיא ריקה. „תזכיר לי לשאול אם הפגישה ביום שלישי בוטלה”
       * הוא בדיוק המקרה: המודל צדק כשלא מסר מועד, כי „ביום שלישי”
       * מתאר את הפגישה ולא את התזכורת. סריקת המשפט המלא כרשת
       * ביטחון דרסה את השיקול הזה וקבעה יום שלישי (ביקורת Codex).
       *
       * זו הייתה סתירה בלב השינוי עצמו: הזיהוי עבר למודל, והרשת
       * שהושארה מתחתיו היא בדיוק זיהוי הכללים שהוא בא להחליף. לכן
       * המשפט המלא נסרק רק כשהמודל לא רץ כלל — שם אין הכרעה לכבד.
       *
       * גם `dateText` שאין ממנו תאריך („בקרוב”) אינו מזמין סריקה:
       * המודל כבר אמר אילו מילים הן המועד, וסריקה הייתה אוספת
       * דווקא את אלה שהוא הוציא. שדה ריק שהמתווך ממלא הוא הכישלון
       * הבטוח; תאריך שגוי שנראה כהחלטה הוא המסוכן.
       */
      this.resolveDates(
        action.id,
        dateSource === undefined
          ? [interpretation.fallback ? transcript : interpretation.dateText]
          : [dateSource],
        params,
        resolvedKeys,
      );
    }
    this.applyKindDefault(action.id, transcript, params, resolvedKeys);

    const { candidates, chosen, warning } = await this.resolveEntity(action.id, params, refs);
    if (warning !== undefined) warnings.push(warning);
    const second = await this.resolveSecondEntity(action.id, params);
    if (second.warning !== undefined) warnings.push(second.warning);

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
    if (second.chosen) fields.push(second.chosen);

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
          // „אולי התכוונת” שייך ל„לא הבנתי” — לצעד המשך יש פעולה
          suggest: [],
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
    const primary = await this.resolveOneForExecution(actionId, spec, params);
    if (!primary.ok) return primary;
    /*
     * ‎**הרשומה השנייה נפתרת גם כאן, ולא רק במסלול ההצעה.**
     *
     * המסלול הזה הכיר `spec` בלבד, ולכן „תוסיף קונה משה ותראה מה
     * מתאים לו” היה מבצע את הצעד השני בלי הקונה — כלומר מחזיר את
     * ההתאמות של כל המשרד על שאלה ששמה שם. אותו פער בדיוק היה מוריד
     * את הנכס מ„קבע לו סיור בדירה ברמת גן”.
     *
     * ‎**ו-`optional` אינו נכפה.** הניסוח הראשון כפה אותו, ואז
     * ‎`assign_task` ו-`dismiss_match` — ששתיהן חסרות משמעות בלי
     * הרשומה השנייה — היו „מצליחות” בפתרון וממשיכות לביצוע בלי
     * ‎`assigneeId` או `propertyId`, כלומר נכשלות רק **אחרי** שהמתווך
     * אישר (ביקורת Codex). כל רשומה שנייה מצהירה בעצמה אם היא רשות.
     */
    if (spec.also !== undefined) {
      const second = await this.resolveOneForExecution(actionId, spec.also, params);
      if (!second.ok) return second;
    }
    return { ok: true };
  }

  private async resolveOneForExecution(
    actionId: string,
    spec: LookupSpec,
    params: Record<string, unknown>,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
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
      if (spec.optional || spec.optionalIfUnsaid) return {};
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

  /**
   * הרשומה **השנייה** של הפעולה — בלי בורר.
   *
   * המסך מציג בורר אחד (`AgentProposal.candidates`), ולכן השנייה
   * נפתרת רק כשהיא חד-משמעית: התאמה יחידה נכנסת לפרמטרים ומוצגת
   * כשדה שנפתר, וכל מצב אחר — לא נאמר, לא נמצא, מתאים לכמה — משאיר
   * את המזהה ריק ואומר זאת באזהרה.
   *
   * ‎**היא אינה חוסמת את האישור.** מה שקורה בלעדיה נקבע בביצוע, כי
   * שם ההבדל אמיתי: `send_offer` מתכווץ לניווט לכרטיס הקונה, ואילו
   * `send_agreement` נעצר — הזמנה בכתב שנוצרת בלי נכס אינה מתארת
   * נכס, אינה פותחת שום הצעה, ומשאירה קישור חתימה שאין ממנו תועלת.
   *
   * ‎`alwaysChoose` של הרשומה הראשית אינו חל כאן: הבחירה המפורשת
   * נוגעת ל**נמען** — מי מקבל את הקישור — ולא לנכס שהמסמך מתאר.
   */
  private async resolveSecondEntity(
    actionId: string,
    params: Record<string, unknown>,
  ): Promise<{ chosen?: AgentField; warning?: string }> {
    const spec = ENTITY_LOOKUP[actionId]?.also;
    if (spec === undefined) return {};
    // כבר נבחר במסך (סבב שני של אותה הצעה) — אין מה לפתור
    if (typeof params[spec.idKey] === "string") return {};

    const phrase = params[spec.key];
    if (typeof phrase !== "string" || phrase.trim().length < 2) {
      // לא נאמר כלל. הביצוע יאמר מה חסר; אזהרה כאן הייתה רעש על
      // משפט תקין לגמרי שפשוט לא הזכיר נכס
      return {};
    }

    const options = await this.candidatesFor(spec.kind, phrase.trim());
    if (options.length === 1) {
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
    if (options.length === 0) {
      return { warning: `„${phrase.trim()}” לא נמצא במאגר — ${spec.label} נשאר ריק` };
    }
    return {
      warning: `„${phrase.trim()}” מתאים ליותר מרשומה אחת — ${spec.label} נשאר ריק`,
    };
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

    /*
     * ‎**סוכן — מרשימת המשרד, לא מהחיפוש.** ההשוואה מכילה ובלי
     * תלות ברישיות, בדיוק כמו במשימות: „דנה” צריך למצוא את „דנה
     * לוי”, וזו הצורה היחידה שבה שם נאמר בדיבור.
     */
    if (kind === "user") {
      const needle = phrase.toLowerCase();
      return (await this.tasks.assignees())
        .filter((user) => user.name.toLowerCase().includes(needle))
        .slice(0, 8)
        .map((user) => ({ id: user.id, label: user.name }));
    }

    /*
     * ‎**פניות נכנסות מהרשת** — ההיצע הוא רק מה שממתין לתשובה:
     * אישור מדבר תמיד על פנייה פתוחה, כמו שסגירת משימה מדברת על
     * משימה פתוחה. שני הכיוונים יחד — נכס שהוצע לביקוש שלי,
     * ומשרד שמתעניין בנכס שלי — והמזהה נושא את הסוג, כמו בכרטיס.
     *
     * כשהביטוי לא מתאים לאף פנייה מוצגות **כולן**: יש לכל היותר
     * קומץ פניות ממתינות, ובורר מלא עדיף על „לא נמצא” שמסתיר
     * בדיוק את מה שהמתווך מנסה לאשר.
     */
    /*
     * ‎**פיד הרשת — ההיצע הוא הפיד עצמו, לא חיפוש טקסט במאגר.**
     *
     * ביקוש ומודעה של משרד אחר אינם רשומות שלנו: אין להם שם, יש
     * להם תיאור. ההתאמה נעשית מול הטקסט שהמתווך רואה בפיד (עיר,
     * כותרת, שם המשרד), ומה שלא נתפס בביטוי מציג את הפיד כולו —
     * בורר עדיף על „לא נמצא” כשהרשימה קצרה ממילא.
     */
    if (kind === "demand") {
      const feed = await this.collaboration.listDemands();
      const options = feed
        .filter((row) => row.mine !== true)
        .map((row) => ({
          id: row.id,
          label:
            [row.cities.join(" / "), roomsLabel(row.roomsMin, row.roomsMax)]
              .filter((part) => part !== "")
              .join(" · ") || "ביקוש ברשת",
          detail: row.officeName ?? "משרד ברשת",
        }));
      return narrowByPhrase(options, phrase);
    }
    if (kind === "listing") {
      // המודעות שלי יורדות — אי אפשר להביע עניין בנכס של המשרד עצמו
      const feed = (await this.listings.list()).filter((row) => row.mine !== true);
      const options = feed.map((row) => ({
        id: row.id,
        label:
          row.title ??
          [row.propertyType, row.neighborhood, row.city].filter(Boolean).join(", ") ??
          "נכס ברשת",
        detail: [row.city, roomsLabel(row.rooms, row.rooms)].filter(Boolean).join(" · "),
      }));
      return narrowByPhrase(options, phrase);
    }
    if (kind === "deal") {
      const deals = await this.dealRooms.list();
      const options = deals.map((deal) => ({
        id: deal.id,
        label: deal.title,
        detail: `מול ${deal.counterpartOffice}`,
      }));
      return narrowByPhrase(options, phrase);
    }

    if (kind === "approach") {
      return narrowByPhrase(await this.pendingApproaches(), phrase);
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
    if (kind === "anyCard") {
      /*
       * ‎**„מה יש על הדירה ברמת גן” — השאלה שחסרה.**
       *
       * הכרטיס היה קונה או ליד בלבד, כלומר חצי מהמערכת לא נשאלה
       * דרך הסוכן. הנכס נוסף כאן ולא ב-`card`, ראו ההערה על
       * ‎`LookupKind`.
       */
      return [
        ...results.buyers.slice(0, 4).map((b) => ({
          id: `buyer:${b.id}`,
          label: b.name,
          detail: b.cities.length > 0 ? `קונה — ${b.cities.join(" / ")}` : "קונה",
        })),
        ...results.leads.slice(0, 4).map((l) => ({
          id: `lead:${l.id}`,
          label: l.name,
          detail: "ליד",
        })),
        ...results.properties.slice(0, 4).map((p) => ({
          id: `property:${p.id}`,
          label:
            p.marketingTitle ?? [p.street, p.neighborhood, p.city].filter(Boolean).join(", ") ?? p.id,
          detail: p.city ? `נכס — ${p.city}` : "נכס",
        })),
      ];
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

  /**
   * ‎**הפניות הממתינות מהרשת — הרשימה האחת.** גם הבורר של „פתח
   * חדר עסקה” וגם „מה מחכה לי מהרשת” קוראים מכאן: שתי גזירות של
   * אותה רשימה היו נפרדות בשקט. ההיצע מסונן לפי ההרשאות, והמזהה
   * נושא את הסוג (`offer:` / `interest:`) כי שני הכיוונים הם שתי
   * טבלאות.
   */
  async pendingApproaches(): Promise<AgentCandidate[]> {
    const caps = TenantContext.current().capabilities;
    const [offers, interests] = await Promise.all([
      caps.has("collaboration.offer") ? this.collaboration.listCoopOffers() : [],
      caps.has("collaboration.share") ? this.listings.listInterests() : [],
    ]);
    return [
      ...offers
        .filter((offer) => offer.direction === "incoming" && offer.status === "sent")
        .map((offer) => {
          const title = offer.presentation["title"];
          return {
            id: `offer:${offer.id}`,
            label: typeof title === "string" && title !== "" ? title : "נכס שהוצע לכם",
            detail: [
              "הצעת נכס",
              offer.officeName,
              offer.buyerName === undefined ? undefined : `לקונה ${offer.buyerName}`,
            ]
              .filter(Boolean)
              .join(" · "),
          };
        }),
      ...interests
        .filter((interest) => interest.status === "sent")
        .map((interest) => ({
          id: `interest:${interest.id}`,
          label: interest.propertyTitle ?? "הנכס שפורסם",
          detail: ["התעניינות בנכס", interest.officeName].filter(Boolean).join(" · "),
        })),
    ];
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
  // „אתמול בארבע” — מתי השיחה התקיימה; בלי מועד, עכשיו
  log_call: "occurredAt",
  // המועד **החדש** — המשימה עצמה נבחרת לפי הכותרת
  update_task: "dueAt",
  schedule_appointment: "startsAt",
  // המועד **החדש** — הפגישה עצמה נבחרת לפי הלקוח, לא לפי תאריך
  reschedule_appointment: "startsAt",
  create_property: "entryDate",
  // „מהיום” כברירת מחדל; „מהראשון לחודש” נתפס כאן
  start_exclusivity: "startsAt",
  update_property: "entryDate",
  create_buyer: "entryBy",
  update_buyer: "entryBy",
  // "מה יש לי ביומן מחר" — היום שנשאל עליו
  show_schedule: "day",
};

/*
 * ‎`anyCard` ולא הרחבה של `card` — וזו ההבחנה שמונעת נזק.
 *
 * ‎`card` משותף ל-`show_card`, `add_note` ו-`play_recording`.
 * הוספת נכסים אליו הייתה נותנת ל„תוסיף הערה” לכוון לנכס (הערה על
 * נכס היא `internalNotes`, מסלול אחר לגמרי) ול„תשמיע לי” לכוון
 * לישות שאין לה שיחות בכלל. הרחבה של מפתח משותף היא בדיוק סוג
 * השינוי שנראה קטן ופוגע בשני מקומות אחרים.
 */
/*
 * ‎`user` הוא הסוכן שבמשרד, לא לקוח. הוא נפתר מרשימת המשתמשים
 * הפעילים (`TasksService.assignees`) ולא מהחיפוש הגלובלי — חיפוש
 * טקסט מוצא לקוחות, ו„דנה” כשם סוכנת וכשם קונה הם שתי רשומות שונות
 * לגמרי. שתיהן היו מוחזרות מאותה שאילתה, והבחירה בין „דנה הסוכנת”
 * ל„דנה הקונה” הייתה נופלת על סדר התוצאות.
 */
type LookupKind =
  | "buyer"
  | "property"
  | "lead"
  | "task"
  | "card"
  | "anyCard"
  | "user"
  | "approach"
  | "demand"
  | "listing"
  | "deal";

/**
 * צורת המזהה שהפעולה מצפה לה, לפי סוג החיפוש.
 *
 * `card` מקבץ קונים ולידים תחת ביטוי אחד, ולכן המזהה שלו נושא גם
 * את הסוג (`lead:01J…`) — הביצוע צריך לדעת לאן ההערה הולכת. שאר
 * הסוגים מקבלים מזהה חשוף. `null` = ההפניה אינה מתאימה לפעולה
 * הזו (למשל נכס בפעולה שמדברת על קונה), וההחלטה חוזרת לחיפוש.
 */
function entityRefId(kind: LookupKind, ref: AgentHistoryRef): string | null {
  if (kind === "card" || kind === "anyCard") {
    /*
     * ‎**ההפניה מההיסטוריה חייבת לעבור גם ב-`anyCard`.**
     *
     * בלי הענף הזה „תראה לי את הכרטיס שלו” אחרי תוצאה קודמת היה
     * נופל לחיפוש מחדש, כי `anyCard` לא היה שווה לשום `entityType`.
     * ‎`anyCard` מקבל גם נכס — וזו כל הנקודה שלו.
     */
    const allowed =
      kind === "anyCard"
        ? ["buyer", "lead", "property"]
        : ["buyer", "lead"];
    return allowed.includes(ref.entityType) ? `${ref.entityType}:${ref.entityId}` : null;
  }
  return kind === ref.entityType ? ref.entityId : null;
}

/**
 * ‎**בורר על פיד, לא על מאגר.** רשומות של משרד אחר אינן נמצאות
 * בחיפוש שלנו — הן מגיעות כרשימה קצרה, וההתאמה היא מול הטקסט
 * שהמתווך רואה. ביטוי שלא תפס אף שורה מציג את הרשימה כולה: בורר
 * מלא עדיף על „לא נמצא” כשיש קומץ אפשרויות ממילא.
 */
function narrowByPhrase(
  options: readonly AgentCandidate[],
  phrase: string,
): AgentCandidate[] {
  const needle = phrase.trim().toLowerCase();
  const matched = options.filter((option) =>
    `${option.label} ${option.detail ?? ""}`.toLowerCase().includes(needle),
  );
  return (matched.length > 0 ? matched : [...options]).slice(0, 9);
}

/** „3–4 חדרים” / „4 חדרים” — ריק כשאין טווח. */
function roomsLabel(min: number | undefined, max: number | undefined): string {
  if (min === undefined && max === undefined) return "";
  if (min !== undefined && max !== undefined && min !== max) return `${min}–${max} חדרים`;
  return `${min ?? max} חדרים`;
}

interface LookupSpec {
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
  /**
   * ‎**רשות רק כשלא נאמר.** ביטוי שלא נאמר כלל אינו חוסם — יש
   * מפתח אחר לרשומה. אבל ביטוי **שנאמר** חייב להיפתר: לא נמצא או
   * מתאים לכמה ⟵ בורר/עצירה, לא השמטה שקטה. ההבדל מ-`optional`
   * הוא בדיוק זה — פעולה שמשנה רשומה קיימת אסור שתבחר אותה לפי
   * מה שנשאר אחרי שהמפתח שנאמר הושלך (ביקורת Codex).
   */
  optionalIfUnsaid?: boolean;
}

const ENTITY_LOOKUP: Record<
  string,
  LookupSpec & {
    /**
     * ‎**רשומה שנייה שהפעולה מדברת עליה.**
     *
     * „שלח את הדירה ברמת גן למשה כהן” נושא שתי רשומות, לא אחת.
     * ‎`AgentProposal.candidates` הוא יחיד — המסך מציג בורר אחד —
     * ולכן השנייה נפתרת בלי בורר: התאמה יחידה נבחרת ומוצגת כשדה,
     * וכל מצב אחר יורד עם אזהרה.
     *
     * זו אינה הרחבה תיאורטית: `sendOffer` קרא `params.propertyId`
     * שאף אחד לא כתב אליו אי פעם, ולכן ניווט **תמיד** לכרטיס הקונה
     * גם כשנאמר נכס מפורש. השדה היה מת מהיום הראשון.
     *
     * מה שקורה כשהיא לא נפתרה נקבע בביצוע ולא כאן: ב-`send_offer`
     * הניווט מתכווץ לכרטיס הקונה, וב-`send_agreement` הפעולה
     * נעצרת — הזמנה בכתב בלי נכס אינה פותחת שום הצעה.
     */
    also?: LookupSpec;
  }
> = {
  /*
   * ‎**„מה מתאים למשה כהן” החזיר את ההתאמות של כל המשרד.**
   *
   * ‎`showMatches` קורא `params.propertyId` ו-`params.buyerId`, שני
   * הביטויים מוצהרים בקטלוג, ולא היה מי שיתרגם ביניהם — ולכן כל
   * שאילתת התאמות **על רשומה מסוימת** נפלה לרשימה הכללית. הסוכן ענה
   * תשובה מלאה ומנומקת על שאלה אחרת מזו שנשאלה, וזה גרוע יותר
   * מ„לא מצאתי”.
   *
   * ‎**נכס ראשי וקונה משני** לפי הסדר שבו `showMatches` בודק, ושניהם
   * רשות: „מה ההתאמות” בלי שם היא שאלה תקינה, וזו הרשימה הכללית.
   */
  show_matches: {
    key: "propertyPhrase",
    idKey: "propertyId",
    label: "איזה נכס",
    kind: "property",
    optional: true,
    // „מה ההתאמות” בלי שם היא שאלה תקינה — הרשימה הכללית
    also: { key: "buyerPhrase", idKey: "buyerId", label: "איזה קונה", kind: "buyer", optional: true },
  },
  update_buyer: { key: "buyerPhrase", idKey: "buyerId", label: "איזה קונה", kind: "buyer" },
  update_property: {
    key: "propertyPhrase",
    idKey: "propertyId",
    label: "איזה נכס",
    kind: "property",
  },
  /*
   * ‎**רשות, ובכוונה.** „מה המצב עם הבלעדיות” בלי שם נכס היא השאלה
   * השכיחה יותר — כל מה שבסיכון במשרד, לפי דחיפות. דרישת נכס
   * הייתה הופכת את השאלה הזו לשאלת הבהרה על משהו שאין לו תשובה
   * יחידה.
   */
  show_exclusivity: {
    key: "propertyPhrase",
    idKey: "propertyId",
    label: "איזה נכס",
    kind: "property",
    optional: true,
  },
  /*
   * וכאן **חובה**: פעולת שיווק נרשמת על נכס מסוים, והיא הראיה
   * שמאריכה את הבלעדיות שלו. רישום על הנכס הלא נכון הוא ראיה
   * שנרשמה במקום שאינה מגינה עליו.
   */
  log_marketing_action: {
    key: "propertyPhrase",
    idKey: "propertyId",
    label: "על איזה נכס",
    kind: "property",
  },
  /*
   * ‎**הפגישה הייתה נקבעת ריקה — עם אף אחד ועל שום נכס.**
   *
   * הקטלוג מצהיר על `buyerPhrase` ועל `propertyPhrase` בפעולה הזו,
   * ‎`createAppointment` קורא `params.buyerId` ו-`params.propertyId`,
   * ולא הייתה כאן רשומה שתתרגם ביניהם. כלומר „קבע סיור מחר בעשר
   * בדירה ברמת גן עם משפחת לוי” יצר אירוע ביומן שאינו קשור ללקוח
   * ואינו קשור לנכס — בדיוק אותו שדה מת שתועד למעלה על `sendOffer`,
   * ובפעולה השכיחה ביותר בסוכן.
   *
   * ‎**`card` ולא `buyer`,** כי פגישה ראשונה היא כמעט תמיד עם ליד.
   * ‎`Appointment.leadId` קיים במודל והיומן כבר יודע לקשר אליו —
   * חיפוש בקונים בלבד היה מחמיץ בדיוק את מי שנקבעת איתו הפגישה
   * הראשונה (ביקורת Codex על צעד ההמשך שאחרי „ליד חדש”).
   *
   * ‎**רשות**: „פגישה מחר בעשר” בלי שם היא פגישה תקינה. חסימה כאן
   * הייתה הופכת את הפעולה השכיחה לשאלת הבהרה.
   */
  schedule_appointment: {
    key: "buyerPhrase",
    idKey: "cardId",
    label: "עם מי",
    kind: "card",
    optional: true,
    also: { key: "propertyPhrase", idKey: "propertyId", label: "איזה נכס", kind: "property" },
  },
  /*
   * דחייה ועדכון פגישה — הפגישה מזוהה לפי הלקוח **או** לפי הנכס
   * („תזיז את הסיור בדירה ברמת גן”). הלקוח הוא רשות רק כשלא נאמר
   * (`optionalIfUnsaid`): שם שנאמר ולא נפתר פותח בורר או נעצר, כי
   * השמטה שקטה הייתה מזיזה את הפגישה של הלקוח הלא נכון לפי הנכס
   * שנשאר. הנכס שנאמר ולא נפתר נעצר בביצוע — ראו `appointmentOf`.
   * הפגישה עצמה נבחרת בביצוע לפי הכיוון בזמן.
   */
  reschedule_appointment: {
    key: "buyerPhrase",
    idKey: "cardId",
    label: "עם מי הפגישה",
    kind: "card",
    optionalIfUnsaid: true,
    also: {
      key: "propertyPhrase",
      idKey: "propertyId",
      label: "איזה נכס",
      kind: "property",
      optional: true,
    },
  },
  update_appointment: {
    key: "buyerPhrase",
    idKey: "cardId",
    label: "עם מי הפגישה",
    kind: "card",
    optionalIfUnsaid: true,
    also: {
      key: "propertyPhrase",
      idKey: "propertyId",
      label: "איזה נכס",
      kind: "property",
      optional: true,
    },
  },
  /*
   * הודעת וואטסאפ ללקוח — קונה או ליד, ובחירה מפורשת תמיד: הודעה
   * יוצאת מהמשרד לאדם אמיתי, כמו מייל, הצעה והסכם.
   */
  send_message: {
    key: "buyerPhrase",
    idKey: "cardId",
    label: "לאיזה לקוח לשלוח",
    kind: "card",
    alwaysChoose: true,
  },
  /*
   * הודעה לבעל נכס — הנכס נבחר במפורש תמיד, כי הנמען נגזר ממנו:
   * בחירת הנכס היא בחירת האדם שההודעה תגיע אליו.
   */
  message_owner: {
    key: "propertyPhrase",
    idKey: "propertyId",
    label: "על איזה נכס",
    kind: "property",
    alwaysChoose: true,
  },
  /*
   * פתיחת חדר עסקה — אישור פנייה נכנסת. הפנייה נבחרת במפורש תמיד:
   * האישור מודיע למשרד השני ומחבר בין המשרדים, ואסור שיקרה על
   * „ההתאמה היחידה” בלי שהמתווך ראה על מה הוא מאשר.
   */
  /*
   * חיוג וטופס פרטים — יוצאים אל אדם אמיתי, ולכן הנמען נבחר
   * במפורש תמיד, כמו בהודעה ובהצעה.
   */
  call_contact: {
    key: "buyerPhrase",
    idKey: "cardId",
    label: "למי לחייג",
    kind: "card",
    alwaysChoose: true,
  },
  // תיעוד שיחה והוספת פרט קשר — על כרטיס קיים, קונה או ליד
  log_call: { key: "buyerPhrase", idKey: "cardId", label: "עם מי השיחה", kind: "card" },
  add_contact_detail: {
    key: "buyerPhrase",
    idKey: "cardId",
    label: "לאיזה כרטיס",
    kind: "card",
  },
  // עדכון שיווקי — יוצא לבעל הנכס, ולכן הנכס נבחר במפורש
  send_owner_update: {
    key: "propertyPhrase",
    idKey: "propertyId",
    label: "על איזה נכס",
    kind: "property",
    alwaysChoose: true,
  },
  send_intake_form: {
    key: "buyerPhrase",
    idKey: "cardId",
    label: "לאיזה לקוח",
    kind: "card",
    alwaysChoose: true,
  },
  /*
   * הצד היוצר של הרשת. הרשומה של הצד השני נבחרת במפורש תמיד —
   * הצעה או פנייה יוצאת ממני אל משרד אחר, ואסור שתלך אל „ההתאמה
   * היחידה” שאיש לא ראה.
   */
  offer_to_demand: {
    key: "demandPhrase",
    idKey: "demandId",
    label: "לאיזה ביקוש",
    kind: "demand",
    alwaysChoose: true,
    also: { key: "propertyPhrase", idKey: "propertyId", label: "איזה נכס להציע", kind: "property" },
  },
  express_interest: {
    key: "listingPhrase",
    idKey: "listingId",
    label: "איזה נכס ברשת",
    kind: "listing",
    alwaysChoose: true,
    also: { key: "buyerPhrase", idKey: "buyerId", label: "בשביל איזה קונה", kind: "buyer" },
  },
  post_deal_message: {
    key: "dealPhrase",
    idKey: "dealId",
    label: "באיזו עסקה",
    kind: "deal",
    alwaysChoose: true,
  },
  move_deal_stage: {
    key: "dealPhrase",
    idKey: "dealId",
    label: "איזו עסקה",
    kind: "deal",
  },
  // שליחה לכל המתאימים — נכס אחד, והרבה נמענים: בחירה מפורשת תמיד
  send_offers_bulk: {
    key: "propertyPhrase",
    idKey: "propertyId",
    label: "איזה נכס לשלוח",
    kind: "property",
    alwaysChoose: true,
  },
  create_landing_page: {
    key: "propertyPhrase",
    idKey: "propertyId",
    label: "לאיזה נכס",
    kind: "property",
  },
  start_exclusivity: {
    key: "propertyPhrase",
    idKey: "propertyId",
    label: "על איזה נכס",
    kind: "property",
  },
  open_deal_room: {
    key: "approachPhrase",
    idKey: "approachId",
    label: "על איזו פנייה",
    kind: "approach",
    alwaysChoose: true,
  },
  /*
   * ‎**„מה המשימות של דנה”.** רשות: בלי שם זו הרשימה הרגילה. השם
   * נפתר לסוכן, והשרת מסנן — `TasksService.list` מקבל `assignee`
   * מאז ומתמיד, ומה שחסר היה מי שיתרגם שם למזהה.
   */
  show_tasks: {
    key: "assigneePhrase",
    idKey: "assigneeId",
    label: "של מי",
    kind: "user",
    optional: true,
  },
  /*
   * ‎**וכאן חובה.** „תעביר את זה למישהו” בלי לדעת למי אינה הטלה;
   * משימה שתישאר על היוצר בשקט היא בדיוק הכישלון שהפעולה נועדה
   * למנוע.
   */
  assign_task: {
    key: "taskPhrase",
    idKey: "taskId",
    label: "איזו משימה",
    kind: "task",
    also: { key: "assigneePhrase", idKey: "assigneeId", label: "על מי להטיל", kind: "user" },
  },
  /*
   * ‎**התאמה מזוהה בזוג, לא במזהה.** אין ל„התאמה” שם שאפשר לומר
   * אותו — היא (קונה, נכס), וכך גם נאמרת: „הדירה ברמת גן לא מתאימה
   * למשה כהן”. שני הביטויים נדרשים, והביצוע מוצא את השורה מהם.
   */
  dismiss_match: {
    key: "buyerPhrase",
    idKey: "buyerId",
    label: "איזה קונה",
    kind: "buyer",
    // „פגישה מחר בעשר” בלי נכס היא פגישה תקינה
    also: {
      key: "propertyPhrase",
      idKey: "propertyId",
      label: "איזה נכס",
      kind: "property",
      optional: true,
    },
  },
  complete_task: { key: "taskPhrase", idKey: "taskId", label: "איזו משימה", kind: "task" },
  update_task: { key: "taskPhrase", idKey: "taskId", label: "איזו משימה", kind: "task" },
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
  show_card: { key: "cardPhrase", idKey: "cardId", label: "איזה כרטיס", kind: "anyCard" },
  play_recording: { key: "cardPhrase", idKey: "cardId", label: "שיחה עם מי", kind: "card" },
  update_lead_status: { key: "leadPhrase", idKey: "leadId", label: "איזה ליד", kind: "lead" },
  // המרה יוצרת קונה על אותו איש קשר — הליד הוא המפתח היחיד
  convert_lead: { key: "leadPhrase", idKey: "leadId", label: "איזה ליד", kind: "lead" },
  create_property_from_lead: {
    key: "leadPhrase",
    idKey: "leadId",
    label: "איזה ליד",
    kind: "lead",
  },
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
    /*
     * ‎**רשות.** „שלח הצעה למשה” בלי נכס עדיין פעולה — הביצוע מצמצם
     * את הניווט לכרטיס הקונה במקום ליצור הצעה, וזו התנהגות מוגדרת.
     */
    also: {
      key: "propertyPhrase",
      idKey: "propertyId",
      label: "איזה נכס",
      kind: "property",
      optional: true,
    },
  },
  send_agreement: {
    key: "buyerPhrase",
    idKey: "buyerId",
    label: "את מי להחתים",
    kind: "buyer",
    /*
     * הקישור נושא טוקן, ומי שמחזיק בו יכול לחתום על מסמך משפטי.
     * זו בדיוק הפעולה שבה בחירה אוטומטית „כי יש רק שרה אחת” היא
     * הטעות שמגיעה ללקוח.
     */
    alwaysChoose: true,
    also: {
      key: "propertyPhrase",
      idKey: "propertyId",
      label: "על איזה נכס",
      kind: "property",
    },
  },
  send_email: {
    key: "buyerPhrase",
    idKey: "buyerId",
    label: "לאיזה לקוח לכתוב",
    kind: "buyer",
    // הודעה יוצאת ללקוח — בחירה מפורשת תמיד, כמו הצעה והסכם
    alwaysChoose: true,
  },
};

/**
 * האם הפעולה דורשת בחירה מפורשת של הרשומה, גם כשיש התאמה יחידה.
 *
 * ‎**מיוצאת כדי שאפשר יהיה לבדוק אותה.** קטלוג הפעולות מצהיר
 * ש-`outbound` „דורש גם בחירה מפורשת של הנמען שזוהה”, וההצהרה הזו
 * חיה עד כה בהערה בלבד: פעולה יוצאת חדשה שנוספה בלי `alwaysChoose`
 * הייתה בוחרת נמען אוטומטית, ושום דבר לא היה אומר זאת. הבדיקה
 * עוברת על כל הקטלוג ולכן אינה יכולה להתיישן.
 */
export function requiresExplicitChoice(actionId: string): boolean {
  return ENTITY_LOOKUP[actionId]?.alwaysChoose === true;
}

/**
 * הביטויים שהפעולה הזו באמת פותרת למזהה.
 *
 * ‎**מיוצאת כדי שאפשר יהיה לאכוף את הקשר לקטלוג.** ביטוי מוצהר בלי
 * רשומה כאן הוא שדה מת: המודל ממלא אותו, הכרטיס מציג אותו, המתווך
 * מאשר — והביצוע מחפש `…Id` שאיש לא כתב אליו. זה קרה שלוש פעמים
 * במערכת הזו (`send_offer`, `schedule_appointment`, `show_matches`),
 * ובכל פעם התסמין היה פעולה שנראתה מוצלחת והתייחסה לרשומה הלא
 * נכונה — או לאף אחת.
 */
export function lookupPhraseKeys(actionId: string): readonly string[] {
  const spec = ENTITY_LOOKUP[actionId];
  if (spec === undefined) return [];
  return spec.also === undefined ? [spec.key] : [spec.key, spec.also.key];
}

/**
 * ‎**המזהים שהטבלה כותבת** — הצד השני של אותה תקלה.
 *
 * הביטוי נפתר, המזהה נכתב לפרמטרים, ואז **צמצום הפרמטרים** מוחק
 * אותו: `AGENT_ID_KEYS` היא רשימת ההיתר של המזהים שאינם שדות
 * קטלוג, ומזהה חדש שאינו בה נעלם בין הבחירה לביצוע — בשני
 * הערוצים, ובשקט (ביקורת Codex על `approachId`).
 *
 * מיוצאת כדי שהבדיקה תאכוף: כל `idKey` כאן חייב להיות מוצהר
 * בקטלוג כשדה, או להופיע ברשימת ההיתר.
 */
export function lookupIdKeys(actionId: string): readonly string[] {
  const spec = ENTITY_LOOKUP[actionId];
  if (spec === undefined) return [];
  return spec.also === undefined ? [spec.idKey] : [spec.idKey, spec.also.idKey];
}

const RECOMMENDED: Record<string, readonly string[]> = {
  create_lead: ["name", "phone"],
  create_buyer: ["name", "phone", "cities", "budgetMaxShekels"],
  create_property: ["city", "propertyType", "dealType", "rooms", "priceShekels"],
  schedule_appointment: ["startsAt"],
  reschedule_appointment: ["startsAt"],
  send_message: ["messageBody"],
  message_owner: ["messageBody"],
  post_deal_message: ["messageBody"],
  // אחוז העמלה נראה בכרטיס לפני האישור — תנאי מסחרי אינו מאושר בעיוורון
  offer_to_demand: ["commissionSplit"],
  express_interest: ["commissionSplit"],
  start_exclusivity: ["exclusivitySubject", "exclusivityMonths"],
  move_deal_stage: ["dealStage"],
  open_support_ticket: ["supportMessage"],
  create_task: ["title"],
  create_recurring_task: ["title"],
  log_call: ["callOutcome"],
  agent_report: ["windowDays"],
  /*
   * בפעולות שמכוונות לרשומה קיימת, הביטוי המזהה הוא ההשלמה החשובה
   * ביותר: בלעדיו הביצוע ייכשל ב"לא נבחר…" רק אחרי האישור. עדיף
   * שהכרטיס יאמר מראש מה חסר.
   */
  add_note: ["cardPhrase", "note"],
  update_lead_status: ["leadPhrase", "leadStatus"],
  update_buyer: ["buyerPhrase"],
  update_property: ["propertyPhrase"],
  show_exclusivity: ["propertyPhrase"],
  log_marketing_action: ["propertyPhrase"],
  complete_task: ["taskPhrase"],
  assign_task: ["taskPhrase", "assigneePhrase"],
  dismiss_match: ["buyerPhrase", "propertyPhrase", "dismissReason"],
  send_offer: ["buyerPhrase", "propertyPhrase"],
  send_agreement: ["buyerPhrase", "propertyPhrase"],
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
