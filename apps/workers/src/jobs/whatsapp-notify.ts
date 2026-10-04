import { type Prisma } from "@prisma/client";
import { ulid } from "ulid";
import {
  contactIdsFromSources,
  seesAllContactsWith,
  visibleContactFilters,
  callLeadIds,
  notificationAnchorIds,
  notificationSubjectMap,
  redactNotifications,
  type AnchorSubject,
  type NotificationViewer,
  type RedactableNotification,
  assistantMemoryTurn,
  conversationLockKey,
  mergeStoredTurns,
  parseStoredTurns,
  formatNotifyMessage,
  notifyFollowUp,
  dominantNotifyCategory,
  AGENT_ACTIONS,
  mayUseAction,
  effectiveCapabilities,
  type Capability,
  type CapabilityOverride,
  inQuietHours,
  notifyQuickReplies,
  type AgentHistoryTurn,
  fitsInteractive,
  type WhatsAppButton,
  replyButtonsPayload,
  splitForWhatsApp,
  sessionWindowOpen,
  shouldNotifyByWhatsApp,
  templateParams,
  templateLineParams,
  notificationUrl,
  whatsappDeepLinkSuffix,
  whatsappTemplateButton,
  whatsappTemplateParams,
  webOriginFromEnv,
  whatsappNotifyRecipient,
  type WhatsAppNotifyPrefs,
} from "@metavchim/shared";
import { prisma, withTenant } from "../runtime.js";
import { tenantHasFeature } from "../tenant-settings.js";
import {
  jerusalemHour,
  sendWhatsApp,
  WA_NOTIFY_BATCH,
  WA_NOTIFY_MAX_AGE_MS,
  whatsappConfig,
} from "../whatsapp/config.js";
import { loadNotifyDetails } from "../whatsapp/details.js";

interface WaRecipient {
  userId: string;
  /** מנורמל לצורה הבינלאומית — היחידה ש-Meta מקבלת */
  phone: string;
  /** היכולות בפועל — שער הפרטים שההודעה נושאת */
  capabilities: readonly string[];
  prefs: WhatsAppNotifyPrefs;
  windowOpen: boolean;
  /**
   * „שקט לשעתיים” פעיל — דחייה, לא ויתור.
   *
   * הנמען נשאר ברשימה בכוונה: הוצאתו ממנה הייתה מוציאה אותו גם
   * מחשבון הסגירה של ההתראה, ההתראה הייתה נסגרת כאילו הגיעה לכולם,
   * ומה שהצטבר בשעתיים היה נמחק במקום להישלח אחריהן (ביקורת Codex).
   */
  snoozed: boolean;
  /** עד מתי כבר קיבל — מונע כפילות כשנמען אחר של אותה התראה נכשל */
  notifiedThrough: Date | null;
  /**
   * ‎**מזהי הפעולות** שמותרות לו — לא היכולות שלו.
   *
   * ‏ההבחנה אינה סמנטית: `notifyFollowUp` משווה מול מזהה פעולה
   * (`show_callbacks`), ורשימת יכולות (`leads.view_own`) לעולם
   * אינה מכילה אותו. כלומר העברת היכולות הייתה מכבה את הכפתור
   * הנגזר תמיד, בשקט.
   *
   * נגזר מהיכולות **בפועל** (תפקיד + חריגים + מודולים חסומים) —
   * ראו `allowedActionsFor`.
   */
  allowedActionIds: readonly string[];
}

