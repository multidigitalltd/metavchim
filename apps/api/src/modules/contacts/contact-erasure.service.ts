import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ulid } from "ulid";
import { lockContact } from "../../common/locks";
import { TenantContext } from "../../common/tenant-context";
import { deleteCoopDeals } from "../../common/coop-deal-cleanup";
import { normalizeNameForMatch } from "@metavchim/shared";
import { AuditService } from "../../core/audit.service";
import { CryptoService } from "../../core/crypto.service";
import { PrismaService, type TenantTx } from "../../core/prisma.service";

/**
 * מחיקת לקוח מהמערכת — זכות המחיקה של האדם, לא ניקוי זבל.
 *
 * לקוח שמבקש מהמשרד לא להחזיק עליו מידע זכאי לכך, והמשרד חייב שתהיה
 * לו דרך לבצע את זה בעצמו — בלחיצה, בלי לפנות לתמיכה ובלי לקוות
 * שמישהו יזכור למחוק גם את ההקלטות. זו הסיבה שהשירות הזה קיים.
 *
 * **מה נמחק:** כרטיס איש הקשר עצמו (שם, טלפונים, אימייל — כולם
 * מוצפנים), כרטיסי הקונה שלו והביקושים שבהם, הלידים שלו, ציר הזמן,
 * הפגישות והמשימות שנוגעות אליו, השיחות **וההקלטות** שלהן, ההודעות,
 * הסכמים שטרם נחתמו, והרישומים שפורסמו לרשת עם צילום מוצפן של
 * פרטיו.
 *
 * **מה נשאר, ולמה:**
 * - **הסכם חתום — לעולם לא נמחק.** זו ראיה משפטית ובסיס הזכאות של
 *   המשרד לדמי התיווך, ואינה שלו למחוק. המחיקה מנתקת אותו מהכרטיס
 *   (`contactId = null`) והוא עובר לארכיון המשרד. זהות החותם נשארת
 *   בתוך המסמך — שם, מספר זהות והנוסח שנחתם — כי מסמך חתום בלי
 *   החותם אינו מסמך. זה הגבול של המחיקה, והוא נאמר במפורש למי
 *   שמוחק ובמדיניות הפרטיות.
 * - **הנכס** שהוא היה בעליו — נשאר, בלי הקישור אליו. הנכס הוא נכס
 *   של המשרד ולא פרט אישי; מה שמזהה את האדם יושב על כרטיס איש הקשר
 *   שנמחק. מחיקת הנכס הייתה מוחקת גם התאמות והצעות של קונים אחרים
 *   שאין להם שום קשר לבקשה.
 * - **יומן הביקורת** — מוגן ברמת המסד (REVOKE UPDATE, DELETE) ואין
 *   בו שם, טלפון או תוכן; מזהים ופעולה בלבד. רשומת המחיקה עצמה
 *   נכתבת אליו במכוון: זו הראיה שהבקשה בוצעה.
 * - **מאזן הקרדיטים** — Append-Only, מזהים וסכומים בלבד. תנועת כסף
 *   שנמחקת היא כסף שנעלם מהמאזן.
 *
 * **הקבצים ב-S3** (הקלטות שיחה) נמחקים דרך אירועי
 * `storage.cleanup_object` שה-worker מריץ עד הצלחה — המפתחות נאספים
 * *לפני* מחיקת השורות שמכירות אותם, כי אחריה אין מי שיודע אילו
 * קבצים היו שלו.
 */
