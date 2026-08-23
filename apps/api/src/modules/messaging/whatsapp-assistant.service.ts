import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ulid } from "ulid";
import {
  agentAction,
  applyBlockedModules,
  resolveCapabilities,
  roleLabel,
  decodeButtonId,
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
import { tenantPeriodEnded, tenantSuspended } from "../auth/auth.service";
import { AgentExecuteService, type ExecuteResult } from "../agent/execute.service";
import { AgentInterpretService } from "../agent/interpret.service";
import { AgentResolveService } from "../agent/resolve.service";
import { TranscriptionService } from "../../modules/voice-intake/transcription.service";
import {
  choiceIndex,
  isCancelMessage,
  isConfirmMessage,
  isHelpMessage,
  waPhoneVariants,
} from "./assistant-lang";
import { helpMenu, welcomeExamples, type HelpAction } from "./assistant-help";
import {
  buttonAsText,
  confirmButtons,
  SNOOZE_LABEL,
  SNOOZE_MINUTES,
  type AgentReply,
} from "./assistant-buttons";
import { prospectReplyText } from "./prospect-reply";
import { WhatsAppSendService } from "./whatsapp-send.service";

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
/** כמה תורות נשמרים לזיכרון השיחה — כמו המסך הקולי. */
const HISTORY_KEPT = 6;
/** כמה מזהי הודעות נשמרים ל-Idempotency — Meta חוזר תוך דקות. */
const HANDLED_KEPT = 30;
/** המענה השיווקי למספר לא רשום — לכל היותר פעם בשבוע לכל מספר. */
const PROSPECT_REPLY_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
/** מעל זה התמלול מקבל הודעת „מתמלל…” — מתחת לזה התשובה עצמה מגיעה. */
const SLOW_TRANSCRIBE_NOTICE_MS = 6_000;
/** המפתחות שההצעה פותרת לבחירת רשומה — כמו ב-AgentController. */
const ID_KEYS = ["buyerId", "propertyId", "taskId", "cardId", "leadId"] as const;

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
  awaiting: "confirm" | "choice";
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
}

interface ChatState {
  pending: PendingState | null;
  history: AgentHistoryTurn[];
  handledIds: string[];
}

