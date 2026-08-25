import { Body, Controller, Get, HttpCode, Post } from "@nestjs/common";
import { z } from "zod";
import {
  AGENT_ACTION_IDS,
  AGENT_ID_KEYS,
  AGENT_RESULT_LABEL_MAX,
  AGENT_RESULT_ROWS,
  AGENT_RESULT_SUMMARY_MAX,
  agentAction,
  historyRefs,
  type AgentHistoryTurn,
  type AgentProposal,
} from "@metavchim/shared";
import { AnyAuthenticated } from "../../common/auth.decorators";
import { RequireFeature } from "../../common/feature.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { AgentExecuteService, type ExecuteResult } from "./execute.service";
import { AgentInterpretService } from "./interpret.service";
import { AgentMemoryService } from "./agent-memory.service";
import { AgentResolveService } from "./resolve.service";

/**
 * הסוכן — שני נתיבים, ושום דבר לא קורה בראשון.
 *
 * ## למה הפרדה בין הבנה לביצוע
 *
 * `interpret` קורא, מבין ומחזיר **הצעה**. הוא אינו כותב דבר. את
 * הביצוע מבקשים בנפרד, עם הפרמטרים שהמתווך ראה ואישר — כולל
 * תיקונים שהזין. כך אין מצב שבו דיבור הופך לפעולה, וגם אין מצב
 * שבו מה שנשמר שונה ממה שהוצג.
 *
 * זה גם מה שמאפשר עריכה: המסך משנה ערך בהצעה ושולח אותה כפי שהיא.
 * אין „פירוש מחדש” של המשפט אחרי שהמתווך כבר תיקן.
 *
 * ## אבטחה
 *
 * `interpret` מסומן `AnyAuthenticated` — הוא אינו נוגע בנתונים
 * מעבר לאוצר המילים של המקומות ולחיפוש שכבר מסונן לפי בעלות, והוא
 * מציע רק פעולות שלמשתמש יש הרשאה אליהן. השער האמיתי הוא ב-
 * `execute`, שבודק את היכולת של **הפעולה שהתבקשה** ולא של הנתיב.
 *
 * ## הזרקת טקסט
 *
 * התמלול הוא נתון, לא הוראה. המודל בוחר מזהה מתוך רשימה סגורה
 * והפרמטרים עוברים zod, ולכן משפט זדוני יכול לכל היותר להציע פעולה
 * שגויה — שדורשת אישור מפורש של המתווך **ו**את ההרשאה שלו. אין
 * פעולות הרסניות בקטלוג בכלל.
 */

const InterpretSchema = z
  .object({
    transcript: z.string().trim().min(2).max(4000),
    /** ההצעה הקודמת — כשזה תיקון ולא בקשה חדשה */
    prior: z
      .object({
        action: z.enum(AGENT_ACTION_IDS as unknown as [string, ...string[]]),
        params: z.record(z.string(), z.unknown()),
      })
      .optional(),
    /**
     * התורות האחרונות בשיחה — למשפטי המשך ("ומה עם רמת גן?").
     * המסך שולח את מה שבוצע בפועל, לא את מה שרק הוצע; שישה תורות
     * מספיקים לשיחה ומונעים פרומפט שמתנפח בלי סוף.
     */
    history: z
      .array(
        z.object({
          transcript: z.string().trim().min(1).max(4000),
          action: z.enum(AGENT_ACTION_IDS as unknown as [string, ...string[]]),
          params: z.record(z.string(), z.unknown()),
          resultSummary: z.string().max(AGENT_RESULT_SUMMARY_MAX).optional(),
          /*
           * ההפניות לרשומות שהוצגו בתור ההוא — התווית והמזהה.
           *
           * **המזהה אינו מרחיב את מה שהדפדפן יכול לעשות:** פרמטרי
           * הפעולה מגיעים ממנו ממילא, ובעלות נאכפת בפעולה עצמה. מה
           * שהוא כן עושה הוא לפתור „הראשון מהם” בלי חיפוש טקסט —
           * ולכן גם כשהתווית היא רישא של שם ארוך (ביקורת Codex).
           */
          refs: z
            .array(
              z.object({
                label: z.string().trim().min(1).max(AGENT_RESULT_LABEL_MAX),
                entityType: z.enum(["lead", "buyer", "property", "task"]),
                entityId: z.string().length(26),
              }),
            )
            .max(AGENT_RESULT_ROWS)
            .optional(),
        }),
      )
      .max(6)
      .optional(),
  })
  .strict();

const ExecuteSchema = z
  .object({
    action: z.enum(AGENT_ACTION_IDS as unknown as [string, ...string[]]),
    /*
     * הפרמטרים מגיעים מהמסך אחרי עריכה, ולכן הם `unknown` כאן
     * ומצטמצמים לסכימה של הפעולה בשירות. אמון בגוף הבקשה היה הופך
     * את הוולידציה של המודל לתיאטרון.
     */
    params: z.record(z.string(), z.unknown()),
    transcript: z.string().trim().max(4000).optional(),
  })
  .strict();

@RequireFeature("voice_intake")
@Controller("agent")
export class AgentController {
  constructor(
    private readonly interpret: AgentInterpretService,
    private readonly resolve: AgentResolveService,
    private readonly executor: AgentExecuteService,
    private readonly memory: AgentMemoryService,
  ) {}