/**
 * ‎**הפעולות שהמשתמש הזה רשאי להריץ — ביכולות שלו בפועל.**
 *
 * ‏הגרסה הראשונה גזרה מ-`ROLE_CAPABILITIES` בלבד, במטמון פר-תפקיד.
 * זה נראה זול ונכון, והוא **חולק על מסלול ההרשאה האמיתי** שאותו
 * מריץ הסוכן ברגע שלוחצים על הכפתור (`buildContext`): שם התפקיד
 * הוא רק נקודת הפתיחה, ומעליו יושבים חריגי `userCapability`
 * וחסימת מודולים של המשרד (ביקורת Codex).
 *
 * שני הכיוונים נשברו, ולשניהם יש קורבן:
 *
 * ‎**חריג `deny`, או מודול חסום** ⟵ הכפתור מוצג, והלחיצה נוחתת על
 * „אין לך הרשאה”. זה בדיוק מה שהסינון נועד למנוע.
 *
 * ‎**חריג `grant`** ⟵ המשתמש קיבל את היכולת, ובכל זאת רואה רק את
 * הכפתור הכללי. יכולת שניתנה במפורש ואינה מגיעה למסך.
 *
 * ולכן אין כאן מטמון פר-תפקיד: החריגים הם פר-משתמש, ומטמון כזה
 * שגוי בהגדרה ולא רק לא-מדויק.
 */
function allowedActionsFor(capabilities: Set<Capability>): readonly string[] {
  return AGENT_ACTIONS.filter((action) => mayUseAction(action, capabilities)).map(
    (action) => action.id,
  );
}

/**
 * ‎**הצנזורה של ההתראות — גם בערוצי הדחיפה** (ביקורת Codex, P1).
 *
 * ‏שורת התראה נכתבת פעם אחת ונקראת לנצח, והכתיבה מצנזרת לפי
 * ‏ההרשאות של רגע הכתיבה. המסך כבר אוכף את הגבול בקריאה — ושני
 * ‏הסבבים כאן המשיכו לשלוח את הכותרת והגוף הגולמיים לטלפון: שם
 * ‏הלקוח, המספר, ולפעמים קישור טופס נושא־אסימון. השתקה, שעות שקט
 * ‏או חלון סגור רק מאריכים את הפער — ההתראה ממתינה בתור ויוצאת
 * ‏אחרי שהגישה כבר נשללה.
 *
 * ‏הכלל עצמו יושב ב-`@metavchim/shared`, כי לתהליך הזה אין גישה
 * ‏ל-API. מה שנכתב כאן הוא **השאילתות בלבד**; המדיניות — אילו
 * ‏מקורות, מי רואה הכול, איך נראית שורה מצונזרת — היא אותה
 * ‏פונקציה שהשרת קורא.
 */

/** ‏העוגן ⟵ איש הקשר. פעם אחת למשרד: זה אינו תלוי בצופה. */
export async function notificationAnchorSubjects(
  tenantId: string,
  rows: readonly RedactableNotification[],
): Promise<Map<string, AnchorSubject>> {
  const { leadIds, buyerIds, callIds } = notificationAnchorIds(rows);
  if (leadIds.length + buyerIds.length + callIds.length === 0) return new Map();
  return withTenant(tenantId, async (tx) => {
    const [buyers, calls] = await Promise.all([
      buyerIds.length === 0
        ? []
        : tx.buyer.findMany({
            /*
             * ‎**וגם כאן `deletedAt: null`** — התאום של
             * ‏`notification-visibility.ts`, וההסבר המלא שם.
             *
             * ‏העובד אינו יכול לייבא מ-`@metavchim/api`, ולכן שתי
             * ‏השליפות האלה הן שכפול מודע — וזה בדיוק סוג השכפול
             * ‏שבו תיקון נוחת בצד אחד בלבד.
             */
            where: { tenantId, id: { in: buyerIds }, deletedAt: null },
            select: { id: true, contactId: true, ownerUserId: true },
          }),
      callIds.length === 0
        ? []
        : tx.call.findMany({
            where: { tenantId, id: { in: callIds } },
            select: { id: true, contactId: true, leadId: true },
          }),
    ]);
    /* ‏הלידים אחרי השיחות — שיחה ממספר לא מוכר נפתרת דרך הליד שלה */
    const allLeadIds = [...new Set([...leadIds, ...callLeadIds(calls)])];
    const leads =
      allLeadIds.length === 0
        ? []
        : await tx.lead.findMany({
            where: { tenantId, id: { in: allLeadIds } },
            select: { id: true, contactId: true, assignedToUserId: true },
          });
    return notificationSubjectMap(leads, buyers, calls);
  });
}

