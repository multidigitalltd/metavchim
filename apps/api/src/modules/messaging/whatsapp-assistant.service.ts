import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ulid } from "ulid";
import {
  agentAction,
  AGENT_DEGRADED_REASON,
  agentHistorySummary,
  agentReplySegments,
  agentResultRefs,
  proposalRunsImmediately,
  agentTurnRefs,
  type AgentHistoryRef,
  agentResultText,
  applyBlockedModules,
  resolveCapabilities,
  roleLabel,
  decodeButtonId,
  historyRefs,
  lastOffer,
  AGENT_HISTORY_KEPT,
  AGENT_ID_KEYS,
  type WhatsAppButton,
  type WhatsAppListRow,
  type AgentHistoryTurn,
  type AgentProposal,
  type Capability,
} from "@metavchim/shared";
import { TenantContext, type RequestContext } from "../../common/tenant-context";
import { loadEnv } from "../../config/env";
import { CryptoService } from "../../core/crypto.service";
import { PlanCatalogService } from "../../core/plan-catalog.service";
import { PlatformSettingsService } from "../../core/platform-settings.service";
import { PrismaService } from "../../core/prisma.service";
import { advancePendingRow, takePendingRow } from "./whatsapp-pending";
import { tenantPeriodEnded, tenantSuspended } from "../auth/auth.service";
import { AgentExecuteService, type ExecuteResult } from "../agent/execute.service";
import { AgentInterpretService } from "../agent/interpret.service";
import { AgentResolveService } from "../agent/resolve.service";
import { TranscriptionService } from "../../modules/voice-intake/transcription.service";
import {
  choiceIndex,
  isCancelMessage,
  wantsSpokenReply,
  isConfirmMessage,
  isHelpMessage,
  parseSnoozeRequest,
  snoozeReply,
} from "./assistant-lang";
import {
  agentWelcomeExamples,
  looksLikeWhatsappLinkCode,
  WHATSAPP_AGENT_DENIAL_TEXT,
  whatsappAgentDenial,
} from "@metavchim/shared";
import {
  lockConversation,
  mergeTurns,
  parseTurns,
  turnsAsJson,
} from "../agent/conversation";
import { AgentPrefsService } from "../agent/agent-prefs.service";
import { GeminiService } from "../../core/gemini.service";
import { toWhatsAppAudio } from "./audio-transcode";
import { phoneDigitsCondition } from "./phone-match";
import { helpMenu } from "./assistant-help";
import {
  buttonAsText,
  choiceVariant,
  CMD_TEXT_MAX,
  confirmButtons,
  SNOOZE_MINUTES,
  WA_AUDIO_SOURCE_MAX_BYTES,
  type AgentReply,
} from "./assistant-buttons";
import { formatCard } from "./assistant-card";
import { formatCallbacks } from "./assistant-callbacks";
import { summarizeData } from "./assistant-results";
import { prospectReplyText } from "./prospect-reply";
import { WhatsAppSendService } from "./whatsapp-send.service";
import { WhatsAppLinkService } from "./whatsapp-link.service";

/**
 * הסוכן האישי בוואטסאפ (docs/05 §1) — אותו סוכן שבמסך הקולי, דרך
 * צ'אט: המתווך כותב (או מקליט) לעוזרת האישית, והיא מבינה, מציעה,
 * ומבצעת אחרי אישור.
 *
 * ## זהות ואמון
 *
 * הזהות נגזרת ממספר הטלפון של השולח — מספר ש-Meta אימתה בהרשמה
 * ל-WhatsApp, בתוך Webhook שכבר עבר אימות חתימת HMAC. מי שהמספר שלו
 * אינו רשום אצל אף משתמש פעיל אינו מקבל דבר מלבד הסבר קצר. כל שערי
 * החשבון של הדשבורד נאכפים גם כאן: השהיה, תום תקופה, פיצ'ר במסלול,
 * חריגי הרשאה וחסימות מודול — היכולות נבנות בדיוק כמו ב-Session.
 *
 * ## אותו מנוע, אותם שערים
 *
 * ההבנה, הפתרון והביצוע הם השירותים של `AgentModule` — לא מסלול
 * מקביל. פעולה כותבת דורשת "אשר" מפורש, כמו הכפתור במסך; שאילתת
 * קריאה עונה מיד. ההצעה הממתינה, זיכרון השיחה ומזהי ההודעות שטופלו
 * נשמרים בטבלת `whatsapp_chats` תחת RLS.
 */

const FEATURE_ID = "voice_intake";
/**
 * כמה תורות נשמרים לזיכרון השיחה.
 *
 * מהחבילה המשותפת ולא כמספר כאן: סבב ההתראות ב-Worker כותב לאותו
 * שדה, ושני חלונות שונים היו חותכים זה את זה.
 */
const HISTORY_KEPT = AGENT_HISTORY_KEPT;
/** כמה מזהי הודעות נשמרים ל-Idempotency — Meta חוזר תוך דקות. */
const HANDLED_KEPT = 30;
/** המענה השיווקי למספר לא רשום — לכל היותר פעם בשבוע לכל מספר. */
const PROSPECT_REPLY_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
/** מעל זה התמלול מקבל הודעת „מתמלל…” — מתחת לזה התשובה עצמה מגיעה. */
const SLOW_TRANSCRIBE_NOTICE_MS = 6_000;
/**
 * מספר שהמערכת מכירה אך אינו מקושר — **מוכר, ולא מוכח.**
 *
 * זה מצב שלישי, ולא „לא זוהה”: המספר תואם משתמש רשום, אבל הקישור
 * שלו נותק, פג, או הועבר לחשבון אחר. מענה שיווקי כאן היה מטעה, וזיהוי
 * לפי ההשוואה בלבד היה מבטל את הניתוק עצמו.
 */
const NEEDS_LINK = "needs-link";
/**
 * מה שנאמר למספר מוכר שאינו מקושר — **עם קישור ישיר, ולא עם מסלול
 * ניווט.**
 *
 * ‎„היכנסו למערכת ← פרופיל ← גללו” הוא בדיוק המקום שבו מי שכבר
 * נמצא בוואטסאפ מוותר: שלושה צעדים ידניים כדי להגיע למסך אחד.
 * הקישור פותח את המסך עצמו, ושם הוא רואה בין כה מה מצבו — קוד
 * חיבור אם הוא זכאי, או הסיבה אם לא.
 *
 * בלי שם ובלי פרט מזהה: הנמען אינו מזוהה, וייתכן שמדובר במי
 * שמחזיק עכשיו במספר שהוחלף.
 */
function needsLinkText(webOrigin: string): string {
  const link = `${webOrigin.replace(/\/+$/u, "")}/profile#whatsapp-link`;
  return [
    "המכשיר הזה אינו מחובר לחשבון, ולכן אני לא יכולה לעבוד ממנו.",
    "",
    `לחיבור: ${link}`,
    "שם תראו אם אפשר להפיק קוד חיבור — ואם הסוכן אינו כלול אצלכם, מה צריך כדי שיהיה.",
    "",
    "אחרי שתפיקו קוד — שלחו אותו לכאן ואתחיל לעבוד.",
  ].join("\n");
}
/**
 * מה שנאמר כשההצעה שהמתווך פעל עליה כבר אינה הממתינה.
 *
 * שתיקה כאן הייתה גרועה במיוחד: הוא לחץ או ענה, לא קרה כלום, והוא
 * אינו יודע אם הפעולה בוצעה או לא.
 */
const STALE_PROPOSAL_TEXT =
  "ההצעה שהכפתור הזה שייך לה כבר אינה ממתינה — היא בוצעה, בוטלה, או הוחלפה בבקשה חדשה. כתבו לי מה לעשות ואכין אותה מחדש.";

export interface AssistantInbound {
  externalId: string;
  fromWaId: string;
  type: string;
  text?: string;
  mediaId?: string;
  /** מזהה הכפתור שנלחץ — מה ששלחנו בו, ולכן נושא את הפעולה */
  buttonId?: string;
  /** כותרת הכפתור כפי שהמתווך ראה אותה — ליומן ולזיכרון השיחה */
  buttonTitle?: string;
}

interface PendingState {
  transcript: string;
  proposal: AgentProposal;
  /**
   * ‎`"suggest"` = הוצג „לא הבנתי, אולי התכוונת” והמתווך בוחר פעולה.
   * זו הבחירה היחידה כאן שאינה על **רשומה** אלא על **כוונה**, ולכן
   * היא אינה נצרכת אטומית: לחיצה חוזרת רק מפרשת מחדש, לא מבצעת.
   */
  awaiting: "confirm" | "choice" | "suggest";
  /**
   * חותם ההצעה — נכנס למזהי הכפתורים שלה.
   *
   * הודעה בוואטסאפ נשארת בצ'אט לנצח, וכפתוריה נשארים לחיצים. בלי
   * החותם לחיצה על „אשר” בהצעה מלפני שעה הייתה מבצעת את ההצעה
   * שממתינה *עכשיו* — בקשה אחרת לגמרי, שהמתווך לא הסתכל עליה
   * (ביקורת Codex).
   */
  token?: string;
  /** בחירות שכבר נעשו (מזהה מועמד) — מעבר לשדות ההצעה */
  extraParams: Record<string, unknown>;
  /**
   * מזהי הפעולות שהוצעו אחרי „לא הבנתי”, לפי הסדר שהוצג.
   *
   * נשמרים כאן ולא במזהה הכפתור: מזהה כפתור ב-Meta מוגבל באורך,
   * והמשפט המקורי — שהוא מה שנפרש מחדש — ארוך ממנו ממילא. המספר
   * הסידורי הוא מה שנוסע, בדיוק כמו בבחירת רשומה.
   */
  suggestions?: string[];
}