  /** מה הסוכן יודע לעשות עבור המשתמש הזה — למסך הדוגמאות. */
  @Get("capabilities")
  @AnyAuthenticated()
  capabilities(): { id: string; title: string; examples: readonly string[] }[] {
    return this.interpret.allowedActions().map((action) => ({
      id: action.id,
      title: action.title,
      examples: action.examples,
    }));
  }

  @Post("interpret")
  @HttpCode(200)
  @AnyAuthenticated()
  async interpretCommand(
    @Body(new ZodValidationPipe(InterpretSchema)) body: z.infer<typeof InterpretSchema>,
  ): Promise<AgentProposal> {
    /*
     * מה שהסוכן הראה למתווך זה עתה — אותו זיכרון שיש לו בוואטסאפ.
     *
     * בוואטסאפ הוא נכתב לשיחה בסבב ההתראות; כאן אין שיחה שנשמרת
     * בשרת (ההיסטוריה חיה בפאנל של הדפדפן), ולכן הוא נגזר מחדש
     * מההתראות עצמן. שני האיסופים, אותה פונקציה, אותו תוצר — כדי
     * ש„תזכיר לי להתקשר אליו” יעבוד בשני הערוצים ולא באחד.
     *
     * **בסוף ההיסטוריה ולא בראשה.** `buildInterpretPrompt` מציג את
     * המערך לפי סדרו, ו-`historyRefs` מתייחס לסוף כאל החדש ביותר.
     * הזיכרון הזה נגזר מהתראות **שזה עתה הגיעו**, ולכן הצבתו בראש
     * הפכה אותו לישן מכולם: „תזכיר לי להתקשר אליו” אחרי התראה על
     * שיחה שלא נענתה נפתר אל הפעולה הקודמת בפאנל במקום אל השיחה
     * שהרגע נכנסה — כלומר בדיוק המקרה שבשבילו הזיכרון הזה נבנה
     * (ביקורת Codex).
     *
     * **וזו הכרעה ולא דיוק:** לתורות שמגיעים מהפאנל אין חותמת זמן
     * (הדפדפן שולח אותם כמערך), ולכן אי אפשר למזג את שני המקורות
     * לפי סדר אמיתי. בהיעדר חותמת, „מה שזה עתה קפץ למסך” הוא
     * הניחוש הטוב יותר למה שהמתווך מתכוון אליו כשהוא אומר „אליו”.
     */
    const memory = await this.memory.recentTurn();
    const history = [
      ...((body.history ?? []) as AgentHistoryTurn[]),
      ...(memory ? [memory] : []),
    ];
    const interpretation = await this.interpret.interpret(
      body.transcript,
      body.prior as { action: string; params: Record<string, unknown> } | undefined,
      history,
    );
    return this.resolve.toProposal(
      body.transcript,
      interpretation,
      undefined,
      historyRefs(history),
    );
  }

  /**
   * ביצוע ההצעה שאושרה.
   *
   * **השער כאן הוא אימות בלבד, והיכולת נבדקת על הפעולה.** הנתיב
   * מדבר על פעולה שמגיעה מגוף הבקשה, ולכן יכולת אחת שמוצהרת עליו
   * אינה יכולה לתאר אותה: `properties.view` שעמדה כאן כ„רצפה”
   * חסמה משתמש שמודול הנכסים סגור אצלו מלהריץ פעולות שהוא כן
   * מורשה בהן — והן הוצעו לו רגע קודם ב-`/agent/capabilities`
   * ובכרטיס ההצעה (ביקורת Codex).
   *
   * זו אינה הרפיה: `AgentExecuteService.execute` מחפש את הפעולה
   * בקטלוג ובודק את היכולת שלה מול ההקשר לפני כל דבר אחר, ובדיקה
   * מבנית מוודאת שאין בקטלוג פעולה בלי יכולת. השער עבר למקום
   * היחיד שיודע מה באמת התבקש, במקום להיות ניחוש בנתיב.
   *
   * `@RequireFeature("voice_intake")` על הבקר עדיין חל — מסלול בלי
   * הסוכן אינו מגיע לכאן בכלל.
   */
  @Post("execute")
  @HttpCode(200)
  @AnyAuthenticated()
  async execute(
    @Body(new ZodValidationPipe(ExecuteSchema)) body: z.infer<typeof ExecuteSchema>,
  ): Promise<ExecuteResult> {
    const action = agentAction(body.action)!;
    /*
     * צמצום חוזר לסכימה של הפעולה. המסך יכול לשלוח מה שירצה, ומפתח
     * שאינו שייך לפעולה נזרק כאן — לא נשמר "ליתר ביטחון".
     */
    const params: Record<string, unknown> = {};
    for (const field of action.fields) {
      if (body.params[field.key] !== undefined) params[field.key] = body.params[field.key];
    }
    for (const field of action.resolved ?? []) {
      if (body.params[field.key] !== undefined) params[field.key] = body.params[field.key];
    }
    /*
     * מזהי הישויות שנבחרו במסך — אינם שדות של המודל ובכל זאת נדרשים.
     *
     * `relatedId` הוא הכרטיס שהתזכורת נקשרת אליו. השמטתו מכאן הייתה
     * מבטלת את הקישור בדיוק בשלב האחרון: ההצעה הציגה „קשור ל: הליד
     * מהעדכון”, המתווך אישר, והמשימה נוצרה בלי שיוך.
     */
    for (const key of AGENT_ID_KEYS) {
      if (typeof body.params[key] === "string") params[key] = body.params[key];
    }
    return this.executor.execute(body.action, params, body.transcript);
  }
}