/**
 * ‏הלקוחות שהצופה רשאי לראות, או `null` כשאין מה לסנן.
 *
 * ‎`null` הוא ברירת המחדל של כל תפקיד קיים, ולכן משרד שלא הפעיל
 * ‏הפרדה אינו משלם ולו שאילתה אחת.
 */
export async function visibleContactIdSet(
  tenantId: string,
  userId: string,
  capabilities: ReadonlySet<Capability>,
): Promise<Set<string> | null> {
  if (seesAllContactsWith(capabilities)) return null;
  const filters = visibleContactFilters(tenantId, userId, capabilities);
  return withTenant(tenantId, async (tx) => {
    const [buyers, leads, properties] = await Promise.all([
      filters.buyers === null
        ? []
        : tx.buyer.findMany({ where: filters.buyers, select: { contactId: true } }),
      filters.leads === null
        ? []
        : tx.lead.findMany({ where: filters.leads, select: { contactId: true } }),
      filters.properties === null
        ? []
        : tx.property.findMany({
            where: filters.properties,
            select: { ownerContactId: true, occupantContactId: true },
          }),
    ]);
    return new Set(contactIdsFromSources(buyers, leads, properties));
  });
}

/** ‏היכולות בפועל לכל משתמש במשרד — שאילתה אחת, לא אחת לנמען. */
export async function capabilitiesByUser(
  tenantId: string,
  users: readonly { id: string; role: string }[],
  blockedModules: readonly string[],
  now: Date,
): Promise<Map<string, Set<Capability>>> {
  const overrides = await withTenant(tenantId, async (tx) => {
    return tx.userCapability.findMany({
      where: { tenantId, userId: { in: users.map((u) => u.id) } },
      select: { userId: true, capability: true, effect: true, expiresAt: true },
    });
  });
  const overridesOf = new Map<string, CapabilityOverride[]>();
  for (const row of overrides) {
    const list = overridesOf.get(row.userId) ?? [];
    list.push({
      capability: row.capability as Capability,
      effect: row.effect === "grant" ? "grant" : "deny",
      expiresAt: row.expiresAt,
    });
    overridesOf.set(row.userId, list);
  }
  return new Map(
    users.map((user) => [
      user.id,
      effectiveCapabilities(
        { role: user.role, overrides: overridesOf.get(user.id) ?? [], blockedModules: [...blockedModules] },
        now,
      ),
    ]),
  );
}