interface ChatState {
  pending: PendingState | null;
  history: AgentHistoryTurn[];
  /**
   * התורים ש**התור הזה** הוסיף — הבסיס למיזוג בשמירה.
   *
   * ההיסטוריה נקראת בתחילת התור ונכתבת בסופו, ובין לבין יש קריאה
   * למודל. סורק ההתראות בוורקר כותב לאותה עמודה באותו זמן, ולכן
   * כתיבה של המערך המקומי כמו-שהוא דורסת את מה שהוא הוסיף (או
   * להפך). מה שנשמר הוא לכן **מה שנוסף כאן**, על גבי מה שקריאה
   * חוזרת מתחת לנעילה מוצאת — ולא צילום ישן (ביקורת Codex).
   *
   * **רשימה נפרדת, ולא מונה על `history`.** קודם נשמר כאן מספר
   * התורים שהיו בטעינה, והתוספת נגזרה ב-`history.slice(base)`.
   * מרגע ש-`history` מגיעה לתקרה היא נחתכת בכל תור וחוזרת לאותו
   * אורך בדיוק, ולכן ההפרש הזה הוא אפס: בשיחה ותיקה שום תור חדש
   * לא נשמר יותר, והסוכן שכח כל מה שהוא עשה מאז (ביקורת Codex).
   * ‎`history` נחתכת בשביל הפרומפט; מה שנשמר נספר כאן.
   */
  added: AgentHistoryTurn[];
  handledIds: string[];
  /**
   * אל תכתוב את ההצעה המקומית חזרה — מה שבשורה חדש ממנה.
   *
   * נדלק כשצריכה עם חותם לא תפסה: פירוש הדבר שמסלול מקביל כבר
   * החליף את ההצעה בין הצילום לצריכה. כתיבת ה-null המקומי הייתה
   * מוחקת דווקא את ההצעה החדשה, והכפתורים שזה עתה נשלחו למתווך
   * היו הופכים מיד לפגי-תוקף (ביקורת Codex).
   */
  keepStoredPending?: boolean;
}

interface IdentifiedUser {
  id: string;
  tenantId: string;
  name: string;
  role: string;
  whatsappAccess: boolean;
  tenant: {
    status: string;
    plan: string;
    trialEndsAt: Date | null;
    paidUntil: Date | null;
    blockedModules: string[];
  };
}

@Injectable()
export class WhatsAppAssistantService {
  private readonly logger = new Logger(WhatsAppAssistantService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: WhatsAppSendService,
    private readonly plans: PlanCatalogService,
    private readonly platformSettings: PlatformSettingsService,
    private readonly crypto: CryptoService,
    private readonly transcription: TranscriptionService,
    private readonly interpreter: AgentInterpretService,
    private readonly resolver: AgentResolveService,
    private readonly executor: AgentExecuteService,
    private readonly links: WhatsAppLinkService,
    private readonly gemini: GeminiService,
    private readonly agentPrefs: AgentPrefsService,
  ) {}

  /**
   * נקודת הכניסה מה-Webhook. לעולם אינה זורקת: חריגה כאן הייתה
   * מחזירה 500 ל-Meta, וההודעה הייתה נשלחת שוב ושוב.
   */
  async handle(msg: AssistantInbound): Promise<void> {
    try {
      await this.handleInner(msg);
    } catch (error) {
      this.logger.error(`טיפול בהודעת סוכן נכשל: ${String(error)}`);
      await this.sender.sendText(
        msg.fromWaId,
        "משהו השתבש אצלי בטיפול בבקשה — נסו שוב בעוד רגע.",
      );
    }
  }

  private async handleInner(msg: AssistantInbound): Promise<void> {
    /*
     * **קוד קישור נבדק לפני הכול — גם לפני הזיהוי.**
     *
     * זו כל הנקודה שלו: הוא מגיע ממספר שהמערכת עדיין אינה מכירה,
     * או שהיא מכירה בטעות. בדיקה אחריו הייתה מגלגלת אותו למסלול
     * המתעניין ומחזירה מענה שיווקי על ניסיון קישור.
     *
     * המבחן הוא על **הקידומת** ולא על תקינות הקוד: טעות הקלדה אחת
     * הייתה מוציאה את ההודעה מהמסלול הזה בדיוק כשהמתווך זקוק
     * למשפט „הקוד אינו תקף” (ביקורת Codex).
     */
    if (msg.type === "text" && looksLikeWhatsappLinkCode(msg.text ?? "")) {
      /*
       * תפיסה לפי מזהה ההודעה — **גם כאן, ולא רק אחרי הזיהוי.**
       *
       * המסלול הזה עוקף את `claimMessage` (שדורש משתמש ומשרד), ולכן
       * שליחה חוזרת של Meta הייתה מקבלת „הקוד אינו תקף” על אותו קוד
       * שהמשלוח הראשון בדיוק ניצל — שתי תשובות סותרות, בסדר אקראי
       * (ביקורת Codex).
       */
      if (!(await this.links.claimInbound(msg.externalId))) return;
      void this.sender.markRead(msg.externalId);
      await this.completeLink(msg);
      return;
    }

    const identified = await this.identifyUser(msg.fromWaId);
    /*
     * מספר מוכר שאינו מקושר — נאמר לו בדיוק זאת, פעם ביממה.
     *
     * לא מענה שיווקי (הוא אינו מתעניין) ולא שתיקה: הוא ניתק, או
     * שהקישור פג, והדרך חזרה היא קוד. התקרה נחוצה מפני שהשולח אינו
     * מזוהה — ייתכן שמדובר במי שמחזיק עכשיו במספר שהוחלף.
     */
    if (identified === NEEDS_LINK) {
      void this.sender.markRead(msg.externalId);
      if (await this.links.claimUnlinkedHint(msg.fromWaId)) {
        await this.sender.sendText(msg.fromWaId, needsLinkText(loadEnv().WEB_ORIGIN), {
          replyTo: msg.externalId,
        });
      }
      return;
    }
    const user = identified;
    if (!user) {
      // גם למתעניין: „נקרא” מיידי, כדי שלא ידבר לקיר
      void this.sender.markRead(msg.externalId);
      await this.greetProspect(msg.fromWaId);
      return;
    }

    /*
     * „נקרא” מיד — אבל בלי „מקליד…” עדיין.
     *
     * סימון ההקלדה נשאר על המסך עד 25 שניות, ולכן על מסלול שאינו
     * עונה — כפול של Meta, משרד מושהה — הוא היה „מקליד” תשובה שלא
     * תגיע לעולם (ביקורת Codex). הוא נדלק רק אחרי שברור שיש תשובה.
     */
    void this.sender.markRead(msg.externalId);

    // שערי החשבון — אותם כללים כמו התחברות לדשבורד
    if (tenantSuspended(user.tenant)) {
      this.logger.warn(`הודעת וואטסאפ ממשרד מושהה ${user.tenantId} — נבלעת`);
      return;
    }
    if (tenantPeriodEnded({ ...user.tenant, planIsFree: await this.plans.isFreeCode(user.tenant.plan) })) {
      await this.sender.sendText(
        msg.fromWaId,
        "תקופת המנוי של המשרד הסתיימה — חדשו אותה במסך ניהול המשרד, ואחזור לעבוד מיד.",
        { replyTo: msg.externalId },
      );
      return;
    }
    /*
     * ‎**אותה הכרעה בדיוק שחוסמת את הפקת קוד הצימוד** — ראו
     * ‎`whatsappAgentDenial`. המקום מוקצה לסוכן מסוים ואינו נגזר
     * מתפקיד: בעל המשרד מחזיק בו כברירת מחדל ורשאי להעביר אותו.
     */
    const denial = whatsappAgentDenial({
      planHasAgent: await this.plans.tenantHasFeature(user.tenantId, FEATURE_ID),
      whatsappAccess: user.whatsappAccess,
    });
    if (denial !== null) {
      /*
       * ‎**הסיבה, ואז לאן ללכת איתה.**
       *
       * הנוסח המשותף אומר *למה* — הוא נכון בשני הערוצים. הקישור
       * נוסף כאן בלבד: במסך הוא היה מפנה למסך עצמו. בלעדיו המתווך
       * יודע שמשהו חסום ואינו יודע איפה לטפל בזה, וזה בדיוק המקום
       * שבו הוא מפסיק לנסות.
       */
      const link = `${loadEnv().WEB_ORIGIN.replace(/\/+$/u, "")}/profile#whatsapp-link`;
      await this.sender.sendText(
        msg.fromWaId,
        `${WHATSAPP_AGENT_DENIAL_TEXT[denial]}\n\nלבדיקה ולהפעלה: ${link}`,
        { replyTo: msg.externalId },
      );
      return;
    }

    // תפיסה לפני טיפול — כפול של Meta (גם מקביל) נבלם כאן, לא אחרי הביצוע
    const chat = await this.claimMessage(user.tenantId, user.id, msg.externalId);
    if (chat === null) return;

    // מכאן ואילך תמיד תצא תשובה — עכשיו „מקליד…” אומר אמת
    void this.sender.markRead(msg.externalId, true);

    const context = await this.buildContext(user);
    const allowed = TenantContext.run(context, () => this.interpreter.allowedActions());

    /*
     * הודעה ראשונה אי־פעם בצ'אט הזה — הכרות קצרה לפני התשובה.
     *
     * המתווך שהמנוי שלו הופעל אינו יודע מה מותר לבקש ובאיזה ניסוח,
     * וניסיון ראשון שנכשל הוא בדרך כלל גם האחרון. הדוגמאות נגזרות
     * מהפעולות שמותרות *לו* — צפייה בלבד שמקבלת „תוסיף קונה” לומדת
     * בדיוק את הפקודה שתיחסם לה (ביקורת Codex). „ראשונה” נמדד לפי
     * מזהי ההודעות שטופלו: בהודעה הראשונה יש בדיוק אחד.
     */
    if (chat.handledIds.length <= 1) {
      await this.sender.sendText(
        msg.fromWaId,
        welcomeText(
          user.name,
          allowed.map((action) => action.id),
        ),
      );
    }

    /*
     * לחיצה על כפתור מתורגמת למילה שהשיחה כבר יודעת לפרש, כדי שלא
     * יהיה מסלול ביצוע שני שצריך לזכור את אותם כללי אטומיות.
     * ההשתקה היא היחידה שאינה פקודת שיחה ולכן מטופלת כאן — עכשיו
     * משני המקורות: כפתור ישן שעדיין בהיסטוריה של מישהו, ומשפט.
     */
    const button = msg.buttonId === undefined ? null : decodeButtonId(msg.buttonId);
    /*
     * ‎**ההשתקה נבדקת לפני „עזרה” ולפני המנוע.**
     *
     * ‏„שקט” אינה פעולה בקטלוג, ולכן המנוע היה עונה עליה „לא
     * הבנתי” — או גרוע מכך, מנחש פעולה. היא גם חייבת לקדום לכל
     * שאר הפענוח: מי שמבקש שקט מבקש שהמשפט הזה **לא** יפתח שיחה.
     */
    const snooze =
      button?.action === "snooze"
        ? { minutes: SNOOZE_MINUTES, clamped: false }
        : msg.type === "text"
          ? parseSnoozeRequest(msg.text ?? "", new Date())
          : null;
    if (snooze !== null) {
      await this.snoozeNotifications(user.tenantId, user.id, snooze.minutes);
      await this.sender.sendText(msg.fromWaId, snoozeReply(snooze), {
        replyTo: msg.externalId,
      });
      return;
    }

    // „עזרה” — מהקטלוג, בלי קריאת מודל ובלי סיכוי להזכיר פעולה חסומה
    if (msg.type === "text" && isHelpMessage(msg.text ?? "")) {
      await this.sender.sendText(
        msg.fromWaId,
        helpMenu(
          allowed.map((action) => action.id),
          firstName(user.name),
        ),
        { replyTo: msg.externalId },
      );
      return;
    }

    if (
      button !== null &&
      (button.action === "confirm" || button.action === "cancel" || button.action === "pick") &&
      this.staleClick(chat.pending, button.token)
    ) {
      await this.sender.sendText(
        msg.fromWaId,
        STALE_PROPOSAL_TEXT,
        { replyTo: msg.externalId },
      );
      return;
    }

    const asText = button === null ? null : buttonAsText(button.action, button.arg);
    const spoken = asText === null ? await this.extractText(msg) : { text: asText };
    if ("reply" in spoken && spoken.reply !== undefined) {
      await this.sender.sendText(msg.fromWaId, spoken.reply, { replyTo: msg.externalId });
      return;
    }
    const text = spoken.text ?? "";

    const wasVoice = "transcribed" in spoken && spoken.transcribed === true;
    const reply = await TenantContext.run(context, () =>
      this.converse(user, chat, text, wasVoice),
    );
    /*
     * ‎**הקראה רק כשמבקשים אותה** (הכרעת בעל המוצר).
     *
     * הגרסה הראשונה הקריאה אוטומטית לכל הודעה קולית נכנסת — „מי
     * שדיבר, שומע”. זה נשמע טבעי ועלה קריאת TTS בכל הודעה קולית,
     * גם כשאיש לא ביקש לשמוע; ובנוסף היה שם כפתור כיבוי שאינו
     * מכבה, כי „הודעה קולית **או** ההעדפה” התעלם מהעדפה שכובתה.
     *
     * עכשיו שתי דרכים לבקש, ושתיהן מפורשות: „תקריא לי” בתוך
     * ההודעה עצמה, או „תמיד תענה לי בקול” כהעדפת קבע — שכיבויה
     * באמת מכבה. `wasVoice` נשאר לתחילית „שמעתי:” בלבד.
     */
    const askedAloud = wantsSpokenReply(text);
    const voiced = await TenantContext.run(context, () => this.withSpokenReply(reply, askedAloud));

    await this.saveChat(user.tenantId, user.id, chat);
    await this.deliver(msg, voiced);
  }