interface IdentifiedUser {
  id: string;
  tenantId: string;
  name: string;
  role: string;
  whatsappAccess: boolean;
  tenant: {
    status: string;
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
    const user = await this.identifyUser(msg.fromWaId);
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
    if (tenantPeriodEnded(user.tenant)) {
      await this.sender.sendText(
        msg.fromWaId,
        "תקופת המנוי של המשרד הסתיימה — חדשו אותה במסך ניהול המשרד, ואחזור לעבוד מיד.",
        { replyTo: msg.externalId },
      );
      return;
    }
    if (!(await this.plans.tenantHasFeature(user.tenantId, FEATURE_ID))) {
      await this.sender.sendText(msg.fromWaId, "הסוכן החכם אינו כלול במסלול של המשרד.", {
        replyTo: msg.externalId,
      });
      return;
    }
    /*
     * המנוי לסוכן הוואטסאפ הוא **לכל סוכן בנפרד** — לא לכל המשרד.
     * בעל המשרד מפעיל אותו לכל סוכן במסך ניהול המשרד, ורק בעל
     * המשרד עצמו כלול תמיד: הוא בעל המנוי, ואיש אינו מוסמך להדליק
     * לו את הדגל (הנתיב מגן על שורת ה-owner מכל עריכה).
     */
    if (!user.whatsappAccess && user.role !== "owner") {
      await this.sender.sendText(
        msg.fromWaId,
        "הסוכן האישי בוואטסאפ אינו פעיל עבורך עדיין. בעל המשרד יכול להפעיל אותו במסך ניהול משרד ← סוכני המשרד.",
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
      await this.sender.sendText(msg.fromWaId, welcomeText(user.name, allowed));
    }

    /*
     * לחיצה על כפתור מתורגמת למילה שהשיחה כבר יודעת לפרש, כדי שלא
     * יהיה מסלול ביצוע שני שצריך לזכור את אותם כללי אטומיות.
     * „שקט לשעתיים” הוא היחיד שאינו פקודת שיחה ולכן מטופל כאן.
     */
    const button = msg.buttonId === undefined ? null : decodeButtonId(msg.buttonId);
    if (button?.action === "snooze") {
      await this.snoozeNotifications(user.tenantId, user.id);
      await this.sender.sendText(
        msg.fromWaId,
        `🔕 ${SNOOZE_LABEL}. לא אפריע עד אז — ואם תצטרכו משהו קודם, פשוט כתבו לי.`,
        { replyTo: msg.externalId },
      );
      return;
    }

    // „עזרה” — מהקטלוג, בלי קריאת מודל ובלי סיכוי להזכיר פעולה חסומה
    if (msg.type === "text" && isHelpMessage(msg.text ?? "")) {
      await this.sender.sendText(msg.fromWaId, helpMenu(allowed, firstName(user.name)), {
        replyTo: msg.externalId,
      });
      return;
    }

    if (
      button !== null &&
      (button.action === "confirm" || button.action === "cancel" || button.action === "pick") &&
      this.staleClick(chat.pending, button.token)
    ) {
      await this.sender.sendText(
        msg.fromWaId,
        "ההצעה שהכפתור הזה שייך לה כבר אינה ממתינה — היא בוצעה, בוטלה, או הוחלפה בבקשה חדשה. כתבו לי מה לעשות ואכין אותה מחדש.",
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

    const reply = await TenantContext.run(context, () =>
      this.converse(user, chat, text, "transcribed" in spoken && spoken.transcribed === true),
    );

    await this.saveChat(user.tenantId, user.id, chat);
    await this.deliver(msg, reply);
  }

  /**
   * שליחת התשובה — כפתורים כשיש, וטקסט כשאין או כשהם לא יצאו.
   *
   * ההודעה האינטראקטיבית מוגבלת ל-1024 תווים ויכולה להידחות; הנפילה
   * חזרה לטקסט המלא מבטיחה שהמתווך תמיד מקבל תשובה שאפשר לפעול
   * לפיה, גם אם בהקלדה במקום בלחיצה.
   */
  private async deliver(msg: AssistantInbound, reply: AgentReply): Promise<void> {
    const body = reply.buttonBody ?? reply.text;
    if (reply.buttons && reply.buttons.length > 0) {
      if (await this.sender.sendButtons(msg.fromWaId, body, reply.buttons)) return;
    } else if (reply.list && reply.list.rows.length > 0) {
      if (await this.sender.sendList(msg.fromWaId, body, reply.list.label, reply.list.rows)) {
        return;
      }
    }
    await this.sender.sendText(msg.fromWaId, reply.text, { replyTo: msg.externalId });
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

  /** השתקה רגעית של העדכונים היזומים — הסורק מדלג עליה. */
  private async snoozeNotifications(tenantId: string, userId: string): Promise<void> {
    const until = new Date(Date.now() + SNOOZE_MINUTES * 60 * 1000);
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
  private async identifyUser(waId: string): Promise<IdentifiedUser | null> {
    const variants = waPhoneVariants(waId);
    if (variants[0] === undefined || variants[0] === "") return null;
    // שתי השוואות מפורשות ולא IN על מערך — פרמטרים פשוטים ובטוחים
    const matched = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM users
      WHERE is_active = TRUE
        AND phone IS NOT NULL
        AND (regexp_replace(phone, '\\D', '', 'g') = ${variants[0]}
             OR regexp_replace(phone, '\\D', '', 'g') = ${variants[1] ?? variants[0]})
      ORDER BY last_login_at DESC NULLS LAST
      LIMIT 2`;
    const first = matched[0];
    if (!first) return null;
    if (matched.length > 1) {
      // אותו מספר אצל שני משתמשים — הפעיל לאחרונה מנצח, אבל זה נרשם
      this.logger.warn(`מספר וואטסאפ משויך ליותר ממשתמש אחד — נבחר ${first.id}`);
    }
    const user = await this.prisma.user.findUnique({
      where: { id: first.id },
      select: {
        id: true,
        tenantId: true,
        name: true,
        role: true,
        whatsappAccess: true,
        tenant: {
          select: {
            status: true,
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
        const took = await this.takePending(user.tenantId, user.id);
        chat.pending = null;
        return { text: took ? "❌ בוטל. מה הלאה?" : "אין פעולה ממתינה לביטול." };
      }
      if (pending.awaiting === "choice") {
        const options = pending.proposal.candidates?.options ?? [];
        const idKey = pending.proposal.candidates?.idKey;
        const chosen = choiceIndex(text, options.length);
        if (chosen !== null && idKey !== undefined) {
          const option = options[chosen]!;
          if (pending.proposal.risk === "read") {
            // שאילתה — הבחירה היא כל מה שחסר; הצריכה אטומית, מבצע יחיד
            const took = await this.takePending(user.tenantId, user.id);
            chat.pending = null;
            if (!took) return { text: "הבקשה כבר טופלה." };
            took.extraParams[idKey] = option.id;
            return { text: await this.runProposal(chat, took) };
          }
          pending.extraParams[idKey] = option.id;
          pending.awaiting = "confirm";
          // חותם חדש: הכפתורים החדשים הם היחידים התקפים מכאן
          pending.token = ulid();
          const chosenBody = [
            `נבחר: ${option.label}${option.detail ? ` (${option.detail})` : ""}.`,
            "",
            this.describeProposal(pending.proposal),
          ].join("\n");
          return {
            text: `${chosenBody}\n\n✅ לביצוע — *אשר* · ❌ לביטול — *בטל*`,
            buttonBody: chosenBody,
            buttons: confirmButtons(pending.token),
          };
        }
      }
      if (pending.awaiting === "confirm" && isConfirmMessage(text)) {
        /*
         * צריכה אטומית: UPDATE יחיד שמרוקן את ההצעה ומחזיר אותה. שני
         * "אשר" שמגיעים במקביל — אחד מקבל את ההצעה ומבצע, השני מקבל
         * null ותשובה שקטה, לא ביצוע כפול (ביקורת Codex).
         */
        const took = await this.takePending(user.tenantId, user.id);
        chat.pending = null;
        if (!took) return { text: "הפעולה כבר בוצעה או בוטלה — אין הצעה ממתינה." };
        return { text: await this.runProposal(chat, took) };
      }
      /*
       * לא אישור, לא ביטול ולא בחירה — המתווך ממשיך לדבר: "לא, 4
       * חדרים". ההצעה הקודמת נשלחת כהקשר תיקון, בדיוק כמו במסך.
       */
      return withHeard(await this.propose(chat, text, pending, speaker), heard);
    }

    return withHeard(await this.propose(chat, text, null, speaker), heard);
  }

  /** פירוש ⟵ הצעה ⟵ או ביצוע מיידי (קריאה) או בקשת אישור. */
  private async propose(
    chat: ChatState,
    text: string,
    prior: PendingState | null,
    speaker: { name: string; roleLabel: string },
  ): Promise<AgentReply> {
    const interpretation = await this.interpreter.interpret(
      text,
      prior
        ? { action: prior.proposal.actionId, params: this.paramsOf(prior) }
        : undefined,
      chat.history.slice(-HISTORY_KEPT),
      "whatsapp",
      speaker,
    );
    const proposal = await this.resolver.toProposal(text, interpretation);

    if (proposal.actionId === "unknown") {
      // ברכה/שאלה כללית — תשובה שיחתית, לא "לא הבנתי" יבש
      if (proposal.reply !== undefined && proposal.reply !== "") return { text: proposal.reply };
      const lines = [proposal.clarify ?? "לא הצלחתי להבין מה לעשות — נסו לנסח אחרת."];
      for (const warning of proposal.warnings) lines.push(`⚠️ ${warning}`);
      return { text: lines.join("\n") };
    }

    const candidates = proposal.candidates;
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
      /*
       * כפתורים רק כששלוש התוויות שונות זו מזו.
       *
       * כפתור מציג כותרת בלבד, ולכן שני קונים בשם „משה כהן” היו
       * נראים זהים — והמתווך היה בוחר בניחוש, על כרטיס של מישהו
       * אחר (ביקורת Codex). כשיש התנגשות עוברים לרשימה, שם לכל
       * שורה יש תיאור מבחין.
       */
      const labels = rows.map((row) => row.title.trim());
      const distinct = new Set(labels).size === labels.length;
      return {
        text: `${lines.join("\n")}\n\n🔢 השיבו עם המספר המתאים · ❌ לביטול — *בטל*`,
        buttonBody: header,
        ...(rows.length <= 3 && distinct
          ? { buttons: rows.map(({ description: _ignored, ...button }) => button) }
          : { list: { label: "בחירה", rows } }),
      };
    }

    const state: PendingState = {
      transcript: text,
      proposal,
      awaiting: "confirm",
      extraParams: {},
      token: ulid(),
    };

    // שאילתת קריאה בלי שרשור ובלי שאלה פתוחה — עונים מיד, בלי טקס אישור
    if (
      proposal.risk === "read" &&
      (proposal.followUps ?? []).length === 0 &&
      proposal.clarify === undefined
    ) {
      return { text: await this.runProposal(chat, state) };
    }

    chat.pending = state;
    const description = this.describeProposal(proposal);
    return {
      text: `${description}\n\n✅ לביצוע — *אשר* · ❌ לביטול — *בטל* · ✏️ לתיקון פשוט כתבו אותו`,
      buttonBody: `${description}\n\n✏️ לתיקון — פשוט כתבו מה לשנות`,
      buttons: confirmButtons(state.token),
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
    for (const key of ID_KEYS) {
      if (typeof source[key] === "string") params[key] = source[key];
    }
    return params;
  }

  /** ביצוע ההצעה + צעדי ההמשך, עדכון הזיכרון, וניסוח התשובה. */
  private async runProposal(chat: ChatState, state: PendingState): Promise<string> {
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
      return `⚠️ „${state.proposal.title}” לא בוצע: ${errorMessage(error)}`;
    }

    /*
     * ✅ לפני תוצאה של פעולה שמשנה נתונים.
     *
     * לא קישוט: בצ'אט שמתגלגל אי אפשר לדעת ממבט אם הבקשה בוצעה או
     * שהסוכן רק הסביר משהו. סימן אחד בתחילת השורה עונה על זה.
     * לשאילתות אין סימן — שם התוצאה עצמה היא התשובה.
     */
    const done = state.proposal.risk === "read" ? "" : "✅ ";
    const lines: string[] = [`${done}${primary.message}`];
    const dataSummary = summarizeData(primary.data);
    if (dataSummary !== "") lines.push(dataSummary);
    /*
     * סייג ההיקף — התשובה היא על *הנתונים שלו*, לא של המשרד.
     *
     * השאילתות מסוננות לפי בעלות מזה זמן (`ownershipFilter`), אבל
     * התשובה לא אמרה זאת: „אין קונים בגבעתיים” נשמע כמו עובדה על
     * המשרד, בזמן שלעמית ממול יש שלושה כאלה. משפט אחד הופך תשובה
     * מטעה לתשובה נכונה.
     */
    const scope = scopeNote(state.proposal.actionId);
    if (scope !== "") lines.push(scope);
    if (primary.insight !== undefined && primary.insight !== "") lines.push(`💡 ${primary.insight}`);

    // צעדי המשך — לפי הסדר, וכישלון באמצע מדווח בשקיפות (כמו במסך)
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
      } catch (error) {
        lines.push(`· „${followUp.title}” לא בוצע: ${errorMessage(error)}`);
        break;
      }
    }

    // קישור למסך המלא — לרשומה שנוצרה או לרשימה שנשאלה
    if (primary.href !== undefined) {
      lines.push(`👈 ${loadEnv().WEB_ORIGIN}${primary.href}`);
    }
    // צעד ההמשך המוצע — המתווך פשוט עונה עם המשפט והמעגל נמשך
    if (primary.suggestion !== undefined && primary.suggestion !== "") {
      lines.push(`👉 אפשר להמשיך: „${primary.suggestion}”`);
    }

    chat.history = [
      ...chat.history.slice(-(HISTORY_KEPT - 1)),
      {
        transcript: state.transcript,
        action: state.proposal.actionId,
        params,
        resultSummary: [primary.message, dataSummary]
          .filter((part) => part !== "")
          .join(". ")
          .slice(0, 600),
      },
    ];
    return lines.join("\n");
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
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wa-chat:${tenantId}:${userId}`}, 0))`;
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
        history: Array.isArray(row?.history) ? (row.history as unknown as AgentHistoryTurn[]) : [],
        handledIds,
      };
    });
  }

  /**
   * צריכת ההצעה הממתינה — UPDATE אטומי יחיד שמרוקן ומחזיר. רק מי
   * שקיבל שורה מבצע; קריאה מקבילה מקבלת null ולא מבצעת שוב.
   */
  private async takePending(tenantId: string, userId: string): Promise<PendingState | null> {
    return this.prisma.withExplicitTenant(tenantId, async (tx) => {
      const rows = await tx.$queryRaw<{ pending: unknown }[]>`
        UPDATE whatsapp_chats SET pending = NULL, updated_at = now()
        WHERE tenant_id = ${tenantId} AND user_id = ${userId} AND pending IS NOT NULL
        RETURNING pending`;
      const value = rows[0]?.pending;
      return value ? (value as PendingState) : null;
    });
  }

  /**
   * שמירת ההצעה וההיסטוריה בלבד — **לא** מזהי ההודעות: אלה נכתבים רק
   * ב-claimMessage, אחרת שמירה מאוחרת הייתה דורסת תפיסה מקבילה.
   */
  private async saveChat(tenantId: string, userId: string, chat: ChatState): Promise<void> {
    const data = {
      // Prisma דורש את הסמן המפורש ל-null בעמודת JSON — לא null גולמי
      pending:
        chat.pending === null
          ? Prisma.JsonNull
          : (chat.pending as unknown as Prisma.InputJsonValue),
      history: chat.history as unknown as Prisma.InputJsonValue,
    };
    await this.prisma.withExplicitTenant(tenantId, (tx) =>
      tx.whatsAppChat.upsert({
        where: { tenantId_userId: { tenantId, userId } },
        create: { id: ulid(), tenantId, userId, handledIds: chat.handledIds, ...data },
        update: data,
      }),
    );
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
  show_tasks: ["tasks.view_all"],
  show_calls: ["buyers.view_all", "leads.view_all"],
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
function welcomeText(name: string, actions: readonly HelpAction[]): string {
  const examples = welcomeExamples(actions);
  return [
    `היי ${firstName(name)} 👋`,
    "אני העוזרת האישית שלך במתווכים — כאן בוואטסאפ, בלי להיכנס למערכת.",
    "",
    ...(examples.length > 0
      ? ["אפשר לכתוב לי או *להקליט* הודעה קולית, למשל:", ...examples.map((e) => `   „${e}”`), ""]
      : ["אפשר לכתוב לי או *להקליט* הודעה קולית.", ""]),
    "לרשימה המלאה כתבו *עזרה*.",
  ].join("\n");
}

/** שגיאת Nest נושאת הודעה בעברית — היא התשובה; כל השאר מנוסח כללי. */
function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message !== "") return error.message;
  return "שגיאה לא צפויה";
}

/**
 * שמות התוצאות לפי הסדר — כמו במסך הקולי: זה מה שמאפשר "תתקשר
 * לראשון מהם" בהודעה הבאה, וזה גם מה שנשמר בזיכרון השיחה.
 */
function summarizeData(data: unknown): string {
  const labels: string[] = [];
  const collect = (items: unknown): void => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (labels.length >= 5 || typeof item !== "object" || item === null) return;
      const record = item as Record<string, unknown>;
      const label = record["name"] ?? record["title"] ?? record["marketingTitle"];
      if (typeof label === "string" && label !== "") labels.push(label);
    }
  };
  if (Array.isArray(data)) collect(data);
  else if (typeof data === "object" && data !== null) {
    for (const value of Object.values(data as Record<string, unknown>)) collect(value);
  }
  return labels.length > 0 ? `בין התוצאות, לפי הסדר: ${labels.join(", ")}` : "";
}