export async function processWhatsAppNotifySweep(): Promise<void> {
  const config = await whatsappConfig();
  if (!config) return; // הצד היוצא אינו מוגדר — אין מה לדחוף
  /*
   * ‎**דרך הכלל המשותף, ולא `process.env` גולמי.**
   *
   * ‏שתי התקלות שהשורה הקודמת (`process.env["WEB_ORIGIN"] ?? ""`)
   * ‏אפשרה שקטות באותה מידה, ושתיהן נראות מבחוץ כמו „הבוט שולח
   * ‏קישורים שבורים”:
   *
   * ‏לוכסן בסוף הערך → `https://host//properties/123`, נתיב שאינו
   * ‏קיים, כלומר „העמוד לא נמצא” על כל קישור שיוצא מכאן.
   * ‏משתנה חסר → `""`, והקישור יוצא כנתיב יחסי שבוואטסאפ אינו
   * ‏קישור בכלל.
   *
   * ‎`loadEnv()` של ה-API כבר נירמל, אבל ה-Workers אינם עוברים
   * ‏דרכו — ולכן התיקון ההוא כיסה תהליך אחד מתוך שניים, והתהליך
   * ‏שנשאר בחוץ הוא בדיוק זה ששולח את ההודעות (דיווח המשתמש).
   */
  const webOrigin = webOriginFromEnv(process.env["WEB_ORIGIN"]);
  if (webOrigin === null) {
    // ‏שתיקה כאן שולחת הודעות עם קישור שבור — עדיף לומר ולא לשלוח
    console.error("[wa-notify] WEB_ORIGIN חסר — הסבב מדלג, אחרת הקישורים יצאו שבורים");
    return;
  }
  const now = new Date();
  const since = new Date(now.getTime() - WA_NOTIFY_MAX_AGE_MS);
  const hour = jerusalemHour(now);
  const tenants = await prisma.tenant.findMany({ select: { id: true, blockedModules: true } });

  for (const tenant of tenants) {
    // אותו שער כמו הסוכן עצמו: הדחיפה היא חלק מהפיצ'ר, לא תוספת חינם
    if (!(await tenantHasFeature(tenant.id, "voice_intake"))) continue;

    const pending = await withTenant(tenant.id, async (tx) => {
      return tx.notification.findMany({
        where: { tenantId: tenant.id, whatsappAt: null, createdAt: { gte: since } },
        orderBy: { createdAt: "asc" },
        take: WA_NOTIFY_BATCH,
        select: {
          id: true,
          userId: true,
          type: true,
          title: true,
          body: true,
          entityType: true,
          entityId: true,
          // החותמת פר-משתמש נשענת עליו — בלעדיו אין ממה למדוד
          createdAt: true,
        },
      });
    });
    if (pending.length === 0) continue;

    /*
     * הנמענים: מחזיקי מקום בסוכן, עם טלפון, שהדליקו את ההתראות
     * (`whatsappNotifyRecipient`). אותם שערים בדיוק כמו במענה של הסוכן —
     * דחיפה למי שאינו מנוי הייתה מוצר בחינם, ולמי שכיבה היא ספאם.
     */
    const candidates = await prisma.user.findMany({
      where: {
        tenantId: tenant.id,
        isActive: true,
        phone: { not: null },
        whatsappAccess: true,
      },
      select: { id: true, phone: true, preferences: true, role: true, whatsappAccess: true },
    });
    const users = candidates.flatMap((user) => {
      const target = whatsappNotifyRecipient(user);
      return target === null ? [] : [{ id: user.id, role: user.role, ...target }];
    });
    /*
     * ‎**משרד בלי אף נמען סוגר את מה שממתין** (ביקורת Codex, P2).
     *
     * ‏בלי זה השורות נשארות פתוחות, והסבב טוען שוב את אותן מאתיים
     * ‏התראות ואת הפרטים שלהן בכל דקה, עד שהן מתיישנות אחרי יממה. זה
     * ‏המצב הרגיל של משרד שאין בו מחזיק מקום בסוכן — גם בעל המשרד אינו
     * ‏נמען בלעדיו. התראה שאין לה נמענים נסגרת, כמו בסוף הסבב.
     */
    if (users.length === 0) {
      await closeNotifications(tenant.id, pending.map((notification) => notification.id));
      continue;
    }

    /*
     * ‎**הפרטים נטענים פעם אחת למשרד, לא פעם לכל נמען.**
     *
     * ‏אותה התראה משרדית מגיעה לכמה סוכנים; טעינה פר-נמען הייתה
     * מכפילה את אותן שאילתות בדיוק. מה **מותר** לכל אחד לראות מתוך
     * מה שנטען מוכרע בהמשך, פר-נמען, ב-`canSeeNotifyDetail`.
     */
    const notifyDetails = await loadNotifyDetails(tenant.id, pending);

    const chats = await withTenant(tenant.id, async (tx) => {
      return tx.whatsAppChat.findMany({
        where: { tenantId: tenant.id, userId: { in: users.map((u) => u.id) } },
        select: {
          userId: true,
          lastInboundAt: true,
          notifiedThrough: true,
          notifySnoozeUntil: true,
        },
      });
    });
    const chatOf = new Map(chats.map((chat) => [chat.userId, chat]));

    /*
     * ‎**החריגים — באותה שאילתה אחת לכל הנמענים של המשרד.**
     *
     * ‏אותו מקור שהסוכן קורא ב-`buildContext`, ולכן הכפתור מציע
     * בדיוק את מה שהלחיצה תורשה להריץ. שאילתה אחת ולא אחת לכל
     * משתמש: הסבב עובר על כל המשרדים בכל דקה.
     */
    const capsOf = await capabilitiesByUser(tenant.id, users, tenant.blockedModules, now);
    /* ‏העוגנים פעם אחת למשרד — הם אינם תלויים בנמען */
    const anchorSubjects = await notificationAnchorSubjects(tenant.id, pending);

    const recipients = new Map<string, WaRecipient>();
    for (const user of users) {
      const chat = chatOf.get(user.id);
      /*
       * ‏אותה קבוצת יכולות משרתת שניים: אילו פעולות הכפתור רשאי
       * להציע, ואילו פרטים מותר לצרף להודעה. שני חישובים נפרדים
       * היו יכולים להיפרד — כפתור שמציע מה שההודעה מסתירה.
       */
      const capabilities = capsOf.get(user.id) ?? new Set<Capability>();
      recipients.set(user.id, {
        userId: user.id,
        phone: user.phone,
        prefs: user.prefs,
        windowOpen: sessionWindowOpen(chat?.lastInboundAt ?? null, now),
        snoozed: chat?.notifySnoozeUntil ? chat.notifySnoozeUntil > now : false,
        notifiedThrough: chat?.notifiedThrough ?? null,
        allowedActionIds: allowedActionsFor(capabilities),
        capabilities: [...capabilities],
      });
    }

    /*
     * החלוקה היא **פר-נמען**, וכל נמען מסונן מול החותמת שלו.
     *
     * זה מה שמונע כפילות: התראה משרדית שנשלחה בהצלחה לסוכן א' ונכשלה
     * אצל ב' נשארת בלי סימון, וא' לא יקבל אותה שוב כי החותמת שלו כבר
     * עברה אותה. שוויון חותמת נחשב „כבר נשלח” — עדיף לאבד התראה
     * בודדת במרוץ נדיר מלשלוח מאות כפילויות.
     */
    const delivered = new Map<string, Date>();
    /** תור הזיכרון של הסוכן על מה ששלח, פר-נמען */
    const remembered = new Map<string, AgentHistoryTurn>();
    for (const recipient of recipients.values()) {
      const watermark = recipient.notifiedThrough?.getTime() ?? 0;
      const queued = pending.filter(
        (notification) =>
          (!notification.userId || notification.userId === recipient.userId) &&
          shouldNotifyByWhatsApp(notification.type, recipient.prefs) &&
          notification.createdAt.getTime() > watermark,
      );
      if (queued.length === 0) continue;
      /*
       * ‎**הצנזורה לפני הניסוח, ולא רק על ההעשרה** (ביקורת Codex, P1).
       *
       * ‏עד כה היכולות של הנמען גדרו את `notifyDetails` בלבד,
       * ‏וההתראה עצמה עברה כמות שהיא ל-`formatNotifyMessage` — עם
       * ‏הכותרת והגוף הגולמיים. שורה משרדית ישנה שהמתינה בהשתקה,
       * ‏בשעות שקט או לחלון סגור יצאה אחרי שהגישה כבר נשללה.
       */
      const caps = new Set(recipient.capabilities as Capability[]);
      const viewer: NotificationViewer = {
        allowed: await visibleContactIdSet(tenant.id, recipient.userId, caps),
        userId: recipient.userId,
        capabilities: caps,
      };
      const { rows: items, censoredIds } = redactNotifications(queued, viewer, anchorSubjects);
      /*
       * ‎**וההעשרה יורדת עם השורה שצונזרה** (ביקורת Codex, P1).
       *
       * ‏שורה מצונזרת שומרת על המזהה שלה, ו-`formatNotifyMessage`
       * ‏שולף לפיו את `notifyDetails` — טבלה שנטענה לפני הצנזורה
       * ‏ושההרשאה שלה נפרדת ורפה יותר (`canSeeNotifyDetail` מסתפק
       * ‏ב-`buyers.view_all` או `leads.view_all`). השם והטלפון
       * ‏שהורדו מהכותרת חזרו לתחתית ההודעה.
       */
      const details =
        censoredIds.size === 0
          ? notifyDetails
          : new Map([...notifyDetails].filter(([id]) => !censoredIds.has(id)));

      /*
       * „שקט לשעתיים”, שעות שקט, וחלון 24 השעות של Meta — שלושתם
       * *דחייה*, לא ויתור. החותמת אינה זזה, והסבב הבא ירים את אותם
       * פריטים: בתום ההשתקה, בבוקר, או ברגע שהמתווך יכתוב לסוכן
       * ויפתח את החלון.
       */
      if (recipient.snoozed) continue;
      if (inQuietHours(hour, recipient.prefs)) continue;
      if (!recipient.windowOpen && config.template === null) continue;

      let ok: boolean;
      if (recipient.windowOpen) {
        /*
         * חיתוך לפי תקרת 4096 התווים של Meta — הודעה ארוכה יותר
         * נדחית כולה, כלומר הסוכן שותק דווקא ביום העמוס (ביקורת
         * Codex). אותה פונקציה שמשרתת את מענה הסוכן.
         */
        /*
         * כפתורים כשהגוף נכנס ב-1024 התווים שהודעה אינטראקטיבית
         * מתירה — הרבה פחות מ-4096 של טקסט. הודעה ארוכה יורדת
         * לטקסט מפוצל: עדיף עדכון מלא בלי כפתורים מאשר הודעה
         * שנדחית כולה.
         */
        const message = formatNotifyMessage(items, webOrigin, {
          viewer: { userId: recipient.userId, capabilities: recipient.capabilities },
          byNotificationId: details,
        });
        if (fitsInteractive(message)) {
          /*
           * ‎**הכפתור הראשון נגזר ממה שכתוב מעליו.**
           *
           * עד כה הוצמדו לכל הודעה אותם שניים בדיוק, ו„מה דחוף
           * היום?” מתחת להתראה על שיחה שלא נענתה או על פנייה ברשת
           * הוא כפתור שאינו קשור להודעה. `notifyFollowUp` נשען על
           * אותה קטגוריה שממנה נגזר כבר משפט הסיום.
           *
           * ‎**וכשאין פעולה מזמינה — אין כפתור בכלל.**
           *
           * „מה דחוף היום?” היה ברירת המחדל לכל מה ש-`notifyFollowUp`
           * לא כיסה, כלומר שאלה כללית מתחת להתראה ספציפית. עכשיו
           * הוא נשאר רק במקום שבו הוא באמת הצעד הבא — התקציר היומי.
           *
           * ‏ו„שקט לשעתיים” ירד לגמרי. הוא היה נצמד לכל הודעה כי
           * הוא היה **הדרך היחידה** להשתיק — פקד כפתור שאין לו
           * מקבילה בהקלדה. מאז שהסוכן מבין „שקט לחצי שעה”, „אל
           * תפריע לי עד מחר” ו„מספיק שקט” (`parseSnoozeRequest`),
           * כפתור קבוע מתחת לכל עדכון הוא רעש ולא שליטה.
           *
           * הודעה בלי אף כפתור נשלחת כטקסט: הודעה אינטראקטיבית
           * בלי כפתורים אינה חוקית ב-Meta.
           */
          const follow = notifyFollowUp(items, recipient.allowedActionIds);
          /*
           * ‎**המנטור מקבל כפתורים משלו** — „מתחייב”, „לענות למנטור”,
           * „היעדים שלי” (docs/14 §9). הגזירה למטה מדברת על לידים
           * ושיחות, ומתחת לסיכום שבועי היא כפתור זר.
           */
          const mentor = notifyQuickReplies(items, {
            viewer: { userId: recipient.userId, capabilities: recipient.capabilities },
            byNotificationId: details,
          });
          const buttons: WhatsAppButton[] = [];
          if (mentor !== null) {
            buttons.push(...mentor);
          } else if (follow !== null) {
            buttons.push({ action: "cmd", arg: follow.text, title: follow.label });
          } else if (dominantNotifyCategory(items) === "digests") {
            buttons.push({ action: "cmd", arg: "urgent", title: "📋 מה דחוף היום?" });
          }
          ok =
            buttons.length === 0
              ? await sendWhatsApp(config, {
                  messaging_product: "whatsapp",
                  to: recipient.phone,
                  type: "text",
                  text: { body: message, preview_url: false },
                })
              : await sendWhatsApp(
                  config,
                  replyButtonsPayload(recipient.phone, message, buttons),
                );
        } else {
          ok = true;
          for (const chunk of splitForWhatsApp(message)) {
            ok = await sendWhatsApp(config, {
              messaging_product: "whatsapp",
              to: recipient.phone,
              type: "text",
              text: { body: chunk, preview_url: false },
            });
            if (!ok) break;
          }
        }
      } else {
        /*
         * ‎**הכפתור מוביל לכרטיס עצמו, לא לדף הבית.**
         *
         * ‎`notificationUrl` היא אותה פונקציה שקובעת לאן מובילה
         * התראת הדפדפן, ולכן שני הערוצים נוחתים באותו מקום —
         * ולא כל אחד במסך אחר על אותו אירוע. אגד של כמה עדכונים
         * אינו מצביע על כרטיס אחד, ולכן הוא נופל למסך ההתראות.
         */
        const first = items[0];
        const target =
          items.length === 1 && first !== undefined ? notificationUrl(first) : "";
        const button = config.buttonUrl ? whatsappTemplateButton(whatsappDeepLinkSuffix(target)) : null;
        ok = await sendWhatsApp(config, {
          messaging_product: "whatsapp",
          to: recipient.phone,
          type: "template",
          template: {
            name: config.template,
            language: { code: config.templateLang },
            components: [
              {
                type: "body",
                /*
                 * שמות המשתנים, ולא מיקומים — תבנית של Meta בעלת
                 * שמות דוחה משלוח מיקומי.
                 *
                 * ‎**והצורה נקבעת מההגדרה, לא מהגרסה.** תבנית
                 * שנרשמה עם שני משתנים ומקבלת חמישה נדחית, וההתראה
                 * נעלמת בלי סימן — ולכן ברירת המחדל היא הישנה.
                 */
                parameters: config.templateLines
                  ? whatsappTemplateParams("notifyLines", templateLineParams(items))
                  : whatsappTemplateParams("notify", templateParams(items)),
              },
              ...(button === null ? [] : [button]),
            ],
          },
        });
      }
      if (!ok) continue;

      const through = items.reduce(
        (latest, item) => (item.createdAt > latest ? item.createdAt : latest),
        items[0]!.createdAt,
      );
      delivered.set(recipient.userId, through);
      /*
       * מה שנשלח נרשם גם כתור בשיחה — זה מה שנותן ל„תזכיר לי
       * להתקשר אליו” על מה לחול. `assistantMemoryTurn` גוזר את
       * הניסוח מסוג ההתראה ולא מכותרתה, ולכן שום טלפון אינו נכנס
       * לזיכרון שנשלח למודל.
       */
      const turn = assistantMemoryTurn(items);
      if (turn !== null) remembered.set(recipient.userId, turn);
    }

    /*
     * החותמות נשמרות **לפני** סימון ההתראות: אם התהליך ייפול כאן,
     * מה שכבר נשלח לא יישלח שוב. הסדר ההפוך היה מסמן התראה שנשלחה
     * ומאבד את החותמת — כלומר כפילות בסבב הבא.
     */
    if (delivered.size > 0) {
      await withTenant(tenant.id, async (tx) => {
        /*
         * ההיסטוריה נקראת ונכתבת כאן, ולא נבנית מאפס: המתווך יכול
         * לכתוב לסוכן בדיוק בין הקריאה לכתיבה, ודריסה עיוורת הייתה
         * מוחקת את מה שהוא אמר.
         *
         * **הנעילה היא מה שסוגר את החלון.** ‎`wa-chat:{משרד}:{משתמש}`
         * היא אותה נעילה ש-`claimMessage` ו-`saveChat` ב-API נוטלים,
         * ולכן שלושת הכותבים לעמודה הזו מסודרים בתור. בלעדיה
         * הקריאה כאן והשמירה בצד ה-API יכלו לדרוס זו את זו, ותור
         * שיחה שלם היה נעלם (ביקורת Codex).
         *
         * הנעילה נלקחת לכל משתמש בנפרד ולפי סדר קבוע — מיון לפי
         * מזהה — כדי ששני סבבים מקבילים לא ייתפסו זה בזה.
         */
        for (const userId of [...remembered.keys()].sort()) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${conversationLockKey(tenant.id, userId)}, 0))`;
        }
        const existing =
          remembered.size === 0
            ? []
            : await tx.whatsAppChat.findMany({
                where: { tenantId: tenant.id, userId: { in: [...remembered.keys()] } },
                select: { userId: true, history: true },
              });
        const historyOf = new Map(
          existing.map((row) => [
            row.userId,
            parseStoredTurns(row.history),
          ]),
        );

        for (const [userId, through] of delivered) {
          const turn = remembered.get(userId);
          const history =
            turn === undefined
              ? null
              : (mergeStoredTurns(historyOf.get(userId) ?? [], [turn]) as unknown);
          await tx.whatsAppChat.upsert({
            where: { tenantId_userId: { tenantId: tenant.id, userId } },
            create: {
              id: ulid(),
              tenantId: tenant.id,
              userId,
              notifiedThrough: through,
              ...(history === null ? {} : { history: history as Prisma.InputJsonValue }),
            },
            update: {
              notifiedThrough: through,
              ...(history === null ? {} : { history: history as Prisma.InputJsonValue }),
            },
          });
        }
      });
    }

    /*
     * סימון ההתראה עצמה הוא ניקיון בלבד: היא נסגרת כשכל נמעניה
     * האפשריים כבר מעבר לחותמת שלהם — או שאין לה נמענים כלל.
     * הדחיות (שקט, חלון סגור) נשארות פתוחות עד שיישלחו או יתיישנו.
     */
    const settled = pending
      .filter((notification) => {
        const targets = [...recipients.values()].filter(
          (recipient) =>
            (!notification.userId || notification.userId === recipient.userId) &&
            shouldNotifyByWhatsApp(notification.type, recipient.prefs),
        );
        return targets.every((recipient) => {
          const through = delivered.get(recipient.userId) ?? recipient.notifiedThrough;
          return through !== null && through !== undefined && through >= notification.createdAt;
        });
      })
      .map((notification) => notification.id);
    if (settled.length > 0) await closeNotifications(tenant.id, settled);
  }
}

/** ‏סימון התראות כסגורות — הסבב לא יחזור אליהן. ניקיון בלבד, ראו למעלה. */
async function closeNotifications(tenantId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await withTenant(tenantId, async (tx) => {
    await tx.notification.updateMany({
      where: { tenantId, id: { in: ids } },
      data: { whatsappAt: new Date() },
    });
  });
}