  /**
   * שליחת התשובה — כפתורים כשיש, וטקסט כשאין או כשהם לא יצאו.
   *
   * ההודעה האינטראקטיבית מוגבלת ל-1024 תווים ויכולה להידחות; הנפילה
   * חזרה לטקסט המלא מבטיחה שהמתווך תמיד מקבל תשובה שאפשר לפעול
   * לפיה, גם אם בהקלדה במקום בלחיצה.
   */
  /**
   * ‎**התשובה הקולית — best-effort, אף פעם לא במקום הטקסט.**
   *
   * מוקרא רק `reply.speak` — המסקנה והתובנה שכבר עברו את שומר
   * העובדות. הקלטת שיחה שכבר מצורפת גוברת: שתי הודעות שמע באותה
   * תשובה הן רעש. כל כשל — TTS, המרה — משאיר את התשובה כטקסט.
   */
  private async withSpokenReply(reply: AgentReply, askedAloud: boolean): Promise<AgentReply> {
    if (reply.audio !== undefined) return reply;
    if (reply.speak === undefined || reply.speak.trim() === "") return reply;
    const wanted = askedAloud || (await this.agentPrefs.get()).voiceReplies === true;
    if (!wanted) return reply;
    const wav = await this.gemini.speak(reply.speak);
    if (wav === null) return reply;
    const audio = await toWhatsAppAudio(wav, "audio/wav");
    if (audio === null) return reply;
    return {
      ...reply,
      audio: { buffer: audio.body, mimeType: audio.mimeType, label: "התשובה בקול" },
    };
  }

  private async deliver(msg: AssistantInbound, reply: AgentReply): Promise<void> {
    /*
     * הקלטה נשלחת אחרי הטקסט ולא במקומו: הטקסט אומר של מי השיחה
     * ומתי, וקובץ שמע שמגיע לבד אינו אומר דבר.
     */
    /*
     * ‎**הטקסט/כפתורים קודם, השמע אחריו — לא במקומו.**
     *
     * עד עכשיו תשובה עם שמע (הקלטת שיחה) ויתרה על הכפתורים. מרגע
     * שגם התשובה עצמה יכולה להיות קולית, השמע הוא תוספת: הכפתורים
     * וצעדי ההמשך נשלחים כרגיל, וההודעה הקולית מצטרפת אחריהם.
     */
    const body = reply.buttonBody ?? reply.text;
    let textDelivered = false;
    if (reply.buttons && reply.buttons.length > 0) {
      textDelivered = await this.sender.sendButtons(msg.fromWaId, body, reply.buttons);
    } else if (reply.list && reply.list.rows.length > 0) {
      textDelivered = await this.sender.sendList(
        msg.fromWaId,
        body,
        reply.list.label,
        reply.list.rows,
      );
    }
    if (!textDelivered) {
      await this.sender.sendText(msg.fromWaId, reply.text, { replyTo: msg.externalId });
    }

    if (reply.audio !== undefined) {
      const sent = await this.sender.sendAudio(
        msg.fromWaId,
        reply.audio.buffer,
        reply.audio.mimeType,
        { caption: `🎧 ${reply.audio.label}` },
      );
      /*
       * `sendAudio` מחזירה false ואינה זורקת — דחייה של Meta או צד
       * יוצא שאינו מוגדר. על הקלטה זה מצריך הסבר וקישור (המתווך
       * חיכה לה); על תשובה קולית — לא: הטקסט המלא כבר אצלו, ושורת
       * „לא הצלחתי להקריא” הייתה רעש על תוספת נוחות.
       */
      if (!sent && reply.audio.href !== undefined) {
        await this.sender.sendText(
          msg.fromWaId,
          `🎧 לא הצלחתי לשלוח את ההקלטה לכאן. היא זמינה במסך השיחות: ${loadEnv().WEB_ORIGIN}${reply.audio.href}`,
        );
      }
    }
  }

  /**
   * לחיצה על כפתור של הצעה שכבר אינה הממתינה — נדחית בהסבר.
   *
   * שתיקה כאן הייתה גרועה במיוחד: המתווך לחץ, לא קרה כלום, והוא
   * אינו יודע אם הפעולה בוצעה או לא.
   */
  private staleClick(pending: PendingState | null, token?: string): boolean {
    if (token === undefined) return false; // כפתור בלי חותם (פקודה/השתקה)
    return pending === null || pending.token !== token;
  }

  /**
   * אחרי צריכת ההצעה: המצב המקומי מתרוקן תמיד, אבל כשהצריכה לא
   * תפסה — החותם לא תאם — מה שבשורה חדש ממה שבזיכרון, ואסור
   * לכתוב עליו את הריקון המקומי.
   */
  private consumed(chat: ChatState, took: PendingState | null): void {
    chat.pending = null;
    if (took === null) chat.keepStoredPending = true;
  }

  /** השתקה רגעית של העדכונים היזומים — הסורק מדלג עליה. */
  /**
   * ‎`minutes === 0` הוא **ביטול** ההשתקה ולא השתקה באפס דקות:
   * חותמת בעבר פירושה „אין שקט”, וזה בדיוק מה שהסבב בודק.
   */
  private async snoozeNotifications(
    tenantId: string,
    userId: string,
    minutes: number,
  ): Promise<void> {
    const until = new Date(Date.now() + minutes * 60 * 1000);
    await this.prisma.withExplicitTenant(tenantId, (tx) =>
      tx.whatsAppChat.upsert({
        where: { tenantId_userId: { tenantId, userId } },
        create: { id: ulid(), tenantId, userId, notifySnoozeUntil: until },
        update: { notifySnoozeUntil: until },
      }),
    );
  }

  /* ------------------------------------------------------------------ */
  /*  זהות והקשר                                                         */
  /* ------------------------------------------------------------------ */

  /**
   * מספר לא רשום שכתב לסוכן — מתעניין, לא תקלה.
   *
   * מי שכותב למספר העסקי הוא כמעט תמיד מתווך ששמע על המערכת, כלומר
   * הליד הכי חם שיש — והתשובה היא הצגת המערכת, קישור הרשמה וטלפון
   * של מנהלת המכירות (בקשת בעל הפלטפורמה). הנוסח ניתן לעריכה ממסך
   * הפלטפורמה בלי גרסה.
   *
   * **פעם בשבוע לכל מספר, לא בכל הודעה.** מי ששולח שלוש הודעות
   * ברצף היה מקבל את אותו עמוד מכירות שלוש פעמים — וזה גם ספאם וגם
   * מהיר בדרך לפגוע בדירוג האיכות של המספר אצל Meta. התפיסה
   * אטומית (updateMany מותנה), כך שגם הודעות מקבילות שולחות אחת.
   */
  private async greetProspect(waId: string): Promise<void> {
    const digits = waId.replace(/\D/gu, "").slice(0, 20);
    if (digits === "") return;
    // מוצפן כמו כל PII במנוחה; ה-hash לחיפוש — הדפוס של אנשי הקשר
    const phoneHash = this.crypto.phoneHash(digits);

    const now = new Date();
    const before = await this.prisma.whatsAppProspect.upsert({
      where: { phoneHash },
      create: {
        id: ulid(),
        phoneHash,
        phoneEncrypted: this.crypto.encrypt(digits),
        messages: 1,
      },
      update: { messages: { increment: 1 } },
      // העדכון אינו נוגע ב-repliedAt, ולכן זה הערך שלפני התפיסה —
      // אליו משחררים אם השליחה תיכשל
      select: { repliedAt: true },
    });
    const cooldownStart = new Date(now.getTime() - PROSPECT_REPLY_COOLDOWN_MS);
    const claimed = await this.prisma.whatsAppProspect.updateMany({
      where: {
        phoneHash,
        OR: [{ repliedAt: null }, { repliedAt: { lt: cooldownStart } }],
      },
      data: { repliedAt: now },
    });
    // כבר נענה לאחרונה — שקט; ההודעה נספרה ולצוות המכירות יש את המספר
    if (claimed.count === 0) return;

    const custom = await this.platformSettings.get("whatsappProspectReply");
    const text =
      custom !== undefined && custom.trim() !== ""
        ? custom
        : prospectReplyText(loadEnv().WEB_ORIGIN);
    /*
     * `sendText` מחזיר false במקום לזרוק — טוקן שפג, דחייה של Meta.
     * תפיסה שנשארת אחרי שליחה כושלת הייתה משתיקה את המתעניין לשבוע
     * שלם בלי שקיבל דבר (ביקורת Codex). התנאי `repliedAt: now` משחרר
     * רק את התפיסה שלנו — לא אחת חדשה שנתפסה בינתיים.
     */
    const sent = await this.sender.sendText(waId, text);
    if (!sent) {
      await this.prisma.whatsAppProspect.updateMany({
        where: { phoneHash, repliedAt: now },
        data: { repliedAt: before.repliedAt },
      });
    }
  }

