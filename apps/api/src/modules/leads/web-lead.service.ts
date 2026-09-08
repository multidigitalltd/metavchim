import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { ulid } from "ulid";
import { lockContactPhone } from "../../common/locks";
import { CryptoService } from "../../core/crypto.service";
import { PrismaService } from "../../core/prisma.service";

/**
 * קליטת ליד מטופס באתר של המשרד (docs/05) — נקודת קצה ציבורית עם מפתח
 * ייעודי פר-משרד (settings.leadWebhookKey). אותה משמעת כמו קליטת
 * הוואטסאפ: איש קשר לפי phone_hash, נעילה פר איש-קשר נגד כפילויות,
 * פנייה כשיש ליד פתוח מצטרפת לציר הזמן במקום לפתוח ליד כפול.
 */
@Injectable()
export class WebLeadService {
  private readonly logger = new Logger(WebLeadService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * ‎**המשרד שמאחורי המפתח — בלי לקלוט דבר.**
   *
   * ‏הקורא הציבורי צריך לדעת אם הכתובת מזוהה **לפני** שהוא שופט
   * ‏את גוף הבקשה, כדי שגוף פסול אצל מפתח מוכר יירשם עם המשרד
   * ‏שלו ולא ייעלם מהסינון. `null` = הכתובת אינה מזוהה.
   *
   * ‏אין כאן אישור קיום החוצה: הקורא מחזיר אותה שגיאה גנרית בשני
   * ‏המקרים.
   */
  async resolveKey(key: string): Promise<{ tenantId: string; sourceLabel: string } | null> {
    return this.prisma.leadWebhook.findUnique({
      where: { key },
      select: { tenantId: true, sourceLabel: true },
    });
  }

  async ingest(
    key: string,
    input: {
      name: string;
      phone: string;
      message?: string;
      pageUrl?: string;
      email?: string;
      intent?: string;
      propertyId?: string;
    },
    /**
     * ‎**המשרד שנפתר — כדי שיומן הוובהוקים יוכל לשייך את השורה.**
     *
     * ‏הקליטה ידעה אותו וזרקה אותו; היומן נכתב אצל הקורא, ובלי
     * ‏להחזירו כל פנייה שנקלטה בהצלחה הייתה נרשמת בלי משרד —
     * ‏כלומר נופלת בדיוק מהסינון הראשון שנשאל.
     */
  ): Promise<{ tenantId: string }> {
    /*
     * המפתח מזהה גם את המשרד וגם את הערוץ: שם המקור שנבחר בהקמת
     * הוובהוק ("אתר", "פייסבוק"...) נכנס כ-source של הליד.
     */
    const webhook = await this.resolveKey(key);
    if (!webhook) {
      // מפתח לא מוכר — אותה שגיאה גנרית; לא מאשרים קיום/אי-קיום מפתחות
      throw new NotFoundException("לא נמצא");
    }
    await this.ingestForTenant(webhook.tenantId, input, webhook.sourceLabel);
    return { tenantId: webhook.tenantId };
  }

  /**
   * קליטה כשהדייר כבר זוהה בערוץ אחר (דף נחיתה של נכס — הטוקן זיהה)
   * או דרך וובהוק. אותה משמעת בדיוק: phone_hash, נעילה פר איש-קשר,
   * הצטרפות לליד פתוח.
   *
   * `source` הוא "landing" או שם המקור החופשי של הוובהוק — הוא נשמר
   * כמו שהוא על הליד ומוצג ברשימה (עד 20 תווים, כאורך העמודה).
   */
  async ingestForTenant(
    tenantId: string,
    input: {
      name: string;
      phone: string;
      message?: string;
      pageUrl?: string;
      email?: string;
      /** buy | sell | rent_in | rent_out | info — מאומת בשער. */
      intent?: string;
      /** הנכס שהמודעה פרסמה, כשהמקור יודע לומר. */
      propertyId?: string;
    },
    source: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      const phoneHash = this.crypto.phoneHash(input.phone);
      /*
       * האימייל נשמר על הכרטיס כשהוא ידוע — פנייה שהגיעה מתיבת
       * הדואר מביאה איתה את כתובת השולח, ובלי לשמור אותה ההודעה
       * **הבאה** מאותה כתובת הייתה נחשבת שוב לשולח לא מוכר.
       * החתימה (emailHash) היא מה שמאפשר את ההתאמה הזו.
       */
      const normalizedEmail = input.email?.trim().toLowerCase();
      const emailFields =
        normalizedEmail !== undefined && normalizedEmail !== ""
          ? {
              emailEncrypted: this.crypto.encrypt(normalizedEmail),
              emailHash: this.crypto.emailHash(normalizedEmail),
            }
          : {};

      /*
       * אותה נעילת מספר שנוטלת `findOrCreateByPhone`.
       *
       * החיפוש-ואז-יצירה כאן אינו עובר דרכה — הוא משלים גם כתובת
       * אימייל — ולכן היה מחוץ להסדר. ליד מהאתר שנפגש עם שיחה
       * נכנסת או עם קישור פתוח מאותו מספר חדש: שניהם אינם מוצאים
       * כרטיס, שניהם יוצרים, והאינדקס הייחודי מפיל את השני — כלומר
       * ליד שנבלע (ביקורת Codex).
       */
      await lockContactPhone(tx, tenantId, phoneHash);
      let contact = await tx.contact.findUnique({
        where: { tenantId_phoneHash: { tenantId, phoneHash } },
        select: { id: true, emailHash: true },
      });
      contact ??= await tx.contact.create({
        data: {
          id: ulid(),
          tenantId,
          nameEncrypted: this.crypto.encrypt(input.name),
          phoneEncrypted: this.crypto.encrypt(input.phone),
          phoneHash,
          ...emailFields,
        },
        select: { id: true, emailHash: true },
      });

      // כרטיס קיים בלי אימייל מקבל אותו כאן; כרטיס שכבר יש לו אימייל
      // אינו נדרס — הכתובת שהמתווך הזין ידנית גוברת על זו שהתגלתה
      if (contact.emailHash === null && Object.keys(emailFields).length > 0) {
        await tx.contact.updateMany({ where: { id: contact.id, tenantId }, data: emailFields });
      }

      /*
       * הנכס מאומת מול המשרד לפני שהוא נשמר.
       *
       * הנתיב ציבורי, והמזהה מגיע מגוף הבקשה — כלומר מגורם לא מזוהה.
       * מזהה של נכס ממשרד אחר היה נשמר בשקט ויוצר בכרטיס הליד קישור
       * לנכס שאינו קיים בשבילו. הנפילה היא לליד **בלי** נכס ולא
       * לשגיאה: ליד אמיתי לא אמור ללכת לאיבוד בגלל שדה משני שגוי.
       */
      const propertyId =
        input.propertyId === undefined
          ? undefined
          : ((
              await tx.property.findFirst({
                where: { id: input.propertyId, tenantId, deletedAt: null },
                select: { id: true },
              })
            )?.id ?? undefined);

      await this.attachOrCreateLead(tx, tenantId, contact.id, {
        message: input.message,
        pageUrl: input.pageUrl,
        source,
        ...(input.intent !== undefined ? { intent: input.intent } : {}),
        ...(propertyId !== undefined ? { propertyId } : {}),
      });
    });
    this.logger.log(`ליד מהאתר נקלט (tenant ${tenantId})`);
  }

  /**
   * קליטת פנייה לכרטיס **קיים** — אימייל נכנס מזוהה לפי כתובת השולח.
   * אותה משמעת בדיוק, בלי הדרישה לטלפון: הכרטיס כבר קיים עם טלפון.
   */
  async ingestForContact(
    tenantId: string,
    contactId: string,
    input: { message?: string; source: string },
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      await this.attachOrCreateLead(tx, tenantId, contactId, {
        message: input.message,
        source: input.source,
      });
    });
  }

  /**
   * הלב המשותף של כל ערוצי הקליטה, אחרי שאיש הקשר ידוע: נעילה
   * פר-איש-קשר, הצטרפות לליד פתוח אם יש, אחרת ליד חדש + תיעוד.
   */
  private async attachOrCreateLead(
    tx: Prisma.TransactionClient,
    tenantId: string,
    contactId: string,
    input: {
      message?: string;
      pageUrl?: string;
      source: string;
      intent?: string;
      propertyId?: string;
    },
  ): Promise<void> {
    const { source } = input;
    // נעילה פר איש-קשר — שליחה כפולה מהטופס לא יוצרת שני לידים
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`lead-intake:${tenantId}:${contactId}`}, 0))`;

    const summaryParts = [input.message?.trim(), input.pageUrl ? `מקור: ${input.pageUrl}` : null]
      .filter(Boolean)
      .join("\n");

    /*
     * ‎**אותו גוף לשני הענפים** (ביקורת Codex, P2).
     *
     * ‏הענף של הליד החדש בנה את השורה מ-`input.message` בלבד,
     * ‏והענף החוזר מ-`summaryParts`. ההבדל אינו ניסוח: את הנכס
     * ‏שהלקוח לחץ עליו `LandingService.publicLead` מוסר **רק**
     * ‏דרך `pageUrl`, ולכן שורה שנבנתה בלי הוא אמרה „נקלט מדף
     * ‏נחיתה של נכס” בלי לומר איזה — בדיוק על כרטיס הקונה שאליו
     * ‏נשלחה ההצעה, שם השאלה היחידה היא על מה הוא הגיב.
     *
     * ‏שתי נוסחאות לאותו דבר הן ההפרש שנשכח בענף אחד; לכן אחת.
     */
    const detail = summaryParts || "ללא הודעה";
    const eventText = (prefix: string): string => `${prefix}: ${detail}`.slice(0, 1500);

    const openLead = await tx.lead.findFirst({
      where: {
        tenantId,
        contactId,
        status: { in: ["new", "in_progress", "waiting_customer"] },
      },
      select: { id: true, intent: true, propertyId: true },
    });

    if (openLead) {
      /*
       * הפנייה החוזרת **משלימה חוסרים ואינה דורסת**.
       *
       * זה מסלול הדה-דופליקציה הרגיל, וקודם הוא בלע את `intent`
       * ואת `propertyId`: פנייה שנייה מפייסבוק, שדווקא כן ידעה מה
       * הלקוח רוצה ועל איזה נכס, הוסיפה הערה לציר הזמן והשדות
       * המובְנים נשארו ריקים (ביקורת Codex).
       *
       * השלמה בלבד ולא דריסה: אם הסוכן כבר קבע עניין או קישר נכס,
       * הוא ראה משהו שהטופס אינו יודע — וטופס אוטומטי שמתקן אדם
       * הוא בדיוק ההתנהגות שגורמת לאבד אמון במערכת.
       */
      const fill: { intent?: string; propertyId?: string } = {};
      if (input.intent !== undefined && openLead.intent === "unknown") {
        fill.intent = input.intent;
      }
      if (input.propertyId !== undefined && openLead.propertyId === null) {
        fill.propertyId = input.propertyId;
      }
      if (Object.keys(fill).length > 0) {
        await tx.lead.updateMany({ where: { id: openLead.id, tenantId }, data: fill });
      }

      // ליד פתוח קיים — הפנייה מצטרפת לציר הזמן שלו
      const repeatText = eventText(
        source === "landing" ? "פנייה נוספת מדף נחיתה" : `פנייה נוספת (${source})`,
      );
      await tx.interaction.create({
        data: { id: ulid(), tenantId, leadId: openLead.id, kind: "note", content: repeatText },
      });
      await this.alsoOnBuyerCards(tx, tenantId, contactId, repeatText);
      return;
    }

    const previous = await tx.lead.findFirst({
      where: { tenantId, contactId, status: { in: ["converted", "closed"] } },
      select: { id: true },
    });

    const leadId = ulid();
    await tx.lead.create({
      data: {
        id: leadId,
        tenantId,
        contactId,
        source,
        /*
         * העניין והנכס מגיעים מהמקור כשהוא יודע לומר אותם — מודעת
         * פייסבוק של נכס מסוים, טופס "מעוניין למכור". בלעדיהם הליד
         * נפתח כ"לא ידוע" בדיוק כמו קודם, והסוכן משלים.
         *
         * הנכס מאומת בשער מול המשרד: מזהה ממשרד אחר היה יוצר קישור
         * שמוביל לכרטיס שאינו קיים.
         */
        intent: input.intent ?? "unknown",
        ...(input.propertyId !== undefined ? { propertyId: input.propertyId } : {}),
        status: "new",
        summary: (summaryParts || (source === "landing" ? "פנייה מדף נחיתה" : `פנייה — ${source}`)).slice(0, 500),
        ...(previous ? { requiresHuman: true, requiresHumanReason: "ליד חוזר — פנה בעבר" } : {}),
      },
    });
    const firstText = eventText(
      source === "landing" ? "נקלט מדף נחיתה של נכס" : `נקלט מטופס (${source})`,
    );
    await tx.interaction.create({
      data: { id: ulid(), tenantId, leadId, kind: "note", content: firstText },
    });
    await this.alsoOnBuyerCards(tx, tenantId, contactId, firstText);
    await tx.outboxEvent.create({
      data: {
        id: ulid(),
        tenantId,
        name: "lead.created",
        payload: { leadId, tenantId, source },
      },
    });
  }

  /**
   * ‎**אותו מילוי, גם על כרטיס הקונה של אותו אדם.**
   *
   * ‏ציר הזמן בכרטיס הקונה קורא `interaction` לפי `buyerId`,
   * ‏והמילוי נרשם רק עם `leadId`. התוצאה: לקוח שקיבל הצעת נכס,
   * ‏נכנס לדף הנחיתה ומילא פרטים — לא הותיר שום סימן בכרטיס שממנו
   * ‏נשלחה אליו ההצעה. הסוכן פותח את הקונה ורואה כרטיס שלא קרה בו
   * ‏דבר (בקשת המשתמש).
   *
   * ‎**כל הכרטיסים החיים, ולא אחד.** למערכת מותר במפורש שיהיו
   * ‏לאיש קשר שני כרטיסי קונה — שתי דרישות של אותו אדם, או שארית
   * ‏של מיזוג — ובחירה שרירותית באחד הייתה מסתירה את המילוי
   * ‏מהסוכן שעובד על השני.
   *
   * ‎`direction: "in"` — הלקוח יזם. זו ההבחנה שמבדילה בציר הזמן
   * ‏בין „שלחנו לו” לבין „הוא פנה”.
   */
  private async alsoOnBuyerCards(
    tx: Prisma.TransactionClient,
    tenantId: string,
    contactId: string,
    content: string,
  ): Promise<void> {
    const cards = await tx.buyer.findMany({
      where: { tenantId, contactId, deletedAt: null },
      select: { id: true },
    });
    for (const card of cards) {
      await tx.interaction.create({
        data: { id: ulid(), tenantId, buyerId: card.id, kind: "note", direction: "in", content },
      });
    }
  }
}
