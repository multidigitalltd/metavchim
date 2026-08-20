import { Body, Controller, Get, HttpCode, Post } from "@nestjs/common";
import { z } from "zod";
import { AGENT_ACTION_IDS, agentAction, type AgentProposal } from "@metavchim/shared";
import { AnyAuthenticated, RequireCapability } from "../../common/auth.decorators";
import { RequireFeature } from "../../common/feature.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { AgentExecuteService, type ExecuteResult } from "./execute.service";
import { AgentInterpretService } from "./interpret.service";
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
    const interpretation = await this.interpret.interpret(
      body.transcript,
      body.prior as { action: string; params: Record<string, unknown> } | undefined,
    );
    return this.resolve.toProposal(body.transcript, interpretation);
  }

  /**
   * ביצוע ההצעה שאושרה.
   *
   * `properties.view` היא היכולת של הנתיב — הרצפה שמאפשרת לדבר עם
   * הסוכן בכלל. היכולת של הפעולה עצמה נבדקת בשירות, מול הקטלוג,
   * כי היא נקבעת מגוף הבקשה ולא מהנתיב.
   */
  @Post("execute")
  @HttpCode(200)
  @RequireCapability("properties.view")
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
    // מזהי הישויות שנבחרו במסך — אינם שדות של המודל ובכל זאת נדרשים
    for (const key of ["buyerId", "propertyId", "taskId", "cardId", "leadId"]) {
      if (typeof body.params[key] === "string") params[key] = body.params[key];
    }
    return this.executor.execute(body.action, params);
  }
}