  /**
   * מהשולח למשתמש: השוואת ספרות בלבד, בשתי צורות ההקלדה הנפוצות.
   *
   * שאילתת גלם כי הנרמול חייב לקרות בצד ה-SQL ("050-123..." שמור עם
   * מקפים). users מחוץ ל-RLS בכוונה — זו תשתית אימות, כמו ב-Login.
   * הטבלה קטנה (סוכני המשרדים, לא לקוחות קצה), אז סריקה זולה.
   */
  private async identifyUser(waId: string): Promise<IdentifiedUser | typeof NEEDS_LINK | null> {
    /*
     * **הקישור קודם — הוא ההצהרה; ההשוואה היא רק ההנחה.**
     *
     * מספר שהמתווך אישר במפורש (או שנקשר בהודעה הראשונה שלו) מזוהה
     * מהשורה שלו, בלי לגעת בשדה `phone`. זה מה שמונע ממספר שהוחזר
     * לשוק לפתוח מאגר של מישהו אחר: השדה במערכת יכול להתיישן,
     * הקישור אינו מתיישן בשקט — הוא פג.
     */
    const linked = await this.links.resolve(waId);
    if (linked !== null) return this.loadUser(linked.userId);

    const identified = await this.identifyByPhone(waId);
    if (identified === null || identified === NEEDS_LINK) return identified;
    /*
     * הודעה ראשונה ממספר שכבר רשום במערכת — הקישור נוצר עכשיו,
     * ומכאן הוא הזהות. משתמש קיים אינו נעצר, אבל גם אינו נשען שוב
     * ושוב על השוואה שאיש לא אישר.
     *
     * הצירוף נדחה כשלמספר הזה כבר היה קישור שנותק או פג. אז ההשוואה
     * אינה מכריעה יותר — היא בדיוק מה שהניתוק ביטל — והמענה הוא
     * בקשה לקוד.
     */
    const bound = await this.links.bindByPhone(waId, identified.tenantId, identified.id);
    return bound ? identified : NEEDS_LINK;
  }

  /**
   * הודעת קוד — קישור, או סירוב שאומר בדיוק מה קרה.
   *
   * הניסוח נמנע מלהבחין בין „קוד שגוי” ל„קוד שפג”: ההבדל אינו עוזר
   * למי שהקליד נכון, ומועיל דווקא למי שמנחש.
   */
  private async completeLink(msg: AssistantInbound): Promise<void> {
    const linked = await this.links.redeemCode(msg.fromWaId, msg.text ?? "");
    if (linked === null) {
      await this.sender.sendText(
        msg.fromWaId,
        "הקוד אינו תקף — ייתכן שפג או שכבר נוצל. הפיקו קוד חדש במסך ההגדרות ושלחו אותו לכאן.",
        { replyTo: msg.externalId },
      );
      return;
    }
    const user = await this.loadUser(linked.userId);
    await this.sender.sendText(
      msg.fromWaId,
      user === null
        ? "המכשיר קושר."
        : `שלום ${user.name}, המכשיר קושר לחשבון שלך. אפשר להתחיל — כתבו לי מה לעשות.`,
      { replyTo: msg.externalId },
    );
  }