@Injectable()
export class ContactErasureService {
  private readonly logger = new Logger(ContactErasureService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * מה יימחק — לפני שמוחקים.
   *
   * לא נוחות: הסכם חתום שנמחק הוא גם הזכאות של המתווך לדמי התיווך,
   * ומנהל שלוחץ "מחק לקוח" בלי לדעת שיש עליו הסכם חתום מגלה את זה
   * מאוחר מדי. אותה גישה כמו באזהרת הורדת המסלול — מראים לפני
   * שמאשרים, ולא מסבירים אחרי.
   */
  async preview(contactId: string): Promise<{
    buyers: number;
    leads: number;
    calls: number;
    recordings: number;
    messages: number;
    /** הסכמים שטרם נחתמו — אלה שיימחקו. */
    agreements: number;
    /** הסכמים חתומים — **נשמרים** ועוברים לארכיון המשרד. */
    signedAgreements: number;
    appointments: number;
    properties: number;
    sharedListings: number;
    linkedPeople: number;
  }> {
    const { tenantId } = TenantContext.current();
    return this.prisma.withTenant(async (tx) => {
      const contact = await tx.contact.findFirst({
        where: { id: contactId, tenantId },
        select: { id: true },
      });
      if (!contact) throw new NotFoundException("הלקוח לא נמצא");

      const [buyerIds, leadIds] = await Promise.all([
        tx.buyer.findMany({ where: { tenantId, contactId }, select: { id: true } }),
        tx.lead.findMany({ where: { tenantId, contactId }, select: { id: true } }),
      ]);
      const buyers = buyerIds.map((b) => b.id);
      const leads = leadIds.map((l) => l.id);

      const [
        calls,
        recordings,
        messages,
        agreements,
        signedAgreements,
        appointments,
        properties,
        sharedLeads,
        sharedDemands,
        linkedPeople,
      ] = await Promise.all([
        tx.call.count({ where: { tenantId, contactId } }),
        tx.call.count({ where: { tenantId, contactId, recordingKey: { not: null } } }),
        tx.message.count({ where: { tenantId, contactId } }),
        tx.agreement.count({ where: { tenantId, contactId, status: { not: "signed" } } }),
        tx.agreement.count({ where: { tenantId, contactId, status: "signed" } }),
        tx.appointment.count({
          where: {
            tenantId,
            OR: [{ buyerId: { in: buyers } }, { leadId: { in: leads } }],
          },
        }),
        tx.property.count({
          where: {
            tenantId,
            OR: [{ ownerContactId: contactId }, { occupantContactId: contactId }],
          },
        }),
        tx.sharedLead.count({ where: { tenantId, originLeadId: { in: leads } } }),
        tx.sharedDemand.count({ where: { tenantId, originBuyerId: { in: buyers } } }),
        tx.contactLink.count({ where: { tenantId, contactId } }),
      ]);

      return {
        buyers: buyers.length,
        leads: leads.length,
        calls,
        recordings,
        messages,
        agreements,
        signedAgreements,
        appointments,
        properties,
        sharedListings: sharedLeads + sharedDemands,
        linkedPeople,
      };
    });
  }

  /**
   * המחיקה עצמה — הכול, בטרנזקציה אחת.
   *
   * טרנזקציה ולא סדרת מחיקות: מחיקה שנעצרת באמצע משאירה את הלקוח
   * חצי-מחוק, וזה הגרוע משני העולמות — הכרטיס כבר לא שמיש, והמידע
   * עדיין שם.
   */
  async erase(contactId: string, confirmName: string): Promise<{ ok: true }> {
    const { tenantId, userId } = TenantContext.current();

    const s3Keys = await this.prisma.withTenant(async (tx) => {
      /*
       * נעילה לפני הכול: ליד נכנס מאותו טלפון בדיוק עכשיו ממחזר את
       * הכרטיס הזה ותולה עליו רשומות חדשות. מי שממחזר נועל את אותו
       * מפתח (`common/locks.ts`), ולכן הוא ימתין ויקרא מחדש.
       */
      await lockContact(tx, contactId);
      const contact = await tx.contact.findFirst({
        where: { id: contactId, tenantId },
        select: { id: true, nameHash: true, nameEncrypted: true },
      });
      if (!contact) throw new NotFoundException("הלקוח לא נמצא");
      /*
       * האישור מאומת בשרת ולא רק במסך.
       *
       * ההשוואה על השם המנורמל — אותה נרמול שמשמש לאיתור כפילויות —
       * כדי שרווח כפול או גרש לא יכשילו אישור נכון. השוואה מדויקת
       * לתו הייתה הופכת את ההגנה למכשול, ואת המכשול לעקיפה.
       */
      const stored = normalizeNameForMatch(this.crypto.decrypt(contact.nameEncrypted));
      if (normalizeNameForMatch(confirmName) !== stored) {
        throw new BadRequestException("השם שהוקלד אינו תואם — המחיקה בוטלה");
      }

      const [buyerRows, leadRows, retainedAgreements] = await Promise.all([
        tx.buyer.findMany({ where: { tenantId, contactId }, select: { id: true } }),
        tx.lead.findMany({ where: { tenantId, contactId }, select: { id: true } }),
        tx.agreement.count({ where: { tenantId, contactId, status: "signed" } }),
      ]);
      const buyers = buyerRows.map((b) => b.id);
      const leads = leadRows.map((l) => l.id);

      // המפתחות נאספים לפני המחיקה — אחריה אין שורה שיודעת עליהם
      const recorded = await tx.call.findMany({
        where: { tenantId, contactId, recordingKey: { not: null } },
        select: { recordingKey: true },
      });
      const keys = recorded
        .map((c) => c.recordingKey)
        .filter((key): key is string => key !== null);

      await this.eraseWithin(tx, {
        tenantId,
        contactId,
        buyers,
        leads,
        nameHash: contact.nameHash,
      });

      if (keys.length > 0) {
        await tx.outboxEvent.createMany({
          data: keys.map((s3Key) => ({
            id: ulid(),
            tenantId,
            name: "storage.cleanup_object",
            payload: { tenantId, s3Key },
          })),
        });
      }

      /*
       * הרישום נכתב **בתוך** אותה טרנזקציה: מחיקה שהצליחה בלי רישום
       * היא מחיקה שאין לה ראיה, ורישום בלי מחיקה הוא ראיה לשקר.
       * מזהים ומונים בלבד — שום פרט של הנמחק לא נשאר ביומן.
       */
      await this.audit.record(tx, {
        action: "contact.erase",
        entityType: "contact",
        entityId: contactId,
        metadata: {
          buyers: buyers.length,
          leads: leads.length,
          recordings: keys.length,
          // כמה מסמכים חתומים נשמרו — חלק מהראיה שהמחיקה בוצעה כדין
          retainedAgreements,
        },
      });
      return keys;
    });

    this.logger.warn(
      `לקוח נמחק לצמיתות: contact ${contactId} במשרד ${tenantId} בידי ${userId} (${s3Keys.length} הקלטות בניקוי)`,
    );
    return { ok: true };
  }

  /**
   * סדר המחיקה מוכתב במקומות שבהם יש מפתח זר או תלות לוגית:
   * צאצאים לפני הורים, וכרטיס איש הקשר אחרון.
   */
  private async eraseWithin(
    tx: TenantTx,
    { tenantId, contactId, buyers, leads, nameHash }: {
      tenantId: string;
      contactId: string;
      buyers: string[];
      leads: string[];
      nameHash: string | null;
    },
  ): Promise<void> {
    /*
     * מה שפורסם לרשת — **כולל רישום שכבר נמכר.**
     *
     * כאן זה שונה ממחיקת ליד בודד, ובכוונה: על השורה יושב צילום
     * מוצפן של השם והטלפון, וזה בדיוק מה שהאדם ביקש שיימחק. תיעוד
     * העסקה עצמה שורד ב-credit_ledger, שאין בו שום פרט אישי.
     */
    const sharedLeads = await tx.sharedLead.findMany({
      where: { tenantId, originLeadId: { in: leads } },
      select: { id: true },
    });
    const sharedLeadIds = sharedLeads.map((row) => row.id);
    // הדירוגים ההדדיים תלויים ברישום, ולכן לפניו
    await tx.leadReferralRating.deleteMany({
      where: { sharedLeadId: { in: sharedLeadIds } },
    });
    await tx.sharedLead.deleteMany({ where: { tenantId, originLeadId: { in: leads } } });

    /*
     * הצעות שת"פ שנשלחו על הביקוש שלו — ההצעה מצביעה על הביקוש
     * (`demandId`), ולכן היא נמחקת לפניו. הצעות שהמשרד שלח על ביקוש
     * של משרד אחר אינן נוגעות לאדם הזה ואינן נמחקות.
     */
    // חדרי העסקה שנפתחו על הכרטיסים של האדם הזה — לפני הביקושים
    await deleteCoopDeals(tx, {
      buyerId: { in: buyers },
      buyerTenantId: tenantId,
    });

    const sharedDemands = await tx.sharedDemand.findMany({
      where: { tenantId, originBuyerId: { in: buyers } },
      select: { id: true },
    });
    await tx.coopOffer.deleteMany({
      where: { demandId: { in: sharedDemands.map((row) => row.id) } },
    });
    await tx.sharedDemand.deleteMany({ where: { tenantId, originBuyerId: { in: buyers } } });

    // ציר הזמן, הפגישות והמשימות
    await tx.interaction.deleteMany({
      where: { tenantId, OR: [{ buyerId: { in: buyers } }, { leadId: { in: leads } }] },
    });
    await tx.appointment.deleteMany({
      where: { tenantId, OR: [{ buyerId: { in: buyers } }, { leadId: { in: leads } }] },
    });
    for (const [entityType, ids] of [
      ["buyer", buyers],
      ["lead", leads],
      ["contact", [contactId]],
    ] as const) {
      if (ids.length === 0) continue;
      await tx.notification.deleteMany({
        where: { tenantId, entityType, entityId: { in: [...ids] } },
      });
      await tx.task.deleteMany({
        where: { tenantId, entityType, entityId: { in: [...ids] } },
      });
    }

    // התאמות והצעות של הקונה — ההצעה תלויה בהתאמה, ולכן לפניה
    const matches = await tx.match.findMany({
      where: { tenantId, buyerId: { in: buyers } },
      select: { id: true },
    });
    await tx.offer.deleteMany({
      where: { tenantId, matchId: { in: matches.map((row) => row.id) } },
    });
    await tx.match.deleteMany({ where: { tenantId, buyerId: { in: buyers } } });

    // תקשורת: שיחות (עם התמלול שעליהן) והודעות
    await tx.call.deleteMany({ where: { tenantId, contactId } });
    await tx.message.deleteMany({ where: { tenantId, contactId } });
    /*
     * הסכם חתום **אינו נמחק בשום מקרה** — הוא ראיה משפטית ובסיס
     * הזכאות לדמי התיווך, ואינו של הלקוח למחוק. הוא מנותק מהכרטיס
     * ועובר לארכיון המשרד; הזהות שבתוכו נשארת, כי מסמך חתום בלי
     * החותם אינו מסמך.
     *
     * הניתוק לפני המחיקה, לא אחריה: מחיקת הכרטיס לפני שההסכם נותק
     * הייתה משאירה אותו מצביע על כרטיס שאיננו.
     */
    await tx.agreement.updateMany({
      where: { tenantId, contactId, status: "signed" },
      data: { contactId: null },
    });
    // מה שלא נחתם הוא טיוטה או קישור שפג — נמחק עם השאר
    await tx.agreement.deleteMany({ where: { tenantId, contactId } });

    await tx.buyer.deleteMany({ where: { tenantId, contactId } });
    await tx.lead.deleteMany({ where: { tenantId, contactId } });

    /*
     * הנכס נשאר, הקישור לבעלים יורד.
     *
     * הנכס הוא נכס של המשרד ולא פרט אישי, ומה שמזהה את האדם יושב על
     * כרטיס איש הקשר שנמחק כאן. מחיקת הנכס הייתה גוררת איתה התאמות
     * והצעות של קונים אחרים שאין להם קשר לבקשה.
     */
    await tx.property.updateMany({
      where: { tenantId, ownerContactId: contactId },
      data: { ownerContactId: null },
    });
    /*
     * ואותו דבר למי שגר בנכס.
     *
     * שוכר שביקש מחיקה הוא בדיוק המקרה שבגללו הפרטים שלו נכנסו
     * לכרטיס מלכתחילה במקום להישאר בטלפון של המתווך: הבקשה חייבת
     * למצוא אותו. בלי השורה הזו הייתה נשארת הפניה למזהה שנמחק —
     * כלומר גם דליפה שקטה וגם „נמחק הכול” שאינו נכון.
     */
    await tx.property.updateMany({
      where: { tenantId, occupantContactId: contactId },
      data: { occupantContactId: null },
    });

    /*
     * קשרי בן/בת זוג — משני הכיוונים. הכיוון שבו הוא הכרטיס הראשי
     * יורד ב-CASCADE, אבל הכיוון שבו הוא ה"קשור" מצביע מכרטיס של
     * אדם אחר שנשאר — ובלי המחיקה הזו הוא היה מצביע על כלום.
     */
    await tx.contactLink.deleteMany({
      where: { tenantId, OR: [{ contactId }, { relatedContactId: contactId }] },
    });
    /*
     * "הכרטיסים האלה אינם אותו אדם" נשמר לפי HMAC של השם, ולכן הוא
     * מידע שנגזר מהשם של הנמחק — והולך איתו. המחיר הוא שהצעת המיזוג
     * עשויה לחזור לאחרים באותו שם; זה עדיף על שיור של גיבוב שמו.
     */
    if (nameHash !== null) {
      await tx.duplicateDismissal.deleteMany({ where: { tenantId, nameHash } });
    }
    // הטלפונים הנוספים יורדים ב-CASCADE יחד עם הכרטיס
    await tx.contact.delete({ where: { id: contactId } });
  }
}