  /**
   * השוואת ספרות — **רק כשהתשובה חד-משמעית.**
   *
   * שאילתת גלם כי הנרמול חייב לקרות בצד ה-SQL ("050-123..." שמור עם
   * מקפים). users מחוץ ל-RLS בכוונה — זו תשתית אימות, כמו ב-Login.
   *
   * ריבוי אינו מוכרע יותר: „הפעיל לאחרונה מנצח” היה ניחוש שקט
   * ברשומות של מישהו אחר, והאזהרה שנרשמה לצדו לא עצרה דבר. שניים
   * שחולקים מספר מקבלים בקשה לקוד, וזו התשובה הנכונה — רק הם יודעים
   * מי מהם מחזיק במכשיר.
   */
  private async identifyByPhone(
    waId: string,
  ): Promise<IdentifiedUser | typeof NEEDS_LINK | null> {
    const digits = phoneDigitsCondition(waId);
    if (digits === null) return null;
    const matched = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM users
      WHERE is_active = TRUE
        AND phone IS NOT NULL
        AND ${digits}
      ORDER BY last_login_at DESC NULLS LAST
      LIMIT 2`;
    const first = matched[0];
    if (!first) return null;
    if (matched.length > 1) {
      /*
       * ריבוי הוא **מוכר-ולא-מוכח**, ולא „לא מוכר”.
       *
       * ‎`null` כאן היה בלתי נבדל ממספר שאיננו מכירים כלל, ולכן שני
       * שותפים שחולקים מספר קיבלו את עמוד המכירות — ואף נרשמו
       * כמתעניינים במאגר (ביקורת Codex). מי שהמערכת מכירה מקבל את
       * ההוראה להפיק קוד, וזו בדיוק התשובה שהריבוי דורש: רק הם
       * יודעים מי מהם מחזיק במכשיר.
       */
      this.logger.warn("מספר וואטסאפ משויך ליותר ממשתמש אחד — נדרש קוד קישור");
      return NEEDS_LINK;
    }
    return this.loadUser(first.id);
  }

  private async loadUser(userId: string): Promise<IdentifiedUser | null> {
    // `findFirst` ולא `findUnique`: „פעיל” אינו חלק מהמפתח, וחשבון
    // שהושבת אינו מזוהה גם כשהקישור שלו עדיין קיים
    const user = await this.prisma.user.findFirst({
      where: { id: userId, isActive: true },
      select: {
        id: true,
        tenantId: true,
        name: true,
        role: true,
        whatsappAccess: true,
        tenant: {
          select: {
            status: true,
            plan: true,
            trialEndsAt: true,
            paidUntil: true,
            blockedModules: true,
          },
        },
      },
    });
    return user as IdentifiedUser | null;
  }

  /** היכולות נבנות בדיוק כמו ב-resolveSession — חריגים ואז חסימות. */
  private async buildContext(user: IdentifiedUser): Promise<RequestContext> {
    const overrides = await this.prisma.withExplicitTenant(user.tenantId, (tx) =>
      tx.userCapability.findMany({
        where: { userId: user.id, tenantId: user.tenantId },
        select: { capability: true, effect: true, expiresAt: true },
      }),
    );
    const capabilities = applyBlockedModules(
      resolveCapabilities(
        user.role,
        overrides.map((o) => ({
          capability: o.capability as Capability,
          effect: o.effect === "grant" ? ("grant" as const) : ("deny" as const),
          expiresAt: o.expiresAt,
        })),
        new Date(),
      ),
      user.tenant.blockedModules,
    );
    return { tenantId: user.tenantId, userId: user.id, capabilities, billingOnly: false };
  }

  /* ------------------------------------------------------------------ */
  /*  תוכן ההודעה                                                        */
  /* ------------------------------------------------------------------ */

  /** טקסט מוכן לפירוש, או תשובה מוכנה כשאין מה לפרש. */
  private async extractText(
    msg: AssistantInbound,
  ): Promise<{ text?: string; transcribed?: boolean; reply?: string }> {
    if (msg.type === "text") {
      const text = (msg.text ?? "").trim();
      if (text === "") return { reply: "קיבלתי הודעה ריקה — כתבו לי מה לעשות." };
      return { text };
    }
    if (msg.type === "audio") {
      if (!msg.mediaId) return { reply: "לא הצלחתי לקרוא את ההקלטה — נסו שוב." };
      /*
       * אישור קבלה **לפני** התמלול, ולא אחריו.
       *
       * תמלול על CPU אורך עשרות שניות, והאימוג'י על ההודעה עצמה אומר
       * „ההקלטה הגיעה ואני עליה” בלי להוסיף הודעה לצ'אט. הוא יוצא
       * במקביל: הוא לא צריך להקדים את ההורדה, רק את ההמתנה.
       */
      void this.sender.react(msg.fromWaId, msg.externalId, "🎧");
      const status = await this.transcription.status();
      if (!status.available) {
        return {
          reply: "שירות התמלול אינו זמין כרגע — כתבו לי את הבקשה בטקסט ואטפל בה.",
        };
      }
      const media = await this.sender.downloadMedia(msg.mediaId);
      if (!media) return { reply: "לא הצלחתי להוריד את ההקלטה — נסו שוב." };
      /*
       * תמלול ארוך מ-SLOW_TRANSCRIBE_NOTICE_MS מקבל הודעת ביניים.
       * הקלטה קצרה נענית ישירות בתשובה עצמה ולא מציפה את הצ'אט
       * בהודעת „מתמלל” מיותרת; הקלטה של דקה — שבה הדממה באמת מטרידה —
       * מקבלת סימן חיים. הטיימר מבוטל תמיד, גם כשהתמלול נכשל.
       */
      const notice = setTimeout(() => {
        void this.sender.sendText(msg.fromWaId, "🎧 קיבלתי את ההקלטה — מתמלל, עוד רגע…", {
          replyTo: msg.externalId,
        });
      }, SLOW_TRANSCRIBE_NOTICE_MS);
      try {
        const { text } = await this.transcription.transcribe(media.buffer, "voice-note.ogg");
        if (text.trim() === "") {
          return { reply: "לא הצלחתי לשמוע מילים בהקלטה — נסו שוב או כתבו." };
        }
        return { text: text.trim(), transcribed: true };
      } catch {
        return { reply: "התמלול נכשל — נסו שוב או כתבו את הבקשה." };
      } finally {
        clearTimeout(notice);
      }
    }
    if (msg.type === "image") {
      return {
        reply:
          "קיבלתי תמונה — צירוף תמונות לנכס דרך וואטסאפ עוד לא נתמך, בקרוב. בינתיים אפשר לכתוב או להקליט לי בקשות.",
      };
    }
    return { reply: "אני יודע לטפל כרגע בטקסט ובהודעות קוליות." };
  }

  /* ------------------------------------------------------------------ */
  /*  השיחה עצמה — רץ בתוך TenantContext                                 */
  /* ------------------------------------------------------------------ */

  private async converse(
    user: IdentifiedUser,
    chat: ChatState,
    text: string,
    transcribed: boolean,
  ): Promise<AgentReply> {
    /** תחילית לתשובה על הודעה קולית — שהמתווך יראה מה נשמע. */
    const heard = transcribed ? `שמעתי: „${text}”\n\n` : "";
    // מי מדבר — נכנס לפרומפט כדי שהתשובה תהיה שלו ולא כללית
    const speaker = { name: firstName(user.name), roleLabel: roleLabel(user.role) };

    const pending = chat.pending;
    if (pending) {
      if (isCancelMessage(text)) {
        const took = await this.takePending(user.tenantId, user.id, pending.token);
        this.consumed(chat, took);
        const answer = took ? "בוטל. מה הלאה?" : "אין פעולה ממתינה לביטול.";
        return { text: took ? `❌ ${answer}` : answer, speak: answer };
      }
      /*
       * ‎**„אולי התכוונת” — בחירת כוונה, לא בחירת רשומה.**
       *
       * המתווך בחר מה הוא רצה, והמשפט שכבר אמר נפרש מחדש נעוץ לאותה
       * פעולה. משם המסלול הרגיל לגמרי: פעולת קריאה רצה, פעולה
       * שכותבת נעצרת על „אשר”. הלחיצה בחרה כוונה — היא לא ביצעה.
       *
       * ‎`takePending` לא נקרא כאן בכוונה: אין מה לצרוך אטומית,
       * ובחירה שנייה (התחרטתי, ההצעה השנייה) חייבת להישאר אפשרית.
       */
      if (pending.awaiting === "suggest") {
        const ids = pending.suggestions ?? [];
        const picked = choiceIndex(text, ids.length);
        chat.pending = null;
        /*
         * ‎**לא מספר = ניסוח מחדש, לא תיקון.**
         *
         * ההצעה שממתינה כאן היא `unknown` — אין בה פעולה ואין בה
         * שדות. העברתה כ„הצעה קודמת” הייתה מספרת למודל שהמתווך מתקן
         * משהו, בשעה שהוא פשוט מנסח מחדש אחרי שלא הבנו. משפט חדש
         * נשלח כמשפט חדש.
         */
        return withHeard(
          picked === null
            ? await this.propose(chat, text, null, speaker)
            : await this.propose(chat, pending.transcript, null, speaker, ids[picked]!),
          heard,
        );
      }
      if (pending.awaiting === "choice") {
        const options = pending.proposal.candidates?.options ?? [];
        const idKey = pending.proposal.candidates?.idKey;
        const chosen = choiceIndex(text, options.length);
        if (chosen !== null && idKey !== undefined) {
          const option = options[chosen]!;
          if (pending.proposal.risk === "read") {
            // שאילתה — הבחירה היא כל מה שחסר; הצריכה אטומית, מבצע יחיד
            const took = await this.takePending(user.tenantId, user.id, pending.token);
            this.consumed(chat, took);
            if (!took) return { text: "הבקשה כבר טופלה.", speak: "הבקשה כבר טופלה." };
            took.extraParams[idKey] = option.id;
            return this.runProposal(chat, took);
          }
          /*
           * המעבר בחירה ⟵ אישור נכתב **בשורה עצמה**, מותנה בחותם
           * הישן, ולא רק בזיכרון.
           *
           * שינוי בזיכרון שנשמר אחר כך בכתיבה לא מותנית היה דורס
           * הצעה חדשה שמסלול מקביל הספיק לשמור בין הצילום לשמירה —
           * וההצעה שהמתווך זה עתה קיבל הייתה נמחקת (ביקורת Codex).
           * `keepStoredPending` דולק בשני המקרים: מכאן והלאה מה
           * שבשורה הוא המקור, ואין טעם לכתוב אותו שוב.
           */
          const next: PendingState = {
            ...pending,
            extraParams: { ...pending.extraParams, [idKey]: option.id },
            awaiting: "confirm",
            // חותם חדש: הכפתורים החדשים הם היחידים התקפים מכאן
            token: ulid(),
          };
          const advanced = await this.advancePending(
            user.tenantId,
            user.id,
            pending.token,
            next,
          );
          chat.keepStoredPending = true;
          if (!advanced) return { text: STALE_PROPOSAL_TEXT, speak: STALE_PROPOSAL_TEXT };
          chat.pending = next;
          const chosenBody = [
            `נבחר: ${option.label}${option.detail ? ` (${option.detail})` : ""}.`,
            "",
            this.describeProposal(next.proposal),
          ].join("\n");
          return {
            text: `${chosenBody}\n\n✅ לביצוע — *אשר* · ❌ לביטול — *בטל*`,
            buttonBody: chosenBody,
            buttons: confirmButtons(next.token),
            // השם בלי ה-detail — הפרט מהמאגר יכול לשאת טלפון
            speak: `נבחר ${option.label}. ${this.spokenProposal(next.proposal)}. לביצוע אמרו אשר.`,
          };
        }
      }
      if (pending.awaiting === "confirm" && isConfirmMessage(text)) {
        /*
         * צריכה אטומית: UPDATE יחיד שמרוקן את ההצעה ומחזיר אותה. שני
         * "אשר" שמגיעים במקביל — אחד מקבל את ההצעה ומבצע, השני מקבל
         * null ותשובה שקטה, לא ביצוע כפול (ביקורת Codex).
         */
        const took = await this.takePending(user.tenantId, user.id, pending.token);
        this.consumed(chat, took);
        if (!took) {
          const answer = "הפעולה כבר בוצעה או בוטלה — אין הצעה ממתינה.";
          return { text: answer, speak: answer };
        }
        return this.runProposal(chat, took);
      }
      /*
       * לא אישור, לא ביטול ולא בחירה — המתווך ממשיך לדבר: "לא, 4
       * חדרים". ההצעה הקודמת נשלחת כהקשר תיקון, בדיוק כמו במסך.
       */
      return withHeard(await this.propose(chat, text, pending, speaker), heard);
    }

    /*
     * ‎**„כן” על מה שהסוכן הרגע הציע.**
     *
     * הסוכן מסיים תשובה בהצעת המשך („רוצה שנעבור על המשימות?”),
     * המתווך עונה „כן” — ובלי הענף הזה המילה מגיעה למנוע תלושה
     * לגמרי, כי ההצעה נוסחה בתשובה ולא נשמרה בשום מקום. מה שחזר
     * בפועל היה „במה אוכל לעזור?”, כלומר הסוכן שאל את מה שהוא
     * עצמו הרגע הציע (דיווח מהשטח).
     *
     * ‎**המשפט מוזרם כאילו הוקלד**, בדיוק כמו לחיצה על כפתור
     * ההמשך — אותו מסלול, אותו אישור לפעולה שכותבת. „כן” אינו
     * עוקף כלום; הוא רק אומר *על מה* מדובר.
     *
     * רק כשאין הצעה ממתינה (`pending` נבדק למעלה) ורק על ההצעה
     * ‎**האחרונה**: „כן” אחרי שיחה שלמה על משהו אחר אינו חוזר
     * להצעה משבוע שעבר.
     */
    const offered = isConfirmMessage(text) ? lastOffer(chat.history) : null;
    if (offered !== null) {
      return withHeard(await this.propose(chat, offered, null, speaker), heard);
    }

    return withHeard(await this.propose(chat, text, null, speaker), heard);
  }

  /** פירוש ⟵ הצעה ⟵ או ביצוע מיידי (קריאה) או בקשת אישור. */
  private async propose(
    chat: ChatState,
    text: string,
    prior: PendingState | null,
    speaker: { name: string; roleLabel: string },
    /** הפעולה שהמתווך בחר מ„אולי התכוונת” — הבחירה שלו, לא של המודל */
    pin?: string,
  ): Promise<AgentReply> {
    const interpretation = await this.interpreter.interpret(
      text,
      prior
        ? { action: prior.proposal.actionId, params: this.paramsOf(prior) }
        : undefined,
      chat.history.slice(-HISTORY_KEPT),
      "whatsapp",
      speaker,
      pin,
    );
    /*
     * ההפניות מהעדכונים שהסוכן שלח — מה ש„אליו” חל עליו.
     *
     * כאן הן מגיעות מזיכרון השיחה השמור, שסבב ההתראות כתב לו את מה
     * ששלח בפועל. בבקר המסך אותו דבר בדיוק נגזר מההתראות עצמן
     * (`AgentMemoryService`) — שני איסופים, אותה פונקציה משותפת,
     * ואותה התנהגות בשני הערוצים.
     */
    const proposal = await this.resolver.toProposal(
      text,
      interpretation,
      undefined,
      historyRefs(chat.history),
    );

    if (proposal.actionId === "unknown") {
      // ברכה/שאלה כללית — תשובה שיחתית, לא "לא הבנתי" יבש
      if (proposal.reply !== undefined && proposal.reply !== "") {
        // תשובה שיחתית קצרה — מוקראת כולה בתשובה קולית
        return { text: proposal.reply, speak: proposal.reply };
      }
      const suggestions = proposal.suggestions ?? [];
      /*
       * ‎**„לא הבנתי” עם דרך החוצה.**
       *
       * „נסו לנסח אחרת” הוא קיר: המתווך אינו יודע *איך* אחרת, ולרוב
       * פשוט מפסיק. כאן מוצעות הפעולות שכמעט התאימו — בשמן ובדוגמת
       * הניסוח שלהן — ולחיצה מפרשת מחדש את **המשפט שכבר אמר** במקום
       * לבקש ממנו לכתוב הכול שוב.
       */
      if (suggestions.length > 0) {
        const token = ulid();
        chat.pending = {
          transcript: text,
          proposal,
          awaiting: "suggest",
          extraParams: {},
          token,
          suggestions: suggestions.map((s) => s.actionId),
        };
        const body = [
          // שאלת ההבהרה קודמת ואינה נבלעת: היא ספציפית, וההצעות כלליות
          proposal.clarify ?? "לא הייתי בטוחה מה לעשות.",
          ...proposal.warnings.map((warning) => `⚠️ ${warning}`),
          "אולי התכוונתם ל:",
          ...suggestions.map((s, i) => `${i + 1}. ${s.title} — „${s.example}”`),
        ].join("\n");
        const rows: WhatsAppListRow[] = suggestions.map((s, i) => ({
          action: "pick",
          arg: String(i + 1),
          token,
          title: s.title,
          description: s.example,
        }));
        const speak = "לא הייתי בטוחה מה לעשות — הצעתי כמה אפשרויות.";
        return {
          text: `${body}\n\nאפשר לענות במספר, או לנסח אחרת.`,
          buttonBody: body,
          ...choiceVariant(rows),
          speak,
        };
      }
      /*
       * ‎**„נסו לנסח אחרת” כשאף ניסוח לא יעזור.**
       *
       * ‎`fallback` = מנוע ההבנה לא היה זמין והכריע מנוע החוקים,
       * שמגיע לחלק מהפעולות בלבד. עבור כל השאר אין הצעות (מנוע
       * החוקים אינו יודע „מה כמעט התאים”, ובצדק) — ולכן המתווך קיבל
       * הוראה לנסח מחדש בקשה שתיכשל שוב עד שהספק יחזור, והסיק
       * שהסוכן אינו מבין אותו.
       *
       * המסך אמר את זה; כאן זה פשוט לא נאמר. הנוסח משותף לשני
       * הערוצים, והרשימה נגזרת מאותה מפה שמכריעה מה עובד.
       */
      const clarify = proposal.fallback
        ? AGENT_DEGRADED_REASON
        : (proposal.clarify ?? "לא הצלחתי להבין מה לעשות — נסו לנסח אחרת.");
      const lines = proposal.degraded.length > 0 ? [...proposal.degraded] : [clarify];
      for (const warning of proposal.warnings) lines.push(`⚠️ ${warning}`);
      // מוקראת השאלה עצמה — האזהרות נשארות בטקסט
      return { text: lines.join("\n"), speak: clarify };
    }

    const candidates = proposal.candidates;
    /*
     * רשימה ריקה = אין במה לבחור, ולכן אין מה לבצע.
     *
     * המסך חוסם את האישור במצב הזה; כאן זה נבדק רק כש-`length > 0`,
     * ולכן „תראה לי את הכרטיס המלא” בלי שם היה מריץ מיד את פעולת
     * הקריאה — או מציע אישור על פעולת כתיבה — ורק אז נופל על „לא
     * נבחר כרטיס”. שני הצרכנים של אותה הכרעה חייבים לקרוא אותה אותו
     * דבר (ביקורת Codex).
     */
    if (candidates && candidates.options.length === 0) {
      chat.pending = null;
      const answer =
        candidates.reason === "unsaid"
          ? `לא הבנתי ${candidates.label}. כתבו לי את השם ואמשיך מכאן.`
          : `לא מצאתי רשומה מתאימה — ${candidates.label}. אפשר לנסח אחרת או לבדוק את השם.`;
      return { text: answer, speak: answer };
    }
    if (candidates && candidates.options.length > 0) {
      const token = ulid();
      chat.pending = { transcript: text, proposal, awaiting: "choice", extraParams: {}, token };
      const options = candidates.options.slice(0, 9);
      const header = `*${proposal.title}* — ${candidates.label}:`;
      const lines = [header];
      options.forEach((option, i) => {
        lines.push(`${i + 1}. ${option.label}${option.detail ? ` — ${option.detail}` : ""}`);
      });
      /*
       * עד שלושה מועמדים — כפתורים; יותר מזה — רשימה נפתחת.
       *
       * Meta מתירה שלושה כפתורים בלבד, ורשימה עד עשר שורות. הטקסט
       * הממוספר נשאר בכל מקרה: הוא מה שנשלח כשההודעה האינטראקטיבית
       * אינה אפשרית, והוא גם מאפשר לענות במספר במקום ללחוץ.
       */
      const rows: WhatsAppListRow[] = options.map((option, i) => ({
        action: "pick",
        arg: String(i + 1),
        token,
        title: option.label,
        ...(option.detail ? { description: option.detail } : {}),
      }));
      return {
        text: `${lines.join("\n")}\n\n🔢 השיבו עם המספר המתאים · ❌ לביטול — *בטל*`,
        buttonBody: header,
        ...choiceVariant(rows),
        /*
         * מוקראת רק השאלה — לא האפשרויות: הפרטים שלהן מגיעים מהמאגר
         * ויכולים לשאת טלפון, והבחירה ממילא נעשית מול המסך.
         */
        speak: `${proposal.title} — ${candidates.label}. שלחתי רשימה לבחירה, אפשר לענות במספר.`,
      };
    }

    const state: PendingState = {
      transcript: text,
      proposal,
      awaiting: "confirm",
      extraParams: {},
      token: ulid(),
    };

    // שאילתת קריאה בלי שרשור ובלי שאלה פתוחה — עונים מיד, בלי טקס
    // אישור. הכלל משותף לשני הערוצים — ראו proposalRunsImmediately.
    if (proposalRunsImmediately(proposal)) {
      return this.runProposal(chat, state);
    }

    chat.pending = state;
    const description = this.describeProposal(proposal);
    return {
      text: `${description}\n\n✅ לביצוע — *אשר* · ❌ לביטול — *בטל* · ✏️ לתיקון פשוט כתבו אותו`,
      buttonBody: `${description}\n\n✏️ לתיקון — פשוט כתבו מה לשנות`,
      buttons: confirmButtons(state.token),
      // כרטיס אישור הוא התשובה הנפוצה ביותר — מי שדיבר שומע גם אותו
      speak: `${this.spokenProposal(proposal)}. לביצוע אמרו אשר, לביטול בטל.`,
    };
  }

  /** הפרמטרים לביצוע — שדות ההצעה + בחירות, מצומצמים כמו בבקר. */
  private paramsOf(state: PendingState): Record<string, unknown> {
    const merged: Record<string, unknown> = {};
    for (const field of state.proposal.fields) merged[field.key] = field.value;
    Object.assign(merged, state.extraParams);
    return this.narrow(state.proposal.actionId, merged);
  }

  private narrow(actionId: string, source: Record<string, unknown>): Record<string, unknown> {
    const action = agentAction(actionId);
    if (!action) return {};
    const params: Record<string, unknown> = {};
    for (const field of action.fields) {
      if (source[field.key] !== undefined) params[field.key] = source[field.key];
    }
    for (const field of action.resolved ?? []) {
      if (source[field.key] !== undefined) params[field.key] = source[field.key];
    }
    for (const key of AGENT_ID_KEYS) {
      if (typeof source[key] === "string") params[key] = source[key];
    }
    return params;
  }

  /** ביצוע ההצעה + צעדי ההמשך, עדכון הזיכרון, וניסוח התשובה. */
  private async runProposal(
    chat: ChatState,
    state: PendingState,
  ): Promise<Pick<AgentReply, "text" | "speak" | "audio" | "buttons" | "buttonBody">> {
    const params = this.paramsOf(state);
    let primary: ExecuteResult;
    try {
      primary = await this.executor.execute(
        state.proposal.actionId,
        params,
        state.transcript,
        "whatsapp",
      );
    } catch (error) {
      // גם הכישלון מדובר — שתיקה אחרי „אשר” קולי גרועה מכל תשובה
      const failure = `„${state.proposal.title}” לא בוצע: ${errorMessage(error)}`;
      return { text: `⚠️ ${failure}`, speak: failure };
    }

    /*
     * ✅ לפני תוצאה של פעולה שמשנה נתונים.
     *
     * לא קישוט: בצ'אט שמתגלגל אי אפשר לדעת ממבט אם הבקשה בוצעה או
     * שהסוכן רק הסביר משהו. סימן אחד בתחילת השורה עונה על זה.
     * לשאילתות אין סימן — שם התוצאה עצמה היא התשובה.
     */
    const done = state.proposal.risk === "read" ? "" : "✅ ";
    /*
     * ‎**ההרכב והסדר מגיעים מהתוכנית המשותפת** — `agentReplySegments`
     * מכתיב מה מופיע ומתי לשני הערוצים (הנחיית בעל המוצר: ליבה
     * אחת, בלי כפילות). כאן רק הרינדור לטקסט: כל מקטע לשורה.
     * הראש (מסקנה⟵תובנה⟵נתונים) מרונדר לפני צעדי ההמשך המבוצעים,
     * והזנב (קישורים⟵צעדים) אחריהם — כמו תמיד.
     */
    const segments = agentReplySegments({
      message: primary.message,
      ...(primary.insight === undefined ? {} : { insight: primary.insight }),
      ...(primary.data === undefined ? {} : { data: primary.data }),
      ...(primary.href === undefined ? {} : { href: primary.href }),
      ...(primary.link === undefined ? {} : { link: primary.link }),
      ...(primary.suggestion === undefined ? {} : { suggestion: primary.suggestion }),
      ...(primary.nextSteps === undefined ? {} : { nextSteps: primary.nextSteps }),
    });
    const tailStart = segments.findIndex(
      (segment) =>
        segment.kind === "screen-link" ||
        segment.kind === "external-link" ||
        segment.kind === "steps" ||
        segment.kind === "suggestion",
    );
    const head = tailStart === -1 ? segments : segments.slice(0, tailStart);
    const tail = tailStart === -1 ? [] : segments.slice(tailStart);

    const lines: string[] = [];
    let steps: { text: string; label: string }[] = [];
    /**
     * ‎**המשפט שהסוכן הציע** — מה ש„כן” בתור הבא יפעיל.
     *
     * נלכד כאן ולא מנוסח מחדש: זה בדיוק אותו משפט שהכפתור נושא,
     * ולכן „כן” והלחיצה מריצים את אותו הדבר בדיוק.
     */
    let offer: string | undefined;
    const renderSegment = (segment: (typeof segments)[number]): void => {
      switch (segment.kind) {
        case "headline":
          lines.push(`${done}${segment.text}`);
          break;
        case "insight":
          lines.push(`💡 ${segment.text}`);
          break;
        case "data": {
          /*
           * עיצוב הנתונים הוא של הערוץ: הרשימות הייעודיות (חזרות,
           * כרטיס) קודם — הן יודעות על הצורה שלהן יותר; אחר כך
           * הרשימה המשותפת (`agentResultText`, אותה בחירה כמו
           * הפאנל); ורק בסוף הסורק הכללי.
           */
          const summary =
            formatCallbacks(segment.data) ??
            formatCard(segment.data) ??
            agentResultText(segment.data) ??
            summarizeData(segment.data);
          if (summary !== "") lines.push(summary);
          /*
           * סייג ההיקף — מקטע ערוצי, צמוד לנתונים: „אין קונים
           * בגבעתיים” בלי הסייג נשמע כמו עובדה על המשרד, בזמן
           * שהתשובה מסוננת לבעלות.
           */
          const scope = scopeNote(state.proposal.actionId);
          if (scope !== "") lines.push(scope);
          break;
        }
        case "screen-link":
          lines.push(`👈 ${loadEnv().WEB_ORIGIN}${segment.href}`);
          break;
        // קישור חיצוני (wa.me) — מוצג ואינו נשמר: יכול לשאת טלפון
        case "external-link":
          lines.push(`👈 ${segment.url}`);
          break;
        /*
         * ‎**צעדי ההמשך — כפתורים שקשורים לתוכן, וגם טקסט.** כל צעד
         * הופך לכפתור `cmd` שנושא את המשפט עצמו — לחיצה שולחת אותו
         * למנוע כאילו הוקלד, אין מסלול ביצוע שני. המשפטים נשארים
         * בטקסט: כשההודעה האינטראקטיבית אינה אפשרית `deliver` נופל
         * לטקסט, והמתווך עדיין רואה מה אפשר לענות.
         */
        case "steps":
          steps = segment.steps.filter((step) => step.text.length <= CMD_TEXT_MAX);
          // מה ש„כן” יפעיל בתור הבא — הראשון, שהוא גם הכפתור הראשון
          if (steps[0] !== undefined) offer = steps[0].text;
          if (steps.length > 0) {
            lines.push(
              steps.length === 1
                ? `👉 אפשר להמשיך: „${steps[0]!.text}”`
                : ["👉 אפשר להמשיך:", ...steps.map((step) => `· „${step.text}”`)].join("\n"),
            );
          }
          break;
        // רשת הביטחון המנוסחת — התוכנית פולטת אותה רק בהיעדר צעדים
        case "suggestion":
          offer = segment.text;
          lines.push(`👉 אפשר להמשיך: „${segment.text}”`);
          break;
      }
    };
    for (const segment of head) renderSegment(segment);

    // צעדי המשך — לפי הסדר, וכישלון באמצע מדווח בשקיפות (כמו במסך)
    /*
     * הרשומות שנגעו בהן, **מהמאוחרת לקדומה.**
     *
     * „תוסיף קונה דנה ותזכיר לי להתקשר אליה” הוא אישור אחד ושתי
     * פעולות, ותוצאת צעד ההמשך נזרקה אחרי שההודעה שלה נוספה — ולכן
     * „תסגור אותה” בתור הבא חזר לחיפוש כותרת (ביקורת Codex).
     * ‎`unshift` שומר על הסדר שבו `matchHistoryRef` בוחרת את האחרון
     * שבוצע.
     */
    const acted: (AgentHistoryRef | undefined)[] = [primary.ref];
    for (const followUp of state.proposal.followUps ?? []) {
      const stepParams = this.narrow(
        followUp.actionId,
        Object.fromEntries(followUp.fields.map((f) => [f.key, f.value])),
      );
      try {
        const result = await this.executor.execute(
          followUp.actionId,
          stepParams,
          undefined,
          "whatsapp",
        );
        lines.push(`· ${result.message}`);
        // רק צעד שהצליח — הפניה לרשומה שלא נוצרה היא שיוך לכלום
        acted.unshift(result.ref);
      } catch (error) {
        lines.push(`· „${followUp.title}” לא בוצע: ${errorMessage(error)}`);
        break;
      }
    }

    // הזנב של התוכנית — קישורים וצעדי המשך, אחרי מה שכבר בוצע
    for (const segment of tail) renderSegment(segment);

    /*
     * ההקלטה נשלפת **כאן**, בתוך הקשר הדייר.
     *
     * `CallsService.recording` אוכף בעלות על השיחה, והמשלוח קורה
     * אחרי שההקשר נסגר — לכן הבייטים נוסעים עם התשובה ולא הפניה
     * שהייתה דורשת לפתוח הקשר שני.
     */
    let audio: AgentReply["audio"];
    if (primary.audio !== undefined) {
      try {
        const rec = await this.executor.recording(primary.audio.callId);
        const chunks: Buffer[] = [];
        let bytes = 0;
        for await (const chunk of rec.body) {
          const buf = Buffer.from(chunk as Buffer);
          bytes += buf.length;
          if (bytes > WA_AUDIO_SOURCE_MAX_BYTES) break;
          chunks.push(buf);
        }
        /*
         * התקרה כאן היא של הזיכרון, לא של Meta: ההקלטה עוד תעבור
         * המרה שמכווצת אותה, ותקרת השליחה נאכפת על התוצר.
         */
        if (bytes > WA_AUDIO_SOURCE_MAX_BYTES) {
          lines.push("🎧 ההקלטה ארוכה מכדי לשלוח בוואטסאפ — היא זמינה במסך השיחות.");
        } else {
          audio = {
            buffer: Buffer.concat(chunks),
            mimeType: rec.contentType,
            label: primary.audio.label,
            // הקישור מצביע על השיחה עצמה — הוא מה שיישלח אם המדיה תיכשל
            ...(primary.href === undefined ? {} : { href: primary.href }),
          };
        }
      } catch (error) {
        lines.push(`🎧 ההקלטה לא נשלפה: ${errorMessage(error)}`);
      }
    }

    /*
     * שורות התוצאה נלקחות מהראשית בלבד — הן מה שנשלח למתווך
     * כרשימה. לצעד המשך יש שורת הודעה, לא רשימה.
     */
    const refs = agentTurnRefs(acted, agentResultRefs(primary.data));
    const turn: AgentHistoryTurn = {
      transcript: state.transcript,
      action: state.proposal.actionId,
      params,
      /*
       * זיכרון השיחה נשלח לפרומפט של המודל בתור הבא, ולכן הוא
       * **אינו** התשובה שהמתווך ראה: שורת המצב והשמות לפי הסדר,
       * בלי טלפונים, אימיילים, הערות ותקצירי שיחות. `agentHistorySummary`
       * מסביר למה בדיוק כך ולא פחות ולא יותר.
       */
      resultSummary: agentHistorySummary(primary.message, primary.data),
      /*
       * המזהים של מה שהוצג ושל מה שהפעולה נגעה בו — **בצד שלנו, לא
       * בפרומפט.**
       *
       * התווית לבדה אינה מפתח חיפוש אמין: רישא של שם ארוך שבעליו
       * אינו בין אלף אנשי הקשר האחרונים אינה נמצאת בשום מסלול.
       * ההפניה פותרת את הביטוי לפני החיפוש (ביקורת Codex).
       *
       * ‎`agentTurnRefs` מוסיפה את הרשומה של הפעולה עצמה — הכרטיס
       * שנפתח, הקונה שנוצר — שאינה רשימה ולכן לא הותירה עקבה.
       */
      ...(refs.length === 0 ? {} : { refs }),
      ...(offer === undefined ? {} : { offer }),
    };
    /*
     * שתי הרשימות: `history` היא מה שנשלח לפרומפט ולכן נחתכת
     * לתקרה, ו-`added` היא מה שיישמר ולכן אינה נחתכת כאן — החיתוך
     * שלה קורה במיזוג עם השורה, מול מה שנמצא שם בפועל.
     */
    chat.history = [...chat.history.slice(-(HISTORY_KEPT - 1)), turn];
    chat.added = [...chat.added, turn];
    /*
     * הכפתורים — כשיש צעדים ואין שמע. הודעת שמע נשלחת בנפרד ואינה
     * אינטראקטיבית, וגוף ארוך מהתקרה ממילא נופל לטקסט ב-`deliver`.
     */
    /*
     * מה מוקרא בתשובה קולית: המסקנה והתובנה — המקטעים שעוזר היה
     * אומר בקול. רשימות, קישורים וצעדים נשארים בטקסט: אי אפשר
     * ללחוץ על משפט מוקרא.
     */
    const speak = segments
      .filter((segment) => segment.kind === "headline" || segment.kind === "insight")
      .map((segment) => segment.text)
      .join(". ");

    const stepButtons: WhatsAppButton[] = steps.map((step) => ({
      action: "cmd",
      arg: step.text,
      title: step.label,
    }));
    return {
      text: lines.join("\n"),
      ...(speak === "" ? {} : { speak }),
      ...(audio === undefined ? {} : { audio }),
      ...(stepButtons.length > 0 && audio === undefined
        ? { buttons: stepButtons, buttonBody: lines.join("\n") }
        : {}),
    };
  }

  /**
   * ההצעה כמו שאומרים אותה בקול — בלי כוכביות, אימוג'י ותבליטים.
   *
   * מוקרא רק מה שהמתווך עצמו אמר (השדות שפוענחו מהמשפט שלו) ומה
   * שהסוכן שואל — לא פרטי מועמדים מהמאגר, שיכולים לשאת טלפון.
   */
  private spokenProposal(proposal: AgentProposal): string {
    const parts = [proposal.title];
    if (proposal.summary !== "") parts.push(proposal.summary);
    const fields = proposal.fields.map((field) => `${field.label}: ${field.display}`);
    if (fields.length > 0) parts.push(fields.join(", "));
    if (proposal.missing.length > 0) {
      parts.push(`חסר להשלמה: ${proposal.missing.map((m) => m.label).join(", ")}`);
    }
    for (const warning of proposal.warnings) parts.push(warning);
    if (proposal.clarify !== undefined) parts.push(proposal.clarify);
    return parts.join(". ");
  }

  /** ההצעה כפי שהמסך היה מציג אותה — כותרת, שדות, חוסרים ואזהרות. */
  private describeProposal(proposal: AgentProposal): string {
    const lines = [`*${proposal.title}*`];
    if (proposal.summary !== "") lines.push(proposal.summary);
    for (const field of proposal.fields) {
      lines.push(`• ${field.label}: ${field.display}`);
    }
    if (proposal.missing.length > 0) {
      lines.push(`חסר להשלמה: ${proposal.missing.map((m) => m.label).join(", ")}`);
    }
    for (const warning of proposal.warnings) lines.push(`⚠️ ${warning}`);
    if (proposal.clarify !== undefined) lines.push(`❓ ${proposal.clarify}`);
    for (const followUp of proposal.followUps ?? []) {
      lines.push(`וגם, באותו אישור: *${followUp.title}*`);
      for (const field of followUp.fields) lines.push(`   • ${field.label}: ${field.display}`);
    }
    return lines.join("\n");
  }

  /* ------------------------------------------------------------------ */
  /*  אחסון מצב השיחה — תחת RLS                                          */
  /* ------------------------------------------------------------------ */

  /**
   * תפיסת ההודעה **לפני** הטיפול, לא אחריו. Meta שולח כפולים — לעיתים
   * במקביל, כשה-ACK הלך לאיבוד — ותפיסה שנשמרת רק בסוף הייתה משאירה
   * חלון שבו "אשר" כפול מבצע את אותה פעולה פעמיים (ביקורת Codex).
   * מנעול-ייעוץ פר-שיחה עושה את הבדיקה-ואת-הרישום אטומיים: הראשון
   * רושם את המזהה ומקבל את מצב השיחה; השני רואה את המזהה ופורש.
   */
  private async claimMessage(
    tenantId: string,
    userId: string,
    externalId: string,
  ): Promise<ChatState | null> {
    return this.prisma.withExplicitTenant(tenantId, async (tx) => {
      // אותה נעילה של כל כותבי השיחה — ראו agent/conversation.ts
      await lockConversation(tx, tenantId, userId);
      const row = await tx.whatsAppChat.findUnique({
        where: { tenantId_userId: { tenantId, userId } },
        select: { pending: true, history: true, handledIds: true },
      });
      const handled = Array.isArray(row?.handledIds) ? (row.handledIds as string[]) : [];
      if (handled.includes(externalId)) return null;
      const handledIds = [externalId, ...handled].slice(0, HANDLED_KEPT);
      /*
       * החותמת נכתבת כאן ולא בשליחת התשובה: מה שפותח את חלון 24
       * השעות של Meta הוא ההודעה של המתווך, גם אם הטיפול בה נכשל.
       * בלעדיה כל דחיפת התראה הייתה יוצאת אל דחייה של Meta.
       */
      const lastInboundAt = new Date();
      await tx.whatsAppChat.upsert({
        where: { tenantId_userId: { tenantId, userId } },
        create: { id: ulid(), tenantId, userId, handledIds, lastInboundAt },
        update: { handledIds, lastInboundAt },
      });
      return {
        pending: (row?.pending as unknown as PendingState | null) ?? null,
        history: parseTurns(row?.history),
        added: [],
        handledIds,
      };
    });
  }

  /**
   * צריכת ההצעה הממתינה — ראו `whatsapp-pending.ts`.
   *
   * ה-SQL יצא לשם כדי שיהיה אפשר להריץ אותו מול מסד אמיתי: זהו כל
   * מנגנון האטומיות של „אשר”, וכל עוד הוא היה קבור כאן אף בדיקה לא
   * נגעה בו — ובאג שביטל את הביצוע לחלוטין חי בייצור.
   */
  private async takePending(
    tenantId: string,
    userId: string,
    expectToken?: string,
  ): Promise<PendingState | null> {
    const row = await this.prisma.withExplicitTenant(tenantId, (tx) =>
      takePendingRow(tx, tenantId, userId, expectToken),
    );
    return row === null ? null : (row as unknown as PendingState);
  }

  /** החלפת ההצעה הממתינה באחרת — ראו `whatsapp-pending.ts`. */
  private async advancePending(
    tenantId: string,
    userId: string,
    expectToken: string | undefined,
    next: PendingState,
  ): Promise<boolean> {
    const value = next as unknown as Prisma.InputJsonValue;
    return this.prisma.withExplicitTenant(tenantId, (tx) =>
      advancePendingRow(tx, tenantId, userId, expectToken, value),
    );
  }

  /**
   * שמירת ההצעה וההיסטוריה בלבד — **לא** מזהי ההודעות: אלה נכתבים רק
   * ב-claimMessage, אחרת שמירה מאוחרת הייתה דורסת תפיסה מקבילה.
   */
  private async saveChat(tenantId: string, userId: string, chat: ChatState): Promise<void> {
    await this.prisma.withExplicitTenant(tenantId, async (tx) => {
      /*
       * אותה נעילה של `claimMessage`, של צ'אט המסך ושל סורק
       * ההתראות בוורקר — כולם כותבים לאותה עמודה, והיא מה שמסדר
       * אותם בתור. הנעילה, הפירוק והמיזוג משותפים — ראו
       * ‎agent/conversation.ts: ניסוח מקומי כאן הוא מה שמפריד
       * את הערוצים.
       */
      await lockConversation(tx, tenantId, userId);
      const row = await tx.whatsAppChat.findUnique({
        where: { tenantId_userId: { tenantId, userId } },
        select: { history: true },
      });
      const merged = mergeTurns(parseTurns(row?.history), chat.added);
      const data = {
        // Prisma דורש את הסמן המפורש ל-null בעמודת JSON — לא null גולמי
        ...(chat.keepStoredPending === true
          ? {}
          : {
              pending:
                chat.pending === null
                  ? Prisma.JsonNull
                  : (chat.pending as unknown as Prisma.InputJsonValue),
            }),
        history: turnsAsJson(merged),
      };
      await tx.whatsAppChat.upsert({
        where: { tenantId_userId: { tenantId, userId } },
        create: { id: ulid(), tenantId, userId, handledIds: chat.handledIds, ...data },
        update: data,
      });
    });
  }
}

/**
 * שאילתות שהתוצאה שלהן מצומצמת לבעלות, והיכולות שפותחות אותן למשרד
 * כולו. פעולה שאינה כאן מחזירה ממילא נתוני משרד (נכסים, התאמות).
 *
 * יומן השיחות דורש את שתיהן — הוא מסונן כל עוד חסרה אחת מהן
 * (`CallsService`), ולכן הסייג מוצג כשחסרה ולו אחת.
 */
const SCOPE_CAPABILITIES: Record<string, readonly Capability[]> = {
  find_buyers: ["buyers.view_all"],
  show_leads: ["leads.view_all"],
  show_tasks: ["tasks.view_all"],
  /*
   * יומן השיחות מסונן גם לפי מודול הנכסים: שיחה של בעל נכס נשמטת
   * ממי שהמודול חסום אצלו (`seesAllContacts`). בלי היכולת השלישית
   * כאן הסייג היה נעלם דווקא כשחלק מההיסטוריה אכן הוסתר.
   */
  show_calls: ["buyers.view_all", "leads.view_all", "properties.view"],
  /*
   * „למי לחזור” שואבת משלושה מקורות — שיחות, לידים ומשימות —
   * ולכן דורשת את איחוד היכולות שלהם.
   *
   * ההודעה מכריזה מספר („3 ממתינים לחזרה”), ומספר בלי הסייג נשמע
   * כמו תור החזרות של כל המשרד בזמן שהוא האישי בלבד. בפעולה
   * שהתשובה שלה היא רשימת מטלות זו לא אי-דיוק אלא הנחיה שגויה
   * (ביקורת Codex).
   *
   * `calendar.manage` ברשימה מסיבה שנייה: בלעדיה מקור המשימות אינו
   * נשאל כלל (גבול המודול), ולכן הרשימה חסרה — וסייג שנעלם דווקא אז
   * היה מציג רשימה מקוצצת כאילו היא מלאה.
   */
  show_callbacks: [
    "buyers.view_all",
    "leads.view_all",
    "properties.view",
    "tasks.view_all",
    "calendar.manage",
  ],
};

/** קבוצות החיפוש הכללי שמסוננות לפי בעלות — הנכסים אינם ביניהן. */
const SEARCH_SCOPED_GROUPS: readonly { capability: Capability; label: string }[] = [
  { capability: "buyers.view_all", label: "קונים" },
  { capability: "leads.view_all", label: "לידים" },
];

function scopeNote(actionId: string): string {
  const capabilities = TenantContext.current().capabilities;

  /*
   * חיפוש כללי מחזיר כמה סוגי רשומות, ורק חלקם מסוננים לפי בעלות:
   * הנכסים הם של המשרד ומוצגים במלואם. סייג גורף היה אומר על תוצאת
   * נכסים מלאה שהיא חלקית (ביקורת Codex) — ולכן הוא מונה בשם את
   * הקבוצות המצומצמות, ומזכיר את הנכסים רק למי שרואה אותם.
   */
  if (actionId === "search") {
    const restricted = SEARCH_SCOPED_GROUPS.filter(
      (group) => !capabilities.has(group.capability),
    ).map((group) => group.label);
    if (restricted.length === 0) return "";
    const properties = capabilities.has("properties.view") ? "; נכסים — מכל המשרד" : "";
    return `_(${restricted.join(" ו")} — מהרשומות שמשויכות אליך בלבד${properties})_`;
  }

  const required = SCOPE_CAPABILITIES[actionId];
  if (required === undefined) return "";
  if (required.every((capability) => capabilities.has(capability))) return "";
  return "_(מהרשומות שמשויכות אליך — לא מכל המשרד)_";
}

/**
 * תחילית „שמעתי: …” נכנסת לשני הנוסחים — המלא וזה שמתחת לכפתורים.
 * בלעדיה גרסת הכפתורים לא הייתה מראה מה נשמע בהקלטה, וזה בדיוק
 * הדבר שמאפשר לתפוס שגיאת תמלול לפני שמאשרים פעולה.
 */
function withHeard(reply: AgentReply, heard: string): AgentReply {
  if (heard === "") return reply;
  return {
    ...reply,
    text: heard + reply.text,
    ...(reply.buttonBody === undefined ? {} : { buttonBody: heard + reply.buttonBody }),
  };
}

/** „דוד כהן” ⇒ „דוד” — פנייה בשם פרטי, כמו שמדברים בוואטסאפ. */
function firstName(name: string): string {
  return name.trim().split(/\s+/u)[0] ?? name;
}

/**
 * ההכרות הראשונה. שלוש שורות ושלוש דוגמאות — לא מדריך.
 *
 * מי שלא יודע *באיזה ניסוח* לבקש מנסה פעם אחת, מקבל „לא הבנתי”,
 * וחוזר לדשבורד. הדוגמאות הן הניסוחים שהמודל מאומן עליהם.
 */
function welcomeText(name: string, allowedIds: readonly string[]): string {
  /** עד שלוש דוגמאות — הכרות, לא קטלוג. */
  const examples = agentWelcomeExamples(allowedIds, 3);
  return [
    `היי ${firstName(name)} 👋`,
    "אני העוזרת האישית שלך במתווכים — כאן בוואטסאפ, בלי להיכנס למערכת.",
    "",
    ...(examples.length > 0
      ? ["אפשר לכתוב לי או *להקליט* הודעה קולית, למשל:", ...examples.map((e: string) => `   „${e}”`), ""]
      : ["אפשר לכתוב לי או *להקליט* הודעה קולית.", ""]),
    "לרשימה המלאה כתבו *עזרה*.",
  ].join("\n");
}

/** שגיאת Nest נושאת הודעה בעברית — היא התשובה; כל השאר מנוסח כללי. */
function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message !== "") return error.message;
  return "שגיאה לא צפויה";
}

